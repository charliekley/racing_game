import { describe, expect, it } from 'vitest';
import { autopilot, botStyleFor } from '../../sim/autopilot';
import { Bouncers, bounceArc } from '../../sim/bouncers';
import { BotPack, DIFFICULTIES, type Difficulty } from '../../sim/bots';
import { botLoadoutFor } from '../../sim/classes';
import { Track } from '../../sim/track';
import { World } from '../../sim/world';
import { layoutStats } from '../layoutStats';
import { autumnSpeedway } from './autumnSpeedway';
import { at, mushroomValley } from './mushroomValley';

describe('Mushroom Valley', () => {
  const track = new Track(mushroomValley);
  const stats = layoutStats(track);
  const bouncers = new Bouncers(track);

  it('is 1.5 to 2.0 km long and no steeper than Autumn Speedway', () => {
    expect(track.length).toBeGreaterThan(1500);
    expect(track.length).toBeLessThan(2000);
    const autumn = layoutStats(new Track(autumnSpeedway));
    expect(stats.maxClimb).toBeLessThan(autumn.maxClimb);
    expect(stats.maxDrop).toBeLessThan(autumn.maxDrop);
    expect(stats.heightRange).toBeGreaterThan(20); // real mountain
  });

  it('has three gorges (void gaps) and caps in each', () => {
    const voids = track.gaps.filter((g) => g.kind === 'void');
    expect(voids.length).toBe(3);
    for (const g of voids) {
      const inside = bouncers.caps.filter((c) => {
        const p = track.project(c.x, c.z);
        return p.route === 0 && track.deltaS(g.s0, p.s) >= 0 && track.deltaS(p.s, g.s1) >= 0;
      });
      expect(inside.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('every gorge has no ground except the caps: gorge one only orange ones, gorge two only green, the cave green (main) + orange (shortcut)', () => {
    const kindsIn = (a: string, len: number) =>
      new Set(
        bouncers.caps
          .filter((c) => {
            const p = track.project(c.x, c.z);
            return p.route === 0 && track.deltaS(track.sAt(at(a)), p.s) >= -1 && track.deltaS(p.s, track.sAt(at(a)) + len) >= -1;
          })
          .map((c) => c.kind),
      );
    expect([...kindsIn('g1a', 80)]).toEqual(['orange']);
    expect([...kindsIn('g2a', 54)]).toEqual(['green']);
    expect([...kindsIn('caveIn', 126)]).toEqual(['green']);
    expect(bouncers.caps.filter((c) => c.kind === 'orange' && track.project(c.x, c.z).route === 1).length).toBeGreaterThanOrEqual(4);
  });

  it('every orange cap has a landing, a reasonable arc (apex <= 11 m, speed <= 32 m/s) and lands on a cap or solid road', () => {
    const oranges = bouncers.caps.filter((c) => c.kind === 'orange');
    expect(oranges.length).toBeGreaterThanOrEqual(7);
    for (const c of oranges) {
      expect(c.target, `cap ${c.index}`).not.toBeNull();
      const arc = bounceArc(c.x, c.y, c.z, c.target!);
      expect(arc.apex, `cap ${c.index} apex`).toBeLessThanOrEqual(11);
      expect(arc.apex, `cap ${c.index} apex`).toBeGreaterThan(2.5); // a proper arc, not a hop
      expect(arc.speed, `cap ${c.index} speed`).toBeLessThanOrEqual(32);
      const land = bouncers.caps.find((o) => Math.hypot(o.x - c.target!.x, o.z - c.target!.z) < 0.5);
      if (!land) expect(track.sample(c.target!.x, c.target!.z), `cap ${c.index} lands on ground`).not.toBeNull();
    }
  });

  it('caps stand on the road level and inside the gorge corridor (main-road caps)', () => {
    for (const c of bouncers.caps) {
      const p = track.project(c.x, c.z);
      if (p.route !== 0) continue;
      expect(Math.abs(c.y - p.y), `cap ${c.index} height`).toBeLessThan(1);
      expect(Math.abs(p.d) + c.radius, `cap ${c.index} reach`).toBeLessThan(track.def.width / 2 + track.def.offroadWidth + 1.5);
    }
  });

  it('the cave has two routes of about the same length of time', () => {
    expect(track.branches.length).toBe(1);
    const b = track.branches[0];
    expect(b.pinned.filter(Boolean).length * b.spacing).toBeGreaterThan(100); // a long span held high over the chasm
    const lap = (bias: number) => {
      const world = new World(track, track);
      world.startRace([0], 1, undefined);
      const style = { ...botStyleFor(0), shortcutBias: bias };
      let n = 0;
      let branch = 0;
      let respawns = 0;
      while (world.race!.phase !== 'done' && n < 60 * 200) {
        for (const e of world.tick((slot) => autopilot(world.karts.get(slot)!, track, style, world.configOf(slot)))) if (e.kind === 'respawn') respawns++;
        if (track.onRoute(world.karts.get(0)!) > 0) branch++;
        n++;
      }
      return { time: world.race!.racers.get(0)!.finishTime ?? Infinity, branch, respawns };
    };
    const main = lap(0);
    const second = lap(1);
    expect(main.respawns).toBe(0);
    expect(second.respawns).toBe(0);
    expect(main.branch).toBe(0);
    expect(second.branch).toBeGreaterThan(60 * 4); // it really drove the shortcut
    expect(Math.abs(second.time - main.time)).toBeLessThan(main.time * 0.06);
  }, 60_000);
});

describe('bots race Mushroom Valley', () => {
  function race(difficulty: Difficulty, count: number) {
    const world = new World(new Track(mushroomValley), new Track(mushroomValley));
    const slots = Array.from({ length: count }, (_, i) => i);
    world.startRace(slots, 3, new Map(slots.map((s) => [s, botLoadoutFor(s)])));
    const pack = new BotPack(difficulty);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 60 * 420 && world.race!.phase !== 'done'; i++) {
      for (const e of world.tick((slot) => pack.input(world, slot))) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    }
    return { world, counts };
  }

  it.each(DIFFICULTIES)('%s bots finish 3 laps without falling into the gorges', (difficulty) => {
    const { world, counts } = race(difficulty, 4);
    expect(world.race!.phase).toBe('done');
    expect([...world.race!.racers.values()].filter((r) => r.finished).length).toBeGreaterThanOrEqual(3);
    expect(counts.respawn ?? 0).toBeLessThan(3);
    expect(counts.bounce ?? 0).toBeGreaterThan(10); // they really bounced
  }, 120_000);

  it('12 bots on hard also cross the gorges (a crowd on the caps)', () => {
    const { world, counts } = race('hard', 12);
    expect(world.race!.phase).toBe('done');
    expect(counts.respawn ?? 0).toBeLessThan(12);
  }, 180_000);
});
