/**
 * The 3D side of the TV selection screen (the DOM side is src/host/selectView.ts).
 *
 * ONE WebGL renderer draws every player's quadrant. Web/3D concept: a "scissor" restricts drawing to a
 * rectangle of the canvas, so a single canvas can show several different 3D views side by side (the race's
 * split-screen works the same way). Each quadrant is a `Stage`: a little group of objects (a turntable, a shadow
 * blob, the kart with its driver, a burst of sparkles) plus its own camera. All stages live in one Three.js
 * scene with shared lights; before drawing a quadrant only that stage's group is made visible.
 *
 * What a stage shows (from the SelectionView it is given, see src/host/selectionHub.ts):
 *  - 'name'      a dark silhouette of a driver in a kart, breathing slowly (waiting for the player)
 *  - 'character' the highlighted character in their own palette on a turntable that swings back and forth,
 *                blinking, with the head following the camera
 *  - 'kart'      the chosen character in the highlighted kart body; the CAMERA orbits the kart. When the
 *                character was just confirmed the driver first plays their pick animation (pickAnim.ts)
 *  - 'ready'     the kart rolls forward and revs (wheels spin, flames puff), the driver looks smug
 *
 * Cost control: karts reuse the shared cached geometry (kartModel.ts), a stage keeps at most 3 built models,
 * shadows are a flat blob instead of shadow maps, and `dispose()` removes everything (including the WebGL context).
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHARACTERS, paletteFor } from '../../shared/characters';
import type { SelectionView } from '../../host/selectionHub';
import { buildKartModel, type KartDetail, type KartModel } from '../kartModel';
import { buildFlame } from '../effects';
import { DriverRig, type DriverInput } from './driverRig';
import { BLINK, DriverFace } from './expression';
import { LruCache } from './modelCache';
import { NEUTRAL_PICK, PICK_DURATION, facesDue, fitDistance, pickPose, popIn, type PickPose } from './pickAnim';

/** A rectangle in CSS pixels, relative to the container the canvas fills (y from the top). */
export interface StageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FOV = 30;
const TAU = Math.PI * 2;
const smooth = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};
/** Move `cur` toward `target`, frame-rate independent (`tau` = time constant in seconds). */
const chase = (cur: number, target: number, dt: number, tau: number) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
/** `a` shifted by whole turns so it is the closest equivalent angle to `ref`. */
const nearAngle = (a: number, ref: number) => a - TAU * Math.round((a - ref) / TAU);

// ---------------------------------------------------------------------------
// Shared things every stage uses (built once, disposed with the renderer)
// ---------------------------------------------------------------------------

/** Soft round sprite for the sparkles and the blob shadow (a radial gradient drawn on a small 2D canvas). */
function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class SharedAssets {
  /** The turntable: a low disc with 12 tick marks on its rim (so its rotation can be seen). */
  readonly platform: THREE.BufferGeometry;
  readonly ring = new THREE.TorusGeometry(1.5, 0.028, 8, 72).rotateX(Math.PI / 2);
  readonly blob = new THREE.PlaneGeometry(3.4, 3.4).rotateX(-Math.PI / 2);
  readonly platformMat = new THREE.MeshStandardMaterial({ color: '#252b66', roughness: 0.45, metalness: 0.35 });
  readonly tickMat = new THREE.MeshStandardMaterial({ color: '#6d78d8', roughness: 0.5, metalness: 0.2 });
  readonly ticks: THREE.BufferGeometry;
  readonly sprite = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
  readonly shadowTex = radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)');
  /** The flat dark material of the 'name' silhouette. */
  readonly silhouetteMat = new THREE.MeshBasicMaterial({ color: '#171c46' });

  constructor() {
    this.platform = new THREE.CylinderGeometry(1.62, 1.7, 0.1, 56).translate(0, -0.05, 0);
    const bars: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      bars.push(new THREE.BoxGeometry(0.07, 0.02, 0.16).rotateY(-a).translate(Math.sin(a) * 1.62, 0.0, Math.cos(a) * 1.62));
    }
    this.ticks = mergeGeometries(bars)!;
    bars.forEach((b) => b.dispose());
  }

  dispose(): void {
    for (const g of [this.platform, this.ring, this.blob, this.ticks]) g.dispose();
    for (const m of [this.platformMat, this.tickMat, this.silhouetteMat]) m.dispose();
    this.sprite.dispose();
    this.shadowTex.dispose();
  }
}

// ---------------------------------------------------------------------------
// One built kart + driver
// ---------------------------------------------------------------------------

interface Entry {
  key: string;
  character: number;
  kart: number;
  silhouette: boolean;
  model: KartModel;
  rig: DriverRig;
  face: DriverFace;
  /** Boost flames at the exhausts (shown while revving in the 'ready' stage). */
  flames: THREE.Group[];
}

const baseInput = (): DriverInput => ({
  steer: 0, bodyRoll: 0, accel: 0, speed01: 0, drift: 0, boosting: false, airborne: false, trick: -1, spun: false, celebrate: false, look: 0, lookSide: 1,
});

function buildEntry(character: number, kart: number, detail: KartDetail, silhouette: boolean, flat: THREE.Material): Entry {
  const model = buildKartModel('#888888', kart, character, detail, paletteFor(character));
  model.root.name = `select-kart-${character}-${kart}`;
  const flames = model.exhausts.map((m) => {
    const f = buildFlame();
    m.add(f);
    return f;
  });
  if (silhouette) {
    // Replace every material of this ONE kart (the shared ones stay untouched) with the flat dark one.
    model.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = flat;
        m.castShadow = false;
      }
    });
    flames.forEach((f) => (f.visible = false));
  }
  const rig = new DriverRig(model);
  const face = new DriverFace();
  rig.update(0, baseInput());
  return { key: `${silhouette ? 's' : character}|${kart}|${detail}`, character, kart, silhouette, model, rig, face, flames };
}

// ---------------------------------------------------------------------------
// A player's quadrant
// ---------------------------------------------------------------------------

/** The number of built models a quadrant keeps for quick switching. */
const MODELS_PER_STAGE = 3;
const POP_TIME = 0.4;
/** Camera orbit speed in the kart stage (rad/s): one lap takes about 11 s. */
const ORBIT_SPEED = 0.55;
const SPARKS = 36;

class Stage {
  readonly group = new THREE.Group();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
  rect: StageRect = { x: 0, y: 0, w: 0, h: 0 };
  view: SelectionView | null = null;
  /** 0..1: how much the key light is flashed (robot LEDs, stomps). */
  flash = 0;
  accent = new THREE.Color('#ffffff');

  private readonly turn = new THREE.Group();
  private readonly ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  private readonly blobMat: THREE.MeshBasicMaterial;
  private readonly blobMesh: THREE.Mesh;
  private readonly sparks: THREE.Points;
  private readonly sparkMat: THREE.PointsMaterial;
  private readonly sparkVel = new Float32Array(SPARKS * 3);
  private readonly cache: LruCache<Entry>;
  private entry: Entry | null = null;
  private t = Math.random() * 10;
  private appear = 1; // seconds since the current model popped in
  private pickT = -1; // seconds since the pick animation started (< 0: not playing)
  private readyT = -1;
  private sparkT = -1;
  private nextSmug = 0;
  private readonly pose: PickPose = { ...NEUTRAL_PICK };
  private readonly input = baseInput();
  // Camera state (orbit angle, height angle, distance, target height); chased toward what the stage wants.
  private az = 0.4;
  private el = 0.25;
  private dist = 5;
  private ty = 0.6;
  private camSet = false;
  private shakeT = 0;
  private revT = 0;

  constructor(
    readonly slot: number,
    private readonly shared: SharedAssets,
    private readonly detailFor: () => KartDetail,
  ) {
    this.cache = new LruCache<Entry>(MODELS_PER_STAGE, (e) => this.turn.remove(e.model.root));
    const platform = new THREE.Mesh(shared.platform, shared.platformMat);
    const ticks = new THREE.Mesh(shared.ticks, shared.tickMat);
    const ring = new THREE.Mesh(shared.ring, this.ringMat);
    ring.position.y = 0.012;
    this.turn.add(platform, ticks, ring);
    this.blobMat = new THREE.MeshBasicMaterial({ map: shared.shadowTex, transparent: true, depthWrite: false });
    this.blobMesh = new THREE.Mesh(shared.blob, this.blobMat);
    this.blobMesh.position.y = 0.015;
    this.group.add(this.turn, this.blobMesh);
    // Sparkle burst (positions are written every frame while it plays).
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    this.sparkMat = new THREE.PointsMaterial({ size: 0.16, map: shared.sprite, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.sparks = new THREE.Points(geo, this.sparkMat);
    this.sparks.frustumCulled = false;
    this.sparks.visible = false;
    this.group.add(this.sparks);
    this.group.visible = false;
  }

  // ---- reacting to the hub -------------------------------------------------

  /** Called whenever the hub reports this player's view (cheap: only changes matter). */
  setView(next: SelectionView): void {
    const prev = this.view;
    this.view = { ...next };
    const pal = paletteFor(next.character);
    this.accent.set(next.stage === 'name' ? '#7f8cff' : pal.accent);
    this.ringMat.color.set(next.stage === 'name' ? '#4a55c4' : pal.accent);

    const silhouette = next.stage === 'name';
    const want = this.wantedKey(next, silhouette);
    if (!this.entry || this.entry.key !== want) {
      const swapped = this.entry !== null;
      this.showEntry(next, silhouette);
      if (swapped && !silhouette) {
        this.appear = 0; // the new model pops in
        this.entry!.face.react({ expr: 'happy', duration: 0.9 });
      }
    }
    if (prev && prev.stage !== next.stage) this.onStageChange(prev, next);
    else if (!prev) this.onStageChange(null, next);
  }

  private wantedKey(v: SelectionView, silhouette: boolean): string {
    return `${silhouette ? 's' : v.character}|${silhouette ? 0 : v.kart}|${this.detailFor()}`;
  }

  private showEntry(v: SelectionView, silhouette: boolean): void {
    if (this.entry) this.entry.model.root.visible = false;
    const detail = this.detailFor();
    const kart = silhouette ? 0 : v.kart;
    const character = silhouette ? 3 : v.character;
    const key = `${silhouette ? 's' : character}|${kart}|${detail}`;
    const e = this.cache.get(key, () => {
      const made = buildEntry(character, kart, detail, silhouette, this.shared.silhouetteMat);
      this.turn.add(made.model.root);
      return made;
    });
    e.model.root.visible = true;
    this.entry = e;
  }

  private onStageChange(prev: SelectionView | null, next: SelectionView): void {
    const e = this.entry;
    if (!e) return;
    this.readyT = -1;
    e.flames.forEach((f) => (f.visible = false));
    e.model.root.position.z = 0;
    if (prev && prev.stage === 'character' && next.stage === 'kart') {
      this.startPick(e);
    } else if (next.stage === 'ready') {
      this.readyT = 0;
      this.nextSmug = 0;
      this.burst(e);
    }
    if (next.stage === 'kart' && !(prev && prev.stage === 'character')) this.pickT = -1;
    if (next.stage === 'name' || next.stage === 'character') this.pickT = -1;
  }

  private startPick(e: Entry): void {
    this.pickT = 0;
    e.face.reset();
    this.burst(e);
  }

  /** Start a sparkle burst in the character's colours. */
  private burst(e: Entry): void {
    const pal = paletteFor(e.character);
    const cols = [pal.body, pal.trim, pal.accent, '#ffffff'].map((c) => new THREE.Color(c));
    const col = this.sparks.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < SPARKS; i++) {
      const a = Math.random() * TAU;
      const up = 1.6 + Math.random() * 2.2;
      const out = 0.8 + Math.random() * 1.6;
      this.sparkVel[i * 3] = Math.cos(a) * out;
      this.sparkVel[i * 3 + 1] = up;
      this.sparkVel[i * 3 + 2] = Math.sin(a) * out;
      const c = cols[i % cols.length];
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    this.sparkT = 0;
    this.sparks.visible = true;
  }

  // ---- per-frame update ------------------------------------------------------

  setRect(r: StageRect): void {
    this.rect = r;
    if (r.w > 0 && r.h > 0) this.camera.aspect = r.w / r.h;
  }

  update(dt: number): void {
    const v = this.view;
    const e = this.entry;
    if (!v || !e) return;
    this.t += dt;
    this.appear += dt;
    const stage = v.stage;
    const pose = this.pose;
    this.flash = 0;

    // --- Pick animation: the pose is added on top of the normal sitting pose.
    if (this.pickT >= 0) {
      const t0 = this.pickT;
      this.pickT += dt;
      const species = CHARACTERS[e.character].look.species;
      for (const f of facesDue(species, t0, this.pickT)) {
        e.face.react({ expr: f.expr, duration: f.hold, priority: 12 });
      }
      pickPose(species, this.pickT, pose);
      if (this.pickT >= PICK_DURATION) {
        this.pickT = -1;
        Object.assign(pose, NEUTRAL_PICK);
      }
    } else {
      Object.assign(pose, NEUTRAL_PICK);
    }
    this.flash = pose.flash;
    this.shakeT = pose.shake;

    // --- Turntable / kart motion per stage.
    const model = e.model;
    // Where the turntable wants to point. In the browsing stages it swings back and forth around the
    // camera direction, so the face is always (mostly) visible; elsewhere it holds still.
    let turnYaw = stage === 'kart' ? 0.3 : 0.15;
    let wheelRate = 0; // rad/s
    if (stage === 'character' || stage === 'name') turnYaw = this.az + 0.5 * Math.sin(this.t * 0.7);
    if (stage === 'ready' && this.readyT >= 0) {
      this.readyT += dt;
      const roll = smooth(this.readyT / 0.9);
      model.root.position.z = 0.55 * roll;
      wheelRate = 22 * (1 - roll) + 7;
      // Rev bursts: flames and a shudder every ~1.1 s.
      this.revT = (this.revT + dt) % 1.1;
      const rev = this.revT < 0.4 ? Math.sin((Math.PI * this.revT) / 0.4) : 0;
      for (const f of e.flames) {
        f.visible = rev > 0.15 && !e.silhouette;
        f.scale.set(1, 1, 0.7 + rev * (0.6 + Math.random() * 0.4));
      }
      model.body.position.y = 0.012 * Math.sin(this.t * 70) * (0.4 + rev);
      wheelRate += rev * 14;
      if (this.t > this.nextSmug) {
        e.face.react({ expr: 'smug', duration: 2.2 });
        this.nextSmug = this.t + 2.6;
      }
      turnYaw = 0.35; // face the camera a little off-axis
    } else {
      model.body.position.y = 0;
    }
    // Ease toward the wanted angle so changing stage never snaps the turntable.
    this.turn.rotation.y = chase(this.turn.rotation.y, nearAngle(turnYaw, this.turn.rotation.y), dt, 0.2);
    for (const w of model.wheels) w.rotation.x += dt * wheelRate;

    // --- Face and driver.
    const face = e.face;
    face.update(dt, { gritted: false });
    const fi = model.faceInfluences;
    for (let i = 0; i < fi.length; i++) fi[i] = face.weights[i];
    if (pose.blink > fi[BLINK]) fi[BLINK] = pose.blink;
    const inp = this.input;
    inp.celebrate = pose.armsUp > 0.5 || (stage === 'ready' && this.readyT > 0.9);
    e.rig.update(dt, inp);
    this.applyPose(e, pose, stage === 'character' || stage === 'name' ? this.turn.rotation.y - this.az : 0);

    // The model's pop-in when it was just swapped.
    const s = popIn(this.appear / POP_TIME);
    model.root.scale.setScalar(Math.max(0.001, s));

    // --- Blob shadow shrinks when the driver hops (the kart itself stays on the floor).
    this.blobMat.opacity = 0.9 - pose.lift * 0.5;

    // --- Sparkles.
    this.updateSparks(dt);
    this.updateCamera(dt, stage);
  }

  /** Add the pick pose and the idle breathing to the driver pieces (the rig has just written the base pose). */
  private applyPose(e: Entry, p: PickPose, lookOffset: number): void {
    const m = e.model;
    const d = m.driver;
    const breath = Math.sin(this.t * 2.1) * 0.012;
    const sq = p.squash + breath;
    d.position.y += p.lift;
    d.rotation.x = p.pitch;
    d.rotation.y = p.yaw;
    d.rotation.z = p.roll;
    d.scale.set(d.scale.x * (1 - sq * 0.5), d.scale.y * (1 + sq), d.scale.z * (1 - sq * 0.5));
    m.torso.rotation.x += p.torsoPitch;
    m.torso.rotation.y += p.torsoYaw;
    m.torso.rotation.z += p.torsoRoll + Math.sin(this.t * 1.3) * 0.025;
    // The head follows the camera while the turntable swings, plus the move's own head motion.
    m.head.rotation.x += p.headPitch;
    m.head.rotation.y += p.headYaw - THREE.MathUtils.clamp(lookOffset, -0.8, 0.8) * 0.7;
    m.head.rotation.z += p.headRoll;
  }

  private updateSparks(dt: number): void {
    if (this.sparkT < 0) return;
    this.sparkT += dt;
    const life = 1.3;
    if (this.sparkT >= life) {
      this.sparkT = -1;
      this.sparks.visible = false;
      this.sparkMat.opacity = 0;
      return;
    }
    const t = this.sparkT;
    const pos = this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < SPARKS; i++) {
      pos.setXYZ(
        i,
        this.sparkVel[i * 3] * t,
        0.7 + this.sparkVel[i * 3 + 1] * t - 4.2 * t * t,
        this.sparkVel[i * 3 + 2] * t,
      );
    }
    pos.needsUpdate = true;
    this.sparkMat.opacity = 1 - smooth((t - 0.5) / (life - 0.5));
  }

  /** Where the camera wants to be for the current stage, and a smooth move toward it. */
  private updateCamera(dt: number, stage: SelectionView['stage']): void {
    const aspect = this.camera.aspect;
    let wantEl = 0.3;
    let wantAz = 0.45;
    let radius = 1.7;
    let wantTy = 0.55;
    let orbit = false;
    if (stage === 'character') {
      radius = 1.6;
      wantTy = 0.78;
      wantEl = 0.22;
      wantAz = 0.3;
    } else if (stage === 'kart') {
      // While the pick move plays, stay close on the driver; then pull back and orbit.
      const pulling = this.pickT >= 0 && this.pickT < PICK_DURATION - 0.1;
      radius = pulling ? 1.35 : 1.55;
      wantTy = pulling ? 0.75 : 0.5;
      wantEl = pulling ? 0.2 : 0.3;
      orbit = !pulling;
      wantAz = pulling ? 0.3 : this.az;
    } else if (stage === 'ready') {
      radius = 1.5;
      wantTy = 0.5;
      wantEl = 0.16;
      wantAz = 0.5;
    }
    if (orbit) this.az += dt * ORBIT_SPEED;
    else this.az = chase(this.az, nearAngle(wantAz, this.az), dt, 0.3);
    const wantDist = fitDistance(radius, FOV, aspect);
    const first = !this.camSet;
    this.camSet = true;
    const tau = first ? 0.0001 : 0.35;
    this.el = chase(this.el, wantEl, dt, tau);
    this.dist = chase(this.dist, wantDist, dt, tau);
    this.ty = chase(this.ty, wantTy, dt, tau);
    const shake = this.shakeT * 0.05;
    const cx = Math.sin(this.az) * Math.cos(this.el) * this.dist;
    const cy = Math.sin(this.el) * this.dist + this.ty;
    const cz = Math.cos(this.az) * Math.cos(this.el) * this.dist;
    this.camera.position.set(cx + (Math.random() - 0.5) * shake, cy + (Math.random() - 0.5) * shake, cz);
    this.camera.lookAt(0, this.ty, stage === 'ready' ? 0.25 : 0);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.cache.clear();
    this.group.removeFromParent();
    this.ringMat.dispose();
    this.blobMat.dispose();
    this.sparks.geometry.dispose();
    this.sparkMat.dispose();
    this.entry = null;
  }
}

// ---------------------------------------------------------------------------
// The renderer: one canvas for every quadrant
// ---------------------------------------------------------------------------

/** Size (px) of the small head / kart pictures. */
const PORTRAIT = 112;

interface PortraitJob {
  key: string;
  character: number;
  /** -1 = the character's head; otherwise a kart body, drawn in the character's palette without a driver. */
  kart: number;
}

export class SelectRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly shared = new SharedAssets();
  private readonly stages = new Map<number, Stage>();
  private readonly key: THREE.DirectionalLight;
  private readonly rim: THREE.DirectionalLight;
  private readonly envTarget: THREE.WebGLRenderTarget;
  private readonly portraitGroup = new THREE.Group();
  private readonly portraitCam = new THREE.PerspectiveCamera(24, 1, 0.05, 20);
  private readonly portraits = new Map<string, string>();
  private readonly queue: PortraitJob[] = [];
  private readonly warm: Array<[number, number]> = [];
  private warmTimer: ReturnType<typeof setTimeout> | null = null;
  private width = 0;
  private height = 0;
  private disposed = false;
  /** Called when a new portrait picture has been made (the DOM then refreshes its images). */
  onPortrait: (() => void) | null = null;
  /** Number of players; decides how detailed the karts are (4 small quadrants need less than 1 big one). */
  players = 1;

  constructor(private readonly container: HTMLElement) {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.setClearColor(0x000000, 0);
    r.autoClear = false;
    r.domElement.className = 'select-canvas';
    container.appendChild(r.domElement);
    this.renderer = r;

    // Lights: soft sky/ground fill, a warm key from the front-right, a coloured rim from behind (per quadrant),
    // and a studio "room" environment so the clear-coated paint has something to reflect.
    this.scene.add(new THREE.HemisphereLight('#c9d8ff', '#2a2350', 0.75));
    this.key = new THREE.DirectionalLight('#fff1dc', 2.3);
    this.key.position.set(3, 5, 4);
    this.rim = new THREE.DirectionalLight('#ffffff', 1.8);
    this.rim.position.set(-3.5, 2.5, -3.5);
    this.scene.add(this.key, this.rim);
    const pmrem = new THREE.PMREMGenerator(r);
    const room = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.55;
    room.dispose();
    pmrem.dispose();
    this.scene.add(this.portraitGroup);
    this.portraitGroup.visible = false;
    this.resize();
  }

  /** Detail of the karts in the quadrants: full for one or two players, reduced for three or four. */
  private detail = (): KartDetail => (this.players <= 2 ? 'high' : 'mid');

  /** Match the canvas to its container (call when the container's size changes). */
  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h);
  }

  /** Tell the renderer what every player is doing (call on every hub update). */
  setViews(views: readonly SelectionView[]): void {
    this.players = Math.max(1, views.length);
    const live = new Set<number>();
    for (const v of views) {
      live.add(v.slot);
      let st = this.stages.get(v.slot);
      if (!st) {
        st = new Stage(v.slot, this.shared, this.detail);
        this.stages.set(v.slot, st);
        this.scene.add(st.group);
      }
      st.setView(v);
    }
    for (const [slot, st] of this.stages) {
      if (!live.has(slot)) {
        st.dispose();
        this.stages.delete(slot);
      }
    }
  }

  setRect(slot: number, rect: StageRect): void {
    this.stages.get(slot)?.setRect(rect);
  }

  /** Advance the animations by `dt` seconds and draw all quadrants. */
  frame(dt: number): void {
    if (this.disposed) return;
    const r = this.renderer;
    this.runPortraitJob();
    r.setScissorTest(false);
    r.setViewport(0, 0, this.width, this.height);
    r.clear(true, true, true);
    r.setScissorTest(true);
    for (const st of this.stages.values()) {
      const { x, y, w, h } = st.rect;
      if (w < 4 || h < 4 || !st.view) continue;
      st.update(Math.min(dt, 0.1));
      for (const o of this.stages.values()) o.group.visible = o === st;
      this.rim.color.copy(st.accent);
      this.key.intensity = 2.3 * (1 + st.flash * 1.6);
      // WebGL's y axis starts at the bottom of the canvas.
      const vy = this.height - y - h;
      r.setViewport(x, vy, w, h);
      r.setScissor(x, vy, w, h);
      r.render(this.scene, st.camera);
    }
    for (const o of this.stages.values()) o.group.visible = false;
  }

  // ---- portraits ------------------------------------------------------------------

  /**
   * A small picture (data URL) of a character's head (`kart` = -1) or of a kart body painted in that character's
   * palette, or null while it is still being made (one picture per frame, so nothing stalls). Each is drawn once
   * and cached; `onPortrait` fires when one is ready.
   */
  portrait(character: number, kart = -1): string | null {
    const key = `${character}|${kart}`;
    const done = this.portraits.get(key);
    if (done) return done;
    if (!this.queue.some((j) => j.key === key)) this.queue.push({ key, character, kart });
    return null;
  }

  private runPortraitJob(): void {
    const job = this.queue.shift();
    if (!job) return;
    const r = this.renderer;
    const detail: KartDetail = 'mid';
    const e = buildEntry(job.character, job.kart < 0 ? 0 : job.kart, detail, false, this.shared.silhouetteMat);
    const m = e.model;
    // Show only what the picture is about: the head and shoulders, or the kart without its driver.
    m.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const n = mesh.name;
      mesh.visible = job.kart < 0 ? n === 'driver-head' || n === 'driver-torso' : !n.startsWith('driver');
    });
    e.flames.forEach((f) => (f.visible = false));
    if (job.kart < 0) {
      e.face.weights.fill(0);
      m.faceInfluences[1] = 0.65; // a friendly smile
    }
    this.portraitGroup.add(m.root);
    m.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    if (job.kart < 0) box.setFromObject(m.head);
    else {
      m.driver.visible = false;
      box.setFromObject(m.root);
    }
    const c = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() * 0.5;
    const d = fitDistance(radius * (job.kart < 0 ? 0.92 : 0.98), this.portraitCam.fov, 1);
    const dir = job.kart < 0 ? new THREE.Vector3(0.12, 0.05, 1) : new THREE.Vector3(0.75, 0.42, 0.85);
    this.portraitCam.position.copy(c).addScaledVector(dir.normalize(), d);
    this.portraitCam.lookAt(c);
    this.portraitGroup.visible = true;
    for (const st of this.stages.values()) st.group.visible = false;

    const dpr = this.renderer.getPixelRatio();
    const px = Math.round(PORTRAIT);
    // Draw into the bottom-left corner of the canvas, copy it out, then the normal frame clears it again.
    r.setScissorTest(false);
    r.setViewport(0, 0, this.width, this.height);
    r.clear(true, true, true);
    r.setScissorTest(true);
    r.setViewport(0, 0, px / dpr, px / dpr);
    r.setScissor(0, 0, px / dpr, px / dpr);
    this.rim.color.set(paletteFor(job.character).accent);
    this.key.intensity = 2.3;
    r.render(this.scene, this.portraitCam);
    const out = document.createElement('canvas');
    out.width = out.height = px;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(r.domElement, 0, r.domElement.height - px, px, px, 0, 0, px, px);
    this.portraits.set(job.key, out.toDataURL('image/png'));
    this.portraitGroup.visible = false;
    this.portraitGroup.remove(m.root);
    r.setScissorTest(false);
    r.clear(true, true, true);
    this.onPortrait?.();
  }

  // ---- warming up -------------------------------------------------------------------

  /**
   * Build the kart models for every character (then every body) in the background, one every ~40 ms, so
   * browsing the lists never stalls on first use. The geometry cache is shared with the race, so the work
   * also pays off there.
   */
  prewarm(): void {
    if (this.warmTimer !== null || this.warm.length > 0) return;
    for (let c = 0; c < CHARACTERS.length; c++) this.warm.push([c, 0]);
    for (let k = 1; k < 4; k++) for (let c = 0; c < CHARACTERS.length; c++) this.warm.push([c, k]);
    const step = () => {
      this.warmTimer = null;
      const next = this.warm.shift();
      if (!next || this.disposed) return;
      buildEntry(next[0], next[1], this.detail(), false, this.shared.silhouetteMat);
      this.warmTimer = setTimeout(step, 40);
    };
    this.warmTimer = setTimeout(step, 400);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.warmTimer !== null) clearTimeout(this.warmTimer);
    this.warm.length = 0;
    for (const st of this.stages.values()) st.dispose();
    this.stages.clear();
    this.shared.dispose();
    this.envTarget.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  /** How many quadrants are alive (for tests and the dev page). */
  get stageCount(): number {
    return this.stages.size;
  }
}
