/**
 * Tests for the item list (ids / names), the Jumble reach and the Peel (internal id `slick`) resting on the ground.
 * Storm and Rocket have their own file (stormRocket.test.ts), the Seeker too (seeker.test.ts).
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
    expect(ITEM_IDS.slice(6, 8)).toEqual(['storm', 'rocket']); // they took over the slots of the retired Magnet and Bumper
    expect(ITEM_IDS.slice(8)).toEqual(['hunter', 'decoy']); // appended later (see hunterDecoy.test.ts)
    expect(ITEM_IDS.length).toBe(10);
    expect(ITEM_INFO.slick.name).toBe('Peel'); // the id stays `slick`, players see "Peel"
    expect(ITEM_INFO.storm.name).toBe('Storm');
    expect(ITEM_INFO.rocket.name).toBe('Rocket');
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
