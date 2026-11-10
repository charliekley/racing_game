/**
 * "Style" systems that reward good driving: slipstream (drafting) and the style combo.
 * Pure TypeScript, deterministic, no DOM / Three.js.
 *
 * Slipstream, in engineering terms: a moving kart pushes a pocket of low-pressure, slow-moving air
 * behind it (its wake). A follower sitting in that pocket meets less drag, so it can pull ahead. Here the
 * physics is replaced by a game rule: stay inside the wake cone for `SLIPSTREAM.chargeTime` seconds and
 * you get a short boost (a "slingshot" past the leader).
 *
 * Combo: three different clever things (land a trick, release a mini-turbo, slingshot) within a few
 * seconds earn a bonus boost and a `combo` event the HUD can toast.
 */
import { COMBO, SIM_DT, SLIPSTREAM } from './config';
import { applyBoost, forwardOf, rightOf, type KartState } from './kart';

/** Events produced by this file. `progress` is 0..1 (1 = boost fires). */
export type StyleEvent =
  | { kind: 'slipCharge'; slot: number; progress: number }
  | { kind: 'slipBoost'; slot: number }
  | { kind: 'combo'; slot: number };

/** Can this kart take part in drafting right now (grounded, driving, not in a cannon or being carried)? */
function active(k: KartState): boolean {
  return k.grounded && k.respawnTime <= 0 && k.spinTime <= 0 && !k.flight;
}

/**
 * Is `follower` inside the wake of `leader`? Pure geometry, exported for tests:
 * the leader is `minDist..maxDist` metres ahead along the follower's heading, within the cone, with similar heading.
 */
export function inWake(follower: KartState, leader: KartState): boolean {
  const dx = leader.pos.x - follower.pos.x;
  const dz = leader.pos.z - follower.pos.z;
  const f = forwardOf(follower.heading);
  const r = rightOf(follower.heading);
  const ahead = dx * f.x + dz * f.z; // metres in front of the follower
  const side = dx * r.x + dz * r.z; // metres to its right
  if (ahead < SLIPSTREAM.minDist || ahead > SLIPSTREAM.maxDist) return false;
  if (Math.abs(side) > SLIPSTREAM.coneBase + SLIPSTREAM.coneSlope * ahead) return false;
  const dh = Math.atan2(Math.sin(leader.heading - follower.heading), Math.cos(leader.heading - follower.heading));
  if (Math.abs(dh) > SLIPSTREAM.maxHeadingDiff) return false;
  return Math.abs(leader.pos.y - follower.pos.y) < 2;
}

/** Tracks every kart's slipstream charge. One instance per race (owned by the World). */
export class SlipstreamSystem {
  /** 0..1 charge per slot. */
  readonly charge = new Map<number, number>();
  /** Seconds before the slot may start charging again after a boost. */
  private readonly cooldown = new Map<number, number>();

  /** Advance one step. `canDraft` lets the world exclude karts (e.g. finished racers). */
  tick(karts: Map<number, KartState>, canDraft: (slot: number) => boolean = () => true): StyleEvent[] {
    const events: StyleEvent[] = [];
    for (const [slot, k] of karts) {
      const prev = this.charge.get(slot) ?? 0;
      const cool = Math.max(0, (this.cooldown.get(slot) ?? 0) - SIM_DT);
      this.cooldown.set(slot, cool);

      let drafting = false;
      if (cool <= 0 && canDraft(slot) && active(k) && k.speed >= SLIPSTREAM.minSpeed) {
        for (const [other, o] of karts) {
          if (other === slot || !active(o) || o.speed < SLIPSTREAM.minSpeed) continue;
          if (inWake(k, o)) {
            drafting = true;
            break;
          }
        }
      }

      const step = SIM_DT / SLIPSTREAM.chargeTime;
      let next = Math.max(0, drafting ? prev + step : prev - step * SLIPSTREAM.drainFactor);
      if (next >= 1) {
        // Slingshot!
        next = 0;
        this.cooldown.set(slot, SLIPSTREAM.cooldown);
        applyBoost(k, SLIPSTREAM.boostTime);
        events.push({ kind: 'slipBoost', slot });
      } else if (next > 0 || prev > 0) {
        events.push({ kind: 'slipCharge', slot, progress: next }); // one last progress 0 tells listeners to stop
      }
      this.charge.set(slot, next);
    }
    return events;
  }
}

/** The three ingredients of a style combo. */
export type StyleMove = 'trick' | 'miniTurbo' | 'slipstream';

const ALL_MOVES: readonly StyleMove[] = ['trick', 'miniTurbo', 'slipstream'];

/** Remembers when each kart last did each move; says when all three happened close together. */
export class ComboTracker {
  private readonly last = new Map<number, Partial<Record<StyleMove, number>>>();

  /**
   * Record `move` by `slot` at race time `now` (s). Returns true when this move completes a combo
   * (all three moves within COMBO.window); the memory is then cleared so the next combo starts fresh.
   */
  note(slot: number, move: StyleMove, now: number): boolean {
    const m = this.last.get(slot) ?? {};
    m[move] = now;
    this.last.set(slot, m);
    if (!ALL_MOVES.every((x) => m[x] !== undefined && now - m[x]! <= COMBO.window)) return false;
    this.last.set(slot, {});
    return true;
  }
}

/** The combo's reward: a bit more boost, added on top of whatever boost is running. */
export function applyComboBonus(k: KartState): void {
  k.boostTime += COMBO.boostTime;
}
