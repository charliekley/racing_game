/**
 * Tests for the Hunter (flies to the leader and explodes), the Decoy (a fake item box that spins you out), the
 * triple packs (Ricochet x3 shields, Peel x3 trails and drops one at a time) and the "use backward" gesture (BACK).
 */
import { describe, expect, it } from 'vitest';
import { Buttons, type ControlInput } from '../../shared/protocol';
import { meadowRing } from '../../track/tracks/_meadowRing';
import { ITEMS, SIM_DT } from '../config';
import { createKart, type KartState } from '../kart';
import { Track } from '../track';
import { ItemSystem, type ItemEvent } from './items';
import { seededRng } from './odds';
import { ITEM_IDS, ITEM_INFO, type HeldItem } from './types';

const track = new Track(meadowRing);
const NONE: ControlInput = { steer: 0, buttons: 0 };
const ITEM_DOWN: ControlInput = { steer: 0, buttons: Buttons.ITEM };
const ITEM_BACK: ControlInput = { steer: 0, buttons: Buttons.ITEM | Buttons.BACK };

function kartAt(s: number, lateral = 0): KartState {
  const p = track.pointAt(s, lateral);
  const k = createKart(p.x, p.z, p.heading, p.y);
  k.trackIndex = p.index;
  return k;
}

/** `karts[i]` is slot i, and slot 0 is the leader (standings are 0, 1, 2 ...). */
function setup(karts: KartState[]) {
  const slots = karts.map((_, i) => i);
  const items = new ItemSystem(track, seededRng(5), slots);
  const map = new Map(karts.map((k, i) => [i, k] as const));
  const inputs = new Map<number, ControlInput>(slots.map((i) => [i, NONE]));
  const events: ItemEvent[] = [];
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) events.push(...items.tick(map, inputs, slots, new Set()));
  };
  const give = (slot: number, item: HeldItem) => {
    items.states.get(slot)!.held = { ...item };
  };
  const press = (slot: number, input: ControlInput = ITEM_DOWN, seconds = 0.05) => {
    inputs.set(slot, input);
    tick(Math.max(1, Math.round(seconds / SIM_DT)));
    inputs.set(slot, NONE);
    tick(1);
  };
  return { items, karts: map, inputs, events, tick, give, press };
}
type Sim = ReturnType<typeof setup>;

describe('Hunter and Decoy ids', () => {
  it('are appended at the end of the id list with names of their own', () => {
    expect(ITEM_IDS.slice(0, 8)).toEqual(['dash', 'slick', 'ricochet', 'seeker', 'nova', 'jumble', 'storm', 'rocket']);
    expect(ITEM_IDS.slice(8)).toEqual(['hunter', 'decoy']);
    expect(ITEM_INFO.hunter.name).toBe('Hunter');
    expect(ITEM_INFO.decoy.name).toBe('Decoy');
  });
});

describe('Decoy', () => {
  it('drops behind the kart and spins out whoever drives over it (not its owner at first)', () => {
    const sim = setup([kartAt(300), kartAt(200)]);
    sim.give(0, { id: 'decoy', count: 1 });
    sim.press(0);
    const decoy = sim.items.entityList.find((e) => e.kind === 'decoy');
    expect(decoy).toBeDefined();
    expect(sim.items.states.get(0)!.held).toBeNull();
    sim.tick(5);
    expect(sim.karts.get(0)!.spinTime).toBe(0); // the owner is safe right after dropping it
    const k1 = sim.karts.get(1)!;
    k1.pos.x = decoy!.x;
    k1.pos.z = decoy!.z;
    k1.pos.y = decoy!.y;
    sim.tick(2);
    expect(k1.spinTime).toBeGreaterThan(0);
    expect(sim.events.some((e) => e.kind === 'hit' && e.slot === 1 && e.by === 'decoy')).toBe(true);
    expect(sim.items.entityList.some((e) => e.kind === 'decoy')).toBe(false); // used up
  });

  it('can be dragged behind (holding ITEM) and dropped on release', () => {
    const sim = setup([kartAt(300), kartAt(250)]);
    sim.give(0, { id: 'decoy', count: 1 });
    sim.inputs.set(0, ITEM_DOWN);
    sim.tick(Math.ceil((ITEMS.tapSeconds + 0.1) / SIM_DT));
    expect(sim.items.entityList.filter((e) => e.kind === 'decoy' && e.trailing).length).toBe(1);
    sim.inputs.set(0, NONE);
    sim.tick(2);
    expect(sim.items.entityList.filter((e) => e.kind === 'decoy' && !e.trailing).length).toBe(1);
  });
});

describe('triple packs', () => {
  /** Slot 1 drops a peel and it is moved under slot 0's kart. */
  function peelUnder(sim: Sim, victim: KartState): void {
    sim.give(1, { id: 'slick', count: 1 });
    sim.press(1);
    const peel = sim.items.entityList.find((x) => x.kind === 'slick' && !x.trailing)! as { x: number; y: number; z: number; grace?: number };
    Object.assign(peel, { x: victim.pos.x, z: victim.pos.z, y: victim.pos.y, grace: 0 });
    sim.tick(2);
  }

  it('Ricochet x3 orbits as a shield: each hit uses up one ricochet, the fourth spins you out', () => {
    const sim = setup([kartAt(300), kartAt(200)]);
    sim.give(0, { id: 'ricochet', count: 3, pack: true });
    expect(sim.items.packOf(0)).toEqual({ id: 'ricochet', count: 3 });
    const victim = sim.karts.get(0)!;
    for (let i = 0; i < 3; i++) {
      peelUnder(sim, victim);
      expect(victim.spinTime).toBe(0);
      expect(sim.items.states.get(0)!.held?.count ?? 0).toBe(2 - i);
    }
    expect(sim.events.filter((e) => e.kind === 'blocked' && e.shield).length).toBe(3);
    expect(sim.items.packOf(0)).toBeNull();
    peelUnder(sim, victim);
    expect(victim.spinTime).toBeGreaterThan(0);
  });

  it('fires the Ricochet x3 one at a time', () => {
    const sim = setup([kartAt(300), kartAt(200)]);
    sim.give(0, { id: 'ricochet', count: 3, pack: true });
    sim.press(0);
    expect(sim.items.states.get(0)!.held?.count).toBe(2);
    expect(sim.items.packOf(0)).toEqual({ id: 'ricochet', count: 2 });
    expect(sim.items.entityList.filter((e) => e.kind === 'ricochet').length).toBe(1);
  });

  it('Peel x3: a tap drops one; holding drags the rest in a line, releasing drops the nearest', () => {
    const sim = setup([kartAt(300), kartAt(200)]);
    sim.give(0, { id: 'slick', count: 3, pack: true });
    sim.press(0);
    expect(sim.items.states.get(0)!.held?.count).toBe(2);
    expect(sim.items.entityList.filter((e) => e.kind === 'slick' && !e.trailing).length).toBe(1);
    // Hold: both remaining peels trail behind, one further back than the other.
    sim.inputs.set(0, ITEM_DOWN);
    sim.tick(Math.ceil((ITEMS.tapSeconds + 0.1) / SIM_DT));
    const trailing = sim.items.entityList.filter((e) => e.kind === 'slick' && e.trailing);
    expect(trailing.length).toBe(2);
    expect(new Set(trailing.map((e) => e.trailIndex)).size).toBe(2);
    // Release: the nearest drops, the other keeps trailing (and moves up).
    sim.inputs.set(0, NONE);
    sim.tick(2);
    const left = sim.items.entityList.filter((e) => e.kind === 'slick' && e.trailing);
    expect(left.length).toBe(1);
    expect(left[0].trailIndex).toBe(0);
    expect(sim.items.states.get(0)!.held?.count).toBe(1);
  });
});

describe('use backward (swipe down = BACK, or BRAKE)', () => {
  const headingOfShot = (sim: Sim) => sim.items.entityList.find((e) => e.kind === 'ricochet')!.heading;
  it('BACK held with ITEM fires a Ricochet backward; a plain tap fires it forward', () => {
    const fwd = setup([kartAt(300), kartAt(200)]);
    fwd.give(0, { id: 'ricochet', count: 1 });
    fwd.press(0);
    const back = setup([kartAt(300), kartAt(200)]);
    back.give(0, { id: 'ricochet', count: 1 });
    back.press(0, ITEM_BACK);
    const k = back.karts.get(0)!;
    expect(Math.cos(headingOfShot(fwd) - k.heading)).toBeGreaterThan(0.99);
    expect(Math.cos(headingOfShot(back) - k.heading)).toBeLessThan(-0.99);
  });
  it('BACK also works for a Ricochet x3, and BRAKE at the moment of release still works', () => {
    const pack = setup([kartAt(300), kartAt(200)]);
    pack.give(0, { id: 'ricochet', count: 3, pack: true });
    pack.press(0, ITEM_BACK);
    expect(Math.cos(headingOfShot(pack) - pack.karts.get(0)!.heading)).toBeLessThan(-0.99);
    const sim = setup([kartAt(300), kartAt(200)]);
    sim.give(0, { id: 'ricochet', count: 1 });
    sim.inputs.set(0, ITEM_DOWN);
    sim.tick(2);
    sim.inputs.set(0, { steer: 0, buttons: Buttons.BRAKE });
    sim.tick(1);
    expect(Math.cos(headingOfShot(sim) - sim.karts.get(0)!.heading)).toBeLessThan(-0.99);
  });
});

describe('Hunter', () => {
  /** Racers at s = 600 (leader, slot 0), 400 and 380 (slots 1, 2, in the middle), and 100 (slot 3, the hunter's owner). */
  function race(): Sim {
    const sim = setup([kartAt(600), kartAt(400, 3), kartAt(380, -3), kartAt(100)]);
    for (const k of sim.karts.values()) k.speed = 0;
    return sim;
  }
  const flyUntilBlast = (sim: Sim) => {
    for (let i = 0; i < 60 * 25 && !sim.events.some((e) => e.kind === 'blast'); i++) sim.tick(1);
  };

  it('flies past the others to the leader and explodes: leader hit hardest, owner untouched', () => {
    const sim = race();
    sim.give(3, { id: 'hunter', count: 1 });
    sim.press(3);
    expect(sim.items.entityList.some((e) => e.kind === 'hunter')).toBe(true);
    flyUntilBlast(sim);
    const blast = sim.events.find((e) => e.kind === 'blast');
    expect(blast && blast.kind === 'blast' && blast.target).toBe(0);
    const leader = sim.karts.get(0)!;
    expect(leader.spinTime).toBeGreaterThan(1.3); // longer than a normal spin-out
    expect(leader.vel.y).toBeGreaterThan(5); // thrown into the air
    // It did not stop at the racers it passed, and the owner is safe.
    expect(sim.karts.get(1)!.spinTime).toBe(0);
    expect(sim.karts.get(2)!.spinTime).toBe(0);
    expect(sim.karts.get(3)!.spinTime).toBe(0);
    expect(sim.items.entityList.some((e) => e.kind === 'hunter')).toBe(false);
  });

  it('spins out every kart inside the blast radius, but not those outside it', () => {
    const sim = race();
    const near = kartAt(600, 5);
    sim.karts.set(4, near);
    sim.items.states.set(4, { ...sim.items.states.get(0)! });
    const far = kartAt(600, ITEMS.hunterBlastRadius + 6);
    sim.karts.set(5, far);
    sim.items.states.set(5, { ...sim.items.states.get(0)! });
    sim.give(3, { id: 'hunter', count: 1 });
    sim.press(3);
    flyUntilBlast(sim);
    expect(near.spinTime).toBeGreaterThan(0);
    expect(far.spinTime).toBe(0);
  });

  it('a Nova kart (or a Rocket) is immune', () => {
    const sim = race();
    sim.karts.get(0)!.starTime = 5;
    sim.give(3, { id: 'hunter', count: 1 });
    sim.press(3);
    flyUntilBlast(sim);
    expect(sim.karts.get(0)!.spinTime).toBe(0);
    expect(sim.events.some((e) => e.kind === 'blocked' && e.slot === 0 && e.by === 'hunter')).toBe(true);
  });
});
