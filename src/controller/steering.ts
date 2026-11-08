/**
 * Phone-as-steering-wheel math. Pure functions + a small stateful processor,
 * no DOM access, so it's unit-testable.
 *
 * Why the gravity vector instead of `deviceorientation` Euler angles?
 * Euler angles (alpha/beta/gamma) are defined relative to the phone held
 * portrait; held sideways like a wheel, "gamma" hits gimbal-lock-like jumps
 * near +-90 deg. The gravity vector has no such singularity: while the wheel is
 * mostly upright, gravity lies largely in the screen plane, and the wheel's
 * roll is simply the angle of that 2D vector.
 *
 * Coordinate frame (W3C DeviceMotion spec): device x = right edge of the phone
 * in *portrait*, y = top edge in portrait, z = out of the screen.
 * `accelerationIncludingGravity` at rest points "up" (away from the ground).
 * Some browsers (notably iOS Safari) report the opposite sign; see `inverted`.
 *
 * IMPORTANT: steering never looks at the *screen* orientation. If it did, the
 * browser auto-rotating the page when you oversteer would shift the reference
 * by 90 deg and slam the steering the other way. Instead we work out the
 * "grip" (which side the top of the phone points to) from gravity alone, with
 * hysteresis, so it only changes if you deliberately flip the phone around.
 */

export interface SteeringSettings {
  /** Rotation (deg) that gives full lock. */
  maxAngleDeg: number;
  /** Rotation (deg) around center that is ignored. */
  deadzoneDeg: number;
  /** Multiplier on the output (>1 = twitchier). */
  sensitivity: number;
  invert: boolean;
  /** 0 = linear response, 1 = fully cubic (finer control near center). */
  curve: number;
  /** Low-pass filter time constant in ms (bigger = smoother but laggier). */
  smoothingMs: number;
}

export const DEFAULT_STEERING: SteeringSettings = {
  maxAngleDeg: 45,
  deadzoneDeg: 3,
  sensitivity: 1,
  invert: false,
  curve: 0.35,
  smoothingMs: 40,
};

/** Which side the top of the phone points to while held like a wheel. */
export type Grip = 'left' | 'right';

/** Clockwise roll (device frame) of a level wheel for each grip. */
export const GRIP_ROLL: Record<Grip, number> = { left: -90, right: 90 };

const RAD2DEG = 180 / Math.PI;

/** Wrap any angle into (-180, 180]. */
export function wrapDeg(a: number): number {
  let x = ((((a + 180) % 360) + 360) % 360) - 180;
  if (x === -180) x = 180;
  return x;
}

/**
 * Clockwise roll of the phone (as seen by the person looking at the screen),
 * in degrees, in the phone's natural portrait frame.
 * Upright portrait = 0, rotated 90 deg clockwise = +90.
 */
export function rollFromGravity(gx: number, gy: number): number {
  return Math.atan2(-gx, gy) * RAD2DEG;
}

/** Deadzone + max angle + response curve + sensitivity + invert -> [-1, 1]. */
export function shapeSteer(angleDeg: number, s: SteeringSettings): number {
  const a = s.invert ? -angleDeg : angleDeg;
  const mag = Math.abs(a);
  if (mag <= s.deadzoneDeg) return 0;
  // Rescale so output starts at 0 right at the deadzone edge (no jump).
  const span = Math.max(1e-6, s.maxAngleDeg - s.deadzoneDeg);
  let x = Math.min(1, (mag - s.deadzoneDeg) / span);
  x = (1 - s.curve) * x + s.curve * x * x * x;
  x = Math.min(1, x * s.sensitivity);
  return Math.sign(a) * x;
}

/** Frame-rate-independent exponential smoothing factor for a time step. */
export function smoothingAlpha(dtMs: number, tauMs: number): number {
  if (tauMs <= 0) return 1;
  return 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
}

export interface SteeringSample {
  /** Wheel angle in degrees relative to calibrated center (before shaping). */
  angleDeg: number;
  /** Final smoothed steering value, -1..1 (positive = right). */
  steer: number;
  /** False if the phone was held too flat to read a reliable angle. */
  valid: boolean;
}

/** If less gravity than this (m/s^2) lies in the screen plane, the phone is too flat to read roll. */
const MIN_IN_PLANE_G = 2.5;
/** Grip only flips when the phone is within this many degrees of the *other* grip's level pose. */
const GRIP_SWITCH_DEG = 50;
/** |roll| below this = phone held upright (portrait), not like a wheel. */
const UPRIGHT_DEG = 35;
/** Sign-convention evidence must hold this long before we act on it. */
const EVIDENCE_MS = 400;

/**
 * Stateful pipeline: gravity -> true roll -> grip -> wheel angle ->
 * calibration -> shaping -> smoothing. Feed it every `devicemotion` event.
 */
export class SteeringProcessor {
  settings: SteeringSettings;
  /** True if this browser reports gravity with the opposite sign to the spec. */
  inverted: boolean;
  grip: Grip | null = null;
  /** Phone is currently held upright (portrait) rather than sideways. */
  upright = false;
  /** Set to true when `inverted` changed automatically (caller may persist it). */
  signChanged = false;
  /**
   * Once locked, the grip never changes by itself (and the sign is no longer
   * auto-learned), so the controller layout stays put. Only toggleInverted()
   * (the "Flip 180" button) changes it.
   */
  gripLocked = false;

  private centerDeg = 0;
  private calibrated = false;
  private lastAngle = 0;
  private target = 0;
  private smoothed = 0;
  private clockMs = 0;
  private evidence: { inverted: boolean; since: number } | null = null;

  constructor(settings: SteeringSettings = DEFAULT_STEERING, inverted = false) {
    this.settings = { ...settings };
    this.inverted = inverted;
  }

  get isCalibrated(): boolean {
    return this.calibrated;
  }

  /** Use the most recent pose as "straight ahead". */
  calibrate(): void {
    this.centerDeg = wrapDeg(this.centerDeg + this.lastAngle);
    this.calibrated = true;
    this.lastAngle = 0;
    this.target = 0;
    this.smoothed = 0;
  }

  /** Manually flip the sign convention (Settings "flip screen" button). */
  toggleInverted(): void {
    this.inverted = !this.inverted;
    this.grip = this.grip === null ? null : this.grip === 'left' ? 'right' : 'left';
  }

  /**
   * @param gx, gy  accelerationIncludingGravity x/y (m/s^2)
   * @param screenDeg  current screen orientation (only used as evidence for the
   *                   sign convention, never for steering itself)
   */
  update(gx: number, gy: number, screenDeg: number, dtMs: number): SteeringSample {
    this.clockMs += dtMs;
    this.signChanged = false;
    const inPlane = Math.hypot(gx, gy);
    const valid = inPlane >= MIN_IN_PLANE_G;

    if (!this.gripLocked) this.learnSign(gx, gy, screenDeg, valid);

    if (valid) {
      const trueRoll = wrapDeg(rollFromGravity(gx, gy) + (this.inverted ? 180 : 0));
      this.upright = Math.abs(trueRoll) < UPRIGHT_DEG;

      // Grip with hysteresis.
      if (this.grip === null) {
        if (!this.upright) this.grip = trueRoll < 0 ? 'left' : 'right';
      } else if (!this.gripLocked) {
        const other: Grip = this.grip === 'left' ? 'right' : 'left';
        if (Math.abs(wrapDeg(trueRoll - GRIP_ROLL[other])) < GRIP_SWITCH_DEG) this.grip = other;
      }
      const grip = this.grip ?? (trueRoll < 0 ? 'left' : 'right');

      this.lastAngle = wrapDeg(trueRoll - GRIP_ROLL[grip] - this.centerDeg);
      // Oversteering past full lock (even to upright) just stays at full lock.
      this.target = shapeSteer(this.lastAngle, this.settings);
    }
    // else: phone is lying nearly flat -> keep the previous target.

    this.smoothed += (this.target - this.smoothed) * smoothingAlpha(dtMs, this.settings.smoothingMs);
    if (Math.abs(this.smoothed) < 1e-4) this.smoothed = 0;
    return { angleDeg: this.lastAngle, steer: this.smoothed, valid };
  }

  /**
   * Work out the sign convention from situations where we know which way is up:
   *  - phone held upright in portrait (top up): gravity-up vector has +y
   *  - the browser has rotated the page to landscape: it knows the true
   *    orientation, so a level wheel must match the screen angle
   */
  private learnSign(gx: number, gy: number, screenDeg: number, valid: boolean): void {
    let ev: boolean | null = null;
    // Upright-ish portrait (e.g. typing your name, phone tilted back up to ~50 deg).
    if (Math.abs(gy) > 6 && Math.abs(gx) < 3) {
      ev = gy < 0;
    } else if (valid && (screenDeg === 90 || screenDeg === -90)) {
      const levelRoll = -screenDeg; // true roll of a level wheel in this screen orientation
      const d = Math.abs(wrapDeg(rollFromGravity(gx, gy) - levelRoll));
      if (d < 30) ev = false;
      else if (d > 150) ev = true;
    }
    if (ev === null) {
      this.evidence = null;
      return;
    }
    if (!this.evidence || this.evidence.inverted !== ev) {
      this.evidence = { inverted: ev, since: this.clockMs };
      return;
    }
    if (this.clockMs - this.evidence.since >= EVIDENCE_MS && ev !== this.inverted) {
      this.toggleInverted();
      this.signChanged = true;
    }
  }
}

/**
 * CSS rotation (deg, clockwise) to apply to the controller UI so it looks
 * upright to someone holding the phone with `grip`, given how the browser has
 * already rotated the page (`screenDeg`). Returns 0, 90, -90 or 180.
 */
export function uiRotationDeg(grip: Grip | null, screenDeg: number): number {
  if (grip === null) return 0;
  const desired = -GRIP_ROLL[grip]; // left grip -> content needs +90 (as if landscape 90)
  return wrapDeg(desired - screenDeg);
}
