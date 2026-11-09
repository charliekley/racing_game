/**
 * Jump shapes and jump maths (pure functions, no Three.js).
 *
 * A ramp is described by `TrackDef.ramps[]` (`at`, `length`, `height`, `shape`, `gap`).
 * This file answers two questions:
 *   1. How high is the ramp surface at a point `u` (0..1) along it?  -> `shapeHeight`
 *   2. Can a kart with a given speed clear the gap behind it?          -> `jumpClearance`
 *
 * Shapes (all start at height 0):
 *   kicker  straight wedge: rises linearly to `height`, then drops (the classic jump).
 *   hump    smooth cosine mound: rises and falls back to 0. Fast karts get airborne
 *           over the crest; slow ones just roll over it. Great in chains.
 *   double  two kickers back to back (each half of `length`), a dip in the middle.
 */
import { KART } from './config';

export type RampShape = 'kicker' | 'hump' | 'double';

/** Length (m) of the gentle landing apron that follows a gap. */
export const LANDING_LENGTH = 10;

/** Height (m) of the landing apron right after the gap; it slopes down to 0 over LANDING_LENGTH. */
export function landingHeight(rampHeight: number): number {
  return Math.min(1.2, rampHeight * 0.5);
}

/**
 * Height of the ramp surface at fraction `u` (0 = start, 1 = end) of its length.
 * `u` outside [0, 1] gives 0. The kicker deliberately keeps the exact original
 * behaviour: height * u, including the full height at u = 1.
 */
export function shapeHeight(shape: RampShape, height: number, u: number): number {
  if (u < 0 || u > 1) return 0;
  switch (shape) {
    case 'hump':
      return height * 0.5 * (1 - Math.cos(2 * Math.PI * u));
    case 'double':
      return u < 0.5 ? height * 2 * u : height * (2 * u - 1);
    default:
      return height * u;
  }
}

/** The part of a ramp that matters for the clearance maths. */
export interface JumpSpec {
  shape?: RampShape;
  length: number;
  height: number;
  /** Gap length behind the ramp (m); 0/undefined = no gap. */
  gap?: number;
}

export interface JumpClearance {
  /** Upward speed when leaving the ramp (m/s). */
  launchVy: number;
  /** Time in the air until back at road level (s). */
  airTime: number;
  /** Horizontal distance flown from the take-off point (m). */
  airDistance: number;
  /** Gap length to cross (0 if none). */
  gap: number;
  /** airDistance - gap: positive = clears the gap with room to spare (m). */
  margin: number;
  /** True if the kart lands beyond the gap. */
  clears: boolean;
}

/**
 * Ballistic estimate of a jump: a kart leaving the ramp at `speed` (m/s) on
 * the ground-following path. Take-off is at the lip (kicker, double: the last
 * wedge). For a hump there is no lip: the kart flies off the crest, so we
 * assume it leaves at the top with no upward speed (a cautious estimate).
 * Landing is assumed on road level (the landing apron only makes it easier).
 */
export function jumpClearance(ramp: JumpSpec, speed: number, gravity: number = KART.gravity): JumpClearance {
  const shape = ramp.shape ?? 'kicker';
  const gap = ramp.gap ?? 0;
  // Slope of the last rising wedge: height per metre.
  const wedge = shape === 'double' ? ramp.length / 2 : ramp.length;
  const slope = shape === 'hump' ? 0 : ramp.height / wedge;
  const vy = slope * Math.max(0, speed);
  // Height above the landing level at take-off: solve h + vy t - g t^2 / 2 = 0 for t > 0.
  const h = ramp.height;
  const t = (vy + Math.sqrt(vy * vy + 2 * gravity * h)) / gravity;
  const dist = Math.max(0, speed) * t;
  return { launchVy: vy, airTime: t, airDistance: dist, gap, margin: dist - gap, clears: dist >= gap };
}

/** Lowest speed (m/s) that clears the ramp's gap by `jumpClearance` (bisection), or Infinity if even 100 m/s can't. */
export function minClearSpeed(ramp: JumpSpec, gravity: number = KART.gravity): number {
  if (!jumpClearance(ramp, 100, gravity).clears) return Infinity;
  let lo = 0;
  let hi = 100;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (jumpClearance(ramp, mid, gravity).clears) hi = mid;
    else lo = mid;
  }
  return hi;
}
