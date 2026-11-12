/** Tests of the rolling snowballs (src/sim/hazards/roller.ts) on Switchback Summit. */
import { describe, expect, it } from 'vitest';
import { NEUTRAL_INPUT } from '../../shared/protocol';
import { switchbackSummit } from '../../track/tracks/switchbackSummit';
import type { TrackDef } from '../../track/types';
import { BotPack, DIFFICULTIES, type Difficulty } from '../bots';
import { botLoadoutFor } from '../classes';
import { KART, SIM_DT } from '../config';
import { createKart, stepKart, type KartState } from '../kart';
import { Track } from '../track';
import { World } from '../world';
import { Roller } from './roller';
import { HazardSystem } from './system';
import type { HazardEvent } from './types';

/** Switchback Summit with the given hazards instead of its own. */
function trackWith(hazards: TrackDef['hazards']): Track {
  return new Track({ ...switchbackSummit, hazards });
}
/** One ball (period 8 s, no phase), starting from the slope side of Switchback. */
const ONE_BALL: TrackDef['hazards'] = [{ kind: 'roller', at: 61, period: 8, phase: 0, from: -1 }];

const num = (v: unknown) => Number(v);

/** Seconds (within one period) during which the ball is over the road (|lateral| < half the road width). */
function secondsOnRoad(r: Roller, half: number): number {
  let n = 0;
  for (let t = 0; t < 8; t += 0.005) {
    const p = r.pose(t);
    if (p.present && Math.abs(num(p.lat)) < half) n += 0.005;
  }
  return n;
}

/** A kart parked on the road at distance `s` (lateral `d`). */
function parked(track: Track, s: number, d: number): KartState {
  const p = track.pointAt(s, d);
  const k = createKart(p.x, p.z, p.heading, p.y);
  k.trackIndex = p.index;
  return k;
}

/** Run kart physics and the system together; returns all events. */
function run(system: HazardSystem, track: Track, karts: Map<number, KartState>, t0: number, seconds: number): HazardEvent[] {
  const events: HazardEvent[] = [];
  for (let t = t0; t < t0 + seconds; t += SIM_DT) {
    for (const k of karts.values()) stepKart(k, NEUTRAL_INPUT, track, SIM_DT, KART);
    events.push(...system.step(t, karts, () => KART));
  }
  return events;
}

describe('roller pose', () => {
  it('is periodic and pure, also for negative times', () => {
    const track = trackWith([{ kind: 'roller', at: 61, period: 8, phase: 2.5, from: -1 }]);
    const r = new HazardSystem(track).list[0];
    for (const t of [-3, -0.4, 0, 1.3, 4.9, 7.99, 20.2]) {
      const a = r.pose(t);
      expect(r.pose(t)).toEqual(a); // asking twice changes nothing
      for (const n of [-2, 1, 3]) {
        const b = r.pose(t + 8 * n);
        expect(b.phase).toBe(a.phase);
        expect(b.present).toBe(a.present);
        if (a.present) {
          expect(num(b.lat)).toBeCloseTo(num(a.lat), 6);
          expect(num(b.radius)).toBeCloseTo(num(a.radius), 6);
        }
      }
    }
  });

  it('warns about 1.5 s up the slope, then crosses the road in 1.2 to 2 s, growing as it rolls', () => {
    const track = trackWith(ONE_BALL);
    const r = new HazardSystem(track).list[0] as Roller;
    const half = track.def.width / 2;
    let warn = 0;
    let first: ReturnType<Roller['pose']> | null = null;
    let last: ReturnType<Roller['pose']> | null = null;
    for (let t = 0; t < 8; t += 0.005) {
      const p = r.pose(t);
      if (p.phase === 'warn') warn += 0.005;
      if (p.present) {
        first ??= p;
        last = p;
      }
    }
    expect(warn).toBeCloseTo(1.5, 1);
    const onRoad = secondsOnRoad(r, half);
    expect(onRoad).toBeGreaterThan(1.2);
    expect(onRoad).toBeLessThan(2);
    // Starts on the slope side (negative lateral here), beyond the road edge; ends on the far side.
    expect(num(first!.lat)).toBeLessThan(-half);
    expect(num(last!.lat)).toBeGreaterThan(half - 1);
    expect(num(last!.radius)).toBeGreaterThan(num(first!.radius));
    expect(num(first!.radius)).toBeGreaterThan(1.4);
    expect(num(last!.radius)).toBeLessThan(2);
    // It bursts at the very end of the cycle and there is no ball (no collider) until the next one.
    expect(num(r.pose(7.99).burst)).toBeGreaterThan(0.9);
    expect(r.pose(0.5).present).toBe(false);
  });
});

describe('roller hits', () => {
  it('hits a kart parked in its path once per pass (spin-out and a shove), over three cycles', () => {
    const track = trackWith(ONE_BALL);
    const system = new HazardSystem(track);
    const r = system.list[0] as Roller;
    const k = parked(track, r.s, 0);
    const events = run(system, track, new Map([[0, k]]), 0, 3 * 8);
    const hits = events.filter((e) => e.kind === 'hazardHit');
    expect(hits.length).toBe(3);
    expect(hits[0]).toMatchObject({ slot: 0, hazard: 0, type: 'roller' });
  });

  it('shoves the kart the way the ball rolls', () => {
    const track = trackWith(ONE_BALL);
    const system = new HazardSystem(track);
    const r = system.list[0] as Roller;
    const k = parked(track, r.s, 0);
    // Find the moment the ball is at the road centre and hit then.
    let t = 0;
    while (Math.abs(num(r.pose(t).lat ?? 99)) > 0.2) t += 0.005;
    const events = system.step(t, new Map([[0, k]]), () => KART);
    expect(events.map((e) => e.kind)).toContain('hazardHit');
    expect(k.spinTime).toBeGreaterThan(0);
    expect(k.vel.x * r.dirX + k.vel.z * r.dirZ).toBeGreaterThan(3);
  });

  it('is not hit while the ball is elsewhere', () => {
    const track = trackWith(ONE_BALL);
    const system = new HazardSystem(track);
    const r = system.list[0] as Roller;
    // Ball at the road centre vs a kart on the other edge (7 m away), and a kart in the middle when there is no ball at all.
    let t = 0;
    while (Math.abs(num(r.pose(t).lat ?? 99)) > 0.2) t += 0.005;
    const edge = parked(track, r.s, 6);
    expect(system.step(t, new Map([[0, edge]]), () => KART).filter((e) => e.kind === 'hazardHit')).toEqual([]);
    const middle = parked(track, r.s, 0);
    expect(r.pose(0.5).present).toBe(false);
    expect(system.step(0.5, new Map([[0, middle]]), () => KART).filter((e) => e.kind === 'hazardHit')).toEqual([]);
  });

  it('never hits a kart far beside the path (along the road) or far above or below it', () => {
    const track = trackWith(ONE_BALL);
    const system = new HazardSystem(track);
    const r = system.list[0] as Roller;
    const ahead = parked(track, r.s + 10, 0);
    const behind = parked(track, r.s - 10, 0);
    const above = parked(track, r.s, 0);
    above.pos.y += 8;
    const karts = new Map([[0, ahead], [1, behind]]);
    expect(run(system, track, karts, 0, 3 * 8).filter((e) => e.kind === 'hazardHit')).toEqual([]);
    let t = 0;
    while (Math.abs(num(r.pose(t).lat ?? 99)) > 0.2) t += 0.005;
    expect(system.step(t, new Map([[0, above]]), () => KART).filter((e) => e.kind === 'hazardHit')).toEqual([]);
  });

  it('respects hit protection, Nova, respawn carrier and cannon flight', () => {
    const track = trackWith(ONE_BALL);
    const system = new HazardSystem(track);
    const r = system.list[0] as Roller;
    let t = 0;
    while (Math.abs(num(r.pose(t).lat ?? 99)) > 0.2) t += 0.005;
    for (const protect of [(k: KartState) => (k.invulnTime = 1), (k: KartState) => (k.starTime = 5), (k: KartState) => (k.respawnTime = 1)]) {
      const k = parked(track, r.s, 0);
      protect(k);
      expect(system.step(t, new Map([[0, k]]), () => KART).filter((e) => e.kind === 'hazardHit')).toEqual([]);
      expect(k.spinTime).toBe(0);
    }
  });
});

describe('roller bot advice', () => {
  it('moves or brakes for a ball that will be on the bot\'s lane when it arrives, and is quiet otherwise', () => {
    const track = trackWith(ONE_BALL);
    const system = new HazardSystem(track);
    const r = system.list[0] as Roller;
    const k = parked(track, r.s - 30, 0);
    k.speed = 20; // arrives in about 1.5 s
    // Pick a "now" so that the ball is at the road centre when the kart gets there.
    let t = 0;
    while (Math.abs(num(r.pose(t).lat ?? 99)) > 0.2) t += 0.005;
    const bad = system.dangerAhead(k, track, t - 1.5, 0);
    expect(bad.steer !== 0 || bad.brake > 0).toBe(true);
    expect(system.dangerAhead(k, track, 0.2, 0)).toEqual({ brake: 0, steer: 0 }); // no ball at all
  });
});

describe('Switchback Summit with snowballs', () => {
  function raceOfBots(difficulty: Difficulty) {
    const track = new Track(switchbackSummit);
    const world = new World(track, track);
    const slots = [0, 1, 2, 3];
    world.startRace(slots, track.def.laps, new Map(slots.map((s) => [s, botLoadoutFor(s)])));
    const pack = new BotPack(difficulty);
    let hits = 0;
    let ticks = 0;
    while (world.race!.phase !== 'done' && ticks < 60 * 420) {
      hits += world.tick((slot) => pack.input(world, slot)).filter((e) => e.kind === 'hazardHit').length;
      ticks++;
    }
    return { world, hits };
  }

  it('has the snowballs on the downhill', () => {
    const world = new World(new Track(switchbackSummit), new Track(switchbackSummit));
    world.startRace([0], 1);
    expect(world.hazards!.list.length).toBeGreaterThanOrEqual(3);
    expect(world.hazards!.list.every((h) => h.kind === 'roller')).toBe(true);
  });

  it.each(DIFFICULTIES)('4 %s bots finish the race', (difficulty) => {
    const { world, hits } = raceOfBots(difficulty);
    const racers = [...world.race!.racers.values()];
    expect(racers.some((r) => r.finished)).toBe(true);
    if (difficulty !== 'easy') for (const r of racers) expect(r.finished, `slot ${r.slot}`).toBe(true);
    // Bots mostly avoid the balls (measured: 0 to 1 hits per race); allow a few.
    if (difficulty === 'hard') expect(hits).toBeLessThanOrEqual(6);
  }, 120_000);
});
