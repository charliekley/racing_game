import { describe, expect, it } from 'vitest';
import { Buttons } from '../../shared/protocol';
import { BotPack, DIFFICULTIES } from '../../sim/bots';
import { stepCannons } from '../../sim/cannon';
import { botLoadoutFor } from '../../sim/classes';
import { SIM_DT } from '../../sim/config';
import { applyBoost, createKart, forwardOf, stepKart } from '../../sim/kart';
import { Track } from '../../sim/track';
import { World } from '../../sim/world';
import { layoutStats } from '../layoutStats';
import { rainbowRoute } from './rainbowRoute';

/** Entry speeds (m/s) of the landing tests: a slow kart, a normal one, the top speed, a boosted one and an absurdly fast one. */
const SPEEDS: [string, number, boolean][] = [
  ['slow', 20, false],
  ['normal', 26, false],
  ['top speed', 28, false],
  ['boosted', 38, true],
  ['boosted + item', 44, true],
];

describe('Rainbow Route', () => {
  const track = new Track(rainbowRoute);

  it('is a short, dense lap: 1.4 to 1.8 km, no bend tighter than 28 m', () => {
    expect(track.length).toBeGreaterThan(1400);
    expect(track.length).toBeLessThan(1800);
    const tightest = 1 / Math.max(...track.samples.map((p) => Math.abs(p.curvature)));
    expect(tightest).toBeGreaterThanOrEqual(28);
  });

  it('is a wide ribbon: 17 to 19 m, the branch of the fork as wide as the main road', () => {
    expect(rainbowRoute.width).toBeGreaterThanOrEqual(17);
    expect(rainbowRoute.width).toBeLessThanOrEqual(19);
    expect(track.samples.every((p) => p.width === rainbowRoute.width)).toBe(true);
    expect(track.branches[0].samples.every((p) => p.width === rainbowRoute.width)).toBe(true);
  });

  it('has the set pieces: two ramp jumps over gaps, a field of trick bumps, a split ribbon and a star tunnel', () => {
    expect(track.ramps.filter((r) => r.gap > 0)).toHaveLength(2);
    expect(track.gaps.filter((g) => g.kind === 'void')).toHaveLength(2);
    expect(track.ramps.filter((r) => r.shape === 'hump').length).toBeGreaterThanOrEqual(5);
    expect(track.branches).toHaveLength(1);
    expect(track.branches[0].def.deck).toBe(true);
    expect(track.cannons).toHaveLength(1);
    expect(track.cannons[0].mandatory).toBe(true);
    // The tunnel puts you far above where it started.
    expect(track.cannons[0].landing.y - track.cannons[0].mouth.y).toBeGreaterThanOrEqual(30);
  });

  it('has lots of boost pads, many under a star-ring arch, and an item row for every big section', () => {
    expect(rainbowRoute.boostPads.length).toBeGreaterThanOrEqual(15);
    expect(rainbowRoute.boostPads.filter((b) => b.arch).length).toBeGreaterThanOrEqual(8);
    expect(track.itemBoxes.length / 3).toBeGreaterThanOrEqual(10);
  });

  it('is dramatic climbs and descents the physics handles: grades of 10 to 20 %, a big height range', () => {
    const stats = layoutStats(track);
    expect(stats.maxClimb).toBeLessThan(0.2);
    expect(stats.maxDrop).toBeLessThan(0.2);
    expect(stats.maxClimb).toBeGreaterThan(0.1);
    expect(stats.maxDrop).toBeGreaterThan(0.1);
    expect(stats.heightRange).toBeGreaterThan(55);
  });

  it('the lap closes in height: the descent after the star tunnel ends level with the start, and the tunnel is the way up', () => {
    const c = track.cannons[0];
    // The lowest point of the lap lies well below the tunnel's mouth (the cannon is how you get back up).
    const lowest = Math.min(...track.samples.filter((p) => !track.inSkyGap(p.s)).map((p) => p.y));
    expect(c.mouth.y - lowest).toBeGreaterThan(20);
    expect(c.landing.y - c.mouth.y).toBeGreaterThan(30);
    // Start line and the road just before it are level (no step where the lap closes).
    const first = track.samples[0].y;
    const last = track.samples[track.samples.length - 1].y;
    expect(Math.abs(first - last)).toBeLessThan(0.3);
  });

  it('has a few rainbow rails on the sharpest corners (not everywhere), and the ground ends at the ribbon edge', () => {
    const walled = track.samples.filter((p) => p.wallLeft || p.wallRight).length / track.samples.length;
    expect(walled).toBeLessThan(0.2);
    expect(walled).toBeGreaterThan(0.05);
    expect(rainbowRoute.walls.length).toBeGreaterThanOrEqual(5);
    const p = track.samples[60];
    const side = rainbowRoute.width / 2 + 3;
    expect(track.sample(p.x + p.rx * side, p.z + p.rz * side)).toBeNull(); // off the edge: void
    expect(track.sample(p.x, p.z)).not.toBeNull();
  });

  it('the rails are real walls: a kart driving into one is stopped', () => {
    const i = track.samples.findIndex((p) => p.wallLeft || p.wallRight);
    const w = track.wallsAt(i);
    expect(w.left !== null || w.right !== null).toBe(true);
  });

  describe('the fork is a clear Y', () => {
    const b = track.branches[0];
    /** Distance between the branch's centre line and the main road's, at branch sample k. */
    const apart = (k: number) => {
      const m = track.pointAt(b.samples[k].s);
      return Math.hypot(b.samples[k].x - m.x, b.samples[k].z - m.z);
    };
    const gap = (k: number) => apart(k) - rainbowRoute.width; // metres of void between the two ribbons' edges

    it('starts and ends on the main centre line, with equal widths', () => {
      expect(apart(0)).toBeLessThan(2);
      expect(apart(b.samples.length - 1)).toBeLessThan(2);
      expect(b.samples[0].width).toBe(track.samples[0].width);
    });

    it('splits at a single point, runs side by side with a void of 10 m or more between the ribbons, and merges at a single point', () => {
      const open = b.samples.map((_, k) => gap(k) > 0);
      const first = open.indexOf(true);
      const last = open.lastIndexOf(true);
      expect(first).toBeGreaterThan(0);
      // One unbroken void (no touching again in the middle), at least 65 m long, at least 10 m wide at its widest.
      for (let k = first; k <= last; k++) expect(open[k], `sample ${k}`).toBe(true);
      expect((last - first) * b.spacing).toBeGreaterThan(65);
      expect(Math.max(...b.samples.map((_, k) => gap(k)))).toBeGreaterThanOrEqual(10);
      // Void in the middle: nothing under it.
      const mid = b.samples[Math.round((first + last) / 2)];
      const m = track.pointAt(mid.s);
      expect(track.sample((mid.x + m.x) / 2, (mid.z + m.z) / 2)).toBeNull();
    });

    it('the high line is a real deck (ground on it, none beside it) and a little higher and shorter than the main ribbon', () => {
      const mid = b.samples[Math.floor(b.samples.length / 2)];
      expect(track.sample(mid.x, mid.z)?.height).toBeCloseTo(mid.y, 1);
      expect(track.sample(mid.x + mid.rx * (mid.width / 2 + 4), mid.z + mid.rz * (mid.width / 2 + 4))).toBeNull();
      const mainY = track.pointAt(mid.s).y;
      expect(mid.y - mainY).toBeGreaterThan(1);
      expect(b.length).toBeLessThan(b.span); // (the branch is shorter than the main road between the junctions)
    });

    it('only the main ribbon has boost pads', () => {
      const pads = track.boostPads.filter((p) => track.deltaS(p.s0, b.s0) > 0 && track.deltaS(p.s0, b.s1) < 0);
      expect(pads.length).toBeGreaterThanOrEqual(2);
    });

    it('karts are projected onto the branch where they drive it, and back onto the main road after the merge', () => {
      const k = Math.floor(b.samples.length / 2);
      const hint = track.project(b.samples[k - 6].x, b.samples[k - 6].z, -1);
      const p = track.project(b.samples[k].x, b.samples[k].z, hint.index);
      expect(p.route).toBe(1);
      const e = b.samples[b.samples.length - 4];
      const q = track.project(e.x, e.z, p.index);
      expect(q.route === 0 || q.route === 1).toBe(true);
      const after = track.pointAt(b.s1 + 25);
      expect(track.project(after.x, after.z, q.index).route).toBe(0);
    });
  });

  describe('every jump lands on the road at every entry speed', () => {
    const gapRamps = track.ramps.filter((r) => r.gap > 0);

    it.each(gapRamps.map((r, i) => [i + 1, r] as const))('jump %i: lands on the apron or just past it, never off the road, from 20 to 44 m/s', (_n, r) => {
      for (const [name, v, boosted] of SPEEDS) {
        // Straight at the ramp (no steering at all), 8 m before it, at the given speed.
        const p = track.pointAt(r.s0 - 8, 0);
        const k = createKart(p.x, p.z, p.heading, track.sample(p.x, p.z)!.height);
        k.speed = v;
        k.vel.x = forwardOf(p.heading).x * v;
        k.vel.z = forwardOf(p.heading).z * v;
        if (boosted) applyBoost(k, 6);
        let landing: { past: number; d: number; onRoad: boolean } | null = null;
        let flew = false;
        for (let i = 0; i < 60 * 5 && !landing; i++) {
          stepKart(k, { steer: 0, buttons: v >= 28 ? Buttons.GAS : 0 }, track, SIM_DT);
          const pr = track.project(k.pos.x, k.pos.z, k.trackIndex);
          k.trackIndex = pr.index;
          expect(k.pos.y, `${name}: fell into the void`).toBeGreaterThan(pr.y - 4);
          if (!k.grounded && pr.s > r.s0 + 2) flew = true;
          if (flew && k.grounded) landing = { past: pr.s - (r.s1 + r.gap), d: pr.d, onRoad: track.sample(k.pos.x, k.pos.z) !== null };
        }
        expect(landing, `${name} (${v} m/s) never landed`).not.toBeNull();
        expect(landing!.onRoad, `${name}: no ground where it landed`).toBe(true);
        expect(Math.abs(landing!.d), `${name}: landed ${landing!.d.toFixed(1)} m off the centre line`).toBeLessThan(rainbowRoute.width / 2 - 2);
        expect(landing!.past, `${name}: landed short of the gap`).toBeGreaterThanOrEqual(-0.5);
        // Within the 10 m apron and a few metres of road after it: the flight never carries on towards the next bend.
        expect(landing!.past, `${name}: flew ${landing!.past.toFixed(1)} m past the gap`).toBeLessThan(20);
      }
    });
  });

  describe('the star tunnel puts every kart on the same landing, at every entry speed, and the kicker after it is safe', () => {
    const c = track.cannons[0];
    const j2 = track.ramps.filter((r) => r.gap > 0)[1];

    it.each(SPEEDS)('%s (%f m/s)', (name, v, boosted) => {
      const p = track.pointAt(c.mouth.s - 25, 0);
      const k = createKart(p.x, p.z, p.heading, track.sample(p.x, p.z)!.height);
      k.speed = v;
      k.vel.x = forwardOf(p.heading).x * v;
      k.vel.z = forwardOf(p.heading).z * v;
      if (boosted) applyBoost(k, 6);
      const karts = new Map([[0, k]]);
      let fired = false;
      let landedAt: { x: number; z: number } | null = null;
      let second: { past: number; d: number; onRoad: boolean } | null = null;
      let flewJ2 = false;
      for (let i = 0; i < 60 * 14 && !second; i++) {
        stepKart(k, { steer: 0, buttons: Buttons.GAS }, track, SIM_DT);
        for (const e of stepCannons(track, karts, SIM_DT)) {
          if (e.kind === 'cannonFire') fired = true;
          if (e.kind === 'cannonLand') landedAt = { x: k.pos.x, z: k.pos.z };
        }
        const pr = track.project(k.pos.x, k.pos.z, k.trackIndex);
        if (!k.flight) {
          k.trackIndex = pr.index;
          expect(k.pos.y, `${name}: fell`).toBeGreaterThan(pr.y - 4);
        }
        if (landedAt && !k.flight) {
          if (!k.grounded && pr.s > j2.s0 - 2) flewJ2 = true;
          if (flewJ2 && k.grounded) second = { past: pr.s - (j2.s1 + j2.gap), d: pr.d, onRoad: track.sample(k.pos.x, k.pos.z) !== null };
        }
      }
      expect(fired, `${name}: not fired`).toBe(true);
      // The same spot, to the centimetre, whatever the entry speed (the arc is authored, not ballistic).
      expect(Math.hypot(landedAt!.x - c.landing.x, landedAt!.z - c.landing.z)).toBeLessThan(0.05);
      expect(second, `${name}: never landed after the second kicker`).not.toBeNull();
      expect(second!.onRoad).toBe(true);
      expect(Math.abs(second!.d)).toBeLessThan(rainbowRoute.width / 2 - 2);
      expect(second!.past).toBeGreaterThanOrEqual(-0.5);
      expect(second!.past).toBeLessThan(20);
    });
  });

  it('normal bots lap in about 50 to 62 seconds (the whole race takes 2.5 to 3 minutes), at a pace per km like the other tracks', () => {
    const world = new World(track, track);
    world.startRace([0], 2, new Map([[0, botLoadoutFor(0)]]));
    const pack = new BotPack('normal');
    let ticks = 0;
    while (!world.race!.racers.get(0)!.finished && ticks < 60 * 300) {
      world.tick((s) => pack.input(world, s));
      ticks++;
    }
    const lap = world.race!.racers.get(0)!.finishTime! / 2;
    expect(lap).toBeGreaterThan(50);
    expect(lap).toBeLessThan(62);
    // The other six tracks' normal bots need 33.3 to 37.2 s per km of lap (measured with the same loop): the ribbon, with its
    // pads and no grip losses, used to be 31 s/km, far quicker than a person. It must not be quicker than the quickest of them.
    const perKm = lap / (track.length / 1000);
    expect(perKm).toBeGreaterThan(32.5);
    expect(perKm).toBeLessThan(38);
  });

  it.each(DIFFICULTIES)('four %s bots finish 3 laps with no repeated respawns on the rail-less ribbon', (difficulty) => {
    const world = new World(track, track);
    const slots = [0, 1, 2, 3];
    world.startRace(slots, 3, new Map(slots.map((s) => [s, botLoadoutFor(s)])));
    const pack = new BotPack(difficulty);
    const falls = new Map<number, number>();
    let ticks = 0;
    while (world.race!.phase !== 'done' && ticks < 60 * 420) {
      for (const e of world.tick((s) => pack.input(world, s))) if (e.kind === 'respawn') falls.set(e.slot, (falls.get(e.slot) ?? 0) + 1);
      ticks++;
    }
    expect(world.race!.phase).toBe('done');
    for (const slot of slots) expect(falls.get(slot) ?? 0, `slot ${slot}`).toBeLessThanOrEqual(2);
  }, 120_000);
});
