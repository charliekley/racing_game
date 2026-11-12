/**
 * Draws the rolling snowballs of Switchback Summit (the rules live in sim/hazards/roller.ts).
 *
 * The sim says where each ball is at any race time (`pose(time)`); this file only dresses it up:
 *   - the BALL: a lumpy sphere with blotchy vertex colours (so you can SEE it turn), lit by the scene's
 *     sun, with a little emissive brightness so snow stays white in shade;
 *   - a soft SHADOW blob under it (a flat dark disc, instanced);
 *   - snow PUFFS: a trail behind the ball while it rolls (thicker during the 1.5 s warning, when the
 *     ball is still up the slope), a big puff when it appears, and a burst of snow when it breaks up
 *     on the far side; plus a few white sparkles.
 *
 * 3D concepts used here:
 *  - INSTANCING: one `InstancedMesh` draws all balls in one draw call (each with its own matrix).
 *    A ball that does not exist right now gets scale 0, which hides it.
 *  - ROLLING = rotation: the sim gives the rolled angle `roll` (= distance / radius). Rolling along the
 *    horizontal direction d turns the ball about the horizontal axis (up x d); a quaternion does that.
 *  - Particles are cosmetic only (they never affect the race), so Math.random is fine for them.
 *
 * Cost: 2 draw calls for all balls on every quality level; particles are scaled down on Medium/Low and
 * skipped for balls far from every camera.
 */
import * as THREE from 'three';
import type { Hazard } from '../../sim/hazards/types';
import { fxScaleFor } from '../fx/gameFx';
import { fxHub } from '../fx/hub';
import type { QualitySettings } from '../scene';

/** Balls farther than this (m) from every camera skip their particles. */
const PARTICLE_RANGE = 130;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Cheap smooth-ish noise from a direction on the sphere (sum of sines): the same for every ball, no randomness. */
const lump = (x: number, y: number, z: number) => Math.sin(x * 4.1 + y * 2.3) * Math.sin(y * 3.7 + z * 2.9) * Math.sin(z * 4.9 - x * 1.7);

/**
 * A snowball: a sphere of radius 1 whose surface is pushed in and out a little (lumpy) and whose vertex colours
 * go from white to blue-grey to the odd brown fleck of dirt. Because the colour patches are fixed on the ball,
 * you see them turn as it rolls.
 */
function snowballGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 26, 18);
  const p = g.getAttribute('position');
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = lump(x, y, z); // -1..1
    const k = 1 + 0.045 * n; // radius wobble of +-4.5 %
    p.setXYZ(i, x * k, y * k, z * k);
    const shade = 0.86 + 0.14 * n; // blotches of slightly blue-grey snow
    const dirt = Math.max(0, lump(x * 2.2 + 3, y * 2.2, z * 2.2) - 0.55) * 2; // a few brown patches
    colors[i * 3] = shade * (1 - 0.3 * dirt) * 0.96;
    colors[i * 3 + 1] = shade * (1 - 0.38 * dirt) * 0.98;
    colors[i * 3 + 2] = shade * (1 - 0.5 * dirt);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** A flat dark disc lying on the ground (the shadow blob). */
function shadowGeometry(): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(1, 20);
  g.rotateX(-Math.PI / 2); // CircleGeometry stands upright; lay it flat
  return g;
}

interface RollerSlot {
  hazard: Hazard;
  /** Leftover fractions of a particle, so low rates still average out. */
  accTrail: number;
  accSparkle: number;
  accBurst: number;
  /** Was the ball present last frame? (to puff once when it appears) */
  wasPresent: boolean;
}

export class RollerView {
  private readonly slots: RollerSlot[];
  private readonly ball: THREE.InstancedMesh;
  private readonly shadow: THREE.InstancedMesh;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private scale: number;
  private lastTime = Number.NaN;
  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scl = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    hazards: Hazard[],
    quality: QualitySettings,
  ) {
    this.scale = fxScaleFor(quality);
    this.slots = hazards.map((hazard) => ({ hazard, accTrail: 0, accSparkle: 0, accBurst: 0, wasPresent: false }));
    const n = this.slots.length;

    const ballGeo = snowballGeometry();
    const ballMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, emissive: 0x6f86a6, emissiveIntensity: 0.28 });
    this.ball = new THREE.InstancedMesh(ballGeo, ballMat, n);
    const shadowGeo = shadowGeometry();
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x101a2a, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    shadowMat.fog = true;
    this.shadow = new THREE.InstancedMesh(shadowGeo, shadowMat, n);
    this.geos.push(ballGeo, shadowGeo);
    this.mats.push(ballMat, shadowMat);

    for (const mesh of [this.ball, this.shadow]) {
      mesh.frustumCulled = false; // the instances are spread along the track: skip the (useless) bounding test
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
    }
    this.shadow.renderOrder = 1;
    this.update(0, 0, undefined);
  }

  setQuality(q: QualitySettings): void {
    this.scale = fxScaleFor(q);
  }

  /** Pose every ball at race time `time` (s). `focus` = world positions of the cameras' karts (culls particles far away). */
  update(time: number, dt: number, focus: readonly { x: number; z: number }[] | undefined): void {
    // Real elapsed time between calls (fall back to the given dt); ignore jumps (new race, tab switch).
    const step = Number.isFinite(this.lastTime) ? time - this.lastTime : dt;
    this.lastTime = time;
    const emitDt = step > 0 && step < 0.25 ? step : 0;
    const fx = fxHub.current;

    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const pose = s.hazard.pose(time);
      if (!pose.present) {
        // No ball: collapse both instances to nothing.
        this.pos.set(0, -1000, 0);
        this.m.compose(this.pos, this.quat.identity(), this.scl.set(0, 0, 0));
        this.ball.setMatrixAt(i, this.m);
        this.shadow.setMatrixAt(i, this.m);
        s.wasPresent = false;
        s.accBurst = 0;
        continue;
      }
      const x = Number(pose.x);
      const y = Number(pose.y);
      const z = Number(pose.z);
      const r = Number(pose.radius);
      const dx = Number(pose.dirX);
      const dz = Number(pose.dirZ);
      const burst = Number(pose.burst);
      const shrink = 1 - burst * burst; // the ball crumbles away during the burst

      // The ball turns about the horizontal axis (up x direction) by the rolled angle.
      this.axis.set(dz, 0, -dx);
      this.quat.setFromAxisAngle(this.axis, Number(pose.roll));
      this.pos.set(x, y, z);
      this.scl.set(r * shrink, r * shrink, r * shrink);
      this.ball.setMatrixAt(i, this.m.compose(this.pos, this.quat, this.scl));

      // Shadow blob on the ground under the ball (the ground is one radius below the centre).
      this.pos.set(x, y - r + 0.07, z);
      const sh = r * 1.15 * shrink;
      this.scl.set(sh, 1, sh);
      this.shadow.setMatrixAt(i, this.m.compose(this.pos, this.quat.identity(), this.scl));

      // Particles: only near a camera, and never when time is not advancing.
      const justAppeared = !s.wasPresent;
      s.wasPresent = true;
      if (!fx || emitDt <= 0) continue;
      if (focus && !focus.some((f) => Math.hypot(f.x - x, f.z - z) < PARTICLE_RANGE)) continue;
      const warn = pose.phase === 'warn';
      const ground = y - r;
      // Snow kicked up behind the ball: more during the warning (the rumble you should notice).
      s.accTrail += (warn ? 34 : 20) * (1 - burst) * this.scale * emitDt;
      s.accSparkle += 9 * (1 - burst) * this.scale * emitDt;
      for (; s.accTrail >= 1; s.accTrail--) {
        const side = rand(-0.9, 0.9) * r;
        fx.smoke.emit(x - dx * r * 0.7 - dz * side, ground + rand(0.1, 0.5), z - dz * r * 0.7 + dx * side, rand(-0.8, 0.8) - dx * 1.2, rand(0.8, 2.2), rand(-0.8, 0.8) - dz * 1.2, rand(0.7, 1.3), 0.5, 1.7, 0xf4f8ff, 0.5, 1.5, -0.3);
      }
      for (; s.accSparkle >= 1; s.accSparkle--) {
        // A glint on a random spot of the ball's upper half.
        const a = Math.random() * Math.PI * 2;
        const e = Math.random();
        const ring = Math.sqrt(1 - e * e);
        fx.glow.emit(x + Math.cos(a) * ring * r, y + e * r, z + Math.sin(a) * ring * r, 0, rand(0.2, 0.8), 0, rand(0.25, 0.45), 0.2, 0.02, 0xdff0ff, 0.9, 0, 0);
      }
      if (justAppeared) {
        // The ball comes into view up the slope: a big puff of snow.
        const count = Math.max(3, Math.round(16 * this.scale));
        for (let k = 0; k < count; k++) {
          const a = Math.random() * Math.PI * 2;
          fx.smoke.emit(x + Math.cos(a) * r, ground + 0.3, z + Math.sin(a) * r, Math.cos(a) * rand(1, 3), rand(1.5, 3.5), Math.sin(a) * rand(1, 3), rand(1, 1.8), 0.8, 2.6, 0xffffff, 0.55, 1.2, -0.2);
        }
      }
      if (burst > 0) {
        // Breaking up: snow flies out in every direction (about 28 puffs over the burst on High).
        s.accBurst += 60 * this.scale * emitDt;
        for (; s.accBurst >= 1; s.accBurst--) {
          const a = Math.random() * Math.PI * 2;
          const sp = rand(2, 6);
          fx.smoke.emit(x, y + rand(-0.3, r * 0.6), z, Math.cos(a) * sp + dx * 3, rand(1.5, 5), Math.sin(a) * sp + dz * 3, rand(0.8, 1.5), 0.9, 2.8, 0xf4f8ff, 0.6, 1.8, 3);
        }
      }
    }
    this.ball.instanceMatrix.needsUpdate = true;
    this.shadow.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.ball, this.shadow]) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
