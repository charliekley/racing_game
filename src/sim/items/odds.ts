/**
 * Which item an item box gives you, depending on your race position.
 *
 * Idea ("rubber banding"): whoever is in front mostly gets defensive items (peels, decoys, single shots) and
 * never anything powerful; whoever is behind gets the strong stuff (Dash packs, Nova, Rocket, Storm) to catch up.
 *
 * The odds are written as a TABLE for a field of 12: one row per place, one column per pick, every row adding up
 * to 100 (percent). Smaller fields (2 to 11 racers) read the same table by FRACTION of the field: the leader
 * always reads row 1, last place always row 12, and a place in between reads a blend of the two rows around it.
 * So "last of 4" gets what "last of 12" gets, and 2nd of 4 gets a mix of places 8 and 9 of the table.
 * Pure functions: deterministic given the random-number source.
 */
import type { HeldItem } from './types';

/** What can come out of a box. The `...3` picks are triple packs (3 charges). */
export type ItemPick =
  | 'slick'
  | 'slick3'
  | 'decoy'
  | 'ricochet'
  | 'ricochet3'
  | 'seeker'
  | 'dash'
  | 'dash3'
  | 'nova'
  | 'jumble'
  | 'hunter'
  | 'storm'
  | 'rocket';
export const ITEM_PICKS: readonly ItemPick[] = [
  'slick', 'slick3', 'decoy', 'ricochet', 'ricochet3', 'seeker', 'dash', 'dash3', 'nova', 'jumble', 'hunter', 'storm', 'rocket',
];

type Weights = Record<ItemPick, number>;

/**
 * THE TABLE: percent chance of each pick for each place of a 12-racer field (row 0 = 1st place ... row 11 = 12th).
 * Columns follow ITEM_PICKS:
 *
 *   peel  peel3 decoy  rico rico3 seeker  dash dash3  nova jumble hunter storm rocket
 *
 * Shape, in words:
 *   - Peel, Peel x3, Decoy and the single Ricochet are for the front (1st-4th) and fade out by about 6th;
 *   - Seeker (homing) and Ricochet x3 fill 2nd-7th;
 *   - Dash (single) lives in the middle, Dash x3 grows through the back half and peaks around 8th-9th;
 *   - Jumble 4th-9th and the rare Hunter 4th-8th (never the leader);
 *   - Nova from 7th, Rocket from 8th rising toward last, Storm only 9th-12th rising toward last.
 */
export const ITEM_TABLE: readonly (readonly number[])[] = [
  //  peel peel3 decoy rico rico3 seeker dash dash3 nova jumble hunter storm rocket
  [30, 8, 22, 28, 4, 0, 8, 0, 0, 0, 0, 0, 0], //  1st: only defensive stuff
  [22, 8, 18, 20, 8, 10, 12, 2, 0, 0, 0, 0, 0], //  2nd
  [16, 8, 12, 18, 12, 16, 14, 4, 0, 0, 0, 0, 0], //  3rd
  [10, 6, 8, 12, 14, 22, 16, 6, 0, 4, 2, 0, 0], //  4th: first Jumble and Hunter
  [5, 3, 4, 7, 14, 24, 20, 12, 0, 8, 3, 0, 0], //  5th
  [2, 1, 2, 3, 12, 25, 22, 18, 0, 10, 5, 0, 0], //  6th
  [1, 0, 1, 1, 8, 20, 20, 27, 6, 10, 6, 0, 0], //  7th: Nova starts
  [0, 0, 0, 0, 4, 12, 16, 34, 12, 10, 6, 0, 6], //  8th: Rocket starts
  [0, 0, 0, 0, 1, 8, 10, 36, 19, 8, 2, 4, 12], //  9th: Storm starts, Dash x3 peaks
  [0, 0, 0, 0, 0, 4, 6, 32, 24, 4, 0, 8, 22], // 10th
  [0, 0, 0, 0, 0, 2, 3, 22, 27, 0, 0, 12, 34], // 11th
  [0, 0, 0, 0, 0, 0, 0, 16, 28, 0, 0, 14, 42], // 12th: Rocket, Storm and Nova
];

/** The picks that only make sense when somebody is ahead of you (a lone leader never gets them). */
const NEEDS_SOMEONE_AHEAD: readonly ItemPick[] = ['seeker', 'jumble', 'hunter', 'storm', 'rocket'];

/**
 * Weights (percent, adding up to 100) for `position` (1-based; may be fractional) out of `racers`.
 * A lone racer gets the middle of the table.
 */
export function itemWeights(position: number, racers: number): Weights {
  // Where in the table: 0 = first row ... 11 = last row.
  const f = racers <= 1 ? 0.5 : Math.min(1, Math.max(0, (position - 1) / (racers - 1)));
  const x = f * (ITEM_TABLE.length - 1);
  const lo = Math.floor(x);
  const hi = Math.min(ITEM_TABLE.length - 1, lo + 1);
  const t = x - lo;
  const out = {} as Weights;
  ITEM_PICKS.forEach((k, c) => (out[k] = ITEM_TABLE[lo][c] + (ITEM_TABLE[hi][c] - ITEM_TABLE[lo][c]) * t));
  // Nobody ahead of you (1st place, or a lone racer in the lead): the targeting items are pointless; share their odds out.
  if (position <= 1) {
    for (const k of NEEDS_SOMEONE_AHEAD) out[k] = 0;
    const total = ITEM_PICKS.reduce((a, k) => a + out[k], 0);
    for (const k of ITEM_PICKS) out[k] = (out[k] * 100) / total;
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
  if (pick === 'dash3') return { id: 'dash', count: 3 };
  if (pick === 'slick3') return { id: 'slick', count: 3, pack: true };
  if (pick === 'ricochet3') return { id: 'ricochet', count: 3, pack: true };
  return { id: pick, count: 1 };
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
