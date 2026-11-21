/**
 * The 3D side of the podium (the DOM side, with names and points, is src/host/podiumView.ts).
 *
 * One small Three.js scene: three rounded steps (2nd, 1st, 3rd), each with the racer's driver + kart standing on
 * top. Karts are built exactly like on the selection screen (`buildKartModel` + `DriverRig` + `DriverFace`),
 * and each racer plays their character's pick animation (pickAnim.ts, with its face changes) when their step is
 * revealed. The winner gets a bigger moment: a spotlight beam, a confetti burst and a small camera push.
 *
 * The scene is driven by a clock `t` (seconds since the reveal started) that the caller passes to `update`, so
 * the DOM labels and the 3D picture always agree on the schedule (podiumPlan.ts).
 *
 * Cost control: no shadow maps (flat blob shadows), one confetti `Points` object, one extra spot light, a
 * pixel ratio capped at 1.5. `dispose()` frees everything including the WebGL context.
 *
 * Web/3D concepts used here:
 *  - "scale.y" animation: a step is a box whose height we grow from 0 to its full size (cheap "rising" effect);
 *  - "projection": `labelAnchor` turns a 3D point into a pixel position, so DOM text can sit under a step;
 *  - Points: a cloud of tiny squares drawn in one draw call (the confetti).
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CHARACTERS, paletteFor } from '../../shared/characters';
import { buildKartModel, type KartModel } from '../kartModel';
import { DriverRig, type DriverInput } from '../kart/driverRig';
import { BLINK, DriverFace, FOREVER } from '../kart/expression';
import { applyPickPose } from '../kart/driverPose';
import { NEUTRAL_PICK, PICK_DURATION, facesDue, pickPose, popIn, type PickPose } from '../kart/pickAnim';
import {
  STEP_DEPTH,
  STEP_HEIGHT,
  STEP_RISE,
  STEP_WIDTH,
  cameraDistance,
  frameFor,
  phase,
  stepX,
  type Place,
  type RevealSchedule,
} from './podiumPlan';

/** One racer on the 3D podium. */
export interface PodiumRacer {
  place: Place;
  /** Index into CHARACTERS and KART_BODIES (the racer's loadout). */
  character: number;
  kart: number;
}

const FOV = 30;
const TAU = Math.PI * 2;
const STEP_COLORS: Record<Place, string> = { 1: '#f2b705', 2: '#aeb8cc', 3: '#c67b3d' };
const CONFETTI_COLORS = ['#ff4d6d', '#ffbe0b', '#3ddc84', '#3a86ff', '#c77dff', '#ff7a1a', '#ffffff'];
const CONFETTI_COUNT = 150;

/** Move `cur` toward `target`, frame-rate independent (`tau` = time constant in seconds). */
const chase = (cur: number, target: number, dt: number, tau: number) => cur + (target - cur) * (1 - Math.exp(-dt / tau));

/** A soft round sprite (white centre fading to transparent), drawn once on a small 2D canvas. */
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

/** The big place number painted on the front of a step. */
function numeralTexture(place: Place): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.font = "italic 900 104px 'Arial Black', Impact, system-ui, sans-serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 12;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.strokeText(String(place), 64, 68);
  g.fillStyle = '#ffffff';
  g.fillText(String(place), 64, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const baseInput = (): DriverInput => ({
  steer: 0, bodyRoll: 0, accel: 0, speed01: 0, drift: 0, boosting: false, airborne: false, trick: -1, spun: false, celebrate: false, look: 0, lookSide: 1,
});

/** Everything for one place: a step, the racer on it, and the animation state. */
class Slot {
  readonly group = new THREE.Group();
  readonly step: THREE.Mesh;
  readonly numeral: THREE.Mesh;
  readonly holder = new THREE.Group();
  readonly height: number;
  readonly model: KartModel;
  private readonly rig: DriverRig;
  private readonly face = new DriverFace();
  private readonly pose: PickPose = { ...NEUTRAL_PICK };
  private readonly input = baseInput();
  private readonly species: (typeof CHARACTERS)[number]['look']['species'];
  private pickT = -1;
  private idleT = Math.random() * 10;
  private nextFace = 0;
  /** How hard the stage should shake / flash this frame (stomps, robot LEDs). */
  shake = 0;
  flash = 0;
  /** Current rise 0..1 of the step (drives the model's height). */
  rise = 0;

  constructor(
    readonly racer: PodiumRacer,
    stepGeo: THREE.BufferGeometry,
    stepMat: THREE.Material,
    numeralMat: THREE.Material,
    numeralGeo: THREE.BufferGeometry,
  ) {
    const place = racer.place;
    this.height = STEP_HEIGHT[place];
    this.group.position.x = stepX(place);
    this.step = new THREE.Mesh(stepGeo, stepMat);
    this.numeral = new THREE.Mesh(numeralGeo, numeralMat);
    this.numeral.position.set(0, this.height * 0.5, STEP_DEPTH / 2 + 0.012);
    this.group.add(this.step, this.numeral, this.holder);

    // The kart and driver, built like the selection screen builds them.
    this.model = buildKartModel('#888888', racer.kart, racer.character, 'high', paletteFor(racer.character));
    this.model.root.name = `podium-kart-${place}`;
    this.rig = new DriverRig(this.model);
    this.rig.update(0, baseInput());
    this.species = CHARACTERS[racer.character].look.species;
    // Fit: a wide kart must not overhang its step.
    this.model.root.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(this.model.root).getSize(new THREE.Vector3());
    this.fit = Math.min(1, (STEP_WIDTH * 0.84) / Math.max(0.01, size.x), (STEP_DEPTH * 1.45) / Math.max(0.01, size.z));
    this.holder.add(this.model.root);
    // Face the middle of the podium a little (2nd turns right, 3rd turns left; the winner looks straight out).
    this.holder.rotation.y = place === 1 ? 0 : place === 2 ? 0.22 : -0.22;
    // Stand a little behind the middle of the step so the wheels do not hang over the place number.
    this.holder.position.z = -0.22;
    this.holder.visible = false;
    this.group.visible = false;
  }

  /** Uniform scale that makes the kart fit its step. */
  readonly fit: number;
  /** Seconds since the racer popped in (< 0 before). */
  private appear = -1;
  private popped = false;

  /** Start the racer's pop-in (called at the slot's `model` time). */
  popIn(): void {
    if (this.popped) return;
    this.popped = true;
    this.appear = 0;
    this.holder.visible = true;
    this.face.react({ expr: 'happy', duration: 0.5 });
  }

  /** Start the pick animation. */
  startPick(): void {
    if (this.pickT >= 0) return;
    this.pickT = 0;
    this.face.reset();
  }

  /** True once the pick animation has finished (or never started yet: false). */
  get idling(): boolean {
    return this.popped && this.pickT < 0 && this.appear > 0.9;
  }

  update(dt: number, t: number, pickStart: number, reduced: boolean): void {
    this.idleT += dt;
    // The step rises out of the floor.
    this.step.scale.y = Math.max(0.001, this.rise);
    this.numeral.visible = this.rise > 0.6;
    this.numeral.scale.setScalar(popIn(phase(this.rise, 0.6, 0.4)));
    this.numeral.position.y = this.height * 0.5 * this.rise;
    this.group.visible = this.rise > 0.001;
    this.holder.position.y = this.height * this.rise;

    const pose = this.pose;
    const species = this.species;
    // Pick animation: the pose is added on top of the normal sitting pose; faces start at their moments.
    if (this.popped && !this.pickDone && this.pickT < 0 && t >= pickStart) {
      if (reduced) this.finishPick(); // reduced motion: no move, just the happy face
      else this.startPick();
    }
    this.flash = 0;
    this.shake = 0;
    if (this.pickT >= 0) {
      const t0 = this.pickT;
      this.pickT += dt;
      for (const f of facesDue(species, t0, this.pickT)) this.face.react({ expr: f.expr, duration: f.hold, priority: 12 });
      pickPose(species, this.pickT, pose);
      this.flash = pose.flash;
      this.shake = pose.shake;
      if (this.pickT >= PICK_DURATION) {
        this.pickT = -1;
        Object.assign(pose, NEUTRAL_PICK);
        this.finishPick();
      }
    } else {
      Object.assign(pose, NEUTRAL_PICK);
      if (this.pickDone && this.racer.place !== 1 && this.idleT > this.nextFace) {
        this.face.react({ expr: this.racer.place === 2 ? 'happy' : 'smug', duration: 2.2, priority: 12 });
        this.nextFace = this.idleT + 3.5;
      }
    }

    // Face weights go to the model's morph targets; the rig writes the sitting pose, then the pick pose goes on top.
    this.face.update(dt, { gritted: false });
    const fi = this.model.faceInfluences;
    for (let i = 0; i < fi.length; i++) fi[i] = this.face.weights[i];
    if (pose.blink > fi[BLINK]) fi[BLINK] = pose.blink;
    this.input.celebrate = pose.armsUp > 0.5 || (this.pickDone && this.racer.place === 1 && !reduced);
    this.rig.update(dt, this.input);
    applyPickPose(this.model, pose, Math.sin(this.idleT * 2.1) * 0.012, Math.sin(this.idleT * 1.3) * 0.025, 0);

    // Pop-in of the whole kart.
    if (this.appear >= 0) this.appear += dt;
    const s = popIn(this.appear / 0.45);
    this.model.root.scale.setScalar(Math.max(0.001, s * this.fit));
  }

  private pickDone = false;

  /** After the move: the winner keeps celebrating, the others look happy. */
  private finishPick(): void {
    this.pickDone = true;
    if (this.racer.place === 1) this.face.react({ expr: 'celebrate', duration: FOREVER, priority: 12 });
    else this.face.react({ expr: this.racer.place === 2 ? 'happy' : 'smug', duration: 2.5, priority: 12 });
    this.nextFace = this.idleT + 3;
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}

export class PodiumScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 80);
  private readonly key: THREE.DirectionalLight;
  private readonly spot: THREE.SpotLight;
  private readonly envTarget: THREE.WebGLRenderTarget;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly slots: Slot[] = [];
  private readonly beam: THREE.Mesh;
  private readonly beamMat: THREE.MeshBasicMaterial;
  private readonly glow: THREE.Mesh;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly confetti: THREE.Points;
  private readonly confVel = new Float32Array(CONFETTI_COUNT * 3);
  private readonly confBurst = new Uint8Array(CONFETTI_COUNT);
  private confettiOn = false;
  private confettiT = 0;
  private width = 0;
  private height = 0;
  private disposed = false;
  // Camera state: zoom (1 = whole podium) and how far the view is shifted toward the winner.
  private zoom = 1;
  private shift = 0;
  private az = 0;
  private readonly framing: ReturnType<typeof frameFor>;
  private readonly _v = new THREE.Vector3();

  constructor(
    private readonly container: HTMLElement,
    racers: readonly PodiumRacer[],
    private readonly schedule: RevealSchedule,
    private readonly reduced: boolean,
  ) {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.setClearColor(0x000000, 0);
    r.domElement.className = 'podium-canvas';
    container.appendChild(r.domElement);
    this.renderer = r;

    // Lights: sky/ground fill, a warm key, a cool rim from behind, and the studio "room" for the paint to reflect.
    this.scene.add(new THREE.HemisphereLight('#c9d8ff', '#2a2350', 0.8));
    this.key = new THREE.DirectionalLight('#fff1dc', 2.3);
    this.key.position.set(3, 6, 6);
    const rim = new THREE.DirectionalLight('#9fb4ff', 1.6);
    rim.position.set(-4, 3, -5);
    this.scene.add(this.key, rim);
    const pmrem = new THREE.PMREMGenerator(r);
    const room = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.55;
    room.dispose();
    pmrem.dispose();

    // Shared step geometry per place, step materials, numerals.
    const places = racers.map((x) => x.place);
    this.framing = frameFor(places);
    for (const racer of racers) {
      const h = STEP_HEIGHT[racer.place];
      const geo = new RoundedBoxGeometry(STEP_WIDTH, h, STEP_DEPTH, 4, 0.09).translate(0, h / 2, 0);
      const mat = new THREE.MeshStandardMaterial({ color: STEP_COLORS[racer.place], roughness: 0.32, metalness: 0.55 });
      const tex = numeralTexture(racer.place);
      const numMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      // The number is a square on the step's front face, no taller than the step itself.
      const numeralGeo = new THREE.PlaneGeometry(Math.min(0.85, h * 0.85), Math.min(0.85, h * 0.85));
      this.disposables.push(geo, mat, tex, numMat, numeralGeo);
      const slot = new Slot(racer, geo, mat, numMat, numeralGeo);
      this.slots.push(slot);
      this.scene.add(slot.group);
    }

    // Floor: a dark soft disc under the podium plus a blob shadow per step.
    const blobTex = radialTexture('rgba(0,0,0,0.6)', 'rgba(0,0,0,0)');
    const floorGeo = new THREE.CircleGeometry(6.5, 48).rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.8 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(this.framing.centerX, -0.01, 0);
    floor.scale.set(Math.max(0.5, (this.framing.halfWidth + 1.2) / 6.5), 1, 0.55);
    this.scene.add(floor);
    this.disposables.push(blobTex, floorGeo, floorMat);

    // Winner's spotlight: a real spot light (lights the kart) and a faint additive cone (the visible beam).
    this.spot = new THREE.SpotLight('#fff0c0', 0, 14, 0.4, 0.7, 2);
    this.spot.position.set(stepX(1) + 0.4, 7.2, 3.2);
    this.scene.add(this.spot, this.spot.target);
    this.spot.target.position.set(stepX(1), STEP_HEIGHT[1] + 0.8, 0);
    const beamGeo = new THREE.CylinderGeometry(0.3, 1.1, 7.2, 28, 1, true);
    this.beamMat = new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    // Its lower end sinks into the winner's step, so no glowing rim shows.
    this.beam.position.set(stepX(1), STEP_HEIGHT[1] + 3.1, 0);
    this.beam.visible = false;
    const glowTex = radialTexture('rgba(255,220,120,1)', 'rgba(255,220,120,0)');
    const glowGeo = new THREE.PlaneGeometry(4.6, 4.6).rotateX(-Math.PI / 2);
    this.glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.glow = new THREE.Mesh(glowGeo, this.glowMat);
    this.glow.position.set(stepX(1), 0.02, 0.4);
    this.glow.visible = false;
    this.scene.add(this.beam, this.glow);
    this.disposables.push(beamGeo, this.beamMat, glowTex, glowGeo, this.glowMat);

    // Confetti: one Points object, positions written every frame once the finale starts.
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CONFETTI_COUNT * 3), 3));
    const colors = new Float32Array(CONFETTI_COUNT * 3);
    const c = new THREE.Color();
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      c.set(CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    cg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const cm = new THREE.PointsMaterial({ size: 0.15, vertexColors: true, toneMapped: false });
    this.confetti = new THREE.Points(cg, cm);
    this.confetti.frustumCulled = false;
    this.confetti.visible = false;
    this.scene.add(this.confetti);
    this.disposables.push(cg, cm);

    this.resize();
    this.update(0, 0);
  }

  /** Match the canvas to its container; returns true when it has a usable size. */
  resize(): boolean {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w < 2 || h < 2) return false;
    if (w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    return true;
  }

  /** Pixel position (relative to the container) just below the front of a step, for its name label. */
  labelAnchor(place: Place, out: { x: number; y: number }): boolean {
    const slot = this.slots.find((s) => s.racer.place === place);
    if (!slot || this.width === 0) return false;
    this._v.set(stepX(place), 0, STEP_DEPTH / 2);
    this.camera.updateMatrixWorld();
    this._v.project(this.camera);
    out.x = (this._v.x * 0.5 + 0.5) * this.width;
    out.y = (-this._v.y * 0.5 + 0.5) * this.height;
    return true;
  }

  /** Advance the animations to clock time `t` (seconds since the reveal started) and draw. */
  update(dt: number, t: number): void {
    if (this.disposed) return;
    const sched = this.schedule;
    let flash = 0;
    let shake = 0;
    for (const s of this.slots) {
      const plan = sched.slots.find((x) => x.place === s.racer.place)!;
      s.rise = this.reduced ? (t >= plan.start ? 1 : 0) : popIn(phase(t, plan.start, STEP_RISE));
      if (t >= plan.model) s.popIn();
      s.update(dt, t, this.reduced ? plan.model : plan.pick, this.reduced);
      flash = Math.max(flash, s.flash);
      shake = Math.max(shake, s.shake);
    }
    this.key.intensity = 2.3 * (1 + flash * 1.6);

    // The winner's finale: spotlight + glow + confetti, and a camera push.
    const sinceFinale = t - sched.finale;
    const finale = this.slots.some((s) => s.racer.place === 1) && sched.total > 0 && sinceFinale >= 0;
    const spotK = finale ? Math.min(1, sinceFinale / 0.5) : 0;
    this.spot.intensity = 70 * spotK;
    this.beamMat.opacity = 0.16 * spotK * (this.reduced ? 0.6 : 0.8 + 0.2 * Math.sin(t * 5));
    this.glowMat.opacity = 0.85 * spotK;
    this.beam.visible = this.glow.visible = spotK > 0;
    if (finale && !this.reduced && !this.confettiOn) this.startConfetti();
    if (this.confettiOn) this.updateConfetti(dt);

    this.updateCamera(dt, t, finale ? sinceFinale : -1, shake);
    if (this.resize()) this.renderer.render(this.scene, this.camera);
  }

  private startConfetti(): void {
    this.confettiOn = true;
    this.confettiT = 0;
    this.confetti.visible = true;
    const pos = (this.confetti.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      // Burst: fired up and outward from above the winner's step.
      pos[i * 3] = stepX(1) + (Math.random() - 0.5) * 0.8;
      pos[i * 3 + 1] = STEP_HEIGHT[1] + 1.5;
      pos[i * 3 + 2] = (Math.random() - 0.3) * 0.8;
      const a = Math.random() * TAU;
      const out = 1 + Math.random() * 3.2;
      this.confVel[i * 3] = Math.cos(a) * out;
      this.confVel[i * 3 + 1] = 3 + Math.random() * 4.5;
      this.confVel[i * 3 + 2] = Math.sin(a) * out * 0.6 + 0.6;
      this.confBurst[i] = 1;
    }
  }

  private updateConfetti(dt: number): void {
    this.confettiT += dt;
    const attr = this.confetti.geometry.getAttribute('position') as THREE.BufferAttribute;
    const pos = attr.array as Float32Array;
    const span = this.framing.halfWidth + 1.2;
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      const k = i * 3;
      if (this.confBurst[i]) {
        // Ballistic: gravity pulls it down, air drag slows the sideways drift.
        this.confVel[k + 1] -= 7 * dt;
        this.confVel[k] *= 1 - 0.8 * dt;
        this.confVel[k + 2] *= 1 - 0.8 * dt;
        if (this.confVel[k + 1] < -1.5) this.confVel[k + 1] = -1.5; // flutter down slowly
      }
      pos[k] += this.confVel[k] * dt + Math.sin(this.confettiT * 3 + i) * 0.004;
      pos[k + 1] += this.confVel[k + 1] * dt;
      pos[k + 2] += this.confVel[k + 2] * dt;
      if (pos[k + 1] < -0.2) {
        // Recycle as gentle rain from above (keeps the finish lively for the idle time).
        this.confBurst[i] = 0;
        pos[k] = this.framing.centerX + (Math.random() - 0.5) * 2 * span;
        pos[k + 1] = 5.5 + Math.random() * 1.5;
        pos[k + 2] = (Math.random() - 0.5) * 3;
        this.confVel[k] = (Math.random() - 0.5) * 0.4;
        this.confVel[k + 1] = -(0.9 + Math.random() * 0.9);
        this.confVel[k + 2] = 0;
      }
    }
    attr.needsUpdate = true;
  }

  private updateCamera(dt: number, t: number, sinceFinale: number, shake: number): void {
    const f = this.framing;
    const aspect = this.camera.aspect;
    const base = cameraDistance(f, aspect, FOV);
    // The push: closer on the winner while the finale plays, then back out a little.
    const push = sinceFinale >= 0 && !this.reduced ? (sinceFinale < 1.9 ? 1 : 0) : 0;
    this.zoom = chase(this.zoom, push ? 0.88 : 1, dt, 0.45);
    this.shift = chase(this.shift, push ? 1 : 0, dt, 0.45);
    // A slow sway so the podium never looks frozen.
    this.az = this.reduced ? 0 : 0.09 * Math.sin(t * 0.45);
    const el = 0.2;
    const dist = base * this.zoom;
    const ty = (f.maxHeight + 1.55) * 0.5 - 0.25;
    const tx = f.centerX + (stepX(1) - f.centerX) * 0.35 * this.shift;
    const sh = shake * 0.06;
    this.camera.position.set(
      tx + Math.sin(this.az) * dist + (Math.random() - 0.5) * sh,
      ty + Math.sin(el) * dist + (Math.random() - 0.5) * sh,
      Math.cos(this.az) * Math.cos(el) * dist,
    );
    this.camera.lookAt(tx, ty, 0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const s of this.slots) s.dispose();
    this.slots.length = 0;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.envTarget.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
