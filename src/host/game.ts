/**
 * One race on the host: owns the sim World, the Three.js scene and the
 * fixed-step loop, renders one viewport per player (split-screen), and turns
 * sim events into HUD messages, phone status updates and haptics.
 *
 * Split-screen in Three.js: a single renderer and a single scene, but one
 * camera per player. Each frame we render the scene once per camera, each
 * time restricted to that player's rectangle with setViewport/setScissor.
 */
import * as THREE from 'three';
import { colorHex } from '../shared/colors';
import type { ControlInput, HostToController } from '../shared/protocol';
import { autopilot, botStyleFor } from '../sim/autopilot';
import { SIM_DT } from '../sim/config';
import { FixedStepLoop } from '../sim/loop';
import { Track } from '../sim/track';
import { World, type WorldEvent } from '../sim/world';
import { TRACKS, type TrackDef } from '../track';
import { ChaseCamera } from '../render/chaseCamera';
import { KartView } from '../render/kartView';
import { splitLayout, toViewport, type Rect } from '../render/layout';
import { Minimap } from '../render/minimap';
import {
  applyRendererQuality,
  applySceneQuality,
  createRenderer,
  createScene,
  followWithSun,
  type QualitySettings,
} from '../render/scene';
import { TrackView } from '../render/trackView';
import type { PlayerManager } from './playerManager';
import { ViewHud } from './viewHud';

const ordinalSuffix = (n: number) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');

export function formatTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/** Vibration patterns sent to phones (ms on/off). */
const HAPTICS = {
  wall: [45],
  bump: [25],
  boost: [30],
  startBoost: [30, 40, 90],
  stall: [250],
  lap: [60, 60, 60],
  finish: [120, 60, 120, 60, 250],
  driftTier: [12],
  miniTurbo: [30, 30, 70],
  trick: [20, 25, 20],
  respawn: [200],
} as const;

export interface GameCallbacks {
  /** Countdown finished, racing has begun. */
  onGo(): void;
  /** Race over and the results screen is up. */
  onResults(): void;
}

/** Everything that belongs to one player's screen area. */
interface PlayerView {
  slot: number;
  kart: KartView;
  chase: ChaseCamera;
  hud: ViewHud;
  rect: Rect;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private sun: THREE.DirectionalLight;
  private track: Track;
  private trackView: TrackView;
  private world: World;
  private views: PlayerView[] = [];
  private loop: FixedStepLoop;
  private elapsed = 0;
  private resultsShown = false;
  private doneAt: number | null = null;
  private statusTimer = 0;
  private lastStatus = new Map<number, string>();
  private lastCountdown = 0;
  private hudLayer: HTMLElement;
  private results: HTMLElement;
  private minimap: Minimap;

  constructor(
    private readonly container: HTMLElement,
    private readonly players: PlayerManager,
    private readonly callbacks: GameCallbacks,
    quality: QualitySettings,
  ) {
    this.renderer = createRenderer(container, quality);
    const parts = createScene();
    this.scene = parts.scene;
    this.sun = parts.sun;
    this.track = new Track(TRACKS[0]);
    this.trackView = new TrackView(this.track);
    this.scene.add(this.trackView.group);
    applySceneQuality(this.scene, this.sun, quality);
    this.world = new World(this.track, this.track);
    this.loop = new FixedStepLoop(() => this.handleEvents(this.world.tick((slot) => this.inputFor(slot))), SIM_DT);

    this.hudLayer = document.createElement('div');
    this.hudLayer.className = 'hud-layer';
    container.appendChild(this.hudLayer);
    this.minimap = new Minimap(this.track, this.hudLayer);
    this.results = document.createElement('div');
    this.results.className = 'results hidden';
    container.appendChild(this.results);
    const help = document.createElement('div');
    help.className = 'hud-help';
    help.textContent = 'Esc: lobby';
    container.appendChild(help);

    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Switch to another track (from the lobby's track picker). Rebuilds the sim
   * Track, its 3D view and the minimap; takes effect at the next start().
   */
  setTrack(def: TrackDef): void {
    if (def === this.track.def) return;
    this.scene.remove(this.trackView.group);
    disposeObject(this.trackView.group);
    this.minimap.canvas.remove();
    this.track = new Track(def);
    this.trackView = new TrackView(this.track);
    this.scene.add(this.trackView.group);
    this.minimap = new Minimap(this.track, this.hudLayer);
    this.world = new World(this.track, this.track);
  }

  setQuality(q: QualitySettings): void {
    applyRendererQuality(this.renderer, q);
    applySceneQuality(this.scene, this.sun, q);
    this.resize();
  }

  /** Start a new race with a kart and a viewport for each slot. */
  start(slots: number[]): void {
    for (const v of this.views) {
      v.kart.dispose(this.scene);
      v.hud.dispose();
    }
    this.world = new World(this.track, this.track);
    this.world.startRace(slots, this.track.def.laps);

    const layout = splitLayout(slots.length);
    this.views = slots.map((slot, i) => {
      const p = this.players.slots.slots[slot];
      const color = colorHex(p?.color ?? slot);
      const hud = new ViewHud(this.hudLayer, p?.name ?? `P${slot + 1}`, color, slot);
      hud.place(layout.views[i]);
      // Only show the "P1 Name" tag when the screen is shared.
      hud.root.classList.toggle('solo', slots.length === 1);
      const chase = new ChaseCamera();
      chase.snap();
      return { slot, kart: new KartView(this.scene, color), chase, hud, rect: layout.views[i] };
    });
    this.minimap.place(layout.minimap);

    this.loop.reset();
    this.resultsShown = false;
    this.doneAt = null;
    this.lastCountdown = 0;
    this.lastStatus.clear();
    this.results.classList.add('hidden');
    this.resize();
  }

  /** Bots drive themselves; everyone else uses their controller. */
  private inputFor(slot: number): ControlInput {
    if (this.players.isBot(slot)) {
      const k = this.world.karts.get(slot);
      if (k) return autopilot(k, this.track, botStyleFor(slot));
    }
    return this.players.inputFor(slot);
  }

  /** Called every animation frame while a race is on screen. */
  frame(dt: number): void {
    this.elapsed += dt;
    const alpha = this.loop.advance(dt);
    const race = this.world.race!;
    this.trackView.update(this.elapsed);

    // Update every kart's interpolated pose, then each player's camera.
    let cx = 0;
    let cz = 0;
    for (const v of this.views) {
      v.kart.update(this.world.prevKarts.get(v.slot)!, this.world.karts.get(v.slot)!, alpha, dt, this.track);
      cx += v.kart.pose.x;
      cz += v.kart.pose.z;
    }
    cx /= Math.max(1, this.views.length);
    cz /= Math.max(1, this.views.length);
    let spread = 0;
    for (const v of this.views) spread = Math.max(spread, Math.hypot(v.kart.pose.x - cx, v.kart.pose.z - cz));
    followWithSun(this.sun, cx, cz, spread + 45);

    // Countdown numbers on every HUD.
    if (race.phase === 'countdown') {
      const n = Math.max(1, Math.ceil(-race.time));
      if (n !== this.lastCountdown) {
        this.lastCountdown = n;
        for (const v of this.views) v.hud.toast(String(n), 1, this.elapsed);
      }
    }

    // Render: shadow map once, then the scene once per viewport.
    const size = this.renderer.getSize(new THREE.Vector2());
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.setScissorTest(true);
    for (const v of this.views) {
      const kart = this.world.karts.get(v.slot)!;
      const r = toViewport(v.rect, size.x, size.y);
      v.chase.setAspect(r.w / Math.max(1, r.h));
      v.chase.update(v.kart.pose, dt, kart.boostTime > 0 ? 10 : 0);
      this.renderer.setViewport(r.x, r.y, r.w, r.h);
      this.renderer.setScissor(r.x, r.y, r.w, r.h);
      this.renderer.render(this.scene, v.chase.camera);

      const racer = race.racers.get(v.slot)!;
      v.hud.update(
        {
          position: racer.place ?? race.positionOf(v.slot),
          racers: race.racers.size,
          lap: Math.min(race.totalLaps, Math.max(1, racer.lap)),
          laps: race.totalLaps,
          time: formatTime(Math.max(0, racer.finishTime ?? race.time)),
          speedKmh: Math.round(Math.abs(v.kart.pose.speed) * 3.6),
          boosting: kart.boostTime > 0,
        },
        this.elapsed,
      );
    }
    this.renderer.setScissorTest(false);

    this.minimap.draw(
      race.standings().map((slot) => {
        const v = this.views.find((x) => x.slot === slot)!;
        const p = this.players.slots.slots[slot];
        return { x: v.kart.pose.x, z: v.kart.pose.z, color: colorHex(p?.color ?? slot), label: `P${slot + 1}` };
      }),
    );

    // Phone status ~4x per second (only when something changed).
    this.statusTimer += dt;
    if (this.statusTimer >= 0.25) {
      this.statusTimer = 0;
      this.sendStatus();
    }

    // Results screen a moment after the race ends.
    if (this.doneAt !== null && !this.resultsShown && this.elapsed - this.doneAt > 2.5) {
      this.resultsShown = true;
      this.showResults();
      this.callbacks.onResults();
    }
  }

  private viewOf(slot: number): PlayerView | undefined {
    return this.views.find((v) => v.slot === slot);
  }

  private toast(slot: number, text: string, seconds: number): void {
    this.viewOf(slot)?.hud.toast(text, seconds, this.elapsed);
  }

  private handleEvents(events: WorldEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case 'go':
          for (const v of this.views) v.hud.toast('GO!', 1, this.elapsed);
          this.callbacks.onGo();
          break;
        case 'startBoost':
          this.haptic(e.slot, HAPTICS.startBoost);
          this.toast(e.slot, 'ROCKET START!', 1.2);
          break;
        case 'stall':
          this.haptic(e.slot, HAPTICS.stall);
          this.toast(e.slot, 'Too early!', 1.2);
          break;
        case 'wall':
          if (e.impact > 6) this.haptic(e.slot, HAPTICS.wall);
          break;
        case 'kart':
          if (e.impact > 3) this.haptic(e.slot, HAPTICS.bump);
          break;
        case 'boostPad':
          this.haptic(e.slot, HAPTICS.boost);
          break;
        case 'lap': {
          this.haptic(e.slot, HAPTICS.lap);
          const laps = this.track.def.laps;
          if (e.lap < laps) this.toast(e.slot, e.lap + 1 === laps ? 'FINAL LAP!' : `LAP ${e.lap + 1}`, 1.5);
          break;
        }
        case 'finish':
          this.haptic(e.slot, HAPTICS.finish);
          this.toast(e.slot, `FINISH! ${e.place}${ordinalSuffix(e.place)}`, 30);
          break;
        case 'done':
          this.doneAt = this.elapsed;
          break;
        case 'driftStart':
          this.players.sendTo(e.slot, { t: 'drift', tier: 0 });
          break;
        case 'driftTier':
          this.players.sendTo(e.slot, { t: 'drift', tier: e.tier });
          if (e.tier > 0) this.haptic(e.slot, HAPTICS.driftTier);
          break;
        case 'driftEnd':
          this.players.sendTo(e.slot, { t: 'drift', tier: null });
          break;
        case 'miniTurbo':
          this.haptic(e.slot, HAPTICS.miniTurbo);
          break;
        case 'trick':
          this.haptic(e.slot, HAPTICS.trick);
          this.toast(e.slot, 'TRICK!', 0.8);
          break;
        case 'respawn':
          this.haptic(e.slot, HAPTICS.respawn);
          this.players.sendTo(e.slot, { t: 'drift', tier: null });
          break;
      }
    }
  }

  private haptic(slot: number, pattern: readonly number[]): void {
    this.players.sendTo(slot, { t: 'haptic', pattern: [...pattern] });
  }

  private sendStatus(): void {
    const race = this.world.race;
    if (!race) return;
    for (const [slot, r] of race.racers) {
      const msg: HostToController = {
        t: 'status',
        position: r.place ?? race.positionOf(slot),
        lap: Math.min(race.totalLaps, Math.max(1, r.lap)),
        totalLaps: race.totalLaps,
        item: { kind: 'none' },
      };
      const key = JSON.stringify(msg);
      if (this.lastStatus.get(slot) === key) continue;
      this.lastStatus.set(slot, key);
      this.players.sendTo(slot, msg);
    }
  }

  private showResults(): void {
    const race = this.world.race!;
    const rows = race.standings().map((slot) => {
      const r = race.racers.get(slot)!;
      const p = this.players.slots.slots[slot];
      const best = r.lapTimes.length ? Math.min(...r.lapTimes) : null;
      return {
        place: r.place ?? 0,
        name: p?.name ?? `P${slot + 1}`,
        color: colorHex(p?.color ?? slot),
        time: r.finished ? formatTime(r.finishTime!) : 'DNF',
        best: best === null ? '–' : formatTime(best),
      };
    });
    rows.sort((a, b) => a.place - b.place);
    const box = document.createElement('div');
    box.className = 'results-box';
    box.innerHTML = `<h2>Results</h2><table><thead><tr><th></th><th>Racer</th><th>Time</th><th>Best lap</th></tr></thead><tbody></tbody></table>
      <p class="results-help">Tap <b>RACE AGAIN</b> on your phones (or press <kbd>Enter</kbd>) · <kbd>Esc</kbd> back to lobby</p>`;
    const tbody = box.querySelector('tbody')!;
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="place">${row.place}${ordinalSuffix(row.place)}</td><td class="name"><span class="dot"></span><span class="n"></span></td><td>${row.time}</td><td>${row.best}</td>`;
      (tr.querySelector('.dot') as HTMLElement).style.background = row.color;
      tr.querySelector('.n')!.textContent = row.name; // names come from phones: textContent only
      tbody.appendChild(tr);
    }
    this.results.replaceChildren(box);
    this.results.classList.remove('hidden');
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
  }
}

/**
 * Free the GPU memory (vertex buffers, materials, textures) of everything in
 * a Three.js object tree. WebGL resources aren't garbage-collected like normal
 * JS objects, so meshes we throw away must be disposed explicitly.
 */
function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
}
