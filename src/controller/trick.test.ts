import { describe, expect, it } from 'vitest';
import { TrickDetector } from './trick';

const still: [number, number, number] = [0, 0, 0];
const flick: [number, number, number] = [0, 18, 0];
const g: [number, number, number] = [0, 9.81, 0];

describe('TrickDetector', () => {
  it('fires once per flick, with cooldown', () => {
    const d = new TrickDetector();
    let t = 0;
    const step = (lin: [number, number, number]) => d.update(lin, g, (t += 16), 16);
    expect(step(still)).toBe(false);
    expect(step(flick)).toBe(true);
    expect(step(flick)).toBe(false); // still above threshold: no repeat
    expect(step(still)).toBe(false);
    expect(step(flick)).toBe(false); // within cooldown
    for (let i = 0; i < 50; i++) step(still);
    expect(step(flick)).toBe(true);
  });

  it('works without linear acceleration (high-pass fallback)', () => {
    const d = new TrickDetector();
    let t = 0;
    for (let i = 0; i < 60; i++) expect(d.update(null, g, (t += 16), 16)).toBe(false);
    expect(d.update(null, [0, 9.81 + 20, 0], (t += 16), 16)).toBe(true);
  });
});
