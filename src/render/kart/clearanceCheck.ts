/**
 * Runs a driver through its extreme poses on every kart body and measures how deep each driver part pokes
 * into the kart (see clearance.ts for how overlap is measured). Used by clearance.test.ts.
 *
 * Which contacts are allowed (the driver SITS in the kart, so some overlap is the point):
 *  - head      : must clear EVERYTHING (cage, seat, wing, wheel, hull...). The head is the big, expressive part.
 *  - torso     : may touch the hull and the seat (it sits in them), must clear the rest (tails vs engine,
 *                backpack vs cage, knees vs wheel...)
 *  - arms      : may touch the hull, the steering wheel and its column (the hands hold the wheel), must clear
 *                the rest (hands thrown up vs the cage or the light bar...)
 */
import * as THREE from 'three';
import { CHARACTERS, paletteFor } from '../../shared/characters';
import { buildKartModel, type KartModel } from '../kartModel';
import { DriverRig, IDLE_INPUT, type DriverInput } from './driverRig';
import { applyPickPose } from './driverPose';
import { PartBuilder, withDetail } from './geo';
import { STYLE_BUILDERS, buildSteeringWheelGeometry } from './bodies';
import { SampleGrid, mutualOverlap, sampleTriangles, transformSamples, type SampleSet } from './clearance';
import { PICK_DURATION, pickPose } from './pickAnim';

/** Overlap allowed before a pose counts as clipping (m): a visible poke is a few cm, this is "touching". */
export const CLEARANCE_TOLERANCE = 0.02;

export type DriverPart = 'head' | 'torso' | 'arm';

export interface Hit {
  /** The kart part that was hit (its tag and box). */
  hit?: string;
  pose: string;
  part: DriverPart;
  depth: number;
  at: [number, number, number];
}

/** Rig inputs for each extreme pose of normal driving (the rig smooths them, so we run it until it settles). */
const RIG_POSES: { name: string; input: Partial<DriverInput>; frames?: number }[] = [
  { name: 'rest', input: {} },
  { name: 'steer left + roll', input: { steer: -1, bodyRoll: -0.14 } },
  { name: 'steer right + roll', input: { steer: 1, bodyRoll: 0.14 } },
  { name: 'steer left, roll right', input: { steer: -1, bodyRoll: 0.14 } },
  { name: 'steer right, roll left', input: { steer: 1, bodyRoll: -0.14 } },
  { name: 'look back left', input: { look: 1, lookSide: 1 } },
  { name: 'look back right', input: { look: 1, lookSide: -1 } },
  { name: 'look half left', input: { look: 0.5, lookSide: 1 } },
  { name: 'look back + steer', input: { look: 1, lookSide: 1, steer: 1, bodyRoll: 0.14 } },
  { name: 'look back + steer other way', input: { look: 1, lookSide: -1, steer: 1, bodyRoll: 0.14 } },
  { name: 'boost', input: { boosting: true, accel: 1 } },
  { name: 'brake', input: { accel: -1 } },
  { name: 'drift left', input: { drift: -1, steer: -1, bodyRoll: -0.14 } },
  { name: 'drift right', input: { drift: 1, steer: 1, bodyRoll: 0.14 } },
  { name: 'celebrate', input: { celebrate: true }, frames: 14 },
  { name: 'spun out', input: { spun: true }, frames: 14 },
  { name: 'trick 25%', input: { trick: 0.25 } },
  { name: 'trick 50%', input: { trick: 0.5 } },
  { name: 'trick 75%', input: { trick: 0.75 } },
];

// ---------------------------------------------------------------------------
// Kart side: static obstacle grids per body (built once)
// ---------------------------------------------------------------------------

interface BodyObstacles {
  /** Everything (the head must clear all of it). */
  all: SampleGrid;
  /** Everything except the hull and the seat (the torso may sit in those). */
  noHullSeat: SampleGrid;
  /** Everything except the hull and the steering column (the arms hold the wheel). */
  noHullColumn: SampleGrid;
}

const obstacleCache = new Map<number, BodyObstacles>();
const SPACING = 0.025;

function obstaclesFor(style: number): BodyObstacles {
  let o = obstacleCache.get(style);
  if (o) return o;
  const byTag = new Map<string, SampleSet[]>();
  PartBuilder.tap = (tag, pos, index) => {
    const list = byTag.get(tag) ?? [];
    const set = sampleTriangles(pos, index, SPACING);
    // Label the samples with the part's tag and box, so a report can say WHAT was hit.
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], pos[i]);
      hi[i % 3] = Math.max(hi[i % 3], pos[i]);
    }
    set.names = [`${tag} x${lo[0].toFixed(2)}..${hi[0].toFixed(2)} y${lo[1].toFixed(2)}..${hi[1].toFixed(2)} z${lo[2].toFixed(2)}..${hi[2].toFixed(2)}`];
    set.label = new Uint8Array(set.count);
    list.push(set);
    byTag.set(tag, list);
  };
  try {
    // 'mid' detail: the same shapes as the full model with fewer segments (the test stays fast).
    withDetail(0.4, () => STYLE_BUILDERS[style](new PartBuilder(), false));
  } finally {
    PartBuilder.tap = null;
  }
  const grid = (skip: string[]) => {
    const g = new SampleGrid();
    for (const [tag, list] of byTag) if (!skip.includes(tag)) list.forEach((s) => g.add(s));
    return g;
  };
  o = { all: grid([]), noHullSeat: grid(['hull', 'seat']), noHullColumn: grid(['hull', 'column']) };
  obstacleCache.set(style, o);
  return o;
}

// ---------------------------------------------------------------------------
// Driver side
// ---------------------------------------------------------------------------

const wheelSamples = (() => {
  let s: SampleSet | null = null;
  return () => {
    if (!s) {
      const g = buildSteeringWheelGeometry();
      s = sampleTriangles(g.getAttribute('position').array as Float32Array, g.index!.array, SPACING);
    }
    return s;
  };
})();

interface DriverSamples {
  model: KartModel;
  rig: DriverRig;
  head: SampleSet;
  torso: SampleSet;
  arm: SampleSet;
}

function buildDriver(style: number, character: number): DriverSamples {
  const model = buildKartModel('#888888', style, character, 'mid', paletteFor(character));
  const rig = new DriverRig(model);
  const sample = (mesh: THREE.Object3D) => {
    const g = (mesh as THREE.Mesh).geometry;
    return sampleTriangles(g.getAttribute('position').array as Float32Array, g.index!.array, 0.03);
  };
  return { model, rig, head: sample(model.head.children[0]), torso: sample(model.torso.children[0]), arm: sample(model.arms[1].children[0]) };
}

const _m = new THREE.Matrix4();

/** Measure the current pose of `d`: the deepest overlap of each driver part with the kart. */
function measure(d: DriverSamples, ob: BodyObstacles, pose: string, out: Hit[], hopping = false): void {
  const m = d.model;
  m.root.updateMatrixWorld(true);
  const wheelGrid = new SampleGrid().add(transformSamples(wheelSamples(), m.steeringWheel.matrixWorld));
  const check = (part: DriverPart, samples: SampleSet, mesh: THREE.Object3D, grids: SampleGrid[]) => {
    const world = transformSamples(samples, _m.copy(mesh.matrixWorld));
    let best: { depth: number; at: [number, number, number]; hit?: string } = { depth: 0, at: [0, 0, 0] };
    for (const g of grids) {
      const o = mutualOverlap(world, g);
      if (g === wheelGrid && !o.hit) o.hit = 'steering wheel';
      if (o.depth > best.depth) best = o;
    }
    if (best.depth > 0) out.push({ pose, part, depth: best.depth, at: best.at, hit: best.hit });
  };
  // A full spin (trick flourish, the fox's pick move) swings tails and arms through the seat and wheel by
  // nature: only the head, the part people look at, has to stay clear then.
  const turned = (a: number) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) > 0.3;
  const spinning = turned(m.driver.rotation.y) || turned(m.driver.rotation.x);
  check('head', d.head, m.head.children[0], [ob.all, wheelGrid]);
  if (spinning) return;
  // Hopping out of the seat, the body has to pass the steering wheel ring: not checked against the wheel then.
  check('torso', d.torso, m.torso.children[0], hopping ? [ob.noHullSeat] : [ob.noHullSeat, wheelGrid]);
  // Arms: the left one is a mirrored copy of the same samples.
  check('arm', d.arm, m.arms[1].children[0], [ob.noHullColumn]);
  check('arm', d.arm, m.arms[0].children[0], [ob.noHullColumn]);
}

export interface ClearanceOptions {
  /** Only the poses of normal driving, or also the 8 pick animations. */
  picks?: boolean;
}

/** Every pose of one character on one kart body; returns the deepest hit per (pose, part). */
export function checkCombo(style: number, character: number, opts: ClearanceOptions = {}): Hit[] {
  const ob = obstaclesFor(style);
  const d = buildDriver(style, character);
  const hits: Hit[] = [];
  const keep = (list: Hit[]) => {
    // Keep only the deepest hit per (pose, part).
    for (const h of list) {
      const i = hits.findIndex((x) => x.pose === h.pose && x.part === h.part);
      if (i < 0) hits.push(h);
      else if (h.depth > hits[i].depth) hits[i] = h;
    }
  };
  for (const p of RIG_POSES) {
    const inp: DriverInput = { ...IDLE_INPUT, ...p.input };
    const frames = p.frames ?? 50;
    // Settle (the rig eases toward the input), then look at the last few frames (spun / celebrate wobble).
    for (let f = 0; f < frames; f++) {
      d.rig.update(1 / 30, inp);
      if (f >= frames - (p.frames ? 12 : 1)) {
        const out: Hit[] = [];
        measure(d, ob, p.name, out);
        keep(out);
      }
    }
  }
  if (opts.picks) {
    const species = CHARACTERS[character].look.species;
    const inp: DriverInput = { ...IDLE_INPUT };
    for (const lookOffset of [0, 0.8, -0.8]) {
      for (let t = 0.05; t < PICK_DURATION; t += lookOffset === 0 ? 0.1 : 0.2) {
        const pose = pickPose(species, t);
        inp.celebrate = pose.armsUp > 0.5;
        for (let f = 0; f < 25; f++) d.rig.update(1 / 30, inp);
        applyPickPose(d.model, pose, 0, 0, lookOffset);
        const out: Hit[] = [];
        measure(d, ob, `pick ${species} t=${t.toFixed(2)} look=${lookOffset}`, out, pose.lift > 0.05);
        keep(out);
      }
    }
  }
  return hits.sort((a, b) => b.depth - a.depth);
}
