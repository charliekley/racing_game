/**
 * Lava geyser (Ember Peaks). A spot on the road that erupts once per `period`:
 *
 *   idle -> warn (about 1.5 s: glowing crack, sparks, steam) -> active (about 1.2 s: lava column)
 *
 * A kart inside the column while it is active spins out and is popped a little into the air.
 * Spin-out gives `invulnTime`, so one eruption hits a kart at most once (and the kart is
 * protected for the next few seconds, like with item hits).
 */
import type { GeyserDef } from '../../track/hazardTypes';
import { spinOut, type KartState } from '../kart';
import type { KartConfig } from '../config';
import type { Track } from '../track';
import { cyclePose } from './cycle';
import type { Hazard, HazardPose } from './types';

/** Upward speed of the pop when a geyser hits (m/s). */
export const GEYSER_POP_SPEED = 7;
/** A kart counts as touching the column when its centre is within radius + this (m): roughly half a kart. */
const KART_REACH = 0.9;
/** Seconds either side of its arrival time that a bot treats as "the geyser might be firing". */
const DANGER_MARGIN = 0.35;

export class Geyser implements Hazard {
  readonly kind = 'geyser' as const;
  readonly s: number;
  /** World position of the column's centre, and the road height there. */
  readonly x: number;
  readonly z: number;
  readonly y: number;
  /** Sideways position on the road (m, + = right of travel). */
  readonly lateral: number;
  readonly radius: number;
  private readonly period: number;
  private readonly phase: number;
  private readonly warn: number;
  private readonly active: number;

  constructor(
    readonly id: number,
    def: GeyserDef,
    private readonly track: Track,
  ) {
    this.period = def.period;
    this.phase = def.phase ?? 0;
    this.warn = def.warn ?? 1.5;
    this.active = def.active ?? 1.2;
    this.radius = def.radius ?? 3;
    this.s = track.sAt(def.at);
    this.lateral = (def.offset ?? 0) * (track.def.width / 2);
    const p = track.pointAt(this.s, this.lateral);
    this.x = p.x;
    this.z = p.z;
    this.y = track.sample(p.x, p.z, p.index)?.height ?? p.y;
  }

  pose(time: number): HazardPose {
    const c = cyclePose(time, this.period, this.phase, this.warn, this.active);
    return { phase: c.phase, t: c.t, x: this.x, y: this.y, z: this.z, radius: this.radius };
  }

  affect(k: KartState, time: number, _dt: number, c: KartConfig): 'hit' | 'push' | null {
    if (k.respawnTime > 0 || k.flight || k.invulnTime > 0) return null;
    if (cyclePose(time, this.period, this.phase, this.warn, this.active).phase !== 'active') return null;
    // Only karts at this height: a road passing over the geyser (an overpass) is safe.
    if (k.pos.y > this.y + 4 || k.pos.y < this.y - 3) return null;
    const reach = this.radius + KART_REACH;
    if (Math.hypot(k.pos.x - this.x, k.pos.z - this.z) > reach) return null;
    if (k.starTime > 0) return null; // Nova (invincibility) shrugs it off
    spinOut(k, c);
    // The pop: leave the ground for a moment (gravity brings the kart back down).
    k.grounded = false;
    k.vel.y = GEYSER_POP_SPEED;
    return 'hit';
  }

  danger(s: number, d: number, time: number, ahead: number): number {
    if (Math.abs(this.track.deltaS(this.s, s)) > this.radius + 2) return 0;
    if (Math.abs(d - this.lateral) > this.radius + KART_REACH + 0.8) return 0;
    // Arriving inside the eruption, or within a small margin of it: dangerous.
    const t = time + ahead;
    for (const dt of [-DANGER_MARGIN, 0, DANGER_MARGIN]) {
      if (cyclePose(t + dt, this.period, this.phase, this.warn, this.active).phase === 'active') return 1;
    }
    return 0;
  }
}
