/**
 * Terrain height field: the ground around the road.
 *
 *   height(x, z) = natural terrain (noise hills + mounds/pits)
 *                  blended toward the ROAD's height near the road
 *
 * Near the road (road + off-road strip + a small "skirt") the ground IS the
 * road level, so the road never floats or gets buried. Farther out the ground
 * eases into the natural terrain over `blend` metres (smoothstep).
 *
 * Bridge sections are left out of the blend: under a bridge the ground stays
 * natural, so there is room to drive (or fall) underneath.
 *
 * Pure math, no Three.js. `height` is queried every tick for karts that leave
 * the road strip, and ~40 000 times when the renderer builds its mesh, so the
 * nearest-road lookup uses a spatial grid (a hash of road segments per cell)
 * instead of scanning every sample.
 */
import type { TerrainDef } from '../track/types';

/** Distance (m) beyond the off-road strip where the ground still equals road level. */
export const TERRAIN_SKIRT = 2;
/** Default blend distance (m) from road level to natural terrain. */
export const TERRAIN_BLEND = 16;

/** What the terrain needs to know about the road: a polyline of centerline points. */
export interface RoadPoint {
  x: number;
  z: number;
}

/** Nearest road segment to a point. */
export interface RoadHit {
  /** Segment index (from sample i to i + 1). */
  i: number;
  /** Position along the segment, 0..1. */
  u: number;
  /** Horizontal distance to the centerline (m). */
  dist: number;
  /** Signed lateral offset (m), positive = right of the direction of travel. */
  d: number;
}

/** Anything that can answer "which road segment is nearest?" (the main road). */
export interface RoadLookup {
  nearest(x: number, z: number): RoadHit | null;
}

/** The nearest dirt shortcut path to a point (see shortcuts.ts `PathField`). */
export interface PathHit {
  /** Horizontal distance to the path's centerline (m). */
  dist: number;
  /** The path's smoothed ground level at that point (m). */
  level: number;
  /** Half the path's width (m). */
  halfWidth: number;
}

/** Anything that can answer "which dirt path is nearest?". */
export interface PathLookup {
  nearest(x: number, z: number): PathHit | null;
}

/** Dirt paths: the terrain is pulled to the path's level within this fraction of its half width, then eases out over GROOVE_FALLOFF metres. */
const GROOVE_CORE = 0.6;
export const GROOVE_FALLOFF = 6;
/** A path's groove eases in over this many metres beyond the main road's off-road strip. */
const PATH_EASE_IN = 3;

/** Weight (0..1) of a dirt path's level at distance `dist` from its centerline, for a path of the given half width. */
export function grooveWeight(dist: number, halfWidth: number): number {
  const core = halfWidth * GROOVE_CORE;
  if (dist <= core) return 1;
  const t = (dist - core) / (halfWidth - core + GROOVE_FALLOFF);
  if (t >= 1) return 0;
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Spatial hash of road segments. `skip[i]` = true leaves segment i out
 * (bridge segments). Each segment is filed under the cell of its start point.
 */
export class RoadField {
  private readonly cells = new Map<number, number[]>();
  private readonly cell: number;

  /**
   * @param pts   closed loop of centerline samples (segment i goes pts[i] -> pts[i+1])
   * @param skip  segments to ignore
   * @param radius largest distance we will ever be asked about (m)
   * @param spacing length of one segment (m), only used to pad the search
   */
  constructor(
    private readonly pts: RoadPoint[],
    skip: boolean[],
    private readonly radius: number,
    spacing: number,
  ) {
    // A segment is filed under its start cell but reaches `spacing` further, so
    // a cell at least radius + spacing wide means a 3x3 search always finds it.
    this.cell = radius + spacing + 1;
    for (let i = 0; i < pts.length; i++) {
      if (skip[i]) continue;
      const key = this.key(Math.floor(pts[i].x / this.cell), Math.floor(pts[i].z / this.cell));
      const list = this.cells.get(key);
      if (list) list.push(i);
      else this.cells.set(key, [i]);
    }
  }

  private key(cx: number, cz: number): number {
    return cx * 73856093 + cz * 19349663;
  }

  /** Nearest non-skipped segment within `radius`, or null. */
  nearest(x: number, z: number): RoadHit | null {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    const pts = this.pts;
    const n = pts.length;
    let best = this.radius * this.radius;
    let hit: RoadHit | null = null;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const list = this.cells.get(this.key(cx + ox, cz + oz));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          const a = pts[i];
          const b = pts[(i + 1) % n];
          const ex = b.x - a.x;
          const ez = b.z - a.z;
          const len2 = ex * ex + ez * ez || 1;
          let u = ((x - a.x) * ex + (z - a.z) * ez) / len2;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const qx = a.x + ex * u - x;
          const qz = a.z + ez * u - z;
          const d2 = qx * qx + qz * qz;
          if (d2 < best) {
            best = d2;
            // Right of travel (right vector = (-tz, tx)): dot product of the offset with it.
            const side = ex * (z - a.z) - ez * (x - a.x) > 0 ? 1 : -1;
            hit = { i, u, dist: Math.sqrt(d2), d: side * Math.sqrt(d2) };
          }
        }
      }
    }
    return hit;
  }
}

// ---------------------------------------------------------------------------
// Natural terrain: seeded value noise
// ---------------------------------------------------------------------------

/** Cheap integer hash -> 0..1. */
function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth 2D value noise in -1..1 (random values on a lattice, smoothly interpolated). */
function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return (top + (bottom - top) * sz) * 2 - 1;
}

export class Terrain {
  /** False for old tracks without a terrain def: the ground follows the road exactly as before. */
  readonly enabled: boolean;
  readonly blend: number;
  /** Distance from the centerline (m) up to which the ground equals road level. */
  readonly flatReach: number;

  /**
   * @param def     the track's terrain def (may be undefined -> flat natural terrain)
   * @param enabled whether the terrain system is active at all
   * @param field   nearest-road lookup (null = no road influence)
   * @param reach   half road width + off-road strip (m)
   * @param levelAt road level at a segment hit: (segment, u, lateral d) => height
   */
  constructor(
    private readonly def: TerrainDef | undefined,
    enabled: boolean,
    private readonly field: RoadLookup | null,
    private readonly reach: number,
    private readonly levelAt: (hit: RoadHit) => number,
  ) {
    this.enabled = enabled;
    this.blend = def?.blend ?? TERRAIN_BLEND;
    this.flatReach = reach + TERRAIN_SKIRT;
  }

  /** Largest distance from the road at which the road still influences the ground (m). */
  get influence(): number {
    return this.reach + TERRAIN_SKIRT + this.blend;
  }

  /** Natural terrain only: hills plus mounds/pits (0 when the def has none). */
  natural(x: number, z: number): number {
    const def = this.def;
    if (!def) return 0;
    let h = 0;
    const hills = def.hills;
    if (hills && hills.amplitude !== 0) {
      const seed = def.seed ?? 1;
      const k = 1 / Math.max(1, hills.wavelength);
      // Two octaves: broad hills plus smaller undulation on top.
      h += hills.amplitude * (valueNoise(x * k, z * k, seed) * 0.8 + valueNoise(x * k * 2.3, z * k * 2.3, seed + 17) * 0.2);
    }
    if (def.features) {
      for (const f of def.features) {
        const dx = x - f.x;
        const dz = z - f.z;
        const t = 1 - (dx * dx + dz * dz) / (f.radius * f.radius);
        if (t > 0) h += f.height * t * t; // smooth bump: 0 slope at the rim and the top
      }
    }
    return h;
  }

  /** Weight of the road level at distance `dist` from the centerline: 1 near the road, 0 far away. */
  roadWeight(dist: number): number {
    const outside = dist - this.reach - TERRAIN_SKIRT;
    if (outside <= 0) return 1;
    if (outside >= this.blend) return 0;
    const t = outside / this.blend;
    return 1 - t * t * (3 - 2 * t);
  }

  /** Horizontal distance to the nearest (non-bridge) road centerline, or Infinity if farther than `influence`. */
  roadDistance(x: number, z: number): number {
    const hit = this.field?.nearest(x, z);
    return hit ? hit.dist : Infinity;
  }

  /** Dirt shortcut paths lightly shape the ground too (set once the paths are built, see shortcuts.ts). */
  setPaths(paths: PathLookup): void {
    this.paths = paths;
  }
  private paths: PathLookup | null = null;

  /** The nearest dirt path (distance to its centerline and its half width), or null (for the renderer). */
  nearestPath(x: number, z: number): { dist: number; halfWidth: number } | null {
    return this.paths?.nearest(x, z) ?? null;
  }

  /**
   * Ground height at (x, z): natural terrain blended into the road level near the road, then nudged
   * toward the level of a dirt path if one is close. The main road and its strip are never changed by a
   * path: the groove only starts beyond the strip (`reach`) and eases in over a few metres.
   */
  height(x: number, z: number): number {
    const nat = this.natural(x, z);
    let h = nat;
    let gate = 1; // how much a path may reshape the ground here (0 on and beside the main road)
    const hit = this.field?.nearest(x, z);
    if (hit) {
      const w = this.roadWeight(hit.dist);
      if (w > 0) h = nat + (this.levelAt(hit) - nat) * w;
      const t = Math.max(0, Math.min(1, (hit.dist - this.reach) / PATH_EASE_IN));
      gate = t * t * (3 - 2 * t);
    }
    if (this.paths && gate > 0) {
      const p = this.paths.nearest(x, z);
      if (p) h += (p.level - h) * gate * grooveWeight(p.dist, p.halfWidth);
    }
    return h;
  }
}
