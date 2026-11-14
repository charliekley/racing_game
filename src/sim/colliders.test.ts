import { describe, expect, it } from 'vitest';
import { DEV_TRACKS, TRACKS } from '../track';
import { planScenery, type Collider } from '../track/sceneryPlan';
import { Colliders } from './colliders';
import { KART } from './config';
import { createKart, type KartState } from './kart';
import { autopilot, botStyleFor } from './autopilot';
import { Track } from './track';
import { World } from './world';

const tree: Collider = { shape: 'circle', x: 0, z: 10, y: 0, r: 0.4, height: 4, solid: true };
const house: Collider = { shape: 'box', x: 0, z: 20, y: 0, hw: 5, hd: 4, rotY: 0, height: 6, solid: true };

/** A kart at (x, z) driving at `speed` along `heading` (0 = +z). */
function kartAt(x: number, z: number, heading: number, speed: number): KartState {
  const k = createKart(x, z, heading, 0);
  k.speed = speed;
  k.vel.x = Math.sin(heading) * speed;
  k.vel.z = Math.cos(heading) * speed;
  return k;
}

/** Drive a kart in a straight line for `steps` ticks, colliding each step. Returns the biggest impact. */
function drive(cs: Colliders, k: KartState, steps: number): number {
  const dt = 1 / 60;
  let worst = 0;
  for (let i = 0; i < steps; i++) {
    k.pos.x += k.vel.x * dt;
    k.pos.z += k.vel.z * dt;
    worst = Math.max(worst, cs.collideKart(k));
  }
  return worst;
}

describe('Colliders', () => {
  const cs = new Colliders([tree, house]);

  it('bounces a kart that drives head-on into a tree, losing speed, staying outside', () => {
    const k = kartAt(0, 5, 0, 20);
    const impact = drive(cs, k, 20);
    expect(impact).toBeGreaterThan(15);
    expect(k.speed).toBeLessThan(0); // bounced back
    expect(Math.abs(k.speed)).toBeLessThan(20 * 0.5);
    expect(Math.hypot(k.pos.x - tree.x, k.pos.z - tree.z)).toBeGreaterThanOrEqual(0.4 + KART.radius - 1e-6);
  });

  it('bounces off a house and never ends inside it', () => {
    const k = kartAt(0, 5, 0, 25);
    drive(cs, k, 120);
    expect(k.pos.z).toBeLessThan(20 - 4); // still on the near side of the front wall
    expect(k.vel.z).toBeLessThan(0.5);
  });

  it('a glancing hit keeps most of the speed and slides along the wall', () => {
    // Graze the house's side wall (x = 5) at a shallow ~8 degree angle.
    const k = kartAt(7.5, 8, -0.14, 20); // driving +z, slightly toward -x: grazes the side wall x = 5
    const impact = drive(cs, k, 40);
    expect(impact).toBeGreaterThan(0);
    expect(impact).toBeLessThan(20 * 0.3);
    expect(k.speed).toBeGreaterThan(20 * 0.7);
  });

  it('karts flying above a collider pass over it', () => {
    const k = kartAt(0, 5, 0, 20);
    k.pos.y = 5; // higher than the tree (4 m)
    drive(new Colliders([tree]), k, 40);
    expect(k.pos.z).toBeGreaterThan(12);
    expect(k.speed).toBeCloseTo(20, 0);
  });

  it('Nova karts bulldoze thin things but not houses', () => {
    const a = kartAt(0, 5, 0, 20);
    a.starTime = 5;
    drive(new Colliders([tree]), a, 40);
    expect(a.pos.z).toBeGreaterThan(12);
    const b = kartAt(0, 12, 0, 20);
    b.starTime = 5;
    drive(cs, b, 60);
    expect(b.pos.z).toBeLessThan(16);
  });

  it('blocksPoint finds solids (shots), ignores open ground', () => {
    expect(cs.blocksPoint(0, 10, 0.2)).toBe(true);
    expect(cs.blocksPoint(4, 20, 0.2)).toBe(true);
    expect(cs.blocksPoint(30, 30, 0.5)).toBe(false);
    expect(cs.blocksPoint(0, 12, 0.5)).toBe(false);
  });

  it('ignores colliders flagged not solid', () => {
    const soft = new Colliders([{ ...tree, solid: false }]);
    expect(soft.blocksPoint(0, 10, 0.2)).toBe(false);
    const k = kartAt(0, 5, 0, 20);
    expect(drive(soft, k, 20)).toBe(0);
  });

  it('handles rotated boxes', () => {
    const turned = new Colliders([{ shape: 'box', x: 0, z: 0, y: 0, hw: 1, hd: 6, rotY: Math.PI / 2, height: 3, solid: true }]);
    // Long axis now lies along world x: hd = 6 extends toward local z = (sin, cos) = (1, 0).
    expect(turned.blocksPoint(5, 0, 0.1)).toBe(true);
    expect(turned.blocksPoint(0, 5, 0.1)).toBe(false);
  });
});

describe.each([...TRACKS, ...DEV_TRACKS].map((t) => [t.name, t] as const))('bots on %s with solid scenery', (_name, def) => {
  it('four bots finish a 3-lap race', () => {
    const track = new Track(def);
    const world = new World(track, track);
    world.startRace([0, 1, 2, 3], def.laps);
    expect(world.colliders!.list.length).toBeGreaterThan(0);
    let ticks = 0;
    while (world.race!.phase !== 'done' && ticks < 60 * 400) {
      world.tick((slot) => autopilot(world.karts.get(slot)!, track, botStyleFor(slot)));
      ticks++;
    }
    expect(world.race!.phase).toBe('done');
    for (const r of world.race!.racers.values()) expect(r.finished).toBe(true);
  });

  it('every plan collider (scenery and bridge piers) is also in the world colliders (what you see is what you hit)', () => {
    const track = new Track(def);
    const world = new World(track, track);
    world.startRace([0], 1);
    const plan = planScenery(track);
    expect(world.colliders!.list.length).toBe(plan.colliders.length + plan.pierColliders.length);
  });
});
