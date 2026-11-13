import { describe, expect, it } from 'vitest';
import { GP_POINTS, MenuChoice, MODE_NAMES, Series, menuOwner, nextMode, pointsForPlace, type Placing } from './series';

/** Build a race result from slots listed best first. `bots` are slots that are computers. */
function race(order: number[], bots: number[] = []): Placing[] {
  return order.map((slot, i) => ({ slot, place: i + 1, human: !bots.includes(slot) }));
}
const everyone = () => true;

describe('points table', () => {
  it('is 10/7/5/3 and 0 outside the table', () => {
    expect(GP_POINTS).toEqual([10, 7, 5, 3]);
    expect(pointsForPlace(1)).toBe(10);
    expect(pointsForPlace(4)).toBe(3);
    expect(pointsForPlace(5)).toBe(0);
    expect(pointsForPlace(0)).toBe(0);
  });
});

describe('modes', () => {
  it('cycles through the three modes both ways', () => {
    expect(nextMode('single')).toBe('gp');
    expect(nextMode('gp')).toBe('loser');
    expect(nextMode('loser')).toBe('single');
    expect(nextMode('single', -1)).toBe('loser');
    expect(Object.keys(MODE_NAMES)).toHaveLength(3);
  });
});

describe('single race', () => {
  it('keeps the chosen track, has no points, and the same track again', () => {
    const s = new Series('single', 4, 2);
    expect(s.trackIndex).toBe(2);
    s.recordRace(race([0, 1]));
    expect(s.stage).toBe('between');
    expect(s.standings([0, 1]).map((r) => r.points)).toEqual([0, 0]);
    expect(s.advance()).toBe(true);
    expect(s.trackIndex).toBe(2);
  });
  it('clamps a silly first track', () => {
    expect(new Series('single', 4, 99).trackIndex).toBe(3);
    expect(new Series('single', 4, -5).trackIndex).toBe(0);
    expect(new Series('single', 4, NaN).trackIndex).toBe(0);
  });
});

describe('Grand Prix', () => {
  it('plays every track in order, awards points and ends after the last', () => {
    const s = new Series('gp', 4, 3); // the requested first track is ignored: a GP starts at track 0
    expect(s.trackIndex).toBe(0);
    expect(s.raceTotal).toBe(4);
    const seen = [s.trackIndex];
    for (let i = 0; i < 4; i++) {
      s.recordRace(race([0, 1, 2, 3], [2, 3]));
      if (s.stage === 'over') break;
      expect(s.advance()).toBe(true);
      seen.push(s.trackIndex);
    }
    expect(seen).toEqual([0, 1, 2, 3]);
    expect(s.stage).toBe('over');
    expect(s.racesDone).toBe(4);
    const st = s.standings([0, 1, 2, 3]);
    expect(st.map((r) => r.points)).toEqual([40, 28, 20, 12]);
    expect(st.map((r) => r.slot)).toEqual([0, 1, 2, 3]);
  });

  it('reports the gain of the last race', () => {
    const s = new Series('gp', 4);
    s.recordRace(race([2, 0, 1]));
    expect(s.gainOf(2)).toBe(10);
    expect(s.gainOf(0)).toBe(7);
    expect(s.gainOf(1)).toBe(5);
    expect(s.gainOf(3)).toBe(0);
  });

  it('cannot advance while racing or when over', () => {
    const s = new Series('gp', 1);
    expect(s.advance()).toBe(false);
    s.recordRace(race([0]));
    expect(s.stage).toBe('over');
    expect(s.advance()).toBe(false);
  });
});

describe('tie-breaks', () => {
  it('equal points and equal places: the last race decides', () => {
    const s = new Series('gp', 4);
    s.recordRace(race([0, 1, 2])); // 0:10 1:7 2:5
    s.advance();
    s.recordRace(race([1, 2, 0])); // 1:17 2:12 0:15
    s.advance();
    s.recordRace(race([2, 0, 1])); // 2:22 0:22 1:22
    const st = s.standings([0, 1, 2]);
    expect(st.map((r) => r.points)).toEqual([22, 22, 22]);
    // everyone has exactly one win, one 2nd and one 3rd, so the last race decides (2 won it, then 0, then 1)
    expect(st.map((r) => r.slot)).toEqual([2, 0, 1]);
  });

  it('equal points: more wins beats the last race', () => {
    const s = new Series('gp', 4);
    s.recordRace(race([0, 1, 2, 3])); // slot 0: 10, slot 1: 7
    s.advance();
    s.recordRace(race([0, 1, 2, 3])); // 20, 14
    s.advance();
    s.recordRace(race([2, 1, 3, 0])); // 0 is 4th (+3), 1 is 2nd (+7): 23, 21
    s.advance();
    s.recordRace(race([2, 3, 1, 0])); // 0 is 4th (+3), 1 is 3rd (+5): 26, 26
    const st = s.standings([0, 1]);
    expect(st.map((r) => r.points)).toEqual([26, 26]);
    // slot 0 has two wins, slot 1 none: the wins decide, even though slot 1 did better in the last race
    expect(st.map((r) => r.slot)).toEqual([0, 1]);
  });

  it('always gives unique ranks, falling back to slot order', () => {
    const fresh = new Series('gp', 4);
    expect(fresh.standings([3, 1, 2]).map((r) => r.slot)).toEqual([1, 2, 3]);
    expect(fresh.standings([3, 1]).map((r) => r.rank)).toEqual([1, 2]);
  });
});

describe('Loser picks', () => {
  it('the last-place HUMAN picks, bots never do', () => {
    const s = new Series('loser', 4, 1);
    expect(s.trackIndex).toBe(1);
    s.recordRace(race([2, 0, 1, 3], [2, 3])); // humans 0 and 1; slot 3 (a bot) was last overall
    expect(s.currentPicker(everyone)).toBe(1);
    expect(s.pick(0, 2, everyone)).toBe(false); // not their turn
    expect(s.pick(1, 4, everyone)).toBe(false); // track out of range
    expect(s.pick(1, 'x', everyone)).toBe(false);
    expect(s.stage).toBe('between');
    expect(s.pick(1, 2, everyone)).toBe(true);
    expect(s.trackIndex).toBe(2);
    expect(s.stage).toBe('racing');
  });

  it('keeps running points and lets the menu owner stop', () => {
    const s = new Series('loser', 4);
    s.recordRace(race([0, 1]));
    s.pick(1, 0, everyone);
    s.recordRace(race([1, 0]));
    expect(s.standings([0, 1]).map((r) => r.points)).toEqual([17, 17]);
    s.stop();
    expect(s.stage).toBe('over');
    expect(s.pick(0, 1, everyone)).toBe(false);
  });

  it('a single human always picks; advance() is not how loser mode continues', () => {
    const s = new Series('loser', 4);
    s.recordRace(race([0, 1, 2], [1, 2]));
    expect(s.currentPicker(everyone)).toBe(0);
    expect(s.advance()).toBe(false);
  });

  it('a picker who left is skipped: next-worst human, then the fallback order', () => {
    const s = new Series('loser', 4);
    s.recordRace(race([0, 1, 2])); // 2 is last
    expect(s.currentPicker((x) => x !== 2)).toBe(1);
    expect(s.pick(2, 0, (x) => x !== 2)).toBe(false);
    expect(s.currentPicker((x) => x === 3, [3])).toBe(3); // nobody from the race is here
    expect(s.currentPicker(() => false, [3])).toBeNull();
  });

  it('is not a pick turn in other modes or while racing', () => {
    const g = new Series('gp', 4);
    g.recordRace(race([0, 1]));
    expect(g.currentPicker(everyone)).toBeNull();
    const l = new Series('loser', 4);
    expect(l.currentPicker(everyone)).toBeNull();
  });
});

describe('a player leaving mid-series', () => {
  it('dropSlot forgets their points and they vanish from the standings', () => {
    const s = new Series('gp', 4);
    s.recordRace(race([0, 1, 2]));
    s.advance();
    s.dropSlot(0);
    s.recordRace(race([1, 2]));
    const st = s.standings([1, 2]); // slot 0 is gone
    expect(st.map((r) => [r.slot, r.points])).toEqual([
      [1, 17],
      [2, 12],
    ]);
    expect(s.gainOf(0)).toBe(0);
  });
  it('standings of only the present players ignore leavers without dropSlot', () => {
    const s = new Series('gp', 4);
    s.recordRace(race([0, 1, 2]));
    expect(s.standings([1, 2]).map((r) => r.rank)).toEqual([1, 2]);
  });
});

describe('menu owner', () => {
  const c = (slot: number, human: boolean, connected = true) => ({ slot, human, connected });
  it('is the first connected human', () => {
    expect(menuOwner([c(0, true), c(1, true)])).toBe(0);
  });
  it('passes to the next player when P1 is gone, and skips bots', () => {
    expect(menuOwner([c(0, true, false), c(1, false), c(2, true)])).toBe(2);
  });
  it('is null with no humans', () => {
    expect(menuOwner([c(0, false)])).toBeNull();
    expect(menuOwner([])).toBeNull();
  });
});

describe('menu choice (the forced pop-up)', () => {
  it('starts pending, completes once, and is pending again after a reset', () => {
    const c = new MenuChoice();
    expect(c.pending).toBe(true);
    expect(c.complete()).toBe(true); // changed
    expect(c.complete()).toBe(false); // already done
    expect(c.pending).toBe(false);
    expect(c.reset()).toBe(true);
    expect(c.pending).toBe(true);
    expect(c.reset()).toBe(false);
  });
  it('blocks the READY auto-start only while pending and somebody can answer (never a deadlock without phones)', () => {
    const c = new MenuChoice();
    expect(c.blocksAutoStart(true)).toBe(true);
    expect(c.blocksAutoStart(false)).toBe(false); // no human owner: nothing to wait for
    c.complete();
    expect(c.blocksAutoStart(true)).toBe(false);
  });
  it('belongs to the round, not the player: a new owner inherits it', () => {
    const c = new MenuChoice();
    const p = (slot: number, connected: boolean) => ({ slot, human: true, connected });
    expect(menuOwner([p(0, true), p(1, true)])).toBe(0);
    // P1 leaves mid-choice: P2 becomes owner and the choice is still pending.
    expect(menuOwner([p(0, false), p(1, true)])).toBe(1);
    expect(c.pending).toBe(true);
  });
});
