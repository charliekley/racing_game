/**
 * One race on the host: owns the sim World, the Three.js scene and the
 * fixed-step loop, and turns sim events into HUD updates, phone status
 * messages and haptics. (Single chase camera for now; split-screen in M4 —
 * press C to follow a different player.)
 */
import * as THREE from 'three';
import { colorHex } from '../shared/colors';
import type { HostToController } from '../shared/protocol';
import { SIM_DT } from '../sim/config';
import { FixedStepLoop } from '../sim/loop';
import { Track } from '../sim/track';
import { World, type WorldEvent } from '../sim/world';
import { TRACKS } from '../track';
import { ChaseCamera } from '../render/chaseCamera';
import { KartView } from '../render/kartView';
import { createRenderer, createScene, followWithSun } from '../render/scene';
import { TrackView } from '../render/trackView';
import type { PlayerManager } from './playerManager';

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
} as const;

export interface GameCallbacks {
  /** Countdown finished, racing has begun. */
  onGo(): void;
  /** Race over and the results screen is up. */
  onResults(): void;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private sun: THREE.DirectionalLight;
  private track: Track;
  private trackView: TrackView;
  private world: World;
  private views = new Map<number, KartView>();
  private chase = new ChaseCamera();
  private loop: FixedStepLoop;
  private followIndex = 0;
  private elapsed = 0;
  private resultsShown = false;
  private doneAt: number | null = null;
  private statusTimer = 0;
  private lastStatus = new Map<number, string>();
  private toastUntil = 0;

  // HUD elements
  private hud: HTMLElement;
  private el: Record<'pos' | 'posSuffix' | 'lap' | 'time' | 'center' | 'speed' | 'help' | 'results', HTMLElement>;

  constructor(
    private readonly container: HTMLElement,
    private readonly players: PlayerManager,
    private readonly callbacks: GameCallbacks,
  ) {
    this.renderer = createRenderer(container);
    const parts = createScene();
    this.scene = parts.scene;
    this.sun = parts.sun;
    this.track = new Track(TRACKS[0]);
    this.trackView = new TrackView(this.track);
    this.scene.add(this.trackView.group);
    this.world = new World(this.track, this.track);
    this.loop = new FixedStepLoop(() => this.handleEvents(this.world.tick((slot) => this.players.inputFor(slot))), SIM_DT);

    this.hud = document.createElement('div');
    this.hud.className = 'race-hud';
    this.hud.innerHTML = `
      <div class="hud-pos"><span class="pos-num"></span><span class="pos-suffix"></span></div>
      <div class="hud-topright"><div class="hud-lap"></div><div class="hud-time"></div></div>
      <div class="hud-center"></div>
      <div class="hud-speed"></div>
      <div class="hud-help">C: switch camera · Esc: lobby</div>
      <div class="results hidden"></div>`;
    container.appendChild(this.hud);
    const q = (sel: string) => this.hud.querySelector(sel) as HTMLElement;
    this.el = {
      pos: q('.pos-num'),
      posSuffix: q('.pos-suffix'),
      lap: q('.hud-lap'),
      time: q('.hud-time'),
      center: q('.hud-center'),
      speed: q('.hud-speed'),
      help: q('.hud-help'),
      results: q('.results'),
    };

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC' && this.views.size > 0) {
        this.followIndex = (this.followIndex + 1) % this.views.size;
        this.chase.snap();
      }
    });
    this.resize();
  }

  /** Start a new race with a kart for each slot, on the starting grid. */
  start(slots: number[]): void {
    for (const v of this.views.values()) v.dispose(this.scene);
    this.views.clear();
    this.world = new World(this.track, this.track);
    this.world.startRace(slots, this.track.def.laps);
    for (const slot of slots) {
      const color = this.players.slots.slots[slot]?.color ?? slot;
      this.views.set(slot, new KartView(this.scene, colorHex(color)));
    }
    this.followIndex = 0;
    this.chase.snap();
    this.loop.reset();
    this.resultsShown = false;
    this.doneAt = null;
    this.lastStatus.clear();
    this.el.results.classList.add('hidden');
    this.el.center.textContent = '';
    this.resize();
  }

  /** Called every animation frame while a race is on screen. */
  frame(dt: number): void {
    this.elapsed += dt;
    const alpha = this.loop.advance(dt);
    for (const [slot, view] of this.views) {
      view.update(this.world.prevKarts.get(slot)!, this.world.karts.get(slot)!, alpha, dt, this.track);
    }
    this.trackView.update(this.elapsed);

    const followSlot = [...this.views.keys()][this.followIndex];
    const view = followSlot === undefined ? undefined : this.views.get(followSlot);
    if (view) {
      const kart = this.world.karts.get(followSlot!)!;
      this.chase.update(view.pose, dt, kart.boostTime > 0 ? 10 : 0);
      followWithSun(this.sun, view.pose.x, view.pose.z);
      this.updateHud(followSlot!, view);
    }
    this.renderer.render(this.scene, this.chase.camera);

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

  private handleEvents(events: WorldEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case 'go':
          this.toast('GO!', 1);
          this.callbacks.onGo();
          break;
        case 'startBoost':
          this.haptic(e.slot, HAPTICS.startBoost);
          if (this.isFollowed(e.slot)) this.toast('ROCKET START!', 1.2);
          break;
        case 'stall':
          this.haptic(e.slot, HAPTICS.stall);
          if (this.isFollowed(e.slot)) this.toast('Too early!', 1.2);
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
          if (this.isFollowed(e.slot)) this.toast(e.lap + 1 === laps ? 'FINAL LAP!' : `LAP ${e.lap + 1}`, 1.5);
          break;
        }
        case 'finish':
          this.haptic(e.slot, HAPTICS.finish);
          if (this.isFollowed(e.slot)) this.toast(`FINISH! ${e.place}${ordinalSuffix(e.place)}`, 3);
          break;
        case 'done':
          this.doneAt = this.elapsed;
          break;
      }
    }
  }

  private isFollowed(slot: number): boolean {
    return [...this.views.keys()][this.followIndex] === slot;
  }

  private haptic(slot: number, pattern: readonly number[]): void {
    this.players.sendTo(slot, { t: 'haptic', pattern: [...pattern] });
  }

  private toast(text: string, seconds: number): void {
    this.el.center.textContent = text;
    this.el.center.className = 'hud-center pop';
    void this.el.center.offsetWidth; // restart the CSS animation
    this.el.center.className = 'hud-center pop show';
    this.toastUntil = this.elapsed + seconds;
  }

  private updateHud(slot: number, view: KartView): void {
    const race = this.world.race!;
    const racer = race.racers.get(slot)!;
    const laps = race.totalLaps;
    const pos = racer.place ?? race.positionOf(slot);
    this.hud.style.setProperty('--slot-color', colorHex(this.players.slots.slots[slot]?.color ?? 0));
    this.el.pos.textContent = String(pos);
    this.el.posSuffix.textContent = ordinalSuffix(pos);
    this.el.lap.innerHTML = `LAP <b>${Math.min(laps, Math.max(1, racer.lap))}</b>/${laps}`;
    const t = racer.finishTime ?? race.time;
    this.el.time.textContent = formatTime(Math.max(0, t));
    this.el.speed.innerHTML = `<b>${Math.round(Math.abs(view.pose.speed) * 3.6)}</b> km/h`;

    // Countdown numbers (overrides toasts).
    if (race.phase === 'countdown') {
      const n = Math.ceil(-race.time);
      const text = String(Math.max(1, n));
      if (this.el.center.textContent !== text) this.toast(text, 1);
    } else if (this.elapsed > this.toastUntil) {
      this.el.center.className = 'hud-center';
    }
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
      return { place: r.place ?? 0, name: p?.name ?? `P${slot + 1}`, color: colorHex(p?.color ?? slot), time: r.finished ? formatTime(r.finishTime!) : 'DNF', best: best === null ? '–' : formatTime(best) };
    });
    rows.sort((a, b) => a.place - b.place);
    const table = document.createElement('div');
    table.className = 'results-box';
    table.innerHTML = `<h2>Results</h2><table><thead><tr><th></th><th>Racer</th><th>Time</th><th>Best lap</th></tr></thead><tbody></tbody></table>
      <p class="results-help">Tap <b>RACE AGAIN</b> on your phones (or press <kbd>Enter</kbd>) · <kbd>Esc</kbd> back to lobby</p>`;
    const tbody = table.querySelector('tbody')!;
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="place">${row.place}${ordinalSuffix(row.place)}</td><td class="name"><span class="dot"></span><span class="n"></span></td><td>${row.time}</td><td>${row.best}</td>`;
      (tr.querySelector('.dot') as HTMLElement).style.background = row.color;
      tr.querySelector('.n')!.textContent = row.name; // names come from phones: textContent only
      tbody.appendChild(tr);
    }
    this.el.results.replaceChildren(table);
    this.el.results.classList.remove('hidden');
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.chase.setAspect(w / h);
  }
}
