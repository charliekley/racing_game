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
});
