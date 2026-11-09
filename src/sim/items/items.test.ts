import { describe, expect, it } from 'vitest';
import { Buttons, type ControlInput } from '../../shared/protocol';
import { TRACKS } from '../../track';
import { ITEMS, KART, SIM_DT } from '../config';
import type { Ground } from '../ground';
import { createKart, stepKart, type KartState } from '../kart';
import { autopilot, botStyleFor } from '../autopilot';
import { Track } from '../track';
import { World, type WorldEvent } from '../world';
import { ItemSystem, botItemButton, type ItemEvent } from './items';
import { seededRng } from './odds';
import { ROULETTE_SECONDS, type HeldItem } from './types';

const track = new Track(TRACKS[0]);
const NONE: ControlInput = { steer: 0, buttons: 0 };
const ITEM_DOWN: ControlInput = { steer: 0, buttons: Buttons.ITEM };
const ITEM_BRAKE: ControlInput = { steer: 0, buttons: Buttons.ITEM | Buttons.BRAKE };

/** A kart standing on the road at distance s along the track, `lateral` metres right of center. */
function kartAt(s: number, lateral = 0): KartState {
  const p = track.pointAt(s, lateral);
  const k = createKart(p.x, p.z, p.heading, p.y);
  k.trackIndex = p.index;
  return k;
}

/** Item system with N karts; `standings` default to slot order (slot 0 leads). */
function setup(karts: KartState[]) {
  const slots = karts.map((_, i) => i);
  const items = new ItemSystem(track, seededRng(5), slots);
  const map = new Map(karts.map((k, i) => [i, k] as const));
  const inputs = new Map<number, ControlInput>(slots.map((i) => [i, NONE]));
  const events: ItemEvent[] = [];
  const tick = (n = 1, standings = slots) => {
    for (let i = 0; i < n; i++) events.push(...items.tick(map, inputs, standings, new Set()));
  };
  const give = (slot: number, item: HeldItem) => {
    items.states.get(slot)!.held = { ...item };
  };
  /** Hold ITEM for `seconds` (optionally with BRAKE), then release for one tick. */
  const press = (slot: number, seconds: number, down: ControlInput = ITEM_DOWN) => {
    inputs.set(slot, down);
    tick(Math.max(1, Math.round(seconds / SIM_DT)));
    inputs.set(slot, NONE);
    tick(1);
  };
  return { items, karts: map, inputs, events, tick, give, press };
}

const kinds = (ev: ItemEvent[]) => ev.map((e) => e.kind);

describe('item boxes and roulette', () => {
  it('every track has rows of boxes on drivable road', () => {
    for (const def of TRACKS) {
      const t = new Track(def);
      expect(t.itemBoxes.length).toBeGreaterThanOrEqual(9);
      expect(t.itemBoxes.length % 3).toBe(0);
      for (const b of t.itemBoxes) {
        expect(t.inGap(b.s)).toBe(false);
        const p = t.project(b.x, b.z);
        expect(Math.abs(p.d)).toBeLessThan(def.width / 2);
      }
    }
  });

  it('driving into a box starts the roulette, then reveals an item; the box comes back later', () => {
    const box = track.itemBoxes[0];
    const k = createKart(box.x, box.z, 0, box.y);
    const sim = setup([k]);
    sim.tick();
    expect(kinds(sim.events)).toContain('itemBox');
    expect(sim.items.displayFor(0)).toEqual({ kind: 'roulette' });
    expect(sim.items.boxes[0].active).toBe(false);

    sim.tick(Math.round((ROULETTE_SECONDS + 0.1) / SIM_DT));
    expect(kinds(sim.events)).toContain('itemGet');
    expect(sim.items.states.get(0)!.held).not.toBeNull();
    expect(sim.items.displayFor(0).kind).toBe('item');

    sim.tick(Math.round(ITEMS.boxRespawn / SIM_DT));
    expect(sim.items.boxes[0].active).toBe(true);
  });

  it('a kart that already holds an item cannot take another (the box stays)', () => {
    const box = track.itemBoxes[0];
    const sim = setup([createKart(box.x, box.z, 0, box.y)]);
    sim.give(0, { id: 'slick', count: 1 });
    sim.tick();
    expect(sim.items.boxes[0].active).toBe(true);
    expect(kinds(sim.events)).not.toContain('itemBox');
  });

  it('the item you get depends on your position (leader: defensive, last: strong)', () => {
    const lead = { slick: 0, ricochet: 0, nova: 0 } as Record<string, number>;
    const last = { slick: 0, ricochet: 0, nova: 0 } as Record<string, number>;
    for (let seed = 0; seed < 400; seed++) {
      for (const [pos, tally] of [[0, lead], [1, last]] as const) {
        const box = track.itemBoxes[0];
        const ks = [createKart(box.x, box.z, 0, box.y), kartAt(200)];
        const items = new ItemSystem(track, seededRng(seed), [0, 1]);
        const map = new Map(ks.map((k, i) => [i, k] as const));
        const order = pos === 0 ? [0, 1] : [1, 0];
        for (let i = 0; i < Math.round((ROULETTE_SECONDS + 0.2) / SIM_DT); i++) items.tick(map, new Map(), order, new Set());
        const id = items.states.get(0)!.held?.id;
        if (id && id in tally) tally[id]++;
      }
    }
    expect(lead.slick + lead.ricochet).toBeGreaterThan(last.slick + last.ricochet);
    expect(last.nova).toBeGreaterThan(lead.nova);
  });
});

describe('dash and nova', () => {
  it('Dash boosts instantly; the triple pack has 3 charges', () => {
    const sim = setup([kartAt(50)]);
    sim.give(0, { id: 'dash', count: 3 });
    sim.press(0, 0.05);
    expect(sim.karts.get(0)!.boostTime).toBeGreaterThan(0.9);
    expect(sim.items.states.get(0)!.held).toEqual({ id: 'dash', count: 2 });
    sim.press(0, 0.05);
    sim.press(0, 0.05);
    expect(sim.items.states.get(0)!.held).toBeNull();
    expect(kinds(sim.events).filter((k) => k === 'itemUse').length).toBe(3);
  });

  it('Nova makes you invincible, faster and immune to grass', () => {
    const sim = setup([kartAt(50)]);
    sim.give(0, { id: 'nova', count: 1 });
    sim.press(0, 0.05);
    const k = sim.karts.get(0)!;
    expect(k.starTime).toBeCloseTo(KART.novaTime, 1);

    const grass: Ground = { sample: () => ({ height: 0, surface: 'offroad' }) };
    const drive = (kart: KartState) => {
      for (let i = 0; i < 300; i++) stepKart(kart, { steer: 0, buttons: Buttons.GAS }, grass, SIM_DT);
      return kart.speed;
    };
    const plain = createKart(0, 0, 0);
    const nova = createKart(0, 0, 0);
    nova.starTime = 10;
    expect(drive(nova)).toBeGreaterThan(drive(plain) * 1.4);
  });

  it('Nova knocks other karts into a spin-out and shrugs off traps', () => {
    const sim = setup([kartAt(100), kartAt(101.5)]);
    sim.karts.get(0)!.starTime = 5;
    const ev: ItemEvent[] = [];
    sim.items.novaCollisions(sim.karts, ev);
    expect(ev).toContainEqual({ kind: 'hit', slot: 1, by: 'nova', attacker: 0 });
    expect(sim.karts.get(1)!.spinTime).toBeGreaterThan(0);
    expect(sim.karts.get(0)!.spinTime).toBe(0);
  });
});

describe('jumble (steering flip)', () => {
  it('flips the steering of every racer ahead of you, and nobody else', () => {
    const sim = setup([kartAt(300), kartAt(200), kartAt(100), kartAt(50)]);
    sim.give(2, { id: 'jumble', count: 1 }); // 3rd place uses it
    sim.press(2, 0.05);
    expect(sim.karts.get(0)!.invertTime).toBeCloseTo(ITEMS.jumbleTime, 1);
    expect(sim.karts.get(1)!.invertTime).toBeCloseTo(ITEMS.jumbleTime, 1);
    expect(sim.karts.get(2)!.invertTime).toBe(0); // not the user
    expect(sim.karts.get(3)!.invertTime).toBe(0); // behind the user
    expect(sim.events).toContainEqual({ kind: 'jumbled', slot: 0, attacker: 2 });
    expect(sim.events).toContainEqual({ kind: 'jumbled', slot: 1, attacker: 2 });
    expect(sim.items.states.get(2)!.held).toBeNull();
  });

  it('does nothing in the lead, and Nova blocks it', () => {
    const lead = setup([kartAt(300), kartAt(200)]);
    lead.give(0, { id: 'jumble', count: 1 });
    lead.press(0, 0.05);
    expect(lead.karts.get(1)!.invertTime).toBe(0);

    const sim = setup([kartAt(300), kartAt(200)]);
    sim.karts.get(0)!.starTime = 5;
    sim.give(1, { id: 'jumble', count: 1 });
    sim.press(1, 0.05);
    expect(sim.karts.get(0)!.invertTime).toBe(0);
    expect(sim.events).toContainEqual({ kind: 'blocked', slot: 0, by: 'nova' });
  });

  it('a jumbled kart turns the opposite way, then goes back to normal', () => {
    const flat: Ground = { sample: () => ({ height: 0, surface: 'road' }) };
    const turn = (inverted: boolean) => {
      const k = createKart(0, 0, 0);
      k.speed = 20;
      k.vel.z = 20;
      if (inverted) k.invertTime = 3;
      for (let i = 0; i < 30; i++) stepKart(k, { steer: 1, buttons: Buttons.GAS }, flat, SIM_DT);
      return k.heading;
    };
    expect(turn(false)).toBeLessThan(0); // steer right = heading decreases
    expect(turn(true)).toBeGreaterThan(0); // flipped

    const k = createKart(0, 0, 0);
    k.speed = 20;
    k.vel.z = 20;
    k.invertTime = 1;
    for (let i = 0; i < 90; i++) stepKart(k, { steer: 0, buttons: Buttons.GAS }, flat, SIM_DT);
    expect(k.invertTime).toBe(0);
    const h = k.heading;
    for (let i = 0; i < 30; i++) stepKart(k, { steer: 1, buttons: Buttons.GAS }, flat, SIM_DT);
    expect(k.heading).toBeLessThan(h); // normal again
  });
});

describe('slick (oil trap)', () => {
  it('a tap drops it behind you; the next kart over it spins out', () => {
    const sim = setup([kartAt(100), kartAt(300)]);
    sim.give(0, { id: 'slick', count: 1 });
    sim.press(0, 0.08);
    expect(sim.items.entityList.length).toBe(1);
    const slick = sim.items.entityList[0];
    expect(slick.kind).toBe('slick');
    expect(sim.items.states.get(0)!.held).toBeNull();

    // Another kart drives onto it.
    const victim = sim.karts.get(1)!;
    victim.pos.x = slick.x;
    victim.pos.z = slick.z;
    victim.pos.y = slick.y;
    victim.speed = 20;
    sim.tick(2);
    expect(victim.spinTime).toBeGreaterThan(0);
    expect(victim.speed).toBeLessThan(20 * 0.5);
    expect(sim.events).toContainEqual({ kind: 'hit', slot: 1, by: 'slick', attacker: 0 });
    expect(sim.items.entityList.length).toBe(0); // used up
  });

  it('cannot hurt its owner right away, and jumping over it is safe', () => {
    const sim = setup([kartAt(100), kartAt(300)]);
    sim.give(0, { id: 'slick', count: 1 });
    sim.press(0, 0.08);
    const slick = sim.items.entityList[0];
    const owner = sim.karts.get(0)!;
    owner.pos.x = slick.x;
    owner.pos.z = slick.z;
    sim.tick(2);
    expect(owner.spinTime).toBe(0);

    const jumper = sim.karts.get(1)!;
    jumper.pos.x = slick.x;
    jumper.pos.z = slick.z;
    jumper.grounded = false;
    sim.tick(2);
    expect(jumper.spinTime).toBe(0);
  });

  it('holding drags it behind you as a shield that blocks a shot', () => {
    const sim = setup([kartAt(100), kartAt(80)]);
    sim.give(0, { id: 'slick', count: 1 });
    sim.give(1, { id: 'ricochet', count: 1 });
    sim.inputs.set(0, ITEM_DOWN);
    sim.tick(Math.round(0.4 / SIM_DT)); // hold for 0.4 s
    expect(sim.items.states.get(0)!.trailing).toBe(true);
    const e = sim.items.entityList[0];
    expect(e.trailing).toBe(true);
    const k = sim.karts.get(0)!;
    expect(Math.hypot(e.x - k.pos.x, e.z - k.pos.z)).toBeCloseTo(ITEMS.trailDistance, 0);

    // The kart behind fires a Ricochet at the shield.
    sim.press(1, 0.05);
    sim.tick(40);
    expect(sim.events).toContainEqual(expect.objectContaining({ kind: 'itemDestroyed' }));
    expect(sim.items.entityList.length).toBe(0);
    expect(k.spinTime).toBe(0); // the shield took the hit
    expect(sim.items.states.get(0)!.held).toBeNull();
  });

  it('releasing a dragged slick drops it where it is', () => {
    const sim = setup([kartAt(100)]);
    sim.give(0, { id: 'slick', count: 1 });
    sim.inputs.set(0, ITEM_DOWN);
    sim.tick(Math.round(0.4 / SIM_DT));
    sim.inputs.set(0, NONE);
    sim.tick(1);
    expect(sim.items.entityList.length).toBe(1);
    expect(sim.items.entityList[0].trailing).toBe(false);
    expect(sim.items.states.get(0)!.held).toBeNull();
  });
});

describe('ricochet and seeker shots', () => {
  it('a Ricochet flies forward and spins out the kart it hits', () => {
    const sim = setup([kartAt(60), kartAt(95)]);
    sim.give(0, { id: 'ricochet', count: 1 });
    sim.press(0, 0.08);
    expect(sim.items.entityList[0]?.kind).toBe('ricochet');
    sim.tick(60);
    expect(sim.events).toContainEqual({ kind: 'hit', slot: 1, by: 'ricochet', attacker: 0 });
    expect(sim.karts.get(1)!.spinTime).toBeGreaterThan(0);
    expect(sim.items.entityList.length).toBe(0);
  });

  it('holding BRAKE when firing sends it backward', () => {
    const sim = setup([kartAt(95), kartAt(60)]);
    sim.give(0, { id: 'ricochet', count: 1 });
    // Hold ITEM + BRAKE, then let go of ITEM while BRAKE is still down (that is how a thumb does it).
    sim.inputs.set(0, ITEM_BRAKE);
    sim.tick(5);
    sim.inputs.set(0, { steer: 0, buttons: Buttons.BRAKE });
    sim.tick(1);
    sim.inputs.set(0, NONE);
    sim.tick(60);
    expect(sim.events).toContainEqual({ kind: 'hit', slot: 1, by: 'ricochet', attacker: 0 });
  });

  it('a Ricochet bounces off walls a few times, then expires', () => {
    const first = track.samples.findIndex((p) => p.wallLeft || p.wallRight);
    let last = first;
    while (track.samples[last + 1]?.wallLeft || track.samples[last + 1]?.wallRight) last++;
    const i = Math.floor((first + last) / 2);
    const p = track.samples[i];
    const side = p.wallRight ? 1 : -1;
    const k = createKart(p.x, p.z, Math.atan2(side * p.rx, side * p.rz), p.y);
    k.trackIndex = i;
    const sim = setup([k]);
    sim.give(0, { id: 'ricochet', count: 1 });
    sim.press(0, 0.08);
    let maxBounces = 0;
    for (let n = 0; n < 60 * ITEMS.ricochetLifetime && sim.items.entityList.length; n++) {
      sim.tick();
      const e = (sim.items as unknown as { entities: { bounces: number }[] }).entities[0];
      if (e) maxBounces = Math.max(maxBounces, e.bounces);
    }
    expect(maxBounces).toBeGreaterThanOrEqual(1);
    expect(sim.items.entityList.length).toBe(0); // gone by the end
  });

  it('a Seeker curves toward the racer ahead and hits it', () => {
    // Slot 0 leads (standings [0, 1]) and is off to the side; slot 1 fires from behind.
    const sim = setup([kartAt(160, 4), kartAt(60, -4)]);
    sim.give(1, { id: 'seeker', count: 1 });
    sim.inputs.set(1, ITEM_DOWN);
    sim.tick(4);
    sim.inputs.set(1, NONE);
    sim.tick(1);
    expect(sim.items.entityList[0]?.kind).toBe('seeker');
    sim.tick(240);
    expect(sim.events).toContainEqual({ kind: 'hit', slot: 0, by: 'seeker', attacker: 1 });
  });

  it('the leader\'s Seeker has nobody to chase and just flies straight', () => {
    const sim = setup([kartAt(60), kartAt(300)]);
    sim.give(0, { id: 'seeker', count: 1 });
    sim.press(0, 0.08);
    expect((sim.items.entityList[0] as unknown as { target: number | null }).target ?? null).toBeNull();
  });

  it('a Nova kart is not hurt by shots', () => {
    const sim = setup([kartAt(60), kartAt(95)]);
    sim.karts.get(1)!.starTime = 5;
    sim.give(0, { id: 'ricochet', count: 1 });
    sim.press(0, 0.08);
    sim.tick(60);
    expect(sim.events).toContainEqual({ kind: 'blocked', slot: 1, by: 'ricochet' });
    expect(sim.karts.get(1)!.spinTime).toBe(0);
  });
});

describe('spin-out', () => {
  it('ignores controls for a while, loses speed and boost, then recovers', () => {
    const flat: Ground = { sample: () => ({ height: 0, surface: 'road' }) };
    // Kart 1 drops a slick; kart 0 drives onto it.
    const sim = setup([kartAt(100), kartAt(300)]);
    sim.give(1, { id: 'slick', count: 1 });
    sim.press(1, 0.08);
    const slick = sim.items.entityList[0];
    const victim = sim.karts.get(0)!;
    victim.pos.x = slick.x;
    victim.pos.z = slick.z;
    victim.speed = 25;
    victim.boostTime = 1;
    sim.tick(2);
    expect(victim.spinTime).toBeGreaterThan(0);
    expect(victim.boostTime).toBe(0);
    expect(victim.speed).toBeLessThan(25 * KART.spinSpeedFactor + 1);

    const heading = victim.heading;
    for (let i = 0; i < 30; i++) stepKart(victim, { steer: 1, buttons: Buttons.GAS }, flat, SIM_DT);
    expect(victim.heading).toBe(heading); // steering ignored while spinning
    for (let i = 0; i < 180; i++) stepKart(victim, { steer: 0, buttons: Buttons.GAS }, flat, SIM_DT);
    expect(victim.spinTime).toBe(0);
    expect(victim.speed).toBeGreaterThan(15); // accelerating again
  });
});

describe('items in a full race', () => {
  it('4 bots that use their items still finish; items get used and hits happen', () => {
    const world = new World(track, track);
    world.startRace([0, 1, 2, 3], 3);
    const used: WorldEvent[] = [];
    let ticks = 0;
    while (world.race!.phase !== 'done' && ticks < 60 * 500) {
      const evs = world.tick((slot) => {
        const base = autopilot(world.karts.get(slot)!, track, botStyleFor(slot));
        return { ...base, buttons: base.buttons | botItemButton(slot, world.items!.states.get(slot)) };
      });
      used.push(...evs.filter((e) => e.kind === 'itemUse' || e.kind === 'hit' || e.kind === 'itemBox'));
      ticks++;
    }
    expect(world.race!.phase).toBe('done');
    for (const r of world.race!.racers.values()) expect(r.finished).toBe(true);
    expect(used.filter((e) => e.kind === 'itemBox').length).toBeGreaterThan(4);
    expect(used.filter((e) => e.kind === 'itemUse').length).toBeGreaterThan(2);
  });
});
