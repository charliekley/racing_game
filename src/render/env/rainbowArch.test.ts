import { describe, expect, it } from 'vitest';
import type { TrackSample } from '../../sim/track';
import { archGeometry } from './rainbow';

/** A made-up road sample at height `y` heading `heading` (rad), banked by `bank`. */
function sample(heading: number, y: number, bank = 0): TrackSample {
  const tx = Math.sin(heading);
  const tz = Math.cos(heading);
  return { x: 10, y, z: -4, tx, tz, rx: -tz, rz: tx, s: 0, heading, curvature: 0, bank, width: 18, wallLeft: false, wallRight: false };
}

describe('the star-ring arch over a boost pad', () => {
  it.each([0, 0.7, Math.PI / 2, 2.4, Math.PI, -1.9])('stands on the road and arches ABOVE it (heading %f): no part is below the deck', (heading) => {
    const g = archGeometry(sample(heading, 50), 9, 3);
    const pos = g.getAttribute('position');
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minY = Math.min(minY, pos.getY(i));
      maxY = Math.max(maxY, pos.getY(i));
    }
    expect(minY).toBeGreaterThanOrEqual(50 - 1e-3);
    expect(maxY).toBeGreaterThan(50 + 8); // the top of the half ring is about a half width high
  });

  it('stays above a banked road too', () => {
    const g = archGeometry(sample(1.2, 20, 0.3), 9, 1);
    const pos = g.getAttribute('position');
    // The arch's feet touch the deck at each edge: with a bank one edge is higher than the centre line, so the lowest point
    // is the lower edge, never below the lowest part of the deck by more than a hair.
    let minY = Infinity;
    for (let i = 0; i < pos.count; i++) minY = Math.min(minY, pos.getY(i));
    expect(minY).toBeGreaterThanOrEqual(20 - 9 * Math.sin(0.3) - 1.2);
  });
});
