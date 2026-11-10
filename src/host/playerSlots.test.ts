import { describe, expect, it } from 'vitest';
import { PlayerSlots } from './playerSlots';

const phone = (id: string) => ({ kind: 'phone' as const, clientId: id });

describe('PlayerSlots', () => {
  it('fills up to 4 slots then rejects', () => {
    const s = new PlayerSlots();
    for (let i = 0; i < 4; i++) expect(s.join(phone(`p${i}`), `P${i}`, 0).ok).toBe(true);
    expect(s.join(phone('p5'), 'P5', 0)).toEqual({ ok: false, reason: 'full' });
  });

  it('gives a reconnecting phone its old slot, even mid-race', () => {
    const s = new PlayerSlots();
    s.join(phone('a'), 'A', 0);
    const b = s.join(phone('b'), 'B', 1);
    if (!b.ok) throw new Error();
    s.markDisconnected(b.slot.index);
    s.phase = 'race';
    const again = s.join(phone('b'), 'B', 1);
    expect(again.ok && again.rejoined && again.slot.index).toBe(1);
    expect(s.slots[1]!.connected).toBe(true);
    // Strangers can't join mid-race.
    expect(s.join(phone('c'), 'C', 2)).toEqual({ ok: false, reason: 'in-progress' });
  });

  it('keeps colors unique', () => {
    const s = new PlayerSlots();
    s.join(phone('a'), 'A', 3);
    const b = s.join(phone('b'), 'B', 3);
    expect(b.ok && b.slot.color).not.toBe(3);
    // Changing your own profile to your current color is fine.
    s.setProfile(0, 'A2', 3);
    expect(s.slots[0]!.color).toBe(3);
  });

  it('allReady ignores disconnected players and needs at least one player', () => {
    const s = new PlayerSlots();
    expect(s.allReady()).toBe(false);
    s.join(phone('a'), 'A', 0);
    s.join(phone('b'), 'B', 1);
    s.setReady(0, true);
    expect(s.allReady()).toBe(false);
    s.markDisconnected(1);
    expect(s.allReady()).toBe(true);
  });

  it('resetToLobby clears ready and frees slots of players who left', () => {
    const s = new PlayerSlots();
    s.join(phone('a'), 'A', 0);
    s.join(phone('b'), 'B', 1);
    s.setReady(0, true);
    s.markDisconnected(1);
    s.resetToLobby();
    expect(s.slots[0]!.ready).toBe(false);
    expect(s.slots[1]).toBeNull();
  });

  describe('loadouts', () => {
    it('start as the default and are sanitized when given', () => {
      const s = new PlayerSlots();
      const a = s.join(phone('a'), 'A', 0);
      const b = s.join(phone('b'), 'B', 1, { character: 6, kart: 2 });
      const c = s.join(phone('c'), 'C', 2, { character: 99, kart: -1 }); // garbage from the network
      expect(a.ok && a.slot.loadout).toEqual({ character: 3, kart: 0 });
      expect(b.ok && b.slot.loadout).toEqual({ character: 6, kart: 2 });
      expect(c.ok && c.slot.loadout).toEqual({ character: 3, kart: 0 });
    });

    it('survive a reconnect and are shown in the lobby info', () => {
      const s = new PlayerSlots();
      const a = s.join(phone('a'), 'A', 0, { character: 1, kart: 3 });
      if (!a.ok) throw new Error();
      s.markDisconnected(a.slot.index);
      const again = s.join(phone('a'), 'A', 0); // reconnect without a loadout in the hello
      expect(again.ok && again.slot.loadout).toEqual({ character: 1, kart: 3 });
      expect(s.lobbyInfo()[0].loadout).toEqual({ character: 1, kart: 3 });
    });

    it('can change between races but not during one', () => {
      const s = new PlayerSlots();
      const a = s.join(phone('a'), 'A', 0);
      if (!a.ok) throw new Error();
      s.setProfile(a.slot.index, 'A', 0, { character: 5, kart: 1 });
      expect(s.slots[0]!.loadout).toEqual({ character: 5, kart: 1 });
      s.phase = 'race';
      s.setProfile(a.slot.index, 'A', 0, { character: 0, kart: 0 });
      expect(s.setLoadout(0, { character: 0, kart: 0 })).toBe(false);
      expect(s.slots[0]!.loadout).toEqual({ character: 5, kart: 1 });
      s.phase = 'results';
      expect(s.setLoadout(0, { character: 2, kart: 2 })).toBe(true);
    });
  });
});
