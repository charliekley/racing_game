/**
 * Driver animation. No skinning: the driver is a few rigid pieces (torso,
 * head, two arms) and we only change the transforms of those groups.
 *
 *  - The steering wheel turns with the steer input and the hands stay glued to
 *    the rim (each arm is aimed from its shoulder at its hand point and
 *    stretched a little to reach).
 *  - The torso leans into corners, the head looks into the turn.
 *  - Boost: lean back. Acceleration/braking: small pitch.
 *  - Landing / hop: a damped spring squashes and stretches the driver.
 *  - Trick: a spin flourish with arms up. Spin-out (hit): dizzy head wobble.
 *  - Finish / celebrate: arms up and bouncing.
 */
import * as THREE from 'three';
import type { KartModel } from '../kartModel';
import { ARM_LEN } from './drivers';

export interface DriverInput {
  /** -1..1, positive = turning right (same sign as KartState.steer). */
  steer: number;
  /** Body roll in radians as applied to the kart body (positive = whatever KartView rolls the body by). */
  bodyRoll: number;
  /** Forward acceleration, roughly -1..1 (positive = speeding up). */
  accel: number;
  /** 0..1 fraction of top speed. */
  speed01: number;
  /** -1 left, 0 none, 1 right. */
  drift: number;
  boosting: boolean;
  airborne: boolean;
  /** 0..1 progress of a trick flourish, or -1 when none is playing. */
  trick: number;
  /** Spun out after a hit. */
  spun: boolean;
  /** Race finished (celebrate). */
  celebrate: boolean;
}

export const IDLE_INPUT: DriverInput = {
  steer: 0, bodyRoll: 0, accel: 0, speed01: 0, drift: 0, boosting: false, airborne: false, trick: -1, spun: false, celebrate: false,
};

const _Z = new THREE.Vector3(0, 0, 1);
const _w = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** Smoothly chase a target value (frame-rate independent). */
const chase = (cur: number, target: number, dt: number, tau: number) => cur + (target - cur) * (1 - Math.exp(-dt / tau));

export class DriverRig {
  private steer = 0;
  private roll = 0;
  private pitch = 0;
  private lookYaw = 0;
  private armsUp = 0;
  private boostLean = 0;
  private squash = 0;
  private squashVel = 0;
  private wasAirborne = false;
  private t = Math.random() * 10;
  private readonly baseScale: number;
  private readonly baseY: number;
  private readonly handPoint = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly upPoint = [new THREE.Vector3(-0.3, 0.98, 0.12), new THREE.Vector3(0.3, 0.98, 0.12)];

  constructor(private readonly m: KartModel) {
    this.baseScale = m.driver.scale.x;
    this.baseY = m.driver.position.y;
    // Hands grip the rim at about 9 and 3 o'clock; arms[0] is the left arm, arms[1] the right.
    const r = m.wheelSpec.handRadius;
    this.handPoint[0].set(-Math.cos(0.3) * r, Math.sin(0.3) * r, 0);
    this.handPoint[1].set(Math.cos(0.3) * r, Math.sin(0.3) * r, 0);
  }

  /** Give the driver a little vertical kick (hops, landings). `strength` ~0.5..1.5. */
  bump(strength: number): void {
    this.squashVel += strength * 9;
  }

  update(dt: number, inp: DriverInput): void {
    const m = this.m;
    this.t += dt;
    const t = this.t;

    // Smoothed inputs.
    this.steer = chase(this.steer, inp.steer, dt, 0.07);
    this.roll = chase(this.roll, inp.bodyRoll, dt, 0.1);
    this.pitch = chase(this.pitch, -inp.accel * 0.12, dt, 0.18);
    this.boostLean = chase(this.boostLean, inp.boosting ? 1 : 0, dt, 0.12);
    const wantUp = inp.celebrate ? 1 : inp.trick >= 0 ? 1 : inp.spun ? 0.6 : 0;
    this.armsUp = chase(this.armsUp, wantUp, dt, 0.08);
    const driftLook = inp.drift * -0.35;
    this.lookYaw = chase(this.lookYaw, -this.steer * 0.45 + driftLook, dt, 0.09);

    // Landing squash: a damped spring, kicked when we touch down.
    if (this.wasAirborne && !inp.airborne) this.squashVel += 6;
    if (!this.wasAirborne && inp.airborne) this.squashVel -= 3;
    this.wasAirborne = inp.airborne;
    const k = 220;
    const c = 16;
    this.squashVel += (-k * this.squash - c * this.squashVel) * dt;
    this.squash += this.squashVel * dt;
    const sq = THREE.MathUtils.clamp(this.squash, -0.5, 0.6) * 0.1;

    // Steering wheel and body pose.
    m.steeringWheel.rotation.z = this.steer * 1.25;
    const torso = m.torso;
    const lean = -this.roll * 1.6 - inp.drift * 0.05;
    torso.rotation.z = lean;
    torso.rotation.x = this.pitch - this.boostLean * 0.28 + (inp.celebrate ? Math.sin(t * 10) * 0.05 : 0);
    // Heads look into the turn, tilt a little, and wobble when dizzy.
    const head = m.head;
    head.rotation.y = this.lookYaw;
    head.rotation.z = -lean * 0.5 + (inp.spun ? Math.sin(t * 11) * 0.28 : 0);
    head.rotation.x = this.boostLean * 0.18 + (inp.spun ? Math.sin(t * 8.3) * 0.18 : 0) + (inp.celebrate ? -0.1 : 0);
    // Squash and stretch about the hip (volume-preserving-ish).
    const s = this.baseScale;
    m.driver.scale.set(s * (1 - sq * 0.6), s * (1 + sq), s * (1 - sq * 0.6));
    m.driver.position.y = this.baseY + (inp.celebrate ? Math.abs(Math.sin(t * 7)) * 0.06 : 0) + (inp.spun ? Math.sin(t * 14) * 0.012 : 0);
    // Trick flourish: a full spin of the driver around the vertical axis.
    if (inp.trick >= 0) {
      const u = Math.min(1, inp.trick);
      m.driver.rotation.y = u * u * (3 - 2 * u) * Math.PI * 2;
    } else {
      m.driver.rotation.y = 0;
    }

    // --- Arms: aim each one from its shoulder at its hand point.
    m.root.updateWorldMatrix(true, true);
    for (let i = 0; i < 2; i++) {
      const arm = m.arms[i];
      _w.copy(this.handPoint[i]);
      m.steeringWheel.localToWorld(_w);
      m.torso.worldToLocal(_w);
      if (this.armsUp > 0.001) {
        const up = this.upPoint[i];
        const wob = inp.spun ? Math.sin(t * 9 + i * 2) * 0.12 : inp.celebrate ? Math.sin(t * 12 + i * Math.PI) * 0.1 : 0;
        _w.lerp(_dir.set(up.x, up.y + wob, up.z), this.armsUp);
      }
      _dir.copy(_w).sub(arm.position);
      const dist = _dir.length();
      _dir.divideScalar(Math.max(1e-4, dist));
      arm.quaternion.setFromUnitVectors(_Z, _dir);
      const side = i === 0 ? -1 : 1;
      arm.scale.set(side, 1, THREE.MathUtils.clamp(dist / ARM_LEN, 0.7, 1.45));
    }
  }
}
