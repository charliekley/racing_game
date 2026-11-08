import { describe, expect, it } from 'vitest';
import { Buttons, type ControlInput } from '../shared/protocol';
import { COUNTDOWN_SECONDS, Race } from './race';

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
