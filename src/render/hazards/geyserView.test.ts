import { describe, expect, it } from 'vitest';
import { COLUMN_HEIGHT, geyserLook } from './geyserView';

describe('geyserLook', () => {
  it('idle: a faint ember glow and no column', () => {
    const l = geyserLook('idle', 0.5, 3);
    expect(l.columnHeight).toBe(0);
    expect(l.crack).toBeGreaterThan(0.2);
    expect(l.crack).toBeLessThan(1);
    expect(l.sparkRate).toBe(0);
  });

  it('warn: the crack glows brighter and the sparks come faster as the eruption nears; still no column', () => {
    const early = geyserLook('warn', 0.1, 0);
    const late = geyserLook('warn', 0.95, 0);
    expect(early.columnHeight).toBe(0);
    expect(late.columnHeight).toBe(0);
    expect(late.sparkRate).toBeGreaterThan(early.sparkRate);
    // The peak brightness over a warn period rises (look at the maximum over a short window, because of the flicker).
    const peak = (t0: number) => Math.max(...Array.from({ length: 40 }, (_, i) => geyserLook('warn', t0 + i * 0.005, 0).crack));
    expect(peak(0.8)).toBeGreaterThan(peak(0));
  });

  it('active: the column shoots up fast, stays tall, then collapses; its colour is above 1.0 (blooms)', () => {
    expect(geyserLook('active', 0, 0).columnHeight).toBeLessThan(1);
    expect(geyserLook('active', 0.2, 0).columnHeight).toBeGreaterThan(COLUMN_HEIGHT * 0.8);
    expect(geyserLook('active', 0.5, 0).columnHeight).toBeGreaterThan(COLUMN_HEIGHT * 0.8);
    expect(geyserLook('active', 0.99, 0).columnHeight).toBeLessThan(COLUMN_HEIGHT * 0.3);
    expect(geyserLook('active', 0.3, 0).crack).toBeGreaterThan(1); // HDR brightness
  });

  it('is a pure function of its inputs', () => {
    expect(geyserLook('warn', 0.37, 12.5)).toEqual(geyserLook('warn', 0.37, 12.5));
  });
});
