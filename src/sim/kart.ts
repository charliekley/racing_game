/**
 * Arcade kart physics. Deliberately NOT a rigid-body simulation: the kart is
 * a point with a heading, a velocity and a few rules that feel good.
 *
 * Conventions (same as Three.js): Y is up. heading = yaw angle in radians;
 * heading 0 faces +Z. forward = (sin h, 0, cos h). Turning RIGHT (positive
 * steer) DEcreases heading, because +X is on the kart's left when it faces +Z.
 *
 * Pure functions on plain data: no Three.js, no DOM, no randomness. Same
 * inputs -> same outputs, which keeps it testable and replay-friendly.
 */
import { Buttons, type ControlInput } from '../shared/protocol';
import { KART, type KartConfig } from './config';
import type { Ground, Surface } from './ground';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface KartState {
  pos: Vec3;
  vel: Vec3;
  heading: number;
  /** Signed speed along the kart's forward direction (m/s); negative = reversing. */
  speed: number;
  /** Current yaw rate (rad/s) – used by the camera and body-lean visuals. */
  yawRate: number;
  grounded: boolean;
  surface: Surface;
  /** Smoothed steer value the kart is applying (-1..1), for wheel visuals. */
  steer: number;
}

export function createKart(x: number, z: number, heading: number): KartState {
  return {
    pos: { x, y: 0, z },
    vel: { x: 0, y: 0, z: 0 },
    heading,
    speed: 0,
    yawRate: 0,
    grounded: true,
    surface: 'road',
    steer: 0,
  };
}

export function forwardOf(heading: number): Vec3 {
  return { x: Math.sin(heading), y: 0, z: Math.cos(heading) };
}

/** Unit vector to the kart's right. */
export function rightOf(heading: number): Vec3 {
  return { x: -Math.cos(heading), y: 0, z: Math.sin(heading) };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Move `v` toward `target` by at most `maxDelta`. */
const approach = (v: number, target: number, maxDelta: number) =>
  v < target ? Math.min(target, v + maxDelta) : Math.max(target, v - maxDelta);

/** New forward speed after throttle/brake/coast for one step. */
export function updateSpeed(speed: number, input: ControlInput, surface: Surface, dt: number, c: KartConfig = KART): number {
  const gas = (input.buttons & Buttons.GAS) !== 0;
  const brake = (input.buttons & Buttons.BRAKE) !== 0;
  const offroad = surface === 'offroad';
  const cap = c.maxSpeed * (offroad ? c.offroadSpeedFactor : 1);
  const accel = c.accel * (offroad ? c.offroadAccelFactor : 1);

  let v = speed;
  if (gas && !brake) {
    if (v < 0) v = approach(v, 0, c.brakeDecel * dt); // gas while rolling backwards = brake first
    else if (v < cap) {
      const fade = Math.max(0, 1 - Math.pow(v / cap, c.accelCurve));
      v = Math.min(cap, v + accel * fade * dt + 0.02 * dt); // tiny constant so we always reach cap
    }
  } else if (brake && !gas) {
    if (v > 0.5) v = Math.max(0, v - c.brakeDecel * dt);
    else v = Math.max(-c.reverseMaxSpeed, v - c.reverseAccel * dt);
  } else {
    // Coasting (or both pedals): roll to a stop.
    v = approach(v, 0, c.coastDecel * dt);
  }
  // Above the cap (e.g. just drove onto grass): bleed off, don't stop dead.
  if (v > cap) v = Math.max(cap, v - c.overSpeedDecel * dt);
  if (v < -c.reverseMaxSpeed) v = -c.reverseMaxSpeed;
  return v;
}

/** Max yaw rate (rad/s) for a given forward speed: tighter at low speed. */
export function turnRateFor(speed: number, c: KartConfig = KART): number {
  const s = Math.abs(speed);
  const authority = clamp(s / c.fullTurnSpeed, 0, 1);
  const frac = clamp(s / c.maxSpeed, 0, 1);
  return lerp(c.turnRateLow, c.turnRateHigh, frac) * authority;
}

/**
 * Advance one kart by one fixed step. Mutates and returns `k`.
 */
export function stepKart(k: KartState, input: ControlInput, ground: Ground, dt: number, c: KartConfig = KART): KartState {
  const steer = clamp(Number.isFinite(input.steer) ? input.steer : 0, -1, 1);
  k.steer = steer;

  // Split current horizontal velocity into forward / sideways parts.
  let f = forwardOf(k.heading);
  let r = rightOf(k.heading);
  let lateral = k.vel.x * r.x + k.vel.z * r.z;

  if (k.grounded) {
    k.speed = updateSpeed(k.speed, input, k.surface, dt, c);
  }

  // Steering: reversing turns the other way, like a real car.
  const authority = k.grounded ? 1 : c.airSteer;
  k.yawRate = -steer * turnRateFor(k.speed, c) * Math.sign(k.speed) * authority;
  k.heading += k.yawRate * dt;

  // Grip kills sideways sliding; forward speed is carried into the new heading
  // (that's what makes arcade turning feel responsive).
  lateral *= Math.exp(-c.grip * dt);
  f = forwardOf(k.heading);
  r = rightOf(k.heading);
  k.vel.x = f.x * k.speed + r.x * lateral;
  k.vel.z = f.z * k.speed + r.z * lateral;

  // Vertical: gravity while airborne.
  if (!k.grounded) k.vel.y -= c.gravity * dt;

  k.pos.x += k.vel.x * dt;
  k.pos.y += k.vel.y * dt;
  k.pos.z += k.vel.z * dt;

  // Ground following: raycast straight down.
  const hit = ground.sample(k.pos.x, k.pos.z);
  if (hit && k.pos.y <= hit.height + (k.grounded ? c.groundSnap : 0)) {
    k.pos.y = hit.height;
    if (k.vel.y < 0) k.vel.y = 0;
    k.grounded = true;
    k.surface = hit.surface;
  } else {
    k.grounded = false;
  }
  return k;
}

/** Copy of a kart's state, used to keep the previous tick for interpolation. */
export function cloneKart(k: KartState): KartState {
  return { ...k, pos: { ...k.pos }, vel: { ...k.vel } };
}
