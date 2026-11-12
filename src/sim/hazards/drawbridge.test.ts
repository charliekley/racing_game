import { describe, expect, it } from 'vitest';
import { NEUTRAL_INPUT } from '../../shared/protocol';
import { docksideLoop } from '../../track/tracks/docksideLoop';
import { KART, SIM_DT } from '../config';
import { createKart, stepKart, type KartState } from '../kart';
import { Track } from '../track';
import { World } from '../world';
import { Drawbridge } from './drawbridge';
import { HazardSystem } from './system';

const track = new Track(docksideLoop);
const system = new HazardSystem(track);
const bridge = system.list[0] as Drawbridge;
const ground = system.wrapGround(track);
const f = bridge.frame;
// docksideLoop.ts: period 24, phase 9. Cycle clock = time - 9: down 0..14, warn 14..16, rising 16..18, up 18..22, lowering 22..24.
const CYCLE = 9;
/** Race time at which the leaves are fully up (middle of the hold), and a time when they are down. */
const T_UP = CYCLE + 18.2; // just after the leaves reached the top: 3.8 s of 'up' ahead
const T_DOWN = CYCLE + 5;
/** Road height at the hinge on the centre line (the road is banked a hair on the set-up curve: a bit above the control point). */
const ROAD = track.sample(f.ax, f.az)!.height;

/** A kart `back` metres before hinge A on the centre line, driving at `speed`. */
function kartBefore(back: number, speed: number, boost = 0): KartState {
  const p = track.pointAt(bridge.s - bridge.halfLength - back);
  const k = createKart(p.x, p.z, p.heading, track.sample(p.x, p.z)!.height);
  k.grounded = true;
  k.trackIndex = p.index;
  k.speed = speed;
  k.vel.x = Math.sin(p.heading) * speed;
  k.vel.z = Math.cos(p.heading) * speed;
  k.boostTime = boost;
  return k;
}

/**
 * Drive straight from race time t0 for up to `seconds` while holding the speed at `speed` (m/s) whenever the kart is on the
 * ground (a kart that is not allowed to slow down or speed up: the speed you have when you reach the bridge is what counts).
 */
function cross(k: KartState, t0: number, speed: number, seconds = 4): { fell: boolean; crossed: boolean; maxY: number } {
  let maxY = -Infinity;
  const karts = new Map([[0, k]]);
  for (let t = t0; t < t0 + seconds; t += SIM_DT) {
    if (k.grounded && k.stallTime === 0) k.speed = speed;
    stepKart(k, NEUTRAL_INPUT, ground, SIM_DT, KART);
    system.step(t, karts, () => KART);
    maxY = Math.max(maxY, k.pos.y);
    if (k.pos.y < f.ay - 5) return { fell: true, crossed: false, maxY };
    const along = (k.pos.x - f.ax) * f.tx + (k.pos.z - f.az) * f.tz;
    if (along > f.span + 2 && k.grounded) return { fell: false, crossed: true, maxY };
  }
  return { fell: false, crossed: false, maxY };
}

describe('drawbridge pose', () => {
  it('is periodic and pure (same time = same answer), also for negative times', () => {
    for (const t of [-5, -0.1, 0, 3.3, 14.9, 15.5, 17, 20, 25.9, 33]) {
      const a = bridge.pose(t);
      expect(bridge.pose(t)).toEqual(a);
      for (const n of [-2, 1, 4]) {
        const b = bridge.pose(t + 24 * n);
        expect(b.phase).toBe(a.phase);
        expect(b.lift as number).toBeCloseTo(a.lift as number, 9);
      }
    }
  });

  it('cycles down -> warn (2 s) -> rising -> up -> lowering -> down, with the bridge up for part of the cycle only', () => {
    let warn = 0;
    let up = 0;
    let moving = 0;
    let down = 0;
    const order: string[] = [];
    for (let t = 0; t < 24; t += 0.01) {
      const p = bridge.pose(CYCLE + t);
      const lift = p.lift as number;
      if (p.phase === 'warn') warn += 0.01;
      if (lift === 1) up += 0.01;
      else if (lift > 0) moving += 0.01;
      else down += 0.01;
      const label = p.phase === 'warn' ? 'warn' : lift === 0 ? 'down' : lift === 1 ? 'up' : 'moving';
      if (order[order.length - 1] !== label) order.push(label);
    }
    expect(warn).toBeCloseTo(2, 1);
    expect(up).toBeGreaterThan(3);
    expect(up).toBeLessThan(6);
    expect(moving).toBeCloseTo(4, 0);
    expect(down / 24).toBeGreaterThan(0.5); // flat road more than half the time
    expect(order.slice(0, 5)).toEqual(['down', 'warn', 'moving', 'up', 'moving']);
    expect(bridge.pose(T_UP).lift).toBe(1);
    expect(bridge.pose(T_DOWN).lift).toBe(0);
  });
});

describe('drawbridge ground', () => {
  it('is flat road where the leaves are down: the road height all along the span and across the deck', () => {
    for (let u = 0; u <= f.span; u += 2.5) {
      for (const lateral of [-7, -3, 0, 4, 7.5]) {
        const x = f.ax + f.tx * u + f.rx * lateral;
        const z = f.az + f.tz * u + f.rz * lateral;
        const g = ground.sample(x, z);
        // The static ground is hit-or-hole; the bridge fills the hole. Without it the middle would be water.
        expect(g, `u=${u} lateral=${lateral}`).not.toBeNull();
        expect(Math.abs(g!.height - f.ay)).toBeLessThan(0.6); // the road is banked a hair at the edges
      }
    }
    // No step where the leaf meets the static road, at either hinge.
    for (const lateral of [-5, 0, 5]) {
      const at = (u: number) => ({ x: f.ax + f.tx * u + f.rx * lateral, z: f.az + f.tz * u + f.rz * lateral });
      const h = (u: number) => ground.sample(at(u).x, at(u).z)!.height;
      expect(Math.abs(h(0.05) - h(-0.05))).toBeLessThan(0.02);
      expect(Math.abs(h(f.span + 0.05) - h(f.span - 0.05))).toBeLessThan(0.02);
    }
    // Over the whole down phase (idle and the warning).
    for (let t = CYCLE; t < CYCLE + 16; t += 0.5) expect(bridge.groundAt(f.ax + f.tx * 25, f.az + f.tz * 25, t)).toBeCloseTo(ROAD, 0);
  });

  it('leaves the road beyond the hinges and beside the deck to the track', () => {
    expect(bridge.groundAt(f.ax - f.tx * 3, f.az - f.tz * 3, T_UP)).toBeUndefined();
    expect(bridge.groundAt(f.bx + f.tx * 3, f.bz + f.tz * 3, T_UP)).toBeUndefined();
    expect(bridge.groundAt(f.ax + f.tx * 20 + f.rx * 12, f.az + f.tz * 20 + f.rz * 12, T_UP)).toBeUndefined();
  });

  it('when up: two kicker ramps rising to the tips with an opening between them (no ground)', () => {
    const at = (u: number) => bridge.groundAt(f.ax + f.tx * u, f.az + f.tz * u, T_UP);
    const reach = bridge.reachUp;
    expect(at(0.1)).toBeCloseTo(ROAD, 0);
    expect(at(reach - 0.01)! - ROAD).toBeCloseTo(bridge.liftHeight, 0);
    expect(at(reach / 2)! - ROAD).toBeCloseTo(bridge.liftHeight / 2, 0);
    expect(at(f.span / 2)).toBeNull();
    expect(at(reach + 0.2)).toBeNull();
    expect(at(f.span - reach - 0.2)).toBeNull();
    expect(at(f.span - reach + 0.01)! - ROAD).toBeCloseTo(bridge.liftHeight, 0);
    expect(at(f.span - 0.1)).toBeCloseTo(ROAD, 0);
    // Opening width as asked for.
    expect(f.span - 2 * reach).toBeCloseTo(bridge.gap, 6);
  });

  it('the static track has the opening as a water gap (no road mesh), in the middle of the span', () => {
    const gap = track.gaps.find((g) => Math.abs((g.s0 + g.s1) / 2 - bridge.s) < 0.01);
    expect(gap).toBeDefined();
    expect(gap!.kind).toBe('water');
    expect(gap!.s1 - gap!.s0).toBeCloseTo(bridge.gap, 6);
  });
});

describe('drawbridge jump', () => {
  it('a kart driving over the lowered bridge at any speed just crosses (never falls)', () => {
    for (const v of [4, 12, 20, 28]) {
      const r = cross(kartBefore(10, v), T_DOWN, v, 6);
      expect(r.fell, `speed ${v}`).toBe(false);
    }
  });

  it('a slow kart drops into the opening of the raised bridge (falls, no teleport onto the far leaf)', () => {
    for (const v of [10, 15, 20]) {
      const r = cross(kartBefore(5, v), T_UP, v);
      expect(r.fell, `speed ${v}`).toBe(true);
      expect(r.maxY).toBeLessThan(f.ay + bridge.liftHeight + 1.5);
    }
  });

  it('a kart at top speed or boosted clears the opening and lands on the far leaf', () => {
    expect(bridge.clearSpeed()).toBeGreaterThan(22);
    expect(bridge.clearSpeed()).toBeLessThan(KART.maxSpeed * 0.975);
    const top = cross(kartBefore(12, KART.maxSpeed), T_UP, KART.maxSpeed);
    expect(top.crossed).toBe(true);
    const boosted = cross(kartBefore(12, KART.maxSpeed * KART.boostSpeedFactor, 1.1), T_UP, KART.maxSpeed * KART.boostSpeedFactor);
    expect(boosted.crossed).toBe(true);
    expect(boosted.fell).toBe(false);
  });

  it('the speed that clears the opening is what `clearSpeed` says (within a few m/s)', () => {
    const v0 = bridge.clearSpeed();
    expect(cross(kartBefore(5, v0 + 3), T_UP, v0 + 3).crossed).toBe(true);
    expect(cross(kartBefore(5, v0 - 4), T_UP, v0 - 4).fell).toBe(true);
  });

  it('is reported as at most one hazardHit when a kart bumps the far leaf, and it ends in the water', () => {
    const k = kartBefore(5, 18);
    const karts = new Map([[0, k]]);
    let hits = 0;
    for (let t = T_UP; t < T_UP + 3.5; t += SIM_DT) {
      if (k.grounded && k.stallTime === 0) k.speed = 18;
      stepKart(k, NEUTRAL_INPUT, ground, SIM_DT, KART);
      hits += system.step(t, karts, () => KART).filter((e) => e.kind === 'hazardHit').length;
    }
    expect(hits).toBeLessThanOrEqual(1);
    expect(k.pos.y).toBeLessThan(f.ay - 5);
  });
});

describe('drawbridge events and bots', () => {
  it('sends hazardWarn when the bell starts and hazardFire when the leaves start to move', () => {
    const sys = new HazardSystem(track);
    const karts = new Map<number, KartState>();
    const evs: { kind: string; t: number }[] = [];
    for (let t = CYCLE; t < CYCLE + 24; t += SIM_DT) for (const e of sys.step(t, karts, () => KART)) evs.push({ kind: e.kind, t });
    const warn = evs.find((e) => e.kind === 'hazardWarn')!;
    const fire = evs.find((e) => e.kind === 'hazardFire')!;
    expect(warn.t).toBeCloseTo(CYCLE + 14, 1);
    expect(fire.t - warn.t).toBeCloseTo(2, 1);
  });

  it('bot advice: wait (lift/brake) for a slow kart before the bridge moves, commit when fast enough, nothing while it is down', () => {
    const p = track.pointAt(bridge.s - bridge.halfLength - 40);
    const mk = (speed: number, boost = 0) => {
      const k = createKart(p.x, p.z, p.heading, p.y);
      k.trackIndex = p.index;
      k.speed = speed;
      k.boostTime = boost;
      return k;
    };
    expect(system.dangerAhead(mk(15), track, T_UP, 0).brake).toBeGreaterThan(0.5);
    expect(system.dangerAhead(mk(15), track, CYCLE + 14.5, 0).brake).toBeGreaterThan(0.5); // during the warning
    expect(system.dangerAhead(mk(KART.maxSpeed), track, T_UP, 0)).toEqual({ brake: 0, steer: 0 });
    expect(system.dangerAhead(mk(20, 1), track, T_UP, 0)).toEqual({ brake: 0, steer: 0 });
    expect(system.dangerAhead(mk(15), track, T_DOWN, 0)).toEqual({ brake: 0, steer: 0 });
  });

  it('World builds the drawbridge for Dockside Loop', () => {
    const w = new World(track, track);
    w.startRace([0], 1);
    expect(w.hazards!.list[0].kind).toBe('drawbridge');
  });
});
