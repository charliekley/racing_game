import { describe, expect, it } from 'vitest';
import { ALL_KART_HEX, KART_COLORS, botColorsFor } from '../shared/colors';
import { itemWeights } from '../sim/items/odds';
import { MAX_PLAYERS } from './playerSlots';
import { CHARACTERS } from '../shared/characters';
import { FILL_BOT_BASE, attackToast, buildBotRoster, DEFAULT_RACERS, fillBotSlots, isFillBot, nextRacers, sanitizeRacers } from './raceSettings';
import { Series, pointsForPlace } from './series';

describe('RACERS setting', () => {
  it('defaults to 4, cycles 4 -> 8 -> 12 -> 4 and sanitises stored values', () => {
    expect(DEFAULT_RACERS).toBe(4);
    expect(nextRacers(4)).toBe(8);
    expect(nextRacers(8)).toBe(12);
    expect(nextRacers(12)).toBe(4);
    expect(sanitizeRacers('8')).toBe(8);
    expect(sanitizeRacers(12)).toBe(12);
    for (const bad of ['7', 'x', null, undefined, 0, 99]) expect(sanitizeRacers(bad)).toBe(4);
  });

  it('fill-in bots use slots 4 and up, right after the four people slots', () => {
    expect(FILL_BOT_BASE).toBe(MAX_PLAYERS);
    expect(isFillBot(3)).toBe(false);
    expect(isFillBot(4)).toBe(true);
  });

  it('one player races 3 bots by default', () => {
    expect(fillBotSlots(1, DEFAULT_RACERS)).toEqual([4, 5, 6]);
  });

  it('fills everyone other than the people with bots, up to 12 karts', () => {
    expect(2 + fillBotSlots(2, 12).length).toBe(12); // 2 people + 10 bots
    expect(fillBotSlots(2, 12)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]); // (slot numbers are only ids)
    expect(1 + fillBotSlots(1, 8).length).toBe(8);
    expect(4 + fillBotSlots(4, 4).length).toBe(4); // a full house of people needs no bots
    expect(fillBotSlots(4, 8)).toEqual([4, 5, 6, 7]);
    expect(4 + fillBotSlots(4, 12).length).toBe(12);
    expect(fillBotSlots(6, 4)).toEqual([]); // never fewer than the entrants
  });
});

describe('colours for 12 karts', () => {
  it('has 12 different colours', () => {
    expect(new Set(ALL_KART_HEX.map((h) => h.toLowerCase())).size).toBe(12);
  });

  it('every fill-in bot has its own colour, none of them used by a person (4 people + 8 bots)', () => {
    const people = [KART_COLORS[0].hex, KART_COLORS[1].hex, KART_COLORS[2].hex, KART_COLORS[3].hex];
    const bots = fillBotSlots(4, 12);
    const colors = botColorsFor(people, bots);
    expect(colors.size).toBe(bots.length);
    const all = [...people, ...colors.values()].map((h) => h.toLowerCase());
    expect(new Set(all).size).toBe(all.length);
  });

  it('is the same every time (the phones compute the very same colours)', () => {
    const people = [KART_COLORS[5].hex];
    expect([...botColorsFor(people, [4, 5, 6])]).toEqual([...botColorsFor(people, [6, 5, 4])]);
  });
});

describe('toasts only for people', () => {
  it('HIT toasts name the victim only when the victim is a person', () => {
    expect(attackToast('ANNA', true)).toBe('HIT ANNA!');
    expect(attackToast('BOT 1', false)).toBeNull();
  });
});

describe('Grand Prix points for up to 12 places', () => {
  it('pays 10, 6, 3, 0 for a field of 4', () => {
    expect([1, 2, 3, 4].map((p) => pointsForPlace(p, 4))).toEqual([10, 6, 3, 0]);
    expect(pointsForPlace(5, 4)).toBe(0);
  });

  it('pays 12 places in a field of 12: highest first, down to 0 for last', () => {
    const table = Array.from({ length: 12 }, (_, i) => pointsForPlace(i + 1, 12));
    expect(table).toEqual([12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    for (let i = 1; i < table.length; i++) expect(table[i]).toBeLessThan(table[i - 1]);
    expect(pointsForPlace(13, 12)).toBe(0);
    expect(Array.from({ length: 8 }, (_, i) => pointsForPlace(i + 1, 8))).toEqual([10, 8, 6, 5, 4, 2, 1, 0]);
  });

  it('a series of 12 racers awards them by the size of the field', () => {
    const series = new Series('gp', 4);
    series.recordRace(Array.from({ length: 12 }, (_, i) => ({ slot: i, place: i + 1, human: i < 2 })));
    expect(series.gainOf(0)).toBe(12);
    expect(series.gainOf(11)).toBe(0);
    expect(series.standings([0, 1, 11]).map((r) => r.points)).toEqual([12, 10, 0]);
  });
});

describe('item odds in a bigger field', () => {
  it('depend on the fraction of the field you are behind, not on the absolute rank', () => {
    // last of 12 gets what last of 4 gets; the middle of the field gets the middle of the table
    expect(itemWeights(12, 12)).toEqual(itemWeights(4, 4));
    expect(itemWeights(1, 12)).toEqual(itemWeights(1, 4));
    const mid12 = itemWeights(6.5, 12);
    const mid4 = itemWeights(2.5, 4);
    for (const k of Object.keys(mid12) as (keyof typeof mid12)[]) expect(mid12[k]).toBeCloseTo(mid4[k], 9);
    // 4th of 12 is still in the front part (no Nova yet), 10th of 12 is far back (lots of it)
    expect(itemWeights(4, 12).nova).toBeLessThan(itemWeights(10, 12).nova);
    // Jumble stays out of the front quarter of any field (it starts at 4th of 12)
    expect(itemWeights(3, 12).jumble).toBe(0);
    expect(itemWeights(4, 12).jumble).toBeGreaterThan(0);
  });
});

describe('bot names (characters)', () => {
  const names = (slots: number[], humans: number[]) => [...buildBotRoster(slots, humans).values()].map((b) => b.name);
  it('bots carry character names and prefer characters nobody picked', () => {
    const roster = buildBotRoster(fillBotSlots(1, 4), [3]); // one human (Juno) + 3 bots
    expect(roster.size).toBe(3);
    for (const b of roster.values()) {
      expect(b.name).toBe(CHARACTERS[b.loadout.character].name);
      expect(b.loadout.character).not.toBe(3);
      expect(b.name).not.toMatch(/CPU/);
    }
  });
  it('four people and 4 racers need no bots; names are unique while characters last', () => {
    expect(buildBotRoster(fillBotSlots(4, 4), [0, 1, 2, 3]).size).toBe(0);
    const n = names(fillBotSlots(1, 8), [3]); // 7 bots, 7 free characters
    expect(new Set(n).size).toBe(7);
  });
  it('with 11 bots (12 racers, 1 person) every name is still unique: repeats get a number', () => {
    const n = names(fillBotSlots(1, 12), [3]);
    expect(n).toHaveLength(11);
    expect(new Set(n).size).toBe(11);
    // 12 characters for 12 racers: the 11 bots all get a different character, so no name needs a number.
    expect(n.filter((x) => /\d$/.test(x))).toHaveLength(0);
  });
  it('is deterministic and keeps the usual kart bodies', () => {
    expect(names(fillBotSlots(2, 12), [0, 5])).toEqual(names(fillBotSlots(2, 12), [0, 5]));
    expect(buildBotRoster([4], []).get(4)!.loadout.kart).toBeGreaterThanOrEqual(0);
  });
});
