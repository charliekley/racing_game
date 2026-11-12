/**
 * Draws the wind gusts of Cloud Garden (the rules live in sim/hazards/gust.ts).
 *
 * Two things make the wind readable without any text, from every camera:
 *   WIND STREAKS  thin glowing lines that sweep across the bridge in the direction of the wind. In the warning
 *                 (about 1.5 s) a few appear and more and more come; while the gust blows there are many, fast and bright.
 *   WINDSOCKS     an orange and white sock on a pole at each end of the stretch, standing on the downwind edge (the edge
 *                 you will be pushed toward). It hangs limp when there is no wind, lifts and flutters in the warning, and
 *                 stands out straight, pointing downwind, while the gust blows.
 * Everything is a pure function of the (interpolated) race time; no particles, no random numbers.
 *
 * 3D concepts used here:
 *  - INSTANCING: all streaks of all gusts are ONE `InstancedMesh` (one draw call), all windsocks another, the poles a third.
 *  - A streak is two thin crossed ribbons whose vertex colours fade to black at both ends. With ADDITIVE blending black adds
 *    nothing, so the ends fade out smoothly without needing transparency sorting. The per-instance colour is a brightness
 *    multiplier above 1 (HDR), so the bloom post-process makes them glow.
 *  - Quality: Low draws fewer streaks (`mesh.count`) and skips the flutter.
 */
import * as THREE from 'three';
import { Gust } from '../../sim/hazards/gust';
import type { Hazard } from '../../sim/hazards/types';
import type { QualitySettings } from '../scene';

// ---------------------------------------------------------------------------------
// The look as a pure function (no Three.js: easy to test)
// ---------------------------------------------------------------------------------

export interface GustLook {
  /** Share of the streaks that are visible (0..1) and their brightness multiplier (HDR: above 1 blooms). */
  streakShare: number;
  streakGlow: number;
  /** Speed of a streak across the bridge, in crossings per second. */
  streakSpeed: number;
  /** Angle (rad) the windsock hangs below the horizontal: pi/2 limp, 0 standing out straight. */
  sockDroop: number;
  /** Flutter amplitude (rad) of the sock. */
  flutter: number;
}

const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** How a gust looks at one moment. `phase`/`t` come from `Hazard.pose(time)`, `wind` is its 0..1 strength (see gustEnvelope). */
export function gustLook(phase: string, t: number, wind: number): GustLook {
  if (phase === 'warn') {
    // The wind is picking up: a few faint streaks, more and more of them, and the sock lifts.
    return { streakShare: 0.1 + 0.5 * t, streakGlow: 1.0 + 1.4 * t, streakSpeed: 0.4 + 0.4 * t, sockDroop: 1.3 - 0.7 * smooth(0, 1, t), flutter: 0.05 + 0.1 * t };
  }
  if (phase === 'active') {
    return { streakShare: 0.5 + 0.5 * wind, streakGlow: 2.4 + 2.6 * wind, streakSpeed: 0.8 + 0.9 * wind, sockDroop: 0.6 - 0.5 * wind, flutter: 0.06 + 0.1 * wind };
  }
  return { streakShare: 0, streakGlow: 0, streakSpeed: 0.3, sockDroop: 1.3, flutter: 0.04 };
}

// ---------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------

/** A tiny deterministic hash -> 0..1, so every streak is in the same place on every run. */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * A wind streak of length 1 along X: two crossed ribbons (one flat, one upright) so it shows from any side.
 * Vertex colour is white in the middle and black at the ends (additive blending: black = nothing).
 */
function streakGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const w = 0.17;
  for (const upright of [false, true]) {
    const base = pos.length / 3;
    for (const [x, c] of [[-0.5, 0], [-0.15, 1], [0.5, 0]] as const) {
      for (const side of [-1, 1]) {
        pos.push(x, upright ? side * w : 0, upright ? 0 : side * w);
        col.push(c, c, c);
      }
    }
    for (let i = 0; i < 2; i++) {
      const k = base + i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** A windsock along +X from the pole (open end, radius 0.5) to its tip (radius 0.22), length 2.6, in orange and white bands. */
function sockGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.22, 0.5, 2.6, 10, 5, true);
  g.rotateZ(Math.PI / 2); // axis from Y to X: the wide end (bottom radius) ends up at -X
  g.rotateY(Math.PI); // ...then swap, so the wide end is at x = 0 (the pole) and the narrow tip at +X
  g.translate(1.3, 0, 0);
  const p = g.getAttribute('position');
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const band = Math.floor((p.getX(i) / 2.6) * 5 - 0.001);
    const orange = band % 2 === 0;
    colors.set(orange ? [1, 0.42, 0.08] : [0.95, 0.95, 0.92], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

// ---------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------

/** Streaks per gust on High (Medium 60 %, Low 35 %). */
const STREAKS = 16;
/** Height of the sock poles (m) and the lateral overshoot of the streaks beyond the deck edge (m). */
const POLE_HEIGHT = 4.6;
const STREAK_OVERSHOOT = 4;

interface Streak {
  /** Centre of the stretch cross-section it flies in: world position and the road's "right" unit vector (horizontal). */
  x: number;
  y: number;
  z: number;
  rx: number;
  rz: number;
  /** Yaw so that local X lies along the wind. */
  yaw: number;
  h1: number;
  h2: number;
  h3: number;
}
interface SockSpot {
  x: number;
  y: number;
  z: number;
  /** Wind direction (unit, horizontal). */
  wx: number;
  wz: number;
  seed: number;
}
interface GustSlot {
  hazard: Gust;
  firstStreak: number;
  firstSock: number;
}

export class GustView {
  private readonly slots: GustSlot[] = [];
  private readonly streaks: Streak[] = [];
  private readonly socks: SockSpot[] = [];
  private readonly streakMesh: THREE.InstancedMesh;
  private readonly sockMesh: THREE.InstancedMesh;
  private readonly poleMesh: THREE.InstancedMesh;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private share = 1;
  private flutterOn = true;
  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scl = new THREE.Vector3(1, 1, 1);
  private readonly tint = new THREE.Color();
  private readonly X = new THREE.Vector3();
  private readonly Y = new THREE.Vector3();
  private readonly Z = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    hazards: Hazard[],
    quality: QualitySettings,
  ) {
    const gusts = hazards.filter((h): h is Gust => h instanceof Gust);
    for (const gust of gusts) {
      const slot: GustSlot = { hazard: gust, firstStreak: this.streaks.length, firstSock: this.socks.length };
      const track = gust.track;
      const len = gust.s1 - gust.s0;
      for (let i = 0; i < STREAKS; i++) {
        const h1 = hash(gust.id * 100 + i * 3 + 1);
        const h2 = hash(gust.id * 100 + i * 3 + 2);
        const h3 = hash(gust.id * 100 + i * 3 + 3);
        // Spread evenly along the stretch with a little jitter, at different heights above the deck.
        const u = (i + h1) / STREAKS;
        const p = track.pointAt(gust.s0 + u * len, 0);
        const rx = -Math.cos(p.heading);
        const rz = Math.sin(p.heading);
        this.streaks.push({ x: p.x, y: p.y + 0.5 + h2 * 3, z: p.z, rx, rz, yaw: Math.atan2(-rz * gust.dir, rx * gust.dir), h1, h2, h3 });
      }
      // A windsock at each end of the stretch, on the downwind edge of the deck.
      for (const [k, at] of [[0, gust.s0 + 3], [1, gust.s1 - 3]] as const) {
        const p = track.pointAt(at, 0);
        const rx = -Math.cos(p.heading);
        const rz = Math.sin(p.heading);
        const edge = gust.halfWidth + 0.2;
        this.socks.push({ x: p.x + rx * gust.dir * edge, y: p.y + POLE_HEIGHT, z: p.z + rz * gust.dir * edge, wx: rx * gust.dir, wz: rz * gust.dir, seed: gust.id * 7 + k });
      }
      this.slots.push(slot);
    }

    const streakGeo = streakGeometry();
    const streakMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.streakMesh = new THREE.InstancedMesh(streakGeo, streakMat, Math.max(1, this.streaks.length));
    const sockGeo = sockGeometry();
    const sockMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.sockMesh = new THREE.InstancedMesh(sockGeo, sockMat, Math.max(1, this.socks.length));
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.1, POLE_HEIGHT, 6);
    const poleMat = new THREE.MeshBasicMaterial({ color: '#e9edf2' });
    this.poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, Math.max(1, this.socks.length));
    this.geos.push(streakGeo, sockGeo, poleGeo);
    this.mats.push(streakMat, sockMat, poleMat);
    for (const mesh of [this.streakMesh, this.sockMesh, this.poleMesh]) {
      mesh.frustumCulled = false; // spread over the whole track
      scene.add(mesh);
    }
    this.streakMesh.renderOrder = 12;
    this.streakMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sockMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.socks.forEach((s, i) => {
      this.pos.set(s.x, s.y - POLE_HEIGHT / 2, s.z);
      this.poleMesh.setMatrixAt(i, this.m.compose(this.pos, this.quat.identity(), this.scl.set(1, 1, 1)));
    });
    this.poleMesh.instanceMatrix.needsUpdate = true;
    this.setQuality(quality);
    this.update(0);
  }

  /** Low quality: fewer streaks, no flutter. */
  setQuality(q: QualitySettings): void {
    this.share = q.name === 'High' ? 1 : q.name === 'Medium' ? 0.6 : 0.35;
    this.flutterOn = q.name !== 'Low';
  }

  /** Pose every gust at race time `time` (s). */
  update(time: number): void {
    for (const slot of this.slots) {
      const pose = slot.hazard.pose(time);
      const look = gustLook(String(pose.phase), pose.t as number, pose.wind as number);
      const dir = slot.hazard.dir;
      const halfWidth = slot.hazard.halfWidth;
      const reach = halfWidth + STREAK_OVERSHOOT;
      for (let i = 0; i < STREAKS; i++) {
        const st = this.streaks[slot.firstStreak + i];
        const idx = slot.firstStreak + i;
        // A streak is visible when it is among the share of streaks the look asks for (and not cut by quality).
        const visible = look.streakShare > 0 && (i * 0.61803) % 1 < this.share && st.h2 < look.streakShare;
        if (!visible) {
          this.m.makeScale(0, 0, 0);
          this.streakMesh.setMatrixAt(idx, this.m);
          continue;
        }
        // Sweeps from the upwind side to the downwind side; `f` is how far across it is (0..1), restarting forever.
        const f = (st.h3 + time * look.streakSpeed * (0.8 + 0.5 * st.h1)) % 1;
        const lateral = dir * (-reach + 2 * reach * f);
        const len = 5 + 4 * st.h1;
        // Fade in at the start and out at the end of the sweep so streaks do not pop.
        const fade = Math.min(1, f / 0.12, (1 - f) / 0.2);
        this.pos.set(st.x + st.rx * lateral, st.y, st.z + st.rz * lateral);
        this.quat.setFromAxisAngle(this.Y.set(0, 1, 0), st.yaw);
        this.m.compose(this.pos, this.quat, this.scl.set(len, 1, 1));
        this.streakMesh.setMatrixAt(idx, this.m);
        const g = look.streakGlow * fade;
        this.tint.setRGB(0.75 * g, 0.9 * g, 1.0 * g, THREE.LinearSRGBColorSpace);
        this.streakMesh.setColorAt(idx, this.tint);
      }
      // Windsocks: pitched down by `droop`, pointing along the wind, fluttering a little.
      for (let k = 0; k < 2; k++) {
        const idx = slot.firstSock + k;
        const s = this.socks[idx];
        const flutter = this.flutterOn ? look.flutter * Math.sin(time * (9 + s.seed) + s.seed * 2) : 0;
        const droop = Math.min(1.45, Math.max(0, look.sockDroop + flutter));
        this.X.set(s.wx * Math.cos(droop), -Math.sin(droop), s.wz * Math.cos(droop)); // the sock's axis
        this.Z.crossVectors(this.X, this.Y.set(0, 1, 0)).normalize();
        this.Y.crossVectors(this.Z, this.X);
        this.m.makeBasis(this.X, this.Y, this.Z).setPosition(s.x, s.y, s.z);
        this.sockMesh.setMatrixAt(idx, this.m);
      }
    }
    this.streakMesh.instanceMatrix.needsUpdate = true;
    if (this.streakMesh.instanceColor) this.streakMesh.instanceColor.needsUpdate = true;
    this.sockMesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.streakMesh, this.sockMesh, this.poleMesh]) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
