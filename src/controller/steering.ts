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
 * Some iOS versions report the opposite sign; we detect that automatically
 * (see `SteeringProcessor`), and calibration removes any constant offset anyway.
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

const RAD2DEG = 180 / Math.PI;

/** Wrap any angle into (-180, 180]. */
export function wrapDeg(a: number): number {
  let x = ((a + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

/**
 * Clockwise roll of the phone (as seen by the person looking at the screen),
 * in degrees, measured in the phone's natural portrait frame.
 * Upright portrait = 0, rotated 90 deg clockwise = +90.
 */
export function rollFromGravity(gx: number, gy: number): number {
  return Math.atan2(-gx, gy) * RAD2DEG;
}

/**
 * Convert portrait-frame roll into a wheel angle relative to the *current
 * screen orientation*, so "level" is 0 in both landscape-left and
 * landscape-right. `orientationDeg` is window.orientation / screen.orientation.angle
 * (how far the screen content is rotated counter-clockwise: 90 or -90/270 in landscape).
 */
export function wheelAngle(rollDeg: number, orientationDeg: number, flipped = false): number {
  return wrapDeg(rollDeg + orientationDeg + (flipped ? 180 : 0));
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

/**
 * Stateful pipeline: gravity -> wheel angle -> calibration -> shaping -> smoothing.
 * Feed it every `devicemotion` event.
 */
export class SteeringProcessor {
  settings: SteeringSettings;
  private centerDeg = 0;
  private calibrated = false;
  private flipped: boolean | null = null; // null = not determined yet
  private lastAngle = 0;
  private target = 0;
  private smoothed = 0;

  constructor(settings: SteeringSettings = DEFAULT_STEERING) {
    this.settings = { ...settings };
  }

  get isCalibrated(): boolean {
    return this.calibrated;
  }

  /** Use the most recent pose as "straight ahead". */
  calibrate(): void {
    this.centerDeg += this.lastAngle;
    this.calibrated = true;
    this.lastAngle = 0;
    this.target = 0;
    this.smoothed = 0;
  }

  update(gx: number, gy: number, orientationDeg: number, dtMs: number): SteeringSample {
    const inPlane = Math.hypot(gx, gy);
    if (inPlane >= MIN_IN_PLANE_G) {
      let angle = wheelAngle(rollFromGravity(gx, gy), orientationDeg, this.flipped ?? false);
      // Sign-convention auto-detect: before calibration, nobody holds a wheel
      // upside down, so a reading near 180 deg means this browser reports the
      // gravity vector with the opposite sign. Decide once, on the first reading.
      if (this.flipped === null) {
        this.flipped = Math.abs(angle) > 90;
        if (this.flipped) angle = wrapDeg(angle + 180);
      }
      this.lastAngle = wrapDeg(angle - this.centerDeg);
      this.target = shapeSteer(this.lastAngle, this.settings);
    }
    // else: phone is lying nearly flat -> keep the previous target.
    this.smoothed += (this.target - this.smoothed) * smoothingAlpha(dtMs, this.settings.smoothingMs);
    if (Math.abs(this.smoothed) < 1e-4) this.smoothed = 0;
    return { angleDeg: this.lastAngle, steer: this.smoothed, valid: inPlane >= MIN_IN_PLANE_G };
  }
}
