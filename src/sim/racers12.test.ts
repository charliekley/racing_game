/**
 * Twelve karts: the starting grid fits on every track, and a full field of bots finishes a race on every track.
 */
import { describe, expect, it } from 'vitest';
import { TRACKS } from '../track';
import { planScenery } from '../track/sceneryPlan';
import { BotPack } from './bots';
import { botLoadoutFor } from './classes';
import { KART } from './config';
import { Colliders } from './colliders';
import { GRID_SIZE, Track } from './track';
import { World } from './world';

const tracks = TRACKS.map((def) => [def.name, new Track(def)] as const);

describe('starting grid for 12 karts', () => {
  it('has 12 places', () => {
    expect(GRID_SIZE).toBe(12);
  });

  describe.each(tracks)('on %s', (_name, track) => {
    const spots = Array.from({ length: GRID_SIZE }, (_, i) => track.gridSpot(i));
    const plan = planScenery(track);
    const colliders = new Colliders([...plan.colliders, ...plan.pierColliders]);

    it('every spot is on the road, away from the walls, behind the line and not over a gap', () => {
      for (const g of spots) {
        const p = track.project(g.x, g.z);
        expect(Math.abs(p.d)).toBeLessThan(track.def.width / 2 - KART.radius - 1); // fully on the road, room to the wall
        const behind = -track.deltaS(0, p.s);
        expect(behind).toBeGreaterThan(5); // behind the start line...
        expect(behind).toBeLessThan(45); // ...but not far back
        expect(track.inGap(p.s)).toBe(false);
        expect(track.sample(g.x, g.z)?.surface).not.toBe('offroad');
        const walls = track.wallsAt(p.i, p.route);
        if (walls.left !== null) expect(p.d).toBeGreaterThan(walls.left + KART.radius + 1);
        if (walls.right !== null) expect(p.d).toBeLessThan(walls.right - KART.radius - 1);
      }
    });

    it('no two karts overlap', () => {
      for (let a = 0; a < spots.length; a++) {
        for (let b = a + 1; b < spots.length; b++) {
          expect(Math.hypot(spots[a].x - spots[b].x, spots[a].z - spots[b].z)).toBeGreaterThan(KART.radius * 2 + 1.5);
        }
      }
    });

    it('no scenery or bridge pier stands on a grid spot', () => {
      for (const g of spots) expect(colliders.blocksPoint(g.x, g.z, KART.radius + 0.5)).toBe(false);
    });
  });
});

describe('a full field of 12 bots finishes a race', () => {
  it.each(tracks)('on %s', (_name, track) => {
    const world = new World(track, track);
    const slots = Array.from({ length: 12 }, (_, i) => i);
    world.startRace(slots, 2, new Map(slots.map((s) => [s, botLoadoutFor(s)])));
    const pack = new BotPack('normal');
    let ticks = 0;
    while (world.race!.phase !== 'done' && ticks < 60 * 420) {
      world.tick((slot) => pack.input(world, slot));
      ticks++;
    }
    const race = world.race!;
    expect(race.phase).toBe('done');
    const finished = [...race.racers.values()].filter((r) => r.finished);
    // The race ends 20 s after the first finish, so a kart that was hit by items a few times may be a bit short: most finish...
    expect(finished.length).toBeGreaterThanOrEqual(9);
    // ...and nobody is stuck: every kart got at least 80% of the way (progress counts from the start line).
    for (const r of race.racers.values()) expect(r.progress).toBeGreaterThan(track.length * 2 * 0.8);
    expect(new Set([...race.racers.values()].map((r) => r.place)).size).toBe(12); // unique places 1..12
    expect(race.standings().length).toBe(12);
  }, 300_000);
});
