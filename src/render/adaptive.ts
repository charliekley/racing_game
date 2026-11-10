/**
 * Adaptive quality: keeps the game near 60 fps by itself.
 *
 * Every frame the game tells us how long the last frame really took (wall-clock time between
 * two frames, which includes waiting for the GPU). We average that over short windows:
 *
 *   - too slow  -> lower the "render scale" (the canvas is drawn with fewer pixels and the
 *                  browser stretches it; everything gets a little softer but much cheaper);
 *   - still too slow at the lowest scale for several seconds -> ask for the next lower preset
 *                  (High -> Medium -> Low). It NEVER steps up to a higher preset on its own.
 *   - comfortably fast for a while -> raise the scale again, but only up to the highest value
 *                  that did not cause trouble before (so it does not flip-flop).
 *
 * Ignored on purpose: the first second after a race/preset change (shaders compile, textures
 * upload) and any gap longer than a quarter of a second (tab in the background, a debugger
 * pause, the results screen).
 */

export interface AdaptiveEvents {
  /** The render scale (0.6..1) changed: apply it to the renderer. */
  onScale(scale: number): void;
  /** Frames stay too slow even at the lowest scale: drop one quality preset. */
  onStepDown(): void;
}

/** Target frame time (ms) for 60 fps, and how much slack we tolerate before reacting. */
const TARGET_MS = 1000 / 60;
const SLOW_MS = TARGET_MS * 1.12; // about 53 fps
const FAST_MS = TARGET_MS * 1.04; // about 58+ fps
const MIN_SCALE = 0.6;
const MAX_SCALE = 1;
const SCALE_STEP = 0.1;
/** Seconds to ignore after a reset. */
const WARMUP = 1.2;
/** Length of one measuring window (s). */
const WINDOW = 0.6;
/** Seconds of being stuck at the lowest scale before dropping a preset. */
const STEP_DOWN_AFTER = 5;
/** Seconds of good frames before the scale is raised one step. */
const RAISE_AFTER = 5;

export class AdaptiveQuality {
  enabled = true;
  scale = 1;
  /** Highest scale that has held 60 fps (raised again only after a long calm stretch). */
  private ceiling = MAX_SCALE;
  private warm = WARMUP;
  private acc = 0;
  private n = 0;
  private winTime = 0;
  private stuck = 0;
  private calm = 0;
  private sinceRaise = Infinity; // seconds since the scale was last RAISED (Infinity = never / it was lowered since)
  private last = 0;

  constructor(private readonly events: AdaptiveEvents) {}

  /** Call after a race starts or the preset changes: restart the warm-up and forget old measurements. */
  reset(scale = 1): void {
    this.warm = WARMUP;
    this.acc = this.n = this.winTime = this.stuck = this.calm = 0;
    this.sinceRaise = Infinity;
    this.last = 0;
    this.ceiling = MAX_SCALE;
    this.scale = scale;
  }

  /**
   * Feed one frame. `now` = performance.now() in ms. `active` = a race is actually being played
   * (not the results screen); while false nothing is measured.
   */
  frame(now: number, active: boolean): void {
    const dtMs = this.last ? now - this.last : 0;
    this.last = now;
    if (!this.enabled || !active || dtMs <= 0) return;
    if (dtMs > 250) {
      // A long gap (hidden tab, pause): start the warm-up again instead of reacting to it.
      this.warm = Math.max(this.warm, 0.5);
      this.acc = this.n = this.winTime = 0;
      return;
    }
    const dt = dtMs / 1000;
    if (this.warm > 0) {
      this.warm -= dt;
      return;
    }
    this.acc += dtMs;
    this.n++;
    this.winTime += dt;
    this.sinceRaise += dt;
    if (this.winTime < WINDOW) return;

    const avg = this.acc / this.n;
    this.acc = this.n = this.winTime = 0;

    if (avg > SLOW_MS) {
      this.calm = 0;
      if (this.scale > MIN_SCALE + 1e-6) {
        // The scale we just tried was too much if it came right after a raise: remember that.
        if (this.sinceRaise < RAISE_AFTER * 2) this.ceiling = Math.min(this.ceiling, this.scale - SCALE_STEP);
        this.setScale(this.scale - SCALE_STEP * (avg > TARGET_MS * 1.6 ? 2 : 1));
        this.sinceRaise = Infinity;
        this.stuck = 0;
      } else {
        this.stuck += WINDOW;
        if (this.stuck >= STEP_DOWN_AFTER) {
          this.stuck = 0;
          this.events.onStepDown();
        }
      }
    } else {
      this.stuck = 0;
      if (avg < FAST_MS && this.scale < this.ceiling - 1e-6) {
        this.calm += WINDOW;
        if (this.calm >= RAISE_AFTER) {
          this.calm = 0;
          this.setScale(this.scale + SCALE_STEP);
          this.sinceRaise = 0;
        }
      } else this.calm = 0;
    }
  }

  private setScale(s: number): void {
    this.scale = Math.min(this.ceiling, Math.max(MIN_SCALE, Math.round(s * 100) / 100));
    this.events.onScale(this.scale);
  }
}
