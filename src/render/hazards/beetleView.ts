/**
 * Draws the acorn beetles of Autumn Speedway (the rules live in sim/hazards/beetle.ts).
 *
 * An original creature: a round, glossy chestnut-brown body with a scaly ACORN-CAP shell on its back (with
 * a little stalk on top), a dark head with two big friendly eyes and curly antennae, and six thin legs.
 *
 * The sim says where each beetle is at any race time (`pose(time)`); this file only dresses it up:
 *   - it FACES the way it walks and turns round smoothly at each end of its march (it faces along the
 *     road for a moment while it turns),
 *   - it BOBS with its stride and its legs shuffle (the legs swing a little around the body's centre),
 *     faster when it walks faster.
 *
 * 3D concepts: two InstancedMeshes (body and legs): every beetle is one instance of each, so all beetles
 * cost 2 draw calls. The models are built once at radius 1 and scaled by the sim's radius.
 */
import * as THREE from 'three';
import type { Hazard } from '../../sim/hazards/types';
import { blobGeo, matrix, merge, paint, tubeGeo } from '../env/geo';
import { noise3 } from '../env/noise';
import type { QualitySettings } from '../scene';

const _c = new THREE.Color();

/** The body: chestnut nut, acorn-cap shell, stalk, head, eyes and antennae, at radius 1, facing +z. */
function bodyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Glossy nut body (slightly egg-shaped, the wide end at the back).
  const nut = blobGeo(3, 7, 0.03, 1.5, noise3).applyMatrix4(matrix(0, 0.62, -0.05, 0.92, 0.6, 1.12));
  parts.push(paint(nut, (p) => _c.set('#7a3e17').multiplyScalar(0.75 + 0.45 * THREE.MathUtils.clamp(p.y - 0.3, 0, 1))));
  // Acorn cap shell: a dome over the top with a scale (cross-hatch) pattern in two browns.
  const cap = blobGeo(3, 3, 0.04, 1.2, noise3).applyMatrix4(matrix(0, 0.86, -0.12, 1.0, 0.55, 1.18));
  parts.push(
    paint(cap, (p) => {
      const hatch = Math.sin(p.x * 14 + p.z * 9) * Math.sin(p.x * 9 - p.z * 14) > 0.1 ? 1 : 0;
      return _c.set(hatch ? '#b8854a' : '#8a5a2c').multiplyScalar(0.8 + 0.35 * THREE.MathUtils.clamp(p.y - 0.8, 0, 1));
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

/** Six legs at radius 1 (three per side, bent at the knee), facing +z. */
function legGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    for (const z of [-0.55, 0.05, 0.6]) {
      const hip = new THREE.Vector3(side * 0.7, 0.45, z);
      const knee = new THREE.Vector3(side * 1.25, 0.6, z + 0.15 * Math.sign(z));
      const foot = new THREE.Vector3(side * 1.4, 0.0, z + 0.3 * Math.sign(z));
      parts.push(paint(tubeGeo([hip, knee, foot], [0.09, 0.07, 0.05], 5), () => _c.set('#24150c')));
    }
  }
  return merge(parts);
}

export class BeetleView {
  private readonly body: THREE.InstancedMesh;
  private readonly legs: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scl = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly hazards: Hazard[],
    _quality: QualitySettings,
  ) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 }); // glossy shell
    this.body = new THREE.InstancedMesh(bodyGeometry(), mat, hazards.length);
    this.legs = new THREE.InstancedMesh(legGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), hazards.length);
    for (const mesh of [this.body, this.legs]) {
      mesh.frustumCulled = false; // spread along the track
      mesh.castShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
    }
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
      // Facing: towards +right while walking right, -right while walking left; while it slows down to turn
      // round (pace near 0) it swings through "along the road", so the turn is smooth.
      const dir = Number(p.dirX) * rx + Number(p.dirZ) * rz >= 0 ? 1 : -1;
      const sTurn = dir * Math.min(1, pace / 0.3); // -1..1
      const right = Math.atan2(rx, rz); // heading of the road's right vector (rotation.y convention: +z forward)
      const yaw = right + (Math.PI * (1 - sTurn)) / 2;
      // Stride: bob and leg shuffle, faster when walking faster.
      const stride = time * (3 + 6 * pace) + i * 1.7;
      const bob = Math.abs(Math.sin(stride)) * 0.06 * r * (0.3 + pace);
      this.pos.set(Number(p.x), Number(p.y) + bob, Number(p.z));
      this.scl.setScalar(r);
      this.quat.setFromAxisAngle(this.up, yaw);
      this.body.setMatrixAt(i, this.m.compose(this.pos, this.quat, this.scl));
      this.pos.y -= bob;
      this.quat.setFromAxisAngle(this.up, yaw + Math.sin(stride * 2) * 0.12 * (0.3 + pace));
      this.legs.setMatrixAt(i, this.m.compose(this.pos, this.quat, this.scl));
    });
    this.body.instanceMatrix.needsUpdate = true;
    this.legs.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.body, this.legs]) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}
