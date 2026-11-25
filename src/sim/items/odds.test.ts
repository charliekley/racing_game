import { describe, expect, it } from 'vitest';
import { ITEM_PICKS, ITEM_TABLE, itemWeights, pickToItem, rollItem, rollPick, seededRng, type ItemPick } from './odds';

/** How often each pick comes out over many rolls. */
function distribution(position: number, racers: number, n = 20000): Record<ItemPick, number> {
  const rnd = seededRng(42);
  const counts = Object.fromEntries(ITEM_PICKS.map((k) => [k, 0])) as Record<ItemPick, number>;
  for (let i = 0; i < n; i++) counts[rollPick(position, racers, rnd)]++;
  for (const k of ITEM_PICKS) counts[k] /= n;
  return counts;
}

/** The table's percentage of `pick` at (1-based) place `place` of 12. */
const cell = (place: number, pick: ItemPick) => ITEM_TABLE[place - 1][ITEM_PICKS.indexOf(pick)];
const placesWith = (pick: ItemPick) => ITEM_TABLE.map((_, i) => i + 1).filter((p) => cell(p, pick) > 0);

describe('item odds table', () => {
  it('has 12 rows, one value per pick, and every row adds up to 100 %', () => {
    expect(ITEM_TABLE.length).toBe(12);
    for (const row of ITEM_TABLE) {
      expect(row.length).toBe(ITEM_PICKS.length);
      expect(row.every((v) => v >= 0)).toBe(true);
      expect(row.reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  it('computed weights add up to 100 for every place of every field size', () => {
    for (const racers of [1, 2, 3, 4, 8, 12]) {
      for (let pos = 1; pos <= racers; pos++) {
        const w = itemWeights(pos, racers);
        expect(ITEM_PICKS.reduce((a, k) => a + w[k], 0)).toBeCloseTo(100, 6);
      }
    }
  });

  it('the leader only gets defensive items: never Seeker, Jumble, Hunter, Storm, Rocket, Nova or Dash x3', () => {
    for (const racers of [2, 4, 8, 12]) {
      const w = itemWeights(1, racers);
      for (const k of ['seeker', 'jumble', 'hunter', 'storm', 'rocket', 'nova', 'dash3'] as const) expect(w[k]).toBe(0);
    }
    const lead = distribution(1, 12);
    expect(lead.slick + lead.slick3 + lead.decoy + lead.ricochet).toBeGreaterThan(0.8);
  });

  it('Peel, Peel x3, Decoy and Ricochet are for the front (1st-6th) and never spam the back half', () => {
    for (const k of ['slick', 'slick3', 'decoy', 'ricochet'] as const) {
      expect(Math.max(...placesWith(k))).toBeLessThanOrEqual(7);
      for (let p = 8; p <= 12; p++) expect(cell(p, k)).toBe(0);
      expect(cell(1, k)).toBeGreaterThan(cell(5, k)); // fading toward the middle
    }
    const back = distribution(12, 12);
    expect(back.slick + back.slick3 + back.decoy + back.ricochet).toBe(0);
  });

  it('Seeker and Ricochet x3 fill the places 2nd-7th (and thin out at the very back)', () => {
    expect(cell(1, 'seeker')).toBe(0);
    for (let p = 2; p <= 7; p++) expect(cell(p, 'seeker')).toBeGreaterThan(0);
    expect(Math.max(...[2, 3, 4, 5, 6, 7].map((p) => cell(p, 'seeker')))).toBeGreaterThan(cell(11, 'seeker'));
    for (let p = 1; p <= 7; p++) expect(cell(p, 'ricochet3')).toBeGreaterThan(0);
    expect(cell(5, 'ricochet3')).toBeGreaterThan(cell(10, 'ricochet3'));
  });

  it('Dash x3 grows through the back half and peaks around 8th-9th; single Dash lives in the middle', () => {
    const triple = ITEM_TABLE.map((_, i) => cell(i + 1, 'dash3'));
    const peak = triple.indexOf(Math.max(...triple)) + 1;
    expect([8, 9]).toContain(peak);
    expect(cell(9, 'dash3')).toBeGreaterThan(cell(4, 'dash3') * 3);
    const single = ITEM_TABLE.map((_, i) => cell(i + 1, 'dash'));
    const mid = single.indexOf(Math.max(...single)) + 1;
    expect(mid).toBeGreaterThanOrEqual(4);
    expect(mid).toBeLessThanOrEqual(7);
  });

  it('Nova from 7th, Rocket from 8th rising toward last, Storm only 9th-12th rising toward last', () => {
    expect(placesWith('nova')[0]).toBe(7);
    expect(placesWith('rocket')[0]).toBe(8);
    expect(placesWith('storm')[0]).toBe(9);
    for (let p = 9; p < 12; p++) {
      expect(cell(p + 1, 'rocket')).toBeGreaterThan(cell(p, 'rocket'));
      expect(cell(p + 1, 'storm')).toBeGreaterThan(cell(p, 'storm'));
    }
    expect(cell(12, 'rocket')).toBeGreaterThan(cell(12, 'storm')); // Storm is the rarer of the two
    expect(cell(12, 'rocket')).toBeGreaterThan(cell(12, 'nova') * 1.2);
  });

  it('Jumble is for 4th-9th, the rare Hunter for 4th-8th(9th), neither for the front three or the last places', () => {
    expect(placesWith('jumble')[0]).toBe(4);
    expect(placesWith('jumble').at(-1)).toBeLessThanOrEqual(10);
    expect(placesWith('hunter')[0]).toBe(4);
    expect(placesWith('hunter').at(-1)).toBeLessThanOrEqual(9);
    for (let p = 1; p <= 12; p++) expect(cell(p, 'hunter')).toBeLessThanOrEqual(6); // rare
    expect(cell(12, 'hunter')).toBe(0);
    expect(cell(12, 'jumble')).toBe(0);
    for (let p = 1; p <= 3; p++) {
      expect(cell(p, 'jumble')).toBe(0);
      expect(cell(p, 'hunter')).toBe(0);
    }
  });

  it('the strong comeback items get more likely the further back you are', () => {
    const strong = (p: number) => {
      const d = distribution(p, 12);
      return d.nova + d.seeker + d.storm + d.rocket + d.dash3 + d.hunter + d.jumble;
    };
    expect(strong(1)).toBeLessThan(strong(4));
    expect(strong(4)).toBeLessThan(strong(8));
    expect(strong(8)).toBeLessThan(strong(12));
  });
});

describe('item odds in smaller fields', () => {
  it('last place always reads the last row and the leader the first, whatever the field size', () => {
    for (const racers of [2, 4, 8, 12]) {
      const last = itemWeights(racers, racers);
      const lead = itemWeights(1, racers);
      ITEM_PICKS.forEach((k, c) => {
        expect(last[k]).toBeCloseTo(ITEM_TABLE[11][c], 9);
        expect(lead[k]).toBeCloseTo(ITEM_TABLE[0][c], 9);
      });
    }
  });

  it('works for a lone racer, and 2 players: 2nd is "last"', () => {
    expect(distribution(1, 1).nova).toBeGreaterThan(0); // the middle of the table
    const a = distribution(2, 2);
    const b = distribution(4, 4);
    for (const k of ITEM_PICKS) expect(a[k]).toBeCloseTo(b[k], 1);
  });
});

describe('rolling', () => {
  it('is deterministic for a given seed and every pick can occur somewhere', () => {
    const run = () => {
      const r = seededRng(7);
      return Array.from({ length: 50 }, () => rollPick(6, 12, r));
    };
    expect(run()).toEqual(run());
    const seen = new Set<ItemPick>();
    const r = seededRng(1);
    for (let p = 1; p <= 12; p++) for (let i = 0; i < 3000; i++) seen.add(rollPick(p, 12, r));
    expect(seen.size).toBe(ITEM_PICKS.length);
  });

  it('maps picks to items; the triples have 3 charges and the Peel / Ricochet ones are packs', () => {
    expect(pickToItem('dash3')).toEqual({ id: 'dash', count: 3 });
    expect(pickToItem('slick3')).toEqual({ id: 'slick', count: 3, pack: true });
    expect(pickToItem('ricochet3')).toEqual({ id: 'ricochet', count: 3, pack: true });
    expect(pickToItem('nova')).toEqual({ id: 'nova', count: 1 });
    expect(pickToItem('hunter')).toEqual({ id: 'hunter', count: 1 });
    expect(pickToItem('decoy')).toEqual({ id: 'decoy', count: 1 });
    expect(rollItem(1, 4, () => 0).id).toBe('slick'); // first slot of the table
  });
});
