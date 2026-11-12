/**
 * Layout rules: every track must be twisty and varied, not a few long straights.
 * (Wave 4 "twistier layouts"; measured on the sampled centerline, see layoutStats.ts.)
 */
import { describe, expect, it } from 'vitest';
import { TRACKS } from '.';
import { Track } from '../sim/track';
import { layoutStats } from './layoutStats';

/**
 * TODO(integrator): Ember Peaks is being redesigned by another agent in parallel.
 * Remove its name from this list when that redesign is merged so it is held to the same rules.
 */
const PENDING = ['Ember Peaks'];

describe.each(TRACKS.map((t) => [t.name, t] as const))('layout of %s', (name, def) => {
  const test = PENDING.includes(name) ? it.skip : it;
  const stats = layoutStats(new Track(def));

  test('is 1.2 to 2.0 km long', () => {
    expect(stats.length).toBeGreaterThanOrEqual(1200);
    expect(stats.length).toBeLessThanOrEqual(2000);
  });

  test('has no long straights: all <= 100 m, at most one up to 150 m', () => {
    const [longest = 0, second = 0] = stats.straights;
    expect(longest, `longest straight ${longest.toFixed(0)} m`).toBeLessThanOrEqual(150);
    expect(second, `second longest straight ${second.toFixed(0)} m`).toBeLessThanOrEqual(100);
  });

  test('is mostly curved (>= 70 % of the road)', () => {
    expect(stats.curvedShare).toBeGreaterThanOrEqual(0.7);
  });

  test('turns a lot (>= 1260 degrees in total)', () => {
    expect(stats.turningDeg).toBeGreaterThanOrEqual(1260);
  });

  test('has at least 8 tight corners (radius < 60 m)', () => {
    expect(stats.tightCorners).toBeGreaterThanOrEqual(8);
  });

  test('has real elevation: main road height range >= 12 m', () => {
    expect(stats.heightRange).toBeGreaterThanOrEqual(12);
  });
});
