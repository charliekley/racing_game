import { describe, expect, it } from 'vitest';
import { STEP_TITLES, bufferPx, fitDesign } from './pictureMath';

describe('fitDesign', () => {
  it('centres a square design in a wide canvas', () => {
    const f = fitDesign(300, 100, 100, 100);
    expect(f.scale).toBe(1);
    expect(f.x).toBe(100);
    expect(f.y).toBe(0);
  });
  it('fits a wide design by its width', () => {
    const f = fitDesign(160, 160, 160, 100);
    expect(f.scale).toBe(1);
    expect(f.y).toBe(30);
  });
  it('never exceeds the canvas', () => {
    const f = fitDesign(80, 50, 160, 100);
    expect(160 * f.scale).toBeLessThanOrEqual(80);
    expect(100 * f.scale).toBeLessThanOrEqual(50);
  });
  it('survives an empty canvas', () => {
    expect(fitDesign(0, 0, 100, 100).scale).toBe(0);
  });
});

describe('bufferPx', () => {
  it('scales by the pixel ratio up to 2x', () => {
    expect(bufferPx(100, 1)).toBe(100);
    expect(bufferPx(100, 3)).toBe(200);
    expect(bufferPx(45.4, 2)).toBe(91);
  });
  it('is 0 for an unmeasured element', () => {
    expect(bufferPx(0, 2)).toBe(0);
    expect(bufferPx(NaN, 2)).toBe(0);
  });
});

describe('STEP_TITLES', () => {
  it('has a short title for every step', () => {
    for (const t of Object.values(STEP_TITLES)) expect(t.length).toBeLessThanOrEqual(18);
  });
});
