import { describe, expect, it } from 'vitest';
import { BotPack, DIFFICULTIES } from '../../sim/bots';
import { botLoadoutFor } from '../../sim/classes';
import { Track } from '../../sim/track';
import { World } from '../../sim/world';
import { layoutStats } from '../layoutStats';
import { rainbowRoute } from './rainbowRoute';

describe('Rainbow Route', () => {
  const track = new Track(rainbowRoute);

  it('is a short, dense lap: 1.4 to 1.8 km, no bend tighter than 28 m', () => {
    expect(track.length).toBeGreaterThan(1400);
    expect(track.length).toBeLessThan(1800);
    const tightest = 1 / Math.max(...track.samples.map((p) => Math.abs(p.curvature)));
    expect(tightest).toBeGreaterThanOrEqual(28);
  });

  it('has the set pieces: two ramp jumps over gaps, a field of trick bumps, a split ribbon and a star tunnel', () => {
    expect(track.ramps.filter((r) => r.gap > 0)).toHaveLength(2);
    expect(track.gaps.filter((g) => g.kind === 'void')).toHaveLength(2);
    expect(track.ramps.filter((r) => r.shape === 'hump').length).toBeGreaterThanOrEqual(5);
    expect(track.branches).toHaveLength(1);
    expect(track.branches[0].def.deck).toBe(true);
    expect(track.cannons).toHaveLength(1);
    expect(track.cannons[0].mandatory).toBe(true);
    // The tunnel puts you well above where it started.
    expect(track.cannons[0].landing.y - track.cannons[0].mouth.y).toBeGreaterThanOrEqual(20);
  });

  it('has lots of boost pads, many under a star-ring arch, and an item row for every big section', () => {
    expect(rainbowRoute.boostPads.length).toBeGreaterThanOrEqual(15);
    expect(rainbowRoute.boostPads.filter((b) => b.arch).length).toBeGreaterThanOrEqual(8);
    expect(track.itemBoxes.length / 3).toBeGreaterThanOrEqual(10);
  });

  it('is climbs and descents the physics handles: no grade over 20 %, a big height range', () => {
    const stats = layoutStats(track);
    expect(stats.maxClimb).toBeLessThan(0.2);
    expect(stats.maxDrop).toBeLessThan(0.2);
    expect(stats.heightRange).toBeGreaterThan(30);
  });

  it('has hardly any rails, and the ground ends at the ribbon edge: there is nothing to stand on beside it', () => {
    const walled = track.samples.filter((p) => p.wallLeft || p.wallRight).length / track.samples.length;
    expect(walled).toBeLessThan(0.15);
    const p = track.samples[60];
    const side = rainbowRoute.width / 2 + 3;
    expect(track.sample(p.x + p.rx * side, p.z + p.rz * side)).toBeNull(); // off the edge: void
    expect(track.sample(p.x, p.z)).not.toBeNull();
  });

  it('the high line of the fork is a real deck: ground on it, none beside it', () => {
    const b = track.branches[0];
    const mid = b.samples[Math.floor(b.samples.length / 2)];
    expect(track.sample(mid.x, mid.z)?.height).toBeCloseTo(mid.y, 1);
    expect(track.sample(mid.x + mid.rx * (b.samples[0].width / 2 + 4), mid.z + mid.rz * (b.samples[0].width / 2 + 4))).toBeNull();
  });

  it('normal bots lap in about 45 to 60 seconds (the whole race takes 2.5 to 3 minutes)', () => {
    const world = new World(track, track);
    world.startRace([0], 2, new Map([[0, botLoadoutFor(0)]]));
    const pack = new BotPack('normal');
    let ticks = 0;
    while (!world.race!.racers.get(0)!.finished && ticks < 60 * 300) {
      world.tick((s) => pack.input(world, s));
      ticks++;
    }
    const lap = world.race!.racers.get(0)!.finishTime! / 2;
    expect(lap).toBeGreaterThan(40);
    expect(lap).toBeLessThan(60);
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
