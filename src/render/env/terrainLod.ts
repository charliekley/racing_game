/**
 * Terrain level of detail (LOD), the pure maths part (no Three.js here, so it is easy to test).
 *
 * What is level of detail? A far-away hill covers only a few pixels, so drawing it with thousands of small
 * triangles wastes the graphics card's time. LOD keeps several versions of the same piece of ground: a fine
 * one (every grid vertex) for when the camera is close, and coarser ones (every 2nd or 4th vertex) for when it
 * is far. Each frame, for each camera, we pick the version that suits the distance.
 *
 * How the terrain does it:
 *   - The terrain is a grid of vertices (xs[ix], zs[iz]). All LOD versions use a SUBSET of those same vertices,
 *     so they share one set of vertex buffers (positions, smooth normals, colours): a coarse version is only a
 *     different list of triangles. The shading therefore does not change when the version switches.
 *   - The ground is cut into a tree of rectangular pieces ("nodes"): small ones (level 0), 2x2 of those
 *     (level 1) and 2x2 of those again (level 2). A level-1 node is drawn with every 2nd grid vertex, level 2
 *     with every 4th (`LOD_STRIDES`). Bigger far-away pieces also mean fewer draw calls.
 *   - NO CRACKS: two meshes of different detail meet along a shared edge. If one side has more vertices on that
 *     edge than the other, the lower-resolution triangle edge cuts across the higher-resolution one and a thin
 *     gap opens. We avoid that completely: along every piece boundary, and next to every fine cell, the coarse
 *     triangles keep ALL the grid vertices of that edge (they are "stitched" with a fan of triangles). So the
 *     edge vertices of neighbouring pieces always match exactly, whatever level each one is drawn at.
 *   - ROADS: cells that touch the road corridor (`near`), cells next to a cliff/pit cut and cells where the
 *     coarse surface would differ from the true height by more than `LOD_TOLERANCE` stay at full resolution
 *     inside the coarse mesh. So the surface under the road is identical at every level.
 */

/** Grid step of each LOD level: level 0 uses every vertex, level 1 every 2nd, level 2 every 4th. */
export const LOD_STRIDES = [1, 2, 4] as const;
/**
 * A coarse cell is only kept coarse if its surface is within this many metres of the true grid heights. Indexed by
 * stride: coarser levels are used farther away, where a height error of half a metre is under one pixel.
 */
export const LOD_TOLERANCE: Record<number, number> = { 1: 0, 2: 0.25, 4: 0.5 };

export interface LodGrid {
  /** Vertex positions along x and z (they need not be evenly spaced). Vertex (ix, iz) has id iz * xs.length + ix. */
  xs: ArrayLike<number>;
  zs: ArrayLike<number>;
  /** Height of every vertex (xs.length * zs.length values). */
  heights: ArrayLike<number>;
  /** 1 for vertices on or near a road (their surroundings are never simplified). */
  near: ArrayLike<number>;
  /** True for a grid cell that has to stay exactly as drawn at full detail (a cut cell along a cliff or pit). */
  keepCell(ix: number, iz: number): boolean;
  /** The full-detail triangles (output vertex ids, counter-clockwise from above) of cell (ix, iz). */
  cellTriangles(ix: number, iz: number): ArrayLike<number>;
  /**
   * Output vertex id of grid vertex number `k` (= iz * xs.length + ix). The LOD code names grid vertices by `k`;
   * the mesh may number its vertices differently (TerrainView emits them in the order cells are visited). Default: k.
   */
  vertexId?(k: number): number;
}

/** A rectangle of grid CELLS: vertices ix0..ix1 by iz0..iz1 (so it has (ix1-ix0) x (iz1-iz0) cells). */
export interface LodRange {
  ix0: number;
  ix1: number;
  iz0: number;
  iz1: number;
}

/** The standard full-detail triangles of an unclipped cell; splits alternate to avoid a visible diagonal grain. */
export function plainCellTriangles(nx: number, ix: number, iz: number): number[] {
  const a = iz * nx + ix; // (x, z)
  const c = a + nx; // (x, z+)
  const d = c + 1; // (x+, z+)
  const b = a + 1; // (x+, z)
  return (ix + iz) % 2 === 0 ? [a, c, d, a, d, b] : [a, c, b, b, c, d];
}

/** Vertex indices of one axis at a stride: a, a+stride, ... and always the last one, b. */
export function strideSteps(a: number, b: number, stride: number): number[] {
  const out: number[] = [];
  for (let i = a; i < b; i += stride) out.push(i);
  out.push(b);
  return out;
}

export interface LodResult {
  /** Vertex-id triples of the whole range at this LOD. */
  triangles: number[];
  /** Number of coarse cells that were kept fine (near roads, cuts, or too inaccurate). */
  fineCells: number;
  coarseCells: number;
}

/**
 * Triangles for `range` at `stride` (1, 2 or 4). Coarse cells are `stride` x `stride` fine cells (the last one of a
 * row may be smaller). Fine cells inside reuse `grid.cellTriangles`, so they match the full-detail mesh exactly.
 */
export function buildLodTriangles(grid: LodGrid, range: LodRange, stride: number): LodResult {
  const nx = grid.xs.length;
  const px = strideSteps(range.ix0, range.ix1, stride);
  const pz = strideSteps(range.iz0, range.iz1, stride);
  const cw = px.length - 1;
  const ch = pz.length - 1;
  const fine = new Uint8Array(cw * ch);
  const sig = new Int32Array(cw * ch).fill(-1); // edge pattern the cell was last checked with (skip rechecks)

  // 1. Cells that must stay fine: they touch the road corridor or a cut cell.
  for (let cj = 0; cj < ch; cj++) {
    for (let ci = 0; ci < cw; ci++) {
      let keep = stride === 1;
      for (let iz = pz[cj]; iz <= pz[cj + 1] && !keep; iz++) {
        for (let ix = px[ci]; ix <= px[ci + 1]; ix++) {
          if (grid.near[iz * nx + ix] || (ix < px[ci + 1] && iz < pz[cj + 1] && grid.keepCell(ix, iz))) {
            keep = true;
            break;
          }
        }
      }
      if (keep) fine[cj * cw + ci] = 1;
    }
  }

  // 2. Iterate: coarse cells next to a fine cell (or the range boundary) need extra edge vertices; if that makes
  //    their triangulation too inaccurate, so the cell becomes fine too. Repeats until nothing changes.
  const poly: number[] = [];
  const tris: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let cj = 0; cj < ch; cj++) {
      for (let ci = 0; ci < cw; ci++) {
        if (fine[cj * cw + ci]) continue;
        const edges = edgeFlags(fine, cw, ci, cj, px, pz, range);
        if (edges === sig[cj * cw + ci]) continue;
        sig[cj * cw + ci] = edges;
        tris.length = 0;
        coarseCell(grid, px, pz, ci, cj, edges, poly, tris);
        if (cellError(grid, px, pz, ci, cj, tris) > (LOD_TOLERANCE[stride] ?? 0.25)) {
          fine[cj * cw + ci] = 1;
          changed = true;
        }
      }
    }
  }

  // 3. Emit.
  const out: number[] = [];
  let fineCells = 0;
  for (let cj = 0; cj < ch; cj++) {
    for (let ci = 0; ci < cw; ci++) {
      if (fine[cj * cw + ci]) {
        fineCells++;
        for (let iz = pz[cj]; iz < pz[cj + 1]; iz++) {
          for (let ix = px[ci]; ix < px[ci + 1]; ix++) {
            const t = grid.cellTriangles(ix, iz);
            for (let i = 0; i < t.length; i++) out.push(t[i]);
          }
        }
      } else {
        tris.length = 0;
        coarseCell(grid, px, pz, ci, cj, edgeFlags(fine, cw, ci, cj, px, pz, range), poly, tris);
        for (let i = 0; i < tris.length; i++) out.push(grid.vertexId ? grid.vertexId(tris[i]) : tris[i]);
      }
    }
  }
  return { triangles: out, fineCells, coarseCells: cw * ch - fineCells };
}

const W = 1; // edge at the low-x side
const N = 2; // high-z side
const E = 4; // high-x side
const S = 8; // low-z side

/** Which edges of coarse cell (ci, cj) need every grid vertex kept (the neighbour is fine or it is the range boundary)? */
function edgeFlags(fine: Uint8Array, cw: number, ci: number, cj: number, px: number[], pz: number[], r: LodRange): number {
  let f = 0;
  const multiX = px[ci + 1] - px[ci] > 1; // an edge of length 1 has no vertices in between: nothing to stitch
  const multiZ = pz[cj + 1] - pz[cj] > 1;
  if (multiZ && (px[ci] === r.ix0 || fine[cj * cw + ci - 1])) f |= W;
  if (multiX && (pz[cj + 1] === r.iz1 || fine[(cj + 1) * cw + ci])) f |= N;
  if (multiZ && (px[ci + 1] === r.ix1 || fine[cj * cw + ci + 1])) f |= E;
  if (multiX && (pz[cj] === r.iz0 || fine[(cj - 1) * cw + ci])) f |= S;
  // (the neighbour cells are only read when the boundary test before them was false, so they are in range.)
  return f;
}

/**
 * Triangulate one coarse cell, appending to `out`.
 *
 * No stitched edge: 2 triangles. Otherwise the outline (the 4 corners plus the grid vertices of every stitched edge)
 * is a convex polygon with some collinear points, and every one of those points must become a triangle corner or a
 * crack would open. We "clip ears": repeatedly cut off the corner with the smallest triangle (a sharp corner of the
 * polygon, not a collinear point) until 2 vertices are left. For a convex polygon every such cut is valid, and
 * choosing the smallest first makes a neat fan-like pattern.
 */
function coarseCell(grid: LodGrid, px: number[], pz: number[], ci: number, cj: number, edges: number, poly: number[], out: number[]): void {
  const nx = grid.xs.length;
  const xa = px[ci], xb = px[ci + 1], za = pz[cj], zb = pz[cj + 1];
  const a = za * nx + xa, cc = zb * nx + xa, d = zb * nx + xb, b = za * nx + xb;
  if (edges === 0) {
    if ((ci + cj) % 2 === 0) out.push(a, cc, d, a, d, b);
    else out.push(a, cc, b, b, cc, d);
    return;
  }
  poly.length = 0;
  poly.push(a);
  if (edges & W) for (let z = za + 1; z < zb; z++) poly.push(z * nx + xa);
  poly.push(cc);
  if (edges & N) for (let x = xa + 1; x < xb; x++) poly.push(zb * nx + x);
  poly.push(d);
  if (edges & E) for (let z = zb - 1; z > za; z--) poly.push(z * nx + xb);
  poly.push(b);
  if (edges & S) for (let x = xb - 1; x > xa; x--) poly.push(za * nx + x);
  // Twice the signed area of the triangle (p, q, r) in the x/z plane; negative = counter-clockwise from above (the way we draw).
  const cross = (p: number, q: number, r: number): number => {
    const px0 = grid.xs[p % nx], pz0 = grid.zs[(p / nx) | 0];
    return (grid.xs[q % nx] - px0) * (grid.zs[(r / nx) | 0] - pz0) - (grid.zs[(q / nx) | 0] - pz0) * (grid.xs[r % nx] - px0);
  };
  while (poly.length > 3) {
    const n = poly.length;
    let best = -1;
    let bestArea = Infinity;
    for (let k = 0; k < n; k++) {
      const c = cross(poly[(k + n - 1) % n], poly[k], poly[(k + 1) % n]);
      if (c < -1e-9 && -c < bestArea) { bestArea = -c; best = k; }
    }
    if (best < 0) break; // cannot happen for a convex polygon
    out.push(poly[(best + n - 1) % n], poly[best], poly[(best + 1) % n]);
    poly.splice(best, 1);
  }
  if (poly.length === 3) out.push(poly[0], poly[1], poly[2]);
}

/** Largest height difference (m) between the coarse triangles `tris` and the true grid heights inside the cell. */
function cellError(grid: LodGrid, px: number[], pz: number[], ci: number, cj: number, tris: number[]): number {
  const nx = grid.xs.length;
  let worst = 0;
  for (let iz = pz[cj]; iz <= pz[cj + 1]; iz++) {
    for (let ix = px[ci]; ix <= px[ci + 1]; ix++) {
      const x = grid.xs[ix], z = grid.zs[iz];
      const h = interpolate(grid, tris, x, z);
      if (h === null) continue;
      worst = Math.max(worst, Math.abs(h - grid.heights[iz * nx + ix]));
    }
  }
  return worst;
}

/** Height of the triangle list at (x, z) (null when no triangle covers the point). */
function interpolate(grid: LodGrid, tris: ArrayLike<number>, x: number, z: number): number | null {
  const nx = grid.xs.length;
  const eps = -1e-6;
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const i = tris[t], j = tris[t + 1], k = tris[t + 2];
    const x0 = grid.xs[i % nx], z0 = grid.zs[(i / nx) | 0];
    const x1 = grid.xs[j % nx], z1 = grid.zs[(j / nx) | 0];
    const x2 = grid.xs[k % nx], z2 = grid.zs[(k / nx) | 0];
    const det = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
    if (Math.abs(det) < 1e-12) continue;
    const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / det;
    const l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / det;
    const l2 = 1 - l0 - l1;
    if (l0 < eps || l1 < eps || l2 < eps) continue;
    return l0 * grid.heights[i] + l1 * grid.heights[j] + l2 * grid.heights[k];
  }
  return null;
}

/** Height of a triangle list at a point; exported for tests (accuracy of a LOD against the true grid). */
export function lodHeightAt(grid: LodGrid, triangles: ArrayLike<number>, x: number, z: number): number | null {
  return interpolate(grid, triangles, x, z);
}

// ---------------------------------------------------------------------------
// Pieces (nodes) of the ground and picking a level by distance
// ---------------------------------------------------------------------------

/** One group of grid cells along an axis, with the smaller groups it is made of (empty for level 0). */
export interface AxisGroup {
  /** Vertex indices: the group spans cells a..b-1, i.e. vertices a..b. */
  a: number;
  b: number;
  kids: AxisGroup[];
}

/**
 * Group grid cells along one axis into pieces of about `size` metres (by cell centre), then merge `factors.length`
 * times: every `factors[k]` pieces of the previous level become one. Returns the top-level groups; each carries its
 * `kids` down to level 0. Pieces tile the axis with no gaps, and every boundary is a grid line.
 */
export function axisGroups(coords: ArrayLike<number>, size: number, levels: number): AxisGroup[] {
  const cells = coords.length - 1;
  const key0: number[] = [];
  for (let i = 0; i < cells; i++) key0.push(Math.floor((coords[i] + coords[i + 1]) / 2 / size));
  // Level 0: runs of equal key.
  let groups: AxisGroup[] = [];
  let keys: number[] = [];
  for (let i = 0; i < cells; i++) {
    if (groups.length && keys[keys.length - 1] === key0[i]) groups[groups.length - 1].b = i + 1;
    else {
      groups.push({ a: i, b: i + 1, kids: [] });
      keys.push(key0[i]);
    }
  }
  // Each further level merges pairs of neighbouring keys (floor(key / 2)), so pieces nest exactly.
  for (let l = 1; l < levels; l++) {
    const next: AxisGroup[] = [];
    const nextKeys: number[] = [];
    for (let g = 0; g < groups.length; g++) {
      const k = Math.floor(keys[g] / 2);
      if (next.length && nextKeys[nextKeys.length - 1] === k) {
        const top = next[next.length - 1];
        top.b = groups[g].b;
        top.kids.push(groups[g]);
      } else {
        next.push({ a: groups[g].a, b: groups[g].b, kids: [groups[g]] });
        nextKeys.push(k);
      }
    }
    groups = next;
    keys = nextKeys;
  }
  return groups;
}

/** What the LOD walk needs to know about a piece of ground (TerrainView's nodes have exactly these fields). */
export interface LodNodeLike {
  level: number; // 0 = full detail
  rect: readonly [number, number, number, number]; // minX, maxX, minZ, maxZ
  mesh: unknown; // the piece's own mesh at its level (null = it has none and its kids are drawn instead)
  kids: LodNodeLike[];
}

/**
 * Which LOD level to draw a piece at, for a camera `distance` metres from its nearest point: the number of
 * `thresholds` the distance has passed (0 = full detail, 1 = every 2nd vertex, 2 = every 4th).
 */
export function lodLevelForDistance(distance: number, thresholds: readonly number[]): number {
  let level = 0;
  for (const t of thresholds) if (distance >= t) level++;
  return level;
}

/**
 * Walk the tree of ground pieces for one camera and call `draw` for each piece that should be drawn.
 * A piece that has a mesh is drawn at its own level when its NEAREST point is at least `distances[level - 1] * scale`
 * metres from the camera (so no part of it is closer than that); otherwise we look at the smaller pieces it is made
 * of. Full-detail pieces (level 0) are always drawn. `scale` shrinks the distances (smaller screens need less detail).
 */
export function selectLod<T extends LodNodeLike>(node: T, camX: number, camZ: number, distances: readonly number[], scale: number, draw: (n: T) => void): void {
  if (node.mesh && node.level > 0 && rectDistance(camX, camZ, node.rect[0], node.rect[1], node.rect[2], node.rect[3]) >= distances[node.level - 1] * scale) {
    draw(node);
    return;
  }
  if (node.kids.length === 0) {
    if (node.mesh) draw(node);
    return;
  }
  for (const k of node.kids) selectLod(k as T, camX, camZ, distances, scale, draw);
}

/** Horizontal distance from (px, pz) to the rectangle [minX,maxX] x [minZ,maxZ] (0 inside). */
export function rectDistance(px: number, pz: number, minX: number, maxX: number, minZ: number, maxZ: number): number {
  const dx = Math.max(minX - px, 0, px - maxX);
  const dz = Math.max(minZ - pz, 0, pz - maxZ);
  return Math.hypot(dx, dz);
}
