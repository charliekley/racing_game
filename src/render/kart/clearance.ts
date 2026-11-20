/**
 * Clearance check between two triangle meshes (a driver part and a kart part), used by the clearance test
 * (clearance.test.ts) and the dev preview. PURE math on typed arrays: no DOM, no rendering.
 *
 * The idea, in plain words. We want to know "does the head poke into the roll cage?". Two closed surfaces
 * overlap when a point of one lies INSIDE the other. So:
 *  1. Sample both surfaces with a dense lattice of points (every ~2-3 cm), each with the outward normal of
 *     its triangle.
 *  2. For a point P of surface A, find the nearest sample S of surface B. If (P - S) points against S's
 *     outward normal, P is on the inside of B, and the depth is the length of that component. (Using the
 *     NEAREST sample matters: the closest surface point tells us which side of B we are on.)
 *  3. The overlap is the deepest such depth, looked at in both directions (A in B and B in A).
 *
 * Points are looked up with a spatial hash (a dictionary of small cubes), which keeps it fast enough to run
 * hundreds of poses in a unit test.
 */
import * as THREE from 'three';

/** A cloud of surface points with outward unit normals (xyz triples). */
export interface SampleSet {
  pts: Float32Array;
  nrm: Float32Array;
  count: number;
  /** Optional label per point (which kart part it belongs to), an index into `names`. */
  label?: Uint8Array;
  names?: string[];
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Sample every triangle of an indexed mesh on a barycentric lattice with about `spacing` metres between points. */
export function sampleTriangles(pos: ArrayLike<number>, index: ArrayLike<number>, spacing: number): SampleSet {
  const pts: number[] = [];
  const nrm: number[] = [];
  for (let t = 0; t + 2 < index.length; t += 3) {
    _a.fromArray(pos as ArrayLike<number> as number[], index[t] * 3);
    _b.fromArray(pos as ArrayLike<number> as number[], index[t + 1] * 3);
    _c.fromArray(pos as ArrayLike<number> as number[], index[t + 2] * 3);
    // Geometric normal from the winding (counter-clockwise = outward in Three.js).
    _n.copy(_b).sub(_a).cross(_c.clone().sub(_a));
    const area2 = _n.length();
    if (area2 < 1e-12) continue; // degenerate sliver
    _n.divideScalar(area2);
    const longest = Math.max(_a.distanceTo(_b), _b.distanceTo(_c), _c.distanceTo(_a));
    const k = Math.min(30, Math.max(1, Math.ceil(longest / spacing)));
    for (let i = 0; i <= k; i++) {
      for (let j = 0; j <= k - i; j++) {
        const u = i / k;
        const v = j / k;
        const w = 1 - u - v;
        pts.push(_a.x * w + _b.x * u + _c.x * v, _a.y * w + _b.y * u + _c.y * v, _a.z * w + _b.z * u + _c.z * v);
        nrm.push(_n.x, _n.y, _n.z);
      }
    }
  }
  return { pts: new Float32Array(pts), nrm: new Float32Array(nrm), count: pts.length / 3 };
}

/** A copy of `s` moved by the matrix `m` (normals use the inverse-transpose, so mirrored and squashed parts stay right). */
export function transformSamples(s: SampleSet, m: THREE.Matrix4, out?: SampleSet): SampleSet {
  const o = out && out.count === s.count ? out : { pts: new Float32Array(s.pts.length), nrm: new Float32Array(s.nrm.length), count: s.count };
  const e = m.elements;
  const nm = new THREE.Matrix3().getNormalMatrix(m).elements;
  for (let i = 0; i < s.count; i++) {
    const x = s.pts[i * 3];
    const y = s.pts[i * 3 + 1];
    const z = s.pts[i * 3 + 2];
    o.pts[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
    o.pts[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    o.pts[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    const nx = s.nrm[i * 3];
    const ny = s.nrm[i * 3 + 1];
    const nz = s.nrm[i * 3 + 2];
    const X = nm[0] * nx + nm[3] * ny + nm[6] * nz;
    const Y = nm[1] * nx + nm[4] * ny + nm[7] * nz;
    const Z = nm[2] * nx + nm[5] * ny + nm[8] * nz;
    const l = Math.hypot(X, Y, Z) || 1;
    o.nrm[i * 3] = X / l;
    o.nrm[i * 3 + 1] = Y / l;
    o.nrm[i * 3 + 2] = Z / l;
  }
  return o;
}

/** Where the deepest overlap is, and how deep (m). depth 0 = no overlap. */
export interface Overlap {
  depth: number;
  at: [number, number, number];
  /** Name of the kart part that was hit, when the samples were labelled. */
  hit?: string;
}

const CELL = 0.1;
const cellKey = (x: number, y: number, z: number) =>
  (Math.floor(x / CELL) + 2048) * 16777216 + (Math.floor(y / CELL) + 2048) * 4096 + (Math.floor(z / CELL) + 2048);

/** A spatial hash of sample points: cubes of 10 cm, so a query only looks at the 27 cubes around a point. */
export class SampleGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly pts: number[] = [];
  private readonly nrm: number[] = [];
  private readonly lab: string[] = [];
  /** Cubes that are occupied or touch an occupied one: a fast "is anything near here at all?" test. */
  private readonly near = new Set<number>();

  add(s: SampleSet): this {
    for (let i = 0; i < s.count; i++) {
      const id = this.pts.length / 3;
      const x = s.pts[i * 3];
      const y = s.pts[i * 3 + 1];
      const z = s.pts[i * 3 + 2];
      this.pts.push(x, y, z);
      this.nrm.push(s.nrm[i * 3], s.nrm[i * 3 + 1], s.nrm[i * 3 + 2]);
      this.lab.push(s.names && s.label ? s.names[s.label[i]] : '');
      const key = cellKey(x, y, z);
      let list = this.cells.get(key);
      if (!list) {
        list = [];
        this.cells.set(key, list);
        const ix = Math.floor(x / CELL);
        const iy = Math.floor(y / CELL);
        const iz = Math.floor(z / CELL);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          this.near.add(cellKey((ix + dx) * CELL, (iy + dy) * CELL, (iz + dz) * CELL));
        }
      }
      list.push(id);
    }
    return this;
  }

  /** True when some sample may be within 10 cm of (x, y, z). */
  mayTouch(x: number, y: number, z: number): boolean {
    return this.near.has(cellKey(x, y, z));
  }

  /**
   * Deepest point of `s` that lies inside the solid this grid describes. Points deeper than `maxDepth`
   * below the nearest surface are ignored (they belong to some other, far-away structure).
   */
  deepestInside(s: SampleSet, maxDepth = 0.12): Overlap {
    const probeName = (i: number) => (s.names && s.label ? s.names[s.label[i]] : '');
    let best = 0;
    let at: [number, number, number] = [0, 0, 0];
    let hit = '';
    const R2 = CELL * CELL;
    for (let i = 0; i < s.count; i++) {
      const x = s.pts[i * 3];
      const y = s.pts[i * 3 + 1];
      const z = s.pts[i * 3 + 2];
      if (!this.near.has(cellKey(x, y, z))) continue;
      const ix = Math.floor(x / CELL);
      const iy = Math.floor(y / CELL);
      const iz = Math.floor(z / CELL);
      let bestD2 = R2;
      let bestId = -1;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const list = this.cells.get(cellKey((ix + dx) * CELL, (iy + dy) * CELL, (iz + dz) * CELL));
        if (!list) continue;
        for (const id of list) {
          const ex = x - this.pts[id * 3];
          const ey = y - this.pts[id * 3 + 1];
          const ez = z - this.pts[id * 3 + 2];
          const d2 = ex * ex + ey * ey + ez * ez;
          if (d2 < bestD2) {
            bestD2 = d2;
            bestId = id;
          }
        }
      }
      if (bestId < 0) continue;
      const signed =
        (x - this.pts[bestId * 3]) * this.nrm[bestId * 3] +
        (y - this.pts[bestId * 3 + 1]) * this.nrm[bestId * 3 + 1] +
        (z - this.pts[bestId * 3 + 2]) * this.nrm[bestId * 3 + 2];
      const depth = -signed;
      if (depth > best && depth < maxDepth) {
        best = depth;
        at = [x, y, z];
        hit = this.lab[bestId] || probeName(i);
      }
    }
    return { depth: best, at, hit };
  }

  /** The samples of this grid inside an axis-aligned box (min/max corners), found by visiting only the cubes it covers. */
  samplesInBox(min: [number, number, number], max: [number, number, number]): SampleSet {
    const pts: number[] = [];
    const nrm: number[] = [];
    const names: string[] = [];
    const label: number[] = [];
    const lo = min.map((v) => Math.floor(v / CELL));
    const hi = max.map((v) => Math.floor(v / CELL));
    for (let ix = lo[0]; ix <= hi[0]; ix++) for (let iy = lo[1]; iy <= hi[1]; iy++) for (let iz = lo[2]; iz <= hi[2]; iz++) {
      const list = this.cells.get(cellKey(ix * CELL, iy * CELL, iz * CELL));
      if (!list) continue;
      for (const id of list) {
        pts.push(this.pts[id * 3], this.pts[id * 3 + 1], this.pts[id * 3 + 2]);
        nrm.push(this.nrm[id * 3], this.nrm[id * 3 + 1], this.nrm[id * 3 + 2]);
        let k = names.indexOf(this.lab[id]);
        if (k < 0) k = names.push(this.lab[id]) - 1;
        label.push(k);
      }
    }
    return { pts: new Float32Array(pts), nrm: new Float32Array(nrm), count: pts.length / 3, names, label: Uint8Array.from(label) };
  }

  /** Copy of the points of `s` that may touch this grid (a cheap way to shrink a big sample set before the real test). */
  filterNear(s: SampleSet): SampleSet {
    const pts: number[] = [];
    const nrm: number[] = [];
    for (let i = 0; i < s.count; i++) {
      if (!this.near.has(cellKey(s.pts[i * 3], s.pts[i * 3 + 1], s.pts[i * 3 + 2]))) continue;
      pts.push(s.pts[i * 3], s.pts[i * 3 + 1], s.pts[i * 3 + 2]);
      nrm.push(s.nrm[i * 3], s.nrm[i * 3 + 1], s.nrm[i * 3 + 2]);
    }
    return { pts: new Float32Array(pts), nrm: new Float32Array(nrm), count: pts.length / 3 };
  }
}

/** Bounding box (min and max corners) of a sample set. */
export function boundsOf(s: SampleSet): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < s.count; i++) {
    for (let k = 0; k < 3; k++) {
      const v = s.pts[i * 3 + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/**
 * Overlap of the driver part `mover` with the kart obstacles in `kart`, in BOTH directions: driver points
 * inside the kart, and kart points inside the driver (a thin bar that pierces the head has few head points
 * inside it, but many of its own points inside the head).
 */
export function mutualOverlap(mover: SampleSet, kart: SampleGrid): Overlap {
  const near = kart.filterNear(mover);
  if (near.count === 0) return { depth: 0, at: [0, 0, 0] };
  const a = kart.deepestInside(near);
  const { min, max } = boundsOf(near);
  const kartNear = kart.samplesInBox(min, max);
  const b = new SampleGrid().add(near).deepestInside(kartNear);
  return a.depth >= b.depth ? a : b;
}
