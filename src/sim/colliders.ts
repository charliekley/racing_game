/**
 * Solid scenery for the simulation: trees, rocks, houses, grandstands, fences…
 *
 * Built from the scenery plan's collider list (`planScenery(track).colliders`),
 * so the shapes the renderer draws are exactly the shapes karts bounce off.
 * Pure TypeScript: no Three.js, no DOM.
 *
 * Lookup: a uniform grid (square cells of CELL metres). Each collider is
 * registered in every cell its bounding box touches, so a query only looks at
 * the 1-4 cells around a kart instead of at every tree on the map.
 *
 * Response (same feel as `collideWalls`): push the kart out of the shape,
 * reflect the velocity along the contact normal with `KART.wallBounce`, lose
 * speed in proportion to how head-on the hit was (`KART.wallSpeedLoss`) and
 * nudge the heading along the surface so glancing hits slide instead of stick.
 */
import type { Collider } from '../track/sceneryPlan';
import { KART, type KartConfig } from './config';
import { forwardOf, type KartState } from './kart';

/** Grid cell size (m). */
const CELL = 16;
/** Circles thinner than this are "small": a Nova kart bulldozes them. */
const SMALL_RADIUS = 1;

export class Colliders {
  private readonly cells = new Map<number, number[]>();
  /** Only the solid ones. */
  readonly list: Collider[];
  /** Per-collider "already visited this query" stamp (a collider can sit in several cells). */
  private readonly stamp: number[];
  private query = 0;

  constructor(colliders: readonly Collider[]) {
    this.list = colliders.filter((c) => c.solid);
    this.stamp = this.list.map(() => 0);
    this.list.forEach((c, i) => {
      const [x0, z0, x1, z1] = bounds(c);
      for (let ix = cellOf(x0); ix <= cellOf(x1); ix++)
        for (let iz = cellOf(z0); iz <= cellOf(z1); iz++) {
          const key = cellKey(ix, iz);
          const bucket = this.cells.get(key);
          if (bucket) bucket.push(i);
          else this.cells.set(key, [i]);
        }
    });
  }

  /** Colliders whose cells touch the square [x±r, z±r]; calls `fn(index)` once per collider. */
  private forEachNear(x: number, z: number, r: number, fn: (c: Collider) => void): void {
    this.query++;
    for (let ix = cellOf(x - r); ix <= cellOf(x + r); ix++)
      for (let iz = cellOf(z - r); iz <= cellOf(z + r); iz++) {
        const bucket = this.cells.get(cellKey(ix, iz));
        if (!bucket) continue;
        for (const i of bucket) {
          if (this.stamp[i] === this.query) continue;
          this.stamp[i] = this.query;
          fn(this.list[i]);
        }
      }
  }

  /**
   * Is a disc of radius `r` at (x, z) inside a solid collider? Used to stop
   * item shots (Ricochet / Seeker) on scenery.
   */
  blocksPoint(x: number, z: number, r = 0): boolean {
    let hit = false;
    this.forEachNear(x, z, r, (c) => {
      if (!hit && depth(c, x, z, r) !== null) hit = true;
    });
    return hit;
  }

  /**
   * Push the kart out of any solid it overlaps and bounce it off. Returns the
   * impact speed (m/s along the contact normal; 0 if nothing was hit).
   *
   * Karts flying above a collider's nominal height pass over it; Nova karts
   * (starTime > 0) bulldoze small round things (thin trunks, small rocks).
   */
  collideKart(k: KartState, c: KartConfig = KART): number {
    let impact = 0;
    const nova = k.starTime > 0;
    this.forEachNear(k.pos.x, k.pos.z, c.radius + 0.5, (col) => {
      if (k.pos.y > col.y + col.height) return; // flying over
      if (nova && col.shape === 'circle' && col.r < SMALL_RADIUS) return; // bulldozed
      const hit = depth(col, k.pos.x, k.pos.z, c.radius);
      if (!hit) return;
      impact = Math.max(impact, bounce(k, hit.nx, hit.nz, hit.pen, c));
    });
    return impact;
  }
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const cellOf = (v: number): number => Math.floor(v / CELL);
const cellKey = (ix: number, iz: number): number => (ix + 4096) * 8192 + (iz + 4096);

/** Axis-aligned bounding box [x0, z0, x1, z1] of a collider. */
function bounds(c: Collider): [number, number, number, number] {
  if (c.shape === 'circle') return [c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r];
  const ex = Math.abs(Math.cos(c.rotY)) * c.hw + Math.abs(Math.sin(c.rotY)) * c.hd;
  const ez = Math.abs(Math.sin(c.rotY)) * c.hw + Math.abs(Math.cos(c.rotY)) * c.hd;
  return [c.x - ex, c.z - ez, c.x + ex, c.z + ez];
}

/**
 * Does a disc of radius `r` at (px, pz) overlap the collider? If so: the unit
 * normal pointing from the collider toward the disc, and the overlap depth.
 */
function depth(c: Collider, px: number, pz: number, r: number): { nx: number; nz: number; pen: number } | null {
  if (c.shape === 'circle') {
    const dx = px - c.x;
    const dz = pz - c.z;
    const min = c.r + r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return null;
    const d = Math.sqrt(d2);
    if (d < 1e-6) return { nx: 1, nz: 0, pen: min };
    return { nx: dx / d, nz: dz / d, pen: min - d };
  }
  // Box: move into its local frame (local +x = (cos, -sin), local +z = (sin, cos)).
  const cos = Math.cos(c.rotY);
  const sin = Math.sin(c.rotY);
  const dx = px - c.x;
  const dz = pz - c.z;
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  const cx = Math.max(-c.hw, Math.min(c.hw, lx));
  const cz = Math.max(-c.hd, Math.min(c.hd, lz));
  let nlx = lx - cx;
  let nlz = lz - cz;
  const d2 = nlx * nlx + nlz * nlz;
  let pen: number;
  if (d2 > 1e-12) {
    // Disc center outside the box: nearest point on the box edge/corner.
    if (d2 >= r * r) return null;
    const d = Math.sqrt(d2);
    pen = r - d;
    nlx /= d;
    nlz /= d;
  } else {
    // Disc center inside the box: leave through the nearest side.
    const left = c.hw - Math.abs(lx);
    const front = c.hd - Math.abs(lz);
    if (left < front) {
      nlx = Math.sign(lx) || 1;
      nlz = 0;
      pen = left + r;
    } else {
      nlx = 0;
      nlz = Math.sign(lz) || 1;
      pen = front + r;
    }
  }
  // Local normal → world.
  return { nx: nlx * cos + nlz * sin, nz: -nlx * sin + nlz * cos, pen };
}

/** Re-derive forward speed after velocity was changed by a collision. */
function syncSpeed(k: KartState): void {
  const f = forwardOf(k.heading);
  k.speed = k.vel.x * f.x + k.vel.z * f.z;
}

/**
 * Resolve one contact: (nx, nz) points from the obstacle to the kart.
 * Mirrors `collideWalls`. Returns the impact speed.
 */
function bounce(k: KartState, nx: number, nz: number, pen: number, c: KartConfig): number {
  k.pos.x += nx * pen;
  k.pos.z += nz * pen;
  const vIn = -(k.vel.x * nx + k.vel.z * nz); // speed INTO the obstacle
  if (vIn <= 0) return 0; // already moving away
  // Remove the inward velocity and bounce a bit back.
  k.vel.x += nx * vIn * (1 + c.wallBounce);
  k.vel.z += nz * vIn * (1 + c.wallBounce);
  const total = Math.hypot(k.vel.x, k.vel.z) + vIn;
  const headOn = Math.min(1, vIn / Math.max(1, total));
  const keep = 1 - c.wallSpeedLoss * headOn;
  k.vel.x *= keep;
  k.vel.z *= keep;
  // Steer the nose along the surface (tangent = normal rotated 90°) so glancing hits slide.
  const tangentHeading = Math.atan2(-nz, nx);
  const flip = Math.cos(k.heading - tangentHeading) < 0 ? Math.PI : 0;
  const target = tangentHeading + flip;
  const dh = Math.atan2(Math.sin(target - k.heading), Math.cos(target - k.heading));
  // Only for real impacts: when crawling along a surface (vIn small) the driver's own steering must win,
  // otherwise a slow kart pinned at an angle can never turn away.
  const slide = Math.min(1, vIn / 5);
  k.heading += dh * 0.25 * headOn * slide;
  syncSpeed(k);
  return vIn;
}
