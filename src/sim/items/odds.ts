/**
 * Which item an item box gives you, depending on your race position.
 *
 * Idea ("rubber banding"): whoever is in front mostly gets defensive items
 * (traps, rear-firing shots) and rarely anything powerful; whoever is behind
 * gets the strong stuff (homing shots, Nova, dash packs) to catch up.
 *
 * Seeker, Jumble and Magnet only come out when someone is ahead of you. Jumble is also rare and
 * only for karts well behind (its weight ramps from 0 at mid-field to the "last place" value).
 * Weights are given for the leader and for last place; every position in
 * between interpolates linearly, so the same table works for 2, 3 or 4 racers.
 * Pure functions: deterministic given the random-number source.
 */
import type { HeldItem } from './types';

/** What can come out of a box. 'dash3' is the three-charge Dash pack. */
export type ItemPick = 'dash' | 'dash3' | 'slick' | 'ricochet' | 'seeker' | 'nova' | 'jumble' | 'magnet' | 'bumper';
export const ITEM_PICKS: readonly ItemPick[] = ['dash', 'dash3', 'slick', 'ricochet', 'seeker', 'nova', 'jumble', 'magnet', 'bumper'];

type Weights = Record<ItemPick, number>;

/** Relative likelihoods (they don't need to add up to 100). */
export const LEADER_WEIGHTS: Weights = { dash: 24, dash3: 2, slick: 34, ricochet: 28, seeker: 0, nova: 0, jumble: 0, magnet: 0, bumper: 18 };
export const LAST_WEIGHTS: Weights = { dash: 10, dash3: 20, slick: 3, ricochet: 6, seeker: 20, nova: 26, jumble: 6, magnet: 16, bumper: 6 };

/** Jumble is for karts well behind: nothing in the front half of the field, then a linear ramp up to last place. */
const JUMBLE_FROM = 0.5;

/** Weights for 1-based `position` out of `racers`. */
export function itemWeights(position: number, racers: number): Weights {
  // f = 0 for the leader, 1 for last place. A lone racer gets the middle of the table.
  const f = racers <= 1 ? 0.5 : Math.min(1, Math.max(0, (position - 1) / (racers - 1)));
  const out = {} as Weights;
  for (const k of ITEM_PICKS) out[k] = LEADER_WEIGHTS[k] + (LAST_WEIGHTS[k] - LEADER_WEIGHTS[k]) * f;
  out.jumble = LAST_WEIGHTS.jumble * Math.max(0, (f - JUMBLE_FROM) / (1 - JUMBLE_FROM));
  // Items that target "the racer(s) ahead of you" are pointless in the lead.
  if (position <= 1) {
    out.seeker = 0;
    out.jumble = 0;
    out.magnet = 0;
  }
  return out;
}

/** Choose an item. `rnd` returns a number in [0, 1) (Math.random, or a seeded generator). */
export function rollPick(position: number, racers: number, rnd: () => number): ItemPick {
  const w = itemWeights(position, racers);
  const total = ITEM_PICKS.reduce((a, k) => a + w[k], 0);
  let r = rnd() * total;
  for (const k of ITEM_PICKS) {
    r -= w[k];
    if (r < 0) return k;
  }
  return ITEM_PICKS[ITEM_PICKS.length - 1];
}

export function pickToItem(pick: ItemPick): HeldItem {
  return pick === 'dash3' ? { id: 'dash', count: 3 } : { id: pick, count: 1 };
}

export function rollItem(position: number, racers: number, rnd: () => number): HeldItem {
  return pickToItem(rollPick(position, racers, rnd));
}

/** Small fast seeded random generator (mulberry32): same seed -> same sequence. */
export function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
