/**
 * Scenery plan for an indoor shopping mall (Palm Plaza, `scenery.mall`): where the building's walls and their gates are,
 * how far the upper-floor slabs and the parking deck reach, and where the palm planters, the parked cars, the lamp posts
 * and the garage gates stand (with their collision shapes). Pure TypeScript, deterministic (seeded), used by both the
 * simulation (colliders), the renderer (src/render/env/mall.ts, mallShell.ts) and the tests (nothing may clip a road).
 *
 * The usual planner (trees, houses, grandstands...) is skipped on a mall track; this one runs instead (see sceneryPlan.ts).
 * Everything solid keeps clear of every road (main loop and branches) by the off-road strip plus a margin, and of the item
 * boxes. Things stand on the floor of the road they belong to (its height), never on the terrain blend.
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
/** A garage gate beside the road where the deck's moving cars come and go (solid box). */
export interface GarageItem extends Placement {
  /** Size: w along the road, d across it (away from the road), h tall. */
  w: number;
  d: number;
  h: number;
}
/** A lamp post on the parking deck (solid thin pole). */
export type LampItem = Placement;

/** A wall of the building: one edge of the footprint, with openings where roads pass through it. */
export interface MallWall {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Openings along the edge: u0..u1 (m from a), open from the floor up to `top` (m). */
  openings: { u0: number; u1: number; top: number }[];
}

/** How far a floor slab reaches on each side of a road sample (m from the centre line). */
export interface SlabSpan {
  i: number;
  left: number;
  right: number;
}

export interface MallShellPlan {
  walls: MallWall[];
  /** Upper-floor slab along the main road's upper stretches (main sample indices). */
  upper: SlabSpan[];
  /** Parking-deck slab along the main road (main sample indices). */
  deck: SlabSpan[];
  /** Roof height (m). */
  roofY: number;
}

export interface MallPlan {
  palms: PalmItem[];
  parkedCars: ParkedCarItem[];
  garages: GarageItem[];
  lamps: LampItem[];
  shell: MallShellPlan;
}

/** Planter radius (m) and palm spacing along the road (m). */
export const PLANTER_R = 1.3;
const PALM_STEP = 34;
/** Parked car half size (m): across, along its length. */
export const PARKED_HW = 1.0;
export const PARKED_HD = 2.3;
/** Garage gate size (m): along the road, across it, height. */
export const GARAGE_W = 9;
export const GARAGE_D = 7;
export const GARAGE_H = 4.2;
/** Roof height above the upper floor (m). */
export const ROOF_ABOVE_UPPER = 17;
/** Widest an upper-floor slab reaches from the road centre (m), and the parking deck. */
export const SLAB_MAX = 30;
export const DECK_MAX = 30;
/** Headroom (m) of a gate in the building's wall above the road. */
export const GATE_HEADROOM = 9;

/** Is (x, z) inside the polygon (even-odd rule)? */
export function insidePolygon(poly: [number, number][], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Every road sample of the track (main loop and branches). */
export function allRoadSamples(track: Track): TrackSample[] {
  return [...track.samples, ...track.branches.flatMap((b) => b.samples)];
}

/**
 * The building and the floors: walls along the footprint (an opening wherever a road passes through, sized for its width
 * and the crossing angle), and how far the upper-floor slab and the parking deck reach on each side of the main road.
 * A slab never reaches over a road on another level (the atrium stays open above the ground-floor routes and round the
 * escalators) and never through the building's wall (the upper floor stays inside, the deck outside).
 */
export function planMallShell(track: Track): MallShellPlan {
  const def = track.def;
  const mall = def.scenery.mall!;
  const outer = def.width / 2 + def.offroadWidth;
  const roads = allRoadSamples(track);
  const poly = mall.building;
  const walls: MallWall[] = [];
  for (let e = 0; e < poly.length; e++) {
    const [ax, az] = poly[e];
    const [bx, bz] = poly[(e + 1) % poly.length];
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const raw: { u0: number; u1: number; top: number }[] = [];
    // Crossings of every road's centre line with this edge.
    const lines = [track.samples, ...track.branches.map((b) => b.samples)];
    lines.forEach((ss, li) => {
      const closed = li === 0;
      for (let i = 0; i < ss.length - (closed ? 0 : 1); i++) {
        const p = ss[i];
        const q = ss[(i + 1) % ss.length];
        const den = (q.x - p.x) * uz - (q.z - p.z) * ux;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((ax - p.x) * uz - (az - p.z) * ux) / den;
        const u = ((ax - p.x) * (q.z - p.z) - (az - p.z) * (q.x - p.x)) / den;
        if (t < 0 || t > 1 || u < 0 || u > len) continue;
        const sin = Math.abs((p.tx * uz - p.tz * ux));
        const half = (p.width / 2 + def.offroadWidth + 2) / Math.max(0.3, sin);
        const y = p.y + (q.y - p.y) * t;
        raw.push({ u0: u - half, u1: u + half, top: y + GATE_HEADROOM });
      }
    });
    raw.sort((a, b) => a.u0 - b.u0);
    const openings: MallWall['openings'] = [];
    for (const o of raw) {
      const last = openings[openings.length - 1];
      if (last && o.u0 <= last.u1) {
        last.u1 = Math.max(last.u1, o.u1);
        last.top = Math.max(last.top, o.top);
      } else openings.push({ ...o });
    }
    walls.push({ ax, az, bx, bz, openings });
  }

  /** How far (m) a slab at height y may reach from sample p to one side before it would cover another level or cross the wall. */
  const reach = (p: TrackSample, side: number, y: number, max: number, wantInside: boolean): number => {
    for (let d = outer + 0.5; d <= max; d += 1) {
      const x = p.x + p.rx * side * d;
      const z = p.z + p.rz * side * d;
      if (insidePolygon(poly, x, z) !== wantInside) return Math.max(outer, d - 1.5);
      for (const q of roads) {
        if (Math.abs(q.y - y) < 1.5) continue;
        const r = q.width / 2 + def.offroadWidth + 1.5;
        if ((q.x - x) ** 2 + (q.z - z) ** 2 < r * r) return Math.max(outer, d - 1.5);
      }
    }
    return max;
  };
  /** Slab spans along a stretch, narrowed to the smallest reach of the neighbours (so the edge does not jag). */
  const spans = (idx: number[], y: (p: TrackSample) => number, max: number, wantInside: boolean): SlabSpan[] => {
    const S = track.samples;
    const raw = idx.map((i) => ({ i, left: reach(S[i], -1, y(S[i]), max, wantInside), right: reach(S[i], 1, y(S[i]), max, wantInside) }));
    return raw.map((r, k) => {
      const nb = raw.slice(Math.max(0, k - 3), k + 4);
      return { i: r.i, left: Math.min(...nb.map((n) => n.left)), right: Math.min(...nb.map((n) => n.right)) };
    });
  };
  const inRange = (s: number, from: number, to: number) => track.deltaS(track.sAt(from), s) >= 0 && track.deltaS(s, track.sAt(to)) >= 0;
  const S = track.samples;
  const upperIdx = S.map((_, i) => i).filter((i) => mall.upperFloor.some((r) => inRange(S[i].s, r.from, r.to)) && S[i].y > mall.upper - 0.6);
  const deckIdx = S.map((_, i) => i).filter((i) => inRange(S[i].s, mall.deck.from, mall.deck.to));
  return {
    walls,
    upper: spans(upperIdx, () => mall.upper, SLAB_MAX, true),
    deck: spans(deckIdx, (p) => p.y, DECK_MAX, false),
    roofY: mall.upper + ROOF_ABOVE_UPPER,
  };
}

/**
 * Plan the mall's solid props. `h` is the ground height (unused: everything stands on the floor of its road), `solidOf`
 * records a collider in the plan, `rnd` is the planner's seeded random stream.
 */
export function planMall(site: Site, track: Track, _h: (x: number, z: number) => number, rnd: () => number, seed: () => number, solidOf: (c: Collider) => void): MallPlan {
  const def = track.def;
  const mall = def.scenery.mall!;
  const shell = planMallShell(track);
  const out: MallPlan = { palms: [], parkedCars: [], garages: [], lamps: [], shell };
  const outer = def.width / 2 + def.offroadWidth;
  const clearance = outer + 1.6; // what the scenery test asks for (outer + 1.5), plus a hair
  const S = track.samples;
  const inRange = (s: number, from: number, to: number) => track.deltaS(track.sAt(from), s) >= 0 && track.deltaS(s, track.sAt(to)) >= 0;
  const nearBox = (x: number, z: number, r: number) => track.itemBoxes.some((b) => Math.hypot(b.x - x, b.z - z) < r + 3.5);
  const roads = allRoadSamples(track);
  /** Clear of every road at any level (2D), of other solids, of the item boxes, and of the building's walls. */
  const free = (x: number, z: number, r: number) =>
    site.distToTrack(x, z) > clearance + r && site.isFree(x, z, r) && !nearBox(x, z, r) && shell.walls.every((w) => segDist(w, x, z) > r + 1);
  /** Nothing of another level passes within `r` (+ its half width) of (x, z) between heights y0 and y1. */
  const clearAbove = (x: number, z: number, r: number, y0: number, y1: number) =>
    roads.every((q) => q.y < y0 || q.y > y1 || Math.hypot(q.x - x, q.z - z) > r + q.width / 2 + def.offroadWidth);
  const circle = (x: number, z: number, y: number, r: number, height: number): Collider => ({ shape: 'circle', x, z, y, r, height, solid: true });
  const box = (x: number, z: number, y: number, hw: number, hd: number, rotY: number, height: number): Collider => ({ shape: 'box', x, z, y, hw, hd, rotY, height, solid: true });
  const at = (p: TrackSample, d: number): [number, number] => [p.x + p.rx * d, p.z + p.rz * d];
  /** The slab span at main sample i (upper floor or deck), if any. */
  const spanAt = new Map<number, SlabSpan>();
  for (const sp of [...shell.upper, ...shell.deck]) spanAt.set(sp.i, sp);
  const onSlab = (i: number, d: number, r: number) => {
    const sp = spanAt.get(i);
    return !sp || (d < 0 ? -d + r < sp.left : d + r < sp.right);
  };

  // Garage gates first (they reserve the car stretches' ends): one where each car comes out, one where it goes in.
  const lanes = (def.hazards ?? []).filter((hz): hz is CarDef => hz.kind === 'car');
  for (const l of lanes) {
    const s0 = track.sAt(l.from);
    const s1 = track.sAt(l.to);
    const ends: [number, number, number][] = l.dir > 0 ? [[s0, l.sides[0], -1], [s1, l.sides[l.sides.length - 1], 1]] : [[s1, l.sides[0], 1], [s0, l.sides[l.sides.length - 1], -1]];
    for (const [s, side, back] of ends) {
      // The gate stands just beyond the parapet (2 m), set back a little behind the point where the car leaves / joins the road.
      const p = track.pointAt(s + back * 2, side * (outer + 2 + GARAGE_D / 2));
      const smp = S[p.index];
      const rotY = smp.heading;
      const c = box(p.x, p.z, smp.y, GARAGE_D / 2, GARAGE_W / 2, rotY, GARAGE_H);
      solidOf(c);
      site.reserve(p.x, p.z, Math.hypot(GARAGE_W, GARAGE_D) / 2);
      out.garages.push({ x: p.x, z: p.z, y: smp.y, scale: 1, rotationY: rotY, seed: seed(), solid: true, collider: c, w: GARAGE_W, d: GARAGE_D, h: GARAGE_H });
    }
  }

  // Palms in planters along the road, both sides, a few metres beyond the railing, on the road's floor. None on the
  // escalators or the spiral (open atrium / a ramp in the air) and only where the floor is there (slab spans).
  const step = Math.max(1, Math.round(PALM_STEP / track.spacing));
  const skip = (def.hazards ?? []).filter((hz) => hz.kind === 'escalator').map((hz) => ({ s0: track.sAt(hz.from) - 45, s1: track.sAt(hz.to) + 45 }));
  if (mall.spiral) skip.push({ s0: track.sAt(mall.spiral.from) - 10, s1: track.sAt(mall.spiral.to) + 10 });
  for (let i = 0; i < S.length; i += step) {
    const p = S[i];
    if (skip.some((e) => track.deltaS(e.s0, p.s) >= 0 && track.deltaS(p.s, e.s1) >= 0) || (p.y > 0.5 && !spanAt.has(i))) continue;
    for (const side of [-1, 1]) {
      const d = side * (clearance + PLANTER_R + 0.6 + rnd() * 1.5);
      const [x, z] = at(p, d);
      if (!free(x, z, PLANTER_R) || !onSlab(i, d, PLANTER_R) || !clearAbove(x, z, PLANTER_R + 1, p.y + 0.5, p.y + 9)) continue;
      const c = circle(x, z, p.y, PLANTER_R, 3.2);
      solidOf(c);
      site.reserve(x, z, PLANTER_R + 1);
      out.palms.push({ x, z, y: p.y, scale: 0.85 + rnd() * 0.35, rotationY: rnd() * Math.PI * 2, seed: seed(), solid: true, collider: c });
    }
  }
  // Palm islands along the lower route's atrium floor (both sides, where there is room).
  if (mall.low !== undefined) {
    const b = track.branches[mall.low];
    const bstep = Math.max(1, Math.round(26 / b.spacing));
    const bOuter = b.samples[0].width / 2 + def.offroadWidth;
    for (let i = bstep; i < b.samples.length - bstep; i += bstep) {
      const p = b.samples[i];
      if (p.y > 0.5) continue;
      for (const side of [-1, 1]) {
        const [x, z] = at(p, side * (bOuter + 2.6 + rnd()));
        if (!free(x, z, PLANTER_R) || !insidePolygon(mall.building, x, z) || !clearAbove(x, z, PLANTER_R + 1, 0.5, 30)) continue;
        const c = circle(x, z, p.y, PLANTER_R, 3.2);
        solidOf(c);
        site.reserve(x, z, PLANTER_R + 1);
        out.palms.push({ x, z, y: p.y, scale: 0.9 + rnd() * 0.35, rotationY: rnd() * Math.PI * 2, seed: seed(), solid: true, collider: c });
      }
    }
  }

  // Parking deck: rows of parked cars beside the road (nose to it), and lamp posts.
  const deckS0 = track.sAt(mall.deck.from);
  const deckS1 = track.sAt(mall.deck.to);
  const nearGate = (x: number, z: number, r: number) => out.garages.some((g) => Math.hypot(g.x - x, g.z - z) < r + 7);
  for (let i = 0; i < S.length; i += 2) {
    const p = S[i];
    if (!inRange(p.s, mall.deck.from, mall.deck.to) || track.deltaS(deckS0, p.s) < 8 || track.deltaS(p.s, deckS1) < 8) continue;
    for (const side of [-1, 1]) {
      // Cars every ~4 m along the road at two distances (two bays deep).
      for (const lat of [clearance + 4.5, clearance + 10.5]) {
        if (rnd() < 0.35) continue;
        const [x, z] = at(p, side * lat);
        if (!free(x, z, PARKED_HD) || nearGate(x, z, PARKED_HD) || !onSlab(i, side * lat, PARKED_HD + 0.5)) continue;
        const rotY = p.heading + Math.PI / 2;
        const c = box(x, z, p.y, PARKED_HW, PARKED_HD, rotY, 1.5);
        solidOf(c);
        site.reserve(x, z, PARKED_HW + 0.3);
        out.parkedCars.push({ x, z, y: p.y, scale: 1, rotationY: rotY + (side < 0 ? Math.PI : 0), seed: seed(), solid: true, collider: c, color: Math.floor(rnd() * 8) });
      }
    }
    if (i % 12 === 0) {
      for (const side of [-1, 1]) {
        const [x, z] = at(p, side * (clearance + 1.2));
        if (!free(x, z, 0.3) || nearGate(x, z, 0.3)) continue;
        const c = circle(x, z, p.y, 0.3, 7);
        solidOf(c);
        out.lamps.push({ x, z, y: p.y, scale: 1, rotationY: p.heading, seed: seed(), solid: true, collider: c });
      }
    }
  }
  return out;
}

/** Horizontal distance from (x, z) to a wall's segment. */
export function segDist(w: MallWall, x: number, z: number): number {
  const dx = w.bx - w.ax;
  const dz = w.bz - w.az;
  const t = Math.max(0, Math.min(1, ((x - w.ax) * dx + (z - w.az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(w.ax + dx * t - x, w.az + dz * t - z);
}
