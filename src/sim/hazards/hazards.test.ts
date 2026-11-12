import { describe, expect, it } from 'vitest';
import { NEUTRAL_INPUT } from '../../shared/protocol';
import { emberPeaks } from '../../track/tracks/emberPeaks';
import type { TrackDef } from '../../track/types';
import { KART, SIM_DT } from '../config';
import { createKart, stepKart, type KartState } from '../kart';
import { Track } from '../track';
import { World } from '../world';
import { cyclePose } from './cycle';
import { Geyser } from './geyser';
import { HazardSystem } from './system';
import type { HazardEvent } from './types';

/** Ember Peaks with the given hazards instead of its own. */
function trackWith(hazards: TrackDef['hazards']): Track {
  return new Track({ ...emberPeaks, hazards });
}
/** One geyser, 7 s period, no phase: warns during 4.3..5.8 s and erupts during 5.8..7.0 s of every cycle. */
const ONE_GEYSER: TrackDef['hazards'] = [{ kind: 'geyser', at: 1.5, offset: 0, period: 7, phase: 0 }];

/** A parked kart standing on the geyser (or `dx` metres to the side of it). */
function parkedKart(track: Track, g: Geyser, dx = 0): KartState {
  const k = createKart(g.x + dx, g.z, 0, g.y);
  k.trackIndex = track.project(g.x, g.z).index;
  return k;
}

/** Run the system and the kart physics together for `seconds` of race time, starting at `t0`. Returns all events. */
function run(system: HazardSystem, track: Track, karts: Map<number, KartState>, t0: number, seconds: number): HazardEvent[] {
  const events: HazardEvent[] = [];
  for (let t = t0; t < t0 + seconds; t += SIM_DT) {
    for (const k of karts.values()) stepKart(k, NEUTRAL_INPUT, track, SIM_DT, KART);
    events.push(...system.step(t, karts, () => KART));
  }
  return events;
}

describe('hazard cycle', () => {
  it('idle -> warn -> active in order, with the warn and active lengths asked for', () => {
    let warn = 0;
    let active = 0;
    let last = '';
    const order: string[] = [];
    for (let t = 0; t < 7; t += 0.01) {
      const p = cyclePose(t, 7, 0, 1.5, 1.2);
      if (p.phase === 'warn') warn += 0.01;
      if (p.phase === 'active') active += 0.01;
      if (p.phase !== last) order.push(p.phase);
      last = p.phase;
    }
    expect(order).toEqual(['idle', 'warn', 'active']);
    expect(warn).toBeCloseTo(1.5, 1);
    expect(active).toBeCloseTo(1.2, 1);
  });

  it('is periodic, pure (same time = same answer) and works for negative times', () => {
    const track = trackWith([{ kind: 'geyser', at: 1.5, offset: 0.5, period: 7, phase: 2.5 }]);
    const g = new HazardSystem(track).list[0];
    for (const t of [-3, -0.4, 0, 1.3, 4.9, 6.99, 20.2]) {
      const a = g.pose(t);
      const b = g.pose(t); // asking twice changes nothing
      expect(b).toEqual(a);
      for (const k of [-2, 1, 3]) {
        const c = g.pose(t + 7 * k);
        expect(c.phase).toBe(a.phase);
        expect(c.t).toBeCloseTo(a.t as number, 6);
      }
    }
  });

  it('the phase shifts the cycle', () => {
    const a = cyclePose(3, 7, 0, 1.5, 1.2);
    const b = cyclePose(3 + 2, 7, 2, 1.5, 1.2);
    expect(b.phase).toBe(a.phase);
    expect(b.t).toBeCloseTo(a.t, 9);
  });
});

describe('geyser hits', () => {
  it('hits a parked kart exactly once per cycle (spin-out and pop), over three cycles', () => {
    const track = trackWith(ONE_GEYSER);
    const system = new HazardSystem(track);
    const g = system.list[0] as Geyser;
    const k = parkedKart(track, g);
    const karts = new Map([[0, k]]);
    const events = run(system, track, karts, 0, 3 * 7);
    const hits = events.filter((e) => e.kind === 'hazardHit');
    expect(hits.length).toBe(3);
    expect(hits[0]).toMatchObject({ kind: 'hazardHit', slot: 0, hazard: 0, type: 'geyser' });
  });

  it('spins the kart out and pops it into the air at the moment of the hit', () => {
    const track = trackWith(ONE_GEYSER);
    const system = new HazardSystem(track);
    const g = system.list[0] as Geyser;
    const k = parkedKart(track, g);
    // Jump straight to the eruption (cycle time 5.8 s = 7 - 1.2).
    expect(g.pose(5.9).phase).toBe('active');
    const events = system.step(5.9, new Map([[0, k]]), () => KART);
    expect(events.map((e) => e.kind)).toContain('hazardHit');
    expect(k.spinTime).toBeGreaterThan(0);
    expect(k.vel.y).toBeGreaterThan(3);
    expect(k.grounded).toBe(false);
    expect(k.invulnTime).toBeGreaterThan(KART.spinTime);
  });

  it('respects hit protection, Nova, respawn carrier and cannon flight', () => {
    const track = trackWith(ONE_GEYSER);
    const system = new HazardSystem(track);
    const g = system.list[0] as Geyser;
    for (const protect of [(k: KartState) => (k.invulnTime = 1), (k: KartState) => (k.starTime = 5), (k: KartState) => (k.respawnTime = 1)]) {
      const k = parkedKart(track, g);
      protect(k);
      const events = system.step(5.9, new Map([[0, k]]), () => KART);
      expect(events.filter((e) => e.kind === 'hazardHit')).toEqual([]);
      expect(k.spinTime).toBe(0);
    }
  });

  it('misses a kart outside its radius, and a kart on a road above it (overpass)', () => {
    const track = trackWith(ONE_GEYSER);
    const system = new HazardSystem(track);
    const g = system.list[0] as Geyser;
    const far = parkedKart(track, g, g.radius + 3); // well outside radius + half a kart
    const above = parkedKart(track, g);
    above.pos.y += 9;
    const events = system.step(5.9, new Map([[0, far], [1, above]]), () => KART);
    expect(events.filter((e) => e.kind === 'hazardHit')).toEqual([]);
    // ...but just inside the radius it does hit.
    const edge = parkedKart(track, g, g.radius - 0.3);
    expect(system.step(5.9, new Map([[0, edge]]), () => KART).filter((e) => e.kind === 'hazardHit').length).toBe(1);
  });

  it('is harmless while idle or warning', () => {
    const track = trackWith(ONE_GEYSER);
    const system = new HazardSystem(track);
    const g = system.list[0] as Geyser;
    for (const t of [0.5, 3.0, 4.6, 5.2]) {
      expect(g.pose(t).phase).not.toBe('active');
      const k = parkedKart(track, g);
      expect(system.step(t, new Map([[0, k]]), () => KART).filter((e) => e.kind === 'hazardHit')).toEqual([]);
    }
  });
});

describe('hazard events', () => {
  it('one warn and one fire per cycle; `near` lists only karts within 150 m of the hazard', () => {
    const track = trackWith(ONE_GEYSER);
    const system = new HazardSystem(track);
    const g = system.list[0] as Geyser;
    const nearKart = parkedKart(track, g);
    nearKart.invulnTime = 99; // keep it out of the lava
    const farPoint = track.pointAt(g.s + 600, 0);
    const farKart = createKart(farPoint.x, farPoint.z, 0, farPoint.y);
    farKart.trackIndex = farPoint.index;
    const karts = new Map([[0, nearKart], [1, farKart]]);
    const events: HazardEvent[] = [];
    for (let t = 0; t < 14; t += SIM_DT) events.push(...system.step(t, karts, () => KART));
    const warns = events.filter((e) => e.kind === 'hazardWarn');
    const fires = events.filter((e) => e.kind === 'hazardFire');
    expect(warns.length).toBe(2);
    expect(fires.length).toBe(2);
    for (const e of [...warns, ...fires]) {
      expect(e).toMatchObject({ type: 'geyser', hazard: 0 });
      expect((e as { near: number[] }).near).toEqual([0]);
    }
  });
});

describe('registry and World', () => {
  it('a track without hazards gives an empty system', () => {
    expect(() => new HazardSystem(trackWith(undefined))).not.toThrow();
  });

  it('World builds the hazards only for tracks that have them and reports hits as events', () => {
    const plain = new Track({ ...emberPeaks, hazards: undefined });
    const w0 = new World(plain, plain);
    w0.startRace([0], 1);
    expect(w0.hazards).toBeNull();

    const track = trackWith(ONE_GEYSER);
    const world = new World(track, track);
    world.startRace([0], 1);
    expect(world.hazards).not.toBeNull();
    // Put the kart on the geyser and jump the race clock to just before an eruption.
    const g = world.hazards!.list[0] as Geyser;
    const k = world.karts.get(0)!;
    Object.assign(k.pos, { x: g.x, y: g.y, z: g.z });
    k.trackIndex = track.project(g.x, g.z).index;
    world.race!.time = 5.75; // racing clock (the countdown is over)
    world.race!.phase = 'racing';
    const kinds: string[] = [];
    for (let i = 0; i < 30; i++) kinds.push(...world.tick(() => NEUTRAL_INPUT).map((e) => e.kind));
    expect(kinds).toContain('hazardFire');
    expect(kinds.filter((x) => x === 'hazardHit').length).toBe(1);
  });
});

describe('bot advice (dangerAhead)', () => {
  it('suggests a free lane when the kart would arrive during an eruption, and nothing when it is safe', () => {
    const track = trackWith(ONE_GEYSER);
    const system = new HazardSystem(track);
    const g = system.list[0] as Geyser;
    // A kart 30 m before the geyser, driving at 20 m/s: arrives about 1.5 s from now.
    const p = track.pointAt(g.s - 30, g.lateral);
    const k = createKart(p.x, p.z, p.heading, p.y);
    k.trackIndex = p.index;
    k.speed = 20;
    const arriveDuringEruption = 5.8 + 0.3 - 1.5; // eruption window is 5.8 .. 7.0
    const bad = system.dangerAhead(k, track, arriveDuringEruption, g.lateral);
    expect(bad.steer !== 0 || bad.brake > 0).toBe(true);
    // Following the advice moves the kart out of the column's lane.
    expect(Math.abs(g.lateral + 0 - (track.project(p.x, p.z, p.index).d + bad.steer))).toBeGreaterThan(g.radius + 0.5);
    const safe = system.dangerAhead(k, track, 0, g.lateral);
    expect(safe).toEqual({ brake: 0, steer: 0 });
  });
});
