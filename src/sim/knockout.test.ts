import { describe, expect, it } from 'vitest';
import { NEUTRAL_INPUT } from '../shared/protocol';
import { TRACKS } from '../track';
import { BotPack } from './bots';
import { botLoadoutFor } from './classes';
import { Knockout, knockoutLaps, knockoutsPerLap, type Contender } from './knockout';
import { Race, COUNTDOWN_SECONDS, type RaceEvent } from './race';
import { Track } from './track';
import { World } from './world';

const c = (slot: number, progress: number, lapStartTime = 0): Contender => ({ slot, progress, lapStartTime });

describe('Knockout rules', () => {
  it('lap counts: 5 on short tracks, otherwise laps + 2, capped, never fewer than the racers', () => {
    expect(knockoutLaps(3, 500)).toBe(5);
    expect(knockoutLaps(3, 1200)).toBe(5);
    expect(knockoutLaps(4, 1200)).toBe(6);
    expect(knockoutLaps(9, 1200)).toBe(6); // capped
    expect(knockoutLaps(2, 400)).toBe(5);
    expect(knockoutLaps(1, 1200, 4)).toBe(4);
  });

  it('knocks out the last kart each lap from lap 2 on; places are the reverse of the knockout order', () => {
    const ko = new Knockout([0, 1, 2, 3]);
    expect(ko.round(1, [c(0, 500), c(1, 400), c(2, 300), c(3, 200)])).toBeNull(); // lap 1 is free
    const e2 = ko.round(2, [c(0, 900), c(1, 800), c(2, 700), c(3, 600)])!;
    expect(e2).toEqual({ slot: 3, place: 4, lap: 2 });
    const e3 = ko.round(3, [c(0, 1500), c(1, 1200), c(2, 1300)])!; // (slot 3 is gone: not a contender any more)
    expect(e3).toEqual({ slot: 1, place: 3, lap: 3 });
    expect(ko.winner()).toBeNull();
    const e4 = ko.round(4, [c(0, 2000), c(2, 1900)])!;
    expect(e4).toEqual({ slot: 2, place: 2, lap: 4 });
    expect(ko.winner()).toBe(0);
    expect(ko.eliminated.map((e) => e.slot)).toEqual([3, 1, 2]);
  });

  it('each lap knocks out at most one kart, however many karts cross the line', () => {
    const ko = new Knockout([0, 1, 2]);
    expect(ko.round(2, [c(0, 900), c(1, 800), c(2, 700)])?.slot).toBe(2);
    expect(ko.round(2, [c(0, 900), c(1, 800)])).toBeNull();
    expect(ko.alive).toEqual([0, 1]);
  });

  it('ties are broken by who crossed the line later, then by the higher slot', () => {
    const a = new Knockout([0, 1, 2]);
    expect(a.round(2, [c(0, 900), c(1, 700, 40), c(2, 700, 41)])?.slot).toBe(2); // 2 started its lap later
    const b = new Knockout([0, 1, 2]);
    expect(b.round(2, [c(0, 900), c(1, 700, 40), c(2, 700, 40)])?.slot).toBe(2); // exact tie: higher slot
  });

  it('a respawning kart (distance not growing) is simply last by distance', () => {
    const ko = new Knockout([0, 1, 2]);
    // slot 1 fell off and was put back at its checkpoint: its distance is behind slot 2's
    expect(ko.round(2, [c(0, 1000), c(1, 650), c(2, 800)])?.slot).toBe(1);
  });

  it('with only one kart (or one left) nothing happens and there is no winner', () => {
    const solo = new Knockout([5]);
    expect(solo.round(2, [c(5, 100)])).toBeNull();
    expect(solo.winner()).toBeNull();
    const ko = new Knockout([0, 1]);
    ko.round(2, [c(0, 10), c(1, 5)]);
    expect(ko.round(3, [c(0, 20)])).toBeNull();
    expect(ko.winner()).toBe(0);
  });

  it('a player who leaves is out at once; the survivor wins when alone', () => {
    const ko = new Knockout([0, 1, 2]);
    expect(ko.drop(1)).toEqual({ slot: 1, place: 3, lap: 0 });
    expect(ko.drop(1)).toBeNull();
    expect(ko.winner()).toBeNull();
    expect(ko.drop(2)?.place).toBe(2);
    expect(ko.winner()).toBe(0);
  });
});

// --- Inside a Race: driven with made-up distances ---------------------------------------------------

const L = 1000;
const info = { length: L, checkpoints: Array.from({ length: 8 }, (_, i) => (i * L) / 8) };

/** Drives racers by hand: each `step` moves the given karts to a distance and ticks. */
function rig(slots: number[], laps = 5, knockout = true) {
  const race = new Race(info, laps, slots, { knockout });
  const dist = new Map<number, number>(slots.map((s) => [s, 0] as [number, number]));
  const events: RaceEvent[] = [];
  race.tick(COUNTDOWN_SECONDS + 0.01, dist, new Map());
  const tick = (move: Record<number, number>) => {
    for (const [s, v] of Object.entries(move)) dist.set(Number(s), v);
    events.push(...race.tick(1 / 60, dist, new Map()));
  };
  /** Take a kart along the track to `s` (every 40 m, so no checkpoint is skipped). */
  const drive = (slot: number, from: number, to: number) => {
    for (let s = from; s <= to; s += 40) tick({ [slot]: s % L });
    tick({ [slot]: to % L });
  };
  return { race, events, tick, drive, dist };
}

describe('Knockout inside the race', () => {
  it('the last kart is out when the first one finishes lap 2; the survivor wins when alone', () => {
    const { race, events, drive } = rig([0, 1, 2]);
    drive(0, 0, L + 5); // slot 0 finishes lap 1: a free lap, nobody goes
    drive(1, 0, L - 80);
    drive(2, 0, L - 200);
    expect(events.some((e) => e.kind === 'knockout')).toBe(false);
    drive(0, L + 5, 2 * L + 5); // slot 0 finishes lap 2 while slot 2 is the furthest behind
    expect(events.filter((e) => e.kind === 'knockout')).toEqual([{ kind: 'knockout', slot: 2, place: 3, lap: 2 }]);
    expect(race.racers.get(2)!.out).toBe(true);
    expect(race.standings()).toEqual([0, 1, 2]);
    // Lap 3 ends: of the two left slot 1 is behind, so it is out and slot 0 wins.
    drive(1, L - 80, L + 300);
    drive(0, 2 * L + 5, 3 * L + 5);
    expect(race.racers.get(1)!.out).toBe(true);
    expect(race.racers.get(0)!.finished).toBe(true);
    expect(race.racers.get(0)!.place).toBe(1);
    expect(race.phase).toBe('done');
    expect(race.standings()).toEqual([0, 1, 2]);
    expect(race.racers.get(1)!.place).toBe(2);
    expect(race.racers.get(2)!.place).toBe(3);
    expect(events.some((e) => e.kind === 'finish' && e.slot === 0 && e.place === 1)).toBe(true);
  });

  it('a knocked-out kart no longer moves in the ranking or triggers anything', () => {
    const { race, events, drive, dist } = rig([0, 1]);
    drive(0, 0, 2 * L + 5); // laps 1 and 2 done: slot 1 sits on the grid and goes
    expect(race.racers.get(1)!.out).toBe(true);
    const before = race.racers.get(1)!.progress;
    dist.set(1, 500);
    drive(1, 0, 600);
    expect(race.racers.get(1)!.progress).toBe(before);
    expect(events.filter((e) => e.kind === 'knockout')).toHaveLength(1);
  });

  it('a player leaving is out immediately and the other one wins', () => {
    const { race } = rig([0, 1]);
    race.removeRacer(1);
    const evs = race.tick(1 / 60, new Map([[0, 0], [1, 0]]), new Map());
    expect(evs).toContainEqual({ kind: 'knockout', slot: 1, place: 2, lap: 0 });
    expect(evs.some((e) => e.kind === 'finish' && e.slot === 0)).toBe(true);
    expect(race.phase).toBe('done');
  });

  it('a normal race never knocks anybody out', () => {
    const { race, events, drive } = rig([0, 1], 3, false);
    drive(0, 0, 3 * L + 5);
    expect(events.some((e) => e.kind === 'knockout')).toBe(false);
    expect(race.racers.get(1)!.out).toBe(false);
  });
});

// --- In the world: lifted away, bots finish a whole Knockout race --------------------------------------

describe('Knockout in the world', () => {
  const track = new Track(TRACKS[0]);

  it('4 bots race a Knockout: one kart is lifted away per lap and the last one standing wins', () => {
    const world = new World(track, track);
    const slots = [0, 1, 2, 3];
    world.startRace(slots, knockoutLaps(track.def.laps, track.length, 4), new Map(slots.map((s) => [s, botLoadoutFor(s)])), { knockout: true });
    const pack = new BotPack('normal');
    const outs: { slot: number; place: number; lap: number; tick: number }[] = [];
    let ticks = 0;
    while (world.race!.phase !== 'done' && ticks < 60 * 600) {
      for (const e of world.tick((slot) => pack.input(world, slot))) if (e.kind === 'knockout') outs.push({ slot: e.slot, place: e.place, lap: e.lap, tick: ticks });
      ticks++;
    }
    for (let i = 0; i < 60 * 3; i++) world.tick((slot) => pack.input(world, slot)); // (the results screen waits a moment: the carrier finishes the lift)
    const race = world.race!;
    expect(race.phase).toBe('done');
    expect(outs.map((o) => o.place)).toEqual([4, 3, 2]);
    expect(outs.map((o) => o.lap)).toEqual([2, 3, 4]);
    const winner = [...race.racers.values()].find((r) => r.finished)!;
    expect(winner.place).toBe(1);
    expect(race.standings()[0]).toBe(winner.slot);
    expect(race.standings().slice(1)).toEqual(outs.map((o) => o.slot).reverse());
    // The knocked-out karts are carried up into the air and stay there.
    for (const o of outs) expect(world.karts.get(o.slot)!.pos.y).toBeGreaterThan(20);
    // The bots showed their feelings along the way.
    expect(pack.drainEvents().some((e) => e.mood === 'despair')).toBe(true);
  }, 120_000);

  it('a human who does not drive is knocked out first', () => {
    const world = new World(track, track);
    const slots = [0, 1, 2];
    world.startRace(slots, 5, new Map(slots.map((s) => [s, botLoadoutFor(s)])), { knockout: true });
    const pack = new BotPack('normal', (slot) => slot === 0);
    let first: number | null = null;
    let ticks = 0;
    while (world.race!.phase !== 'done' && ticks < 60 * 600) {
      for (const e of world.tick((slot) => (slot === 0 ? NEUTRAL_INPUT : pack.input(world, slot)))) if (e.kind === 'knockout') first ??= e.slot;
      ticks++;
    }
    expect(first).toBe(0);
    expect(world.race!.phase).toBe('done');
  }, 120_000);
});

// --- Knockout with 8 and 12 karts: several karts go out per lap ----------------------------------------

describe('Knockout with a big field', () => {
  it('knocks out 1 / 2 / 3 karts per lap for 4 / 8 / 12 racers and needs at most 6 laps', () => {
    expect([4, 6, 8, 12].map(knockoutsPerLap)).toEqual([1, 1, 2, 3]);
    expect(knockoutLaps(3, 1200, 4)).toBe(5);
    expect(knockoutLaps(1, 1200, 4)).toBe(4);
    expect(knockoutLaps(1, 1200, 8)).toBe(5);
    expect(knockoutLaps(1, 1200, 12)).toBe(6);
    expect(knockoutLaps(9, 1200, 12)).toBe(6); // capped like the others
  });

  it('roundAll removes the last 3 of 12 at once, worst first, with places 12, 11, 10', () => {
    const slots = Array.from({ length: 12 }, (_, i) => i);
    const ko = new Knockout(slots);
    const contenders: Contender[] = slots.map((s) => ({ slot: s, progress: 1000 - s * 10, lapStartTime: 60 }));
    const out = ko.roundAll(2, contenders);
    expect(out.map((e) => e.slot)).toEqual([11, 10, 9]);
    expect(out.map((e) => e.place)).toEqual([12, 11, 10]);
    expect(ko.roundAll(2, contenders)).toEqual([]); // once per lap
    expect(ko.alive.length).toBe(9);
  });

  it('12 bots race a Knockout: 3 go out per lap and a single kart is left at the end', () => {
    const track = new Track(TRACKS[0]);
    const world = new World(track, track);
    const slots = Array.from({ length: 12 }, (_, i) => i);
    const laps = knockoutLaps(track.def.laps, track.length, 12);
    world.startRace(slots, laps, new Map(slots.map((s) => [s, botLoadoutFor(s)])), { knockout: true });
    const pack = new BotPack('normal');
    const outs: { place: number; lap: number }[] = [];
    let ticks = 0;
    while (world.race!.phase !== 'done' && ticks < 60 * 600) {
      for (const e of world.tick((slot) => pack.input(world, slot))) if (e.kind === 'knockout') outs.push({ place: e.place, lap: e.lap });
      ticks++;
    }
    const race = world.race!;
    expect(race.phase).toBe('done');
    expect(laps).toBe(6);
    expect(outs.length).toBe(11); // all but the winner
    expect(outs.map((o) => o.place)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    expect(outs.map((o) => o.lap)).toEqual([2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5]); // 3 per lap from lap 2
    expect(race.standings().length).toBe(12);
    expect(new Set(race.standings()).size).toBe(12);
    expect(race.racers.get(race.standings()[0])!.place).toBe(1);
  }, 300_000);
});
