/**
 * Draws the acorn beetles of Autumn Speedway (the rules live in sim/hazards/beetle.ts).
 *
 * An original creature: a round, glossy chestnut-brown body with a scaly ACORN-CAP shell on its back (with
 * a little stalk on top), a dark head with two big friendly eyes and curly antennae, and six thin legs.
 *
 * The sim says where each beetle is at any race time (`pose(time)`); this file only dresses it up:
 *   - it FACES the way it walks and turns round smoothly at each end of its march (it faces along the
 *     road for a moment while it turns),
 *   - it WALKS with a real "tripod gait": the six legs are split in two groups of three (front-left, middle-right,
 *     rear-left and the other three). While one group swings forward in the air, the other pushes back on the
 *     ground; every leg swings about its own hip. The step rate follows the distance walked (a pedometer), so the
 *     feet never seem to slide, and the beetle slows its legs down when it slows down to turn,
 *   - the body bobs and rocks a little with every step.
 *
 * 3D concepts: InstancedMeshes: every beetle is one instance of the body and one instance of each of the six legs,
 * so all beetles together cost 7 draw calls. The models are built once at radius 1 and scaled by the sim's radius.
 * Each leg is modelled with its HIP at the origin; to swing it we multiply the beetle's matrix by
 * "move to the hip, then rotate": that is how a joint works in a hierarchy (parent matrix x local matrix).
 */
import * as THREE from 'three';
import type { Hazard } from '../../sim/hazards/types';
import { blobGeo, matrix, merge, paint, tubeGeo } from '../env/geo';
import { noise3, smoothstep } from '../env/noise';
import type { QualitySettings } from '../scene';

const _c = new THREE.Color();
const CREAM = new THREE.Color('#ffd9a0');
const PAW = new THREE.Color('#4a2c18');

/** The body: chestnut nut, acorn-cap shell, stalk, head, eyes and antennae, at radius 1, facing +z. */
function bodyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Glossy nut body (slightly egg-shaped, the wide end at the back), a little lighter on top (a sheen baked in).
  const nut = blobGeo(3, 7, 0.03, 1.5, noise3).applyMatrix4(matrix(0, 0.62, -0.05, 0.92, 0.6, 1.12));
  parts.push(paint(nut, (p) => _c.set('#7a3e17').multiplyScalar(0.7 + 0.5 * THREE.MathUtils.clamp(p.y - 0.25, 0, 1))));
  // Acorn cap shell: a dome over the top with a scale (cross-hatch) pattern in two browns, a dark seam down the
  // back (where the wing covers meet), a dark rim at its lower edge and a bright "sheen" patch on the upper left.
  const cap = blobGeo(3, 3, 0.04, 1.2, noise3).applyMatrix4(matrix(0, 0.86, -0.12, 1.0, 0.55, 1.18));
  parts.push(
    paint(cap, (p, n) => {
      const hatch = Math.sin(p.x * 14 + p.z * 9) * Math.sin(p.x * 9 - p.z * 14) > 0.1 ? 1 : 0;
      _c.set(hatch ? '#b8854a' : '#8a5a2c').multiplyScalar(0.8 + 0.35 * THREE.MathUtils.clamp(p.y - 0.8, 0, 1));
      const seam = smoothstep(0.07, 0.0, Math.abs(p.x)) * smoothstep(0.7, 0.9, p.y);
      const rim = smoothstep(0.78, 0.6, p.y);
      _c.multiplyScalar(1 - 0.55 * seam - 0.45 * rim);
      // Shell sheen: a warm highlight where the surface faces up and toward the light (upper left, front).
      const shine = smoothstep(0.55, 0.95, n.y * 0.8 - n.x * 0.5 + n.z * 0.2);
      return _c.lerp(CREAM, shine * 0.45);
    }),
  );
  // The little stalk on top of the cap.
  parts.push(paint(tubeGeo([new THREE.Vector3(0, 1.3, -0.2), new THREE.Vector3(0.05, 1.55, -0.28), new THREE.Vector3(0.12, 1.65, -0.42)], [0.09, 0.07, 0.05], 6), () => _c.set('#5a3a1e')));
  // Head with two big eyes (white with a dark pupil) and curly antennae.
  parts.push(paint(blobGeo(2, 5, 0.02, 1, noise3).applyMatrix4(matrix(0, 0.55, 1.08, 0.46, 0.4, 0.4)), () => _c.set('#2e1c12')));
  for (const side of [-1, 1]) {
    parts.push(paint(blobGeo(1, 9, 0, 1, noise3).applyMatrix4(matrix(side * 0.2, 0.7, 1.36, 0.15, 0.17, 0.12)), () => _c.set('#f4efe6')));
    parts.push(paint(blobGeo(1, 9, 0, 1, noise3).applyMatrix4(matrix(side * 0.22, 0.71, 1.46, 0.07, 0.09, 0.05)), () => _c.set('#111111')));
    const ant = [new THREE.Vector3(side * 0.12, 0.85, 1.2), new THREE.Vector3(side * 0.3, 1.25, 1.45), new THREE.Vector3(side * 0.5, 1.45, 1.35), new THREE.Vector3(side * 0.55, 1.4, 1.2)];
    parts.push(paint(tubeGeo(ant, [0.04, 0.035, 0.03, 0.02], 4), () => _c.set('#2e1c12')));
  }
  return merge(parts);
}

/** Where each hip is (relative to the body centre, radius 1) and which gait group the leg belongs to. */
interface LegSpec {
  hip: THREE.Vector3;
  /** +1 = right side, -1 = left side. */
  side: number;
  /** Tripod gait: group 0 and group 1 move in opposite phase. */
  group: 0 | 1;
}
const LEGS: LegSpec[] = [];
for (const side of [-1, 1]) {
  [0.6, 0.05, -0.55].forEach((z, k) => {
    // Tripod: front-left + middle-right + rear-left move together (group 0), the other three the opposite way.
    const group = ((k + (side > 0 ? 1 : 0)) % 2) as 0 | 1;
    LEGS.push({ hip: new THREE.Vector3(side * 0.7, 0.45, z), side, group });
  });
}

/** One leg with its HIP at the origin (bent at the knee, foot on the ground 0.45 below the hip). */
function legGeometry(leg: LegSpec): THREE.BufferGeometry {
  const zs = Math.sign(leg.hip.z) || 0.3; // front legs reach forward, rear legs backward, the middle one straight out
  const knee = new THREE.Vector3(leg.side * 0.55, 0.15, 0.15 * zs);
  const foot = new THREE.Vector3(leg.side * 0.7, -0.45, 0.3 * zs);
  const paw = new THREE.Vector3(leg.side * 0.74, -0.45, 0.34 * zs);
  return paint(tubeGeo([new THREE.Vector3(0, 0, 0), knee, foot, paw], [0.09, 0.07, 0.05, 0.05], 5), (p) => _c.set('#24150c').lerp(PAW, THREE.MathUtils.clamp((p.y + 0.45) / 0.6, 0, 1) * 0.5));
}

export class BeetleView {
  private readonly body: THREE.InstancedMesh;
  private readonly legs: THREE.InstancedMesh[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly base = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scl = new THREE.Vector3();
  private readonly legPos = new THREE.Vector3();
  private readonly legQuat = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly fwd = new THREE.Vector3(0, 0, 1);
  /** Per beetle: how far it has walked so far (m, a pedometer) and where it was last frame. */
  private readonly walked: number[];
  private readonly last: { x: number; z: number; t: number }[];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly hazards: Hazard[],
    _quality: QualitySettings,
  ) {
    // Glossy lacquered shell: a clear-coat layer on top of the body colour reflects the sky (the nut-brown "sheen").
    const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.05, clearcoat: 0.9, clearcoatRoughness: 0.18 });
    this.body = new THREE.InstancedMesh(bodyGeometry(), mat, hazards.length);
    const legMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    for (const leg of LEGS) this.legs.push(new THREE.InstancedMesh(legGeometry(leg), legMat, hazards.length));
    for (const mesh of [this.body, ...this.legs]) {
      mesh.frustumCulled = false; // spread along the track
      mesh.castShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
    }
    this.walked = hazards.map(() => 0);
    this.last = hazards.map(() => ({ x: Number.NaN, z: 0, t: 0 }));
    this.update(0);
  }

  setQuality(_q: QualitySettings): void {}

  /** Pose every beetle at race time `time` (s). */
  update(time: number): void {
    this.hazards.forEach((h, i) => {
      const p = h.pose(time);
      const r = Number(p.radius);
      const pace = Number(p.pace);
      const rx = Number(p.rx);
      const rz = Number(p.rz);
      const x = Number(p.x);
      const z = Number(p.z);
      // Pedometer: add the distance walked since the last frame (ignore jumps, e.g. a restart or a long pause).
      const last = this.last[i];
      if (Number.isFinite(last.x)) {
        const d = Math.hypot(x - last.x, z - last.z);
        if (d < 3 * r) this.walked[i] += d;
      }
      last.x = x;
      last.z = z;
      // Facing: towards +right while walking right, -right while walking left; while it slows down to turn
      // round (pace near 0) it swings through "along the road", so the turn is smooth.
      const dir = Number(p.dirX) * rx + Number(p.dirZ) * rz >= 0 ? 1 : -1;
      const sTurn = dir * Math.min(1, pace / 0.3); // -1..1
      const right = Math.atan2(rx, rz); // heading of the road's right vector (rotation.y convention: +z forward)
      const yaw = right + (Math.PI * (1 - sTurn)) / 2;
      // Gait phase: one full leg cycle per 1.3 body radii walked. It keeps counting while the beetle turns on the spot
      // very slowly, so the legs shuffle a little then (a walking creature does not freeze its legs to turn).
      const phase = (this.walked[i] / (1.3 * r)) * Math.PI * 2 + i * 1.7 + time * 1.2;
      const bob = (0.5 - 0.5 * Math.cos(phase * 2)) * 0.05 * r * (0.3 + pace);
      this.quat.setFromAxisAngle(this.up, yaw);
      this.pos.set(x, Number(p.y) + bob, z);
      this.scl.setScalar(r);
      this.base.compose(this.pos, this.quat, this.scl);
      // The body rocks side to side a few degrees with the step (about its own forward axis).
      this.legQuat.setFromAxisAngle(this.fwd, Math.sin(phase) * 0.035 * (0.3 + pace));
      this.body.setMatrixAt(i, this.m.multiplyMatrices(this.base, this.local.compose(this.legPos.set(0, 0, 0), this.legQuat, this.one)));
      // Legs: each swings about its hip. `swing` is +1 when the foot is fully forward, -1 fully back. A leg on the
      // ground (moving back) stays low; a leg in the air (moving forward) lifts its foot.
      const amp = 0.55 * (0.25 + 0.75 * pace); // legs shuffle less when the beetle is slow
      LEGS.forEach((leg, k) => {
        const ph = phase + (leg.group ? Math.PI : 0);
        const swing = Math.sin(ph);
        const lift = Math.max(0, Math.cos(ph)); // in the air while swinging forward
        // The foot moves along +z when the hip turns by -side * angle about the vertical (see the maths in the file header).
        this.legQuat.setFromAxisAngle(this.up, -leg.side * swing * amp);
        this.legPos.copy(leg.hip).y += lift * 0.16 * (0.3 + pace);
        this.local.compose(this.legPos, this.legQuat, this.one);
        this.legs[k].setMatrixAt(i, this.m.multiplyMatrices(this.base, this.local));
      });
    });
    this.body.instanceMatrix.needsUpdate = true;
    for (const l of this.legs) l.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    const mats = new Set<THREE.Material>();
    for (const mesh of [this.body, ...this.legs]) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mats.add(mesh.material as THREE.Material);
      mesh.dispose();
    }
    for (const m of mats) m.dispose();
  }
}
