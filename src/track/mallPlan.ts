/**
 * Scenery plan for an indoor shopping mall (Palm Plaza, `scenery.mall`): where the palm planters, the parked cars, the
 * lamp posts and the garage gates stand, and their collision shapes. Pure TypeScript, deterministic (seeded), used by
 * both the simulation (colliders) and the renderer (src/render/env/mall.ts), like the rest of the scenery plan.
 *
 * The usual planner (trees, houses, grandstands...) is skipped on a mall track; this one runs instead (see sceneryPlan.ts).
 * Everything solid keeps clear of every road (main loop and branches) by the off-road strip plus a margin, of the car
 * lanes of the parking lot, and of the item boxes.
 */
import type { Track, TrackSample } from '../sim/track';
import type { CarDef } from './hazardTypes';
import type { Collider, Placement, Site } from './sceneryPlan';

/** A palm tree in a round planter (solid planter). */
export type PalmItem = Placement;
/** A parked car (solid box), nose to the road. `color` is an index into the renderer's car palette. */
export interface ParkedCarItem extends Placement {
  color: number;
}
/** A garage gate building at the end of a car lane (solid box): the lot's moving cars drive in and out of it. */
export interface GarageItem extends Placement {
  /** Size: w across the lane (along the road), d along the lane (away from the road), h tall. */
  w: number;
  d: number;
  h: number;
}
/** A lamp post in the parking lot (solid thin pole). */
export type LampItem = Placement;

export interface MallPlan {
  palms: PalmItem[];
  parkedCars: ParkedCarItem[];
  garages: GarageItem[];
  lamps: LampItem[];
}

/** Planter radius (m) and palm spacing along the road (m). */
export const PLANTER_R = 1.3;
const PALM_STEP = 34;
/** Parked car half size (m): across, along its length. */
export const PARKED_HW = 1.0;
export const PARKED_HD = 2.3;
/** Garage gate size (m). */
export const GARAGE_W = 9;
export const GARAGE_D = 7;
export const GARAGE_H = 4.2;

/**
 * Plan the mall's solid props. `h` is the ground height (the terrain, which is level with the floor the road is on near
 * the road), `solidOf` records a collider in the plan, `rnd` is the planner's seeded random stream.
 */
export function planMall(site: Site, track: Track, h: (x: number, z: number) => number, rnd: () => number, seed: () => number, solidOf: (c: Collider) => void): MallPlan {
  const def = track.def;
  const out: MallPlan = { palms: [], parkedCars: [], garages: [], lamps: [] };
  const outer = def.width / 2 + def.offroadWidth;
  const clearance = outer + 1.6; // what the scenery test asks for (outer + 1.5), plus a hair
  const lanes = (def.hazards ?? []).filter((h): h is CarDef => h.kind === 'car').map((h) => ({ s: track.sAt(h.at), reach: h.reach ?? def.width / 2 + 16 }));
  const lot = def.scenery.mall!.lot;
  const lotS0 = track.sAt(lot.from) - 20;
  const lotS1 = lanes.length ? Math.max(...lanes.map((l) => l.s)) + 30 : track.sAt(lot.to);
  const inLot = (s: number) => track.deltaS(lotS0, s) >= 0 && track.deltaS(s, lotS1) >= 0;
  const nearLane = (s: number, margin: number) => lanes.some((l) => Math.abs(track.deltaS(l.s, s)) < margin);
  const nearBox = (x: number, z: number, r: number) => track.itemBoxes.some((b) => Math.hypot(b.x - x, b.z - z) < r + 3.5);
  const free = (x: number, z: number, r: number) => site.distToTrack(x, z) > clearance + r && site.isFree(x, z, r) && !nearBox(x, z, r);
  const circle = (x: number, z: number, y: number, r: number, height: number): Collider => ({ shape: 'circle', x, z, y, r, height, solid: true });
  const box = (x: number, z: number, y: number, hw: number, hd: number, rotY: number, height: number): Collider => ({ shape: 'box', x, z, y, hw, hd, rotY, height, solid: true });
  const at = (p: TrackSample, d: number): [number, number] => [p.x + p.rx * d, p.z + p.rz * d];

  // Garage gates first (they reserve the lane ends): one at each end of every car lane.
  for (const l of lanes) {
    const p = track.pointAt(l.s, 0);
    const smp = track.samples[p.index];
    for (const side of [-1, 1]) {
      const [x, z] = at(smp, side * (l.reach + GARAGE_D / 2 - 1));
      const rotY = smp.heading; // local z along the road, local x across it (along the lane)
      const y = h(x, z);
      const c = box(x, z, y, GARAGE_D / 2, GARAGE_W / 2, rotY, GARAGE_H);
      solidOf(c);
      site.reserve(x, z, Math.hypot(GARAGE_W, GARAGE_D) / 2);
      out.garages.push({ x, z, y, scale: 1, rotationY: rotY, seed: seed(), solid: true, collider: c, w: GARAGE_W, d: GARAGE_D, h: GARAGE_H });
    }
  }

  // Palms in planters along the road, both sides, a few metres beyond the railing (on the floor the road is on). None
  // beside the escalators (that is the open atrium between the floors).
  const S = track.samples;
  const step = Math.max(1, Math.round(PALM_STEP / track.spacing));
  const escalators = (def.hazards ?? []).filter((hz) => hz.kind === 'escalator').map((hz) => ({ s0: track.sAt(hz.from) - 45, s1: track.sAt(hz.to) + 45 }));
  for (let i = 0; i < S.length; i += step) {
    const p = S[i];
    if (nearLane(p.s, 7)) continue; // keep the car lanes clear
    if (escalators.some((e) => track.deltaS(e.s0, p.s) >= 0 && track.deltaS(p.s, e.s1) >= 0)) continue;
    for (const side of [-1, 1]) {
      const d = side * (clearance + PLANTER_R + 0.6 + rnd() * 1.5);
      const [x, z] = at(p, d);
      if (!free(x, z, PLANTER_R)) continue;
      const y = h(x, z);
      const c = circle(x, z, y, PLANTER_R, 3.2);
      solidOf(c);
      site.reserve(x, z, PLANTER_R + 1);
      out.palms.push({ x, z, y, scale: 0.85 + rnd() * 0.35, rotationY: rnd() * Math.PI * 2, seed: seed(), solid: true, collider: c });
    }
  }

  // Parking lot: rows of parked cars beside the road (nose to it) between the car lanes, and lamp posts.
  for (let i = 0; i < S.length; i++) {
    const p = S[i];
    if (!inLot(p.s) || i % 2 !== 0) continue;
    for (const side of [-1, 1]) {
      // Cars every ~3 m along the road at two distances (two bays deep).
      for (const lat of [clearance + 4.5, clearance + 10.5]) {
        if (i % 2 !== 0 || nearLane(p.s, 6.5) || rnd() < 0.35) continue;
        const [x, z] = at(p, side * lat);
        if (!free(x, z, PARKED_HD)) continue;
        const rotY = p.heading + Math.PI / 2;
        const y = h(x, z);
        const c = box(x, z, y, PARKED_HW, PARKED_HD, rotY, 1.5);
        solidOf(c);
        site.reserve(x, z, PARKED_HW + 0.3);
        out.parkedCars.push({ x, z, y, scale: 1, rotationY: rotY + (side < 0 ? Math.PI : 0), seed: seed(), solid: true, collider: c, color: Math.floor(rnd() * 8) });
      }
    }
    if (i % 12 === 0) {
      for (const side of [-1, 1]) {
        const [x, z] = at(p, side * (clearance + 1.2));
        if (nearLane(p.s, 5) || !free(x, z, 0.3)) continue;
        const y = h(x, z);
        const c = circle(x, z, y, 0.3, 7);
        solidOf(c);
        out.lamps.push({ x, z, y, scale: 1, rotationY: p.heading, seed: seed(), solid: true, collider: c });
      }
    }
  }
  return out;
}
