import { describe, expect, it } from 'vitest';
import { BotPack, DIFFICULTIES, type Difficulty } from '../../sim/bots';
import { botLoadoutFor } from '../../sim/classes';
import { Track } from '../../sim/track';
import { World } from '../../sim/world';
import { TRACKS } from '..';
import { layoutStats } from '../layoutStats';
import { at, autumnSpeedway, GREAT_TRUNK } from './autumnSpeedway';

describe('Autumn Speedway', () => {
  const track = new Track(autumnSpeedway);
  const stats = layoutStats(track);

  it('is between 1.2 and 2.0 km long', () => {
    expect(track.length).toBeGreaterThan(1200);
    expect(track.length).toBeLessThan(2000);
  });

  it('has the signature features: branch-road bridges, a void jump between crowns, humps and a boost pad', () => {
    expect(track.bridges.length).toBeGreaterThan(0);
    expect(track.gaps.filter((g) => g.kind === 'void').length).toBe(1);
    expect(track.ramps.filter((r) => r.shape === 'hump').length).toBeGreaterThanOrEqual(3);
    expect(track.boostPads.length).toBeGreaterThanOrEqual(1);
  });

  it('is the steepest track: a ~20 % climb and a ~30 % drop, steeper than every other track', () => {
    expect(stats.maxClimb).toBeGreaterThanOrEqual(0.2);
    expect(stats.maxDrop).toBeGreaterThanOrEqual(0.3);
    expect(stats.maxDrop).toBeLessThanOrEqual(0.4); // still drivable: karts stay on the road (see the bot races below)
    for (const def of TRACKS) {
      if (def === autumnSpeedway) continue;
      const other = layoutStats(new Track(def));
      expect(stats.maxDrop, def.name).toBeGreaterThan(other.maxDrop);
      expect(stats.meanGrade, def.name).toBeGreaterThan(other.meanGrade);
    }
  });

  it('the spiral climbs at least 50 m round the Great Trunk, and its levels are far apart in height', () => {
    const s0 = track.sAt(at('spiral'));
    const s1 = track.sAt(at('spiralTop'));
    const y0 = track.pointAt(s0).y;
    const y1 = track.pointAt(s1).y;
    expect(y1 - y0).toBeGreaterThan(50);
    // Wherever the road passes over itself (the spiral's turns), the two levels are at least 7 m apart.
    const S = track.samples;
    for (let i = 0; i < S.length; i += 2) {
      for (let j = i + 2; j < S.length; j += 2) {
        if (Math.abs(track.deltaS(S[i].s, S[j].s)) < 120) continue;
        if (Math.hypot(S[i].x - S[j].x, S[i].z - S[j].z) < 20) expect(Math.abs(S[i].y - S[j].y)).toBeGreaterThanOrEqual(7);
      }
    }
    // The trunk stands clear of the spiral road (its centre is the spiral's centre).
    for (const p of S) {
      if (track.deltaS(s0, p.s) < 0 || track.deltaS(p.s, s1) < 0) continue;
      expect(Math.hypot(p.x - GREAT_TRUNK.x, p.z - GREAT_TRUNK.z)).toBeGreaterThan(GREAT_TRUNK.spiralRadius - 2);
    }
  });
});

describe('bots race Autumn Speedway', () => {
  function race(difficulty: Difficulty) {
    const world = new World(new Track(autumnSpeedway), new Track(autumnSpeedway));
    const slots = [0, 1, 2, 3];
    world.startRace(slots, 3, new Map(slots.map((s) => [s, botLoadoutFor(s)])));
    const pack = new BotPack(difficulty);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 60 * 420 && world.race!.phase !== 'done'; i++) {
      for (const e of world.tick((slot) => pack.input(world, slot))) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    }
    return { world, counts };
  }

  it.each(DIFFICULTIES)('%s bots finish 3 laps without falling off the branches', (difficulty) => {
    const { world, counts } = race(difficulty);
    expect(world.race!.phase).toBe('done');
    expect([...world.race!.racers.values()].filter((r) => r.finished).length).toBeGreaterThanOrEqual(3);
    expect(counts.respawn ?? 0).toBeLessThan(3); // nobody got lost on the high road
  }, 120_000);
});
