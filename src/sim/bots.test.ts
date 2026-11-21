import { describe, expect, it } from 'vitest';
import { NEUTRAL_INPUT, type ControlInput } from '../shared/protocol';
import { TRACKS } from '../track';
import { BotPack, DIFFICULTIES, RIVAL_HUMAN_BIAS, nextDifficulty, pickRival, rubberBand, sanitizeDifficulty, type Difficulty } from './bots';
import { botLoadoutFor } from './classes';
import { BOTS } from './config';
import { Track } from './track';
import { World } from './world';

const tracks = TRACKS.map((def) => [def.name, new Track(def)] as const);

/** All four slots driven by bots of one difficulty; runs the whole race (or the time limit). */
function raceOfBots(track: Track, difficulty: Difficulty, laps = track.def.laps) {
  const world = new World(track, track);
  const slots = [0, 1, 2, 3];
  world.startRace(slots, laps, new Map(slots.map((s) => [s, botLoadoutFor(s)])));
  const pack = new BotPack(difficulty);
  let ticks = 0;
  while (world.race!.phase !== 'done' && ticks < 60 * 420) {
    world.tick((slot) => pack.input(world, slot));
    ticks++;
  }
  return world;
}

/** One bot alone on the track; returns its finish time (Infinity = did not finish). `idleHuman` adds a parked human on the grid. */
function soloTime(track: Track, difficulty: Difficulty, laps: number, idleHuman = false): number {
  const world = new World(track, track);
  const slots = idleHuman ? [0, 1] : [1];
  world.startRace(slots, laps, new Map(slots.map((s) => [s, botLoadoutFor(1)])));
  const pack = new BotPack(difficulty, (slot) => slot === 0);
  let ticks = 0;
  const input = (slot: number): ControlInput => (slot === 0 ? NEUTRAL_INPUT : pack.input(world, slot));
  while (!world.race!.racers.get(1)!.finished && ticks < 60 * 420) {
    world.tick(input);
    ticks++;
  }
  return world.race!.racers.get(1)!.finishTime ?? Infinity;
}

describe('difficulty helpers', () => {
  it('cycles easy -> normal -> hard -> easy and sanitises stored values', () => {
    expect(DIFFICULTIES).toEqual(['easy', 'normal', 'hard']);
    expect(nextDifficulty('easy')).toBe('normal');
    expect(nextDifficulty('hard')).toBe('easy');
    expect(sanitizeDifficulty('hard')).toBe('hard');
    expect(sanitizeDifficulty('nonsense')).toBe('normal');
    expect(sanitizeDifficulty(null)).toBe('normal');
  });
});

describe('rubber band', () => {
  it('does nothing inside the dead zone and is bounded far away', () => {
    expect(rubberBand(0)).toBe(1);
    expect(rubberBand(BOTS.rubber.deadZone)).toBe(1);
    expect(rubberBand(-BOTS.rubber.deadZone)).toBe(1);
    for (const d of [-5000, -400, -100, -31, 31, 100, 400, 5000]) {
      const m = rubberBand(d);
      expect(m).toBeGreaterThanOrEqual(1 - BOTS.rubber.maxEase - 1e-12);
      expect(m).toBeLessThanOrEqual(1 + BOTS.rubber.maxBoost + 1e-12);
    }
  });
  it('eases off when ahead, speeds up when behind, and grows steadily with the gap', () => {
    expect(rubberBand(100)).toBeLessThan(1);
    expect(rubberBand(-100)).toBeGreaterThan(1);
    expect(rubberBand(150)).toBeLessThan(rubberBand(80));
    expect(rubberBand(-150)).toBeGreaterThan(rubberBand(-80));
    expect(rubberBand(10_000)).toBeCloseTo(1 - BOTS.rubber.maxEase, 9);
    expect(rubberBand(-10_000)).toBeCloseTo(1 + BOTS.rubber.maxBoost, 9);
  });
  it('a bot that leads a parked human slows down, but only a little', () => {
    const t = tracks[0][1];
    const alone = soloTime(t, 'normal', 2);
    const withHuman = soloTime(t, 'normal', 2, true);
    expect(withHuman).toBeGreaterThan(alone); // it really eased off...
    expect(withHuman).toBeLessThan(alone / (1 - BOTS.rubber.maxEase) + 2); // ...but never by more than the cap allows
  });
});

describe('bot difficulty', () => {
  // Lap-time ordering on every track: easy slower than normal slower than hard.
  describe.each(tracks)('on %s', (_name, track) => {
    it('lap times: easy > normal > hard', () => {
      const [easy, normal, hard] = DIFFICULTIES.map((d) => soloTime(track, d, 2));
      expect(hard).toBeLessThan(Infinity);
      expect(easy).toBeGreaterThan(normal * 1.01);
      expect(normal).toBeGreaterThan(hard * 1.01);
    }, 120_000);
  });
});

describe('4 bots finish every track on every difficulty', () => {
  describe.each(tracks)('on %s', (_name, track) => {
    it.each(DIFFICULTIES)('%s', (difficulty) => {
      const world = raceOfBots(track, difficulty);
      const race = world.race!;
      expect(race.phase).toBe('done');
      const racers = [...race.racers.values()];
      // The race ends when the second-to-last kart finishes, so the last kart is a DNF (and a slow easy bot may be cut off); it must still have driven nearly all of it.
      const total = track.def.laps * track.length;
      for (const r of racers) {
        if (difficulty === 'easy') expect(r.finished || r.progress > total * 0.9, `slot ${r.slot}`).toBe(true);
        else expect(r.finished || (r.place === racers.length && r.progress > total * 0.9), `slot ${r.slot}`).toBe(true);
      }
      expect(racers.some((r) => r.finished)).toBe(true);
    }, 120_000);
  });
});

describe('bots drive with style', () => {
  it('on a track with corners, normal and hard bots drift and release mini-turbos, and everyone does tricks off ramps', () => {
    const track = tracks.find(([n]) => n === 'Switchback Summit')![1];
    const world = new World(track, track);
    const slots = [0, 1, 2, 3];
    world.startRace(slots, 2, new Map(slots.map((s) => [s, botLoadoutFor(s)])));
    const pack = new BotPack('hard');
    const counts: Record<string, number> = {};
    for (let i = 0; i < 60 * 150 && world.race!.phase !== 'done'; i++) {
      for (const e of world.tick((s) => pack.input(world, s))) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    }
    expect(counts.miniTurbo ?? 0).toBeGreaterThan(3);
    expect(counts.trickBoost ?? 0).toBeGreaterThan(3);
    expect(counts.perfectStart ?? 0).toBeGreaterThan(0); // hard bots time the rocket start well
  }, 120_000);

  it('combo: a trick, a mini-turbo and a slingshot in a row give a combo event and a longer boost', () => {
    const track = tracks[0][1];
    const world = new World(track, track);
    world.startRace([0], 1);
    world.race!.time = 5; // pretend we are racing (the combo window uses the race clock)
    const k = world.karts.get(0)!;
    const events: unknown[] = [];
    const note = (move: 'trick' | 'miniTurbo' | 'slipstream') => (world as unknown as { noteStyle: (...a: unknown[]) => void }).noteStyle(0, move, k, events);
    note('trick');
    note('miniTurbo');
    expect(events).toEqual([]);
    k.boostTime = 1;
    note('slipstream');
    expect(events).toEqual([{ kind: 'combo', slot: 0 }]);
    expect(k.boostTime).toBeGreaterThan(1.9);
  });
});

describe('bot character: rivals and moods', () => {
  const others = [
    { slot: 0, progress: 100, human: true },
    { slot: 1, progress: 480, human: false },
    { slot: 2, progress: 560, human: true },
  ];

  it('picks the nearest human most of the time, the nearest kart otherwise', () => {
    // Always "human" when the random number is below the bias, always "anyone" above it.
    expect(pickRival(500, others, () => 0)).toBe(2);
    expect(pickRival(500, others, () => RIVAL_HUMAN_BIAS + 0.01)).toBe(1);
    expect(pickRival(150, others, () => 0)).toBe(0);
  });

  it('works with no humans, no one at all, and breaks distance ties by slot', () => {
    expect(pickRival(0, [{ slot: 3, progress: 50, human: false }], () => 0)).toBe(3);
    expect(pickRival(0, [], () => 0)).toBeNull();
    expect(pickRival(100, [{ slot: 5, progress: 110, human: true }, { slot: 4, progress: 90, human: true }], () => 0)).toBe(4);
  });

  it('over many draws about three quarters of the picks are the nearest human', () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let human = 0;
    for (let i = 0; i < 2000; i++) if (pickRival(500, others, rnd) === 2) human++;
    expect(human / 2000).toBeGreaterThan(0.68);
    expect(human / 2000).toBeLessThan(0.82);
  });

  it('a bot next to a human chooses a rival in a real race, and the bots show moods', () => {
    const track = tracks[0][1];
    const world = new World(track, track);
    const slots = [0, 1, 2, 3];
    world.startRace(slots, 2, new Map(slots.map((s) => [s, botLoadoutFor(s)])));
    const pack = new BotPack('hard', (slot) => slot === 0);
    const moods = new Set<string>();
    let ticks = 0;
    while (world.race!.phase !== 'done' && ticks < 60 * 420) {
      world.tick((slot) => (slot === 0 ? NEUTRAL_INPUT : pack.input(world, slot)));
      for (const e of pack.drainEvents()) moods.add(e.mood);
      ticks++;
    }
    for (const bot of [1, 2, 3]) expect(pack.rivalOf(bot)).not.toBeNull();
    expect(moods.size).toBeGreaterThan(0);
    expect(world.race!.racers.get(1)!.place).not.toBeNull(); // placed (bot 1 may be the DNF last kart)
  }, 120_000);
});
