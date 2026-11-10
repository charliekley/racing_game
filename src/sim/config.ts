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
  offroadSpeedFactor: 0.72,
  /** Acceleration multiplier on grass/sand. */
  offroadAccelFactor: 0.8,

  // --- Boosts -------------------------------------------------------------------
  /** Top speed multiplier while boosting (boost pads, start boost, later mini-turbos/items). */
  boostSpeedFactor: 1.35,
  /** Acceleration while boosting (m/s^2). Boosting also ignores the off-road penalty. */
  boostAccel: 45,
  /** Boost pad duration (s). */
  boostPadTime: 1.1,
  /** Countdown "rocket start" boost duration (s). */
  startBoostTime: 1.3,
  /** Pressing gas too early in the countdown floods the engine for this long (s). */
  startStallTime: 0.9,

  // --- Hop & drift ------------------------------------------------------------------
  /** Upward speed of the little hop when DRIFT is pressed (m/s). */
  hopSpeed: 4.2,
  /** Minimum speed to start/keep a drift (m/s). */
  driftMinSpeed: 9,
  /** How hard you must be steering when the hop lands to start a drift (0..1). */
  driftSteerThreshold: 0.25,
  /** Drift turn rate as a multiple of normal steering: steering OUT of the drift (wide) … INTO it (tight). */
  driftTurnWide: 0.45,
  driftTurnTight: 1.35,
  /** Grip while drifting (1/s): low = the kart slides, velocity lags behind where it points. */
  driftGrip: 3.2,
  /** Drift charge per second, plus a bonus for steering into the drift. */
  driftChargeRate: 0.9,
  driftChargeSteerBonus: 1.3,
  /** Charge needed for blue (tier 1) and orange (tier 2) sparks. */
  driftTier1: 1.0,
  driftTier2: 2.4,
  /** Mini-turbo boost length on release, for tier 1 and tier 2 (s). */
  miniTurboTime: [0.6, 1.2] as readonly number[],

  // --- Tricks & respawn ---------------------------------------------------------------
  /** Leaving the ground faster than this upward (m/s) – i.e. off a ramp, not a hop – allows a trick. */
  trickMinLaunchSpeed: 3,
  /** Boost on landing after a trick (s). */
  trickBoostTime: 0.9,
  /** Unused since the track overhaul (the world uses FALL_BELOW_ROAD / FALL_FLOOR_Y in world.ts); kept for old references. */
  respawnFallY: -3,
  /** Being this far (m) outside the track's edge for `offTrackRespawnTime` s also respawns you. */
  offTrackDistance: 45,
  offTrackRespawnTime: 2.5,
  /** How long the carrier takes to lower you back onto the track (s). */
  respawnTime: 1.8,

  // --- Item effects on the kart ----------------------------------------------------------
  /** Spin-out after being hit (s) with no control, and the fraction of speed kept. */
  spinTime: 1.3,
  spinSpeedFactor: 0.3,
  /** Nova (invincibility) duration (s), top-speed and acceleration multipliers. Nova ignores grass. */
  novaTime: 7,
  novaSpeedFactor: 1.18,
  novaAccelFactor: 1.3,

  // --- Collisions -----------------------------------------------------------------
  /** Fraction of the impact velocity bounced back off walls (0 = dead stop on the wall, 1 = superball). */
  wallBounce: 0.35,
  /** Extra speed lost per wall hit, scaled by how head-on it was (0..1). */
  wallSpeedLoss: 0.45,
  /** Kart-vs-kart bounce (0..1). */
  kartBounce: 0.6,
  /**
   * Mass in kart-vs-kart bumps (relative units; 1 = the default kart). When two karts bump,
   * the lighter one gets pushed around more (momentum is shared out by mass). See sim/classes.ts.
   */
  mass: 1,

  // --- Vertical ------------------------------------------------------------------
  /** Gravity (m/s^2). Heavier than real (9.81) so jumps feel snappy. */
  gravity: 28,
  /** Ground closer than this below the kart counts as "still touching" (m); keeps karts glued over bumps. */
  groundSnap: 0.35,
  /**
   * Crest launch: a grounded kart that was rising (faster than crestMinRise m/s) and whose
   * ground suddenly bends away faster than crestLaunchDecel (m/s^2) leaves the ground, as a
   * real car would over a crest. Gravity is 28, so 1.3x means "bends away faster than a
   * free-falling kart drops" with a margin so small road kinks don't cause hops.
   */
  crestMinRise: 1.5,
  crestLaunchDecel: 36.4,

  // --- Body ---------------------------------------------------------------------
  /** Collision radius for kart-vs-kart and walls (m). */
  radius: 0.9,
} as const;

/**
 * The shape of KART, but with plain `number`s instead of the exact literal values
 * (because `as const` makes `maxSpeed` the type `28`). Every kart gets its own copy of
 * these numbers: see `kartConfigFor` in sim/classes.ts.
 */
export type KartConfig = {
  -readonly [K in keyof typeof KART]: (typeof KART)[K] extends readonly number[] ? readonly number[] : number;
};

/** Items: boxes, roulette, the five items. */
export const ITEMS = {
  /** Item box pick-up radius (m) and how long a collected box stays away (s). */
  boxRadius: 1.9,
  boxRespawn: 5,
  /** Item-box rows per track: one row every this many metres, 3 boxes per row. */
  rowSpacing: 260,
  /** ITEM pressed for less than this counts as a "tap" (use at once); longer = drag it behind you (s). */
  tapSeconds: 0.18,
  /** How far behind the kart a dragged/dropped item sits (m). */
  trailDistance: 2.8,
  /** Dash boost length: single, and per charge of the three-pack (s). */
  dashBoostTime: 1.5,
  tripleBoostTime: 1.0,
  /** Slick (oil) trap. */
  slickRadius: 1.5,
  slickLifetime: 60,
  maxSlicks: 12,
  /** A dropped item can't hurt its owner for this long (s). */
  ownerGrace: 0.8,
  /** Ricochet shot. */
  ricochetSpeed: 42,
  ricochetBounces: 4,
  ricochetLifetime: 9,
  ricochetRadius: 1.3,
  /** Seeker (homing) shot. */
  seekerSpeed: 38,
  seekerTurnRate: 3.2,
  seekerLifetime: 9,
  seekerRadius: 1.3,
  /** Jumble: how long a hit racer's steering stays flipped (s). */
  jumbleTime: 7,
  /** Shots spawn this far in front of / behind the kart (m). */
  muzzleDistance: 2.4,
} as const;

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

  // --- Game-feel camera work (render only; tuned by eye) ---
  /** Extra FOV (deg) and extra distance (m) while boosting: the "kick". */
  fovBoost: 12,
  boostPull: 1.2,
  /** Extra FOV (deg) and distance (m) while airborne high above the ground (big jumps). */
  fovAir: 9,
  airPull: 1.4,
  /** Only counts as a big jump when the kart is this far above the ground (m). */
  airMinHeight: 1.6,
  /** Cannon flight: camera drops back and widens for a dramatic shot. */
  cannonFov: 16,
  cannonPull: 5,
  /** Camera heading smoothing (s): how far the view lags behind the kart's heading in corners. */
  headingLag: 0.2,
  headingLagDrift: 0.38,
  /** Camera roll into corners (rad, at full yaw rate and speed). */
  rollMax: 0.055,
  /** Camera shake: how fast trauma fades (1/s) and the biggest shake (m). */
  shakeDecay: 1.6,
  shakeMax: 0.28,
  /** Finish orbit: distance (m), height (m) and angular speed (rad/s) around the kart. */
  orbitDistance: 6.5,
  orbitHeight: 2.4,
  orbitSpeed: 0.55,
  /** Race intro flyover length (s). */
  introSeconds: 3.2,
} as const;
