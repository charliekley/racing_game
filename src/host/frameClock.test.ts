import { describe, expect, it } from 'vitest';
import { FrameClock } from './frameClock';

/** Feed a list of gaps (ms) as successive rAF timestamps; returns the dts handed out. */
function run(clock: FrameClock, gaps: number[], start = 1000): number[] {
  let t = start;
  const out = [clock.tick(t)];
  for (const g of gaps) {
    t += g;
    out.push(clock.tick(t));
  }
  return out;
}

const std = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

describe('FrameClock', () => {
  it('first frame returns 0', () => {
    expect(new FrameClock().tick(5000)).toBe(0);
  });

  it('removes timestamp jitter on a steady 60 Hz display', () => {
    const gaps = Array.from({ length: 300 }, (_, i) => 16.67 + Math.sin(i * 1.7) * 1.2);
    const out = run(new FrameClock(), gaps).slice(20);
    expect(std(out)).toBeLessThan(std(gaps.map((g) => g / 1000)) * 0.4);
  });

  it('never drifts away from real time', () => {
    const gaps = Array.from({ length: 1200 }, (_, i) => 16.0 + (i % 5) * 0.5); // average 17 ms
    const out = run(new FrameClock(), gaps);
    const real = gaps.reduce((a, b) => a + b, 0) / 1000;
    const given = out.reduce((a, b) => a + b, 0);
    expect(Math.abs(given - real)).toBeLessThan(0.06);
  });

  it('passes a real hitch through (capped) so the sim can catch up', () => {
    const clock = new FrameClock(0.1);
    run(clock, Array(60).fill(16.67));
    expect(clock.tick(1000 + 60 * 16.67 + 80)).toBeCloseTo(0.08, 2);
  });

  it('caps a tab-switch gap at maxDt', () => {
    const clock = new FrameClock(0.1);
    const out = run(clock, [16.7, 16.7, 5000, 16.7]);
    expect(Math.max(...out)).toBeLessThanOrEqual(0.1);
  });

  it('follows a display that changes to 144 Hz', () => {
    const clock = new FrameClock();
    run(clock, Array(60).fill(16.67));
    const out = run(clock, Array(200).fill(6.94), 5000);
    expect(out[out.length - 1]).toBeCloseTo(0.00694, 3);
  });
});
