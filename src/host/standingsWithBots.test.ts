import { describe, expect, it } from 'vitest';
import { Series, type Placing } from './series';
import { parseSeriesInfo } from '../shared/protocol';
import { fillBotSlots } from './raceSettings';

/** Placings of a race with 2 people (slots 0, 1) and the fill-in bots for RACERS 8, in the given finishing order. */
function race(order: number[]): Placing[] {
  return order.map((slot, i) => ({ slot, place: i + 1, human: slot < 4 }));
}

describe('standings include the fill-in bots', () => {
  const bots = fillBotSlots(2, 8); // slots 4..9
  const everyone = [0, 1, ...bots];

  it('every racer scores, bots too, and the ranking covers all of them', () => {
    const s = new Series('gp', 4, 0);
    s.recordRace(race([4, 0, 5, 1, 6, 7, 8, 9]));
    const rows = s.standings(everyone);
    expect(rows).toHaveLength(8);
    expect(rows[0].slot).toBe(4); // a bot won
    expect(rows[0].points).toBeGreaterThan(rows[1].points);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('fits the wire format phones check (8 racers = 16 numbers, 12 racers = 24)', () => {
    const s = new Series('gp', 4, 0);
    const twelve = fillBotSlots(4, 12);
    s.recordRace(race([0, 1, 2, 3, ...twelve]));
    const flat = s.standings([0, 1, 2, 3, ...twelve]).flatMap((r) => [r.slot, r.points]);
    expect(flat).toHaveLength(24);
    const info = parseSeriesInfo({ mode: 'gp', track: 0, stage: 'between', owner: 0, picker: null, racesDone: 1, raceTotal: 4, standings: flat }, 4);
    expect(info?.standings).toEqual(flat);
  });
});
