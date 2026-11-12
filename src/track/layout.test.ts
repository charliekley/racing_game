/**
 * Layout rules: every track must be twisty and varied, not a few long straights.
 * (Wave 4 "twistier layouts"; measured on the sampled centerline, see layoutStats.ts.)
 */
import { describe, expect, it } from 'vitest';
import { TRACKS } from '.';
import { Track } from '../sim/track';
import { layoutStats } from './layoutStats';

describe.each(TRACKS.map((t) => [t.name, t] as const))('layout of %s', (_name, def) => {
  const stats = layoutStats(new Track(def));

  it('is 1.2 to 2.0 km long', () => {
    expect(stats.length).toBeGreaterThanOrEqual(1200);
    expect(stats.length).toBeLessThanOrEqual(2000);
  });

  it('has no long straights: all <= 100 m, at most one up to 150 m', () => {
    const [longest = 0, second = 0] = stats.straights;
    expect(longest, `longest straight ${longest.toFixed(0)} m`).toBeLessThanOrEqual(150);
    expect(second, `second longest straight ${second.toFixed(0)} m`).toBeLessThanOrEqual(100);
  });

  it('is mostly curved (>= 70 % of the road)', () => {
    expect(stats.curvedShare).toBeGreaterThanOrEqual(0.7);
  });

  it('turns a lot (>= 1260 degrees in total)', () => {
    expect(stats.turningDeg).toBeGreaterThanOrEqual(1260);
  });

  it('has at least 8 tight corners (radius < 60 m)', () => {
    expect(stats.tightCorners).toBeGreaterThanOrEqual(8);
  });

  it('has real elevation: main road height range >= 12 m', () => {
    expect(stats.heightRange).toBeGreaterThanOrEqual(12);
  });
});
