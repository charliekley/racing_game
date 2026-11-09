import { describe, expect, it } from 'vitest';
import { ITEM_PICKS, itemWeights, pickToItem, rollItem, rollPick, seededRng, type ItemPick } from './odds';

/** How often each pick comes out over many rolls. */
function distribution(position: number, racers: number, n = 20000): Record<ItemPick, number> {
  const rnd = seededRng(42);
  const counts = Object.fromEntries(ITEM_PICKS.map((k) => [k, 0])) as Record<ItemPick, number>;
  for (let i = 0; i < n; i++) counts[rollPick(position, racers, rnd)]++;
  for (const k of ITEM_PICKS) counts[k] /= n;
  return counts;
}

describe('item odds', () => {
  it('weights are positive and interpolate from leader to last', () => {
    const lead = itemWeights(1, 4);
    const last = itemWeights(4, 4);
    const mid = itemWeights(2.5, 4);
    for (const k of ITEM_PICKS) {
      expect(lead[k]).toBeGreaterThan(0);
      expect(mid[k]).toBeCloseTo((lead[k] + last[k]) / 2);
    }
  });

  it('leaders mostly get defensive items; trailing players get the strong ones', () => {
    const lead = distribution(1, 4);
    const last = distribution(4, 4);
    expect(lead.slick + lead.ricochet).toBeGreaterThan(0.6);
    expect(last.slick + last.ricochet).toBeLessThan(0.2);
    expect(last.nova).toBeGreaterThan(lead.nova * 10);
    expect(last.seeker).toBeGreaterThan(lead.seeker * 3);
    expect(last.dash3).toBeGreaterThan(lead.dash3 * 5);
  });

  it('works for any field size and a lone racer', () => {
    expect(distribution(1, 1).nova).toBeGreaterThan(0);
    const a = distribution(2, 2); // 2 players: 2nd place is "last"
    const b = distribution(4, 4);
    for (const k of ITEM_PICKS) expect(a[k]).toBeCloseTo(b[k], 1);
  });

  it('is deterministic for a given seed and every item can occur', () => {
    const run = () => {
      const r = seededRng(7);
      return Array.from({ length: 50 }, () => rollPick(3, 4, r));
    };
    expect(run()).toEqual(run());
    const seen = new Set<ItemPick>();
    const r = seededRng(1);
    for (let i = 0; i < 5000; i++) seen.add(rollPick(2, 4, r));
    expect(seen.size).toBe(ITEM_PICKS.length);
  });

  it('maps picks to items; the pack has 3 charges', () => {
    expect(pickToItem('dash3')).toEqual({ id: 'dash', count: 3 });
    expect(pickToItem('nova')).toEqual({ id: 'nova', count: 1 });
    expect(rollItem(1, 4, () => 0).id).toBe('dash'); // first slot of the table
  });
});
