import { describe, expect, it } from 'vitest';
import { Track } from '../../sim/track';
import { cloudGarden } from './cloudGarden';

describe('Cloud Garden', () => {
  const track = new Track(cloudGarden);

  it('is between 1.2 and 2.0 km long', () => {
    expect(track.length).toBeGreaterThan(1200);
    expect(track.length).toBeLessThan(2000);
  });

  it('has bridges, a void jump and a mandatory cannon', () => {
    expect(track.bridges.length).toBe(3);
    expect(track.gaps.filter((g) => g.kind === 'void').length).toBe(1);
    expect(track.cannons.length).toBe(1);
    expect(track.cannons[0].mandatory).toBe(true);
  });

  it('the cannon crosses open sky: 120-250 m of road with no ground at all', () => {
    const gap = track.gaps.find((g) => g.kind === 'sky')!;
    expect(gap.s1 - gap.s0).toBeGreaterThan(120);
    expect(gap.s1 - gap.s0).toBeLessThan(250);
  });

  it('the three wind-gust bridges are still bridges', () => {
    for (const h of cloudGarden.hazards ?? []) {
      if (h.kind !== 'gust') continue;
      expect(track.bridges.some((b) => Math.abs(b.s0 - track.sAt(h.from)) < 1 && Math.abs(b.s1 - track.sAt(h.to)) < 1)).toBe(true);
    }
  });
});
