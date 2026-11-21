import { describe, expect, it } from 'vitest';
import { WinTally } from '../shared/wins';
import { fillBotLabel } from '../shared/protocol';
import { winKey } from './postRace';
import { fillBotName } from './raceSettings';

describe('win keys for the room tally', () => {
  it('stay the same for the same phone and differ between players, bots and fill-in bots', () => {
    const t = new WinTally();
    t.record(winKey(0, { kind: 'phone', clientId: 'abc' }));
    t.record(winKey(0, { kind: 'phone', clientId: 'abc' }));
    t.record(winKey(5)); // a fill-in bot (no owner)
    expect(t.get(winKey(0, { kind: 'phone', clientId: 'abc' }))).toBe(2);
    expect(t.get(winKey(0, { kind: 'phone', clientId: 'other' }))).toBe(0); // a new player in the same slot starts at zero
    expect(t.get(winKey(5))).toBe(1);
    expect(t.get(winKey(6))).toBe(0);
    expect(t.get(winKey(1, { kind: 'bot', id: 1 }))).toBe(0);
  });
  it('a new room starts from zero', () => {
    const t = new WinTally();
    t.record(winKey(4));
    t.clear();
    expect(t.get(winKey(4))).toBe(0);
  });
  it('the phone and the host call fill-in bots by the same name', () => {
    for (const slot of [4, 5, 11, 13]) expect(fillBotLabel(slot)).toBe(fillBotName(slot));
  });
});
