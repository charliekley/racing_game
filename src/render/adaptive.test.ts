import { describe, expect, it } from 'vitest';
import { AdaptiveQuality } from './adaptive';

/** Feed `seconds` of frames of `ms` each; returns the final time. */
function run(a: AdaptiveQuality, start: number, seconds: number, ms: number): number {
  let t = start;
  const end = start + seconds * 1000;
  while (t < end) {
    t += ms;
    a.frame(t, true);
  }
  return t;
}

function make() {
  const log: string[] = [];
  const a = new AdaptiveQuality({
    onScale: (s) => log.push(`scale ${s}`),
    onStepDown: () => log.push('down'),
  });
  return { a, log };
}

describe('AdaptiveQuality', () => {
  it('stays put at 60 fps', () => {
    const { a, log } = make();
    run(a, 1000, 10, 16.6);
    expect(log).toEqual([]);
    expect(a.scale).toBe(1);
  });

  it('lowers the render scale when frames are slow, down to the minimum', () => {
    const { a, log } = make();
    run(a, 1000, 12, 24); // ~42 fps
    expect(a.scale).toBeLessThan(1);
    expect(a.scale).toBeGreaterThanOrEqual(0.6 - 1e-9);
    expect(log.some((l) => l.startsWith('scale'))).toBe(true);
  });

  it('steps the preset down only after sitting at the lowest scale for a few seconds', () => {
    const { a, log } = make();
    const t = run(a, 1000, 4, 30);
    expect(a.scale).toBeCloseTo(0.6, 5);
    expect(log).not.toContain('down');
    run(a, t, 8, 30);
    expect(log).toContain('down');
  });

  it('ignores the warm-up second and long gaps (hidden tab)', () => {
    const { a, log } = make();
    let t = run(a, 1000, 1, 100); // slow, but inside the warm-up
    expect(log).toEqual([]);
    t += 5000; // tab was in the background
    a.frame(t, true);
    t = run(a, t, 0.4, 16.6);
    expect(log).toEqual([]);
  });

  it('raises the scale again after a calm stretch but never above the ceiling it learned', () => {
    const { a } = make();
    let t = run(a, 1000, 6, 24);
    const low = a.scale;
    expect(low).toBeLessThan(1);
    t = run(a, t, 30, 16.6);
    expect(a.scale).toBeGreaterThan(low);
    expect(a.scale).toBeLessThanOrEqual(1);
  });

  it('measures nothing while disabled or between races', () => {
    const { a, log } = make();
    a.enabled = false;
    run(a, 1000, 10, 40);
    expect(log).toEqual([]);
    a.enabled = true;
    let t = 20000;
    for (let i = 0; i < 400; i++) a.frame((t += 40), false);
    expect(log).toEqual([]);
  });
});
