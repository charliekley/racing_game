import { describe, expect, it } from 'vitest';
import { NEUTRAL_INPUT } from '../../shared/protocol';
import { cloudGarden } from '../../track/tracks/cloudGarden';
import { autopilot, botStyleFor } from '../autopilot';
import { KART, SIM_DT } from '../config';
import { createKart, stepKart, type KartState } from '../kart';
import { Track } from '../track';
import { cyclePose } from './cycle';
import { Gust, gustEnvelope } from './gust';
import { HazardSystem } from './system';

// The unit tests below use fixed gust timings (period 9/10/11) so they test the mechanism, not the
// track's current tuning (cloudGarden.ts may change its periods freely).
const track = new Track({
  ...cloudGarden,
  hazards: [
    { kind: 'gust', from: 11.2, to: 14.9, dir: 1, strength: 42, period: 9, phase: 2 },
    { kind: 'gust', from: 49.2, to: 53.8, dir: -1, strength: 42, period: 10, phase: 6 },
    { kind: 'gust', from: 78.1, to: 82.9, dir: 1, strength: 42, period: 11, phase: 4 },
  ],
});
const system = new HazardSystem(track);
const gusts = system.list as Gust[];
const ground = system.wrapGround(track);
// Gust 0 (bridge 1): period 9, phase 2, warn 1.5, active 1.5 -> idle 2..8, warn 8..9.5, active 9.5..11 (time = phase + cycle clock 6 + ...).
const G = gusts[0];
const T_IDLE = 5;
const T_WARN = 8.7;
const T_ACTIVE = 10.2;

/** A parked kart on the gust's stretch at lateral offset `d`. */
function parked(g: Gust, d = 0, along = 0.5): KartState {
  const p = track.pointAt(g.s0 + (g.s1 - g.s0) * along, d);
  const k = createKart(p.x, p.z, p.heading, track.sample(p.x, p.z)!.height);
  k.grounded = true;
  k.trackIndex = p.index;
  return k;
}
const lateralOf = (k: KartState) => track.project(k.pos.x, k.pos.z, k.trackIndex).d;

describe('gust pose', () => {
  it('has the three gusts on the three bridges, alternating directions and different phases', () => {
    expect(gusts.length).toBe(3);
    expect(gusts.map((g) => g.dir)).toEqual([1, -1, 1]);
    expect(new Set(gusts.map((g) => g.pose(0).phase + String(g.s))).size).toBe(3);
    // Bridge ranges (control-point units 11-15, 49-54, 85-90): the stretches lie on them.
    for (const g of gusts) expect(track.onBridge(g.s)).toBe(true);
  });

  it('is periodic and pure, also for negative times', () => {
    for (const g of gusts) {
      for (const t of [-4.2, 0, 1.1, 8.9, 10.4, 17.7]) {
        const a = g.pose(t);
        expect(g.pose(t)).toEqual(a);
        const b = g.pose(t + 5 * (g === gusts[0] ? 9 : g === gusts[1] ? 10 : 11));
        expect(b.phase).toBe(a.phase);
        expect(b.wind as number).toBeCloseTo(a.wind as number, 9);
      }
    }
  });

  it('idle -> warn (1.5 s) -> active (1.5 s) in order, wind only while active, fading in and out', () => {
    let warn = 0;
    let active = 0;
    const order: string[] = [];
    for (let t = 0; t < 9; t += 0.01) {
      const p = G.pose(2 + t);
      if (p.phase === 'warn') warn += 0.01;
      if (p.phase === 'active') active += 0.01;
      if (order[order.length - 1] !== p.phase) order.push(p.phase as string);
      if (p.phase !== 'active') expect(p.wind).toBe(0);
    }
    expect(order).toEqual(['idle', 'warn', 'active']);
    expect(warn).toBeCloseTo(1.5, 1);
    expect(active).toBeCloseTo(1.5, 1);
    expect(gustEnvelope(0)).toBe(0);
    expect(gustEnvelope(0.5)).toBe(1);
    expect(gustEnvelope(1)).toBe(0);
    expect(cyclePose(T_ACTIVE, 9, 2, 1.5, 1.5).phase).toBe('active');
  });
});

describe('gust push', () => {
  it('pushes only while active: nothing while idle or warning, a sideways push to the gust direction while active', () => {
    for (const t of [T_IDLE, T_WARN]) {
      const k = parked(G);
      system.step(t, new Map([[0, k]]), () => KART);
      expect(Math.hypot(k.vel.x, k.vel.z)).toBe(0);
    }
    for (const g of gusts) {
      // Find a time in the middle of this gust's active phase.
      let t = 0;
      while (g.pose(t).phase !== 'active' || (g.pose(t).t as number) < 0.45) t += 0.01;
      const k = parked(g);
      system.step(t, new Map([[0, k]]), () => KART);
      expect(Math.hypot(k.vel.x, k.vel.z)).toBeGreaterThan(0);
      // The push points to the right of the road for dir +1, to the left for dir -1.
      const p = track.pointAt(g.s);
      const r = { x: -Math.cos(p.heading), z: Math.sin(p.heading) };
      expect(Math.sign(k.vel.x * r.x + k.vel.z * r.z)).toBe(g.dir);
      expect(Math.hypot(k.vel.x, k.vel.z)).toBeCloseTo(g.strength * SIM_DT, 1);
    }
  });

  it('pushes only on its stretch (not before, not after), not karts on another level, not karts being carried', () => {
    const before = parked(G, 0, 0);
    const bp = track.pointAt(G.s0 - 25);
    Object.assign(before.pos, { x: bp.x, z: bp.z });
    before.trackIndex = bp.index;
    const after = parked(G);
    const ap = track.pointAt(G.s1 + 25);
    Object.assign(after.pos, { x: ap.x, z: ap.z });
    after.trackIndex = ap.index;
    const above = parked(G);
    above.pos.y += 12; // an overpass
    const carried = parked(G);
    carried.respawnTime = 1;
    const inside = parked(G);
    const events = system.step(T_ACTIVE, new Map([[0, before], [1, after], [2, above], [3, carried], [4, inside]]), () => KART);
    for (const k of [before, after, above, carried]) expect(Math.hypot(k.vel.x, k.vel.z)).toBe(0);
    expect(Math.hypot(inside.vel.x, inside.vel.z)).toBeGreaterThan(0);
    expect(events.filter((e) => e.kind === 'hazardHit')).toEqual([]); // wind is not a "hit"
  });

  it('other gusts do not push on this bridge', () => {
    // Bridge 1 at the time gust 0 is active: gusts 1 and 2 are elsewhere and (whatever their phase) must not push here.
    const sys = new HazardSystem(track);
    const k = parked(G);
    for (const g of sys.list.slice(1)) expect(g.affect(k, T_ACTIVE, SIM_DT, KART)).toBeNull();
  });

  it('warn and fire events go to karts near the gust', () => {
    const sys = new HazardSystem(track);
    const k = parked(G);
    k.invulnTime = 99;
    const evs = [];
    for (let t = 0; t < 12; t += SIM_DT) evs.push(...sys.step(t, new Map([[0, k]]), () => KART));
    const warn = evs.find((e) => e.kind === 'hazardWarn' && e.hazard === 0);
    expect(warn).toMatchObject({ type: 'gust', near: [0] });
    expect(evs.some((e) => e.kind === 'hazardFire' && e.hazard === 0)).toBe(true);
  });
});

describe('gust strength: matters, but never an unavoidable fall', () => {
  /** Drop depth of a kart that sits on the bridge and gets no steering input while the gust blows. */
  function unsteered(d0: number) {
    const k = parked(G, d0);
    const karts = new Map([[0, k]]);
    let fell = false;
    for (let t = T_ACTIVE - 1; t < T_ACTIVE + 2.5; t += SIM_DT) {
      stepKart(k, NEUTRAL_INPUT, ground, SIM_DT, KART);
      system.step(t, karts, () => KART);
      const p = track.project(k.pos.x, k.pos.z, k.trackIndex);
      if (k.pos.y < p.y - 1) fell = true;
    }
    return { fell, d: lateralOf(k) };
  }

  it('an unsteered kart from the middle is carried about 5 m, and stays on the deck', () => {
    const r = unsteered(0);
    expect(r.fell).toBe(false);
    expect(r.d).toBeGreaterThan(3);
    expect(r.d).toBeLessThan(6.5); // the deck is +-8.2 m
  });

  it('an unsteered kart on the downwind half goes over the edge, one on the upwind half does not', () => {
    expect(unsteered(4.5).fell).toBe(true);
    expect(unsteered(-4.5).fell).toBe(false);
  });

  it('a kart that follows the road with the bot autopilot (steering into the wind) crosses the gusting bridge on every lane without falling', () => {
    const style = botStyleFor(1);
    for (const lane of [-4, 0, 4]) {
      // Arrive on the bridge just as the gust blows, at full speed.
      const p0 = track.pointAt(G.s0 - 20, lane);
      const k = createKart(p0.x, p0.z, p0.heading, track.sample(p0.x, p0.z)!.height);
      k.grounded = true;
      k.trackIndex = p0.index;
      k.speed = KART.maxSpeed;
      const karts = new Map([[0, k]]);
      let maxD = 0;
      let fell = false;
      for (let t = T_ACTIVE - 1.2; t < T_ACTIVE + 3; t += SIM_DT) {
        stepKart(k, autopilot(k, track, { ...style, lane }, KART), ground, SIM_DT, KART);
        system.step(t, karts, () => KART);
        const p = track.project(k.pos.x, k.pos.z, k.trackIndex);
        if (k.pos.y < p.y - 1) fell = true;
        if (track.deltaS(G.s0, p.s) > 0 && track.deltaS(p.s, G.s1) > 0) maxD = Math.max(maxD, Math.abs(p.d));
      }
      expect(fell, `lane ${lane}`).toBe(false);
      expect(maxD, `lane ${lane}`).toBeLessThan(8);
    }
  });
});

describe('gust and bots', () => {
  it('while the wind blows (or is about to) the downwind half is dangerous and the upwind half is free', () => {
    for (const t of [T_WARN, T_ACTIVE]) {
      expect(G.danger(G.s, 0, t, 0)).toBe(1);
      expect(G.danger(G.s, 4, t, 0)).toBe(1); // dir +1 pushes right: the right side is downwind
      expect(G.danger(G.s, -3, t, 0)).toBe(0);
    }
    expect(G.danger(G.s, 4, T_IDLE, 0)).toBe(0);
    // The other direction mirrors it.
    const g1 = gusts[1];
    let t = 0;
    while (g1.pose(t).phase !== 'active') t += 0.05;
    expect(g1.danger(g1.s, -4, t, 0)).toBe(1);
    expect(g1.danger(g1.s, 3, t, 0)).toBe(0);
  });

  it('dangerAhead tells a kart in the middle of the lane to move to the upwind side, from before the stretch to its end', () => {
    for (const back of [30, 0, -(G.s1 - G.s0) / 2]) {
      const p = track.pointAt(G.s0 - back, 0);
      const k = createKart(p.x, p.z, p.heading, p.y);
      k.trackIndex = p.index;
      k.speed = 25;
      const advice = system.dangerAhead(k, track, T_WARN, 0);
      expect(advice.steer, `back ${back}`).toBeLessThan(0); // upwind of a +1 gust = left
      expect(advice.brake).toBe(0);
    }
    const idle = (() => {
      const p = track.pointAt(G.s0 - 20, 0);
      const k = createKart(p.x, p.z, p.heading, p.y);
      k.trackIndex = p.index;
      k.speed = 25;
      return system.dangerAhead(k, track, T_IDLE, 0);
    })();
    expect(idle).toEqual({ brake: 0, steer: 0 });
  });
});
