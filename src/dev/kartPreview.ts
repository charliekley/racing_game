/**
 * Dev page (/karts/): the kart garage. Shows every body (columns) with every
 * driver (rows) on slowly rotating turntables, so models can be inspected
 * without starting a race. Not used by the game itself.
 *
 * Controls: drag to orbit, wheel to zoom, right-drag to pan. The panel picks
 * body / driver / colour, camera presets, an environment map (to preview shiny
 * materials), the Low quality build, and demo poses for the driver animation.
 *
 * URL parameters (handy for screenshots): ?body=1&driver=3&colour=2&cam=front|side|three|back|top
 *   &focus=kart|driver&pose=drive|idle|left|right|drift|boost|trick|spin|cheer&env=1&low=1&spin=0&labels=0&markers=1
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { KART_COLORS } from '../shared/colors';
import { CHARACTERS } from '../shared/characters';
import { KART_STYLES, buildKartModel, kartTriangleCount, type KartModel } from '../render/kartModel';
import { DriverRig, IDLE_INPUT, type DriverInput } from '../render/kart/driverRig';

const COL_SPACING = 3.4;
const ROW_SPACING = 3.3;

const container = document.getElementById('view')!;
const labelLayer = document.getElementById('labels')!;
const stats = document.getElementById('stats')!;
const params = new URLSearchParams(location.search);

// --- State (the panel controls and the URL both write into this) -----------------------
const state = {
  body: Number(params.get('body') ?? -1), // -1 = all bodies
  driver: Number(params.get('driver') ?? -1), // -1 = all drivers
  colour: Number(params.get('colour') ?? -1), // -1 = a different colour per row
  env: params.get('env') === '1',
  low: params.get('low') === '1',
  spin: params.get('spin') !== '0',
  labels: params.get('labels') !== '0',
  markers: params.get('markers') === '1',
  pose: params.get('pose') ?? 'drive',
  cam: params.get('cam') ?? 'three',
  focus: params.get('focus') ?? 'kart',
  dist: Number(params.get('dist') ?? 0),
};

// --- Renderer, scene, lights -------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#cfeaff');
const hemi = new THREE.HemisphereLight('#e4f2ff', '#5d7f3a', 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff3dc', 2.4);
sun.position.set(8, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun);
scene.add(sun.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: '#7fae58' }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Environment map (a room-like scene turned into reflections) so glossy paint and chrome can be judged.
let envTex: THREE.Texture | null = null;
function applyEnv(): void {
  if (state.env && !envTex) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  }
  scene.environment = state.env ? envTex : null;
}

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;

// --- Karts -----------------------------------------------------------------------
interface Slot {
  model: KartModel;
  rig: DriverRig;
  turntable: THREE.Group;
  markers: THREE.Object3D[];
  label: HTMLElement;
  anchor: THREE.Vector3;
  phase: number;
}
let slots: Slot[] = [];
let cols: number[] = [];
let rows: number[] = [];
const turntableGeo = new THREE.CylinderGeometry(1.45, 1.45, 0.06, 40);
const turntableMat = new THREE.MeshStandardMaterial({ color: '#dfe3ec', roughness: 0.7 });
const exhaustMarkerGeo = new THREE.ConeGeometry(0.06, 0.25, 8).rotateX(-Math.PI / 2); // points along -Z
const exhaustMarkerMat = new THREE.MeshBasicMaterial({ color: '#ff7a00', depthTest: false });
const contactMarkerGeo = new THREE.SphereGeometry(0.07, 8, 6);
const contactMarkerMat = new THREE.MeshBasicMaterial({ color: '#ffee00', depthTest: false });

function colX(i: number): number {
  return (i - (cols.length - 1) / 2) * COL_SPACING;
}
function rowZ(j: number): number {
  return (j - (rows.length - 1) / 2) * ROW_SPACING;
}
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

function buildKarts(): void {
  for (const s of slots) {
    scene.remove(s.turntable);
    s.label.remove();
  }
  slots = [];
  cols = state.body >= 0 ? [state.body] : range(KART_STYLES.length);
  rows = state.driver >= 0 ? [state.driver] : range(CHARACTERS.length);
  rows.forEach((driver, j) => {
    cols.forEach((body, i) => {
      const colorIdx = state.colour >= 0 ? state.colour : (driver + body * 3) % KART_COLORS.length;
      const color = KART_COLORS[colorIdx % KART_COLORS.length].hex;
      const turntable = new THREE.Group();
      turntable.position.set(colX(i), 0, rowZ(j));
      const disc = new THREE.Mesh(turntableGeo, turntableMat);
      disc.position.y = -0.03;
      disc.receiveShadow = true;
      turntable.add(disc);

      const model = buildKartModel(color, body, driver, state.low ? 'low' : 'high');
      turntable.add(model.root);

      // Debug markers showing where boost flames and drift sparks would go.
      const markers: THREE.Object3D[] = [];
      for (const ex of model.exhausts) {
        const m = new THREE.Mesh(exhaustMarkerGeo, exhaustMarkerMat);
        m.renderOrder = 10;
        ex.add(m);
        markers.push(m);
      }
      for (const c of model.rearWheelContacts) {
        const m = new THREE.Mesh(contactMarkerGeo, contactMarkerMat);
        m.renderOrder = 10;
        m.position.copy(c);
        model.root.add(m);
        markers.push(m);
      }
      markers.forEach((m) => (m.visible = state.markers));

      const label = document.createElement('div');
      label.className = 'label';
      label.innerHTML = `<b>${CHARACTERS[driver].name}</b><span>${KART_STYLES[body].name}</span>`;
      label.style.display = state.labels ? '' : 'none';
      labelLayer.appendChild(label);

      scene.add(turntable);
      slots.push({ model, rig: new DriverRig(model), turntable, markers, label, anchor: new THREE.Vector3(colX(i), 2.0, rowZ(j)), phase: (i + j * 2) * 0.7 });
    });
  });
  applyCamPreset(false);
  const first = slots[0];
  let meshes = 0;
  first.model.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !first.markers.includes(o)) meshes++;
  });
  const tris = kartTriangleCount(first.model.style, first.model.character, state.low ? 'low' : 'high');
  stats.textContent = `${slots.length} karts · ${meshes} draw calls per kart · ~${Math.round(tris / 100) / 10}k triangles per kart (first one)`;
}

// --- Camera presets ------------------------------------------------------------------
/** Kart yaw for each preset: the camera stays put and the karts turn, so every kart in the grid shows the same side. */
const CAM_YAW: Record<string, number> = { front: 0, side: Math.PI / 2, three: Math.PI / 4, back: Math.PI, top: Math.PI / 4 };

function applyCamPreset(keepControls: boolean): void {
  if (!slots.length) return;
  const w = (cols.length - 1) * COL_SPACING + 3;
  const d = (rows.length - 1) * ROW_SPACING + 3;
  const single = slots.length === 1;
  const targetY = state.focus === 'driver' ? 1.0 : 0.75;
  const target = new THREE.Vector3(0, targetY, 0);
  const fov = (camera.fov * Math.PI) / 180;
  const span = Math.max(w / camera.aspect, d, 3);
  let dist = single ? (state.focus === 'driver' ? 2.8 : 5.6) : (span / 2 / Math.tan(fov / 2)) * 0.8 + 1.5;
  if (state.dist > 0) dist = state.dist;
  const elev = state.cam === 'top' ? 1.35 : single ? 0.22 : 0.62;
  if (!keepControls || true) {
    // In single view the camera always looks from +Z (karts are turned instead).
    camera.position.set(0, target.y + Math.sin(elev) * dist, Math.cos(elev) * dist);
    controls.target.copy(target);
  }
  const yaw = CAM_YAW[state.cam] ?? 0;
  if (state.cam !== 'orbit') {
    for (const s of slots) s.turntable.rotation.y = yaw;
  }
  controls.update();
}

// --- Labels (HTML, positioned over each kart every frame) ---------------------------
const _v = new THREE.Vector3();
function placeLabels(): void {
  if (!state.labels) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  for (const s of slots) {
    _v.copy(s.anchor).project(camera);
    const show = _v.z < 1;
    s.label.style.display = show ? '' : 'none';
    s.label.style.left = `${((_v.x + 1) / 2) * w}px`;
    s.label.style.top = `${((1 - _v.y) / 2) * h}px`;
  }
}

// --- Resize ----------------------------------------------------------------------------
function resize(): void {
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', () => {
  resize();
  applyCamPreset(false);
});

// --- Panel ------------------------------------------------------------------------------
function fillSelect(id: string, options: [string, string][], value: string, onChange: (v: string) => void): void {
  const el = document.getElementById(id) as HTMLSelectElement;
  el.innerHTML = options.map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
  el.value = value;
  el.addEventListener('change', () => onChange(el.value));
}
fillSelect('body', [['-1', 'All bodies'], ...KART_STYLES.map((s, i): [string, string] => [String(i), s.name])], String(state.body), (v) => {
  state.body = Number(v);
  buildKarts();
});
fillSelect('driver', [['-1', 'All drivers'], ...CHARACTERS.map((c, i): [string, string] => [String(i), c.name])], String(state.driver), (v) => {
  state.driver = Number(v);
  buildKarts();
});
fillSelect('colour', [['-1', 'Mixed colours'], ...KART_COLORS.map((c, i): [string, string] => [String(i), c.name ?? `Colour ${i + 1}`])], String(state.colour), (v) => {
  state.colour = Number(v);
  buildKarts();
});
fillSelect(
  'cam',
  [['three', '3/4 view'], ['front', 'Front'], ['side', 'Side'], ['back', 'Back'], ['top', 'Top'], ['orbit', 'Free orbit']],
  state.cam,
  (v) => {
    state.cam = v;
    state.spin = v === 'orbit';
    syncButtons();
    applyCamPreset(false);
  },
);
fillSelect(
  'pose',
  ['drive', 'idle', 'left', 'right', 'drift', 'boost', 'trick', 'spin', 'cheer'].map((p): [string, string] => [p, `Pose: ${p}`]),
  state.pose,
  (v) => (state.pose = v),
);
fillSelect('focus', [['kart', 'Frame: kart'], ['driver', 'Frame: driver']], state.focus, (v) => {
  state.focus = v;
  applyCamPreset(false);
});
function toggle(id: string, key: 'env' | 'low' | 'spin' | 'labels' | 'markers', onOn: string, onOff: string, after?: () => void): void {
  const btn = document.getElementById(id)!;
  const sync = () => (btn.textContent = state[key] ? onOn : onOff);
  sync();
  btn.addEventListener('click', () => {
    state[key] = !state[key];
    sync();
    after?.();
  });
  syncers.push(sync);
}
const syncers: (() => void)[] = [];
const syncButtons = () => syncers.forEach((f) => f());
toggle('env', 'env', 'Env map: on', 'Env map: off', applyEnv);
toggle('low', 'low', 'Quality: Low', 'Quality: High', buildKarts);
toggle('spin', 'spin', 'Pause spin', 'Spin', () => {
  if (state.spin) state.cam = 'orbit';
});
toggle('labels', 'labels', 'Labels: on', 'Labels: off', () => slots.forEach((s) => (s.label.style.display = state.labels ? '' : 'none')));
toggle('markers', 'markers', 'Hide effect markers', 'Show effect markers', () => slots.forEach((s) => s.markers.forEach((m) => (m.visible = state.markers))));

// --- Demo poses: synthetic driver input per pose ---------------------------------------
const input: DriverInput = { ...IDLE_INPUT };
let trickT = 0;
function poseInput(pose: string, t: number, dt: number): DriverInput {
  Object.assign(input, IDLE_INPUT);
  input.speed01 = 0.6;
  switch (pose) {
    case 'drive': {
      const s = Math.sin(t * 0.9) * 0.8;
      input.steer = s;
      input.bodyRoll = -s * 0.1;
      break;
    }
    case 'left':
      input.steer = -1;
      input.bodyRoll = 0.1;
      break;
    case 'right':
      input.steer = 1;
      input.bodyRoll = -0.1;
      break;
    case 'drift':
      input.steer = 1;
      input.drift = 1;
      input.bodyRoll = -0.12;
      break;
    case 'boost':
      input.boosting = true;
      input.accel = 1;
      break;
    case 'trick':
      trickT = (trickT + dt / 0.9) % 1.6;
      input.airborne = trickT < 1.3;
      input.trick = trickT < 1 ? trickT : -1;
      break;
    case 'spin':
      input.spun = true;
      break;
    case 'cheer':
      input.celebrate = true;
      break;
    default:
      break;
  }
  return input;
}

// --- Loop ------------------------------------------------------------------------------
resize();
applyEnv();
buildKarts();
const clock = new THREE.Clock();
let t = 0;
/** One animation step (also callable from scripts: __preview.step(frames, dt)). */
function frame(dtIn: number): void {
  const dt = dtIn;
  t += dt;
  const inp = poseInput(state.pose, t, dt);
  for (const s of slots) {
    if (state.spin && state.cam === 'orbit') s.turntable.rotation.y += dt * 0.35;
    // Moving parts: wheels roll, front wheels steer, body leans, the driver reacts.
    for (const w of s.model.wheels) w.rotation.x += dt * 4;
    for (const p of s.model.frontPivots) p.rotation.y = -inp.steer * 0.45;
    s.model.body.rotation.z = inp.bodyRoll;
    s.rig.update(dt, inp);
  }
  controls.update();
  sun.target.position.copy(controls.target);
  sun.position.copy(controls.target).add(new THREE.Vector3(8, 14, 6));
  const ext = Math.max(8, cols.length * COL_SPACING * 0.7, rows.length * ROW_SPACING * 0.7);
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 50 });
  sun.shadow.camera.updateProjectionMatrix();
  // With an environment map the sky already lights the karts, so turn the plain lights down.
  hemi.intensity = state.env ? 0.5 : 1.6;
  sun.intensity = state.env ? 1.4 : 2.4;
  renderer.render(scene, camera);
  placeLabels();
}
renderer.setAnimationLoop(() => frame(Math.min(clock.getDelta(), 0.1)));

// Tiny hook for scripted screenshots.
(window as unknown as { __preview: unknown }).__preview = {
  state,
  rebuild: buildKarts,
  applyEnv,
  camera,
  controls,
  fit: () => applyCamPreset(false),
  /** Advance the animation by `frames` steps of `dt` seconds (the loop is paused when the tab is hidden). */
  step: (frames: number, dt = 1 / 60) => {
    for (let i = 0; i < frames; i++) frame(dt);
  },
  /** Render one frame right now (the animation loop can be paused in a hidden tab). */
  render: () => {
    controls.update();
    renderer.render(scene, camera);
  },
};
