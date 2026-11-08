/**
 * Draws one kart: interpolates between the previous and current sim state
 * and adds purely cosmetic motion (body lean, wheel spin and steer).
 */
import * as THREE from 'three';
import type { KartState } from '../sim/kart';
import { KART } from '../sim/config';
import { WHEEL_RADIUS, buildKartModel, type KartModel } from './kartModel';

/** Shortest-path angle interpolation (handles wrap-around at ±π). */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export interface InterpolatedKart {
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  yawRate: number;
}

export class KartView {
  readonly model: KartModel;
  private lean = 0;
  private wheelSpin = 0;
  /** Interpolated pose from the last `update` (the camera reads this). */
  readonly pose: InterpolatedKart = { x: 0, y: 0, z: 0, heading: 0, speed: 0, yawRate: 0 };

  constructor(scene: THREE.Scene, colorHex: string) {
    this.model = buildKartModel(colorHex);
    scene.add(this.model.root);
  }

  update(prev: KartState, cur: KartState, alpha: number, dt: number): void {
    const p = this.pose;
    p.x = prev.pos.x + (cur.pos.x - prev.pos.x) * alpha;
    p.y = prev.pos.y + (cur.pos.y - prev.pos.y) * alpha;
    p.z = prev.pos.z + (cur.pos.z - prev.pos.z) * alpha;
    p.heading = lerpAngle(prev.heading, cur.heading, alpha);
    p.speed = prev.speed + (cur.speed - prev.speed) * alpha;
    p.yawRate = cur.yawRate;

    const m = this.model;
    m.root.position.set(p.x, p.y, p.z);
    m.root.rotation.y = p.heading;

    // Lean outward in turns (roll around forward axis), proportional to lateral acceleration.
    const lateralAccel = p.yawRate * p.speed;
    const targetLean = THREE.MathUtils.clamp(-lateralAccel * 0.006, -0.14, 0.14);
    this.lean += (targetLean - this.lean) * (1 - Math.exp(-dt / 0.08));
    m.body.rotation.z = this.lean;
    // Slight nose-up under acceleration feel at low speed.
    m.body.rotation.x = -0.03 * Math.min(1, Math.abs(p.speed) / KART.maxSpeed);

    this.wheelSpin += (p.speed / WHEEL_RADIUS) * dt;
    for (const w of m.wheels) w.rotation.x = this.wheelSpin;
    for (const pivot of m.frontPivots) pivot.rotation.y = -cur.steer * 0.45;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.model.root);
  }
}
