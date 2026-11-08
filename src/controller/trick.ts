/**
 * Detects a quick flick/shake of the phone (used for mid-air tricks).
 *
 * We look at *linear* acceleration (gravity removed). Browsers provide that as
 * `event.acceleration`; where it's missing we estimate gravity with a slow
 * low-pass filter and subtract it (a simple high-pass filter).
 */
export interface TrickSettings {
  /** Linear acceleration magnitude (m/s^2) that counts as a flick. */
  thresholdMs2: number;
  /** Minimum time between two tricks. */
  cooldownMs: number;
  /** Time constant for the gravity estimate when linear acceleration isn't available. */
  gravityTauMs: number;
}

export const DEFAULT_TRICK: TrickSettings = { thresholdMs2: 14, cooldownMs: 600, gravityTauMs: 250 };

export class TrickDetector {
  private gravity: [number, number, number] | null = null;
  private lastTrickAt = -Infinity;
  private armed = true; // must drop below threshold before triggering again

  constructor(private readonly s: TrickSettings = DEFAULT_TRICK) {}

  /**
   * @param linear  acceleration without gravity, or null if unavailable
   * @param withG   acceleration including gravity
   * @returns true exactly once per detected flick
   */
  update(
    linear: [number, number, number] | null,
    withG: [number, number, number],
    nowMs: number,
    dtMs: number,
  ): boolean {
    let mag: number;
    if (linear) {
      mag = Math.hypot(linear[0], linear[1], linear[2]);
    } else {
      if (!this.gravity) this.gravity = [...withG];
      const k = 1 - Math.exp(-Math.max(0, dtMs) / this.s.gravityTauMs);
      for (let i = 0; i < 3; i++) this.gravity[i] += (withG[i] - this.gravity[i]) * k;
      mag = Math.hypot(withG[0] - this.gravity[0], withG[1] - this.gravity[1], withG[2] - this.gravity[2]);
    }

    if (mag < this.s.thresholdMs2 * 0.5) this.armed = true;
    if (this.armed && mag >= this.s.thresholdMs2 && nowMs - this.lastTrickAt >= this.s.cooldownMs) {
      this.lastTrickAt = nowMs;
      this.armed = false;
      return true;
    }
    return false;
  }
}
