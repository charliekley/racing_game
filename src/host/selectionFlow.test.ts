import { describe, expect, it } from 'vitest';
import { PlayerSlots } from './playerSlots';
import { SelectionHub } from './selectionHub';

const phone = (id: string) => ({ kind: 'phone' as const, clientId: id });
function two() {
  const s = new PlayerSlots();
  s.join(phone('a'), 'A', 0);
  s.join(phone('b'), 'B', 1);
  return s;
}
/** Walk a player from the name step to READY. */
function lockIn(s: PlayerSlots, i: number) {
  expect(s.select(i, { stage: 'character', name: 'X' })).toBe(true);
  expect(s.select(i, { stage: 'kart' })).toBe(true);
  expect(s.select(i, { stage: 'ready' })).toBe(true);
}

describe('selection state machine', () => {
  it('new players start at the name step and are not ready', () => {
    const s = two();
    expect(s.slots[0]!.stage).toBe('name');
    expect(s.slots[0]!.ready).toBe(false);
  });

  it('goes name -> character -> kart -> ready, one step at a time', () => {
    const s = two();
    expect(s.select(0, { stage: 'kart' })).toBe(false); // can't skip
    expect(s.select(0, { stage: 'ready' })).toBe(false);
    expect(s.slots[0]!.stage).toBe('name');
    lockIn(s, 0);
    expect(s.slots[0]!.stage).toBe('ready');
    expect(s.slots[0]!.ready).toBe(true);
  });

  it('takes the name at the name step and the highlights at their own steps', () => {
    const s = two();
    s.select(0, { stage: 'name', name: '  Dana ' });
    expect(s.slots[0]!.name).toBe('Dana');
    s.select(0, { stage: 'character', character: 5 });
    expect(s.slots[0]!.loadout.character).toBe(5);
    s.select(0, { stage: 'character', character: 6 }); // browsing
    expect(s.slots[0]!.loadout.character).toBe(6);
    s.select(0, { stage: 'kart', kart: 2 });
    expect(s.slots[0]!.loadout).toEqual({ character: 6, kart: 2 });
  });

  it('ignores values that do not belong to the current step', () => {
    const s = two();
    lockIn(s, 0);
    s.select(0, { stage: 'ready', character: 0, kart: 3, name: 'Hacker' }); // locked in: nothing changes
    expect(s.slots[0]!.name).toBe('X');
    expect(s.slots[0]!.loadout.kart).not.toBe(3);
    s.select(1, { stage: 'name' });
    s.select(1, { stage: 'character', kart: 3 }); // kart while on the character step
    expect(s.slots[1]!.loadout.kart).not.toBe(3);
  });

  it('Back un-readies; picks are kept; ready again works', () => {
    const s = two();
    lockIn(s, 0);
    s.select(0, { stage: 'character', character: 1 }); // "Change"
    expect(s.slots[0]!.stage).toBe('character');
    expect(s.slots[0]!.ready).toBe(false);
    expect(s.slots[0]!.loadout.kart).toBe(0);
    s.select(0, { stage: 'kart' });
    s.select(0, { stage: 'ready' });
    expect(s.slots[0]!.ready).toBe(true);
    expect(s.slots[0]!.loadout.character).toBe(1);
  });

  it('refuses changes while a race is running, and unknown slots', () => {
    const s = two();
    s.phase = 'race';
    expect(s.select(0, { stage: 'character' })).toBe(false);
    expect(s.select(3, { stage: 'character' })).toBe(false);
  });

  it('reports false when nothing changed', () => {
    const s = two();
    expect(s.select(0, { stage: 'name' })).toBe(false);
  });

  it('a rejoining phone keeps its stage, name and picks', () => {
    const s = two();
    s.select(0, { stage: 'character', character: 4, name: 'Dana' });
    s.select(0, { stage: 'kart', kart: 1 });
    s.markDisconnected(0);
    const again = s.join(phone('a'), 'ignored', 0, { character: 0, kart: 0 });
    expect(again.ok && again.rejoined).toBe(true);
    expect(s.slots[0]).toMatchObject({ stage: 'kart', name: 'Dana', loadout: { character: 4, kart: 1 } });
  });

  it('a player who leaves frees the slot for a fresh name step', () => {
    const s = two();
    lockIn(s, 0);
    s.remove(0);
    const r = s.join(phone('c'), 'C', 0);
    expect(r.ok && r.slot.stage).toBe('name');
  });

  it('after a race everyone keeps their picks and lands on READY; the way back to the lobby keeps them locked in but NOT ready', () => {
    const s = two();
    lockIn(s, 0);
    s.phase = 'results';
    s.lockInAll(); // (done when the countdown starts)
    for (const p of s.players) p.ready = false; // results: "race again" starts un-ready
    expect(s.allReady()).toBe(false);
    s.select(0, { stage: 'character' }); // Change
    s.select(0, { stage: 'kart' });
    s.select(0, { stage: 'ready' }); // reaching READY counts as "race again"
    expect(s.slots[0]!.ready).toBe(true);
    s.resetToLobby();
    expect(s.slots.every((p) => p === null || p.ready === false)).toBe(true); // everybody readies up again
    expect(s.slots[1]!.stage).toBe('ready'); // locked in by lockInAll
  });
});

describe('start gate', () => {
  it('needs everyone ready AND the mode choice finished (P1 first)', () => {
    const s = two();
    lockIn(s, 0);
    expect(s.canStart(false)).toBe(false); // B has not finished
    lockIn(s, 1);
    expect(s.canStart(true)).toBe(false); // P1 still choosing the mode
    expect(s.canStart(false)).toBe(true);
    s.select(1, { stage: 'kart' }); // B changes their mind
    expect(s.canStart(false)).toBe(false);
  });

  it('ignores disconnected players and bots count as ready', () => {
    const s = two();
    lockIn(s, 0);
    s.markDisconnected(1);
    expect(s.canStart(false)).toBe(true);
    const bot = s.join({ kind: 'bot', id: 1 }, 'Bot 1', 4, undefined, 'ready');
    if (bot.ok) bot.slot.ready = true;
    expect(s.canStart(false)).toBe(true);
  });

  it('never starts outside the lobby', () => {
    const s = two();
    lockIn(s, 0);
    lockIn(s, 1);
    s.phase = 'results';
    expect(s.canStart(false)).toBe(false);
  });
});

describe('SelectionHub fits the slots', () => {
  it('allReady agrees with the stages', () => {
    const s = two();
    const hub = new SelectionHub();
    const publish = () => {
      for (const p of s.players) hub.set({ slot: p.index, name: p.name, stage: p.stage, character: p.loadout.character, kart: p.loadout.kart, input: 'phone', ready: p.ready, wins: 0 });
    };
    lockIn(s, 0);
    publish();
    expect(hub.allReady()).toBe(false);
    lockIn(s, 1);
    publish();
    expect(hub.allReady()).toBe(true);
  });
});
