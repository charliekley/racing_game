import { describe, expect, it } from 'vitest';
import { easeOutBack, inkPhase } from './inkOverlay';

describe('inkPhase', () => {
  it('pops in over 0.35 s and is fully opaque while holding', () => {
    expect(inkPhase(0, 5)).toEqual({ appear: 0, fade: 1 });
    expect(inkPhase(0.35, 5).appear).toBe(1);
    expect(inkPhase(2, 5)).toEqual({ appear: 1, fade: 1 });
  });

  it('fades smoothly to 0 during the last 1.2 s', () => {
    expect(inkPhase(3.8, 5).fade).toBe(1);
    const mid = inkPhase(4.4, 5).fade;
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    expect(inkPhase(5, 5).fade).toBe(0);
    expect(inkPhase(6, 5).fade).toBe(0);
  });

  it('copes with very short durations', () => {
    expect(inkPhase(0, 0.5).fade).toBe(1);
    expect(inkPhase(0.5, 0.5).fade).toBe(0);
  });
});

describe('easeOutBack', () => {
  it('starts at 0, overshoots, ends at 1', () => {
    expect(easeOutBack(0)).toBeCloseTo(0);
    expect(easeOutBack(1)).toBeCloseTo(1);
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map(easeOutBack))).toBeGreaterThan(1);
  });
});
