/**
 * HazardSystem: owns one `Hazard` per entry of `track.def.hazards`, applies them to karts
 * every tick, reports events, and gives bots advice. Pure TypeScript.
 *
 * The hazards themselves hold no changing state (they are functions of the race clock).
 * The only state kept here is "which phase was each hazard in last tick", used to turn a
 * phase change into a one-off event (warning started / eruption started) for sound and effects.
 */
import { SIM_DT, type KartConfig } from '../config';
import type { Ground } from '../ground';
import type { KartState } from '../kart';
import type { Track } from '../track';
import { HAZARD_FACTORIES } from './registry';
import { HAZARD_NEAR_DISTANCE, type BotAdvice, type Hazard, type HazardEvent, type HazardPhase } from './types';

/** Bots look this far ahead (m) for hazards. */
const LOOK_AHEAD = 55;
/** Lateral shifts (m) a bot tries when its lane is blocked, smallest first. */
const SHIFTS = [3, -3, 5, -5, 7, -7];
/** A hazard this far (m) behind the kart still counts: the bot must not swing back into it while passing. */
const BEHIND_MARGIN = 6;

export class HazardSystem {
  readonly list: Hazard[];
  private readonly lastPhase: (HazardPhase | null)[];
  /** Race time of the latest `step`, used by `wrapGround` (one tick old at most: harmless). */
  private time = 0;

  constructor(private readonly track: Track) {
    this.list = (track.def.hazards ?? []).map((def, i) => HAZARD_FACTORIES[def.kind](i, def, track));
    this.lastPhase = this.list.map(() => null);
  }

  /** Apply every hazard to every kart and return the events of this tick. Call after kart physics. */
  step(time: number, karts: Map<number, KartState>, configOf: (slot: number) => KartConfig): HazardEvent[] {
    this.time = time;
    const events: HazardEvent[] = [];
    for (const h of this.list) {
      // Phase changes -> one-off events (the first tick only records the starting phase).
      const phase = h.pose(time).phase;
      const prev = this.lastPhase[h.id];
      this.lastPhase[h.id] = phase;
      if (prev !== null && phase !== prev) {
        if (phase === 'warn') events.push({ kind: 'hazardWarn', hazard: h.id, type: h.kind, near: this.slotsNear(h, karts) });
        if (phase === 'active') events.push({ kind: 'hazardFire', hazard: h.id, type: h.kind, near: this.slotsNear(h, karts) });
      }
      for (const [slot, k] of karts) {
        if (h.affect(k, time, SIM_DT, configOf(slot)) === 'hit') events.push({ kind: 'hazardHit', slot, hazard: h.id, type: h.kind });
      }
    }
    return events;
  }

  /** Slots whose kart is within HAZARD_NEAR_DISTANCE metres (along the road) of the hazard. */
  private slotsNear(h: Hazard, karts: Map<number, KartState>): number[] {
    const out: number[] = [];
    for (const [slot, k] of karts) {
      const s = this.track.project(k.pos.x, k.pos.z, k.trackIndex).s;
      if (Math.abs(this.track.deltaS(s, h.s)) <= HAZARD_NEAR_DISTANCE) out.push(slot);
    }
    return out;
  }

  /** Ground with the hazards' overrides applied (e.g. a raised drawbridge leaf). World hands this to kart physics. */
  wrapGround(g: Ground): Ground {
    const overrides = this.list.filter((h) => h.groundAt);
    if (overrides.length === 0) return g;
    return {
      sample: (x, z, hint) => {
        const hit = g.sample(x, z, hint);
        for (const h of overrides) {
          const v = h.groundAt!(x, z, this.time);
          if (v === undefined) continue; // not this hazard's ground
          if (v === null) return null; // a hole: the kart falls
          return hit ? { ...hit, height: v } : { height: v, surface: 'road' };
        }
        return hit;
      },
    };
  }

  /**
   * Advice for a bot driving kart `k` that would like to drive on lateral line `lane` (m, + = right).
   * Looks at every hazard in the next ~55 m and asks "would that lane be dangerous when I get there?".
   * If so, `steer` is a sideways shift (m, + = right, measured from the kart's CURRENT position) to the
   * nearest free lane; if no lane is free, `brake` asks the bot to lift/brake so it arrives after the
   * hazard has finished. With no hazard in the way, steer = 0 and brake = 0.
   */
  dangerAhead(k: KartState, track: Track, time: number, lane = 0): BotAdvice {
    const none: BotAdvice = { brake: 0, steer: 0 };
    if (this.list.length === 0) return none;
    const p = track.project(k.pos.x, k.pos.z, k.trackIndex);
    if (p.route > 0) return none; // hazards sit on the main road
    const speed = Math.max(k.speed, 10);
    const limit = track.def.width / 2 - 1.8;
    let best: { dist: number; advice: BotAdvice } | null = null;
    for (const h of this.list) {
      // Distance to the hazard; for one that covers a stretch (halfLength) it is the distance to its nearest end, 0 inside.
      const raw = track.deltaS(p.s, h.s);
      const half = h.halfLength ?? 0;
      const dist = raw > half ? raw - half : raw < -half ? raw + half : 0;
      if (dist < -BEHIND_MARGIN || dist > LOOK_AHEAD) continue;
      if (h.botCommits?.(k.speed, k.boostTime > 0.3)) continue; // fast enough to take it as it comes
      const arrive = Math.max(0, dist) / speed;
      const blocked = (d: number) => h.danger(h.s, d, time, arrive) >= 0.5;
      if (!blocked(lane) && !blocked(p.d)) continue; // nothing to do for this hazard
      let target: number | null = blocked(lane) ? null : lane; // the preferred line, if it is free
      if (target === null) {
        for (const sh of SHIFTS) {
          const d = lane + sh;
          if (Math.abs(d) <= limit && !blocked(d)) {
            target = d;
            break;
          }
        }
      }
      let mine: BotAdvice;
      if (target === null) mine = { brake: dist < 30 ? 1 : 0.6, steer: 0 }; // no free lane: wait it out
      else mine = { brake: 0, steer: target - p.d };
      // The closest hazard decides when several are in view.
      if (!best || dist < best.dist) best = { dist, advice: mine };
    }
    return best ? best.advice : none;
  }
}
