/**
 * Wind gust (Cloud Garden). A stretch of the road (`from`..`to`, an exposed bridge) where the wind
 * blows sideways for a while each `period`:
 *
 *   idle -> warn (about 1.5 s: wind streaks and a rising whistle) -> active (about 1.5 s: the push)
 *
 * While it is active every kart on the stretch gets a sideways acceleration `strength` (m/s^2),
 * to the right of the direction of travel when `dir` is +1, to the left when -1.
 *
 * What that does to a kart: the kart's grip kills sideways sliding with a rate of 9 per second, so a
 * steady push of `strength` settles at a sideways drift of strength / 9 m/s (42 m/s^2 gives about
 * 4.7 m/s). Over a 1.5 s gust a kart that does not steer is carried about 5 m sideways: from the
 * middle of a 14 m bridge that still ends on the deck, from the downwind half it goes over the edge.
 * Steering into the wind (a few degrees of heading, the kart then crabs along the bridge) cancels it.
 * So the gust punishes a kart that ignores it, and never makes a fall unavoidable.
 *
 * The strength fades in and out over the first and last quarter of the active phase, so the wind
 * "builds" instead of kicking the kart sideways in one tick.
 */
import type { GustDef } from '../../track/hazardTypes';
import type { KartConfig } from '../config';
import { rightOf, type KartState } from '../kart';
import { CURB_WIDTH, type Track } from '../track';
import { cyclePose } from './cycle';
import type { Hazard, HazardPose } from './types';

/** Share of the active phase spent fading in, and fading out. */
const FADE = 0.25;
/** Seconds either side of its arrival time that a bot treats the stretch as "the wind may be blowing". */
const DANGER_MARGIN = 0.4;
/** Karts further than this (m) from the gust's stretch's deck height are on another road (overpass). */
const SAME_LEVEL = 4;
/** A kart whose lateral position is on the downwind side beyond this (m, in wind direction) is "exposed". */
const EXPOSED_FROM = -1.5;

/** Wind strength 0..1 at progress `t` (0..1) of the active phase: fades in, full, fades out. */
export function gustEnvelope(t: number): number {
  const up = Math.min(1, Math.max(0, t / FADE));
  const down = Math.min(1, Math.max(0, (1 - t) / FADE));
  const x = Math.min(up, down);
  return x * x * (3 - 2 * x);
}

export class Gust implements Hazard {
  readonly kind = 'gust' as const;
  /** Middle of the stretch (main-route distance), and half its length: bots see the whole stretch. */
  readonly s: number;
  readonly halfLength: number;
  /** Stretch start and end (main-route distance). */
  readonly s0: number;
  readonly s1: number;
  readonly dir: 1 | -1;
  readonly strength: number;
  /** Half the width of the deck including curbs (m): beyond it there is nothing to drive on. */
  readonly halfWidth: number;
  private readonly period: number;
  private readonly phase: number;
  private readonly warn: number;
  private readonly active: number;

  constructor(
    readonly id: number,
    def: GustDef,
    readonly track: Track,
  ) {
    this.period = def.period;
    this.phase = def.phase ?? 0;
    this.warn = def.warn ?? 1.5;
    this.active = def.active ?? 1.5;
    this.dir = def.dir;
    this.strength = def.strength;
    this.s0 = track.sAt(def.from);
    this.s1 = track.sAt(def.to);
    this.s = (this.s0 + this.s1) / 2;
    this.halfLength = (this.s1 - this.s0) / 2;
    this.halfWidth = track.def.width / 2 + CURB_WIDTH;
  }

  pose(time: number): HazardPose {
    const c = cyclePose(time, this.period, this.phase, this.warn, this.active);
    const wind = c.phase === 'active' ? gustEnvelope(c.t) : 0;
    return { phase: c.phase, t: c.t, dir: this.dir, wind, strength: this.strength * wind };
  }

  affect(k: KartState, time: number, dt: number, _c: KartConfig): 'hit' | 'push' | null {
    if (k.respawnTime > 0 || k.flight) return null;
    const c = cyclePose(time, this.period, this.phase, this.warn, this.active);
    if (c.phase !== 'active') return null;
    // Only on the stretch, and only for karts on this road (not on an overpass above it or the ground far below).
    const p = this.track.project(k.pos.x, k.pos.z, k.trackIndex);
    if (p.route > 0 || this.track.deltaS(this.s0, p.s) < 0 || this.track.deltaS(p.s, this.s1) < 0) return null;
    if (Math.abs(k.pos.y - p.y) > SAME_LEVEL || Math.abs(p.d) > this.halfWidth + 3) return null;
    // Push along the road's "right" vector (it turns with the bridge).
    const r = rightOf(this.track.pointAt(p.s).heading);
    const a = this.strength * gustEnvelope(c.t) * this.dir * dt;
    k.vel.x += r.x * a;
    k.vel.z += r.z * a;
    return 'push';
  }

  /**
   * Bots: while the wind blows (or is about to), the downwind half of the road is "dangerous", so a bot
   * moves to the upwind side and lets the wind carry it back toward the middle.
   */
  danger(_s: number, d: number, time: number, ahead: number): number {
    const t = time + ahead;
    let windy = false;
    for (const dt of [-DANGER_MARGIN, 0, DANGER_MARGIN]) {
      if (cyclePose(t + dt, this.period, this.phase, this.warn, this.active).phase !== 'idle') windy = true;
    }
    if (!windy) return 0;
    return d * this.dir > EXPOSED_FROM ? 1 : 0;
  }
}
