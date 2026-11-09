import { describe, expect, it } from 'vitest';
import { Buttons, type ControlInput } from '../shared/protocol';
import { cannonTest } from '../track/tracks/_cannonTest';
import type { TrackDef } from '../track/types';
import { CANNON, flightPoint } from './cannon';
import { autopilot, botStyleFor } from './autopilot';
import { SIM_DT } from './config';
import { cloneKart, forwardOf } from './kart';
import { Track } from './track';
import { World, type WorldEvent } from './world';

const GAS: ControlInput = { steer: 0, buttons: Buttons.GAS };
const track = new Track(cannonTest);
const cannon = track.cannons[0];

/** A running race (past the countdown) with one kart per slot, parked on the grid. */
function racing(slots: number[], t: Track = track): World {
  const world = new World(t, t);
  world.startRace(slots, 2);
  for (let i = 0; i < 60 * 3.2; i++) world.tick(() => ({ steer: 0, buttons: 0 }));
  expect(world.race!.phase).toBe('racing');
  return world;
}

/** Put a kart `back` metres before the cannon mouth (on the track), driving at `speed`. */
function placeBeforeMouth(world: World, slot: number, back = 10, speed = 25): void {
  const c = world.track!.cannons[0];
  const p = world.track!.pointAt(c.mouth.s - back, c.lateral);
  const k = world.karts.get(slot)!;
  Object.assign(k, { grounded: true, speed, heading: p.heading, trackIndex: p.index });
  Object.assign(k.pos, { x: p.x, y: p.y, z: p.z });
  k.vel.x = forwardOf(p.heading).x * speed;
  k.vel.z = forwardOf(p.heading).z * speed;
}

/** Tick until `pred` matches an event or the time runs out; returns every event seen. */
function run(world: World, seconds: number, pred: (e: WorldEvent) => boolean = () => false, input: ControlInput = GAS): WorldEvent[] {
  const seen: WorldEvent[] = [];
  for (let i = 0; i < seconds / SIM_DT; i++) {
    const ev = world.tick(() => input);
    seen.push(...ev);
    if (ev.some(pred)) break;
  }
  return seen;
}

describe('cannon resolution', () => {
  it('puts the mouth and landing on the road where the def says', () => {
    expect(track.cannons).toHaveLength(1);
    expect(cannon.mouth.x).toBeCloseTo(0, 0);
    expect(cannon.mouth.s).toBeCloseTo(track.sAt(2), 5);
    expect(cannon.mouth.heading).toBeCloseTo(0, 1); // heading +z
    expect(cannon.landing.x).toBeCloseTo(140, 0);
    expect(cannon.landing.s).toBeCloseTo(track.sAt(8), 5);
    expect(Math.abs(cannon.landing.heading)).toBeCloseTo(Math.PI, 1); // heading -z
    expect(cannon.flightTime).toBe(3);
    expect(cannon.apex).toBe(14);
    expect(cannon.triggerRadius).toBeGreaterThan(2);
    // The barrel exit is ahead of and above the mouth.
    expect(cannon.muzzle.z).toBeCloseTo(cannon.mouth.z + CANNON.muzzleForward, 1);
    expect(cannon.muzzle.y).toBeCloseTo(cannon.mouth.y + CANNON.muzzleUp, 5);
    // The kart turns through ~180 degrees on the way.
    expect(Math.abs(cannon.turn)).toBeCloseTo(Math.PI, 1);
  });

  it('uses the defaults for flight time and apex, and an offset puts the mouth beside the centre', () => {
    const t = new Track({ ...cannonTest, cannons: [{ at: 2, offset: 0.5, target: { at: 8, offset: -0.5 } }] });
    expect(t.cannons[0].flightTime).toBe(CANNON.flightTime);
    expect(t.cannons[0].apex).toBe(CANNON.apex);
    expect(t.cannons[0].lateral).toBeCloseTo((0.5 * cannonTest.width) / 2, 5);
    expect(t.project(t.cannons[0].mouth.x, t.cannons[0].mouth.z).d).toBeCloseTo(t.cannons[0].lateral, 1);
  });

  it('a track without cannons has none', () => {
    expect(new Track({ ...cannonTest, cannons: undefined }).cannons).toEqual([]);
  });

  it('the air path starts at the muzzle, ends at the landing and peaks `apex` above the straight line', () => {
    const a = flightPoint(cannon, 0);
    const b = flightPoint(cannon, 1);
    const mid = flightPoint(cannon, 0.5);
    expect(a).toEqual(cannon.muzzle);
    expect(b.x).toBeCloseTo(cannon.landing.x, 6);
    expect(b.y).toBeCloseTo(cannon.landing.y, 6);
    expect(mid.y).toBeCloseTo((cannon.muzzle.y + cannon.landing.y) / 2 + cannon.apex, 6);
  });
});

describe('flying through a cannon', () => {
  it('captures a kart driving into the mouth, fires it after the load time and lands it on the landing point', () => {
    const world = racing([0]);
    placeBeforeMouth(world, 0);
    const k = world.karts.get(0)!;
    const events = run(world, 1.5, (e) => e.kind === 'cannonFire');
    expect(events.find((e) => e.kind === 'cannonFire')).toMatchObject({ kind: 'cannonFire', slot: 0, cannon: 0 });
    expect(k.flight?.phase).toBe('air');

    // Flying: off the ground, high above the straight line, controls ignored.
    const heading0 = k.heading;
    run(world, cannon.flightTime / 2, () => false, { steer: 1, buttons: Buttons.GAS | Buttons.DRIFT });
    expect(k.grounded).toBe(false);
    expect(k.pos.y).toBeGreaterThan((cannon.muzzle.y + cannon.landing.y) / 2 + cannon.apex * 0.9);
    expect(k.heading).not.toBe(heading0);

    // Landing on the landing point, facing along the road there, with a boost.
    const rest = run(world, cannon.flightTime, (e) => e.kind === 'cannonLand');
    expect(rest.some((e) => e.kind === 'cannonLand')).toBe(true);
    expect(k.flight).toBeNull();
    expect(k.grounded).toBe(true);
    expect(Math.hypot(k.pos.x - cannon.landing.x, k.pos.z - cannon.landing.z)).toBeLessThan(0.5);
    expect(k.pos.y).toBeCloseTo(cannon.landing.y, 1);
    expect(Math.abs(Math.sin((k.heading - cannon.landing.heading) / 2))).toBeLessThan(0.05);
    expect(k.speed).toBeCloseTo(CANNON.landSpeed, 0);
    expect(k.boostTime).toBeGreaterThan(CANNON.landBoostTime - 0.1);
  });

  it('spends loadTime + flightTime between capture and landing', () => {
    const world = racing([0]);
    placeBeforeMouth(world, 0);
    let captured = -1;
    let landed = -1;
    for (let i = 0; i < 60 * 10 && landed < 0; i++) {
      const ev = world.tick(() => GAS);
      if (captured < 0 && world.karts.get(0)!.flight) captured = i;
      if (ev.some((e) => e.kind === 'cannonLand')) landed = i;
    }
    expect(captured).toBeGreaterThanOrEqual(0);
    expect((landed - captured) * SIM_DT).toBeGreaterThan(CANNON.loadTime + cannon.flightTime - 0.05);
    expect((landed - captured) * SIM_DT).toBeLessThan(CANNON.loadTime + cannon.flightTime + 0.1);
  });

  it('ignores slow karts, spinning karts and karts that miss the mouth', () => {
    const slow = racing([0]);
    placeBeforeMouth(slow, 0, 10, 0);
    run(slow, 1, () => false, { steer: 0, buttons: 0 });
    expect(slow.karts.get(0)!.flight).toBeNull();

    const miss = racing([0]);
    const c = miss.track!.cannons[0];
    const p = miss.track!.pointAt(c.mouth.s - 10, 6); // 6 m beside the mouth
    Object.assign(miss.karts.get(0)!.pos, { x: p.x, y: p.y, z: p.z });
    Object.assign(miss.karts.get(0)!, { speed: 25, heading: p.heading, trackIndex: p.index });
    run(miss, 1);
    expect(miss.karts.get(0)!.flight).toBeNull();

    const spin = racing([0]);
    placeBeforeMouth(spin, 0);
    spin.karts.get(0)!.spinTime = 1.5;
    run(spin, 1);
    expect(spin.karts.get(0)!.flight).toBeNull();
  });

  it('cannot be hurt in flight: Nova bumps, item hits, kart collisions, walls', () => {
    const world = racing([0, 1]);
    placeBeforeMouth(world, 0);
    const flyer = world.karts.get(0)!;
    const bully = world.karts.get(1)!;
    run(world, 1.5, (e) => e.kind === 'cannonFire');
    expect(flyer.flight).not.toBeNull();
    const all: WorldEvent[] = [];
    for (let i = 0; i < 60; i++) {
      // Slot 1 is invincible (Nova) and sits on top of the flying kart.
      bully.starTime = 5;
      bully.spinTime = 0;
      Object.assign(bully.pos, { x: flyer.pos.x + 0.5, y: flyer.pos.y, z: flyer.pos.z });
      all.push(...world.tick(() => GAS));
      // Direct hits through the item system (what shots and slicks call).
      const hitKart = (world.items as unknown as { hitKart: (...a: unknown[]) => boolean }).hitKart.bind(world.items);
      expect(hitKart(0, world.karts, 'ricochet', 1, all)).toBe(false);
    }
    expect(flyer.spinTime).toBe(0);
    expect(flyer.flight).not.toBeNull();
    expect(all.filter((e) => (e.kind === 'hit' || e.kind === 'blocked' || e.kind === 'kart' || e.kind === 'wall') && e.slot === 0)).toHaveLength(0);
  });

  it('cannot be captured again for 3 s after landing, then can', () => {
    const world = racing([0]);
    placeBeforeMouth(world, 0);
    run(world, 6, (e) => e.kind === 'cannonLand');
    const k = world.karts.get(0)!;
    expect(k.cannonCooldown).toBeGreaterThan(CANNON.cooldown - 0.1);

    placeBeforeMouth(world, 0, 1, 25); // straight back into the mouth
    run(world, 0.3);
    expect(k.flight).toBeNull();

    run(world, CANNON.cooldown); // cool-down over
    placeBeforeMouth(world, 0, 1, 25);
    run(world, 0.3);
    expect(k.flight).not.toBeNull();
  });

  it('cloneKart copies the flight state (render interpolation keeps the previous tick)', () => {
    const world = racing([0]);
    placeBeforeMouth(world, 0);
    run(world, 1.5, (e) => e.kind === 'cannonFire');
    const k = world.karts.get(0)!;
    const c = cloneKart(k);
    k.flight!.t = 99;
    expect(c.flight!.t).not.toBe(99);
  });
});

describe('race progress through a cannon', () => {
  /** The cannon fires from the right straight across the start line into the left straight. */
  const wrapDef: TrackDef = { ...cannonTest, cannons: [{ at: 9.2, offset: 0, target: { at: 1.5, offset: 0 }, flightTime: 3 }] };
  const wrapTrack = new Track(wrapDef);

  it('credits the skipped checkpoints, including a lap when the landing is past the start line', () => {
    const world = racing([0], wrapTrack);
    const race = world.race!;
    const c = wrapTrack.cannons[0];
    const racer = race.racers.get(0)!;
    racer.lap = 1;
    racer.next = (race.segmentOf(c.mouth.s) + 1) % wrapTrack.checkpoints.length;
    placeBeforeMouth(world, 0);
    const events = run(world, 8, (e) => e.kind === 'cannonLand');
    expect(events.some((e) => e.kind === 'cannonLand')).toBe(true);
    // Crossed the start line by air: lap 1 is done, we are on lap 2, expecting the checkpoint after the landing.
    expect(events.some((e) => e.kind === 'lap' && e.slot === 0 && e.lap === 1)).toBe(true);
    expect(racer.lap).toBe(2);
    expect(racer.next).toBe((race.segmentOf(c.landing.s) + 1) % wrapTrack.checkpoints.length);
  });

  it('credits the checkpoints in between on a mid-lap cannon', () => {
    const world = racing([0]);
    const race = world.race!;
    const racer = race.racers.get(0)!;
    racer.lap = 1;
    racer.next = race.segmentOf(cannon.mouth.s) + 1;
    placeBeforeMouth(world, 0);
    run(world, 8, (e) => e.kind === 'cannonLand');
    expect(racer.lap).toBe(1);
    expect(racer.next).toBe(race.segmentOf(cannon.landing.s) + 1);
  });
});

describe('bots and cannons', () => {
  it('bots drive into the cannon every lap and finish the race much faster than going round', () => {
    const world = new World(track, track);
    world.startRace([0, 1], 2);
    const seen: WorldEvent[] = [];
    let ticks = 0;
    while (world.race!.phase !== 'done' && ticks < 60 * 400) {
      seen.push(...world.tick((slot) => autopilot(world.karts.get(slot)!, track, botStyleFor(slot))));
      ticks++;
    }
    expect(world.race!.phase).toBe('done');
    for (const r of world.race!.racers.values()) expect(r.finished).toBe(true);
    for (const slot of [0, 1]) {
      expect(seen.filter((e) => e.kind === 'cannonFire' && e.slot === slot).length).toBeGreaterThanOrEqual(2); // once per lap
      expect(seen.filter((e) => e.kind === 'cannonLand' && e.slot === slot).length).toBeGreaterThanOrEqual(2);
    }
    // 2 laps of a ~1040 m track at ~26 m/s would take ~80 s; skipping ~40 % per lap is far quicker.
    expect(world.race!.racers.get(0)!.finishTime!).toBeLessThan(70);
  });

  it('a bot can be told to ignore cannons', () => {
    const world = racing([0]);
    placeBeforeMouth(world, 0, 40, 25);
    const style = { ...botStyleFor(0), lane: 6, useCannons: false };
    for (let i = 0; i < 60 * 3; i++) world.tick(() => autopilot(world.karts.get(0)!, track, style));
    expect(world.karts.get(0)!.flight).toBeNull();
  });
});
