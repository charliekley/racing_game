import { describe, expect, it } from 'vitest';
import {
  axisGroups,
  buildLodTriangles,
  LOD_STRIDES,
  lodHeightAt,
  lodLevelForDistance,
  plainCellTriangles,
  rectDistance,
  selectLod,
  strideSteps,
  type LodGrid,
  type LodNodeLike,
  type LodRange,
} from './terrainLod';

/** A test grid: `n` x `n` vertices 3 m apart, gentle hills, optional road strip along z (near=1) and cut cells. */
function makeGrid(n: number, opts: { road?: [number, number]; cut?: (ix: number, iz: number) => boolean; bumpy?: number } = {}): LodGrid {
  const xs = Array.from({ length: n }, (_, i) => i * 3);
  const zs = Array.from({ length: n }, (_, i) => i * 3);
  const heights = new Float32Array(n * n);
  const near = new Uint8Array(n * n);
  const bump = opts.bumpy ?? 0;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      heights[iz * n + ix] = 4 * Math.sin(ix * 0.08) + 3 * Math.cos(iz * 0.06) + bump * Math.sin(ix * 2.1 + iz * 1.3);
      if (opts.road && ix >= opts.road[0] && ix <= opts.road[1]) near[iz * n + ix] = 1;
    }
  }
  return {
    xs,
    zs,
    heights,
    near,
    keepCell: (ix, iz) => !!opts.cut?.(ix, iz),
    cellTriangles: (ix, iz) => plainCellTriangles(n, ix, iz),
  };
}

const range = (ix0: number, ix1: number, iz0: number, iz1: number): LodRange => ({ ix0, ix1, iz0, iz1 });

/** Undirected edge key. */
const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

function edgeCounts(tris: number[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let t = 0; t < tris.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(tris[t + k], tris[t + (k + 1) % 3]);
      m.set(key, (m.get(key) ?? 0) + 1);
    }
  }
  return m;
}

describe('LOD level selection by distance', () => {
  it('uses level 0 near the camera and coarser levels past each threshold', () => {
    const d = [230, 460];
    expect(lodLevelForDistance(0, d)).toBe(0);
    expect(lodLevelForDistance(229, d)).toBe(0);
    expect(lodLevelForDistance(230, d)).toBe(1);
    expect(lodLevelForDistance(459, d)).toBe(1);
    expect(lodLevelForDistance(900, d)).toBe(2);
  });

  it('measures distance to the nearest point of a rectangle', () => {
    expect(rectDistance(5, 5, 0, 10, 0, 10)).toBe(0);
    expect(rectDistance(13, 5, 0, 10, 0, 10)).toBe(3);
    expect(rectDistance(13, 14, 0, 10, 0, 10)).toBe(5);
  });

  it('draws a far piece at its own level, and its smaller pieces when the camera is close', () => {
    const leaf = (x: number): LodNodeLike => ({ level: 0, rect: [x, x + 100, 0, 100], mesh: {}, kids: [] });
    const mid = (x: number): LodNodeLike => ({ level: 1, rect: [x, x + 200, 0, 100], mesh: {}, kids: [leaf(x), leaf(x + 100)] });
    const top: LodNodeLike = { level: 2, rect: [0, 400, 0, 100], mesh: {}, kids: [mid(0), mid(200)] };
    const pick = (camX: number, scale: number) => {
      const out: LodNodeLike[] = [];
      selectLod(top, camX, 50, [230, 460], scale, (n) => out.push(n));
      return out;
    };
    // Camera at x = -600: nearest point of the whole top piece is 600 m away: drawn as ONE level-2 piece.
    expect(pick(-600, 1).map((n) => n.level)).toEqual([2]);
    // At x = -300 the top piece is only 300 m away (< 460): its two mids are drawn (the far one at 500 m is level 1, so is the near one at 300 m).
    expect(pick(-300, 1).map((n) => n.level)).toEqual([1, 1]);
    // Close up: the near mid breaks into full-detail leaves, the far one (200+ m away) stays one level-1 piece.
    expect(pick(-50, 1).map((n) => n.level)).toEqual([0, 0, 1]);
    // A smaller scale (split-screen, Medium) switches to coarse levels sooner.
    expect(pick(-200, 0.4).map((n) => n.level)).toEqual([2]);
  });
});

describe('strideSteps / axisGroups', () => {
  it('steps by the stride and always ends on the last vertex', () => {
    expect(strideSteps(0, 8, 4)).toEqual([0, 4, 8]);
    expect(strideSteps(2, 9, 4)).toEqual([2, 6, 9]);
    expect(strideSteps(0, 1, 4)).toEqual([0, 1]);
  });

  it('groups cells into nested pieces that cover the axis exactly, every boundary on a grid line', () => {
    const coords = Array.from({ length: 101 }, (_, i) => i * 7 - 100); // 100 cells, 7 m each, offset
    const top = axisGroups(coords, 100, 3);
    expect(top[0].a).toBe(0);
    expect(top[top.length - 1].b).toBe(100);
    for (let i = 1; i < top.length; i++) expect(top[i].a).toBe(top[i - 1].b);
    for (const g of top) {
      expect(g.kids.length).toBeGreaterThan(0);
      expect(g.kids[0].a).toBe(g.a);
      expect(g.kids[g.kids.length - 1].b).toBe(g.b);
      for (const k of g.kids) expect(k.kids.length).toBeGreaterThan(0); // level 1 pieces hold level 0 pieces
    }
  });
});

describe('buildLodTriangles', () => {
  const n = 41;
  const full = range(0, n - 1, 0, n - 1);

  it('stride 1 is exactly the full-detail mesh', () => {
    const grid = makeGrid(n);
    const lod = buildLodTriangles(grid, full, 1);
    const expected: number[] = [];
    for (let iz = 0; iz < n - 1; iz++) for (let ix = 0; ix < n - 1; ix++) expected.push(...plainCellTriangles(n, ix, iz));
    expect(lod.triangles).toEqual(expected);
  });

  it('maps grid vertex numbers to output vertex ids (the mesh may number its vertices differently)', () => {
    const grid = { ...makeGrid(n), vertexId: (k: number) => k + 100000 };
    // Fine cells (stride 1) come from cellTriangles, which already returns ids; coarse cells must be mapped.
    const coarse = buildLodTriangles({ ...grid, cellTriangles: (ix, iz) => plainCellTriangles(n, ix, iz).map((k) => k + 100000) }, full, 4).triangles;
    expect(coarse.length).toBeGreaterThan(0);
    for (const v of coarse) expect(v).toBeGreaterThanOrEqual(100000);
  });

  it('has roughly 1/4 and 1/16 of the triangles at strides 2 and 4 on smooth ground', () => {
    const grid = makeGrid(n);
    const t = LOD_STRIDES.map((s) => buildLodTriangles(grid, full, s).triangles.length / 3);
    expect(t[0]).toBe(2 * 40 * 40);
    expect(t[1]).toBeLessThan(t[0] * 0.3);
    expect(t[1]).toBeGreaterThan(t[0] * 0.2);
    expect(t[2]).toBeLessThan(t[0] * 0.2); // (the tile border keeps every vertex, so a bit more than 1/16)
    expect(t[2]).toBeLessThan(t[1] * 0.7);
  });

  it('keeps bumpy ground at full detail (it would be too inaccurate coarse)', () => {
    const smooth = buildLodTriangles(makeGrid(n), full, 4).triangles.length;
    const bumpy = buildLodTriangles(makeGrid(n, { bumpy: 3 }), full, 4).triangles.length;
    expect(bumpy).toBeGreaterThan(smooth * 4);
  });

  it('keeps every cell on or next to the road, and cut cells, exactly as at full detail (heights match the grid)', () => {
    const grid = makeGrid(n, { road: [18, 21], cut: (ix, iz) => ix < 4 && iz < 4 });
    for (const stride of [2, 4]) {
      const tris = buildLodTriangles(grid, full, stride).triangles;
      const have = new Set<string>();
      for (let t = 0; t < tris.length; t += 3) have.add(tris.slice(t, t + 3).join(','));
      const wanted: [number, number][] = [];
      for (let iz = 0; iz < n - 1; iz++) {
        for (let ix = 0; ix < n - 1; ix++) {
          const corners = [[ix, iz], [ix + 1, iz], [ix, iz + 1], [ix + 1, iz + 1]];
          if (corners.some(([x, z]) => grid.near[z * n + x]) || grid.keepCell(ix, iz)) wanted.push([ix, iz]);
        }
      }
      expect(wanted.length).toBeGreaterThan(40);
      for (const [ix, iz] of wanted) {
        const cell = plainCellTriangles(n, ix, iz);
        for (let t = 0; t < 6; t += 3) expect(have.has(cell.slice(t, t + 3).join(',')), `stride ${stride} cell ${ix},${iz}`).toBe(true);
      }
      // Height of the LOD surface at every near vertex is the grid height (well within 5 cm).
      for (let iz = 0; iz < n; iz++) {
        for (let ix = 0; ix < n; ix++) {
          if (!grid.near[iz * n + ix]) continue;
          const h = lodHeightAt(grid, tris, grid.xs[ix], grid.zs[iz]);
          expect(h).not.toBeNull();
          expect(Math.abs(h! - grid.heights[iz * n + ix])).toBeLessThan(0.05);
        }
      }
    }
  });

  it('never differs from the true grid height by more than the tolerance for that level', () => {
    const grid = makeGrid(n, { bumpy: 0.3 });
    for (const [stride, tol] of [[2, 0.25], [4, 0.5]]) {
      const tris = buildLodTriangles(grid, full, stride).triangles;
      for (let iz = 0; iz < n; iz++) {
        for (let ix = 0; ix < n; ix++) {
          const h = lodHeightAt(grid, tris, grid.xs[ix], grid.zs[iz]);
          expect(h).not.toBeNull();
          expect(Math.abs(h! - grid.heights[iz * n + ix])).toBeLessThanOrEqual(tol + 1e-4);
        }
      }
    }
  });

  it('is crack-free: tiles at different levels match along every shared edge (watertight, no T-junctions)', () => {
    const grid = makeGrid(n, { bumpy: 0.2, road: [30, 31] });
    // Four tiles meeting at vertex (20, 20), drawn at every combination of levels.
    const tiles = [range(0, 20, 0, 20), range(20, 40, 0, 20), range(0, 20, 20, 40), range(20, 40, 20, 40)];
    for (const levels of [[0, 1, 2, 0], [2, 2, 2, 2], [1, 0, 2, 1], [2, 0, 0, 2], [0, 2, 1, 2]]) {
      const all: number[] = [];
      tiles.forEach((r, i) => all.push(...buildLodTriangles(grid, r, LOD_STRIDES[levels[i]]).triangles));
      const counts = edgeCounts(all);
      for (const [key, c] of counts) {
        const [a, b] = key.split('-').map(Number);
        const onOuter = (v: number) => {
          const ix = v % n, iz = (v / n) | 0;
          return ix === 0 || iz === 0 || ix === n - 1 || iz === n - 1;
        };
        const sameOuterSide = (a % n === 0 && b % n === 0) || (a % n === n - 1 && b % n === n - 1) || (a < n && b < n) || (a >= n * (n - 1) && b >= n * (n - 1));
        if (c === 1) expect(onOuter(a) && onOuter(b) && sameOuterSide, `edge ${key} is open (levels ${levels})`).toBe(true);
        expect(c).toBeLessThanOrEqual(2);
      }
      // And the boundary vertices of a shared edge are the SAME on both sides: x = 20 line uses every grid vertex.
      const onLine = new Set<number>();
      for (let t = 0; t < all.length; t++) {
        const v = all[t];
        if (v % n === 20) onLine.add((v / n) | 0);
      }
      for (let iz = 0; iz <= 40; iz++) expect(onLine.has(iz), `vertex (20, ${iz}) missing at levels ${levels}`).toBe(true);
    }
  });
});
