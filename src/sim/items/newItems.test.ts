/**
 * Tests for the items added after the first five: Magnet and Bumper, plus the Jumble rebalance
 * (reach) and the Peel (internal id `slick`) resting on the ground.
 */
import { describe, expect, it } from 'vitest';
import { Buttons, type ControlInput } from '../../shared/protocol';
import { TRACKS } from '../../track';
import { meadowRing } from '../../track/tracks/_meadowRing';
import { ITEMS, SIM_DT } from '../config';
import { createKart, type KartState } from '../kart';
import { Track } from '../track';
import { ItemSystem, type ItemEvent } from './items';
import { groundPose } from './groundPose';
import { seededRng } from './odds';
import { ITEM_IDS, ITEM_INFO, type HeldItem } from './types';

const track = new Track(meadowRing);
const NONE: ControlInput = { steer: 0, buttons: 0 };
const ITEM_DOWN: ControlInput = { steer: 0, buttons: Buttons.ITEM };

function kartOn(t: Track, s: number, lateral = 0): KartState {
  const p = t.pointAt(s, lateral);
  const k = createKart(p.x, p.z, p.heading, p.y);
  k.trackIndex = p.index;
  return k;
}
const kartAt = (s: number, lateral = 0) => kartOn(track, s, lateral);

function setup(karts: KartState[], t: Track = track) {
  const slots = karts.map((_, i) => i);
  const items = new ItemSystem(t, seededRng(5), slots);
  const map = new Map(karts.map((k, i) => [i, k] as const));
  const inputs = new Map<number, ControlInput>(slots.map((i) => [i, NONE]));
  const events: ItemEvent[] = [];
  const tick = (n = 1, standings = slots) => {
    for (let i = 0; i < n; i++) events.push(...items.tick(map, inputs, standings, new Set()));
  };
  const give = (slot: number, item: HeldItem) => {
    items.states.get(slot)!.held = { ...item };
  };
  const press = (slot: number, seconds = 0.05) => {
    inputs.set(slot, ITEM_DOWN);
    tick(Math.max(1, Math.round(seconds / SIM_DT)));
    inputs.set(slot, NONE);
    tick(1);
  };
  return { items, karts: map, inputs, events, tick, give, press };
}

describe('new item ids', () => {
  it('are appended at the end (indices go over the network) and have player-facing names', () => {
    expect(ITEM_IDS.slice(0, 6)).toEqual(['dash', 'slick', 'ricochet', 'seeker', 'nova', 'jumble']);
    expect(ITEM_IDS.slice(6)).toEqual(['magnet', 'bumper']);
    expect(ITEM_INFO.slick.name).toBe('Peel'); // the id stays `slick`, players see "Peel"
    expect(ITEM_INFO.magnet.name).toBe('Magnet');
    expect(ITEM_INFO.bumper.name).toBe('Bumper');
  });
});

describe('jumble reach', () => {
  it('hits only the nearest two racers ahead, not the whole field', () => {
    const sim = setup([kartAt(400), kartAt(300), kartAt(200), kartAt(100)]);
    sim.give(3, { id: 'jumble', count: 1 }); // last place
    sim.press(3);
    expect(ITEMS.jumbleReach).toBe(2);
    expect(sim.karts.get(2)!.invertTime).toBeGreaterThan(0);
    expect(sim.karts.get(1)!.invertTime).toBeGreaterThan(0);
    expect(sim.karts.get(0)!.invertTime).toBe(0); // the leader is out of reach
    expect(sim.events.filter((e) => e.kind === 'jumbled').length).toBe(2);
  });

  it('is shorter than before (it used to last 7 s)', () => {
    expect(ITEMS.jumbleTime).toBeLessThan(6);
  });
});

describe('peel (slick) lies on the ground', () => {
  it('dropped on banked / hilly road it sits on the ground height and is tilted with the slope', () => {
    // Find the most banked piece of road over all tracks and drop a peel there through the real item system.
    let best: { t: Track; s: number; roll: number } | null = null;
    for (const def of TRACKS) {
      const t = new Track(def);
      for (let s = 20; s < t.length - 20; s += 6) {
        if (t.inGap(s) || t.inGap(s - 5) || t.inGap(s + 5)) continue;
        const p = t.pointAt(s, def.width / 2 - 2);
        const pose = groundPose(t, p.x, p.z, p.heading, p.index, p.y);
        if (!best || Math.abs(pose.roll) > Math.abs(best.roll)) best = { t, s, roll: pose.roll };
      }
    }
    expect(Math.abs(best!.roll)).toBeGreaterThan(0.05);
    const k = kartOn(best!.t, best!.s + 3, best!.t.def.width / 2 - 2);
    const sim = setup([k], best!.t);
    sim.give(0, { id: 'slick', count: 1 });
    sim.press(0);
    const e = sim.items.entityList[0];
    expect(e.kind).toBe('slick');
    const ground = best!.t.sample(e.x, e.z, k.trackIndex)!.height;
    expect(e.y).toBeGreaterThanOrEqual(ground); // never inside the road
    expect(e.y - ground).toBeLessThan(0.02 + Math.abs(Math.tan(e.roll ?? 0)) * 1.2 + Math.abs(Math.tan(e.pitch ?? 0)) * 1.2 + 0.05);
    expect(Math.abs(e.roll ?? 0)).toBeGreaterThan(0.03);
  });

  it('still spins out the kart that drives over it', () => {
    const sim = setup([kartAt(100), kartAt(60)]);
    sim.give(0, { id: 'slick', count: 1 });
    sim.press(0);
    const e = sim.items.entityList[0];
    const v = sim.karts.get(1)!;
    v.pos.x = e.x;
    v.pos.z = e.z;
    v.pos.y = e.y;
    sim.tick(2);
    expect(v.spinTime).toBeGreaterThan(0);
    expect(sim.events).toContainEqual(expect.objectContaining({ kind: 'hit', slot: 1, by: 'slick' }));
  });
});

describe('magnet', () => {
  it('tows you (a boost) while a kart is ahead in range, and shows a link to it', () => {
    const sim = setup([kartAt(200), kartAt(170)]);
    sim.give(1, { id: 'magnet', count: 1 });
    sim.karts.get(0)!.speed = 20; // the kart ahead
    sim.karts.get(1)!.speed = 10;
    sim.press(1);
    expect(sim.events).toContainEqual({ kind: 'itemUse', slot: 1, id: 'magnet' });
    const k = sim.karts.get(1)!;
    expect(k.boostTime).toBeGreaterThan(0);
    const m = sim.items.entityList.find((e) => e.kind === 'magnet')!;
    expect(m.owner).toBe(1);
    expect(m.link).toBeDefined();
    expect(m.link!.z).toBeCloseTo(sim.karts.get(0)!.pos.z, 3);
  });

  it('does nothing when nobody is in range, or when the kart ahead is already right next to you', () => {
    const alone = setup([kartAt(100), kartAt(300)]); // 200 m ahead: out of range
    alone.give(1, { id: 'magnet', count: 1 });
    alone.press(1);
    expect(alone.karts.get(1)!.boostTime).toBe(0);
    expect(alone.items.entityList.find((e) => e.kind === 'magnet')!.link).toBeUndefined();

    const close = setup([kartAt(104), kartAt(100)]); // 4 m ahead: closer than the let-go distance
    close.give(1, { id: 'magnet', count: 1 });
    close.press(1);
    expect(close.karts.get(1)!.boostTime).toBe(0);
  });

  it('does not pull you faster than the kart ahead plus a margin (a catch-up, not a rocket)', () => {
    const sim = setup([kartAt(200), kartAt(170)]);
    sim.give(1, { id: 'magnet', count: 1 });
    sim.karts.get(0)!.speed = 10;
    sim.karts.get(1)!.speed = 10 + ITEMS.magnetOverspeed + 1;
    sim.press(1);
    expect(sim.karts.get(1)!.boostTime).toBe(0);
  });

  it('ends after its time, and a spin-out ends it early', () => {
    const sim = setup([kartAt(200), kartAt(170)]);
    sim.give(1, { id: 'magnet', count: 1 });
    sim.press(1);
    sim.tick(Math.round((ITEMS.magnetTime + 0.3) / SIM_DT));
    expect(sim.items.entityList.some((e) => e.kind === 'magnet')).toBe(false);

    const hit = setup([kartAt(200), kartAt(170), kartAt(120)]);
    hit.give(1, { id: 'magnet', count: 1 });
    hit.press(1);
    expect(hit.items.entityList.some((e) => e.kind === 'magnet')).toBe(true);
    hit.give(2, { id: 'slick', count: 1 });
    // A peel dropped on kart 1's spot spins it out and cancels the tow.
    hit.press(2);
    const peel = hit.items.entityList.find((e) => e.kind === 'slick')!;
    const k1 = hit.karts.get(1)!;
    k1.pos.x = peel.x;
    k1.pos.z = peel.z;
    k1.pos.y = peel.y;
    hit.tick(2);
    expect(k1.spinTime).toBeGreaterThan(0);
    hit.tick(2);
    expect(hit.items.entityList.some((e) => e.kind === 'magnet')).toBe(false);
  });
});

describe('bumper', () => {
  /** Orb position right now. */
  const orb = (sim: ReturnType<typeof setup>) => sim.items.entityList.find((e) => e.kind === 'bumper')!;

  it('circles its owner', () => {
    const sim = setup([kartAt(100)]);
    sim.give(0, { id: 'bumper', count: 1 });
    sim.press(0);
    const k = sim.karts.get(0)!;
    const a = { ...orb(sim) };
    expect(Math.hypot(a.x - k.pos.x, a.z - k.pos.z)).toBeCloseTo(ITEMS.bumperOrbit, 1);
    sim.tick(10);
    const b = orb(sim);
    expect(Math.hypot(b.x - k.pos.x, b.z - k.pos.z)).toBeCloseTo(ITEMS.bumperOrbit, 1);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(0.3); // it moved
  });

  it('shoves aside and slows a kart that touches it (no spin-out), then needs a cooldown', () => {
    const sim = setup([kartAt(100), kartAt(60)]);
    sim.give(0, { id: 'bumper', count: 1 });
    sim.press(0);
    const owner = sim.karts.get(0)!;
    const victim = sim.karts.get(1)!;
    victim.speed = 20;
    victim.vel.z = 20;
    const o = orb(sim);
    victim.pos.x = o.x;
    victim.pos.z = o.z;
    victim.pos.y = o.y;
    const before = { x: victim.pos.x, z: victim.pos.z };
    sim.tick(1);
    expect(sim.events).toContainEqual({ kind: 'bumped', slot: 1, attacker: 0 });
    expect(victim.spinTime).toBe(0);
    expect(victim.speed).toBeCloseTo(20 * ITEMS.bumperSpeedFactor, 3);
    sim.tick(Math.round(ITEMS.bumperShoveTime / SIM_DT) + 2);
    // Pushed away from the owner by roughly the shove distance.
    const away = Math.hypot(victim.pos.x - owner.pos.x, victim.pos.z - owner.pos.z) - Math.hypot(before.x - owner.pos.x, before.z - owner.pos.z);
    expect(away).toBeGreaterThan(ITEMS.bumperShove * 0.5);
    // Cooldown: touching again right away does nothing.
    const bumpsSoFar = sim.events.filter((e) => e.kind === 'bumped').length;
    const o2 = orb(sim);
    victim.pos.x = o2.x;
    victim.pos.z = o2.z;
    victim.pos.y = o2.y;
    sim.tick(1);
    expect(sim.events.filter((e) => e.kind === 'bumped').length).toBe(bumpsSoFar);
  });

  it('is blocked by Nova, never touches its owner, and swallows shots', () => {
    const sim = setup([kartAt(100), kartAt(60), kartAt(20)]);
    sim.give(0, { id: 'bumper', count: 1 });
    sim.press(0);
    // Owner is never bumped by its own orb.
    sim.tick(60);
    expect(sim.events.some((e) => e.kind === 'bumped' && e.slot === 0)).toBe(false);
    // Nova kart: blocked, not bumped.
    sim.karts.get(1)!.starTime = 3;
    const o = orb(sim);
    const nova = sim.karts.get(1)!;
    nova.pos.x = o.x;
    nova.pos.z = o.z;
    nova.pos.y = o.y;
    sim.tick(1);
    expect(sim.events).toContainEqual({ kind: 'blocked', slot: 1, by: 'nova' });
    expect(sim.events.some((e) => e.kind === 'bumped' && e.slot === 1)).toBe(false);

    // A Ricochet fired at the owner from behind is swallowed by the orb (the owner is not hit).
    const shooter = setup([kartAt(100), kartAt(80)]);
    shooter.give(0, { id: 'bumper', count: 1 });
    shooter.press(0);
    shooter.give(1, { id: 'ricochet', count: 1 });
    shooter.press(1, 0.08);
    shooter.tick(90);
    const owner = shooter.karts.get(0)!;
    expect(owner.spinTime).toBe(0);
  });

  it('pops after its charges are used up or its time runs out', () => {
    const sim = setup([kartAt(100), kartAt(60)]);
    sim.give(0, { id: 'bumper', count: 1 });
    sim.press(0);
    const victim = sim.karts.get(1)!;
    for (let i = 0; i < ITEMS.bumperCharges; i++) {
      const o = orb(sim);
      victim.pos.x = o.x;
      victim.pos.z = o.z;
      victim.pos.y = o.y;
      sim.tick(1);
      sim.tick(Math.round((ITEMS.bumperCooldown + 0.1) / SIM_DT)); // wait out the cooldown
      if (i < ITEMS.bumperCharges - 1) expect(sim.items.entityList.some((e) => e.kind === 'bumper')).toBe(true);
    }
    expect(sim.items.entityList.some((e) => e.kind === 'bumper')).toBe(false);
    expect(sim.events.filter((e) => e.kind === 'bumped').length).toBe(ITEMS.bumperCharges);

    const timed = setup([kartAt(100)]);
    timed.give(0, { id: 'bumper', count: 1 });
    timed.press(0);
    timed.tick(Math.round((ITEMS.bumperTime + 0.3) / SIM_DT));
    expect(timed.items.entityList.some((e) => e.kind === 'bumper')).toBe(false);
  });
});
