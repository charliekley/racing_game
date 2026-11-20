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
import { DEFAULT_RACERS, attackToast, fillBotColors, fillBotName, fillBotSlots, isFillBot, slotColor, type RacerCount } from './raceSettings'; // RACERS
import type { ControlInput, HostToController } from '../shared/protocol';
import { BotPack, DEFAULT_DIFFICULTY, type Difficulty } from '../sim/bots';
import { botLoadoutFor } from '../sim/classes';
import { ITEMS, KART, SIM_DT } from '../sim/config';
import { ITEM_IDS, type ItemId } from '../sim/items/types';
import { FixedStepLoop } from '../sim/loop';
import { knockoutLaps } from '../sim/knockout';
import { Track } from '../sim/track';
import { World, type WorldEvent } from '../sim/world';
import { TRACKS, type TrackDef } from '../track';
import { ChaseCamera, newCameraState } from '../render/chaseCamera';
import { GameFx } from '../render/fx/gameFx';
import { Flyover, introWanted } from '../render/fx/intro';
import { buildResults, type ResultRow, type ResultsExtras } from './resultsView';
import type { Placing } from './series';
import { setKartDetail, type KartDetail } from '../render/kartModel';
import { KartView } from '../render/kartView';
import { reactionsForEvent, tailgateSide, type FaceContext } from '../render/kart/expression';
import { CHARACTERS, DEFAULT_LOADOUT, KART_BODIES, sanitizeLoadout } from '../shared/characters';
import { ItemMeshPool, animateItemBox, buildEntityMesh, buildHeldItemMesh, buildItemBox } from '../render/itemMeshes';
import { splitLayout, toViewport, type Rect } from '../render/layout';
import { CannonView } from '../render/cannonView';
import { HazardViews } from '../render/hazards';
import { Minimap, type MapDot } from '../render/minimap';
import {
  applyRendererQuality,
  applyTheme,
  applySceneQuality,
  setShadowMapSize,
  createRenderer,
  createScene,
  followWithSun,
  type QualitySettings,
} from '../render/scene';
import { RenderPipeline } from '../render/post/pipeline';
import { AdaptiveQuality } from '../render/adaptive';
import { envQuality } from '../render/env/batch';
import { TrackView } from '../render/trackView';
import { disposeObject } from '../render/dispose';
import type { PlayerManager } from './playerManager';
import { ViewHud, type HudState } from './viewHud';
import { PhotoFinishFx, worthSlowMotion } from './photoFinish';
import { WrongWayDetector, speedAlongTrack } from './wrongWay';
import type { ItemDisplay } from '../shared/protocol';
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
  wrongWay: [80, 60, 80],
} as const;

export interface GameCallbacks {
  /** Countdown finished, racing has begun. */
  onGo(): void;
  /** Race over and the results screen is up. */
  onResults(): void;
  /** Results screen buttons (the keyboard keys are handled in main.ts). */
  onRaceAgain?(): void;
  onChangeTrack?(): void;
  /**
   * The race just ended: hands over who finished where (every racer, best first). main.ts feeds it to the
   * Grand Prix / Loser-picks series and may return extra results content (points, standings, button labels).
   */
  onRaceResults?(placings: Placing[]): ResultsExtras | undefined;
  /** Adaptive quality: frames stay too slow even at the lowest render scale, so main.ts should drop one preset. */
  onQualityStepDown?(): void;
}

/** A computer driver that fills the grid up to the RACERS count (slot 4 and up): a kart with no screen, HUD or camera of its own. */
interface BotKart {
  slot: number;
  kart: KartView;
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
  /** Watches real frame times and lowers the render scale (then the preset) to hold 60 fps. */
  readonly adaptive: AdaptiveQuality;
  private scene: THREE.Scene;
  private sun: THREE.DirectionalLight;
  private track: Track;
  private trackView: TrackView;
  private world: World;
  private views: PlayerView[] = [];
  /** RACERS: the fill-in bots of this race (see raceSettings.ts); their colours are picked at the start of every race. */
  private botKarts: BotKart[] = [];
  private fillColors = new Map<number, string>();
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
  /** The glow shell of each item box (hidden when the box is not close). */
  private boxShells: (THREE.Object3D | undefined)[] = [];
  /**
   * Practice/testing aid (URL `?give=nova`): everyone gets an endless supply of
   * this item (or "random" = random item each time). Null = normal item boxes only.
   */
  devItem: ItemId | 'random' | null = null;
  /** How good the computer drivers are (set from the lobby by main.ts before `start`). */
  botDifficulty: Difficulty = DEFAULT_DIFFICULTY;
  /** RACERS setting (set from the lobby by main.ts before `start`): bots fill the grid up to this many karts. */
  racers: RacerCount = DEFAULT_RACERS;
  /** The computer drivers of the current race (see sim/bots.ts). */
  private bots = new BotPack();
  /** Set when the sim reports two karts finishing within a fraction of a second ("photo finish"); the slow-motion moment itself is `photo`. */
  photoFinish = false;
  /** Photo-finish slow motion (timing only, see photoFinish.ts). Its time scale feeds the fixed-step loop, never the sim. */
  readonly photo = new PhotoFinishFx();
  /** Only one photo-finish moment per race. */
  private photoPlayed = false;
  /** WRONG WAY detectors, one per human kart (see wrongWay.ts), and the slots whose sign is showing. */
  private readonly wrongWay = new Map<number, WrongWayDetector>();
  private readonly wrongWayShown = new Set<number>();
  // --- Knockout mode (see sim/knockout.ts) ---
  /** Set by main.ts before `start`: play a Knockout race (more laps, the last kart is out after every lap). */
  knockout = false;
  /** AUDIO: set by main.ts; null = silent (every use below is optional-chained). */
  audio: AudioEngine | null = null;
  private itemPool: ItemMeshPool;
  // --- Game feel (see src/render/fx/*) ---
  /** All particles, skid marks and one-shot bursts. */
  private fx: GameFx;
  /** The pre-race camera flyover (skipped with ?drive unless ?intro=1). */
  private flyover = new Flyover();
  /** Camera for the full-screen intro (with several players there is no single chase camera to borrow). */
  private readonly introCam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
  /** The whole canvas as a viewport rect (the intro is drawn full screen). */
  private static readonly FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private camState = newCameraState();
  private introTitle: HTMLElement | null = null;
  /** Was each item box active last frame? (to spot the moment one is smashed) */
  private boxWasActive: boolean[] = [];
  /** Scratch vectors reused every frame (creating objects in the render loop makes the garbage collector hitch). */
  private readonly sizeScratch = new THREE.Vector2();
  private readonly dirScratch = new THREE.Vector3();
  // PERF block: reusable containers for the per-frame lists below (see frame()), so the render loop allocates (almost) nothing.
  private readonly focusScratch: { x: number; z: number }[] = [];
  private readonly audioScratch: KartAudioState[] = [];
  private readonly dotScratch: MapDot[] = [];
  private readonly hudScratch: HudState = {
    position: 1, racers: 1, lap: 1, laps: 1, time: '', speedKmh: 0, boosting: false,
    item: { kind: 'none' } as ItemDisplay, driftCharge: 0, driftTier: 0, drifting: false, speedFx: 0,
  };
  /** Ground height lookup for the camera; one function for all views (`groundIndex` = the kart being followed). */
  private groundIndex = 0;
  private readonly groundHeight = (x: number, z: number): number | null => this.track.sample(x, z, this.groundIndex)?.height ?? null;
  /** Launch cannons of the current track (rebuilt for every race). */
  private cannonView: CannonView | null = null;
  /** Track hazards (lava geysers...) of the current track, rebuilt for every race. */
  private hazardViews: HazardViews | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly players: PlayerManager,
    private readonly callbacks: GameCallbacks,
    quality: QualitySettings,
  ) {
    setKartDetail(kartDetailFor(quality)); // cheaper kart meshes on Medium/Low (applies to karts built from now on)
    this.renderer = createRenderer(container, quality);
    this.quality = quality;
    envQuality.cheap = quality.name !== 'High'; // before the terrain is built: Medium/Low use a coarser grid
    this.track = new Track(TRACKS[0]);
    const parts = createScene(this.track.def.theme);
    this.scene = parts.scene;
    this.scene.matrixWorldAutoUpdate = false; // world matrices are updated once per frame in frame()
    this.sun = parts.sun;
    // Sky environment map for reflections + render pipeline (post-processing).
    applyTheme(this.scene, this.track.def.theme, this.renderer, quality.envSize);
    this.pipeline = new RenderPipeline(this.renderer, quality, this.track.def.theme);
    this.adaptive = new AdaptiveQuality({
      onScale: (scale) => this.applyRenderScale(scale),
      onStepDown: () => this.callbacks.onQualityStepDown?.(),
    });
    this.trackView = new TrackView(this.track);
    this.scene.add(this.trackView.group);
    this.itemPool = new ItemMeshPool(this.scene);
    applySceneQuality(this.scene, this.sun, quality);
    this.fx = new GameFx(this.scene, quality);
    this.fx.setTheme(this.track.def.theme.offroad);
    this.world = new World(this.track, this.track);
    this.loop = new FixedStepLoop(() => this.handleEvents([...this.world.tick((slot) => this.inputFor(slot)), ...this.bots.drainEvents()]), SIM_DT);
    // Knockout: a player who leaves is out of the race right away.
    this.players.onRemoved.add((slot) => this.world.race?.removeRacer(slot));

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
      if (this.photo.active && (e.code === 'Space' || e.code === 'Enter')) this.photo.skip(); // skip the photo-finish slow motion
    });
  }

  /**
   * Switch to another track (from the lobby's track picker). Rebuilds the sim
   * Track, its 3D view and the minimap; takes effect at the next start().
   */
  setTrack(def: TrackDef): void {
    if (def === this.track.def) return;
    envQuality.cheap = this.quality.name !== 'High';
    applyTheme(this.scene, def.theme, this.renderer, this.quality.envSize); // sky, fog, lights and reflections follow the track
    this.fx.setTheme(def.theme.offroad); // dust takes the off-road colour
    this.pipeline.setTheme(def.theme); // bloom / colour grade follow the track too
    this.scene.remove(this.trackView.group);
    disposeObject(this.trackView.group);
    this.minimap.dispose();
    this.cannonView?.dispose(this.scene);
    this.cannonView = null;
    this.hazardViews?.dispose();
    this.hazardViews = null;
    this.track = new Track(def);
    this.trackView = new TrackView(this.track);
    this.scene.add(this.trackView.group);
    this.minimap = new Minimap(this.track, this.hudLayer);
    this.world = new World(this.track, this.track);
  }

  setQuality(q: QualitySettings): void {
    setKartDetail(kartDetailFor(q)); // used by karts built from now on
    const envChanged = q.envSize !== this.quality.envSize;
    this.quality = q;
    this.adaptive.reset(1); // a new preset starts at full render scale and is measured afresh
    applyRendererQuality(this.renderer, q);
    this.applyViewScaling();
    this.pipeline.setQuality(q);
    if (envChanged) applyTheme(this.scene, this.track.def.theme, this.renderer, q.envSize);
    applySceneQuality(this.scene, this.sun, q, this.views.length);
    this.fx.setQuality(q);
    this.hazardViews?.setQuality(q);
    this.resize();
  }

  /** Adaptive quality asks for a different render scale (0.6..1 times the preset's own). */
  private applyRenderScale(scale: number): void {
    applyRendererQuality(this.renderer, this.quality, scale);
    this.resize();
  }

  /**
   * Scenery level-of-detail distances shrink with the preset and with the number of viewports:
   * in 4-way split each view is a quarter of the screen, so far props are only a few pixels.
   */
  private applyViewScaling(): void {
    const n = this.views.length;
    envQuality.lod = this.quality.lodScale * (n >= 3 ? 0.75 : n === 2 ? 0.9 : 1);
    setShadowMapSize(this.sun, this.quality, n); // shadow map size depends on the viewport count
  }

  /**
   * Item boxes are three see-through draws each: skip the ones too far away to read from this camera
   * (the range shrinks with the viewport count), and the glow shell of those that are not close.
   */
  private applyBoxRange(view: PlayerView): void {
    const n = this.views.length;
    const range = n >= 3 ? 70 : n === 2 ? 100 : 150;
    const cam = view.chase.camera.position;
    this.boxMeshes.forEach((m, i) => {
      const dx = m.position.x - cam.x;
      const dy = m.position.y - cam.y;
      const dz = m.position.z - cam.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      m.visible = this.boxWasActive[i] && d2 < range * range;
      const shell = this.boxShells[i];
      if (shell) shell.visible = d2 < 40 * 40;
    });
  }

  /**
   * Compile the shaders of everything that can show up during the race (the three item objects in the
   * world and in a kart's hand) while the countdown runs, so the first item use or drift does not stall
   * the frame while the browser compiles them. Three.js compiles in parallel in the background when
   * the GPU driver allows it.
   */
  private warmUp(): void {
    const camera = this.views[0]?.chase.camera;
    if (!camera) return;
    const temp = new THREE.Group();
    for (const kind of ['slick', 'ricochet', 'seeker', 'magnet', 'bumper'] as const) {
      temp.add(buildEntityMesh(kind));
      const held = buildHeldItemMesh(kind);
      if (held) temp.add(held);
    }
    this.scene.add(temp);
    const done = () => this.scene.remove(temp);
    this.pipeline.compileAsync(this.scene, camera).then(done, done);
  }

  /** PERF: hide the terrain tiles and scenery chunks that are beyond the fog distance for this camera (see TerrainView.cullToFog, env/fogCull.ts). */
  private cullTerrain(camera: THREE.Camera): void {
    const fog = this.scene.fog as THREE.Fog | null;
    if (!fog) return;
    this.trackView.terrainView.cullToFog(camera, fog.far);
    this.trackView.sceneryCull.cull(camera, fog.far);
  }

  /**
   * Before drawing viewport `view`: give every kart the model detail that suits its distance from this
   * camera. The kart you follow is always full detail; other karts drop to the reduced and then the far
   * model sooner the smaller the viewport is (4-way split: beyond ~9 m).
   */
  private applyKartLods(view: PlayerView): void {
    const n = this.views.length;
    const near = n === 1 ? 16 : n === 2 ? 10 : 0; // full detail up to here
    const mid = n === 1 ? 40 : n === 2 ? 28 : 9; // reduced detail up to here, far model beyond
    const lean = n >= 3; // PERF: in 3-4 way split even the full-detail kart only casts its body and torso shadow
    const cam = view.chase.camera.position;
    for (const other of this.views) {
      if (other === view) {
        other.kart.setLod(0, lean);
        continue;
      }
      const dx = other.kart.pose.x - cam.x;
      const dy = other.kart.pose.y - cam.y;
      const dz = other.kart.pose.z - cam.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      other.kart.setLod(d2 < near * near ? 0 : d2 < mid * mid ? 1 : 2, lean);
    }
    // Fill-in bots have no camera: the same distance rule, so bots far from this camera use the cheap far model.
    for (const b of this.botKarts) {
      const dx = b.kart.pose.x - cam.x;
      const dy = b.kart.pose.y - cam.y;
      const dz = b.kart.pose.z - cam.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      b.kart.setLod(d2 < near * near ? 0 : d2 < mid * mid ? 1 : 2, lean);
    }
  }

  /** Start a new race with a kart and a viewport for each slot. */
  start(slots: number[]): void {
    for (const v of this.views) {
      v.kart.dispose(this.scene);
      v.hud.dispose();
    }
    for (const b of this.botKarts) b.kart.dispose(this.scene);
    this.world = new World(this.track, this.track);
    // RACERS: bots without a screen fill the grid up to the chosen count (people and lobby bots keep slots 0..3, these use 4..11).
    const fill = fillBotSlots(slots.length, this.racers);
    const racing = [...slots, ...fill];
    this.fillColors = fillBotColors(
      slots.map((s) => colorHex(this.players.slots.slots[s]?.color ?? s)),
      fill,
    );
    // Classes: each slot's character + kart body decides its physics (sim/classes.ts) and its look.
    const loadouts = new Map(racing.map((slot) => [slot, this.players.slots.slots[slot]?.loadout ?? (isFillBot(slot) ? botLoadoutFor(slot) : DEFAULT_LOADOUT)] as const));
    // Knockout: more laps, and the sim runs the elimination rules (sim/knockout.ts).
    const laps = this.knockout ? knockoutLaps(this.track.def.laps, this.track.length, racing.length) : this.track.def.laps;
    this.world.startRace(racing, laps, loadouts, { knockout: this.knockout });
    this.bots = new BotPack(this.botDifficulty, (slot) => !this.isBot(slot));
    this.photoFinish = false;
    this.photo.skip();
    this.photoPlayed = false;
    this.wrongWay.clear();
    this.wrongWayShown.clear();

    // Launch cannons for this track (barrel, mouth glow, landing pad).
    this.cannonView?.dispose(this.scene);
    this.cannonView = this.track.cannons.length > 0 ? new CannonView(this.scene, this.track.cannons, this.track) : null;
    // Hazards (geysers...): the sim owns the rules (world.hazards), the views only draw them.
    this.hazardViews?.dispose();
    this.hazardViews = this.world.hazards ? new HazardViews(this.scene, this.world.hazards, this.quality) : null;

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
    this.boxShells = this.boxMeshes.map((m) => m.getObjectByName('shell'));

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
      // The slot colour is for the HUD badge and minimap; the kart itself is painted from the character's palette (KartView).
      return { slot, kart: new KartView(this.scene, color, loadouts.get(slot)), chase, hud, rect: layout.views[i] };
    });
    this.botKarts = fill.map((slot) => ({ slot, kart: new KartView(this.scene, slotColor(slot, undefined, this.fillColors), loadouts.get(slot)) }));
    this.minimap.place(layout.minimap);
    this.applyViewScaling();

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
    this.warmUp();

    this.loop.reset();
    this.adaptive.reset(this.adaptive.scale); // shader compiles and texture uploads at race start must not count as slowness
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

  /** Computer driver? Lobby bots (B) and the RACERS fill-in bots (slot 4 and up). */
  private isBot(slot: number): boolean {
    return isFillBot(slot) || this.players.isBot(slot);
  }

  /** The 3D kart of any racer, with or without a screen. */
  private kartViewOf(slot: number): KartView | undefined {
    return this.viewOf(slot)?.kart ?? this.botKarts.find((b) => b.slot === slot)?.kart;
  }

  /** Bots drive themselves; everyone else uses their controller. */
  private inputFor(slot: number): ControlInput {
    if (this.isBot(slot)) {
      if (this.world.karts.has(slot)) return this.bots.input(this.world, slot);
    }
    return this.players.inputFor(slot);
  }

  /** Called every animation frame while a race is on screen. */
  frame(dt: number): void {
    this.adaptive.frame(performance.now(), !this.resultsShown);
    this.elapsed += dt;
    // While the intro flyover plays the simulation is paused (karts wait on the grid).
    if (this.flyover.tick(dt)) this.endIntro();
    const intro = this.flyover.active;
    // Photo finish: slow motion = feed the fixed-step loop less time (the sim still steps in exact 1/60 s steps, only fewer per second).
    const timeScale = this.photo.tick(dt);
    const sdt = dt * timeScale; // "slowed" seconds: particles and the camera follow the slow motion too
    const alpha = intro ? 1 : this.loop.advance(sdt);
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
    for (const e of items.entityList) if (e.kind === 'ricochet' || e.kind === 'seeker') this.fx.itemTrail(e.kind, e.x, e.y, e.z, e.heading);

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
    // RACERS: the fill-in bots have a kart but no screen: same pose update and effects, but they do not move the shared shadow box.
    for (const b of this.botKarts) {
      const k = this.world.karts.get(b.slot)!;
      const ist = items.states.get(b.slot);
      b.kart.trailingItem = ist?.trailing && ist.held && ist.held.id !== 'slick' ? ist.held.id : null;
      b.kart.update(this.world.prevKarts.get(b.slot)!, k, alpha, dt, this.track);
      this.fx.kartTick(b.slot, b.kart, k, dt);
    }
    this.updateWrongWay(sdt);
    cx /= Math.max(1, this.views.length);
    cz /= Math.max(1, this.views.length);
    let spread = 0;
    for (const v of this.views) spread = Math.max(spread, Math.hypot(v.kart.pose.x - cx, v.kart.pose.z - cz));
    // Shadows: when the karts are close together one shadow map covers all of them; when they are
    // spread out (split-screen on a big track) the map is re-aimed and redrawn for each view below.
    const sharedShadow = this.views.length <= 1 || spread < 50 || !this.quality.shadowPerView;
    if (sharedShadow) followWithSun(this.sun, cx, cz, spread + this.quality.shadowRadius + 12);

    // Countdown numbers on every HUD.
    if (race.phase === 'countdown' && !intro) {
      const n = Math.max(1, Math.ceil(-race.time));
      if (n !== this.lastCountdown) {
        this.lastCountdown = n;
        this.audio?.countdown(n); // AUDIO: 3-2-1 beeps
        for (const v of this.views) v.hud.toast(String(n), 1, this.elapsed, 'count');
      }
    }
    this.fx.update(sdt);

    // HAZARDS: a hazard is a pure function of the race clock, so we draw it at the INTERPOLATED race
    // time (the sim's latest tick time minus the fraction of a tick we have not simulated yet).
    // Same idea as the kart interpolation above, and it keeps the lava exactly in step with the sim.
    // The kart positions only tell the views which geysers are near a camera (particles are skipped far away).
    if (this.hazardViews) {
      const focus = this.focusScratch; // reused array: no allocation per frame
      focus.length = 0;
      for (const v of this.views) focus.push(v.kart.pose);
      this.hazardViews.update(race.time - (1 - alpha) * SIM_DT, focus);
    }

    // AUDIO: engine / drift-squeal / roulette loops follow every kart (bots included, quieter).
    if (this.audio) {
      // PERF: the state objects are reused every frame (one per view) instead of building new ones.
      const states = this.audioScratch;
      const total = this.views.length + this.botKarts.length;
      while (states.length < total) {
        states.push({ slot: 0, human: false, speed: 0, boosting: false, grounded: true, drift: 0, silent: false, rolling: false, pan: 0 });
      }
      states.length = total;
      for (let i = 0; i < total; i++) {
        const isView = i < this.views.length;
        const slot = isView ? this.views[i].slot : this.botKarts[i - this.views.length].slot;
        const k = this.world.karts.get(slot)!;
        const st = states[i];
        st.slot = slot;
        st.human = !this.isBot(slot);
        st.speed = k.speed;
        st.boosting = k.boostTime > 0;
        st.grounded = k.grounded;
        st.drift = k.driftDir !== 0 ? 1 + k.driftTier : 0;
        st.silent = !!k.flight || k.respawnTime > 0;
        st.rolling = (items.states.get(slot)?.roulette ?? 0) > 0;
        st.pan = isView ? panForRect(this.views[i].rect) : 0;
      }
      this.audio.update(dt, states);
    }

    // Render: shadow map once, then the scene once per viewport.
    // Three.js would recompute every object's world matrix inside each render() call (4 views + shadow
    // passes); nothing moves between the views, so do it once here (scene.matrixWorldAutoUpdate is off).
    this.scene.updateMatrixWorld();
    const size = this.renderer.getSize(this.sizeScratch); // reused vector: no allocation in the frame loop
    if (sharedShadow) this.renderer.shadowMap.needsUpdate = true;
    this.pipeline.beginFrame();
    // Intro flyover: ONE full-screen picture. With one player the flyover eases into that player's chase
    // camera; with split screen it holds its shot and the view simply cuts to the split screen afterwards.
    if (intro) {
      const r = toViewport(Game.FULL, size.x, size.y);
      const solo = this.views.length === 1;
      const cam = solo ? this.views[0].chase.camera : this.introCam;
      if (solo) {
        const v = this.views[0];
        const k = this.world.karts.get(v.slot)!;
        this.groundIndex = k.trackIndex;
        v.chase.update(v.kart.pose, dt, this.camState, this.groundHeight);
      }
      cam.aspect = r.w / Math.max(1, r.h);
      cam.updateProjectionMatrix();
      this.flyover.apply(cam, this.track, 0, solo);
      // Aim the shadow box at what the flyover camera looks at (the karts are far away).
      const fwd = cam.getWorldDirection(this.dirScratch);
      followWithSun(this.sun, cam.position.x + fwd.x * 30, cam.position.z + fwd.z * 30, this.quality.shadowRadius + 20);
      this.renderer.shadowMap.needsUpdate = true;
      this.cullTerrain(cam);
      this.fx.beginView(cam, r.h * this.renderer.getPixelRatio());
      this.pipeline.renderView(this.scene, cam, r.x, r.y, r.w, r.h);
    }
    for (const v of intro ? [] : this.views) {
      const kart = this.world.karts.get(v.slot)!;
      const r = toViewport(v.rect, size.x, size.y);
      v.chase.setAspect(r.w / Math.max(1, r.h));
      this.groundIndex = kart.trackIndex;
      const ground = this.groundHeight;
      const racer = race.racers.get(v.slot)!;
      // Tell the camera what the kart is doing: it kicks the FOV, widens in the air, orbits at the finish...
      const cs = this.camState;
      cs.boosting = kart.boostTime > 0;
      cs.grounded = kart.grounded;
      cs.flightPhase = kart.flight?.phase ?? null;
      cs.finished = racer.finished;
      cs.driftDir = kart.driftDir;
      v.chase.update(v.kart.pose, sdt, cs, ground); // sdt: during a photo finish the camera holds (slow motion)
      if (!sharedShadow) {
        // Aim the shadow box at the middle of what this camera sees (a bit ahead of the kart).
        const fwd = v.chase.camera.getWorldDirection(this.dirScratch);
        followWithSun(this.sun, v.kart.pose.x + fwd.x * 22, v.kart.pose.z + fwd.z * 22, this.quality.shadowRadius);
        this.renderer.shadowMap.needsUpdate = true;
      }
      this.applyKartLods(v);
      this.cullTerrain(v.chase.camera); // PERF: skip ground tiles that are completely fogged out
      this.applyBoxRange(v);
      this.fx.beginView(v.chase.camera, r.h * this.renderer.getPixelRatio()); // particle sizes depend on camera + viewport
      this.pipeline.renderView(this.scene, v.chase.camera, r.x, r.y, r.w, r.h);

      // PERF: one HudState object is refilled for every view instead of building a new literal per view per frame.
      const hs = this.hudScratch;
      hs.position = racer.place ?? race.positionOf(v.slot);
      this.watchFaces(v, hs.position, race.phase === 'racing' && !racer.finished);
      hs.racers = race.racers.size;
      hs.lap = Math.min(race.totalLaps, Math.max(1, racer.lap));
      hs.laps = race.totalLaps;
      hs.time = formatTime(Math.max(0, racer.finishTime ?? race.time));
      hs.speedKmh = Math.round(Math.abs(v.kart.pose.speed) * 3.6);
      hs.boosting = kart.boostTime > 0;
      hs.item = items.displayFor(v.slot);
      hs.driftCharge = kart.driftCharge / KART.driftTier2;
      hs.driftTier = kart.driftTier;
      hs.drifting = kart.driftDir !== 0 && kart.grounded;
      hs.speedFx = v.chase.speedFx;
      v.hud.update(hs, this.elapsed);
    }
    this.pipeline.endFrame(); // bloom + colour grade + tone mapping, once for all viewports

    // PERF: the dots go into a reused array; the minimap itself only redraws at 30 Hz.
    if (this.minimap.due()) {
      const dots = this.dotScratch;
      dots.length = 0;
      for (const slot of race.standings()) {
        const kv = this.kartViewOf(slot)!;
        const p = this.players.slots.slots[slot];
        dots.push({ x: kv.pose.x, z: kv.pose.z, color: slotColor(slot, p?.color, this.fillColors), label: this.isBot(slot) ? '' : `P${slot + 1}` });
      }
      this.minimap.draw(dots);
    }

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

  /**
   * WRONG WAY: for every human kart, ask the detector (wrongWay.ts) whether it has been driving against the
   * racing direction for a while; show or hide the sign on that player's HUD and buzz their phone when it appears.
   */
  private updateWrongWay(dt: number): void {
    const race = this.world.race;
    if (!race) return;
    for (const v of this.views) {
      if (this.isBot(v.slot)) continue;
      const k = this.world.karts.get(v.slot);
      const racer = race.racers.get(v.slot);
      if (!k || !racer) continue;
      let det = this.wrongWay.get(v.slot);
      if (!det) this.wrongWay.set(v.slot, (det = new WrongWayDetector()));
      const sample = k.trackIndex >= 0 ? this.track.samples[k.trackIndex] : undefined;
      // Cases where "backwards" is meaningless: before GO, finished/knocked out, respawning, in a cannon, spinning out, in the air.
      const excluded = !sample || race.phase !== 'racing' || racer.finished || racer.out || k.respawnTime > 0 || !!k.flight || k.spinTime > 0 || !k.grounded;
      const along = sample ? speedAlongTrack(k.vel.x, k.vel.z, sample.tx, sample.tz) : 0;
      const show = det.update(dt, along, excluded);
      if (show !== this.wrongWayShown.has(v.slot)) {
        if (show) {
          this.wrongWayShown.add(v.slot);
          this.haptic(v.slot, HAPTICS.wrongWay);
        } else {
          this.wrongWayShown.delete(v.slot);
        }
        v.hud.setWrongWay(show);
      }
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
    sub.textContent = `${this.world.race?.totalLaps ?? this.track.def.laps} laps${this.knockout ? ' · knockout' : ''} · Space to skip`;
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

  /** Context for the face mapper (how many karts race, how long a spin-out lasts). */
  private readonly faceCtx: FaceContext = { racers: 1, spinTime: KART.spinTime };

  /** Driver faces: a sim event may make one or two karts grin, gasp or glance back (pure mapper in render/kart/expression.ts). */
  private reactFaces(e: WorldEvent): void {
    this.faceCtx.racers = this.world.karts.size;
    for (const r of reactionsForEvent(e, this.faceCtx)) this.kartViewOf(r.slot)?.face.react(r);
  }

  /**
   * Per frame, per view: overtaking (the race place improved) makes the driver smug, and another kart right
   * behind makes them glance over the shoulder. No allocation.
   */
  private watchFaces(v: PlayerView, place: number, racing: boolean): void {
    const face = v.kart.face;
    face.notePlace(place, racing);
    if (!racing || Math.abs(v.kart.pose.speed) < 6) return;
    for (const o of this.views) {
      if (o === v) continue;
      const side = tailgateSide(o.kart.pose.x - v.kart.pose.x, o.kart.pose.z - v.kart.pose.z, v.kart.pose.heading);
      if (side !== 0) {
        face.tailgated(side);
        return;
      }
    }
    for (const o of this.botKarts) {
      const side = tailgateSide(o.kart.pose.x - v.kart.pose.x, o.kart.pose.z - v.kart.pose.z, v.kart.pose.heading);
      if (side !== 0) {
        face.tailgated(side);
        return;
      }
    }
  }

  /** Visual + camera reactions to a sim event (particles, shake, flashes). Haptics are handled in handleEvents. */
  private reactFx(e: WorldEvent): void {
    // Events that carry a player slot get the kart's position for their effects.
    if (!('slot' in e)) {
      if (e.kind === 'itemDestroyed') this.fx.itemPop(e.x, (this.track.sample(e.x, e.z)?.height ?? 0) + 0.2, e.z);
      return;
    }
    const kv = this.kartViewOf(e.slot);
    if (!kv) return;
    const p = kv.pose;
    const hud = this.viewOf(e.slot)?.hud; // fill-in bots have a kart but no HUD
    const st = this.world.karts.get(e.slot);
    switch (e.kind) {
      case 'startBoost':
        this.fx.boostBurst(p.x, p.y, p.z, p.heading);
        hud?.flash('boost');
        this.shake(e.slot, 0.25);
        break;
      case 'boostPad':
        this.fx.boostBurst(p.x, p.y, p.z, p.heading);
        hud?.flash('boost');
        break;
      case 'miniTurbo':
        this.fx.miniTurbo(p.x, p.y, p.z, p.heading, e.tier);
        hud?.flash('boost');
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
        hud?.flash('boost');
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
        hud?.flash('boost');
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
        hud?.flash('hit');
        this.shake(e.slot, 0.8);
        break;
      case 'hazardHit': // lava geyser (or another hazard) got this kart: same burst and shake as an item hit
        this.fx.hit(p.x, p.y, p.z);
        hud?.flash('hit');
        this.shake(e.slot, 0.8);
        break;
      case 'blocked':
        this.fx.itemPop(p.x, p.y + 0.4, p.z);
        this.shake(e.slot, 0.2);
        break;
      case 'bumped': // knocked aside by a Bumper orb
        this.fx.bump(p.x, p.y, p.z);
        this.shake(e.slot, 0.45);
        break;
      case 'itemBox':
        this.fx.pickup(p.x, p.y, p.z);
        break;
      case 'itemGet':
        hud?.flash('item');
        break;
      case 'itemUse':
        if (e.id === 'dash') {
          this.fx.boostBurst(p.x, p.y, p.z, p.heading);
          hud?.flash('boost');
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
        hud?.flash('item');
        break;
    }
  }

  private handleEvents(events: WorldEvent[]): void {
    // AUDIO: one call turns every event into sounds (mapping lives in src/audio/mapping.ts).
    this.audio?.handleEvents(events, { isHuman: (s) => !this.isBot(s), totalLaps: this.world.race?.totalLaps ?? this.track.def.laps });
    for (const e of events) {
      this.reactFx(e);
      this.reactFaces(e); // driver faces: events (and bot moods) become expressions and head turns
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
          this.photoFinish = true;
          // Slow motion + white flash + banner on every screen (all players are slowed equally, so nobody loses anything).
          // Not in Knockout, and not when only bots were involved (see worthSlowMotion).
          if (worthSlowMotion({ slots: e.slots, isHuman: (s) => !this.isBot(s), knockout: this.knockout, alreadyPlayed: this.photoPlayed })) {
            this.photoPlayed = true;
            this.photo.start();
            for (const v of this.views) {
              v.hud.flash('photo');
              v.hud.showBanner('PHOTO FINISH', 1.8, this.elapsed, 'photo');
            }
          }
          break;
        case 'stall':
          this.haptic(e.slot, HAPTICS.stall);
          break;
        // --- Knockout: the kart is carried away; its view greys out with the final place, the others see who went ---
        case 'knockout':
          this.haptic(e.slot, HAPTICS.respawn);
          this.viewOf(e.slot)?.hud.knockedOut(e.place);
          if (!this.isBot(e.slot)) for (const v of this.views) if (v.slot !== e.slot) v.hud.showBanner(`P${e.slot + 1} OUT!`, 1.6, this.elapsed); // (a field of 12 loses several bots per lap: no banner for them)
          this.sendStatus();
          break;
        // --- end Knockout ---
        case 'botMood':
          break; // the face reaction itself is done by reactFaces() above (see render/kart/expression.ts)
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
          if (e.lap + 1 === this.world.race?.totalLaps) {
            this.viewOf(e.slot)?.hud.showBanner('FINAL LAP!', 1.9, this.elapsed);
            if (!this.isBot(e.slot)) this.audio?.setFinalLap(true); // AUDIO: music 15% faster
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
          if (e.attacker !== null && e.attacker !== e.slot) this.attackToast(e.attacker, 'hit', e.slot, 1.2);
          this.sendStatus();
          break;
        }
        case 'hazardHit':
          this.haptic(e.slot, HAPTICS.spunOut);
          this.players.sendTo(e.slot, { t: 'drift', tier: null });
          break;
        case 'blocked':
          this.haptic(e.slot, HAPTICS.itemUse);
          break;
        case 'bumped':
          this.haptic(e.slot, HAPTICS.novaHit);
          if (e.attacker !== e.slot) this.attackToast(e.attacker, 'bumped', e.slot, 1.0);
          break;
        case 'jumbled':
          this.haptic(e.slot, HAPTICS.spunOut);
          this.viewOf(e.slot)?.hud.showInk(ITEMS.jumbleTime);
          break;
      }
    }
  }

  private nameOf(slot: number): string {
    return (this.players.slots.slots[slot]?.name ?? (isFillBot(slot) ? fillBotName(slot) : `P${slot + 1}`)).toUpperCase();
  }

  /** "HIT NAME!" / "BUMPED NAME!" for the attacker, only when the victim is a person (not a bot): see attackToast in raceSettings.ts. */
  private attackToast(attacker: number, kind: 'hit' | 'bumped', victim: number, seconds: number): void {
    const text = attackToast(kind, this.nameOf(victim), !this.isBot(victim));
    if (text) this.toast(attacker, text, seconds);
  }

  private haptic(slot: number, pattern: readonly number[]): void {
    this.players.sendTo(slot, { t: 'haptic', pattern: [...pattern] });
  }

  private sendStatus(): void {
    const race = this.world.race;
    if (!race) return;
    for (const [slot, r] of race.racers) {
      if (isFillBot(slot)) continue; // no phone behind a fill-in bot
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
        slot,
        place: r.place ?? 0,
        name: p?.name ?? (isFillBot(slot) ? fillBotName(slot) : `P${slot + 1}`),
        color: slotColor(slot, p?.color, this.fillColors),
        loadoutText: `${CHARACTERS[loadout.character].name} · ${KART_BODIES[loadout.kart].name}`,
        time: this.knockout ? (r.out ? (r.outLap ? `OUT · LAP ${r.outLap}` : 'LEFT') : 'WINNER') : r.finished ? formatTime(r.finishTime!) : 'DNF',
        best: Number.isFinite(best) ? formatTime(best) : '–',
        fastest: false,
        finished: this.knockout ? !r.out : r.finished,
      };
      return { row, best };
    });
    rows.sort((a, b) => a.row.place - b.row.place);
    // Mark the single fastest lap of the race.
    const fastest = Math.min(...rows.map((r) => r.best));
    if (Number.isFinite(fastest)) rows.find((r) => r.best === fastest)!.row.fastest = true;
    // Series hook: places are taken from the ranking order (always unique, even for DNFs).
    const placings: Placing[] = race.standings().map((slot, i) => ({ slot, place: i + 1, human: !this.isBot(slot) }));
    const extras = this.callbacks.onRaceResults?.(placings);
    buildResults(
      this.results,
      rows.map((r) => r.row),
      this.track.def.name,
      { raceAgain: () => this.callbacks.onRaceAgain?.(), changeTrack: () => this.callbacks.onChangeTrack?.() },
      extras,
      this.knockout ? 'KNOCKOUT' : undefined,
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

/** Which kart model detail goes with a quality preset. */
function kartDetailFor(q: QualitySettings): KartDetail {
  return q.name === 'High' ? 'high' : q.name === 'Medium' ? 'mid' : 'low';
}
