/**
 * The "I pick you" animations: when a player confirms a character on the selection screen, the driver plays a
 * short signature move (about 1.5 s), different for every species. PURE TypeScript (no Three.js, no DOM), so the
 * curves can be unit tested.
 *
 * How it works: `pickPose(species, t)` returns a POSE for the driver `t` seconds after the pick started: a handful
 * of small numbers (how high the driver hops, how far the head turns, how squashed the body is...). The selection
 * stage (selectStage.ts) adds that pose on top of the normal sitting pose every frame, and starts the matching
 * facial expressions (`PICK_FACES`, the morph-target faces from expression.ts) at the right moments.
 *
 * Rules every move follows (and the tests check):
 *  - at t = 0 and from t = duration on, the pose is exactly NEUTRAL (all zeros), so a move never leaves the
 *    driver in a strange pose and can be chained with the idle animation;
 *  - angles that spin a full turn end at 0 right after finishing the turn (a full turn looks identical to none).
 *
 * Conventions: rotation about X is positive when the top leans FORWARD (toward the camera), `squash` > 0 makes the
 * driver taller and thinner, < 0 squat and wide. Lengths are in metres of driver space (before the driver's own
 * scale), angles in radians.
 */
import type { Species } from './drivers';
import type { Expression } from './expression';

export interface PickPose {
  /** Driver lifted off the seat (m). */
  lift: number;
  /** Whole-driver spin about the vertical axis. */
  yaw: number;
  /** Whole-driver flip about the sideways axis (forward flip is positive). */
  pitch: number;
  /** Whole-driver tilt about the forward axis. */
  roll: number;
  /** Stretch (+) or squat (-): scale Y = 1 + squash, X and Z = 1 - squash / 2. */
  squash: number;
  headYaw: number;
  headPitch: number;
  headRoll: number;
  torsoYaw: number;
  torsoPitch: number;
  torsoRoll: number;
  /** 0..1: arms thrown up. */
  armsUp: number;
  /** 0..1: extra eye closing on top of the normal blinks (a wink or a long blink). */
  blink: number;
  /** 0..1: a pulse of stage light (LED flash, stomp flash). */
  flash: number;
  /** 0..1: how hard the stage shakes (stomps). */
  shake: number;
}

export const NEUTRAL_PICK: Readonly<PickPose> = Object.freeze({
  lift: 0, yaw: 0, pitch: 0, roll: 0, squash: 0,
  headYaw: 0, headPitch: 0, headRoll: 0,
  torsoYaw: 0, torsoPitch: 0, torsoRoll: 0,
  armsUp: 0, blink: 0, flash: 0, shake: 0,
});

/** Every move lasts this long (s). */
export const PICK_DURATION = 1.5;

/** A facial expression to start `at` seconds into the move (see `Reaction` in expression.ts). */
export interface PickFace {
  at: number;
  expr: Expression;
  /** Seconds the face is held before it fades. */
  hold: number;
}

/** Faces for each move. They are plain data: the stage calls `facesDue` every frame. */
export const PICK_FACES: Record<Species, readonly PickFace[]> = {
  frog: [{ at: 0.2, expr: 'shocked', hold: 0.45 }, { at: 0.65, expr: 'happy', hold: 1.2 }],
  robot: [{ at: 0.05, expr: 'happy', hold: 0.8 }, { at: 0.95, expr: 'celebrate', hold: 1.2 }],
  chick: [{ at: 0.15, expr: 'happy', hold: 0.5 }, { at: 0.55, expr: 'celebrate', hold: 1.2 }],
  bear: [{ at: 0.05, expr: 'gritted', hold: 0.7 }, { at: 0.8, expr: 'angry', hold: 0.8 }],
  astronaut: [{ at: 0.1, expr: 'happy', hold: 1.6 }],
  cat: [{ at: 0.15, expr: 'shocked', hold: 0.55 }, { at: 0.85, expr: 'smug', hold: 1.2 }],
  fox: [{ at: 0.1, expr: 'happy', hold: 0.8 }, { at: 0.95, expr: 'smug', hold: 1.2 }],
  dino: [{ at: 0.05, expr: 'angry', hold: 0.9 }, { at: 1.0, expr: 'celebrate', hold: 1.2 }],
};

/** The faces that start in the time window (t0, t1] (so a frame never misses one or fires it twice). */
export function facesDue(species: Species, t0: number, t1: number): PickFace[] {
  return PICK_FACES[species].filter((f) => f.at > t0 && f.at <= t1);
}

// ---------------------------------------------------------------------------
// Little curve helpers (all return exactly 0 outside their window, so poses end neutral)
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Smooth 0 -> 1 between a and b. */
const ramp = (t: number, a: number, b: number) => {
  const u = clamp01((t - a) / (b - a));
  return u * u * (3 - 2 * u);
};
/** One smooth bump: 0 before a, a half sine up to 1 in the middle, 0 again after b. */
const bump = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.sin((Math.PI * (t - a)) / (b - a)));
/** Envelope: rises a -> b, holds 1 until c, falls c -> d. */
const env = (t: number, a: number, b: number, c: number, d: number) => ramp(t, a, b) * (1 - ramp(t, c, d));
/** Wiggle: a sine of `hz` cycles per second that only exists inside the envelope. */
const wiggle = (t: number, hz: number, a: number, b: number, c: number, d: number) => Math.sin(t * hz * TAU) * env(t, a, b, c, d);
/** A full turn from a to b (ends at 0 once done: a whole turn looks like none). */
const fullTurn = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : TAU * ramp(t, a, b));

/**
 * The driver's pose `t` seconds after the pick started. `out` is reused when given (no allocation per frame).
 * Returns NEUTRAL values for t <= 0 and t >= PICK_DURATION.
 */
export function pickPose(species: Species, t: number, out: PickPose = { ...NEUTRAL_PICK }): PickPose {
  Object.assign(out, NEUTRAL_PICK);
  if (!(t > 0) || t >= PICK_DURATION) return out;
  switch (species) {
    case 'frog': {
      // Tongue flick (head and chest lunge forward), then a big hop with a squat before and after.
      const hop = bump(t, 0.62, 1.34);
      out.squash = -0.18 * bump(t, 0.0, 0.3) - 0.16 * bump(t, 1.34, 1.5) + 0.12 * hop;
      out.torsoPitch = 0.22 * bump(t, 0.22, 0.62);
      out.headPitch = 0.55 * bump(t, 0.22, 0.62) - 0.2 * hop;
      out.armsUp = 0.8 * bump(t, 0.7, 1.3);
      out.lift = 0.42 * hop;
      break;
    }
    case 'robot': {
      // Head spins a full turn while the LEDs (stage light) blink.
      out.headYaw = fullTurn(t, 0.15, 1.05);
      out.flash = (0.5 + 0.5 * Math.sin(t * 36)) * env(t, 0.05, 0.15, 1.1, 1.35);
      out.torsoRoll = wiggle(t, 4, 0.1, 0.3, 1.0, 1.3) * 0.08;
      out.lift = 0.07 * bump(t, 0.1, 0.5);
      out.armsUp = 0.7 * env(t, 0.15, 0.3, 1.0, 1.2);
      break;
    }
    case 'chick': {
      // Wing flaps (arms up, body wobble) while jumping.
      const jump = bump(t, 0.2, 1.3);
      out.squash = -0.2 * bump(t, 0, 0.26) - 0.14 * bump(t, 1.3, 1.5) + 0.1 * jump;
      out.lift = 0.58 * jump;
      out.armsUp = env(t, 0.2, 0.3, 1.15, 1.3);
      out.torsoRoll = wiggle(t, 7, 0.25, 0.4, 1.1, 1.28) * 0.16;
      out.roll = wiggle(t, 3.5, 0.3, 0.5, 1.1, 1.3) * 0.1;
      break;
    }
    case 'bear': {
      // Two chest thumps, then a roar with the head thrown back and the arms up.
      out.torsoPitch = -0.3 * env(t, 0.08, 0.28, 0.9, 1.15);
      out.squash = -0.12 * bump(t, 0.28, 0.44) - 0.12 * bump(t, 0.52, 0.68) + 0.08 * bump(t, 0.85, 1.3);
      out.headPitch = -0.55 * env(t, 0.8, 0.95, 1.25, 1.45);
      out.headRoll = wiggle(t, 14, 0.9, 1.0, 1.2, 1.4) * 0.09;
      out.armsUp = env(t, 0.85, 1.0, 1.25, 1.42);
      out.lift = 0.05 * bump(t, 0.8, 1.4);
      out.shake = 0.35 * (bump(t, 0.28, 0.44) + bump(t, 0.52, 0.68));
      break;
    }
    case 'astronaut': {
      // Zero-g: float up, slow forward flip, drift back down gently.
      out.lift = 0.5 * env(t, 0.05, 0.5, 1.0, 1.45);
      out.pitch = fullTurn(t, 0.2, 1.15);
      out.roll = 0.18 * Math.sin(t * 4) * env(t, 0.1, 0.4, 0.9, 1.4);
      out.yaw = 0.35 * Math.sin(t * 3) * env(t, 0.1, 0.4, 0.9, 1.4);
      out.armsUp = 0.75 * env(t, 0.15, 0.4, 1.0, 1.35);
      break;
    }
    case 'cat': {
      // A long stretch (tall, arms up, head back), then a tail flick: a quick body wiggle and a small hop.
      const stretch = env(t, 0.05, 0.4, 0.55, 0.85);
      out.squash = 0.15 * stretch - 0.08 * bump(t, 0.9, 1.1);
      out.torsoPitch = -0.25 * stretch;
      out.headPitch = -0.25 * stretch;
      out.armsUp = stretch;
      out.torsoRoll = wiggle(t, 4.5, 0.85, 0.95, 1.2, 1.42) * 0.24;
      out.headRoll = 0.14 * env(t, 0.9, 1.0, 1.3, 1.45);
      out.lift = 0.1 * bump(t, 0.9, 1.25);
      break;
    }
    case 'fox': {
      // A quick spin with a hop, then a cocky wink.
      out.yaw = fullTurn(t, 0.15, 0.95);
      out.lift = 0.28 * bump(t, 0.15, 0.95);
      out.squash = 0.1 * bump(t, 0.15, 0.95) - 0.1 * bump(t, 0.95, 1.12);
      out.armsUp = 0.8 * env(t, 0.15, 0.25, 0.9, 1.0);
      out.blink = env(t, 1.0, 1.08, 1.3, 1.4);
      out.headRoll = 0.2 * env(t, 1.0, 1.12, 1.3, 1.45);
      break;
    }
    case 'dino': {
      // Two heavy stomps (the stage shakes), then a tail whip: the body swings out and back.
      const air = bump(t, 0.12, 0.4) + bump(t, 0.47, 0.75);
      out.lift = 0.14 * air;
      out.squash = -0.14 * bump(t, 0.4, 0.52) - 0.14 * bump(t, 0.75, 0.87) + 0.06 * air;
      out.shake = 0.8 * (bump(t, 0.4, 0.52) + bump(t, 0.75, 0.87));
      out.flash = 0.35 * (bump(t, 0.4, 0.5) + bump(t, 0.75, 0.85));
      const whip = t > 0.95 && t < 1.4 ? Math.sin((TAU * (t - 0.95)) / 0.45) : 0;
      out.torsoYaw = 1.1 * whip;
      out.yaw = 0.5 * whip;
      out.headPitch = -0.15 * env(t, 0.9, 1.0, 1.3, 1.45);
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Other small pure helpers of the selection stage
// ---------------------------------------------------------------------------

/**
 * Overshooting ease-out (0 -> 1, flies a bit past 1 and settles): the "pop in" of a model that was just swapped.
 * Returns 0 for u <= 0 and exactly 1 for u >= 1.
 */
export function popIn(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const c1 = 1.9;
  const c3 = c1 + 1;
  const x = u - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

/** Camera distance (m) at which a sphere of `radius` fits a view with the given vertical field of view and aspect. */
export function fitDistance(radius: number, fovDeg: number, aspect: number): number {
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * Math.max(0.2, aspect);
  return radius / Math.min(tanV, tanH);
}
