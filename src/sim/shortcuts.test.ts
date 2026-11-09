import { describe, expect, it } from 'vitest';
import { Buttons, type ControlInput } from '../shared/protocol';
import { shortcutTest } from '../track/tracks/_shortcutTest';
import type { TrackDef } from '../track/types';
import { autopilot, botStyleFor } from './autopilot';
import { collideWalls } from './collision';
import { SIM_DT } from './config';
import { COUNTDOWN_SECONDS, Race } from './race';
import { Track, type Projection } from './track';
import { World } from './world';

const track = new Track(shortcutTest);
const [R, D, X] = track.branches; // road shortcut, dirt shortcut (wraps across s = 0), road branch under the bridge
const n = track.samples.length;
const DT = 1 / 60;
const none = new Map<number, ControlInput>();
/** The test track with only the road shortcut R and no bridge: simple to race on. */
const trackR = new Track({ ...shortcutTest, shortcuts: [shortcutTest.shortcuts![0]], bridges: [], points: shortcutTest.points.map((p) => [p[0], p[1]] as [number, number]) });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Pt {
  x: number;
  z: number;
}

/** Positions along the main road from sample a to sample b (wraps around). */
function mainPath(a: number, b: number): Pt[] {
  const out: Pt[] = [];
  for (let i = a; ; i = (i + 1) % n) {
    out.push(track.samples[i]);
    if (i === b % n) break;
  }
  return out;
}

/** Main road up to the branch's start junction, the branch itself, then the main road after its end junction. */
function viaBranch(b: typeof R, before = 40, after = 40): Pt[] {
  return [...mainPath((b.fromIdx - before + n) % n, b.fromIdx), ...b.samples, ...mainPath(b.toIdx, (b.toIdx + after) % n)];
}

/** Project a path point by point, chaining hints like a driving kart does. */
function follow(path: Pt[], hint = -1): Projection[] {
  return path.map((p) => {
    const pr = track.project(p.x, p.z, hint);
    hint = pr.index;
    return pr;
  });
}

/** Distinct consecutive routes along a followed path, e.g. [0, 2, 0]. */
const routeSequence = (ps: Projection[]) => ps.map((p) => p.route).filter((r, i, a) => i === 0 || r !== a[i - 1]);

/** A running Race (past the countdown). */
function racing(slots = [0], laps = 3): Race {
  const r = new Race({ length: track.length, checkpoints: track.checkpoints }, laps, slots);
  r.tick(COUNTDOWN_SECONDS + DT, new Map(slots.map((s) => [s, track.length - 5])), none);
  expect(r.phase).toBe('racing');
  return r;
}

/** Feed a path to the race for one slot (positions come from the real projection). Returns the checkpoint index after each step. */
function drive(race: Race, path: Pt[], slot = 0, hint = -1): number[] {
  const nexts: number[] = [];
  for (const p of follow(path, hint)) {
    race.tick(DT, new Map([[slot, p.s]]), none);
    nexts.push(race.racers.get(slot)!.next);
  }
  return nexts;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

describe('branch geometry', () => {
  it('builds one branch per shortcut with ids 1, 2, 3', () => {
    expect(track.branches.map((b) => b.route)).toEqual([1, 2, 3]);
  });

  it('starts and ends exactly on the main centerline (position, height, heading)', () => {
    for (const b of track.branches) {
      for (const [end, s] of [[b.samples[0], b.s0], [b.samples[b.samples.length - 1], b.s1]] as const) {
        const m = track.projectOnMain(end.x, end.z);
        expect(Math.abs(m.d)).toBeLessThan(0.3);
        expect(Math.abs(m.y - end.y)).toBeLessThan(0.15);
        expect(Math.abs(track.deltaS(m.s, s))).toBeLessThan(0.5);
        const mainHeading = track.samples[m.i].heading;
        expect(Math.abs(Math.atan2(Math.sin(end.heading - mainHeading), Math.cos(end.heading - mainHeading)))).toBeLessThan(0.05);
        expect(end.width).toBeCloseTo(shortcutTest.width, 6); // the road blends back to the main width
      }
    }
  });

  it('has evenly spaced samples (about the main spacing), a smooth turn rate and sensible widths', () => {
    for (const b of track.branches) {
      expect(Math.abs(b.spacing - track.spacing)).toBeLessThan(0.3);
      for (let k = 0; k < b.samples.length - 1; k++) {
        const a = b.samples[k];
        const c = b.samples[k + 1];
        const chord = Math.hypot(c.x - a.x, c.z - a.z);
        expect(chord).toBeGreaterThan(b.spacing * 0.9);
        expect(chord).toBeLessThanOrEqual(b.spacing * 1.001);
      }
      for (const p of b.samples) expect(Math.abs(p.curvature)).toBeLessThan(0.3);
      const mid = b.samples[Math.floor(b.samples.length / 2)];
      expect(mid.width).toBeCloseTo(shortcutTest.width * 0.7, 6); // default branch width
    }
  });

  it('maps the branch linearly onto the main route, also across the start line', () => {
    for (const b of track.branches) {
      expect(b.samples[0].s).toBeCloseTo(b.s0, 6);
      expect(Math.abs(track.deltaS(b.samples[b.samples.length - 1].s, b.s1))).toBeLessThan(1e-6);
      for (let k = 1; k < b.samples.length; k++) expect(track.deltaS(b.samples[k - 1].s, b.samples[k].s)).toBeGreaterThan(0);
    }
    // D leaves at point 16 and rejoins at 0.6, after the start line: s1 < s0 numerically.
    expect(D.s1).toBeLessThan(D.s0);
    expect(D.span).toBeCloseTo(track.length - D.s0 + D.s1, 6);
    // R is shorter than the stretch of main road it skips.
    expect(R.length).toBeLessThan(R.span - 40);
  });

  it('rejects junctions that are too close together', () => {
    const bad: TrackDef = { ...shortcutTest, shortcuts: [{ from: 6, to: 6.01, points: [[50, 300]] }] };
    expect(() => new Track(bad)).toThrow();
  });

  it('returns the main road alone for tracks without shortcuts (nothing changes)', () => {
    const plain = new Track({ ...shortcutTest, shortcuts: undefined });
    expect(plain.branches.length).toBe(0);
    expect(plain.routes.map((r) => r.kind)).toEqual(['main']);
    const p = plain.project(0, 0, 30);
    expect(p.route).toBe(0);
    expect(p.index).toBe(p.i);
  });
});

// ---------------------------------------------------------------------------
// Which road is a kart on?
// ---------------------------------------------------------------------------

describe('project() with branches', () => {
  it('identifies the road for karts in the middle of each road', () => {
    for (const b of track.branches) {
      const mid = Math.floor(b.samples.length / 2);
      const p = b.samples[mid];
      // Hinted, and without any hint (full search).
      for (const hint of [b.route * 2 ** 20 + mid, -1]) {
        const pr = track.project(p.x, p.z, hint);
        expect(pr.route).toBe(b.route);
        expect(Math.abs(pr.i - mid)).toBeLessThanOrEqual(1); // exactly on a sample = end of one segment / start of the next
        expect(Math.abs(pr.d)).toBeLessThan(0.05);
        expect(Math.abs(pr.index - (b.route * 2 ** 20 + mid))).toBeLessThanOrEqual(1);
        expect(pr.s).toBeCloseTo(p.s, 3); // the MAPPED main-route distance
      }
      // The main road well before the junction: main.
      const before = track.samples[(b.fromIdx - 60 + n) % n];
      expect(track.project(before.x, before.z, -1).route).toBe(0);
    }
  });

  it('follows a kart onto a branch at the fork and off it at the rejoin, without flicker', () => {
    for (const b of track.branches) {
      const ps = follow(viaBranch(b));
      expect(routeSequence(ps)).toEqual([0, b.route, 0]);
      // The mapped distance never goes backwards by more than a few metres while driving the whole way.
      for (let k = 1; k < ps.length; k++) expect(track.deltaS(ps[k - 1].s, ps[k].s)).toBeGreaterThan(-12);
    }
  });

  it('keeps a kart on the main road when it drives past a fork', () => {
    for (const b of track.branches) {
      const path = mainPath((b.fromIdx - 40 + n) % n, (b.fromIdx + 60) % n);
      expect(routeSequence(follow(path))).toEqual([0]);
      const after = mainPath((b.toIdx - 40 + n) % n, (b.toIdx + 40) % n);
      expect(routeSequence(follow(after))).toEqual([0]);
    }
  });

  it('tells the road and the road under the bridge apart by hint', () => {
    // X passes beneath the bridge at (0, 100). Main is at ~10 m there, the branch at ~0.
    const at = X.samples.reduce((best, p) => (Math.hypot(p.x, p.z - 100) < Math.hypot(best.x, best.z - 100) ? p : best));
    const mainIdx = Math.round(track.projectOnMain(at.x, at.z).i);
    const onMain = track.sample(at.x, at.z, mainIdx);
    const xIdx = X.samples.indexOf(at);
    const onX = track.sample(at.x, at.z, X.route * 2 ** 20 + xIdx);
    expect(onMain!.height).toBeGreaterThan(8);
    expect(onX!.height).toBeLessThan(1);
    expect(track.project(at.x, at.z, mainIdx).route).toBe(0);
    expect(track.project(at.x, at.z, X.route * 2 ** 20 + xIdx).route).toBe(X.route);
    expect(track.onRoute({ trackIndex: onX!.index })).toBe(X.route);
    expect(track.onRoute({ trackIndex: onMain!.index })).toBe(0);
  });

  it('does not let a kart on the grass near a branch borrow its progress', () => {
    // 40 m beside the middle of R, in the infield, but 100 m from the main road's top: a hint-less
    // projection must not pick the branch (it is beyond its off-road strip).
    const mid = R.samples[Math.floor(R.samples.length / 2)];
    const x = mid.x - mid.rx * 40;
    const z = mid.z - mid.rz * 40;
    expect(track.project(x, z, -1).route).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

describe('sample() on branches', () => {
  it('is road on a road branch and counts dirt as off-road (but not at the road-like ends)', () => {
    const rMid = R.samples[Math.floor(R.samples.length / 2)];
    expect(track.sample(rMid.x, rMid.z, R.route * 2 ** 20 + Math.floor(R.samples.length / 2))?.surface).toBe('road');
    const dMid = Math.floor(D.samples.length / 2);
    const d = D.samples[dMid];
    const hit = track.sample(d.x, d.z, D.route * 2 ** 20 + dMid);
    expect(hit?.surface).toBe('offroad');
    expect(hit?.height).toBeCloseTo(d.y + Track.bankLift(d.bank, d.width / 2, 0), 3);
    // Near the fork the dirt branch is still tarmac.
    const s3 = D.samples[3];
    expect(track.sample(s3.x, s3.z, D.route * 2 ** 20 + 3)?.surface).toBe('road');
    // Beside the road: off-road strip, like the main road.
    const side = track.sample(rMid.x + rMid.rx * (rMid.width / 2 + 4), rMid.z + rMid.rz * (rMid.width / 2 + 4), R.route * 2 ** 20 + Math.floor(R.samples.length / 2));
    expect(side?.surface).toBe('offroad');
  });

  it('blends the terrain toward branch roads too', () => {
    const hilly: TrackDef = {
      ...shortcutTest,
      terrain: { seed: 3, hills: { amplitude: 8, wavelength: 90 } },
      bridges: [],
      points: shortcutTest.points.map((p) => [p[0], p[1]] as [number, number]),
      shortcuts: [{ from: 6, to: 9, points: [[95, 290, 6], [180, 300, 6]] }],
    };
    const t = new Track(hilly);
    const b = t.branches[0];
    const k = Math.floor(b.samples.length / 2);
    const p = b.samples[k];
    // 3 m outside the off-road strip the ground still follows the road level (the flat skirt of the blend).
    const out = p.width / 2 + hilly.offroadWidth + 1;
    const h = t.terrain.height(p.x + p.rx * out, p.z + p.rz * out);
    expect(Math.abs(h - p.y)).toBeLessThan(0.6);
  });
});

describe('walls on branches', () => {
  it('marks the requested stretch (branch-local units) and bounces karts off it', () => {
    const walled = R.samples.map((p, i) => ({ p, i })).filter(({ p }) => p.wallLeft || p.wallRight);
    expect(walled.length).toBeGreaterThan(10);
    // Between local control points 1 and 2 only: the first and last samples are free.
    expect(R.samples[0].wallLeft || R.samples[0].wallRight).toBe(false);
    expect(R.samples[R.samples.length - 1].wallLeft || R.samples[R.samples.length - 1].wallRight).toBe(false);
    const { i, p } = walled[Math.floor(walled.length / 2)];
    const side = p.wallRight ? 1 : -1;
    const wall = track.wallsAt(i, R.route)[side > 0 ? 'right' : 'left']!;
    expect(Math.abs(wall)).toBeCloseTo(p.width / 2 + shortcutTest.offroadWidth, 6);
    // A kart pushed through the wall is put back inside it.
    const kart = {
      pos: { x: p.x + p.rx * side * (Math.abs(wall) + 1), y: p.y, z: p.z + p.rz * side * (Math.abs(wall) + 1) },
      vel: { x: p.rx * side * 10, y: 0, z: p.rz * side * 10 },
      heading: p.heading,
      speed: 0,
      trackIndex: R.route * 2 ** 20 + i,
    };
    const impact = collideWalls(kart as never, track);
    expect(impact).toBeGreaterThan(5);
    const after = track.project(kart.pos.x, kart.pos.z, kart.trackIndex);
    expect(Math.abs(after.d)).toBeLessThanOrEqual(Math.abs(wall));
  });
});

describe('routes', () => {
  it('lists the main loop and one shortcut line per branch', () => {
    const rs = track.routes;
    expect(rs.map((r) => r.kind)).toEqual(['main', 'shortcut', 'shortcut', 'shortcut']);
    expect(rs.map((r) => r.surface)).toEqual(['road', 'road', 'dirt', 'road']);
    expect(rs.map((r) => r.closed)).toEqual([true, false, false, false]);
    track.branches.forEach((b, k) => {
      const line = rs[k + 1];
      expect(line.width).toBeCloseTo(shortcutTest.width * 0.7, 6);
      expect(line.points[0]).toEqual({ x: b.samples[0].x, y: b.samples[0].y, z: b.samples[0].z });
      const last = b.samples[b.samples.length - 1];
      expect(line.points[line.points.length - 1]).toEqual({ x: last.x, y: last.y, z: last.z });
      for (let j = 1; j < line.points.length; j++) {
        const gap = Math.hypot(line.points[j].x - line.points[j - 1].x, line.points[j].z - line.points[j - 1].z);
        expect(gap).toBeLessThan(12);
      }
    });
    // X carries its height (the underpass is at ground level).
    expect(Math.max(...rs[3].points.map((p) => p.y))).toBeLessThan(1.5);
  });
});

// ---------------------------------------------------------------------------
// Race rules
// ---------------------------------------------------------------------------

describe('race credit', () => {
  const start = n - 3;
  const lapFast = (b: typeof R | null) => {
    const race = racing();
    const path = [...mainPath(start, n - 1), ...(b ? mainPath(0, (b.fromIdx - 1 + n) % n) : []), ...(b ? [] : mainPath(0, n - 1)), ...(b ? [...b.samples, ...mainPath(b.toIdx, n - 1)] : []), ...mainPath(0, 4)];
    const nexts = drive(race, path);
    return { race, nexts };
  };

  it('a lap on the main road counts once', () => {
    const { race, nexts } = lapFast(null);
    const r = race.racers.get(0)!;
    expect(r.lap).toBe(2);
    expect(r.lapTimes.length).toBe(1);
    // Checkpoints are entered one at a time, in order.
    for (let k = 1; k < nexts.length; k++) expect((nexts[k] - nexts[k - 1] + 12) % 12).toBeLessThanOrEqual(1);
  });

  it('a lap through the road shortcut credits the skipped checkpoints and counts like a normal lap', () => {
    const { race, nexts } = lapFast(R);
    const r = race.racers.get(0)!;
    expect(r.lap).toBe(2);
    expect(r.lapTimes.length).toBe(1);
    // Every checkpoint was entered once, in order, even though the main road between the junctions was skipped.
    for (let k = 1; k < nexts.length; k++) expect((nexts[k] - nexts[k - 1] + 12) % 12).toBeLessThanOrEqual(1);
    const seen = new Set(nexts);
    for (let c = 0; c < 12; c++) expect(seen.has(c)).toBe(true);
  });

  it('works for the branch that wraps across the start line, and for the underpass', () => {
    for (const b of [D, X]) {
      const race = racing();
      // Whole lap, taking branch b (D's end is after the line: drive from just before D's start through the line).
      const path = [...mainPath(start, n - 1), ...mainPath(0, (b.fromIdx - 1 + n) % n)];
      const lap = b === D ? [...mainPath((D.fromIdx - 40 + n) % n, D.fromIdx), ...D.samples, ...mainPath(D.toIdx, (D.toIdx + 30) % n)] : [...path, ...X.samples, ...mainPath(X.toIdx, n - 1), ...mainPath(0, 4)];
      if (b === D) {
        // Start behind D's fork, go through D (which crosses s = 0), then complete the lap on the main road.
        const r0 = racing();
        drive(r0, [...mainPath(start, n - 1), ...mainPath(0, (D.fromIdx - 1 + n) % n)]);
        drive(r0, lap, 0, track.pointAt(D.s0).index);
        drive(r0, mainPath((D.toIdx + 30) % n, D.fromIdx + n > 0 ? D.fromIdx : 0));
        const rr = r0.racers.get(0)!;
        // D rejoins after the line, so the line was crossed ON the branch: lap 2 has started, no checkpoints missed.
        expect(rr.lap).toBe(2);
        expect(rr.lapTimes.length).toBe(1);
      } else {
        drive(race, lap);
        expect(race.racers.get(0)!.lap).toBe(2);
      }
    }
  });

  it('gives no extra credit for driving the branch again or backwards', () => {
    const race = racing();
    drive(race, [...mainPath(start, n - 1), ...mainPath(0, (R.fromIdx - 1 + n) % n)]);
    drive(race, [...R.samples, ...mainPath(R.toIdx, (R.toIdx + 20) % n)], 0, track.pointAt(R.s0).index);
    const after = { next: race.racers.get(0)!.next, lap: race.racers.get(0)!.lap, progress: race.racers.get(0)!.progress };
    // Back along the branch (reverse), then forward again.
    const reversed = [...R.samples].reverse();
    drive(race, reversed, 0, R.route * 2 ** 20 + R.samples.length - 1);
    drive(race, [...R.samples, ...mainPath(R.toIdx, (R.toIdx + 20) % n)], 0, track.pointAt(R.s0).index);
    const now = race.racers.get(0)!;
    expect(now.lap).toBe(after.lap);
    expect(now.next).toBe(after.next);
    expect(now.progress).toBeLessThanOrEqual(after.progress + 30);
  });

  it('does not credit a straight cut across the grass between the junctions', () => {
    // Two bots on a track with only R. Slot 1 takes the shortcut road. Slot 0 drives the main road,
    // then at R's fork heads straight for R's rejoin point across the infield (like a human cutting the corner).
    const world = new World(trackR, trackR);
    world.startRace([0, 1], 3);
    const cutterStyle = { ...botStyleFor(1), shortcutBias: 0 };
    const racerStyle = { ...botStyleFor(0), shortcutBias: 1 };
    const target = trackR.samples[trackR.branches[0].toIdx];
    const r = trackR.branches[0];
    let cutting = false;
    let cutterMaxNext = 0;
    let respawned = false;
    const startSeg = world.race!.segmentOf(r.s0);
    for (let i = 0; i < 60 * 70; i++) {
      const ev = world.tick((slot) => {
        const k = world.karts.get(slot)!;
        if (slot === 1) return autopilot(k, trackR, racerStyle);
        const p = trackR.project(k.pos.x, k.pos.z, k.trackIndex);
        if (trackR.deltaS(p.s, r.s0) > -35 && trackR.deltaS(p.s, r.s0) < 60) cutting = true;
        if (!cutting) return autopilot(k, trackR, cutterStyle);
        const want = Math.atan2(target.x - k.pos.x, target.z - k.pos.z);
        const err = Math.atan2(Math.sin(want - k.heading), Math.cos(want - k.heading));
        return { steer: Math.max(-1, Math.min(1, -err * 3)), buttons: Buttons.GAS };
      });
      if (ev.some((e) => e.kind === 'respawn' && e.slot === 0)) respawned = true;
      const c = world.race!.racers.get(0)!;
      if (c.lap === 1) cutterMaxNext = Math.max(cutterMaxNext, c.next);
    }
    expect(cutting).toBe(true);
    // The cutter ran out of road (45 m off the edge for 2.5 s) and was carried back, or at least never got
    // past the checkpoints between the junctions by cutting: it is still in the segment of the fork or before it.
    const segEnd = world.race!.segmentOf(r.s1);
    expect(respawned || cutterMaxNext <= startSeg + 1).toBe(true);
    expect(cutterMaxNext).toBeLessThanOrEqual(Math.min(startSeg + 1, segEnd));
    // The shortcut bot did get credit for the same stretch on the first lap.
    expect(world.race!.racers.get(1)!.lapTimes.length).toBeGreaterThanOrEqual(1);
  });
});

describe('bots', () => {
  it('slots 0 and 2 like shortcuts, the others do not; tracks without shortcuts are unaffected', () => {
    expect([0, 1, 2, 3].map((s) => (botStyleFor(s).shortcutBias ?? 0) > 0.5)).toEqual([true, false, true, false]);
  });

  it('a shortcut-loving bot beats a main-road bot on a track where the shortcut is clearly shorter', () => {
    const onlyR = trackR;
    const lapTime = (bias: number) => {
      const w = new World(onlyR, onlyR);
      w.startRace([0], 3);
      const style = { ...botStyleFor(0), shortcutBias: bias };
      for (let i = 0; i < 60 * 200 && w.race!.racers.get(0)!.lapTimes.length < 2; i++) w.tick(() => autopilot(w.karts.get(0)!, onlyR, style));
      const times = w.race!.racers.get(0)!.lapTimes;
      expect(times.length).toBe(2);
      return times[1]; // second lap: both are up to speed
    };
    const fast = lapTime(1);
    const slow = lapTime(0);
    expect(fast).toBeLessThan(slow - 1);
  });

  it('4 bots finish a 3-lap race on the test track, some of them through the shortcuts', () => {
    const slots = [0, 1, 2, 3];
    const world = new World(track, track);
    world.startRace(slots, 3);
    const onBranchTicks = new Map<number, number>(slots.map((slot) => [slot, 0]));
    const routesUsed = new Set<number>();
    let ticks = 0;
    while (world.race!.phase !== 'done' && ticks < 60 * 420) {
      world.tick((slot) => autopilot(world.karts.get(slot)!, track, botStyleFor(slot)));
      for (const slot of slots) {
        const r = track.onRoute(world.karts.get(slot)!);
        if (r > 0) {
          onBranchTicks.set(slot, onBranchTicks.get(slot)! + 1);
          routesUsed.add(r);
        }
      }
      ticks++;
    }
    const race = world.race!;
    expect(race.phase).toBe('done');
    for (const slot of slots) {
      const r = race.racers.get(slot)!;
      expect(r.finished).toBe(true);
      expect(r.lapTimes.length).toBe(3);
    }

    // Slots 0 and 2 like shortcuts: lots of time on branches. Slots 1 and 3 stay on the main road
    // (a moment on a branch where the roads still overlap at a fork is fine).
    expect(onBranchTicks.get(0)!).toBeGreaterThan(60 * 20);
    expect(onBranchTicks.get(2)!).toBeGreaterThan(60 * 20);
    expect(onBranchTicks.get(1)!).toBeLessThan(60 * 8);
    expect(onBranchTicks.get(3)!).toBeLessThan(60 * 8);
    expect(routesUsed.has(R.route)).toBe(true);
  });
});

void SIM_DT;
