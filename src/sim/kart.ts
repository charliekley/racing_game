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
 *
 * Drifting (MKWii-style):
 *  1. Press DRIFT -> the kart hops.
 *  2. If you're steering when it lands (and still holding DRIFT), it enters a
 *     drift in that direction. The kart slides: it points into the corner
 *     while its velocity lags behind (low grip).
 *  3. Steering INTO the drift tightens it and charges faster; steering OUT
 *     widens it. Charge passes tier 1 (blue sparks) then tier 2 (orange).
 *  4. Release DRIFT -> mini-turbo boost, longer for tier 2.
 */
import { Buttons, type ControlInput } from '../shared/protocol';
import { KART, type KartConfig } from './config';
import type { Ground, Surface } from './ground';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A kart inside a launch cannon (see sim/cannon.ts). While set, the kart ignores the
 * controls and cannot be hurt; the cannon system moves it along a fixed path.
 */
export interface KartFlight {
  /** Index into `track.cannons`. */
  cannon: number;
  /** 'load' = being pulled into the barrel, 'air' = flying to the landing point. */
  phase: 'load' | 'air';
  /** Seconds spent in the current phase. */
  t: number;
  /** Where the kart was when captured (the start of the load path). */
  fromX: number;
  fromY: number;
  fromZ: number;
  /** Length of the air phase (s), 0 until fired. Visuals use t / duration. */
  duration: number;
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
  /** Steer value the kart is applying (-1..1), for wheel visuals. */
  steer: number;
  /** Seconds of boost left (boost pads, rocket start, mini-turbo, tricks). */
  boostTime: number;
  /** Seconds left where the engine gives no power (flooded start). */
  stallTime: number;
  /** Track sample index from the last ground hit (lookup hint), -1 if unknown. */
  trackIndex: number;

  // Drift
  /** -1 = drifting left, 1 = drifting right, 0 = not drifting. */
  driftDir: number;
  driftCharge: number;
  /** 0 = no sparks yet, 1 = blue, 2 = orange. */
  driftTier: number;
  /** In the air because of a drift hop (not a ramp). */
  hopping: boolean;

  // Tricks & respawn
  /** Launched off a ramp: a trick is allowed until landing. */
  trickable: boolean;
  trickDone: boolean;
  /** Seconds left of the respawn carrier lowering the kart (0 = normal driving). */
  respawnTime: number;
  /** Time spent far outside the track (s), for the out-of-bounds respawn. */
  offTrackTime: number;

  /** Seconds left of a spin-out after being hit (no control). */
  spinTime: number;
  /** Seconds left of Nova invincibility. */
  starTime: number;
  /** Seconds left of flipped steering (hit by a Jumble). */
  invertTime: number;

  /** Inside a launch cannon (loading or flying), null normally. */
  flight: KartFlight | null;
  /** Seconds before this kart can be captured by a cannon again (after a landing). */
  cannonCooldown: number;

  /** Previous button states, to detect presses (edges). */
  prevButtons: number;
}

export type KartEvent =
  | { kind: 'hop' }
  | { kind: 'driftStart'; dir: number }
  | { kind: 'driftTier'; tier: number }
  | { kind: 'driftEnd' }
  | { kind: 'miniTurbo'; tier: number }
  | { kind: 'trick' }
  | { kind: 'trickBoost' }
  | { kind: 'land'; fallSpeed: number };

export function createKart(x: number, z: number, heading: number, y = 0): KartState {
  return {
    pos: { x, y, z },
    vel: { x: 0, y: 0, z: 0 },
    heading,
    speed: 0,
    yawRate: 0,
    grounded: true,
    surface: 'road',
    steer: 0,
    boostTime: 0,
    stallTime: 0,
    trackIndex: -1,
    driftDir: 0,
    driftCharge: 0,
    driftTier: 0,
    hopping: false,
    trickable: false,
    trickDone: false,
    respawnTime: 0,
    offTrackTime: 0,
    spinTime: 0,
    starTime: 0,
    invertTime: 0,
    flight: null,
    cannonCooldown: 0,
    prevButtons: 0,
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

export interface SpeedContext {
  surface: Surface;
  boosting: boolean;
  stalled: boolean;
  /** Nova active: faster, and grass doesn't slow you. */
  nova?: boolean;
}

/** New forward speed after throttle/brake/coast for one step. */
export function updateSpeed(
  speed: number,
  input: ControlInput,
  ctx: SpeedContext | Surface,
  dt: number,
  c: KartConfig = KART,
): number {
  const { surface, boosting, stalled, nova } = typeof ctx === 'string' ? { surface: ctx, boosting: false, stalled: false, nova: false } : ctx;
  const gas = (input.buttons & Buttons.GAS) !== 0;
  const brake = (input.buttons & Buttons.BRAKE) !== 0;
  const offroad = surface === 'offroad' && !boosting && !nova; // boosting and Nova power through grass

  if (boosting) {
    // Boost: strong push up to the boosted top speed, gas or not.
    const cap = c.maxSpeed * c.boostSpeedFactor;
    return speed < cap ? Math.min(cap, speed + c.boostAccel * dt) : speed;
  }

  const cap = c.maxSpeed * (offroad ? c.offroadSpeedFactor : 1) * (nova ? c.novaSpeedFactor : 1);
  const accel = c.accel * (offroad ? c.offroadAccelFactor : 1) * (nova ? c.novaAccelFactor : 1);

  let v = speed;
  if (gas && !brake && !stalled) {
    if (v < 0) v = approach(v, 0, c.brakeDecel * dt); // gas while rolling backwards = brake first
    else if (v < cap) {
      const fade = Math.max(0, 1 - Math.pow(v / cap, c.accelCurve));
      v = Math.min(cap, v + accel * fade * dt + 0.02 * dt); // tiny constant so we always reach cap
    }
  } else if (brake && !gas) {
    if (v > 0.5) v = Math.max(0, v - c.brakeDecel * dt);
    else if (!stalled) v = Math.max(-c.reverseMaxSpeed, v - c.reverseAccel * dt);
  } else {
    // Coasting (or both pedals, or stalled): roll to a stop.
    v = approach(v, 0, c.coastDecel * dt);
  }
  // Above the cap (e.g. just drove onto grass or a boost ran out): bleed off, don't stop dead.
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

/** Start (or extend) a boost. */
export function applyBoost(k: KartState, seconds: number): void {
  k.boostTime = Math.max(k.boostTime, seconds);
}

/** Knock a kart into a spin-out (hit by a trap, shot or Nova): loses control, speed and boost. */
export function spinOut(k: KartState, c: KartConfig = KART): void {
  k.spinTime = c.spinTime;
  k.speed *= c.spinSpeedFactor;
  k.vel.x *= c.spinSpeedFactor;
  k.vel.z *= c.spinSpeedFactor;
  k.boostTime = 0;
  k.driftDir = 0;
  k.driftCharge = 0;
  k.driftTier = 0;
  k.hopping = false;
}

/** Stop drifting; with `reward` a charged drift gives its mini-turbo. */
function endDrift(k: KartState, reward: boolean, events: KartEvent[], c: KartConfig): void {
  if (k.driftDir === 0) return;
  if (reward && k.driftTier > 0) {
    applyBoost(k, c.miniTurboTime[k.driftTier - 1]);
    events.push({ kind: 'miniTurbo', tier: k.driftTier });
  }
  k.driftDir = 0;
  k.driftCharge = 0;
  k.driftTier = 0;
  events.push({ kind: 'driftEnd' });
}

/**
 * Advance one kart by one fixed step. Mutates `k`; returns what happened
 * (for sounds, sparks, haptics).
 */
export function stepKart(k: KartState, input: ControlInput, ground: Ground, dt: number, c: KartConfig = KART): KartEvent[] {
  const events: KartEvent[] = [];
  // Inside a launch cannon: sim/cannon.ts moves the kart; controls, gravity and drifting are off.
  if (k.flight) {
    k.steer = 0;
    k.yawRate = 0;
    k.prevButtons = input.buttons;
    k.starTime = Math.max(0, k.starTime - dt);
    k.invertTime = Math.max(0, k.invertTime - dt);
    return events;
  }
  // While spinning out the kart ignores the controls (but we still remember the
  // real button state so a held button doesn't register as a fresh press after).
  const realButtons = input.buttons;
  const spinning = k.spinTime > 0;
  if (spinning) {
    k.spinTime = Math.max(0, k.spinTime - dt);
    input = { steer: 0, buttons: 0 };
  }
  // A Jumble flips left and right (and counts down while it lasts).
  const flip = k.invertTime > 0 ? -1 : 1;
  k.invertTime = Math.max(0, k.invertTime - dt);
  const steer = clamp(Number.isFinite(input.steer) ? input.steer : 0, -1, 1) * flip;
  k.steer = steer;
  const driftHeld = (input.buttons & Buttons.DRIFT) !== 0;
  const pressed = input.buttons & ~k.prevButtons;
  k.prevButtons = input.buttons;

  const boosting = k.boostTime > 0;
  k.boostTime = Math.max(0, k.boostTime - dt);
  const stalled = k.stallTime > 0;
  k.stallTime = Math.max(0, k.stallTime - dt);
  const nova = k.starTime > 0;
  k.starTime = Math.max(0, k.starTime - dt);
  if (spinning) k.prevButtons = realButtons;

  // --- Hop (start of a drift) ---------------------------------------------------
  if (k.grounded && pressed & Buttons.DRIFT && k.speed > 2) {
    k.grounded = false;
    k.hopping = true;
    k.vel.y = c.hopSpeed;
    events.push({ kind: 'hop' });
  }

  // --- Drift bookkeeping -----------------------------------------------------------
  if (k.driftDir !== 0) {
    if (!driftHeld) endDrift(k, true, events, c);
    else if (k.speed < c.driftMinSpeed * 0.6) endDrift(k, false, events, c); // too slow: fizzles out
  }

  // --- Tricks: allowed in the air after a ramp launch ------------------------------
  if (!k.grounded && k.trickable && !k.trickDone && pressed & Buttons.TRICK) {
    k.trickDone = true;
    events.push({ kind: 'trick' });
  }

  // --- Speed ----------------------------------------------------------------------
  let f = forwardOf(k.heading);
  let r = rightOf(k.heading);
  let lateral = k.vel.x * r.x + k.vel.z * r.z;

  if (k.grounded) {
    k.speed = updateSpeed(k.speed, input, { surface: k.surface, boosting, stalled, nova }, dt, c);
  }

  // --- Steering -------------------------------------------------------------------
  const authority = k.grounded || k.hopping ? 1 : c.airSteer;
  if (k.driftDir !== 0) {
    // Steering into the drift (inward = +1) tightens it, out (inward = -1) widens it.
    const inward = clamp(steer * k.driftDir, -1, 1);
    const factor = lerp(c.driftTurnWide, c.driftTurnTight, (inward + 1) / 2);
    k.yawRate = -k.driftDir * turnRateFor(k.speed, c) * factor * authority;
    if (k.grounded) {
      const rate = (c.driftChargeRate + c.driftChargeSteerBonus * Math.max(0, inward)) * (k.surface === 'offroad' ? 0.5 : 1);
      k.driftCharge += rate * dt;
      const tier = k.driftCharge >= c.driftTier2 ? 2 : k.driftCharge >= c.driftTier1 ? 1 : 0;
      if (tier !== k.driftTier) {
        k.driftTier = tier;
        events.push({ kind: 'driftTier', tier });
      }
    }
  } else {
    // Reversing turns the other way, like a real car.
    k.yawRate = -steer * turnRateFor(k.speed, c) * Math.sign(k.speed) * authority;
  }
  k.heading += k.yawRate * dt;
  f = forwardOf(k.heading);
  r = rightOf(k.heading);

  if (k.driftDir !== 0) {
    // Sliding: the velocity direction swings toward the heading only slowly,
    // so the kart's nose points into the corner while it travels wider.
    const mag = Math.max(0, k.speed);
    const vx = k.vel.x;
    const vz = k.vel.z;
    const vm = Math.hypot(vx, vz);
    const a = 1 - Math.exp(-c.driftGrip * dt);
    let dx = vm > 0.1 ? vx / vm : f.x;
    let dz = vm > 0.1 ? vz / vm : f.z;
    dx += (f.x - dx) * a;
    dz += (f.z - dz) * a;
    const dl = Math.hypot(dx, dz) || 1;
    k.vel.x = (dx / dl) * mag;
    k.vel.z = (dz / dl) * mag;
  } else {
    // Normal grip kills sideways sliding; forward speed is carried into the new
    // heading (that's what makes arcade turning feel responsive).
    lateral *= Math.exp(-c.grip * dt);
    k.vel.x = f.x * k.speed + r.x * lateral;
    k.vel.z = f.z * k.speed + r.z * lateral;
  }

  // --- Move + ground following --------------------------------------------------------
  const prevY = k.pos.y;
  const wasGrounded = k.grounded;
  k.pos.x += k.vel.x * dt;
  k.pos.z += k.vel.z * dt;

  const hit = ground.sample(k.pos.x, k.pos.z, k.trackIndex);
  if (hit?.index !== undefined) k.trackIndex = hit.index;

  if (k.grounded) {
    // Follow the ground as long as it doesn't drop away faster than `groundSnap`
    // per step. Vertical speed = slope × speed, so driving up a ramp builds
    // upward velocity and you fly off the end.
    if (hit && hit.height >= prevY - c.groundSnap) {
      k.vel.y = clamp((hit.height - prevY) / dt, -30, 30);
      k.pos.y = hit.height;
      k.surface = hit.surface;
    } else {
      k.grounded = false; // ground fell away (ramp lip, ledge, gap)
      k.trickable = k.vel.y > c.trickMinLaunchSpeed;
      k.trickDone = false;
    }
  }
  if (!k.grounded) {
    k.vel.y -= c.gravity * dt;
    k.pos.y += k.vel.y * dt;
    if (hit && k.pos.y <= hit.height && k.vel.y <= 0) {
      const fallSpeed = -k.vel.y;
      k.pos.y = hit.height;
      k.vel.y = 0;
      k.grounded = true;
      k.surface = hit.surface;
      if (!wasGrounded) events.push({ kind: 'land', fallSpeed });
      // Landing from a drift hop while steering -> drift!
      if (k.hopping && driftHeld && k.driftDir === 0 && Math.abs(steer) >= c.driftSteerThreshold && k.speed >= c.driftMinSpeed) {
        k.driftDir = Math.sign(steer);
        k.driftCharge = 0;
        k.driftTier = 0;
        events.push({ kind: 'driftStart', dir: k.driftDir });
      }
      k.hopping = false;
      if (k.trickDone) {
        applyBoost(k, c.trickBoostTime);
        events.push({ kind: 'trickBoost' });
      }
      k.trickable = false;
      k.trickDone = false;
    }
  }
  return events;
}

/** Copy of a kart's state, used to keep the previous tick for interpolation. */
export function cloneKart(k: KartState): KartState {
  return { ...k, pos: { ...k.pos }, vel: { ...k.vel }, flight: k.flight ? { ...k.flight } : null };
}
