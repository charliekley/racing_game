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
import { BotPack, DEFAULT_DIFFICULTY, type Difficulty } from '../sim/bots';
import { ITEMS, KART, SIM_DT } from '../sim/config';
import { ITEM_IDS, type ItemId } from '../sim/items/types';
import { FixedStepLoop } from '../sim/loop';
import { Track } from '../sim/track';
import { World, type WorldEvent } from '../sim/world';
import { TRACKS, type TrackDef } from '../track';
import { ChaseCamera, newCameraState } from '../render/chaseCamera';
import { GameFx } from '../render/fx/gameFx';
import { Flyover, introWanted } from '../render/fx/intro';
import { buildResults, type ResultRow } from './resultsView';
import { setKartDetail } from '../render/kartModel';
import { KartView } from '../render/kartView';
import { CHARACTERS, DEFAULT_LOADOUT, KART_BODIES, sanitizeLoadout } from '../shared/characters';
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
// AUDIO: sound engine (src/audio). Created in main.ts and handed over via `game.audio`.
import { musicForTrack, panForRect, type AudioEngine, type KartAudioState } from '../audio';

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
  /** Results screen buttons (the keyboard keys are handled in main.ts). */
  onRaceAgain?(): void;
  onChangeTrack?(): void;
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
  /** How good the computer drivers are (set from the lobby by main.ts before `start`). */
  botDifficulty: Difficulty = DEFAULT_DIFFICULTY;
  /** The computer drivers of the current race (see sim/bots.ts). */
  private bots = new BotPack();
  /**
   * Set when the sim reports two karts finishing within a fraction of a second ("photo finish").
   * Nothing uses it yet: a slow-motion replay could read it (and reset it) later.
   */
  photoFinish = false;
  /** AUDIO: set by main.ts; null = silent (every use below is optional-chained). */
  audio: AudioEngine | null = null;
  private itemPool: ItemMeshPool;
  // --- Game feel (see src/render/fx/*) ---
  /** All particles, skid marks and one-shot bursts. */
  private fx: GameFx;
  /** The pre-race camera flyover (skipped with ?drive unless ?intro=1). */
  private flyover = new Flyover();
  private camState = newCameraState();
  private introTitle: HTMLElement | null = null;
  /** Was each item box active last frame? (to spot the moment one is smashed) */
  private boxWasActive: boolean[] = [];
  /** Launch cannons of the current track (rebuilt for every race). */
  private cannonView: CannonView | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly players: PlayerManager,
    private readonly callbacks: GameCallbacks,
    quality: QualitySettings,
  ) {
    setKartDetail(quality.name === 'Low' ? 'low' : 'high'); // kart-models: cheaper kart meshes on Low (applies to karts built from now on)
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
    this.fx = new GameFx(this.scene, quality);
    this.fx.setTheme(this.track.def.theme.offroad);
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
    // Space / Enter skips the intro flyover.
    window.addEventListener('keydown', (e) => {
      if (this.flyover.active && (e.code === 'Space' || e.code === 'Enter')) this.endIntro();
    });
  }

  /**
   * Switch to another track (from the lobby's track picker). Rebuilds the sim
   * Track, its 3D view and the minimap; takes effect at the next start().
   */
  setTrack(def: TrackDef): void {
    if (def === this.track.def) return;
    applyTheme(this.scene, def.theme, this.renderer, this.quality.envSize); // sky, fog, lights and reflections follow the track
    this.fx.setTheme(def.theme.offroad); // dust takes the off-road colour
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
    setKartDetail(q.name === 'Low' ? 'low' : 'high'); // kart-models: used by karts built from now on
    const envChanged = q.envSize !== this.quality.envSize;
    this.quality = q;
    applyRendererQuality(this.renderer, q);
    this.pipeline.setQuality(q);
    if (envChanged) applyTheme(this.scene, this.track.def.theme, this.renderer, q.envSize);
    applySceneQuality(this.scene, this.sun, q);
    this.fx.setQuality(q);
    this.resize();
  }

  /** Start a new race with a kart and a viewport for each slot. */
  start(slots: number[]): void {
    for (const v of this.views) {
      v.kart.dispose(this.scene);
      v.hud.dispose();
    }
    this.world = new World(this.track, this.track);
    // Classes: each slot's character + kart body decides its physics (sim/classes.ts) and its look.
    const loadouts = new Map(slots.map((slot) => [slot, this.players.slots.slots[slot]?.loadout ?? DEFAULT_LOADOUT] as const));
    this.world.startRace(slots, this.track.def.laps, loadouts);
    this.bots = new BotPack(this.botDifficulty, (slot) => !this.players.isBot(slot));
    this.photoFinish = false;

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
      return { slot, kart: new KartView(this.scene, color, loadouts.get(slot)), chase, hud, rect: layout.views[i] };
    });
    this.minimap.place(layout.minimap);

    // Phones draw a minimap: send them the track outline (about 12 m between points) plus the rich map data, once.
    const pts: number[] = [];
    for (let i = 0; i < this.track.samples.length; i += 6) {
      pts.push(Math.round(this.track.samples[i].x * 10) / 10, Math.round(this.track.samples[i].z * 10) / 10);
    }
    this.players.setTrackMessage({ t: 'track', pts, w: this.track.def.width, map: this.minimap.data });

    // Fresh effects, and the intro flyover (it holds the countdown back until it is over).
    this.fx.reset();
    this.boxWasActive = this.world.items!.boxes.map((b) => b.active);
    this.endIntro();
    if (introWanted(location.search)) this.beginIntro();

    this.loop.reset();
    this.resultsShown = false;
    this.doneAt = null;
    this.lastCountdown = 0;
    this.lastStatus.clear();
    this.results.classList.add('hidden');
    this.resize();
    // AUDIO: this track's tune (normal tempo), engines are created on the first frame.
    this.audio?.setFinalLap(false);
    this.audio?.playMusic(musicForTrack(this.track.def.name, TRACKS.indexOf(this.track.def)));
  }

  /** Bots drive themselves; everyone else uses their controller. */
  private inputFor(slot: number): ControlInput {
    if (this.players.isBot(slot)) {
      if (this.world.karts.has(slot)) return this.bots.input(this.world, slot);
    }
    return this.players.inputFor(slot);
  }

  /** Called every animation frame while a race is on screen. */
  frame(dt: number): void {
    this.elapsed += dt;
    // While the intro flyover plays the simulation is paused (karts wait on the grid).
    if (this.flyover.tick(dt)) this.endIntro();
    const intro = this.flyover.active;
    const alpha = intro ? 1 : this.loop.advance(dt);
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
    // Effects tied to items: a box smashes into confetti the moment it deactivates; shots leave trails.
    items.boxes.forEach((b, i) => {
      if (this.boxWasActive[i] && !b.active) this.fx.shatterBox(b.x, b.y + 1, b.z);
      this.boxWasActive[i] = b.active;
    });
    for (const e of items.entityList) if (e.kind !== 'slick') this.fx.itemTrail(e.kind, e.x, e.y, e.z, e.heading);

    // Update every kart's interpolated pose, then each player's camera.
    let cx = 0;
    let cz = 0;
    for (const v of this.views) {
      const ist = items.states.get(v.slot);
      // A dragged shot shows behind the kart (a dragged Slick is its own world object).
      v.kart.trailingItem = ist?.trailing && ist.held && ist.held.id !== 'slick' ? ist.held.id : null;
      v.kart.update(this.world.prevKarts.get(v.slot)!, this.world.karts.get(v.slot)!, alpha, dt, this.track);
      this.fx.kartTick(v.slot, v.kart, this.world.karts.get(v.slot)!, dt); // smoke, sparks, skid marks, flames...
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
    if (race.phase === 'countdown' && !intro) {
      const n = Math.max(1, Math.ceil(-race.time));
      if (n !== this.lastCountdown) {
        this.lastCountdown = n;
        this.audio?.countdown(n); // AUDIO: 3-2-1 beeps
        for (const v of this.views) v.hud.toast(String(n), 1, this.elapsed, 'count');
      }
    }
    this.fx.update(dt);

    // AUDIO: engine / drift-squeal / roulette loops follow every kart (bots included, quieter).
    if (this.audio) {
      this.audio.update(
        dt,
        this.views.map((v): KartAudioState => {
          const k = this.world.karts.get(v.slot)!;
          return {
            slot: v.slot,
            human: !this.players.isBot(v.slot),
            speed: k.speed,
            boosting: k.boostTime > 0,
            grounded: k.grounded,
            drift: k.driftDir !== 0 ? 1 + k.driftTier : 0,
            silent: !!k.flight || k.respawnTime > 0,
            rolling: (items.states.get(v.slot)?.roulette ?? 0) > 0,
            pan: panForRect(v.rect),
          };
        }),
      );
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
      const racer = race.racers.get(v.slot)!;
      // Tell the camera what the kart is doing: it kicks the FOV, widens in the air, orbits at the finish...
      const cs = this.camState;
      cs.boosting = kart.boostTime > 0;
      cs.grounded = kart.grounded;
      cs.flightPhase = kart.flight?.phase ?? null;
      cs.finished = racer.finished;
      cs.driftDir = kart.driftDir;
      v.chase.update(v.kart.pose, dt, cs, ground);
      if (intro) this.flyover.apply(v.chase.camera, this.track, v.slot);
      if (!sharedShadow) {
        // Aim the shadow box at the middle of what this camera sees (a bit ahead of the kart).
        const fwd = v.chase.camera.getWorldDirection(new THREE.Vector3());
        followWithSun(this.sun, v.kart.pose.x + fwd.x * 22, v.kart.pose.z + fwd.z * 22, 55);
        this.renderer.shadowMap.needsUpdate = true;
      }
      this.fx.beginView(v.chase.camera, r.h * this.renderer.getPixelRatio()); // particle sizes depend on camera + viewport
      this.pipeline.renderView(this.scene, v.chase.camera, r.x, r.y, r.w, r.h);

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
          driftCharge: kart.driftCharge / KART.driftTier2,
          driftTier: kart.driftTier,
          drifting: kart.driftDir !== 0 && kart.grounded,
          speedFx: v.chase.speedFx,
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
      this.audio?.results(); // AUDIO: fanfare + results loop
      this.callbacks.onResults();
    }
  }

  /** Start the pre-race flyover: hide the HUD and show the track name. */
  private beginIntro(): void {
    this.flyover.start();
    this.hudLayer.classList.add('intro');
    const t = document.createElement('div');
    t.className = 'intro-title';
    t.textContent = this.track.def.name.toUpperCase(); // textContent: never treat strings as HTML
    const sub = document.createElement('small');
    sub.textContent = `${this.track.def.laps} laps · Space to skip`;
    t.appendChild(sub);
    this.hudLayer.appendChild(t);
    this.introTitle = t;
  }

  /** Stop the flyover (it ended, or was skipped) so the countdown can begin. */
  private endIntro(): void {
    this.flyover.skip();
    this.hudLayer.classList.remove('intro');
    this.introTitle?.remove();
    this.introTitle = null;
  }

  private viewOf(slot: number): PlayerView | undefined {
    return this.views.find((v) => v.slot === slot);
  }

  private toast(slot: number, text: string, seconds: number): void {
    this.viewOf(slot)?.hud.toast(text, seconds, this.elapsed);
  }

  /** Camera shake for one player's view (0..1). */
  private shake(slot: number, amount: number): void {
    this.viewOf(slot)?.chase.addTrauma(amount);
  }

  /** Visual + camera reactions to a sim event (particles, shake, flashes). Haptics are handled in handleEvents. */
  private reactFx(e: WorldEvent): void {
    // Events that carry a player slot get the kart's position for their effects.
    if (!('slot' in e)) {
      if (e.kind === 'itemDestroyed') this.fx.itemPop(e.x, (this.track.sample(e.x, e.z)?.height ?? 0) + 0.2, e.z);
      return;
    }
    const v = this.viewOf(e.slot);
    if (!v) return;
    const p = v.kart.pose;
    const st = this.world.karts.get(e.slot);
    switch (e.kind) {
      case 'startBoost':
        this.fx.boostBurst(p.x, p.y, p.z, p.heading);
        v.hud.flash('boost');
        this.shake(e.slot, 0.25);
        break;
      case 'boostPad':
        this.fx.boostBurst(p.x, p.y, p.z, p.heading);
        v.hud.flash('boost');
        break;
      case 'miniTurbo':
        this.fx.miniTurbo(p.x, p.y, p.z, p.heading, e.tier);
        v.hud.flash('boost');
        this.shake(e.slot, 0.12 + 0.08 * e.tier);
        break;
      case 'trick':
        this.fx.trickRing(p.x, p.y, p.z);
        break;
      case 'slipCharge':
        if (e.progress > 0) this.fx.windStreaks(p.x, p.y, p.z, p.heading, e.progress);
        break;
      case 'slipBoost':
        this.fx.slipBoost(p.x, p.y, p.z, p.heading);
        v.hud.flash('boost');
        this.shake(e.slot, 0.15);
        break;
      case 'combo':
        this.fx.trickRing(p.x, p.y, p.z);
        this.fx.boostBurst(p.x, p.y, p.z, p.heading);
        break;
      case 'perfectStart':
        this.fx.pickup(p.x, p.y, p.z);
        break;
      case 'trickBoost':
        this.fx.boostBurst(p.x, p.y, p.z, p.heading);
        v.hud.flash('boost');
        break;
      case 'land':
        // Little hops land softly; real jumps puff dust and shake the camera.
        if (e.fallSpeed > 4) {
          this.fx.landDust(p.x, p.y, p.z, e.fallSpeed, st?.surface === 'offroad');
          this.shake(e.slot, Math.min(0.55, 0.1 + e.fallSpeed * 0.02));
        }
        break;
      case 'wall':
        this.fx.wallSparks(p.x, p.y, p.z, p.heading, e.impact);
        this.shake(e.slot, Math.min(0.6, e.impact / 25));
        break;
      case 'kart':
        if (e.impact > 2) {
          this.fx.bump(p.x, p.y, p.z);
          this.shake(e.slot, Math.min(0.35, e.impact / 25));
        }
        break;
      case 'hit':
        this.fx.hit(p.x, p.y, p.z);
        v.hud.flash('hit');
        this.shake(e.slot, 0.8);
        break;
      case 'blocked':
        this.fx.itemPop(p.x, p.y + 0.4, p.z);
        this.shake(e.slot, 0.2);
        break;
      case 'itemBox':
        this.fx.pickup(p.x, p.y, p.z);
        break;
      case 'itemGet':
        v.hud.flash('item');
        break;
      case 'itemUse':
        if (e.id === 'dash') {
          this.fx.boostBurst(p.x, p.y, p.z, p.heading);
          v.hud.flash('boost');
        } else if (e.id === 'nova') {
          this.fx.pickup(p.x, p.y, p.z);
        }
        break;
      case 'cannonFire':
        // The muzzle blast itself is spawned by CannonView.fire(); here only the camera reacts.
        this.shake(e.slot, 0.6);
        break;
      case 'cannonLand':
        this.fx.landDust(p.x, p.y, p.z, 20, st?.surface === 'offroad');
        this.shake(e.slot, 0.5);
        break;
      case 'respawn': {
        // The kart already teleported to the carrier; the previous tick's pose is where it fell.
        const prev = this.world.prevKarts.get(e.slot);
        const open = this.track.def.scenery.openSky === true; // sky-island tracks have a void, not water
        if (prev && !open) {
          const road = this.track.project(prev.pos.x, prev.pos.z, prev.trackIndex);
          this.fx.splash(prev.pos.x, road.y - 1.5, prev.pos.z);
        }
        break;
      }
      case 'finish':
        this.fx.finishConfetti(p.x, p.y, p.z);
        v.hud.flash('item');
        break;
    }
  }

  private handleEvents(events: WorldEvent[]): void {
    // AUDIO: one call turns every event into sounds (mapping lives in src/audio/mapping.ts).
    this.audio?.handleEvents(events, { isHuman: (s) => !this.players.isBot(s), totalLaps: this.track.def.laps });
    for (const e of events) {
      this.reactFx(e);
      switch (e.kind) {
        case 'go':
          for (const v of this.views) {
            v.hud.toast('GO!', 1, this.elapsed, 'go');
            v.hud.flash('boost');
          }
          this.callbacks.onGo();
          break;
        case 'startBoost':
          this.haptic(e.slot, HAPTICS.startBoost);
          break;
        case 'perfectStart':
          // A short banner (the centre toast is busy saying GO!).
          this.viewOf(e.slot)?.hud.showBanner('PERFECT START!', 1.4, this.elapsed);
          break;
        case 'slipBoost':
          this.haptic(e.slot, HAPTICS.boost);
          break;
        case 'combo':
          this.toast(e.slot, 'COMBO!', 1.1);
          this.haptic(e.slot, HAPTICS.miniTurbo);
          break;
        case 'photoFinish':
          this.photoFinish = true; // not used yet: see the field's comment
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
          if (e.lap + 1 === this.track.def.laps) {
            this.viewOf(e.slot)?.hud.showBanner('FINAL LAP!', 1.9, this.elapsed);
            if (!this.players.isBot(e.slot)) this.audio?.setFinalLap(true); // AUDIO: music 15% faster
          }
          break;
        }
        case 'finish':
          this.haptic(e.slot, HAPTICS.finish);
          this.viewOf(e.slot)?.hud.toast(`FINISH! ${e.place}${ordinalSuffix(e.place)}`, 30, this.elapsed, 'finish');
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
      const best = r.lapTimes.length ? Math.min(...r.lapTimes) : Infinity;
      const loadout = sanitizeLoadout(p?.loadout);
      const row: ResultRow = {
        place: r.place ?? 0,
        name: p?.name ?? `P${slot + 1}`,
        color: colorHex(p?.color ?? slot),
        loadoutText: `${CHARACTERS[loadout.character].name} · ${KART_BODIES[loadout.kart].name}`,
        time: r.finished ? formatTime(r.finishTime!) : 'DNF',
        best: Number.isFinite(best) ? formatTime(best) : '–',
        fastest: false,
        finished: r.finished,
      };
      return { row, best };
    });
    rows.sort((a, b) => a.row.place - b.row.place);
    // Mark the single fastest lap of the race.
    const fastest = Math.min(...rows.map((r) => r.best));
    if (Number.isFinite(fastest)) rows.find((r) => r.best === fastest)!.row.fastest = true;
    buildResults(
      this.results,
      rows.map((r) => r.row),
      this.track.def.name,
      { raceAgain: () => this.callbacks.onRaceAgain?.(), changeTrack: () => this.callbacks.onChangeTrack?.() },
    );
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
