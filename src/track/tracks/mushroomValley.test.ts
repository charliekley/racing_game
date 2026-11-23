import { describe, expect, it } from 'vitest';
import { autopilot, botStyleFor } from '../../sim/autopilot';
import { Bouncers, bounceArc } from '../../sim/bouncers';
import { BotPack, DIFFICULTIES, type Difficulty } from '../../sim/bots';
import { botLoadoutFor } from '../../sim/classes';
import { Track } from '../../sim/track';
import { World } from '../../sim/world';
import { layoutStats } from '../layoutStats';
import { CAVE_LEN, G1_LEN, G2_LEN, G3_LEN, at, mushroomValley } from './mushroomValley';

describe('Mushroom Valley', () => {
  const track = new Track(mushroomValley);
  const stats = layoutStats(track);
  const bouncers = new Bouncers(track);

  it('is 1.5 to 2.0 km long, a real mountain: slopes up to about 16 % and a height range over 40 m', () => {
    expect(track.length).toBeGreaterThan(1500);
    expect(track.length).toBeLessThan(2000);
    expect(stats.heightRange).toBeGreaterThan(40);
    expect(stats.maxClimb).toBeGreaterThan(0.12); // switchbacks that really climb
    expect(stats.maxClimb).toBeLessThan(0.2);
    expect(stats.maxDrop).toBeLessThan(0.2);
  });

  it('is a mountain road all the way round: at least three hairpins and plenty of bends', () => {
    expect(stats.tightCorners).toBeGreaterThanOrEqual(8);
    expect(stats.steepShare).toBeGreaterThan(0.2); // much of the lap is a climb or a descent
    // The mountain: the lap spends little time near the starting height.
    const low = track.samples.filter((p) => p.y < 36).length / track.samples.length;
    expect(low).toBeLessThan(0.25);
  });

  it('has four chasms (void gaps): three gorges and the cave', () => {
    const voids = track.gaps.filter((g) => g.kind === 'void');
    expect(voids.length).toBe(4);
    for (const g of voids) {
      const inside = bouncers.caps.filter((c) => {
        const p = track.project(c.x, c.z);
        return p.route === 0 && track.deltaS(g.s0, p.s) >= 0 && track.deltaS(p.s, g.s1) >= 0;
      });
      expect(inside.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('every chasm has no ground except the caps: Sky Leap only orange, Stepping Stones green, Twin Spans and the cave green on the main road + orange shortcuts', () => {
    const kindsIn = (a: string, len: number) =>
      new Set(
        bouncers.caps
          .filter((c) => {
            const p = track.project(c.x, c.z);
            return p.route === 0 && track.deltaS(track.sAt(at(a)), p.s) >= -1 && track.deltaS(p.s, track.sAt(at(a)) + len) >= -1;
          })
          .map((c) => c.kind),
      );
    expect([...kindsIn('g1a', G1_LEN)]).toEqual(['orange']);
    expect([...kindsIn('g2a', G2_LEN)]).toEqual(['green']);
    expect([...kindsIn('g3a', G3_LEN)]).toEqual(['green']);
    expect([...kindsIn('caveIn', CAVE_LEN)]).toEqual(['green']);
    // The two dirt shortcuts: orange caps hold them over the pits.
    expect(bouncers.caps.filter((c) => c.kind === 'orange' && track.project(c.x, c.z).route === 1).length).toBeGreaterThanOrEqual(3);
    expect(bouncers.caps.filter((c) => c.kind === 'orange' && track.project(c.x, c.z).route === 2).length).toBeGreaterThanOrEqual(4);
  });

  it('every orange cap has a landing, an arc (apex 2..11 m, speed <= 45 m/s) and lands on a cap or solid ground', () => {
    const oranges = bouncers.caps.filter((c) => c.kind === 'orange');
    expect(oranges.length).toBeGreaterThanOrEqual(8);
    let biggest = 0;
    for (const c of oranges) {
      expect(c.target, `cap ${c.index}`).not.toBeNull();
      const arc = bounceArc(c.x, c.y, c.z, c.target!, c.air);
      biggest = Math.max(biggest, arc.apex);
      expect(arc.apex, `cap ${c.index} apex`).toBeLessThanOrEqual(11);
      expect(arc.apex, `cap ${c.index} apex`).toBeGreaterThan(2); // a proper arc, not a hop
      expect(arc.speed, `cap ${c.index} speed`).toBeLessThanOrEqual(45); // (the shortcut hops are fast and flat: that is what makes the orange route quicker)
      const land = bouncers.caps.find((o) => Math.hypot(o.x - c.target!.x, o.z - c.target!.z) < 0.5);
      if (!land) {
        const ground = track.sample(c.target!.x, c.target!.z);
        expect(ground, `cap ${c.index} lands on ground`).not.toBeNull();
        // ...and the ground there is at the height the arc was worked out for (no landing in a pit)
        expect(Math.abs(ground!.height - c.target!.y)).toBeLessThan(0.5);
        expect(c.target!.y, `cap ${c.index} lands near its own height`).toBeGreaterThan(c.y - 5);
      }
    }
    expect(biggest, 'one big dramatic bounce').toBeGreaterThan(8);
  });

  it('caps stand on the road level and inside the gorge corridor (main-road caps), and are big (radius 6 to 12 m)', () => {
    for (const c of bouncers.caps) {
      expect(c.radius).toBeGreaterThanOrEqual(6);
      expect(c.radius).toBeLessThanOrEqual(12);
      const p = track.project(c.x, c.z);
      if (p.route !== 0) continue;
      expect(Math.abs(c.y - p.y), `cap ${c.index} height`).toBeLessThan(1);
      expect(Math.abs(p.d) + c.radius, `cap ${c.index} reach`).toBeLessThan(track.def.width / 2 + track.def.offroadWidth + 1.5);
    }
  });

  it('has two choices per lap (Twin Spans and the cave), each about the same time either way', () => {
    expect(track.branches.length).toBe(2);
    for (const b of track.branches) expect(b.pinned.filter(Boolean).length * b.spacing).toBeGreaterThan(60); // a long span held high over a chasm
    const lap = (bias: number) => {
      const world = new World(track, track);
      world.startRace([0], 1, undefined);
      const style = { ...botStyleFor(0), shortcutBias: bias };
      let n = 0;
      const onRoute = [0, 0, 0];
      let respawns = 0;
      while (world.race!.phase !== 'done' && n < 60 * 200) {
        for (const e of world.tick((slot) => autopilot(world.karts.get(slot)!, track, style, world.configOf(slot)))) if (e.kind === 'respawn') respawns++;
        onRoute[track.onRoute(world.karts.get(0)!)]++;
        n++;
      }
      return { time: world.race!.racers.get(0)!.finishTime ?? Infinity, onRoute, respawns };
    };
    const main = lap(0);
    const second = lap(1);
    expect(main.respawns).toBe(0);
    expect(second.respawns).toBe(0);
    expect(main.onRoute[1] + main.onRoute[2]).toBe(0);
    expect(second.onRoute[1]).toBeGreaterThan(60 * 2); // it really drove both shortcuts
    expect(second.onRoute[2]).toBeGreaterThan(60 * 4);
    expect(Math.abs(second.time - main.time)).toBeLessThan(main.time * 0.07);
    // A lap takes about as long as on the other tracks (a minute to a minute and a quarter).
    expect(main.time).toBeGreaterThan(55);
    expect(main.time).toBeLessThan(80);
  }, 60_000);

  it('has item box rows before and after every crossing', () => {
    for (const g of track.gaps.filter((x) => x.kind === 'void')) {
      const before = track.itemBoxes.some((b) => track.deltaS(b.s, g.s0) > 0 && track.deltaS(b.s, g.s0) < 170);
      const after = track.itemBoxes.some((b) => track.deltaS(g.s1, b.s) > 0 && track.deltaS(g.s1, b.s) < 170);
      expect(before, `a row before the chasm at s=${g.s0.toFixed(0)}`).toBe(true);
      expect(after, `a row after the chasm at s=${g.s0.toFixed(0)}`).toBe(true);
    }
  });
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
    expect(counts.bounce ?? 0).toBeGreaterThan(5); // they really bounced (the Sky Leap once a lap, more on the shortcuts)
  }, 120_000);

  it('12 bots on hard also cross the gorges (a crowd on the caps)', () => {
    const { world, counts } = race('hard', 12);
    expect(world.race!.phase).toBe('done');
    expect(counts.respawn ?? 0).toBeLessThan(12);
  }, 180_000);
});
