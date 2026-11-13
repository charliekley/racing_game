import { describe, expect, it } from 'vitest';
import { BotPack, DIFFICULTIES, type Difficulty } from '../../sim/bots';
import { botLoadoutFor } from '../../sim/classes';
import { Geyser } from '../../sim/hazards/geyser';
import { HazardSystem } from '../../sim/hazards/system';
import { Track } from '../../sim/track';
import { World } from '../../sim/world';
import { emberPeaks } from './emberPeaks';

describe('Ember Peaks', () => {
  const track = new Track(emberPeaks);

  it('is between 1.2 and 2.0 km long', () => {
    expect(track.length).toBeGreaterThan(1200);
    expect(track.length).toBeLessThan(2000);
  });

  it('has the signature features: cannon, cliffs and a void jump', () => {
    expect(track.cannons.length).toBe(1);
    expect(track.cliffs.length).toBeGreaterThan(0);
    expect(track.gaps.some((g) => g.kind === 'void')).toBe(true);
    expect(track.ramps.length).toBeGreaterThanOrEqual(4);
    expect(track.boostPads.length).toBeGreaterThanOrEqual(2);
  });

  it('the cannon is mandatory and crosses the crater: 120-250 m of road with no ground at all', () => {
    const c = track.cannons[0];
    expect(c.mandatory).toBe(true);
    const gap = track.gaps.find((g) => g.kind === 'sky')!;
    expect(gap.s1 - gap.s0).toBeGreaterThan(120);
    expect(gap.s1 - gap.s0).toBeLessThan(250);
    expect(Math.hypot(c.landing.x - c.mouth.x, c.landing.z - c.mouth.z)).toBeGreaterThan(150);
  });
});

describe('Ember Peaks layout rules (docs/TRACKS.md, wave 4)', () => {
  const track = new Track(emberPeaks);
  const S = track.samples;
  const n = S.length;
  // (Straights, curved share, turning, tight corners and height range are checked for every track by src/track/layout.test.ts,
  // which leaves the cannon's flight gap out: it is not driven.)

  it('keeps parallel legs apart: facing walls, or at least 7 m of height (hairpin bends excepted)', () => {
    /** True near a hairpin-like bend, where walls must stay off the inside (bots and class balance suffer otherwise). */
    const nearHairpin = (i: number) => {
      for (let d = -12; d <= 12; d++) if (Math.abs(S[(i + d + n) % n].curvature) > 1 / 45) return true;
      return false;
    };
    const unprotected: string[] = [];
    for (let i = 0; i < n; i++) {
      if (nearHairpin(i)) continue;
      for (let j = 0; j < n; j++) {
        const ds = Math.min(Math.abs(S[j].s - S[i].s), track.length - Math.abs(S[j].s - S[i].s));
        if (ds < 120) continue; // the same stretch of road (S-bends fold back on themselves)
        const dx = S[j].x - S[i].x;
        const dz = S[j].z - S[i].z;
        if (Math.hypot(dx, dz) > 60 || Math.abs(S[i].y - S[j].y) >= 7) continue;
        const onRight = dx * S[i].rx + dz * S[i].rz > 0;
        if (!(onRight ? S[i].wallRight : S[i].wallLeft)) unprotected.push(`s=${Math.round(S[i].s)} vs s=${Math.round(S[j].s)}`);
      }
    }
    expect(unprotected.slice(0, 5)).toEqual([]);
  });

  it('crossing roads are at least 7 m apart in height', () => {
    // (Ember has no crossings; this keeps it that way, or at least keeps them as proper overpasses.)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ds = Math.min(Math.abs(S[j].s - S[i].s), track.length - Math.abs(S[j].s - S[i].s));
        if (ds < 120) continue;
        if (Math.hypot(S[j].x - S[i].x, S[j].z - S[i].z) < 16) expect(Math.abs(S[i].y - S[j].y)).toBeGreaterThanOrEqual(7);
      }
    }
  });
});

describe('Ember Peaks geysers', () => {
  const track = new Track(emberPeaks);
  const system = new HazardSystem(track);
  const geysers = system.list.filter((h): h is Geyser => h instanceof Geyser);

  it('has 3 to 6 geyser groups (pairs 25-45 m apart count as one group), all on the road', () => {
    expect(geysers.length).toBeGreaterThanOrEqual(3);
    let groups = 0;
    geysers.forEach((g, i) => {
      if (i === 0 || track.deltaS(geysers[i - 1].s, g.s) > 45) groups++;
      expect(Math.abs(g.lateral)).toBeLessThan(track.def.width / 2);
    });
    expect(groups).toBeGreaterThanOrEqual(3);
    expect(groups).toBeLessThanOrEqual(6);
  });

  it('keeps geysers off ramps, boost pads, the cannon run-up and cliffs', () => {
    for (const g of geysers) {
      for (const r of track.ramps) expect(Math.abs(track.deltaS(g.s, (r.s0 + r.s1) / 2 + r.gap / 2))).toBeGreaterThan(30);
      for (const p of track.boostPads) expect(Math.abs(track.deltaS(g.s, (p.s0 + p.s1) / 2))).toBeGreaterThan(12);
      for (const c of track.cannons) {
        const after = track.deltaS(c.mouth.s, g.s); // metres past the cannon mouth (negative = before it)
        expect(after < -60 || after > 15).toBe(true); // the cannon's approach stays clear
      }
      for (const c of track.cliffs) {
        const inside = track.deltaS(c.s0, g.s) >= -15 && track.deltaS(c.s1, g.s) <= 15; // 15 m margin round the drop
        expect(inside, `geyser at s=${Math.round(g.s)} is on a cliff stretch`).toBe(false);
      }
    }
  });

  it('a free lane always exists: no two geysers close together in s cover the whole road', () => {
    const half = track.def.width / 2;
    for (const a of geysers) {
      // Every lane position (1 m steps) that is clear of ALL geysers within 12 m of `a` along the road.
      const near = geysers.filter((b) => Math.abs(track.deltaS(a.s, b.s)) < 12);
      let freeRun = 0;
      let best = 0;
      for (let d = -half + 1; d <= half - 1; d += 0.5) {
        const blocked = near.some((b) => Math.abs(d - b.lateral) < b.radius + 0.9 + 0.9);
        freeRun = blocked ? 0 : freeRun + 0.5;
        best = Math.max(best, freeRun);
      }
      expect(best).toBeGreaterThanOrEqual(2);
    }
  });

  it('staggers the eruptions: no two geysers fire in the same moment, so you can weave', () => {
    const phases = new Set<number>();
    for (const g of geysers) {
      // Time within the cycle at which this geyser starts to erupt.
      let t = 0;
      while (g.pose(t).phase !== 'active') t += 0.05;
      phases.add(Math.round((t % 7) * 10));
    }
    expect(phases.size).toBe(geysers.length);
  });
});

describe('bots race Ember Peaks with the geysers on', () => {
  function race(difficulty: Difficulty) {
    const world = new World(new Track(emberPeaks), new Track(emberPeaks));
    const slots = [0, 1, 2, 3];
    world.startRace(slots, 2, new Map(slots.map((s) => [s, botLoadoutFor(s)])));
    const pack = new BotPack(difficulty);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 60 * 420 && world.race!.phase !== 'done'; i++) {
      for (const e of world.tick((slot) => pack.input(world, slot))) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    }
    return { world, counts };
  }

  it.each(DIFFICULTIES)('%s bots finish', (difficulty) => {
    const { world, counts } = race(difficulty);
    const racers = [...world.race!.racers.values()];
    expect(world.race!.phase).toBe('done');
    expect(racers.some((r) => r.finished)).toBe(true);
    for (const r of racers) {
      if (difficulty === 'easy') expect(r.finished || r.progress > 0.9 * 2 * world.track!.length, `slot ${r.slot}`).toBe(true);
      else expect(r.finished, `slot ${r.slot}`).toBe(true);
    }
    expect(counts.hazardFire ?? 0).toBeGreaterThan(50); // the geysers really were erupting all race long
    expect(counts.respawn ?? 0).toBeLessThan(3); // nobody got lost
  }, 60_000);

  it('hard bots read the eruptions and mostly avoid them', () => {
    const { counts } = race('hard');
    expect(counts.hazardHit ?? 0).toBeLessThanOrEqual(4); // 4 bots x 2 laps x 9 geysers = 72 passes
  }, 60_000);
});
