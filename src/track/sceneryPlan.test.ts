import { describe, expect, it } from 'vitest';
import { TRACKS } from '.';
import { Track } from '../sim/track';
import { planScenery, type Collider } from './sceneryPlan';

/** Distance from point (px, pz) to the collider's outline (0 if inside). */
function distanceTo(c: Collider, px: number, pz: number): number {
  if (c.shape === 'circle') return Math.max(0, Math.hypot(px - c.x, pz - c.z) - c.r);
  const cos = Math.cos(c.rotY);
  const sin = Math.sin(c.rotY);
  const lx = (px - c.x) * cos - (pz - c.z) * sin;
  const lz = (px - c.x) * sin + (pz - c.z) * cos;
  return Math.hypot(Math.max(0, Math.abs(lx) - c.hw), Math.max(0, Math.abs(lz) - c.hd));
}

describe.each(TRACKS.map((t) => [t.name, t] as const))('scenery plan for %s', (_name, def) => {
  const track = new Track(def);
  const plan = planScenery(track);
  const outer = def.width / 2 + def.offroadWidth;

  it('is deterministic for a given track', () => {
    const again = planScenery(track, () => 0); // bypasses the cache
    expect(again.colliders).toEqual(plan.colliders);
    expect(again.trees.map((t) => [t.x, t.z, t.variant])).toEqual(plan.trees.map((t) => [t.x, t.z, t.variant]));
  });

  it('is not empty and has both circles and boxes', () => {
    expect(plan.trees.length).toBeGreaterThan(5);
    expect(plan.colliders.some((c) => c.shape === 'circle')).toBe(true);
    expect(plan.colliders.some((c) => c.shape === 'box')).toBe(true);
    expect(plan.colliders.every((c) => c.solid)).toBe(true);
    expect(plan.bushes.every((b) => !b.solid && b.collider === null)).toBe(true);
  });

  it('keeps every solid thing off the road and the off-road strip (gantry posts excepted)', () => {
    const gantry = new Set(plan.gantryPosts.map((g) => g.collider));
    for (const c of plan.colliders) {
      if (gantry.has(c)) continue;
      let nearest = Infinity;
      for (const p of track.samples) nearest = Math.min(nearest, distanceTo(c, p.x, p.z));
      expect(nearest).toBeGreaterThan(outer + 1.5);
    }
  });

  it('never covers a starting-grid spot or an item box', () => {
    const spots = [0, 1, 2, 3, 4, 5].map((i) => track.gridSpot(i));
    for (const c of plan.colliders) {
      for (const g of spots) expect(distanceTo(c, g.x, g.z)).toBeGreaterThan(3);
      for (const b of track.itemBoxes) expect(distanceTo(c, b.x, b.z)).toBeGreaterThan(3);
    }
  });

  it('uses the supplied ground height', () => {
    const raised = planScenery(track, () => 7);
    expect(raised.trees.every((t) => t.y === 7)).toBe(true);
    expect(raised.colliders.every((c) => c.y === 7)).toBe(true);
  });
});
