import { describe, expect, it } from 'vitest';
import { Buttons, type ControlInput } from '../shared/protocol';
import { COUNTDOWN_SECONDS, OFF_COURSE_SECONDS, Race, SKIP_CREDIT_DISTANCE } from './race';

const L = 1600;
const K = 16;
const track = { length: L, checkpoints: Array.from({ length: K }, (_, i) => (i * L) / K) };
const none = new Map<number, ControlInput>();
const DT = 1 / 60;

/** Skip the countdown with nobody pressing gas. */
function racing(slots = [0, 1], laps = 3): Race {
  const r = new Race(track, laps, slots);
  r.tick(COUNTDOWN_SECONDS + DT, new Map(slots.map((s) => [s, L - 5])), none);
  expect(r.phase).toBe('racing');
  return r;
}

/** Move a kart along the track from s0 to s1 (can exceed L) in small steps. */
function driveAlong(r: Race, slot: number, s0: number, s1: number, others = new Map<number, number>()) {
  for (let s = s0; s <= s1; s += 10) {
    r.tick(DT, new Map([...others, [slot, s % L]]), none);
  }
}

describe('lap counting', () => {
  it('starts lap 1 when crossing the line and counts 3 laps to finish', () => {
    const r = racing([0], 3);
    driveAlong(r, 0, L - 5, L + 5);
    expect(r.racers.get(0)!.lap).toBe(1);
    driveAlong(r, 0, L + 5, 3 * L + 5);
    expect(r.racers.get(0)!.lap).toBe(3);
    expect(r.racers.get(0)!.finished).toBe(false);
    driveAlong(r, 0, 3 * L + 5, 4 * L + 5);
    const me = r.racers.get(0)!;
    expect(me.finished).toBe(true);
    expect(me.place).toBe(1);
    expect(me.lapTimes.length).toBe(3);
    expect(r.phase).toBe('done');
  });

  it('cutting across the track (skipping checkpoints) does not count', () => {
    const r = racing([0], 3);
    driveAlong(r, 0, L - 5, L + 200); // lap 1, a bit in
    // Teleport-style shortcut: jump from s=200 to s=L-20, then cross the line.
    driveAlong(r, 0, L - 20, L + 10);
    expect(r.racers.get(0)!.lap).toBe(1);
  });

  it('a small forward hop over a checkpoint (<= SKIP_CREDIT_DISTANCE) is credited', () => {
    // Short checkpoint segments (12.5 m), so a 25 m hop skips one whole segment.
    const short = { length: 400, checkpoints: Array.from({ length: 32 }, (_, i) => i * 12.5) };
    const r = new Race(short, 3, [0]);
    r.tick(COUNTDOWN_SECONDS + DT, new Map([[0, 395]]), none);
    for (let s = 395; s <= 405; s += 2) r.tick(DT, new Map([[0, s % 400]]), none); // lap 1, in segment 0
    expect(r.racers.get(0)!.next).toBe(1);
    r.tick(DT, new Map([[0, 5 + SKIP_CREDIT_DISTANCE - 5]]), none); // 5 -> 30: skips segment 1, lands in 2
    expect(r.racers.get(0)!.next).toBe(3);
  });

  it('a big jump past checkpoints raises offCourse after OFF_COURSE_SECONDS, without credit', () => {
    const r = racing([0], 3);
    driveAlong(r, 0, L - 5, L + 50);
    const next = r.racers.get(0)!.next;
    const events: string[] = [];
    for (let t = 0; t < OFF_COURSE_SECONDS + 3 * DT; t += DT) {
      for (const e of r.tick(DT, new Map([[0, 450]]), none)) events.push(e.kind);
    }
    expect(events).toContain('offCourse');
    expect(r.racers.get(0)!.next).toBe(next);
  });

  it('driving backwards over the line does not count a lap', () => {
    const r = racing([0], 3);
    driveAlong(r, 0, L - 5, L + 50);
    for (let s = 50; s >= -50; s -= 10) r.tick(DT, new Map([[0, (s + L) % L]]), none);
    driveAlong(r, 0, L - 50, L + 50);
    expect(r.racers.get(0)!.lap).toBe(1);
  });
});

describe('ranking', () => {
  it('ranks by laps, then distance', () => {
    const r = racing([0, 1, 2]);
    // Everyone crosses the line
    driveAlong(r, 0, L - 5, L + 5, new Map([[1, L - 5], [2, L - 5]]));
    r.tick(DT, new Map([[0, 5], [1, 90], [2, 50]]), none); // 1 and 2 cross too (all in checkpoint 0)
    // slot 1 is furthest along lap 1
    expect(r.standings()).toEqual([1, 2, 0]);
  });

  it('finishers stay ahead of anyone still racing', () => {
    const r = racing([0, 1], 1);
    driveAlong(r, 0, L - 5, 2 * L + 5, new Map([[1, L - 5]]));
    expect(r.racers.get(0)!.finished).toBe(true);
    expect(r.positionOf(0)).toBe(1);
    expect(r.positionOf(1)).toBe(2);
  });
});

describe('countdown start', () => {
  const gas = new Map<number, ControlInput>([[0, { steer: 0, buttons: Buttons.GAS }]]);
  const pos = new Map([[0, L - 5]]);

  function countdownWithGasFrom(pressAt: number) {
    const r = new Race(track, 3, [0]);
    const events = [];
    while (r.phase === 'countdown') events.push(...r.tick(DT, pos, r.time >= pressAt ? gas : none));
    return events.map((e) => e.kind);
  }

  it('gas pressed just before GO gives a rocket start', () => {
    expect(countdownWithGasFrom(-0.5)).toContain('startBoost');
  });
  it('gas held from the very start floods the engine', () => {
    expect(countdownWithGasFrom(-3)).toContain('stall');
  });
  it('gas pressed in between does nothing special', () => {
    const k = countdownWithGasFrom(-1.5);
    expect(k).not.toContain('startBoost');
    expect(k).not.toContain('stall');
  });
});

describe('grantProgress (cannons, shortcuts)', () => {
  const seg = (i: number) => (i * L) / K + 5; // a point inside checkpoint segment i

  it('jumps a racer forward to the target segment without driving the ones in between', () => {
    const r = racing([0], 3);
    driveAlong(r, 0, L - 5, L + 5); // lap 1, next checkpoint = 1
    r.grantProgress(0, seg(6));
    expect(r.racers.get(0)!.next).toBe(7);
    // Entering segment 7 normally now counts; segment 2 (skipped) no longer does.
    r.tick(DT, new Map([[0, seg(7)]]), none);
    expect(r.racers.get(0)!.next).toBe(8);
  });

  it('is ignored for backward moves, huge skips and finished racers', () => {
    const r = racing([0], 3);
    driveAlong(r, 0, L - 5, L + 5);
    r.grantProgress(0, seg(12)); // 11 segments ahead: more than half a lap
    expect(r.racers.get(0)!.next).toBe(1);
    driveAlong(r, 0, L + 5, L + seg(5));
    r.grantProgress(0, seg(2)); // behind
    expect(r.racers.get(0)!.next).toBe(6);
  });

  it('counts a lap when the skip crosses the start line, and can finish a race', () => {
    const r = racing([0], 1);
    driveAlong(r, 0, L - 5, L + seg(13)); // lap 1, next = 14
    const ev = r.grantProgress(0, seg(1)); // across the line into lap 2 > 1 lap total
    expect(ev.map((e) => e.kind)).toEqual(expect.arrayContaining(['lap', 'finish']));
    expect(r.racers.get(0)!.finished).toBe(true);
  });

  it('ranking stays consistent after a skip', () => {
    const r = racing([0, 1], 3);
    driveAlong(r, 0, L - 5, L + 5, new Map([[1, L - 5]]));
    driveAlong(r, 1, L - 5, L + 5);
    r.grantProgress(0, seg(5));
    r.tick(DT, new Map([[0, seg(5)], [1, 20]]), none);
    expect(r.standings()[0]).toBe(0);
  });
});

describe('perfect start and photo finish', () => {
  const gas = new Map<number, ControlInput>([[0, { steer: 0, buttons: Buttons.GAS }]]);
  const pos = new Map([[0, L - 5]]);
  const startEvents = (pressAt: number) => {
    const r = new Race(track, 3, [0]);
    const events: { kind: string; perfect?: boolean }[] = [];
    while (r.phase === 'countdown') events.push(...r.tick(DT, pos, r.time >= pressAt ? gas : none));
    return events;
  };

  it('gas within 0.3 s of GO is a PERFECT start; earlier (but inside the window) is a normal rocket start', () => {
    const perfect = startEvents(-0.2);
    expect(perfect.map((e) => e.kind)).toContain('perfectStart');
    expect(perfect.find((e) => e.kind === 'startBoost')!.perfect).toBe(true);
    const normal = startEvents(-0.6);
    expect(normal.map((e) => e.kind)).not.toContain('perfectStart');
    expect(normal.find((e) => e.kind === 'startBoost')!.perfect).toBe(false);
  });

  it('two karts finishing within 0.15 s raise photoFinish; further apart does not', () => {
    const finishBoth = (gapSeconds: number) => {
      const r = racing([0, 1], 1);
      const events: { kind: string }[] = [];
      const step = (s0: number, s1: number) => events.push(...r.tick(DT, new Map([[0, s0 % L], [1, s1 % L]]), none));
      // Both karts drive the whole race side by side, then kart 0 crosses the final line and kart 1 follows later.
      for (let s = L - 5; s <= 2 * L - 15; s += 10) step(s, s);
      step(5, 2 * L - 15);
      expect(r.racers.get(0)!.finished).toBe(true);
      for (let i = 0; i < Math.round(gapSeconds / DT); i++) step(5, 2 * L - 15);
      step(5, 5);
      expect(r.racers.get(1)!.finished).toBe(true);
      return events;
    };
    expect(finishBoth(0.05).map((e) => e.kind)).toContain('photoFinish');
    expect(finishBoth(1).map((e) => e.kind)).not.toContain('photoFinish');
  });
});

