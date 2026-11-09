import { describe, expect, it } from 'vitest';
import { Track } from '../../sim/track';
import { cloudGarden } from './cloudGarden';

describe('Cloud Garden', () => {
  const track = new Track(cloudGarden);

  it('is between 1.2 and 2.0 km long', () => {
    expect(track.length).toBeGreaterThan(1200);
    expect(track.length).toBeLessThan(2000);
  });

  it('has bridges, two void jumps and a cannon', () => {
    expect(track.bridges.length).toBe(3);
    expect(track.gaps.filter((g) => g.kind === 'void').length).toBe(2);
    expect(track.cannons.length).toBe(1);
  });

  it('the cannon skips a whole island (lands > 150 m ahead of the mouth)', () => {
    const c = track.cannons[0];
    expect(c.landing.s - c.mouth.s).toBeGreaterThan(200);
  });

  it('the cannon mouth is off the racing line (so only a deliberate kart is fired)', () => {
    expect(Math.abs(track.cannons[0].lateral)).toBeGreaterThan(2.7);
  });
});
