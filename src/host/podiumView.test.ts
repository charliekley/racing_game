import { describe, expect, it } from 'vitest';
import { normalizeEntries } from './podiumView';
import type { PodiumEntry } from './postRace';

const entry = (place: number, name = `P${place}`): PodiumEntry =>
  ({ slot: place, place, name, color: '#fff', loadout: { character: 0, kart: 0 }, wins: 0, points: null }) as PodiumEntry;

describe('normalizeEntries', () => {
  it('sorts by place and keeps 1 or 2 entries', () => {
    expect(normalizeEntries([entry(3), entry(1), entry(2)]).map((e) => e.place)).toEqual([1, 2, 3]);
    expect(normalizeEntries([entry(1)]).map((e) => e.place)).toEqual([1]);
    expect(normalizeEntries([entry(2), entry(1)]).map((e) => e.place)).toEqual([1, 2]);
  });

  it('ignores places outside 1..3 and repeated places (first one wins)', () => {
    const list = normalizeEntries([entry(4), entry(1, 'first'), entry(1, 'second'), entry(0)]);
    expect(list.map((e) => e.name)).toEqual(['first']);
  });

  it('copes with nothing', () => {
    expect(normalizeEntries([])).toEqual([]);
  });
});
