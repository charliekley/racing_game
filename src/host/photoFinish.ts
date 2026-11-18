/**
 * Photo-finish slow motion.
 *
 * When two karts cross the line within a fraction of a second (the sim's `photoFinish` event),
 * the TV plays a short slow-motion moment. This class only holds the TIMING; it is pure
 * (no DOM, no Three.js) so it can be unit-tested.
 *
 * How slow motion stays deterministic: the simulation ALWAYS steps in fixed 1/60 s steps
 * (see sim/loop.ts). Slow motion simply feeds the loop less time per real second
 * (`realDt * scale`), so it takes fewer steps per second, each one exactly the same size.
 * Nothing in the sim knows about it.
 */

/** Length of the whole moment in REAL seconds. */
export const PHOTO_SECONDS = 1.2;
/** Time scale while the slow motion is at full effect (0.3 = 30 % speed). */
export const PHOTO_SCALE = 0.3;
/** The last stretch (real seconds) eases back up to full speed so it does not snap. */
const EASE_OUT = 0.3;

export interface PhotoFinishInfo {
  /** The two karts that crossed the line almost together. */
  slots: readonly [number, number];
  isHuman: (slot: number) => boolean;
  knockout: boolean;
  /** One per race is enough: a second one would just be annoying. */
  alreadyPlayed: boolean;
}

/**
 * Is this photo finish worth slow motion? Not in Knockout (the race is about who is eliminated, and the
 * results must not be delayed) and not when only bots were involved (nobody on the couch cares).
 */
export function worthSlowMotion(info: PhotoFinishInfo): boolean {
  if (info.knockout || info.alreadyPlayed) return false;
  return info.slots.some((s) => info.isHuman(s));
}

export class PhotoFinishFx {
  /** Real seconds left of the moment (0 = not playing). */
  private remaining = 0;

  get active(): boolean {
    return this.remaining > 0;
  }

  /** Seconds of the moment already played (for the flash and the camera hold). */
  get elapsed(): number {
    return this.active ? PHOTO_SECONDS - this.remaining : 0;
  }

  start(): void {
    this.remaining = PHOTO_SECONDS;
  }

  /** Cancel (a player pressed a key, or a new race started). */
  skip(): void {
    this.remaining = 0;
  }

  /**
   * Call once per rendered frame with the real elapsed seconds; returns the time scale to use for this frame
   * (1 = normal). The moment ends after PHOTO_SECONDS of REAL time, whatever the scale.
   */
  tick(realDt: number): number {
    if (this.remaining <= 0) return 1;
    // Scale for this frame: full slow motion, easing back to 1 over the last EASE_OUT seconds.
    const ease = Math.min(1, this.remaining / EASE_OUT); // 1 = deep slow motion, 0 = about to end
    const scale = 1 - (1 - PHOTO_SCALE) * ease;
    this.remaining = Math.max(0, this.remaining - realDt);
    return scale;
  }
}
