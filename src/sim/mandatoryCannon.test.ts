/**
 * Mandatory cannons (Ember Peaks over the crater, Cloud Garden over open sky): the road ENDS at a launch pad,
 * every kart is captured and fired across a gap with no ground, and lands on the far side.
 */
import { describe, expect, it } from 'vitest';
import { Buttons, type ControlInput } from '../shared/protocol';
import { cloudGarden } from '../track/tracks/cloudGarden';
import { emberPeaks } from '../track/tracks/emberPeaks';
import type { TrackDef } from '../track/types';
import { BotPack, DIFFICULTIES, type Difficulty } from './bots';
import { CANNON } from './cannon';
import { botLoadoutFor } from './classes';
import { SIM_DT } from './config';
import { forwardOf } from './kart';
import { mapDataFromTrack } from './mapData';
import { Track } from './track';
import { World, type WorldEvent } from './world';

const GAS: ControlInput = { steer: 0, buttons: Buttons.GAS };
const defs: [string, TrackDef][] = [
  ['Ember Peaks', emberPeaks],
  ['Cloud Garden', cloudGarden],
];

/** A running race (past the countdown) with one parked kart per slot. */
function racing(def: TrackDef, slots: number[]): World {
  const t = new Track(def);
  const world = new World(t, t);
  world.startRace(slots, 2);
  for (let i = 0; i < 60 * 3.2; i++) world.tick(() => ({ steer: 0, buttons: 0 }));
  return world;
}

/** Put a kart `back` metres before the mouth, `side` metres from the road centre, driving along the road at `speed`. */
function place(world: World, slot: number, back: number, side: number, speed: number): void {
  const c = world.track!.cannons[0];
  const p = world.track!.pointAt(c.mouth.s - back, side);
  const k = world.karts.get(slot)!;
  Object.assign(k, { grounded: true, speed, heading: p.heading, trackIndex: p.index });
  Object.assign(k.pos, { x: p.x, y: p.y, z: p.z });
  k.vel.x = forwardOf(p.heading).x * speed;
  k.vel.z = forwardOf(p.heading).z * speed;
}

function run(world: World, seconds: number, pred: (e: WorldEvent) => boolean = () => false, input: ControlInput = GAS): WorldEvent[] {
  const seen: WorldEvent[] = [];
  for (let i = 0; i < seconds / SIM_DT; i++) {
    const ev = world.tick(() => input);
    seen.push(...ev);
    if (ev.some(pred)) break;
  }
  return seen;
}

describe.each(defs)('%s: the gap', (_name, def) => {
  const track = new Track(def);
  const c = track.cannons[0];
  const gap = track.gaps.find((g) => g.kind === 'sky')!;

  it('is one mandatory cannon with a 120-250 m gap between the pad and the landing', () => {
    expect(track.cannons).toHaveLength(1);
    expect(c.mandatory).toBe(true);
    expect(gap).toBeDefined();
    expect(gap.s1 - gap.s0).toBeGreaterThanOrEqual(120);
    expect(gap.s1 - gap.s0).toBeLessThanOrEqual(250);
    // The pad is the last bit of road after the mouth, the landing platform the first bit before the landing.
    expect(gap.s0).toBeCloseTo(c.mouth.s + CANNON.padAhead, 5);
    expect(gap.s1).toBeCloseTo(c.landing.s - CANNON.landBehind, 5);
  });

  it('has no ground in the gap (on the road or beside it) and counts as a gap for respawns (inGap)', () => {
    for (let s = gap.s0 + 10; s < gap.s1 - 10; s += 6) {
      // (10 m in from both ends: beside a curved road the nearest road point is not at the same s)
      expect(track.inGap(s)).toBe(true);
      expect(track.inSkyGap(s)).toBe(true);
      for (const d of [-6, -2, 0, 3, 7, 12]) {
        const p = track.pointAt(s, d);
        expect(track.sample(p.x, p.z, p.index), `ground at s=${s.toFixed(0)} d=${d}`).toBeNull();
      }
    }
    // Road at both ends: the pad before the gap and the landing platform after it.
    for (const s of [gap.s0 - 2, c.mouth.s, gap.s1 + 2, c.landing.s]) {
      const p = track.pointAt(s);
      expect(track.sample(p.x, p.z, p.index), `ground at s=${s.toFixed(0)}`).not.toBeNull();
    }
  });

  it('is not drawn as road on the maps: the main line is open, from the landing round to the pad', () => {
    const data = mapDataFromTrack(track);
    expect(data.routes[0].closed).toBe(false);
    expect(data.voidGaps.every((g) => (g.length ?? 0) < 100)).toBe(true); // the flight is the cannon arc, not a notch
    const first = data.routes[0].points[0];
    const last = data.routes[0].points[data.routes[0].points.length - 1];
    expect(Math.hypot(first.x - c.landing.x, first.z - c.landing.z)).toBeLessThan(40); // starts just after the gap
    expect(Math.hypot(last.x - c.mouth.x, last.z - c.mouth.z)).toBeLessThan(20); // ends at the pad
    expect(data.cannons).toHaveLength(1);
  });
});

describe.each(defs)('%s: every kart goes through the cannon', (_name, def) => {
  const probe = new Track(def);
  const half = probe.cannons[0].captureHalfWidth;

  it('captures a kart anywhere across the road, fast or slow, and lands it on the far side with checkpoint credit', () => {
    for (const side of [-half + 0.5, -probe.def.width / 2, 0, probe.def.width / 2, half - 0.5]) {
      for (const speed of [3, 26]) {
        const world = racing(def, [0]);
        const k = world.karts.get(0)!;
        const racer = world.race!.racers.get(0)!;
        const c = world.track!.cannons[0];
        racer.lap = 1;
        racer.next = world.race!.segmentOf(c.mouth.s) + 1;
        place(world, 0, 1.2, side, speed);
        const events = run(world, 9, (e) => e.kind === 'cannonLand');
        expect(events.some((e) => e.kind === 'cannonFire'), `fired (side ${side}, speed ${speed})`).toBe(true);
        expect(events.some((e) => e.kind === 'cannonLand'), `landed (side ${side}, speed ${speed})`).toBe(true);
        expect(events.some((e) => e.kind === 'respawn')).toBe(false);
        expect(Math.hypot(k.pos.x - c.landing.x, k.pos.z - c.landing.z)).toBeLessThan(0.5);
        expect(racer.next).toBe(world.race!.segmentOf(c.landing.s) + 1); // the checkpoints in the gap are credited
        // Gentle landing: a boost and a steady speed, not a crash.
        expect(k.boostTime).toBeGreaterThan(0.5);
        expect(k.grounded).toBe(true);
      }
    }
  });

  it('captures a kart that is spinning out on the pad, too (nobody slips past the line)', () => {
    const world = racing(def, [0]);
    place(world, 0, 1, 2, 20);
    world.karts.get(0)!.spinTime = 1.5;
    run(world, 1.5);
    expect(world.karts.get(0)!.flight).not.toBeNull();
  });

  it('a kart that misses the capture (drives past the pad beside it) falls and respawns BEFORE the pad', () => {
    // (Without the funnel walls: they would push a kart that is beside the pad back onto it.)
    const world = racing({ ...def, walls: [] }, [0]);
    const track = world.track!;
    const c = track.cannons[0];
    const racer = world.race!.racers.get(0)!;
    racer.lap = 1;
    racer.next = world.race!.segmentOf(c.mouth.s) + 1; // the last checkpoint it passed is the one before the pad
    place(world, 0, 8, half + 2, 22); // outside the strip the capture covers, driving straight on
    const events = run(world, 12, (e) => e.kind === 'respawn');
    expect(events.some((e) => e.kind === 'cannonFire')).toBe(false);
    expect(events.some((e) => e.kind === 'respawn'), 'respawned').toBe(true);
    const k = world.karts.get(0)!;
    expect(k.flight).toBeNull();
    // The carrier sets it down on the road before the pad, never in the gap.
    const p = track.project(k.pos.x, k.pos.z);
    expect(track.inGap(p.s)).toBe(false);
    expect(track.deltaS(p.s, c.mouth.s)).toBeGreaterThan(0);
  });

  it('a kart dropped into the gap itself falls and respawns before the pad', () => {
    const world = racing(def, [0]);
    const track = world.track!;
    const gap = track.gaps.find((g) => g.kind === 'sky')!;
    const mid = track.pointAt((gap.s0 + gap.s1) / 2);
    const k = world.karts.get(0)!;
    Object.assign(k.pos, { x: mid.x, y: mid.y + 1, z: mid.z });
    Object.assign(k, { grounded: false, trackIndex: mid.index, speed: 0 });
    const events = run(world, 10, (e) => e.kind === 'respawn', { steer: 0, buttons: 0 });
    expect(events.some((e) => e.kind === 'respawn')).toBe(true);
    const p = track.project(k.pos.x, k.pos.z);
    expect(track.inGap(p.s)).toBe(false);
  });
});

describe.each(defs)('%s: bots are fired every lap and finish', (_name, def) => {
  it.each(DIFFICULTIES)('%s bots', (difficulty: Difficulty) => {
    const track = new Track(def);
    const world = new World(track, track);
    const slots = [0, 1, 2, 3];
    const laps = 2;
    world.startRace(slots, laps, new Map(slots.map((s) => [s, botLoadoutFor(s)])));
    const pack = new BotPack(difficulty);
    const fired = new Map<number, number>();
    const landed = new Map<number, number>();
    for (let i = 0; i < 60 * 420 && world.race!.phase !== 'done'; i++) {
      for (const e of world.tick((slot) => pack.input(world, slot))) {
        if (e.kind === 'cannonFire') fired.set(e.slot, (fired.get(e.slot) ?? 0) + 1);
        if (e.kind === 'cannonLand') landed.set(e.slot, (landed.get(e.slot) ?? 0) + 1);
      }
    }
    expect(world.race!.phase).toBe('done');
    for (const r of world.race!.racers.values()) {
      expect(fired.get(r.slot) ?? 0, `slot ${r.slot} fired`).toBeGreaterThanOrEqual(laps);
      expect(landed.get(r.slot) ?? 0, `slot ${r.slot} landed`).toBeGreaterThanOrEqual(laps);
      if (difficulty === 'easy') expect(r.finished || r.progress > 0.9 * laps * track.length, `slot ${r.slot}`).toBe(true);
      else expect(r.finished, `slot ${r.slot} finished`).toBe(true);
    }
  }, 60_000);
});
