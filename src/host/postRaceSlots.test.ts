import { describe, expect, it } from 'vitest';
import { PlayerSlots } from './playerSlots';

const phone = (id: string) => ({ kind: 'phone' as const, clientId: id });

describe('after a race (results screen)', () => {
  /** Two phones and a lobby bot, all locked in, as they are when a race ends. */
  function afterRace() {
    const s = new PlayerSlots();
    s.join(phone('a'), 'A', 0);
    s.join(phone('b'), 'B', 1);
    s.join({ kind: 'bot', id: 1 }, 'Bot 1', 2);
    s.lockInAll();
    s.phase = 'race';
    return s;
  }

  it('everybody stays locked in at ready, but only the bot counts as ready for the next race (nobody is auto-readied)', () => {
    const s = afterRace();
    s.beginResults(false);
    expect(s.phase).toBe('results');
    expect(s.players.map((p) => p.stage)).toEqual(['ready', 'ready', 'ready']);
    expect(s.players.map((p) => p.ready)).toEqual([false, false, true]);
    expect(s.allReady()).toBe(false);
  });

  it('READY toggles for locked-in players; the race may start once every connected human is ready', () => {
    const s = afterRace();
    s.beginResults(false);
    expect(s.setPostReady(0, true)).toBe(true);
    expect(s.allReady()).toBe(false);
    expect(s.setPostReady(1, true)).toBe(true);
    expect(s.allReady()).toBe(true);
    expect(s.setPostReady(1, false)).toBe(true); // changed their mind
    expect(s.allReady()).toBe(false);
  });

  it('a disconnected player does not block', () => {
    const s = afterRace();
    s.beginResults(false);
    s.setPostReady(0, true);
    s.markDisconnected(1);
    expect(s.allReady()).toBe(true);
  });

  it("CHANGE goes back to the driver step, is not ready while choosing, and is ready again after LET'S GO", () => {
    const s = afterRace();
    s.beginResults(false);
    s.setPostReady(0, true);
    expect(s.select(0, { stage: 'character' })).toBe(true); // CHANGE
    expect(s.slots[0]!.ready).toBe(false);
    expect(s.select(0, { stage: 'kart', character: 5 })).toBe(true);
    expect(s.select(0, { stage: 'ready', kart: 2 })).toBe(true);
    expect(s.slots[0]!.loadout).toEqual({ character: 5, kart: 2 });
    expect(s.slots[0]!.ready).toBe(true);
  });

  it('someone who is mid-change cannot press READY (they are not at the ready step)', () => {
    const s = afterRace();
    s.beginResults(false);
    s.select(0, { stage: 'character' });
    expect(s.setPostReady(0, true)).toBe(false);
    expect(s.slots[0]!.ready).toBe(false);
  });

  it('look-only results (Grand Prix, podium) refuse CHANGE and READY', () => {
    const s = afterRace();
    s.beginResults(true);
    expect(s.canChangeLoadout()).toBe(false);
    expect(s.select(0, { stage: 'character' })).toBe(false);
    expect(s.setPostReady(0, true)).toBe(false);
    expect(s.slots[0]!.stage).toBe('ready');
  });

  it('the lock ends when the lobby is back', () => {
    const s = afterRace();
    s.beginResults(true);
    s.resetToLobby();
    expect(s.postLock).toBe(false);
    expect(s.canChangeLoadout()).toBe(true);
  });

  it("lobbyInfo carries each racer's crowns", () => {
    const s = afterRace();
    expect(s.lobbyInfo()[0].wins).toBe(0);
    expect(s.lobbyInfo((p) => p.index * 2).map((i) => i.wins)).toEqual([0, 2, 4]);
  });
});
