import { describe, expect, it } from 'vitest';
import { TRACKS } from '../track';
import { BotPack, DIFFICULTIES, type Difficulty } from './bots';
import { botLoadoutFor } from './classes';
import { ITEMS } from './config';
import { Track } from './track';
import { World } from './world';

/**
 * One bot alone on a track. If `hitAt` is given, the bot is jumbled at that many seconds of racing.
 * Returns the race time (s) at which it reached `dist` metres, and how many ticks of the effect it spent off the road.
 */
function timeTo(track: Track, difficulty: Difficulty, hitAt: number | null, dist: number) {
  const world = new World(track, track);
  world.startRace([1], 3, new Map([[1, botLoadoutFor(1)]]));
  const pack = new BotPack(difficulty);
  let ticks = 0;
  let hit = false;
  let offroadTicks = 0;
  while (ticks < 60 * 120 && world.race!.racers.get(1)!.progress < dist) {
    const k = world.karts.get(1)!;
    if (hitAt !== null && !hit && world.race!.phase === 'racing' && world.race!.time >= hitAt) {
      k.invertTime = ITEMS.jumbleTime;
      hit = true;
    }
    world.tick((slot) => pack.input(world, slot));
    if (k.invertTime > 0 && k.surface === 'offroad') offroadTicks++;
    ticks++;
  }
  return { time: world.race!.time, offroadTicks };
}

describe('jumble hurts bots', () => {
  const tracks = TRACKS.slice(0, 4).map((def) => new Track(def));
  const HIT_TIMES = [6, 10, 14];

  /** Average seconds lost, over several tracks and hit moments, compared with the same bot left alone. */
  function averageLoss(d: Difficulty): number {
    let sum = 0;
    let n = 0;
    for (const track of tracks) {
      const clean = timeTo(track, d, null, 1200).time;
      for (const h of HIT_TIMES) {
        sum += timeTo(track, d, h, 1200).time - clean;
        n++;
      }
    }
    return sum / n;
  }

  it('a jumbled bot loses real time compared with the same bot left alone, most on easy and least on hard', () => {
    const loss = Object.fromEntries(DIFFICULTIES.map((d) => [d, averageLoss(d)])) as Record<Difficulty, number>;
    expect(loss.hard, 'hard').toBeGreaterThan(0.7);
    expect(loss.normal, 'normal').toBeGreaterThan(1.5);
    expect(loss.easy, 'easy').toBeGreaterThan(2.5);
    expect(loss.easy).toBeGreaterThan(loss.normal);
    expect(loss.normal).toBeGreaterThan(loss.hard);
  });

  it('the jumbled bot runs wide (leaves the road) while it re-learns the controls', () => {
    let off = 0;
    for (const track of tracks) off += timeTo(track, 'easy', 10, 1200).offroadTicks;
    expect(off).toBeGreaterThan(60);
  });

  it('after the effect ends the bot drives normally again (it still finishes)', () => {
    const world = new World(tracks[0], tracks[0]);
    world.startRace([1], 2, new Map([[1, botLoadoutFor(1)]]));
    const pack = new BotPack('normal');
    let ticks = 0;
    let hit = false;
    while (!world.race!.racers.get(1)!.finished && ticks < 60 * 300) {
      if (!hit && world.race!.phase === 'racing' && world.race!.time > 8) {
        world.karts.get(1)!.invertTime = ITEMS.jumbleTime;
        hit = true;
      }
      world.tick((slot) => pack.input(world, slot));
      ticks++;
    }
    expect(world.race!.racers.get(1)!.finished).toBe(true);
  });
});
