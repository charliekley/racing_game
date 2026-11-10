/**
 * Geometry toolkit for the smooth procedural karts and drivers.
 *
 * 3D concepts used here, briefly:
 *  - A mesh surface is a grid of vertices joined into triangles. For a surface to
 *    look SMOOTH (not faceted), neighbouring triangles must share vertices and
 *    each vertex gets one averaged "normal" (the direction the surface faces).
 *    Everything below builds an INDEXED grid and lets `computeVertexNormals`
 *    average the normals, so curved parts shade as curves.
 *  - `lathe` spins a 2D profile around the Y axis (wheels, pipes, domes).
 *  - `loft` slides a rounded cross-section along Z and resizes it as it goes
 *    (the sleek bodywork: noses, side pods, fuselages, tubs).
 *  - `sweep` pushes a (tapering) circle along a curve (pipes, tails, whiskers).
 *
 * PartBuilder collects transformed copies of such shapes per material bucket
 * and merges each bucket into ONE geometry, so a whole kart is a handful of
 * draw calls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type V3 = readonly [number, number, number];

/**
 * Level-of-detail multiplier for segment counts (1 = full, ~0.6 = the cheaper Low build).
 * Set it around a build with `withDetail`.
 */
let DETAIL = 1;
export function withDetail<T>(level: number, fn: () => T): T {
  const old = DETAIL;
  DETAIL = level;
  try {
    return fn();
  } finally {
    DETAIL = old;
  }
}
const D = (n: number, min = 6) => Math.max(min, Math.round(n * DETAIL));

/** Per-vertex surface response: [roughness, metalness, emissive strength]. */
export type Surf = readonly [number, number, number];

export const SURF = {
  matte: [0.92, 0, 0],
  fur: [0.85, 0, 0],
  rubber: [0.88, 0, 0],
  plastic: [0.42, 0, 0],
  gloss: [0.2, 0, 0],
  eye: [0.1, 0, 0],
  metal: [0.34, 0.8, 0],
  chrome: [0.18, 0.95, 0],
  glass: [0.06, 0.25, 0],
  /** Unlit-looking glow (lamp lenses, screen eyes): vertex colour added as emission. */
  glow: [0.5, 0, 1.0],
} as const satisfies Record<string, Surf>;

/** Which material a part goes into. paint/accent use the player's colour; detail is vertex coloured. */
export type Bucket = 'paint' | 'accent' | 'detail';
const BUCKETS: Bucket[] = ['paint', 'accent', 'detail'];

/** A placement: position, Euler rotation (radians, XYZ) and scale (number or per-axis). */
export interface Place {
  p?: V3;
  r?: V3;
  s?: number | V3;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1);

export function placeMatrix(t: Place | THREE.Matrix4): THREE.Matrix4 {
  if (t instanceof THREE.Matrix4) return t.clone();
  const m = new THREE.Matrix4();
  _e.set(...(t.r ?? [0, 0, 0]));
  _q.setFromEuler(_e);
  const s = t.s ?? 1;
  if (typeof s === 'number') _s.set(s, s, s);
  else _s.set(...s);
  return m.compose(_p.set(...(t.p ?? [0, 0, 0])), _q, _s);
}

/** Reverse triangle winding (needed after a mirror, which turns the surface inside out). */
function flipWinding(g: THREE.BufferGeometry): void {
  const idx = g.index!;
  for (let i = 0; i < idx.count; i += 3) {
    const b = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, b);
  }
}

const _col = new THREE.Color();

export class PartBuilder {
  private parts: Record<Bucket, THREE.BufferGeometry[]> = { paint: [], accent: [], detail: [] };

  /** Add a shape to a bucket. `color`/`surf` only matter for the vertex-coloured detail bucket. */
  add(bucket: Bucket, geo: THREE.BufferGeometry, t: Place | THREE.Matrix4, color = '#888888', surf: Surf = SURF.plastic): this {
    const m = placeMatrix(t);
    this.push(bucket, geo, m, color, surf);
    return this;
  }

  /** `add` plus a mirror-image copy on the other side (x -> -x). */
  addPair(bucket: Bucket, geo: THREE.BufferGeometry, t: Place | THREE.Matrix4, color = '#888888', surf: Surf = SURF.plastic): this {
    const m = placeMatrix(t);
    this.push(bucket, geo, m, color, surf);
    this.push(bucket, geo, MIRROR_X.clone().multiply(m), color, surf);
    return this;
  }

  paint(geo: THREE.BufferGeometry, t: Place): this {
    return this.add('paint', geo, t);
  }
  paintPair(geo: THREE.BufferGeometry, t: Place): this {
    return this.addPair('paint', geo, t);
  }
  accent(geo: THREE.BufferGeometry, t: Place): this {
    return this.add('accent', geo, t);
  }
  accentPair(geo: THREE.BufferGeometry, t: Place): this {
    return this.addPair('accent', geo, t);
  }
  /** Fixed-colour part (the detail bucket). */
  part(geo: THREE.BufferGeometry, t: Place | THREE.Matrix4, color: string, surf: Surf = SURF.plastic): this {
    return this.add('detail', geo, t, color, surf);
  }
  partPair(geo: THREE.BufferGeometry, t: Place | THREE.Matrix4, color: string, surf: Surf = SURF.plastic): this {
    return this.addPair('detail', geo, t, color, surf);
  }

  /** A constant-radius pipe through `points` with rounded ends. */
  pipe(bucket: Bucket, points: V3[], radius: number, color?: string, surf?: Surf, opts: { pair?: boolean; rad?: number; segsPerPoint?: number; closed?: boolean } = {}): this {
    const g = sweep(points, radius, Math.max(6, points.length * (opts.segsPerPoint ?? 3)), opts.rad ?? 7, !!opts.closed);
    const cap = sphere(8, 6);
    const first = points[0];
    const last = points[points.length - 1];
    const add = opts.pair ? this.addPair.bind(this) : this.add.bind(this);
    add(bucket, g, {}, color, surf);
    if (opts.closed) return this;
    add(bucket, cap, { p: first, s: radius }, color, surf);
    add(bucket, cap, { p: last, s: radius }, color, surf);
    return this;
  }

  private push(bucket: Bucket, geo: THREE.BufferGeometry, m: THREE.Matrix4, color: string, surf: Surf): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geo.getAttribute('position').clone());
    g.setAttribute('normal', geo.getAttribute('normal').clone());
    if (geo.index) g.setIndex(geo.index.clone());
    else g.setIndex(Array.from({ length: geo.getAttribute('position').count }, (_, i) => i)); // non-indexed source (rounded boxes)
    g.applyMatrix4(m);
    if (m.determinant() < 0) flipWinding(g);
    if (bucket === 'detail') {
      const n = g.getAttribute('position').count;
      _col.set(color); // hex is sRGB; Color.set converts to the linear working space
      const c = new Float32Array(n * 3);
      const s = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        c[i * 3] = _col.r;
        c[i * 3 + 1] = _col.g;
        c[i * 3 + 2] = _col.b;
        s[i * 3] = surf[0];
        s[i * 3 + 1] = surf[1];
        s[i * 3 + 2] = surf[2];
      }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      g.setAttribute('surf', new THREE.BufferAttribute(s, 3));
    }
    this.parts[bucket].push(g);
  }

  /** Merge each bucket into one geometry. */
  build(): Partial<Record<Bucket, THREE.BufferGeometry>> {
    const out: Partial<Record<Bucket, THREE.BufferGeometry>> = {};
    for (const b of BUCKETS) {
      const list = this.parts[b];
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      if (!merged) throw new Error(`could not merge bucket ${b}`);
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      out[b] = merged;
      list.forEach((g) => g.dispose());
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Primitives. All indexed, with position + normal only.
// ---------------------------------------------------------------------------

function finish(pos: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Unit sphere (radius 1). Scale it for an ellipsoid. */
export function sphere(w = 20, h = 14): THREE.BufferGeometry {
  w = D(w, 6);
  h = D(h, 4);
  const pos: number[] = [];
  const idx: number[] = [];
  // Rings from the bottom pole to the top pole, `w` vertices per ring (the seam is welded).
  for (let j = 0; j <= h; j++) {
    const v = j / h;
    const phi = -Math.PI / 2 + v * Math.PI;
    for (let i = 0; i < w; i++) {
      const th = (i / w) * Math.PI * 2;
      pos.push(Math.cos(phi) * Math.cos(th), Math.sin(phi), Math.cos(phi) * Math.sin(th));
    }
  }
  ringGridIndices(idx, h + 1, w);
  const g = finish(pos, idx);
  return g;
}

/** Triangles for a grid of `rows` rings of `cols` vertices (ring wraps around). Outward = e_col x e_row. */
function ringGridIndices(idx: number[], rows: number, cols: number, flip = false): void {
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * cols + i;
      const b = j * cols + ((i + 1) % cols);
      const c = (j + 1) * cols + i;
      const d = (j + 1) * cols + ((i + 1) % cols);
      if (flip) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  }
}

/**
 * Surface of revolution around the Y axis. `profile` is a list of [radius, y]
 * going BOTTOM TO TOP along the outside surface. Repeating a point makes a
 * hard crease (a sharp edge); otherwise the shading is smooth.
 */
export function lathe(profile: [number, number][], segs = 24): THREE.BufferGeometry {
  segs = D(segs, 6);
  const pos: number[] = [];
  const idx: number[] = [];
  for (const [r, y] of profile) {
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pos.push(r * Math.cos(a), y, r * Math.sin(a));
    }
  }
  // Lathe winding: outward = e_seg x e_profile = z x y ... handled by (a, c, b) order.
  for (let j = 0; j < profile.length - 1; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * segs + i;
      const b = j * segs + ((i + 1) % segs);
      const c = (j + 1) * segs + i;
      const d = (j + 1) * segs + ((i + 1) % segs);
      idx.push(a, c, b, b, c, d);
    }
  }
  return finish(pos, idx);
}

/** A rounded-tip cone along +Y (base at y=0, tip at y=h). `bulge` < 1 makes it fatter in the middle. */
export function roundCone(r: number, h: number, segs = 14, bulge = 0.85): THREE.BufferGeometry {
  const prof: [number, number][] = [[0, 0], [r, 0]];
  const n = 9;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    prof.push([r * Math.pow(1 - t, bulge) * (1 - 0.25 * t * t), h * t]);
  }
  prof.push([0, h]);
  return lathe(prof, segs);
}

/** Capsule along Y: radius r, straight section `len`, rounded caps. */
export function capsule(r: number, len: number, segs = 12, capRings = 6): THREE.BufferGeometry {
  const prof: [number, number][] = [];
  for (let i = 0; i <= capRings; i++) {
    const a = -Math.PI / 2 + (i / capRings) * (Math.PI / 2);
    prof.push([Math.cos(a) * r, -len / 2 + Math.sin(a) * r]);
  }
  for (let i = 0; i <= capRings; i++) {
    const a = (i / capRings) * (Math.PI / 2);
    prof.push([Math.cos(a) * r, len / 2 + Math.sin(a) * r]);
  }
  return lathe(prof, segs);
}

/** Smoothly rounded box (width, height, depth, corner radius). */
export function roundBox(w: number, h: number, d: number, r: number, seg = 0): THREE.BufferGeometry {
  // Small parts get 1 rounding segment, bigger ones 2 (each segment adds a lot of triangles).
  if (!seg) seg = Math.max(w, h, d) < 0.2 ? 1 : 2;
  seg = D(seg, 1);
  const g = new RoundedBoxGeometry(w, h, d, seg, r);
  g.deleteAttribute('uv');
  return g;
}

/** Torus in the XY plane (axis Z). */
export function torus(R: number, r: number, ring = 24, tube = 10): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j < tube; j++) {
    const b = (j / tube) * Math.PI * 2;
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2;
      const rr = R + r * Math.cos(b);
      pos.push(rr * Math.cos(a), rr * Math.sin(a), r * Math.sin(b));
    }
  }
  for (let j = 0; j < tube; j++) {
    for (let i = 0; i < ring; i++) {
      const a = j * ring + i;
      const b = j * ring + ((i + 1) % ring);
      const c = ((j + 1) % tube) * ring + i;
      const d = ((j + 1) % tube) * ring + ((i + 1) % ring);
      idx.push(a, b, c, b, d, c);
    }
  }
  return finish(pos, idx);
}

// --- Loft ------------------------------------------------------------------------

/**
 * One cross-section of a loft, in the plane at `z`. The outline is a
 * "superellipse": hw = half width, ht = half height above the centre line
 * `cy`, hb = half height below it, n = squareness (2 = ellipse, 3-4 = rounded
 * rectangle).
 */
export interface Section {
  z: number;
  cy: number;
  hw: number;
  ht: number;
  hb: number;
  n?: number;
  cx?: number;
}

const sgnpow = (v: number, p: number) => Math.sign(v) * Math.pow(Math.abs(v), p);

function catmull(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
}

/** Resample sections with a smooth spline so a few keyframes give a flowing surface. */
function resample(sections: Section[], sub: number): Section[] {
  const out: Section[] = [];
  const last = sections.length - 1;
  const at = (i: number) => sections[Math.max(0, Math.min(last, i))];
  for (let i = 0; i < last; i++) {
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      const f = (key: 'z' | 'cy' | 'hw' | 'ht' | 'hb' | 'n' | 'cx') =>
        catmull(at(i - 1)[key] ?? (key === 'n' ? 2.4 : 0), at(i)[key] ?? (key === 'n' ? 2.4 : 0), at(i + 1)[key] ?? (key === 'n' ? 2.4 : 0), at(i + 2)[key] ?? (key === 'n' ? 2.4 : 0), t);
      out.push({ z: f('z'), cy: f('cy'), hw: Math.max(0.0005, f('hw')), ht: Math.max(0.0005, f('ht')), hb: Math.max(0.0005, f('hb')), n: Math.max(1.6, f('n')), cx: f('cx') });
    }
  }
  out.push({ ...sections[last], n: sections[last].n ?? 2.4 });
  return out;
}

/** The smooth, resampled sections of a loft (handy for placing trim that follows its outline). */
export function sampleSections(sections: Section[], sub = 4): Section[] {
  return resample(sections, sub);
}

/** Closed loop of points following a loft's upper outline (for a rolled rim): inset = fraction of half-width. */
export function loftRimPoints(sections: Section[], inset = 0.92, lift = 0.98, step = 2): V3[] {
  const secs = resample(sections, 4).filter((s) => s.hw > 0.04);
  const right: V3[] = [];
  const left: V3[] = [];
  secs.forEach((s, i) => {
    if (i % step && i !== secs.length - 1) return;
    right.push([(s.cx ?? 0) + s.hw * inset, s.cy + s.ht * lift, s.z]);
    left.push([-((s.cx ?? 0) + s.hw * inset), s.cy + s.ht * lift, s.z]);
  });
  return [...right, ...left.reverse()];
}

/** Points on an ellipse in the XZ plane at height y (for closed rims and coamings). */
export function ellipseLoop(cx: number, y: number, cz: number, rx: number, rz: number, n = 20, expo = 2): V3[] {
  const pts: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + rx * sgnpow(Math.cos(a), 2 / expo), y, cz + rz * sgnpow(Math.sin(a), 2 / expo)]);
  }
  return pts;
}

/**
 * A smooth body of "stacked rounded cross-sections" along Z. Ends should shrink
 * to (almost) nothing so the shape closes like a nose or tail cone.
 */
export function loft(sections: Section[], ring = 24, sub = 3): THREE.BufferGeometry {
  ring = D(ring, 10);
  sub = D(sub, 2);
  const secs = resample(sections, sub);
  const pos: number[] = [];
  const idx: number[] = [];
  for (const s of secs) {
    const n = s.n ?? 2.4;
    const e = 2 / n;
    for (let i = 0; i < ring; i++) {
      const th = (i / ring) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      pos.push((s.cx ?? 0) + s.hw * sgnpow(c, e), s.cy + (sn >= 0 ? s.ht : s.hb) * sgnpow(sn, e), s.z);
    }
  }
  // outward = e_ring x e_z
  for (let j = 0; j < secs.length - 1; j++) {
    for (let i = 0; i < ring; i++) {
      const a = j * ring + i;
      const b = j * ring + ((i + 1) % ring);
      const c = (j + 1) * ring + i;
      const d = (j + 1) * ring + ((i + 1) % ring);
      idx.push(a, b, c, b, d, c);
    }
  }
  return finish(pos, idx);
}

// --- Sweep -------------------------------------------------------------------------

/**
 * A tube following a smooth curve through `points`. `radius` is a number or a
 * function of t (0 at the start .. 1 at the end) for tapers. The tube is open
 * at the ends unless the radius goes to ~0 there (see `PartBuilder.pipe`, which
 * adds round caps).
 */
export function sweep(points: V3[], radius: number | ((t: number) => number), segs = 24, rad = 8, closed = false): THREE.BufferGeometry {
  segs = D(segs, 4);
  rad = D(rad, 5);
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, 'centripetal');
  const frames = curve.computeFrenetFrames(segs, closed);
  const pos: number[] = [];
  const idx: number[] = [];
  const P = new THREE.Vector3();
  const rows = closed ? segs : segs + 1;
  for (let j = 0; j < rows; j++) {
    const t = j / segs;
    curve.getPointAt(t, P);
    const r = typeof radius === 'number' ? radius : Math.max(0.0004, radius(t));
    const N = frames.normals[j];
    const B = frames.binormals[j];
    for (let i = 0; i < rad; i++) {
      const a = (i / rad) * Math.PI * 2;
      const c = Math.cos(a) * r;
      const s = Math.sin(a) * r;
      pos.push(P.x + c * N.x + s * B.x, P.y + c * N.y + s * B.y, P.z + c * N.z + s * B.z);
    }
  }
  // outward = e_ring x e_t (the opposite order to the sphere/lathe grids)
  ringGridIndices(idx, rows, rad, true);
  if (closed) {
    // join the last row back to the first
    for (let i = 0; i < rad; i++) {
      const a = (rows - 1) * rad + i;
      const b = (rows - 1) * rad + ((i + 1) % rad);
      const c = i;
      const d = (i + 1) % rad;
      idx.push(a, b, c, b, d, c);
    }
  }
  return finish(pos, idx);
}

/** Points on a helix around the Y axis (for coil springs). */
export function helix(r: number, y0: number, y1: number, turns: number, perTurn = 8, cx = 0, cz = 0): V3[] {
  const pts: V3[] = [];
  const n = Math.round(turns * perTurn);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, y0 + (y1 - y0) * t, cz + Math.sin(a) * r]);
  }
  return pts;
}

/** Colour helper: multiply (f<1 darkens) or mix toward white (f>1 lightens up to 2). */
export function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  if (f <= 1) c.multiplyScalar(f);
  else c.lerp(new THREE.Color('#ffffff'), Math.min(1, f - 1));
  return '#' + c.getHexString();
}

/** Linear mix of two hex colours. */
export function mix(a: string, b: string, t: number): string {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

/** Count triangles in a geometry. */
export function triCount(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}
