import { describe, expect, it } from 'vitest';
import { SCOREBOARD_REVEAL_SECONDS } from './postRace';
import { countUpValue, rowTiming } from './revealTiming';

describe('rowTiming', () => {
  it.each([2, 4, 8, 12])('finishes within the reveal time with %i rows', (n) => {
    const r = rowTiming(n);
    expect(r.end).toBeLessThanOrEqual(SCOREBOARD_REVEAL_SECONDS + 0.001);
    expect(r.step).toBeGreaterThanOrEqual(0.05);
  });

  it('rows start one after another', () => {
    const r = rowTiming(6);
    for (let i = 1; i < 6; i++) expect(r.startOf(i)).toBeGreaterThan(r.startOf(i - 1));
  });

  it('a single row and a silly row count do not break', () => {
    expect(Number.isFinite(rowTiming(1).end)).toBe(true);
    expect(Number.isFinite(rowTiming(0).end)).toBe(true);
  });
});

describe('countUpValue', () => {
  it('starts at from, ends at to, never leaves the range', () => {
    expect(countUpValue(0, 8, 0, 1, 1)).toBe(0);
    expect(countUpValue(0, 8, 1, 1, 1)).toBe(0);
    expect(countUpValue(0, 8, 2, 1, 1)).toBe(8);
    expect(countUpValue(0, 8, 99, 1, 1)).toBe(8);
    for (let t = 1; t <= 2; t += 0.05) {
      const v = countUpValue(0, 8, t, 1, 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(8);
    }
  });

  it('only goes up, and works from a non-zero start', () => {
    let prev = 10;
    for (let t = 0; t <= 1; t += 0.05) {
      const v = countUpValue(10, 25, t, 0, 1);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(prev).toBe(25);
  });
});
