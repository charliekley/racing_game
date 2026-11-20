/**
 * Ricochet / seeker shots follow the ground: they glide over ramps, hills and raised drawbridge leaves,
 * never sink into the surface and never hover high above it.
 */
import { describe, expect, it } from 'vitest';
import { Buttons, type ControlInput } from '../../shared/protocol';
import { meadowRing } from '../../track/tracks/_meadowRing';
import { docksideLoop } from '../../track/tracks/docksideLoop';
import { KART, SIM_DT } from '../config';
import type { Ground } from '../ground';
import { createKart } from '../kart';
import { HazardSystem } from '../hazards/system';
import type { Drawbridge } from '../hazards/drawbridge';
import { Track } from '../track';
import { ItemSystem } from './items';
import { seededRng } from './odds';

const NONE: ControlInput = { steer: 0, buttons: 0 };

interface Trace {
  /** Per tick: shot height minus the ground height right under it. */
  gap: number[];
  /** Per tick: shot height. */
  y: number[];
  /** Highest ground the shot flew over. */
  maxGround: number;
}

/** Fire one shot from a kart on `track` at distance s and record how it follows `ground` for `seconds`. */
function fly(track: Track, ground: Ground, s: number, kind: 'ricochet' | 'seeker', seconds: number): Trace {
  const p = track.pointAt(s);
  const k = createKart(p.x, p.z, p.heading, track.sample(p.x, p.z)!.height);
  k.trackIndex = p.index;
  const items = new ItemSystem(track, seededRng(1), [0]);
  const karts = new Map([[0, k]]);
  items.states.get(0)!.held = { id: kind, count: 1 };
  const inputs = new Map<number, ControlInput>([[0, { steer: 0, buttons: Buttons.ITEM }]]);
  items.tick(karts, inputs, [0], new Set(), ground);
  inputs.set(0, NONE);
  const trace: Trace = { gap: [], y: [], maxGround: -Infinity };
  for (let t = 0; t < seconds; t += SIM_DT) {
    items.tick(karts, inputs, [0], new Set(), ground);
    const shot = items.entityList.find((e) => e.kind === kind);
    if (!shot) break;
    const g = ground.sample(shot.x, shot.z, track.project(shot.x, shot.z).index);
    if (!g) continue;
    trace.gap.push(shot.y - g.height);
    trace.y.push(shot.y);
    trace.maxGround = Math.max(trace.maxGround, g.height);
  }
  return trace;
}

/** The real road with an extra bump added under it: `shape(along)` metres of lift, `along` metres after the firing point. */
function withBump(track: Track, s: number, shape: (along: number) => number): Ground {
  const p = track.pointAt(s);
  const fx = Math.sin(p.heading);
  const fz = Math.cos(p.heading);
  return {
    sample: (x, z, hint) => {
      const hit = track.sample(x, z, hint);
      if (!hit) return null;
      return { ...hit, height: hit.height + shape((x - p.x) * fx + (z - p.z) * fz) };
    },
  };
}

/** The shot hugs the ground: never below it, never more than `maxFloat` above, and no jump bigger than `maxStep` per tick. */
function expectGliding(t: Trace, maxFloat: number, maxStep: number): void {
  expect(t.y.length).toBeGreaterThan(20);
  for (const g of t.gap) {
    expect(g).toBeGreaterThanOrEqual(-1e-6); // never sinks into the ground
    expect(g).toBeLessThanOrEqual(maxFloat); // never floats far above it
  }
  for (let i = 1; i < t.y.length; i++) expect(Math.abs(t.y[i] - t.y[i - 1])).toBeLessThan(maxStep);
}

const meadow = new Track(meadowRing);

describe('shots follow the ground', () => {
  it('glides up and down a ramp (a 2 m kicker over 9 m)', () => {
    const ramp = withBump(meadow, 100, (a) => (a < 30 || a > 39 ? 0 : 2 * (1 - Math.abs(a - 34.5) / 4.5)));
    for (const kind of ['ricochet', 'seeker'] as const) {
      const t = fly(meadow, ramp, 100, kind, 1.6);
      expect(t.maxGround).toBeGreaterThan(1.8); // it really did fly over the ramp
      expectGliding(t, 1.5, 0.4); // (the ramp's far edge drops 2 m at once, so a short glide down is expected)
    }
  });

  it('glides over a hill crest and into the dip behind it', () => {
    const hill = withBump(meadow, 100, (a) => (a < 20 || a > 60 ? 0 : 3 * Math.sin(((a - 20) / 40) * Math.PI) ** 2));
    const t = fly(meadow, hill, 100, 'ricochet', 1.8);
    expect(t.maxGround).toBeGreaterThan(2.5);
    expectGliding(t, 1.0, 0.4);
  });

  it('still flies at road height on flat road', () => {
    const t = fly(meadow, meadow, 100, 'ricochet', 1);
    for (const g of t.gap) expect(Math.abs(g)).toBeLessThan(0.15);
  });

  it('flies over a raised drawbridge leaf instead of through it', () => {
    const track = new Track({
      ...docksideLoop,
      hazards: [...(docksideLoop.hazards ?? []).filter((h) => h.kind !== 'drawbridge'), { kind: 'drawbridge', from: 57, to: 60, period: 24, phase: 9 }],
    });
    const system = new HazardSystem(track);
    const bridge = system.list[0] as Drawbridge;
    system.step(9 + 18.2, new Map(), () => KART); // leaves fully up (just after reaching the top)
    const ground = system.wrapGround(track);
    const roadY = track.sample(bridge.frame.ax, bridge.frame.az)!.height;
    const t = fly(track, ground, bridge.s - bridge.halfLength - 18, 'ricochet', 0.6);
    expect(t.maxGround).toBeGreaterThan(roadY + 1.5); // the leaf is well above the road
    for (const g of t.gap) expect(g).toBeGreaterThanOrEqual(-1e-6);
    expect(Math.max(...t.y)).toBeGreaterThan(roadY + 1.5); // the shot rode up the leaf
  });
});
