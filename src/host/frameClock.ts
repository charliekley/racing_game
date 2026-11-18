/**
 * FrameClock: turns the raw time between two animation frames into a steadier `dt`.
 *
 * Why: the browser tells us "now" with a little noise (on a 60 Hz screen the gaps are 16.2, 17.1,
 * 16.7 ... ms, never exactly 16.67). Feeding that noise straight into the fixed-step loop makes
 * the simulation take 0, 1 or 2 steps from one frame to the next and the camera/particles move
 * by uneven amounts: a faint judder even though the frame rate is perfect.
 *
 * What it does:
 *   - It keeps a slow average of the "normal" gaps (the display's refresh period).
 *   - A gap close to that average is replaced by the average (plus a small correction so the
 *     total time never drifts away from the real clock).
 *   - A gap far from the average is a real hitch (or a tab switch): it is passed through, capped
 *     at `maxDt`, so the game still catches up instead of slowing down.
 *
 * Pure maths, no browser calls, so it is unit-tested (frameClock.test.ts).
 */
export class FrameClock {
  /** Running average of the normal frame gap (s); 0 until the first gap is seen. */
  private avg = 0;
  /** Real time minus the time we handed out (s): fed back slowly so the two clocks never separate. */
  private drift = 0;
  private lastNow = Number.NaN;

  constructor(
    /** Longest dt ever returned (s): after a tab switch the game must not jump ahead by seconds. */
    private readonly maxDt = 0.1,
    /** A gap within this fraction of the average counts as "normal" and is smoothed. */
    private readonly tolerance = 0.3,
  ) {}

  /** `now` in milliseconds (the rAF timestamp). Returns the dt (seconds) to simulate and draw. */
  tick(now: number): number {
    const raw = Number.isNaN(this.lastNow) ? 0 : Math.max(0, (now - this.lastNow) / 1000);
    this.lastNow = now;
    if (raw === 0) return 0;
    if (this.avg === 0) this.avg = Math.min(raw, 0.05);

    const normal = Math.abs(raw - this.avg) <= this.avg * this.tolerance;
    if (!normal) {
      // A hitch (long gap) or a faster display. Follow the new rhythm only if it is plausible (4 ms .. 50 ms),
      // slowly, so one odd frame does not move the average.
      if (raw > 0.004 && raw < 0.05) this.avg += (raw - this.avg) * 0.1;
      return Math.min(raw, this.maxDt);
    }
    this.avg += (raw - this.avg) * 0.05;
    // Hand out the average plus a tenth of the accumulated error, but never stray far from it.
    const used = Math.min(this.avg * 1.15, Math.max(this.avg * 0.85, this.avg + this.drift * 0.1));
    this.drift += raw - used;
    this.drift = Math.max(-0.05, Math.min(0.05, this.drift));
    return used;
  }

  /** Forget everything (call when the page was hidden for a while). */
  reset(): void {
    this.avg = 0;
    this.drift = 0;
    this.lastNow = Number.NaN;
  }
}
