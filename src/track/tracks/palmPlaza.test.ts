/**
 * Palm Plaza: the layout, the escalators (timetable, belt effect, guide mascot), the parking-lot cars (hit = flip), the
 * garden (grass, fountain boxes), the store shortcut, and the bots (lane choice, car dodging, finishing).
 */
import { describe, expect, it } from 'vitest';
import { Buttons, type ControlInput } from '../../shared/protocol';
import { autopilot } from '../../sim/autopilot';
import { BotPack, DIFFICULTIES, type Difficulty } from '../../sim/bots';
import { botLoadoutFor } from '../../sim/classes';
import { KART, SIM_DT } from '../../sim/config';
import { Car, CAR_LENGTH } from '../../sim/hazards/car';
import { Escalator, ESCALATOR_SCHEDULE, ESCALATOR_SPEED } from '../../sim/hazards/escalator';
import { createKart, stepKart } from '../../sim/kart';
import { collideWalls } from '../../sim/collision';
import { Track } from '../../sim/track';
import { World } from '../../sim/world';
import type { EscalatorDef } from '../hazardTypes';
import { layoutStats } from '../layoutStats';
import type { TrackDef } from '../types';
import { at, palmPlaza, UPPER } from './palmPlaza';

const track = new Track(palmPlaza);
const escDef = palmPlaza.hazards!.find((h) => h.kind === 'escalator') as EscalatorDef;
const escalatorOf = (t: Track) => new Escalator(0, { ...(t.def.hazards!.find((h) => h.kind === 'escalator') as EscalatorDef) }, t);
const esc = escalatorOf(track);
const minRadius = (curv: number[]) => 1 / Math.max(...curv.map(Math.abs));

describe('Palm Plaza layout', () => {
  it('is about 1.5 km with bends of radius 28 m or more (main road and both deck lanes)', () => {
    expect(track.length).toBeGreaterThan(1400);
    expect(track.length).toBeLessThan(1700);
    expect(minRadius(track.samples.map((p) => p.curvature))).toBeGreaterThanOrEqual(28);
    for (const b of track.branches) expect(minRadius(b.samples.slice(2, -2).map((p) => p.curvature)), `branch ${b.route}`).toBeGreaterThanOrEqual(28);
  });

  it('has two floors: the upper floor at 13 m, the ground floor and the lot at 0, the escalators between them', () => {
    const st = layoutStats(track);
    expect(st.heightRange).toBeGreaterThanOrEqual(12);
    expect(track.pointAt(track.sAt(at('storeA'))).y).toBeCloseTo(UPPER, 0);
    expect(track.pointAt(track.sAt(at('fountain'))).y).toBeCloseTo(0, 0);
    // Both escalator lanes go DOWN the same 13 m over the same stretch.
    const lane0 = [esc.laneMiddle(0), track.pointAt(esc.s0), track.pointAt(esc.s1)];
    expect(lane0[1].y - lane0[2].y).toBeGreaterThan(10);
    const b = track.branches[esc.branchRoute - 1];
    expect(b.samples[esc.b0].y - b.samples[esc.b1].y).toBeGreaterThan(10);
    expect(Math.abs(esc.laneMiddle(0).y - esc.laneMiddle(1).y)).toBeLessThan(0.6);
    // ...side by side, with room for the mascot between them, and the same length (neither is a shortcut).
    const gap = Math.hypot(esc.laneMiddle(0).x - esc.laneMiddle(1).x, esc.laneMiddle(0).z - esc.laneMiddle(1).z);
    expect(gap).toBeGreaterThan(palmPlaza.width + 6);
    expect(gap).toBeLessThan(palmPlaza.width + 16);
    expect(Math.abs(b.length - b.span) / b.span).toBeLessThan(0.03);
  });

  it('the store aisle (shortcut) is clearly shorter than the main road round the store, and walled like a shop', () => {
    const b = track.branches[0];
    expect(b.def.deck).toBe(true);
    expect(b.span - b.length).toBeGreaterThan(15);
    expect(b.samples.some((p) => p.wallLeft) && b.samples.some((p) => p.wallRight)).toBe(true);
  });

  it('grass patches in the garden slow you; the fountain row of item boxes floats over the pool', () => {
    expect(track.grassPatches.length).toBeGreaterThanOrEqual(4);
    for (const g of track.grassPatches) {
      const p = track.pointAt((g.s0 + g.s1) / 2, (g.d0 + g.d1) / 2);
      expect(track.sample(p.x, p.z, p.index)!.surface).toBe('offroad');
    }
    const fountain = track.ramps[0];
    const floating = track.itemBoxes.filter((bx) => track.deltaS(fountain.s0, bx.s) > 0 && track.deltaS(bx.s, fountain.s0 + 30) > 0);
    expect(floating.length).toBe(4);
    for (const bx of floating) expect(bx.y - track.pointAt(bx.s).y).toBeGreaterThan(1.5);
  });

  it('the parking lot has boost pads on the car lanes', () => {
    const cars = palmPlaza.hazards!.filter((h) => h.kind === 'car').map((h) => track.sAt(h.at));
    expect(cars.length).toBeGreaterThanOrEqual(3);
    const covered = cars.filter((s) => track.boostPads.some((p) => track.deltaS(p.s0, s) >= -1 && track.deltaS(s, p.s1) >= -1));
    expect(covered.length).toBe(cars.length);
  });
});

describe('escalators', () => {
  it('follow a fixed, repeating timetable: one with, one against, and pauses when both stop', () => {
    const cycle = ESCALATOR_SCHEDULE.reduce((a, s) => a + s[2], 0);
    for (const t of [0.3, 7.7, 14.2, 29.9, 33.3, 47.5]) {
      const { travel: _a, ...p1 } = esc.pose(t);
      const { travel: _b, ...p2 } = esc.pose(t + cycle);
      expect(p1.dirs).toEqual(p2.dirs);
      expect(p1.phase).toBe(p2.phase);
      expect(p1.changeIn).toBeCloseTo(p2.changeIn, 6);
      expect(esc.velocity(0, t)).toBeCloseTo(esc.velocity(0, t + 3 * cycle), 6);
    }
    let both = 0;
    let split = 0;
    for (let t = 0; t < cycle; t += 0.25) {
      const p = esc.pose(t);
      if (p.dirs[0] === 0 && p.dirs[1] === 0) both++;
      else {
        expect(p.dirs[0]).toBe(-p.dirs[1]); // one helps, one hinders
        split++;
      }
      expect(Math.abs(p.lanes[0])).toBeLessThanOrEqual(ESCALATOR_SPEED + 1e-9);
    }
    expect(both / (both + split)).toBeGreaterThan(0.1);
    expect(both / (both + split)).toBeLessThan(0.3);
  });

  it('the belt travel is the integral of the belt speed (the drawn steps never jump)', () => {
    for (const lane of [0, 1] as const) {
      for (let t = -3; t < 130; t += 0.37) {
        const dt = 0.01;
        expect((esc.travel(lane, t + dt) - esc.travel(lane, t)) / dt).toBeCloseTo((esc.velocity(lane, t) + esc.velocity(lane, t + dt)) / 2, 1);
      }
    }
  });

  it('riding WITH the belt is ~30 % faster, AGAINST it ~30 % slower, stopped in between', () => {
    /** Seconds a gas-only kart (autopilot steering, main lane) takes from the top to the bottom with the main belt fixed at `dir`. */
    const ride = (dir: number): number => {
      const def: TrackDef = { ...palmPlaza, hazards: [{ ...escDef, schedule: [[dir, -dir, 1e6]] }] };
      const t = new Track(def);
      const e = escalatorOf(t);
      const start = t.pointAt(e.s0 - 50);
      const k = createKart(start.x, start.z, start.heading, start.y);
      k.trackIndex = start.index;
      k.speed = 25;
      let t0 = -1;
      for (let i = 0; i < 60 * 20; i++) {
        const time = i * SIM_DT;
        stepKart(k, { ...autopilot(k, t, { pace: 1, lane: 0, shortcutBias: 0 }), buttons: Buttons.GAS }, t, SIM_DT);
        collideWalls(k, t);
        k.trackIndex = t.project(k.pos.x, k.pos.z, k.trackIndex).index;
        e.affect(k, time, SIM_DT, KART);
        const p = t.project(k.pos.x, k.pos.z, k.trackIndex);
        if (t0 < 0 && t.deltaS(e.s0, p.s) >= 0) t0 = time;
        if (t0 >= 0 && t.deltaS(e.s1, p.s) >= 0) return time - t0;
      }
      return Infinity;
    };
    const withIt = ride(1);
    const stopped = ride(0);
    const against = ride(-1);
    if (process.env.PRINT_LAPS) console.log('escalator ride (s): with', withIt.toFixed(2), 'stopped', stopped.toFixed(2), 'against', against.toFixed(2));
    expect(withIt).toBeLessThan(stopped * 0.85);
    expect(withIt).toBeGreaterThan(stopped * 0.65);
    expect(against).toBeGreaterThan(stopped * 1.2);
    expect(against).toBeLessThan(stopped * 1.6);
  });

  it('carries a kart that stands on it, but not one in the air, respawning or off the moving part', () => {
    const mid = esc.laneMiddle(0);
    const p = track.project(mid.x, mid.z);
    const k = createKart(mid.x, mid.z, Math.atan2(mid.tx, mid.tz), mid.y);
    k.trackIndex = p.index;
    // Find a moment when the main belt runs with the traffic.
    let t = 0;
    while (esc.velocity(0, t) < ESCALATOR_SPEED - 1e-6) t += 0.5;
    expect(esc.affect(k, t, SIM_DT, KART)).toBe('push');
    const moved = (k.pos.x - mid.x) * mid.tx + (k.pos.z - mid.z) * mid.tz;
    expect(moved).toBeCloseTo(ESCALATOR_SPEED * SIM_DT, 5);
    const air = { ...createKart(mid.x, mid.z, 0, mid.y), grounded: false, trackIndex: p.index };
    expect(esc.affect(air, t, SIM_DT, KART)).toBeNull();
    const start = track.pointAt(0);
    expect(esc.affect({ ...createKart(start.x, start.z, 0, start.y), trackIndex: start.index }, t, SIM_DT, KART)).toBeNull();
  });

  it('the guide mascot stands between the lanes and points at the lane that runs with the traffic; it waves before a change', () => {
    const a = esc.laneMiddle(0);
    const b = esc.laneMiddle(1);
    let pointed = 0;
    let waved = 0;
    for (let t = 0; t < 61; t += 0.5) {
      const m = esc.mascot(t);
      expect(Math.hypot(m.x - (a.x + b.x) / 2, m.z - (a.z + b.z) / 2)).toBeLessThan(0.01);
      const p = esc.pose(t);
      if (!m.target) {
        expect(p.dirs[0] <= 0 && p.dirs[1] <= 0).toBe(true);
        continue;
      }
      pointed++;
      // The lane it points at is the one whose belt runs with the traffic: the faster one.
      const lane = Math.hypot(m.target.x - a.x, m.target.z - a.z) < 1 ? 0 : 1;
      expect(p.dirs[lane]).toBe(1);
      expect(p.dirs[1 - lane]).toBeLessThan(1);
      if (m.wave) {
        waved++;
        expect(p.changeIn).toBeLessThanOrEqual(2.5);
      }
    }
    expect(pointed).toBeGreaterThan(60);
    expect(waved).toBeGreaterThan(5);
  });
});

describe('parking-lot cars', () => {
  const cars = track.def.hazards!.map((h, i) => [h, i] as const).filter(([h]) => h.kind === 'car').map(([h, i]) => new Car(i, h as Extract<typeof h, { kind: 'car' }>, track));

  it('drive across the road from gate to gate (pure function of the clock), hidden in between', () => {
    for (const c of cars) {
      for (const t of [0.4, 3.3, 8.8]) {
        expect(c.pose(t).phase).toBe(c.pose(t + c.period * 3).phase);
        expect(c.cars(t)[0].lat).toBeCloseTo(c.cars(t + c.period * 3)[0].lat, 6);
      }
      let seen = false;
      let hidden = false;
      for (let t = 0; t < c.period; t += 0.1) {
        const car = c.cars(t)[0];
        if (car.visible) {
          seen = true;
          expect(Math.abs(car.lat)).toBeLessThanOrEqual(c.reach + 1e-9);
        } else hidden = true;
      }
      expect(seen && hidden).toBe(true);
    }
  });

  it('a kart that hits a car is flipped (spin-out and a hop); a Nova kart drives through', () => {
    const c = cars[0];
    // A moment when the car is in the middle of the road.
    let t = 0;
    while (Math.abs(c.cars(t)[0].lat) > 0.5 || !c.cars(t)[0].visible) t += 0.01;
    const car = c.cars(t)[0];
    const k = createKart(car.x + car.fz * 0.5, car.z - car.fx * 0.5, 0, car.y);
    k.trackIndex = track.project(k.pos.x, k.pos.z).index;
    expect(c.affect(k, t, SIM_DT, KART)).toBe('hit');
    expect(k.spinTime).toBeGreaterThan(0);
    expect(k.vel.y).toBeGreaterThan(5);
    expect(k.grounded).toBe(false);
    // Just hit: invulnerable, so only pushed out, not hit again.
    expect(c.affect(k, t, SIM_DT, KART)).not.toBe('hit');
    const nova = { ...createKart(car.x, car.z, 0, car.y), starTime: 3 };
    expect(c.affect(nova, t, SIM_DT, KART)).toBeNull();
    // Far from any car: nothing.
    const far = createKart(car.x + car.fx * (CAR_LENGTH + 6), car.z + car.fz * (CAR_LENGTH + 6), 0, car.y);
    expect(c.affect(far, t, SIM_DT, KART)).toBeNull();
  });
});

/** A race of 4 bots of one difficulty on Palm Plaza; counts respawns, car hits and the escalator lanes taken. */
function race(difficulty: Difficulty, laps = 3) {
  const world = new World(track, track);
  const slots = [0, 1, 2, 3];
  world.startRace(slots, laps, new Map(slots.map((s) => [s, botLoadoutFor(s)])));
  const pack = new BotPack(difficulty);
  const respawns = new Map<number, number>();
  let carHits = 0;
  /** Escalator rides: was the lane taken the better one (by the average belt speed while on it)? */
  const riding = new Map<number, { lane: number; sum: [number, number]; n: number }>();
  const rides: { good: boolean; equal: boolean }[] = [];
  let ticks = 0;
  while (world.race!.phase !== 'done' && ticks < 60 * 400) {
    const ev = world.tick((slot): ControlInput => pack.input(world, slot));
    for (const e of ev as { kind: string; slot: number; type?: string }[]) {
      if (e.kind === 'respawn') respawns.set(e.slot, (respawns.get(e.slot) ?? 0) + 1);
      if (e.kind === 'hazardHit' && e.type === 'car') carHits++;
    }
    if (world.race!.phase === 'racing') {
      for (const [slot, k] of world.karts) {
        const on = esc.laneAt(k);
        const r = riding.get(slot);
        if (on && k.grounded) {
          const t = world.race!.time;
          const cur = r ?? { lane: on.lane, sum: [0, 0] as [number, number], n: 0 };
          cur.sum[0] += esc.velocity(0, t);
          cur.sum[1] += esc.velocity(1, t);
          cur.n++;
          riding.set(slot, cur);
        } else if (r && !on && r.n > 30) {
          riding.delete(slot);
          const mine = r.sum[r.lane] / r.n;
          const other = r.sum[1 - r.lane] / r.n;
          rides.push({ good: mine >= other - 0.5, equal: Math.abs(mine - other) < 0.5 });
        }
      }
    }
    ticks++;
  }
  return { world, respawns, carHits, rides };
}

describe('Palm Plaza bots', () => {
  const results = new Map<Difficulty, ReturnType<typeof race>>();
  const get = (d: Difficulty) => {
    if (!results.has(d)) results.set(d, race(d));
    return results.get(d)!;
  };

  it.each(DIFFICULTIES)('%s bots finish 3 laps without falling off', (d) => {
    const r = get(d);
    expect(r.world.race!.phase).toBe('done');
    for (const racer of r.world.race!.racers.values()) {
      expect(racer.finished || racer.progress > track.length * 3 * 0.9, `slot ${racer.slot}`).toBe(true);
      expect(r.respawns.get(racer.slot) ?? 0, `slot ${racer.slot} respawns`).toBeLessThanOrEqual(1);
    }
  }, 120_000);

  it('hard bots nearly always ride the escalator that runs their way; easy bots often do not', () => {
    const hard = get('hard').rides.filter((r) => !r.equal);
    const easy = get('easy').rides.filter((r) => !r.equal);
    expect(hard.length).toBeGreaterThanOrEqual(6);
    const share = (rs: { good: boolean }[]) => rs.filter((r) => r.good).length / Math.max(1, rs.length);
    if (process.env.PRINT_LAPS) console.log('escalator picks: hard', share(hard).toFixed(2), 'of', hard.length, 'easy', share(easy).toFixed(2), 'of', easy.length, 'normal', share(get('normal').rides.filter((r) => !r.equal)).toFixed(2));
    expect(share(hard)).toBeGreaterThanOrEqual(0.85);
    expect(share(easy)).toBeLessThan(share(hard));
  }, 120_000);

  it('hard bots dodge the parking-lot cars better than easy bots', () => {
    if (process.env.PRINT_LAPS) console.log('car hits (4 bots, 3 laps): easy', get('easy').carHits, 'normal', get('normal').carHits, 'hard', get('hard').carHits);
    expect(get('hard').carHits).toBeLessThanOrEqual(get('easy').carHits);
    expect(get('hard').carHits).toBeLessThanOrEqual(4);
  }, 120_000);

  it('a normal bot laps in about 50 to 57 s', () => {
    const world = new World(track, track);
    world.startRace([1], 1, new Map([[1, botLoadoutFor(1)]]));
    const pack = new BotPack('normal');
    let ticks = 0;
    while (!world.race!.racers.get(1)!.finished && ticks < 60 * 120) {
      world.tick((slot) => pack.input(world, slot));
      ticks++;
    }
    const lap = world.race!.racers.get(1)!.finishTime!;
    if (process.env.PRINT_LAPS) console.log('normal bot lap', lap.toFixed(1));
    expect(lap).toBeGreaterThan(48);
    expect(lap).toBeLessThan(58);
  }, 60_000);
});
