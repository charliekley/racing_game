/**
 * "WRONG WAY" detection: is a human kart driving backwards along the track?
 *
 * Pure logic (no DOM, no Three.js) so it can be unit-tested. Every frame the host tells
 * `WrongWayDetector.update` how fast the kart moves ALONG the track (positive = the right
 * way round, negative = against the racing direction) and whether the kart is in a state
 * where the question makes no sense (carried back by the respawn drone, flying in a cannon,
 * spinning out after a hit). The detector answers true once the kart has been moving
 * backwards for WRONG_WAY_AFTER seconds in a row, and false again the moment the kart is
 * no longer moving backwards (turned round, stopped, or an excluded state began).
 */

/** The kart must move at least this fast (m/s) against the track direction to count as "going backwards". */
export const WRONG_WAY_SPEED = 3;
/** ...and keep doing so for this long (s) before the sign appears: a short spin or reverse must not trigger it. */
export const WRONG_WAY_AFTER = 1.5;

/** Speed along the track (m/s): the kart's velocity projected on the road's unit tangent (tx, tz). */
export function speedAlongTrack(vx: number, vz: number, tx: number, tz: number): number {
  return vx * tx + vz * tz;
}

export class WrongWayDetector {
  /** How long (s) the kart has been moving backwards without a break. */
  private backwardsFor = 0;

  /**
   * @param along   speed along the track (m/s), negative = against the racing direction
   * @param excluded  true while respawning, in a cannon, spinning out, finished, or before the start
   * @returns true while the WRONG WAY sign should be shown
   */
  update(dt: number, along: number, excluded: boolean): boolean {
    if (excluded || along > -WRONG_WAY_SPEED) {
      this.backwardsFor = 0; // any break resets the timer, and the sign clears at once
      return false;
    }
    this.backwardsFor += dt;
    return this.backwardsFor >= WRONG_WAY_AFTER;
  }

  reset(): void {
    this.backwardsFor = 0;
  }
}
