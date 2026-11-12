import { describe, expect, it } from 'vitest';
import { Track } from '../../sim/track';
import { planScenery } from '../sceneryPlan';
import { docksideLoop } from './docksideLoop';

describe('Dockside Loop', () => {
  const track = new Track(docksideLoop);

  it('is 1.2 to 2.0 km long', () => {
    expect(track.length).toBeGreaterThan(1200);
    expect(track.length).toBeLessThan(2000);
  });

  it('has an overpass: where the road crosses itself the levels differ by >= 7 m', () => {
    const S = track.samples;
    let found = false;
    for (let i = 0; i < S.length; i += 2)
      for (let j = i + 40; j < S.length; j += 2) {
        if (S.length - (j - i) < 40) continue; // neighbours across the lap line
        if (Math.hypot(S[i].x - S[j].x, S[i].z - S[j].z) < 8) {
          found = true;
          expect(Math.abs(S[i].y - S[j].y)).toBeGreaterThanOrEqual(7);
        }
      }
    expect(found).toBe(true);
  });

  it('has solid containers and warehouses, a shortcut and two gaps (the quay jump and the drawbridge opening)', () => {
    const plan = planScenery(track);
    expect(plan.blocks.some((b) => b.kind === 'container')).toBe(true);
    expect(plan.blocks.some((b) => b.kind === 'warehouse')).toBe(true);
    expect(plan.blocks.every((b) => b.collider && b.solid)).toBe(true);
    expect(track.branches.length).toBe(1);
    expect(track.gaps.length).toBe(2);
  });
});
