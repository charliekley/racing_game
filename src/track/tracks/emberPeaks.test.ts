import { describe, expect, it } from 'vitest';
import { Track } from '../../sim/track';
import { emberPeaks } from './emberPeaks';

describe('Ember Peaks', () => {
  const track = new Track(emberPeaks);

  it('is between 1.2 and 2.0 km long', () => {
    expect(track.length).toBeGreaterThan(1200);
    expect(track.length).toBeLessThan(2000);
  });

  it('has the signature features: cannon, cliffs and a void jump', () => {
    expect(track.cannons.length).toBe(1);
    expect(track.cliffs.length).toBeGreaterThan(0);
    expect(track.gaps.some((g) => g.kind === 'void')).toBe(true);
  });

  it('the cannon skips the rim ridge (lands well ahead of the mouth)', () => {
    const c = track.cannons[0];
    expect(c.landing.s - c.mouth.s).toBeGreaterThan(250);
  });
});
