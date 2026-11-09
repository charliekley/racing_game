/**
 * Scenery PLAN: where every tree, house, rock, grandstand, fence, hay bale and
 * banner board stands, and what shape it is for collisions.
 *
 * Pure TypeScript (no Three.js, no DOM): the simulation builds its colliders
 * from this plan and the renderer builds its meshes from the same plan, so
 * "what you see is what you hit".
 *
 * Placement is seeded (`def.scenery.seed`), so a track gets the same layout on
 * every load. Each item carries its own `seed`; the renderer uses it for
 * cosmetic choices (colors, small details) so those never disturb the layout.
 *
 * Coordinate conventions (same as the rest of the game): Y up, rotationY = yaw
 * in radians where local +z points to (sin r, cos r) and local +x to (cos r, -sin r).
 */
import type { Track, TrackSample } from '../sim/track';
import type { TrackDef } from './types';

// ---------------------------------------------------------------------------
// Public data types
// ---------------------------------------------------------------------------

/** A solid shape on the ground plane. `height` = how tall it is above `y` (karts higher than this fly over). */
export type Collider =
  | { shape: 'circle'; x: number; z: number; y: number; r: number; height: number; solid: boolean }
  | { shape: 'box'; x: number; z: number; y: number; hw: number; hd: number; rotY: number; height: number; solid: boolean };

/** Fields every placed object has. */
export interface Placement {
  x: number;
  z: number;
  /** Ground height at (x, z): the track's terrain (0 on flat tracks) unless `planScenery` got a `heightAt`. */
  y: number;
  scale: number;
  rotationY: number;
  /** Cosmetic random seed for the renderer (colors, little details). */
  seed: number;
  /** Can a kart bump into it? */
  solid: boolean;
  /** Collision shape (null when not solid). */
  collider: Collider | null;
}

export type TreeKind = 'pine' | 'round' | 'poplar' | 'cactus';

export interface TreeItem extends Placement {
  variant: TreeKind;
}
/** Bushes are soft: you drive through them. */
export type BushItem = Placement;
export interface RockItem extends Placement {
  /** Squashed size along the three axes (scale * random factor). */
  sx: number;
  sy: number;
  sz: number;
  /** Tilt (rad) and whether a small twin rock sits beside it. */
  tilt: number;
  twin: boolean;
}
export interface HouseItem extends Placement {
  /** Footprint width (local x), height, depth (local z). */
  w: number;
  h: number;
  d: number;
}
export interface GrandstandItem extends Placement {
  /** Position/rotation describe the front-center on the ground; local +x points away from the road. */
  side: -1 | 1;
  /** 0, 1: which roof color. */
  index: number;
  length: number;
  rows: number;
  rowDepth: number;
}
export interface FenceItem extends Placement {
  /** Length of this fence panel (m); it starts at (x, z) and runs along rotationY. */
  len: number;
}
/** A pile of three hay bales in a local frame. */
export type HayItem = Placement;
/** A banner board on two flag posts, facing the road (local +z points at the road). */
export type BannerBoardItem = Placement;
/** Start/finish gantry post. */
export interface GantryPostItem extends Placement {
  /** Half-width of the footprint. */
  half: number;
}

export interface SceneryPlan {
  biome: Biome;
  /** Centre and half-size of the scenery area (for the far hills/mountains/clouds). */
  bounds: { cx: number; cz: number; radius: number };
  trees: TreeItem[];
  bushes: BushItem[];
  rocks: RockItem[];
  houses: HouseItem[];
  grandstands: GrandstandItem[];
  fences: FenceItem[];
  hayBales: HayItem[];
  bannerBoards: BannerBoardItem[];
  gantryPosts: GantryPostItem[];
  /** Circles taken by big buildings (so ground detail keeps clear). */
  reserved: { x: number; z: number; r: number }[];
  /** Every solid collider of every item above (what the simulation uses). */
  colliders: Collider[];
  /** Ground height lookup used for `y` (also used by the renderer for ground detail). */
  heightAt: (x: number, z: number) => number;
}

// ---------------------------------------------------------------------------
// Biomes (the rules that matter to placement; the look lives in the renderer)
// ---------------------------------------------------------------------------

export type Biome = 'meadow' | 'autumn' | 'desert' | 'snow';

export interface BiomeRules {
  /** Relative weights of tree kinds. */
  trees: Partial<Record<TreeKind, number>>;
  /** Multiplier on the track's tree count. */
  treeDensity: number;
  rockDensity: number;
  hayBales: boolean;
}

export const BIOME_RULES: Record<Biome, BiomeRules> = {
  meadow: { trees: { round: 0.45, pine: 0.35, poplar: 0.2 }, treeDensity: 1, rockDensity: 0.3, hayBales: true },
  autumn: { trees: { round: 0.55, pine: 0.25, poplar: 0.2 }, treeDensity: 1, rockDensity: 0.35, hayBales: true },
  desert: { trees: { cactus: 0.75, round: 0.25 }, treeDensity: 0.4, rockDensity: 0.9, hayBales: false },
  snow: { trees: { pine: 1 }, treeDensity: 1, rockDensity: 0.4, hayBales: false },
};

/** "#rrggbb" / "#rgb" → hue, saturation, lightness (all 0..1), like a paint program shows them. */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  let t = hex.replace('#', '');
  if (t.length === 3) t = t.split('').map((c) => c + c).join('');
  const r = parseInt(t.slice(0, 2), 16) / 255;
  const g = parseInt(t.slice(2, 4), 16) / 255;
  const b = parseInt(t.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h / 6, s, l };
}

/** Guess the biome from the theme's grass color. */
export function biomeFor(theme: TrackDef['theme']): Biome {
  const { h, s, l } = hexToHsl(theme.grass);
  if (l > 0.72 && s < 0.4) return 'snow'; // pale, washed-out ground
  if (h >= 0.17 && h <= 0.5) return 'meadow'; // yellow-green … teal
  if (h < 0.17 || h > 0.92) return l > 0.5 ? 'desert' : 'autumn'; // sand vs. brown/orange
  return 'meadow';
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Same tiny seeded generator as the renderer's textures (mulberry32). */
export function planRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Local frame → world: local (lx, lz) of a frame at (x, z) turned by `rot`. */
export function localToWorld(x: number, z: number, rot: number, lx: number, lz: number): [number, number] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}

function pickWeighted<K extends string>(weights: Partial<Record<K, number>>, r: number): K {
  const entries = Object.entries(weights) as [K, number][];
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let x = r * total;
  for (const [k, w] of entries) {
    x -= w;
    if (x <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

/** Where is there room? (Distance to the road, reserved circles, random points.) */
export class Site {
  readonly S: TrackSample[];
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly cx: number;
  readonly cz: number;
  /** Half the larger side of the scenery area. */
  readonly radius: number;
  /** Distance from the centerline to the outer edge of the off-road strip (where walls stand). */
  readonly outer: number;

  constructor(
    readonly track: Track,
    readonly reserved: { x: number; z: number; r: number }[] = [],
  ) {
    this.S = track.samples;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of this.S) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    this.minX = minX - 120;
    this.maxX = maxX + 120;
    this.minZ = minZ - 120;
    this.maxZ = maxZ + 120;
    this.cx = (this.minX + this.maxX) / 2;
    this.cz = (this.minZ + this.maxZ) / 2;
    this.radius = Math.max(this.maxX - this.minX, this.maxZ - this.minZ) / 2;
    this.outer = track.def.width / 2 + track.def.offroadWidth;
  }

  /** Distance from (x, z) to the nearest centerline sample (every 2nd sample is plenty). */
  distToTrack(x: number, z: number): number {
    let best = Infinity;
    for (let i = 0; i < this.S.length; i += 2) best = Math.min(best, (this.S[i].x - x) ** 2 + (this.S[i].z - z) ** 2);
    return Math.sqrt(best);
  }

  /** Mark a circle as taken (grandstands, houses) so trees don't grow through it. */
  reserve(x: number, z: number, r: number): void {
    this.reserved.push({ x, z, r });
  }

  isFree(x: number, z: number, r = 0): boolean {
    return this.reserved.every((c) => (c.x - x) ** 2 + (c.z - z) ** 2 > (c.r + r) ** 2);
  }

  /** Random point in the scenery rectangle. */
  randomPoint(rnd: () => number): [number, number] {
    return [this.minX + rnd() * (this.maxX - this.minX), this.minZ + rnd() * (this.maxZ - this.minZ)];
  }

  /** Point `d` metres to the side of sample p (d > 0 = along the sample's right vector). */
  beside(p: TrackSample, d: number): [number, number] {
    return [p.x + p.rx * d, p.z + p.rz * d];
  }

  /** Sample `ds` metres from sample index i (wraps around the loop). */
  sampleAt(i: number, ds: number): TrackSample {
    const n = this.S.length;
    return this.S[(((i + Math.round(ds / this.track.spacing)) % n) + n) % n];
  }
}

// ---------------------------------------------------------------------------
// Nominal collider heights (m). Karts flying higher than base + height pass over.
// ---------------------------------------------------------------------------
const H_TREE = 4;
const H_ROCK = 1.2;
const H_FENCE = 1.2;
const H_HAY = 1.8;
const H_BOARD = 2.9;
const H_POST = 6.8;

const circle = (x: number, z: number, y: number, r: number, height: number, solid = true): Collider => ({ shape: 'circle', x, z, y, r, height, solid });
const box = (x: number, z: number, y: number, hw: number, hd: number, rotY: number, height: number, solid = true): Collider => ({ shape: 'box', x, z, y, hw, hd, rotY, height, solid });

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

const planCache = new WeakMap<Track, SceneryPlan>();

/**
 * Plan all scenery for a track. Deterministic. Results are cached per Track
 * object when no `heightAt` is given, so the renderer and the simulation share
 * one computation.
 *
 * @param heightAt optional ground height override; defaults to `track.terrain.height` (items stand on it).
 */
export function planScenery(track: Track, heightAt?: (x: number, z: number) => number): SceneryPlan {
  if (!heightAt) {
    const cached = planCache.get(track);
    if (cached) return cached;
  }
  // Items stand on the track's own terrain (0 on flat tracks), so hills carry their trees and houses.
  const h = heightAt ?? ((x: number, z: number) => track.terrain.height(x, z));
  const def = track.def;
  const rnd = planRandom(def.scenery.seed);
  const biome = biomeFor(def.theme);
  const rules = BIOME_RULES[biome];
  const site = new Site(track);
  const seed = () => Math.floor(rnd() * 4294967296);

  const plan: SceneryPlan = {
    biome,
    bounds: { cx: site.cx, cz: site.cz, radius: site.radius },
    trees: [],
    bushes: [],
    rocks: [],
    houses: [],
    grandstands: [],
    fences: [],
    hayBales: [],
    bannerBoards: [],
    gantryPosts: [],
    reserved: site.reserved,
    colliders: [],
    heightAt: h,
  };
  const solidOf = (c: Collider | null): void => {
    if (c && c.solid) plan.colliders.push(c);
  };

  // Big man-made things first, so nature can grow around them.
  planGrandstands(site, plan, h, seed, solidOf);
  planHouses(site, plan, h, rnd, seed, solidOf, def.scenery.buildings);
  planTrackside(site, plan, h, rnd, seed, solidOf, rules);
  planTrees(site, plan, h, rnd, seed, solidOf, rules, Math.round(def.scenery.trees * rules.treeDensity));
  planBushesAndRocks(site, plan, h, rnd, seed, solidOf, rules, def.scenery.trees);
  planGantry(site, plan, h, solidOf);

  if (!heightAt) planCache.set(track, plan);
  return plan;
}

// ---- Grandstands near the start/finish line -------------------------------

export const GRANDSTAND = { LENGTH: 36, ROWS: 5, ROW_DEPTH: 1.4 } as const;

function planGrandstands(site: Site, plan: SceneryPlan, h: (x: number, z: number) => number, seed: () => number, solidOf: (c: Collider | null) => void): void {
  const { LENGTH, ROWS, ROW_DEPTH } = GRANDSTAND;
  const DEPTH = ROWS * ROW_DEPTH + 1;
  const center = site.sampleAt(0, -14); // a little before the line, where the grid is
  // Is the road straight here?
  for (let ds = -LENGTH / 2; ds <= LENGTH / 2; ds += 3) {
    const p = site.sampleAt(0, -14 + ds);
    const lateral = (p.x - center.x) * center.rx + (p.z - center.z) * center.rz;
    if (Math.abs(lateral) > 1.5) return;
  }
  let made = 0;
  for (const side of [-1, 1] as const) {
    const front = site.outer + 4;
    // The whole footprint must be clear of other parts of the track.
    let clear = true;
    for (let a = -LENGTH / 2; a <= LENGTH / 2 && clear; a += 4)
      for (let o = 0; o <= DEPTH + 2; o += 2) {
        const p = site.sampleAt(0, -14 + a);
        const [x, z] = site.beside(p, side * (front + o));
        if (site.distToTrack(x, z) < site.outer + 2) clear = false;
      }
    if (!clear) continue;

    const [ox, oz] = site.beside(center, side * front);
    const outX = center.rx * side;
    const outZ = center.rz * side;
    // Local x = away from the road = (cos r, -sin r); local z = along = (sin r, cos r).
    const rotationY = Math.atan2(-outZ, outX);
    site.reserve(ox + (outX * DEPTH) / 2, oz + (outZ * DEPTH) / 2, LENGTH / 2 + 6);

    // Solid: from the front wall (x = -0.25) to the back wall (x = rows*depth + 0.3).
    const x0 = -0.25;
    const x1 = ROWS * ROW_DEPTH + 0.3;
    const [cx, cz] = localToWorld(ox, oz, rotationY, (x0 + x1) / 2, 0);
    const y = h(ox, oz);
    const collider = box(cx, cz, y, (x1 - x0) / 2, LENGTH / 2, rotationY, 2.8);
    solidOf(collider);
    plan.grandstands.push({ x: ox, z: oz, y, scale: 1, rotationY, seed: seed(), solid: true, collider, side, index: made, length: LENGTH, rows: ROWS, rowDepth: ROW_DEPTH });
    made++;
  }
}

// ---- Houses ---------------------------------------------------------------

function planHouses(site: Site, plan: SceneryPlan, h: (x: number, z: number) => number, rnd: () => number, seed: () => number, solidOf: (c: Collider | null) => void, count: number): void {
  const clearance = site.outer + 17;
  let made = 0;
  for (let tries = 0; tries < count * 30 && made < count; tries++) {
    const [x, z] = site.randomPoint(rnd);
    const d = site.distToTrack(x, z);
    if (d < clearance || d > 140) continue;
    const w = 6 + rnd() * 6;
    const hh = 4 + rnd() * 5;
    const depth = 6 + rnd() * 5;
    if (!site.isFree(x, z, Math.max(w, depth) * 0.75)) continue;
    site.reserve(x, z, Math.max(w, depth) * 0.75);
    const rotationY = rnd() * Math.PI * 2;
    const y = h(x, z);
    const collider = box(x, z, y, w / 2, depth / 2, rotationY, hh + 1.5);
    solidOf(collider);
    plan.houses.push({ x, z, y, scale: 1, rotationY, seed: seed(), solid: true, collider, w, h: hh, d: depth });
    made++;
  }
}

// ---- Along the track: fences, hay bales, banner boards ---------------------

function planTrackside(site: Site, plan: SceneryPlan, h: (x: number, z: number) => number, rnd: () => number, seed: () => number, solidOf: (c: Collider | null) => void, rules: BiomeRules): void {
  const S = site.S;
  const n = S.length;
  const step = Math.max(1, Math.round(3 / site.track.spacing)); // ~3 m per fence panel
  const RUN = Math.round(60 / site.track.spacing); // decide what to build every ~60 m
  const START_ZONE = 50; // metres around the start line kept for grandstands/gantry

  for (let i0 = 0; i0 < n; i0 += RUN) {
    if (S[i0].s < START_ZONE || S[i0].s > site.track.length - START_ZONE) continue;
    const kind = rnd();
    for (const side of [-1, 1] as const) {
      if (rnd() < 0.45) continue; // leave plenty of open views
      const wall = (p: TrackSample) => (side < 0 ? p.wallLeft : p.wallRight);
      const d = side * (site.outer + 3);
      // Is the spot free of walls, tight corners and other parts of the track?
      const ok = (p: TrackSample) => {
        if (wall(p)) return false;
        const [x, z] = site.beside(p, d);
        return site.distToTrack(x, z) > site.outer + 2.5 && site.isFree(x, z, 2);
      };
      if (kind < 0.55) {
        // Fence: post-and-rail panels following the road.
        const end = i0 + Math.round(RUN * (0.4 + rnd() * 0.5));
        for (let i = i0; i < end; i += step) {
          const a = S[i % n];
          const b = S[(i + step) % n];
          if (!ok(a) || !ok(b)) continue;
          const [ax, az] = site.beside(a, d);
          const [bx, bz] = site.beside(b, d);
          const len = Math.hypot(bx - ax, bz - az);
          const ry = Math.atan2(bx - ax, bz - az);
          const y = h(ax, az);
          // The panel is a thin box from (ax, az) running `len` along its heading.
          const [cx, cz] = localToWorld(ax, az, ry, 0, len / 2);
          const collider = box(cx, cz, y, 0.12, len / 2, ry, H_FENCE);
          solidOf(collider);
          plan.fences.push({ x: ax, z: az, y, scale: 1, rotationY: ry, seed: 0, solid: true, collider, len });
        }
      } else if (kind < 0.75 && rules.hayBales) {
        // A few hay bale stacks.
        for (let k = 0; k < 3; k++) {
          const p = S[(i0 + Math.round(rnd() * RUN)) % n];
          if (!ok(p)) continue;
          const [x, z] = site.beside(p, d + side * rnd() * 2);
          const rotationY = p.heading + (rnd() - 0.5) * 0.4;
          const y = h(x, z);
          // Three bales (1.2 m long, 1.2 m across): footprint 3.2 x 1.2 m.
          const collider = box(x, z, y, 1.4, 0.65, rotationY, H_HAY);
          solidOf(collider);
          plan.hayBales.push({ x, z, y, scale: 1, rotationY, seed: 0, solid: true, collider });
        }
      } else {
        // Banner boards on posts, facing the road.
        const p = S[(i0 + Math.round(RUN / 2)) % n];
        const q = S[(i0 + Math.round(RUN / 2) + 2) % n];
        if (!ok(p) || !ok(q)) continue;
        const [x, z] = site.beside(p, d);
        const rotationY = Math.atan2(-p.rx * side, -p.rz * side); // local +z points at the road
        const y = h(x, z);
        // Board and posts: 6.8 m wide and thin; the posts sit slightly behind it.
        const [cx, cz] = localToWorld(x, z, rotationY, 0, -0.1);
        const collider = box(cx, cz, y, 3.4, 0.1, rotationY, H_BOARD);
        solidOf(collider);
        plan.bannerBoards.push({ x, z, y, scale: 1, rotationY, seed: seed(), solid: true, collider });
      }
    }
  }
}

// ---- Trees, bushes, rocks ---------------------------------------------------

function planTrees(site: Site, plan: SceneryPlan, h: (x: number, z: number) => number, rnd: () => number, seed: () => number, solidOf: (c: Collider | null) => void, rules: BiomeRules, count: number): void {
  const clearance = site.outer + 5;
  // Forest clumps: half the trees gather around a few random centers.
  const clumps = Array.from({ length: 8 }, () => site.randomPoint(rnd));
  let made = 0;
  for (let tries = 0; tries < count * 8 && made < count; tries++) {
    let x: number;
    let z: number;
    if (rnd() < 0.5) {
      const c = clumps[Math.floor(rnd() * clumps.length)];
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 45;
      x = c[0] + Math.cos(a) * r;
      z = c[1] + Math.sin(a) * r;
    } else [x, z] = site.randomPoint(rnd);
    if (site.distToTrack(x, z) < clearance || !site.isFree(x, z, 2)) continue;
    const scale = 0.7 + rnd() * 0.9;
    const rotationY = rnd() * Math.PI * 2;
    const variant = pickWeighted(rules.trees, rnd());
    // Collide with the visible trunk (radius 0.32 at the base), not the crown. Cacti are a bit thicker.
    const trunk = variant === 'cactus' ? 0.4 : 0.34;
    const y = h(x, z);
    const collider = circle(x, z, y, trunk * scale, H_TREE);
    solidOf(collider);
    plan.trees.push({ x, z, y, scale, rotationY, variant, seed: seed(), solid: true, collider });
    made++;
  }
}

function planBushesAndRocks(site: Site, plan: SceneryPlan, h: (x: number, z: number) => number, rnd: () => number, seed: () => number, solidOf: (c: Collider | null) => void, rules: BiomeRules, treeCount: number): void {
  // Most bushes and rocks sit in a band just beyond the off-road strip.
  const nearPoint = (): [number, number] => {
    const p = site.S[Math.floor(rnd() * site.S.length)];
    const side = rnd() < 0.5 ? -1 : 1;
    return site.beside(p, side * (site.outer + 4 + rnd() * 35));
  };
  const bushes = Math.round(treeCount * 0.6);
  for (let k = 0, tries = 0; k < bushes && tries < bushes * 6; tries++) {
    const [x, z] = rnd() < 0.7 ? nearPoint() : site.randomPoint(rnd);
    if (site.distToTrack(x, z) < site.outer + 3.5 || !site.isFree(x, z, 1)) continue;
    const scale = 0.5 + rnd() * 0.8;
    const rotationY = rnd() * 6.28;
    plan.bushes.push({ x, z, y: h(x, z), scale, rotationY, seed: seed(), solid: false, collider: null });
    k++;
  }
  const rocks = Math.round(treeCount * rules.rockDensity);
  for (let k = 0, tries = 0; k < rocks && tries < rocks * 6; tries++) {
    const [x, z] = rnd() < 0.6 ? nearPoint() : site.randomPoint(rnd);
    if (site.distToTrack(x, z) < site.outer + 3.5 || !site.isFree(x, z, 1)) continue;
    const s = 0.4 + rnd() ** 3 * 2.6; // mostly small, a few boulders
    const sx = s * (1 + rnd() * 0.6);
    const sy = s * (0.6 + rnd() * 0.4);
    const rotationY = rnd() * 6.28;
    const tilt = rnd() * 0.5;
    const twin = rnd() < 0.4;
    const y = h(x, z);
    // The dodecahedron's inscribed radius is ~0.8 of its size: collide with that, averaged over x/z.
    const collider = circle(x, z, y, ((sx + s) / 2) * 0.85, Math.max(H_ROCK, sy * 2));
    solidOf(collider);
    plan.rocks.push({ x, z, y, scale: s, rotationY, seed: seed(), solid: true, collider, sx, sy, sz: s, tilt, twin });
    k++;
  }
}

// ---- Start/finish gantry ---------------------------------------------------

/** Gantry posts stand `halfSpan` to each side of the line (see TrackView: width/2 + 1.5). */
function planGantry(site: Site, plan: SceneryPlan, h: (x: number, z: number) => number, solidOf: (c: Collider | null) => void): void {
  const s0 = site.S[0];
  const halfSpan = site.track.def.width / 2 + 1.5;
  for (const side of [-1, 1]) {
    const [x, z] = site.beside(s0, side * halfSpan);
    const y = h(x, z);
    // Post foot is 1.2 m square.
    const collider = box(x, z, y, 0.6, 0.6, s0.heading, H_POST);
    solidOf(collider);
    plan.gantryPosts.push({ x, z, y, scale: 1, rotationY: s0.heading, seed: 0, solid: true, collider, half: 0.6 });
  }
}
