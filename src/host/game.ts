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
import { ITEMS, SIM_DT } from '../sim/config';
import { botItemButton } from '../sim/items/items';
import { ITEM_IDS, type ItemId } from '../sim/items/types';
import { FixedStepLoop } from '../sim/loop';
import { Track } from '../sim/track';
import { World, type WorldEvent } from '../sim/world';
import { TRACKS, type TrackDef } from '../track';
import { ChaseCamera } from '../render/chaseCamera';
import { KartView } from '../render/kartView';
import { ItemMeshPool, animateItemBox, buildItemBox } from '../render/itemMeshes';
import { splitLayout, toViewport, type Rect } from '../render/layout';
import { CannonView } from '../render/cannonView';
import { Minimap } from '../render/minimap';
import {
  applyRendererQuality,
  applyTheme,
  applySceneQuality,
  createRenderer,
  createScene,
  followWithSun,
  type QualitySettings,
} from '../render/scene';
import { RenderPipeline } from '../render/post/pipeline';
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
  itemGet: [15, 30, 15],
  itemUse: [20],
  spunOut: [60, 40, 120, 40, 60],
  novaHit: [40, 20, 40],
  driftTier: [12],
  miniTurbo: [30, 30, 70],
  trick: [20, 25, 20],
  respawn: [200],
  cannonFire: [120, 30, 60],
  cannonLand: [35],
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
  /** Render pipeline (HDR target, bloom, grade); see src/render/post/pipeline.ts. */
  private pipeline: RenderPipeline;
  private quality: QualitySettings;
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
  private mapTimer = 0;
  private lastStatus = new Map<number, string>();
  private lastCountdown = 0;
  private hudLayer: HTMLElement;
  private results: HTMLElement;
  private minimap: Minimap;
  private boxMeshes: THREE.Object3D[] = [];
  /**
   * Practice/testing aid (URL `?give=nova`): everyone gets an endless supply of
   * this item (or "random" = random item each time). Null = normal item boxes only.
   */
  devItem: ItemId | 'random' | null = null;
  private itemPool: ItemMeshPool;
  /** Launch cannons of the current track (rebuilt for every race). */
  private cannonView: CannonView | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly players: PlayerManager,
    private readonly callbacks: GameCallbacks,
    quality: QualitySettings,
  ) {
    this.renderer = createRenderer(container, quality);
    this.quality = quality;
    this.track = new Track(TRACKS[0]);
    const parts = createScene(this.track.def.theme);
    this.scene = parts.scene;
    this.sun = parts.sun;
    // Sky environment map for reflections + render pipeline (post-processing).
    applyTheme(this.scene, this.track.def.theme, this.renderer, quality.envSize);
    this.pipeline = new RenderPipeline(this.renderer, quality, this.track.def.theme);
    this.trackView = new TrackView(this.track);
    this.scene.add(this.trackView.group);
    this.itemPool = new ItemMeshPool(this.scene);
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
    applyTheme(this.scene, def.theme, this.renderer, this.quality.envSize); // sky, fog, lights and reflections follow the track
    this.pipeline.setTheme(def.theme); // bloom / colour grade follow the track too
    this.scene.remove(this.trackView.group);
    disposeObject(this.trackView.group);
    this.minimap.canvas.remove();
    this.cannonView?.dispose(this.scene);
    this.cannonView = null;
    this.track = new Track(def);
    this.trackView = new TrackView(this.track);
    this.scene.add(this.trackView.group);
    this.minimap = new Minimap(this.track, this.hudLayer);
    this.world = new World(this.track, this.track);
  }

  setQuality(q: QualitySettings): void {
    const envChanged = q.envSize !== this.quality.envSize;
    this.quality = q;
    applyRendererQuality(this.renderer, q);
    this.pipeline.setQuality(q);
    if (envChanged) applyTheme(this.scene, this.track.def.theme, this.renderer, q.envSize);
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

    // Launch cannons for this track (barrel, mouth glow, landing pad).
    this.cannonView?.dispose(this.scene);
    this.cannonView = this.track.cannons.length > 0 ? new CannonView(this.scene, this.track.cannons, this.track) : null;

    // Item boxes (one floating mesh per box) and any leftover item objects.
    for (const m of this.boxMeshes) this.scene.remove(m);
    this.itemPool.clear();
    this.boxMeshes = this.world.items!.boxes.map((b) => {
      const m = buildItemBox();
      m.scale.setScalar(1.3); // a bit bigger than modeled so boxes read from the chase camera
      m.position.set(b.x, b.y, b.z);
      this.scene.add(m);
      return m;
    });

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

    // Phones draw a minimap: send them the track outline (about 12 m between points) plus the rich map data, once.
    const pts: number[] = [];
    for (let i = 0; i < this.track.samples.length; i += 6) {
      pts.push(Math.round(this.track.samples[i].x * 10) / 10, Math.round(this.track.samples[i].z * 10) / 10);
    }
    this.players.setTrackMessage({ t: 'track', pts, w: this.track.def.width, map: this.minimap.data });

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
      if (k) {
        const base = autopilot(k, this.track, botStyleFor(slot));
        return { ...base, buttons: base.buttons | botItemButton(slot, this.world.items?.states.get(slot)) };
      }
    }
    return this.players.inputFor(slot);
  }

  /** Called every animation frame while a race is on screen. */
  frame(dt: number): void {
    this.elapsed += dt;
    const alpha = this.loop.advance(dt);
    const race = this.world.race!;
    this.trackView.update(this.elapsed);
    this.cannonView?.update(this.elapsed, dt);

    // Item boxes spin and bob (hidden while waiting to respawn); item objects follow the sim.
    const items = this.world.items!;
    if (this.devItem && race.phase === 'racing') {
      for (const st of items.states.values()) {
        if (st.held || st.roulette > 0) continue;
        const id = this.devItem === 'random' ? ITEM_IDS[Math.floor(Math.random() * ITEM_IDS.length)] : this.devItem;
        st.held = { id, count: id === 'dash' ? 3 : 1 };
        st.heldFor = 0;
      }
    }
    items.boxes.forEach((b, i) => {
      const mesh = this.boxMeshes[i];
      mesh.visible = b.active;
      if (b.active) animateItemBox(mesh, this.elapsed, i * 0.9);
    });
    this.itemPool.update(items.entityList, this.elapsed);

    // Update every kart's interpolated pose, then each player's camera.
    let cx = 0;
    let cz = 0;
    for (const v of this.views) {
      const ist = items.states.get(v.slot);
      // A dragged shot shows behind the kart (a dragged Slick is its own world object).
      v.kart.trailingItem = ist?.trailing && ist.held && ist.held.id !== 'slick' ? ist.held.id : null;
      v.kart.update(this.world.prevKarts.get(v.slot)!, this.world.karts.get(v.slot)!, alpha, dt, this.track);
      cx += v.kart.pose.x;
      cz += v.kart.pose.z;
    }
    cx /= Math.max(1, this.views.length);
    cz /= Math.max(1, this.views.length);
    let spread = 0;
    for (const v of this.views) spread = Math.max(spread, Math.hypot(v.kart.pose.x - cx, v.kart.pose.z - cz));
    // Shadows: when the karts are close together one shadow map covers all of them; when they are
    // spread out (split-screen on a big track) the map is re-aimed and redrawn for each view below.
    const sharedShadow = this.views.length <= 1 || spread < 50 || !this.quality.shadowPerView;
    if (sharedShadow) followWithSun(this.sun, cx, cz, spread + 55);

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
    if (sharedShadow) this.renderer.shadowMap.needsUpdate = true;
    this.pipeline.beginFrame();
    for (const v of this.views) {
      const kart = this.world.karts.get(v.slot)!;
      const r = toViewport(v.rect, size.x, size.y);
      v.chase.setAspect(r.w / Math.max(1, r.h));
      const ground = (x: number, z: number) => this.track.sample(x, z, kart.trackIndex)?.height ?? null;
      v.chase.update(v.kart.pose, dt, kart.flight ? 20 : kart.boostTime > 0 ? 10 : 0, ground); // wider view while flying out of a cannon
      if (!sharedShadow) {
        // Aim the shadow box at the middle of what this camera sees (a bit ahead of the kart).
        const fwd = v.chase.camera.getWorldDirection(new THREE.Vector3());
        followWithSun(this.sun, v.kart.pose.x + fwd.x * 22, v.kart.pose.z + fwd.z * 22, 55);
        this.renderer.shadowMap.needsUpdate = true;
      }
      this.pipeline.renderView(this.scene, v.chase.camera, r.x, r.y, r.w, r.h);

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
          item: items.displayFor(v.slot),
        },
        this.elapsed,
      );
    }
    this.pipeline.endFrame(); // bloom + colour grade + tone mapping, once for all viewports

    this.minimap.draw(
      race.standings().map((slot) => {
        const v = this.views.find((x) => x.slot === slot)!;
        const p = this.players.slots.slots[slot];
        return { x: v.kart.pose.x, z: v.kart.pose.z, color: colorHex(p?.color ?? slot), label: `P${slot + 1}` };
      }),
    );

    // Phone minimap: everyone's position ~8x per second.
    this.mapTimer += dt;
    if (this.mapTimer >= 0.125) {
      this.mapTimer = 0;
      const d: number[] = [];
      for (const [slot, k] of this.world.karts) d.push(slot, Math.round(k.pos.x * 10) / 10, Math.round(k.pos.z * 10) / 10);
      this.players.broadcast({ t: 'map', d });
    }

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
          break;
        case 'stall':
          this.haptic(e.slot, HAPTICS.stall);
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
          // Only the final lap gets a banner; the lap counter covers the rest.
          if (e.lap + 1 === this.track.def.laps) this.toast(e.slot, 'FINAL LAP!', 1.5);
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
          break;
        case 'cannonFire':
          this.haptic(e.slot, HAPTICS.cannonFire);
          this.cannonView?.fire(e.cannon);
          break;
        case 'cannonLand':
          this.haptic(e.slot, HAPTICS.cannonLand);
          break;
        case 'respawn':
          this.haptic(e.slot, HAPTICS.respawn);
          this.players.sendTo(e.slot, { t: 'drift', tier: null });
          break;
        case 'itemBox':
          this.sendStatus(); // roulette starts on the phone right away
          break;
        case 'itemGet':
          this.haptic(e.slot, HAPTICS.itemGet);
          this.sendStatus();
          break;
        case 'itemUse':
          this.haptic(e.slot, HAPTICS.itemUse);
          this.sendStatus();
          break;
        case 'hit': {
          this.haptic(e.slot, e.by === 'nova' ? HAPTICS.novaHit : HAPTICS.spunOut);
          this.players.sendTo(e.slot, { t: 'drift', tier: null });
          if (e.attacker !== null && e.attacker !== e.slot) this.toast(e.attacker, `HIT ${this.nameOf(e.slot)}!`, 1.2);
          this.sendStatus();
          break;
        }
        case 'blocked':
          this.haptic(e.slot, HAPTICS.itemUse);
          break;
        case 'jumbled':
          this.haptic(e.slot, HAPTICS.spunOut);
          this.viewOf(e.slot)?.hud.showInk(ITEMS.jumbleTime);
          break;
      }
    }
  }

  private nameOf(slot: number): string {
    return (this.players.slots.slots[slot]?.name ?? `P${slot + 1}`).toUpperCase();
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
        item: this.world.items?.displayFor(slot) ?? { kind: 'none' },
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
    this.pipeline.resize();
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
