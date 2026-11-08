/**
 * ALL gameplay tuning numbers live here. Units are SI: metres, seconds,
 * radians. Edit, save, and the dev server reloads the game.
 *
 * (Engineering intuition: a kart here is ~1.6 m long. 28 m/s ≈ 100 km/h,
 * which feels fast at this scale, like a real racing kart.)
 */

/** Simulation rate. The sim always advances in steps of exactly 1/SIM_HZ s. */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

export const KART = {
  // --- Speed ----------------------------------------------------------------
  /** Top speed on road with gas held (m/s). */
  maxSpeed: 28,
  /** Acceleration from standstill (m/s^2). Fades to 0 as speed nears maxSpeed. */
  accel: 18,
  /** Exponent of the acceleration fade: higher = keeps pulling hard closer to top speed. */
  accelCurve: 1.6,
  /** Braking deceleration while moving forward (m/s^2). */
  brakeDecel: 32,
  /** Reverse acceleration and top speed. */
  reverseAccel: 12,
  reverseMaxSpeed: 9,
  /** Deceleration when neither gas nor brake is held (m/s^2). */
  coastDecel: 5,
  /** How fast speed above the current cap bleeds off (m/s^2), e.g. when entering grass. */
  overSpeedDecel: 22,

  // --- Steering ---------------------------------------------------------------
  /** Max turn rate (rad/s) at low speed – tight turns when slow. */
  turnRateLow: 2.7,
  /** Max turn rate (rad/s) at top speed – wider arcs when fast. */
  turnRateHigh: 1.45,
  /** Below this speed (m/s), steering authority ramps down to 0 (can't spin in place). */
  fullTurnSpeed: 5,
  /** Lateral grip: how quickly sideways sliding dies out (1/s). Higher = more "on rails". */
  grip: 9,
  /** Fraction of steering available while airborne. */
  airSteer: 0.25,

  // --- Surfaces ----------------------------------------------------------------
  /** Top speed multiplier on grass/sand. */
  offroadSpeedFactor: 0.5,
  /** Acceleration multiplier on grass/sand. */
  offroadAccelFactor: 0.6,

  // --- Vertical ------------------------------------------------------------------
  /** Gravity (m/s^2). Heavier than real (9.81) so jumps feel snappy. */
  gravity: 28,
  /** Ground closer than this below the kart counts as "still touching" (m); keeps karts glued over bumps. */
  groundSnap: 0.35,

  // --- Body ---------------------------------------------------------------------
  /** Collision radius used later for kart-vs-kart and walls (m). */
  radius: 0.9,
} as const;

export type KartConfig = typeof KART;

/** Camera feel (render-only, doesn't affect the sim). */
export const CAMERA = {
  distance: 6.2,
  height: 2.6,
  /** How far ahead of the kart the camera looks (m). */
  lookAhead: 4,
  /** Extra sideways look into turns (m per rad/s of yaw rate). */
  turnLookAhead: 2.2,
  /** Position smoothing time constant (s). Smaller = stiffer. */
  followLag: 0.12,
  fovBase: 68,
  /** Extra FOV at top speed (deg) – boosts later push past this. */
  fovSpeedBonus: 8,
} as const;
