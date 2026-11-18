import { describe, expect, it } from 'vitest';
import { WRONG_WAY_AFTER, WRONG_WAY_SPEED, WrongWayDetector, speedAlongTrack } from './wrongWay';

const DT = 1 / 60;
/** Run the detector for `seconds`; returns the last answer. */
function run(d: WrongWayDetector, seconds: number, along: number, excluded = false): boolean {
  let on = false;
  for (let t = 0; t < seconds; t += DT) on = d.update(DT, along, excluded);
  return on;
}

describe('WrongWayDetector', () => {
  it('projects velocity on the track direction', () => {
    expect(speedAlongTrack(0, -10, 0, 1)).toBe(-10); // driving -z on a road that runs +z
    expect(speedAlongTrack(5, 0, 1, 0)).toBe(5);
  });

  it('shows the sign only after 1.5 s of driving backwards', () => {
    const d = new WrongWayDetector();
    expect(run(d, WRONG_WAY_AFTER - 0.1, -10)).toBe(false);
    expect(run(d, 0.2, -10)).toBe(true);
  });

  it('ignores slow movement and the right direction', () => {
    expect(run(new WrongWayDetector(), 5, 12)).toBe(false);
    expect(run(new WrongWayDetector(), 5, -(WRONG_WAY_SPEED - 0.5))).toBe(false); // barely rolling back
  });

  it('clears as soon as the kart turns round', () => {
    const d = new WrongWayDetector();
    expect(run(d, 2, -10)).toBe(true);
    expect(d.update(DT, 4, false)).toBe(false);
    // ...and the timer starts from zero again
    expect(run(d, WRONG_WAY_AFTER - 0.1, -10)).toBe(false);
  });

  it('never shows while respawning, in a cannon or spinning (excluded) and restarts the timer afterwards', () => {
    const d = new WrongWayDetector();
    expect(run(d, 5, -10, true)).toBe(false);
    run(d, 1.2, -10);
    expect(run(d, 1, -10, true)).toBe(false); // an excluded state in the middle resets the count
    expect(run(d, 1, -10)).toBe(false);
    expect(run(d, 1, -10)).toBe(true);
  });
});
