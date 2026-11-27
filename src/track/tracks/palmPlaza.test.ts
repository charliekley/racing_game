/**
 * Palm Plaza: the layout (two escalator pairs, the atrium split with its ledge drop, the spiral), nothing clipping a road
 * (walls, slabs, solid props), the escalators (timetable, belt effect, guide mascot), the deck traffic (cars along the
 * road on one half, hit = flip), the garden (grass, fountain boxes), and the bots (lane and level choice, car dodging,
 * finishing).
 */
import { describe, expect, it } from 'vitest';
import { Buttons, type ControlInput } from '../../shared/protocol';
import { autopilot } from '../../sim/autopilot';
import { BotPack, DIFFICULTIES, type Difficulty } from '../../sim/bots';
import { botLoadoutFor } from '../../sim/classes';
import { KART, SIM_DT } from '../../sim/config';
import { Car, CAR_LENGTH, GATE, SWING } from '../../sim/hazards/car';
import { Escalator, ESCALATOR_SCHEDULE, ESCALATOR_SPEED } from '../../sim/hazards/escalator';
import { createKart, stepKart } from '../../sim/kart';
import { collideWalls } from '../../sim/collision';
import { ROUTE_STRIDE } from '../../sim/shortcuts';
import { Track, type TrackSample } from '../../sim/track';
import { World } from '../../sim/world';
import type { CarDef, EscalatorDef } from '../hazardTypes';
import { layoutStats } from '../layoutStats';
import { allRoadSamples, planMallShell } from '../mallPlan';
import { planScenery, type Collider } from '../sceneryPlan';
import type { TrackDef } from '../types';
import { LOW_WIDTH, palmPlaza, UPPER } from './palmPlaza';

const track = new Track(palmPlaza);
const escDefs = palmPlaza.hazards!.map((h, i) => [h, i] as const).filter(([h]) => h.kind === 'escalator') as [EscalatorDef, number][];
/** The down pair (with the guide robot) and the entrance pair (up, no robot). */
const escDef = escDefs.find(([h]) => h.mascot !== false)![0];
const escalatorOf = (t: Track, def = escDef) => new Escalator(0, { ...def }, t);
const esc = escalatorOf(track);
const entrance = escalatorOf(track, escDefs.find(([h]) => h.mascot === false)![0]);
const escs = escDefs.map(([h, i]) => new Escalator(i, h, track));
const low = track.branches[palmPlaza.scenery.mall!.low!];
const minRadius = (curv: number[]) => 1 / Math.max(...curv.map(Math.abs));
/** Index of the highest sample of the lower route: the kicker's lip at the gallery's edge. */
const lipIndex = low.samples.reduce((best, p, i) => (p.y > low.samples[best].y ? i : best), 0);

describe('Palm Plaza layout', () => {
  it('is about 1.5 km with bends of radius 28 m or more (main road and every deck lane)', () => {
    expect(track.length).toBeGreaterThan(1400);
    expect(track.length).toBeLessThan(1650);
    expect(minRadius(track.samples.map((p) => p.curvature))).toBeGreaterThanOrEqual(28);
    for (const b of track.branches) expect(minRadius(b.samples.slice(2, -2).map((p) => p.curvature)), `branch ${b.route}`).toBeGreaterThanOrEqual(28);
  });

  it('enters the mall UP a pair of escalators (no robot) and leaves the upper floor DOWN another pair (with the robot)', () => {
    expect(layoutStats(track).heightRange).toBeGreaterThanOrEqual(12);
    for (const [e, up] of [[entrance, true], [esc, false]] as const) {
      expect(e.rising).toBe(up);
      const b = track.branches[e.branchRoute - 1];
      const rise = (y0: number, y1: number) => (up ? y1 - y0 : y0 - y1);
      expect(rise(track.pointAt(e.s0).y, track.pointAt(e.s1).y)).toBeGreaterThan(10);
      expect(rise(b.samples[e.b0].y, b.samples[e.b1].y)).toBeGreaterThan(10);
      expect(Math.abs(e.laneMiddle(0).y - e.laneMiddle(1).y)).toBeLessThan(0.6);
      // Side by side, with room between them, and the same length (neither is a shortcut).
      const gap = Math.hypot(e.laneMiddle(0).x - e.laneMiddle(1).x, e.laneMiddle(0).z - e.laneMiddle(1).z);
      expect(gap).toBeGreaterThan(palmPlaza.width + 6);
      expect(gap).toBeLessThan(palmPlaza.width + 16);
      expect(Math.abs(b.length - b.span) / b.span).toBeLessThan(0.03);
    }
    expect(entrance.hasMascot).toBe(false);
    expect(esc.hasMascot).toBe(true);
    // Their own timetables: not in step.
    let differ = 0;
    for (let t = 0; t < 61; t += 1) if (entrance.pose(t).good !== esc.pose(t).good) differ++;
    expect(differ).toBeGreaterThan(15);
  });

  it('the atrium split: a wider lower route leaves the gallery over a kicker, drops a floor at the ledge and rejoins', () => {
    expect(low.def.deck && low.def.alternate).toBe(true);
    expect(low.samples[0].width).toBe(LOW_WIDTH);
    expect(LOW_WIDTH).toBeGreaterThan(palmPlaza.width);
    expect(low.samples[0].y).toBeCloseTo(UPPER, 0);
    expect(low.samples[low.samples.length - 1].y).toBeCloseTo(0, 0);
    // The kicker (it rises before the lip) and the ledge: a floor down within a few metres.
    expect(low.samples[lipIndex].y - UPPER).toBeGreaterThan(1.2);
    expect(low.samples[lipIndex].y - low.samples[lipIndex + 4].y).toBeGreaterThan(UPPER);
    // Not a shortcut in the usual sense: it is the wider, quieter way (no pads, no belts), not much shorter.
    expect(low.length / low.span).toBeGreaterThan(0.7);
    expect(low.length / low.span).toBeLessThan(1.1);
  });

  it('the ledge: a kart lands on the ground floor at any speed, and a trick off the kicker pays a boost', () => {
    for (const [speed, trick] of [[6, false], [18, false], [27, true], [34, false]] as const) {
      const from = low.samples[lipIndex - 20];
      const k = createKart(from.x, from.z, from.heading, from.y);
      k.trackIndex = low.route * ROUTE_STRIDE + lipIndex - 20; // (a hint: on the lower route)
      k.trackIndex = track.project(k.pos.x, k.pos.z, k.trackIndex).index;
      expect(track.onRoute(k)).toBe(low.route);
      k.speed = speed;
      k.vel.x = from.tx * speed;
      k.vel.z = from.tz * speed;
      let boosted = false;
      for (let i = 0; i < 60 * 8; i++) {
        const buttons = Buttons.GAS | (trick && !k.grounded && i % 2 === 0 ? Buttons.TRICK : 0);
        const steer = autopilot(k, track, { pace: 1, lane: 0, branchChoice: () => true }).steer;
        const ev = stepKart(k, { steer, buttons }, track, SIM_DT);
        collideWalls(k, track);
        if (ev.some((e) => e.kind === 'trickBoost')) boosted = true;
        if (k.grounded && k.pos.y < 0.5) break;
      }
      expect(k.grounded, `speed ${speed}`).toBe(true);
      expect(k.pos.y, `speed ${speed}`).toBeLessThan(0.5);
      expect(track.onRoute(k), `speed ${speed}`).toBe(low.route);
      if (trick) expect(boosted, 'trick boost').toBe(true);
    }
  });

  it('grass patches in the garden slow you; the fountain row of item boxes floats over the pool', () => {
    expect(track.grassPatches.length).toBeGreaterThanOrEqual(2);
    for (const g of track.grassPatches) {
      const p = track.pointAt((g.s0 + g.s1) / 2, (g.d0 + g.d1) / 2);
      expect(track.sample(p.x, p.z, p.index)!.surface).toBe('offroad');
    }
    const fountain = track.ramps[0];
    const floating = track.itemBoxes.filter((bx) => track.deltaS(fountain.s0, bx.s) > 0 && track.deltaS(bx.s, fountain.s0 + 30) > 0);
    expect(floating.length).toBe(4);
    for (const bx of floating) expect(bx.y - track.pointAt(bx.s).y).toBeGreaterThan(1.5);
  });

  it('the spiral climbs a whole floor going round more than 300 degrees', () => {
    const mall = palmPlaza.scenery.mall!;
    const s0 = track.sAt(mall.spiral!.from);
    const s1 = track.sAt(mall.spiral!.to);
    expect(track.pointAt(s1).y - track.pointAt(s0).y).toBeGreaterThan(UPPER - 1.5);
    let turn = 0;
    for (let s = s0; s < s1; s += track.spacing) turn += Math.abs(track.samples[track.pointAt(s).index].curvature) * track.spacing;
    expect((turn * 180) / Math.PI).toBeGreaterThan(300);
  });
});

describe('nothing clips a road', () => {
  const shell = planMallShell(track);
  const plan = planScenery(track);
  const outer = (p: TrackSample) => p.width / 2 + palmPlaza.offroadWidth;
  const lines = [track.samples, ...track.branches.map((b) => b.samples)];
  const roads = allRoadSamples(track);

  it('every road passes through the building only at an opening tall enough, never along a wall', () => {
    for (const [li, ss] of lines.entries()) {
      for (const p of ss) {
        const half = outer(p);
        const a = { x: p.x - p.rx * half, z: p.z - p.rz * half };
        const b = { x: p.x + p.rx * half, z: p.z + p.rz * half };
        for (const w of shell.walls) {
          // Does the road's cross-section (kerb to kerb, verge included) cross the wall segment?
          const ux = w.bx - w.ax;
          const uz = w.bz - w.az;
          const den = (b.x - a.x) * uz - (b.z - a.z) * ux;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((w.ax - a.x) * uz - (w.az - a.z) * ux) / den;
          const u = ((w.ax - a.x) * (b.z - a.z) - (w.az - a.z) * (b.x - a.x)) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          const at = u * Math.hypot(ux, uz);
          const open = w.openings.find((o) => at >= o.u0 && at <= o.u1);
          expect(open, `road ${li} at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) runs into a wall`).toBeDefined();
          expect(open!.top).toBeGreaterThan(p.y + 4);
        }
      }
    }
  });

  it('no road runs through or under an upper-floor slab or the parking deck', () => {
    const S = track.samples;
    const check = (spans: typeof shell.upper, levelOf: (i: number) => number) => {
      for (const sp of spans) {
        const p = S[sp.i];
        const y = levelOf(sp.i);
        for (const q of roads) {
          if (Math.abs(q.y - y) < 1.5 || q.y > y) continue; // on the slab itself, or above it
          // q in p's frame: along the road and across it.
          const dx = q.x - p.x;
          const dz = q.z - p.z;
          if (Math.abs(dx * p.tx + dz * p.tz) > track.spacing) continue;
          // (The road's own strip may pass over another road: that is an overpass. The slab beyond it may not.)
          const across = dx * p.rx + dz * p.rz;
          const reach = q.width / 2;
          const o = outer(p);
          const left = across - reach < -o && across + reach > -sp.left && sp.left > o;
          const right = across + reach > o && across - reach < sp.right && sp.right > o;
          expect(left || right, `slab at ${p.s.toFixed(0)} over a road at y ${q.y.toFixed(1)}`).toBe(false);
        }
      }
    };
    check(shell.upper, () => UPPER);
    check(shell.deck, (i) => S[i].y);
  });

  it('no solid prop stands on any road (main road or branch, at its level)', () => {
    const dist = (c: Collider, x: number, z: number) => {
      if (c.shape === 'circle') return Math.max(0, Math.hypot(x - c.x, z - c.z) - c.r);
      const cos = Math.cos(c.rotY);
      const sin = Math.sin(c.rotY);
      const lx = (x - c.x) * cos - (z - c.z) * sin;
      const lz = (x - c.x) * sin + (z - c.z) * cos;
      return Math.hypot(Math.max(0, Math.abs(lx) - c.hw), Math.max(0, Math.abs(lz) - c.hd));
    };
    const gantry = new Set(plan.gantryPosts.map((g) => g.collider));
    for (const c of plan.colliders) {
      if (gantry.has(c)) continue; // (the start gantry's posts stand at the plaza's kerbs)
      for (const q of roads) {
        if (q.y > c.y + c.height + 1 || q.y < c.y - 3) continue; // a road well above it, or below it
        expect(dist(c, q.x, q.z), `collider at (${c.x.toFixed(0)}, ${c.z.toFixed(0)})`).toBeGreaterThan(outer(q) - 0.01);
      }
    }
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
      const e = escalatorOf(t, def.hazards![0] as EscalatorDef);
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

describe('deck traffic', () => {
  const cars = palmPlaza.hazards!.map((h, i) => [h, i] as const).filter(([h]) => h.kind === 'car').map(([h, i]) => new Car(i, h as CarDef, track));
  const hw = palmPlaza.width / 2;

  it('cars drive along the road on one half of it (pure function of the clock), hidden in the garages in between', () => {
    expect(cars.length).toBeGreaterThanOrEqual(2);
    expect(cars.some((c) => c.dir > 0) && cars.some((c) => c.dir < 0)).toBe(true);
    expect(cars.some((c) => new Set(c.sides).size > 1)).toBe(true); // one changes sides
    for (const c of cars) {
      for (const t of [0.4, 3.3, 8.8]) {
        expect(c.pose(t).phase).toBe(c.pose(t + c.period * 3).phase);
        expect(c.cars(t)[0].lat).toBeCloseTo(c.cars(t + c.period * 3)[0].lat, 6);
      }
      let seen = 0;
      let hidden = 0;
      let onHalf = 0;
      let blinked = 0;
      for (let t = 0; t < c.period * 2; t += 0.05) {
        for (const car of c.cars(t)) {
          if (!car.visible) {
            hidden++;
            continue;
          }
          if (car.blink !== 0) blinked++;
          const into = c.dir > 0 ? track.deltaS(c.s0, car.s) : track.deltaS(car.s, c.s1);
          if (into < GATE || into > c.length - GATE) continue; // coming out of / going into a gate
          seen++;
          // On the road, and on one half of it (except for the SWING metres where it changes sides).
          expect(Math.abs(car.lat)).toBeLessThan(hw - 1);
          if (Math.abs(car.lat) > 2.5) onHalf++;
        }
      }
      expect(seen > 0 && hidden > 0).toBe(true);
      expect(onHalf / seen).toBeGreaterThan(0.65);
      if (new Set(c.sides).size > 1) expect(blinked).toBeGreaterThan(0);
      expect(SWING).toBeLessThan(c.length / c.sides.length);
    }
  });

  it('there is always room to pass: two cars side by side never block both halves', () => {
    for (let t = 0; t < 40; t += 0.1) {
      const all = cars.flatMap((c) => c.cars(t)).filter((x) => x.visible && Math.abs(x.lat) < hw);
      for (const a of all) for (const b of all) if (a !== b && Math.abs(track.deltaS(a.s, b.s)) < CAR_LENGTH + 6) expect(Math.sign(a.lat)).toBe(Math.sign(b.lat));
    }
  });

  it('a kart that hits a car is flipped (spin-out and a hop); a Nova kart drives through; bots see it coming', () => {
    const c = cars[0];
    let t = 0;
    while (!c.cars(t)[0].visible || Math.abs(c.cars(t)[0].lat) > 5 || Math.abs(c.cars(t)[0].lat) < 3.5) t += 0.01;
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
    // On the other half of the road: nothing.
    const p = track.pointAt(car.s, -Math.sign(car.lat) * 4);
    expect(c.affect(createKart(p.x, p.z, 0, car.y), t, SIM_DT, KART)).toBeNull();
    // The bots see it coming on its half, and not on the other half.
    expect(c.dangerFor(car.s - 30, 26, car.lat, t)).toBe(1);
    expect(c.dangerFor(car.s - 30, 26, -Math.sign(car.lat) * 5, t)).toBe(0);
  });
});

/** A race of 4 bots of one difficulty on Palm Plaza; counts respawns, car hits, the escalator lanes and the level taken. */
function race(difficulty: Difficulty, laps = 3) {
  const world = new World(track, track);
  const slots = [0, 1, 2, 3];
  world.startRace(slots, laps, new Map(slots.map((s) => [s, botLoadoutFor(s)])));
  const pack = new BotPack(difficulty);
  const respawns = new Map<number, number>();
  let carHits = 0;
  /** Escalator rides: was the lane taken the better one (by the average belt speed while on it)? Keyed by slot and pair. */
  const riding = new Map<string, { lane: number; sum: [number, number]; n: number }>();
  const rides: { good: boolean; equal: boolean }[] = [];
  const levels = new Set<number>();
  let ticks = 0;
  while (world.race!.phase !== 'done' && ticks < 60 * 400) {
    const ev = world.tick((slot): ControlInput => pack.input(world, slot));
    for (const e of ev as { kind: string; slot: number; type?: string }[]) {
      if (e.kind === 'respawn') respawns.set(e.slot, (respawns.get(e.slot) ?? 0) + 1);
      if (e.kind === 'hazardHit' && e.type === 'car') carHits++;
    }
    if (world.race!.phase === 'racing') {
      for (const [slot, k] of world.karts) {
        if (track.onRoute(k) === low.route) levels.add(slot);
        for (const e of escs) {
          const key = `${slot}:${e.id}`;
          const on = e.laneAt(k);
          const r = riding.get(key);
          if (on && k.grounded) {
            const t = world.race!.time;
            const cur = r ?? { lane: on.lane, sum: [0, 0] as [number, number], n: 0 };
            cur.sum[0] += e.velocity(0, t);
            cur.sum[1] += e.velocity(1, t);
            cur.n++;
            riding.set(key, cur);
          } else if (r && !on && r.n > 30) {
            riding.delete(key);
            const mine = r.sum[r.lane] / r.n;
            const other = r.sum[1 - r.lane] / r.n;
            rides.push({ good: mine >= other - 0.5, equal: Math.abs(mine - other) < 0.5 });
          }
        }
      }
    }
    ticks++;
  }
  return { world, respawns, carHits, rides, levels };
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
    expect(hard.length).toBeGreaterThanOrEqual(8);
    const share = (rs: { good: boolean }[]) => rs.filter((r) => r.good).length / Math.max(1, rs.length);
    if (process.env.PRINT_LAPS) console.log('escalator picks: hard', share(hard).toFixed(2), 'of', hard.length, 'easy', share(easy).toFixed(2), 'of', easy.length, 'normal', share(get('normal').rides.filter((r) => !r.equal)).toFixed(2));
    expect(share(hard)).toBeGreaterThanOrEqual(0.85);
    expect(share(easy)).toBeLessThan(share(hard));
  }, 120_000);

  it('bots use both levels of the atrium split', () => {
    // (Normal bots take the lower level every other lap, half of them on odd laps; see bots.ts pickAlternate.)
    expect(get('normal').levels.size).toBeGreaterThanOrEqual(2);
    expect(get('normal').levels.size).toBeLessThanOrEqual(4);
  }, 120_000);

  it('hard bots dodge the deck traffic at least as well as easy bots', () => {
    if (process.env.PRINT_LAPS) console.log('car hits (4 bots, 3 laps): easy', get('easy').carHits, 'normal', get('normal').carHits, 'hard', get('hard').carHits);
    expect(get('hard').carHits).toBeLessThanOrEqual(get('easy').carHits);
    expect(get('hard').carHits).toBeLessThanOrEqual(4);
  }, 120_000);

  it('a normal bot laps in about 48 to 58 s', () => {
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
