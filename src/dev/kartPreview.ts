/**
 * Dev page (/karts/): shows every kart style side by side on slowly rotating
 * turntables, in a few player colors, so models can be checked without
 * starting a race. Not used by the game itself.
 *
 * Columns = styles (KART_STYLES), rows = colors.
 */
import * as THREE from 'three';
import { KART_COLORS } from '../shared/colors';
import { KART_STYLES, buildKartModel, type KartModel } from '../render/kartModel';

const ROWS = 3;
const COL_SPACING = 3.2;
const ROW_SPACING = 3.4;

const container = document.getElementById('view')!;
const labelLayer = document.getElementById('labels')!;
const stats = document.getElementById('stats')!;

// --- Renderer, scene, lights -------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#cfeaff');
scene.add(new THREE.HemisphereLight('#e4f2ff', '#5d7f3a', 1.6));
const sun = new THREE.DirectionalLight('#fff3dc', 2.4);
sun.position.set(8, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
sun.shadow.bias = -0.0005;
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ color: '#7fae58' }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);

// --- Karts -----------------------------------------------------------------------
interface Slot {
  model: KartModel;
  turntable: THREE.Group;
  markers: THREE.Object3D[];
}
const slots: Slot[] = [];
const turntableGeo = new THREE.CylinderGeometry(1.3, 1.3, 0.06, 32);
const turntableMat = new THREE.MeshLambertMaterial({ color: '#d9dde6' });
const exhaustMarkerGeo = new THREE.ConeGeometry(0.06, 0.25, 8).rotateX(-Math.PI / 2); // points along -Z
const exhaustMarkerMat = new THREE.MeshBasicMaterial({ color: '#ff7a00', depthTest: false });
const contactMarkerGeo = new THREE.SphereGeometry(0.07, 8, 6);
const contactMarkerMat = new THREE.MeshBasicMaterial({ color: '#ffee00', depthTest: false });

let colorOffset = 0;
let showMarkers = false;

function colX(col: number): number {
  return (col - (KART_STYLES.length - 1) / 2) * COL_SPACING;
}
function rowZ(row: number): number {
  return (row - (ROWS - 1) / 2) * ROW_SPACING;
}

/** (Re)build all karts with the current color offset. */
function buildKarts(): void {
  for (const s of slots) scene.remove(s.turntable);
  slots.length = 0;
  for (let row = 0; row < ROWS; row++) {
    const color = KART_COLORS[(colorOffset + row) % KART_COLORS.length].hex;
    for (let col = 0; col < KART_STYLES.length; col++) {
      const turntable = new THREE.Group();
      turntable.position.set(colX(col), 0, rowZ(row));
      const disc = new THREE.Mesh(turntableGeo, turntableMat);
      disc.position.y = -0.03;
      disc.receiveShadow = true;
      turntable.add(disc);

      const model = buildKartModel(color, col);
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
      markers.forEach((m) => (m.visible = showMarkers));

      turntable.rotation.y = col * 0.6 + row * 1.3;
      scene.add(turntable);
      slots.push({ model, turntable, markers });
    }
  }
  // Draw calls for one kart = number of meshes in it (ignoring the debug markers).
  let meshes = 0;
  slots[0].model.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !slots[0].markers.includes(o)) meshes++;
  });
  stats.dataset.perKart = String(meshes);
}

// --- Labels (HTML, positioned over each column every frame) -------------------------
const labels = KART_STYLES.map((s) => {
  const el = document.createElement('div');
  el.className = 'label';
  el.innerHTML = `<b>${s.name}</b><span>${s.blurb}</span>`;
  labelLayer.appendChild(el);
  return el;
});
const _v = new THREE.Vector3();

function placeLabels(): void {
  const w = container.clientWidth;
  const h = container.clientHeight;
  KART_STYLES.forEach((_, col) => {
    _v.set(colX(col), 2.2, rowZ(0)).project(camera);
    labels[col].style.left = `${((_v.x + 1) / 2) * w}px`;
    labels[col].style.top = `${((1 - _v.y) / 2) * h}px`;
  });
}

// --- Resize: back the camera off on narrow (portrait) screens --------------------------
function resize(): void {
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  const dist = 15 * Math.max(1, 1.5 / camera.aspect);
  camera.position.set(0, dist * 0.55, dist);
  camera.lookAt(0, 0.4, 0.6);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// --- Buttons ---------------------------------------------------------------------
let spinning = true;
document.getElementById('colors')!.addEventListener('click', () => {
  colorOffset = (colorOffset + ROWS) % KART_COLORS.length;
  buildKarts();
});
const spinBtn = document.getElementById('spin')!;
spinBtn.addEventListener('click', () => {
  spinning = !spinning;
  spinBtn.textContent = spinning ? 'Pause spin' : 'Resume spin';
});
const markerBtn = document.getElementById('markers')!;
markerBtn.addEventListener('click', () => {
  showMarkers = !showMarkers;
  markerBtn.textContent = showMarkers ? 'Hide effect markers' : 'Show effect markers';
  for (const s of slots) s.markers.forEach((m) => (m.visible = showMarkers));
});

// --- Loop ------------------------------------------------------------------------
buildKarts();
resize();
const clock = new THREE.Clock();
let t = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  t += dt;
  for (const s of slots) {
    if (spinning) s.turntable.rotation.y += dt * 0.35;
    // Show off the moving parts: wheels roll, front wheels steer, body leans.
    for (const w of s.model.wheels) w.rotation.x += dt * 4;
    const steer = Math.sin(t * 0.9) * 0.4;
    for (const p of s.model.frontPivots) p.rotation.y = steer;
    s.model.body.rotation.z = -steer * 0.2;
  }
  renderer.info.autoReset = false;
  renderer.info.reset();
  renderer.render(scene, camera);
  placeLabels();
  stats.textContent = `${slots.length} karts · ${stats.dataset.perKart} meshes (draw calls) per kart · ${renderer.info.render.calls} draw calls this frame incl. shadows`;
});
