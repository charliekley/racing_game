/**
 * Shortcuts: branch roads that leave the MAIN road at one junction and rejoin
 * it at another (`TrackDef.shortcuts`).
 *
 * How it fits together
 * --------------------
 * * Every road is a "route". Route 0 is the main loop (`track.samples`), routes
 *   1, 2, … are the branches (`track.branches[route - 1]`).
 * * A branch is its own smooth (cubic Hermite) path with its own evenly spaced samples
 *   (same `TrackSample` shape as the main road, so most code is shared). It starts
 *   exactly on the main centerline at `from` and ends exactly on it at `to`.
 * * Distance bookkeeping: a branch has its own length B, but a kart on it reports
 *   `Projection.s` MAPPED onto the main route: s = s0 + (b / B) · (s1 - s0), where
 *   b is the distance along the branch. So the race rules and the ranking keep
 *   working unchanged: a shorter branch simply advances `s` faster per metre driven,
 *   and driving along it passes every checkpoint between the two junctions in order.
 * * "Which road is the kart on?" The kart's `trackIndex` (the hint) encodes both
 *   the route and the sample index: `index = route * ROUTE_STRIDE + sampleIndex`.
 *   The projection searches the hinted route first and only switches roads inside
 *   the short junction zones where the roads are joined. Where a branch crosses the
 *   main road elsewhere (a bridge), the hint therefore keeps a kart on its own level.
 *
 * Pure math, no Three.js.
 */
import type { ShortcutDef } from '../track/types';
import { RoadField, TERRAIN_BLEND, TERRAIN_SKIRT, type RoadHit, type RoadLookup } from './terrain';
import { CURB_WIDTH, SAMPLE_SPACING, type Projection, type Track, type TrackSample } from './track';

/** Sample indices are encoded as `route * ROUTE_STRIDE + index` (any real track has far fewer samples). */
export const ROUTE_STRIDE = 1 << 20;
/** Metres over which a branch's width/bank blend between the main road's and its own, at each end. */
export const BRANCH_BLEND = 24;
/** Metres at each end of a dirt branch that still count as (and look like) ordinary road. */
export const DIRT_TAPER = 12;
/** Junction zone: roads may swap this many samples from a branch end. */
export const JUNCTION_ZONE = 24;
/** Branch samples this close (m, horizontally) to the main road, at the same height, count as "near the main road". */
const NEAR_MAIN_DIST = 30;
/** ...and "the same height" means within this many metres. */
const SAME_LEVEL = 3;
/** A kart switches roads only if the other centerline is this much closer (m): stops flicker. */
const SWITCH_MARGIN = 0.8;

/** Where a branch is relative to a point of the main road. */
interface MainPoint {
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  /** Height change per metre of main road. */
  slope: number;
  width: number;
  bank: number;
  /** Index of the main sample at or before this point. */
  idx: number;
}

export interface Branch {
  /** Route id (1-based; 0 is the main road). */
  readonly route: number;
  readonly def: ShortcutDef;
  /** Evenly spaced centerline samples, first = start junction, last = end junction. `s` is the MAPPED main-route distance. */
  readonly samples: TrackSample[];
  /** Real length of the branch (m) and the distance between its samples. */
  readonly length: number;
  readonly spacing: number;
  readonly surface: 'road' | 'dirt';
  /** Main-route distance at the junctions and the (wrapped, positive) span between them. */
  readonly s0: number;
  readonly s1: number;
  readonly span: number;
  /** Main sample index at each junction. */
  readonly fromIdx: number;
  readonly toIdx: number;
  /** Sample range [dirtFrom, dirtTo] where a dirt branch is actually dirt (ends are road). */
  readonly dirtFrom: number;
  readonly dirtTo: number;
  /**
   * For each branch sample: index of the nearest main-road sample if the main road is close (within
   * NEAR_MAIN_DIST) AND at about the same height, else -1. Where it is >= 0 a kart could be on either
   * road, so the projection may swap back to the main road there (never at an underpass/overpass).
   */
  readonly nearMain: number[];
  /** Branch distance (m) at each branch-local control point (0 … points.length + 1). */
  readonly controlB: number[];
  /** Branch distance (m) -> mapped main-route distance. */
  mapS(b: number): number;
  /** Is sample `i` dirt (slows like off-road)? */
  isDirt(i: number): boolean;
}

interface V3 {
  x: number;
  y: number;
  z: number;
}

const wrapRad = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth01 = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** The main road's position, direction, width and bank at distance s (interpolated between samples). */
function mainPoint(track: Track, s: number): MainPoint {
  const S = track.samples;
  const n = S.length;
  const L = track.length;
  const x = ((s % L) + L) % L;
  const idx = Math.floor(x / track.spacing) % n;
  const u = x / track.spacing - Math.floor(x / track.spacing);
  const a = S[idx];
  const b = S[(idx + 1) % n];
  const lerp = (p: number, q: number) => p + (q - p) * u;
  let tx = lerp(a.tx, b.tx);
  let tz = lerp(a.tz, b.tz);
  const tl = Math.hypot(tx, tz) || 1;
  tx /= tl;
  tz /= tl;
  return {
    x: lerp(a.x, b.x),
    y: lerp(a.y, b.y),
    z: lerp(a.z, b.z),
    tx,
    tz,
    slope: (b.y - a.y) / track.spacing,
    width: lerp(a.width, b.width),
    bank: lerp(a.bank, b.bank),
    idx,
  };
}

// ---------------------------------------------------------------------------
// Building a branch
// ---------------------------------------------------------------------------

interface Node {
  x: number;
  y: number | null; // null = "work it out from the neighbours"
  z: number;
  /** Branch-local control index (0 … points.length + 1). */
  user: number;
}

/** Build every branch of a track (empty array when the def has no shortcuts). */
export function buildBranches(track: Track): Branch[] {
  return (track.def.shortcuts ?? []).map((def, k) => buildBranch(track, def, k + 1));
}

function buildBranch(track: Track, def: ShortcutDef, route: number): Branch {
  const L = track.length;
  const s0 = track.sAt(def.from);
  const s1 = track.sAt(def.to);
  const span = (((s1 - s0) % L) + L) % L;
  if (span < 20) throw new Error(`shortcut ${route} of "${track.def.name}": junctions are too close (from ${def.from} to ${def.to})`);
  const A = mainPoint(track, s0);
  const Q = mainPoint(track, s1);

  // 1) Control nodes: the start junction, your points, the end junction.
  const nodes: Node[] = [{ x: A.x, y: A.y, z: A.z, user: 0 }];
  def.points.forEach((p, i) => nodes.push({ x: p[0], y: p[2] ?? null, z: p[1], user: i + 1 }));
  nodes.push({ x: Q.x, y: Q.y, z: Q.z, user: def.points.length + 1 });
  // Points given without a height: spread evenly (by horizontal distance) between the known heights.
  fillHeights(nodes);

  // 2) A smooth cubic Hermite path through the nodes. Interior tangents point along the bisector of
  //    the two neighbouring directions; the first and last tangent are the MAIN road's own direction
  //    (and slope), so the branch leaves and joins the main road with no kink.
  const unit = (x: number, y: number, z: number): V3 => {
    const l = Math.hypot(x, y, z) || 1;
    return { x: x / l, y: y / l, z: z / l };
  };
  const dirs = nodes.slice(0, -1).map((nd, i) => unit(nodes[i + 1].x - nd.x, (nodes[i + 1].y as number) - (nd.y as number), nodes[i + 1].z - nd.z));
  const tangents: V3[] = nodes.map((_, i) => {
    if (i === 0) return unit(A.tx, A.slope, A.tz);
    if (i === nodes.length - 1) return unit(Q.tx, Q.slope, Q.tz);
    const t = unit(dirs[i - 1].x + dirs[i].x, dirs[i - 1].y + dirs[i].y, dirs[i - 1].z + dirs[i].z);
    return t.x === 0 && t.y === 0 && t.z === 0 ? dirs[i] : t;
  });
  const STEPS = 32;
  const TANGENT_SCALE = 1.1; // tangent length = this × the chord to the next node
  const dense: V3[] = [];
  const denseB: number[] = [];
  const nodeB: number[] = new Array(nodes.length).fill(0);
  let acc = 0;
  for (let j = 0; j < nodes.length - 1; j++) {
    const p0 = nodes[j];
    const p1 = nodes[j + 1];
    const chord = Math.hypot(p1.x - p0.x, (p1.y as number) - (p0.y as number), p1.z - p0.z) * TANGENT_SCALE;
    nodeB[j] = acc;
    for (let k = 0; k < STEPS; k++) {
      const t = k / STEPS;
      const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
      const h10 = t ** 3 - 2 * t ** 2 + t;
      const h01 = -2 * t ** 3 + 3 * t ** 2;
      const h11 = t ** 3 - t ** 2;
      const hp = (a: number, b: number, ta: number, tb: number) => h00 * a + h10 * chord * ta + h01 * b + h11 * chord * tb;
      const p = {
        x: hp(p0.x, p1.x, tangents[j].x, tangents[j + 1].x),
        y: hp(p0.y as number, p1.y as number, tangents[j].y, tangents[j + 1].y),
        z: hp(p0.z, p1.z, tangents[j].z, tangents[j + 1].z),
      };
      if (dense.length > 0) acc += Math.hypot(p.x - dense[dense.length - 1].x, p.z - dense[dense.length - 1].z);
      dense.push(p);
      denseB.push(acc);
    }
  }
  const qEnd = { x: Q.x, y: Q.y, z: Q.z };
  acc += Math.hypot(qEnd.x - dense[dense.length - 1].x, qEnd.z - dense[dense.length - 1].z);
  dense.push(qEnd);
  denseB.push(acc);
  nodeB[nodes.length - 1] = acc;
  const length = acc;

  // 3) Resample at even spacing (about SAMPLE_SPACING, like the main road).
  const count = Math.max(4, Math.round(length / SAMPLE_SPACING));
  const spacing = length / count;
  const samples: TrackSample[] = [];
  let j = 0;
  for (let k = 0; k <= count; k++) {
    const b = k * spacing;
    while (j < dense.length - 2 && denseB[j + 1] < b) j++;
    const p = dense[j];
    const q = dense[j + 1];
    const span2 = denseB[j + 1] - denseB[j];
    const u = span2 > 1e-9 ? Math.max(0, Math.min(1, (b - denseB[j]) / span2)) : 0;
    samples.push({
      x: p.x + (q.x - p.x) * u,
      y: p.y + (q.y - p.y) * u,
      z: p.z + (q.z - p.z) * u,
      tx: 0,
      tz: 0,
      rx: 0,
      rz: 0,
      s: (s0 + (b / length) * span) % L,
      heading: 0,
      curvature: 0,
      bank: 0,
      width: 0,
      wallLeft: false,
      wallRight: false,
    });
  }

  // 4) Tangents and headings (the ends take the main road's tangent exactly), then curvature.
  const last = count;
  for (let k = 0; k <= last; k++) {
    let tx: number;
    let tz: number;
    if (k === 0) [tx, tz] = [A.tx, A.tz];
    else if (k === last) [tx, tz] = [Q.tx, Q.tz];
    else {
      tx = samples[k + 1].x - samples[k - 1].x;
      tz = samples[k + 1].z - samples[k - 1].z;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
    }
    Object.assign(samples[k], { tx, tz, rx: -tz, rz: tx, heading: Math.atan2(tx, tz) });
  }
  for (let k = 0; k <= last; k++) {
    const a = Math.max(0, k - 1);
    const b = Math.min(last, k + 1);
    samples[k].curvature = wrapRad(samples[b].heading - samples[a].heading) / ((b - a) * spacing);
  }

  // 5) Banking from curvature (smoothed), width and bank blended with the main road's at both ends.
  const def0 = track.def;
  const maxBank = (def0.maxBankDeg * Math.PI) / 180;
  const raw = samples.map((p) => Math.max(-maxBank, Math.min(maxBank, p.curvature * def0.bankPerCurvature)));
  const R = Math.round(12 / spacing);
  const branchWidth = def.width ?? def0.width * 0.7;
  const blend = Math.min(BRANCH_BLEND, length / 2);
  for (let k = 0; k <= last; k++) {
    let sum = 0;
    let cnt = 0;
    for (let o = -R; o <= R; o++) {
      const m = k + o;
      if (m < 0 || m > last) continue;
      sum += raw[m];
      cnt++;
    }
    const bankB = sum / cnt;
    const b = k * spacing;
    const w0 = smooth01(b / blend); // 0 at the start junction -> 1 inside
    const w1 = smooth01((length - b) / blend);
    const own = w0 + w1 - 1; // weight of the branch's own value (at most one of w0, w1 is below 1)
    samples[k].bank = A.bank * (1 - w0) + Q.bank * (1 - w1) + bankB * own;
    samples[k].width = A.width * (1 - w0) + Q.width * (1 - w1) + branchWidth * own;
  }

  // 6) Walls (branch-local control units).
  const controlB: number[] = [];
  for (let c = 0; c <= def.points.length + 1; c++) controlB.push(nodeB[c]);
  const bAt = (c: number) => {
    const i = Math.max(0, Math.min(controlB.length - 1, Math.floor(c)));
    const next = controlB[Math.min(controlB.length - 1, i + 1)];
    return controlB[i] + (next - controlB[i]) * (c - i);
  };
  for (const w of def.walls ?? []) {
    const b0 = bAt(w.from);
    const b1 = bAt(w.to);
    for (let k = 0; k <= last; k++) {
      const b = k * spacing;
      if (b < b0 || b > b1) continue;
      const p = samples[k];
      const outerLeft = p.curvature < 0;
      if (w.side === 'left' || w.side === 'both' || (w.side === 'outer' && outerLeft)) p.wallLeft = true;
      if (w.side === 'right' || w.side === 'both' || (w.side === 'outer' && !outerLeft)) p.wallRight = true;
    }
  }

  // Where is the main road close by (and at the same level)? Used to swap a kart back to the main road.
  const nearMain = samples.map((p) => {
    let best = -1;
    let bestD2 = NEAR_MAIN_DIST * NEAR_MAIN_DIST;
    track.samples.forEach((q, i) => {
      const d2 = (p.x - q.x) ** 2 + (p.z - q.z) ** 2;
      if (d2 < bestD2 && Math.abs(p.y - q.y) < SAME_LEVEL) {
        bestD2 = d2;
        best = i;
      }
    });
    return best;
  });

  const dirt = def.surface === 'dirt';
  const taper = Math.min(DIRT_TAPER, length / 3);
  const dirtFrom = Math.ceil(taper / spacing);
  const dirtTo = Math.floor((length - taper) / spacing);
  return {
    route,
    def,
    samples,
    length,
    spacing,
    surface: dirt ? 'dirt' : 'road',
    s0,
    s1,
    span,
    fromIdx: A.idx,
    toIdx: Q.idx,
    dirtFrom,
    dirtTo,
    controlB,
    nearMain,
    mapS: (b: number) => (s0 + (Math.max(0, Math.min(length, b)) / length) * span) % L,
    isDirt: (i: number) => dirt && i >= dirtFrom && i < dirtTo,
  };
}

/** Give every node without a height one: linear in horizontal distance between the nearest known neighbours. */
function fillHeights(nodes: Node[]): void {
  const known = nodes.map((nd, i) => (nd.y !== null ? i : -1)).filter((i) => i >= 0);
  const dist = (a: number, b: number) => Math.hypot(nodes[b].x - nodes[a].x, nodes[b].z - nodes[a].z);
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].y !== null) continue;
    const lo = known.filter((k) => k < i).pop()!;
    const hi = known.find((k) => k > i)!;
    let before = 0;
    for (let k = lo; k < i; k++) before += dist(k, k + 1);
    let total = before;
    for (let k = i; k < hi; k++) total += dist(k, k + 1);
    nodes[i].y = nodes[lo].y! + (nodes[hi].y! - nodes[lo].y!) * (total > 0 ? before / total : 0);
  }
}

// ---------------------------------------------------------------------------
// Projection onto several roads
// ---------------------------------------------------------------------------

/** Nearest point on one road. */
interface Hit {
  route: number;
  /** Segment index within the route and position along the segment (0..1). */
  i: number;
  u: number;
  d2: number;
}

/** Nearest segment of `samples` to (x, z) among segment indices lo..hi (inclusive). Main wraps around; branches clamp. */
function scan(samples: TrackSample[], closed: boolean, route: number, x: number, z: number, lo: number, hi: number): Hit {
  const n = samples.length;
  const segs = closed ? n : n - 1;
  let best: Hit = { route, i: 0, u: 0, d2: Infinity };
  if (!closed) {
    lo = Math.max(0, lo);
    hi = Math.min(segs - 1, hi);
  }
  for (let k = lo; k <= hi; k++) {
    const i = closed ? ((k % n) + n) % n : k;
    const a = samples[i];
    const b = samples[(i + 1) % n];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len2 = ex * ex + ez * ez || 1;
    let u = ((x - a.x) * ex + (z - a.z) * ez) / len2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const qx = a.x + ex * u - x;
    const qz = a.z + ez * u - z;
    const d2 = qx * qx + qz * qz;
    if (d2 < best.d2) best = { route, i, u, d2 };
  }
  return best;
}

/** Turn the winning hit into a Projection (interpolated centerline data + the MAPPED distance s). */
function toProjection(track: Track, hit: Hit, x: number, z: number): Projection {
  const branch = hit.route > 0 ? track.branches[hit.route - 1] : null;
  const S = branch ? branch.samples : track.samples;
  const a = S[hit.i];
  const b = S[(hit.i + 1) % S.length];
  const u = hit.u;
  const cx = a.x + (b.x - a.x) * u;
  const cz = a.z + (b.z - a.z) * u;
  const rx = a.rx + (b.rx - a.rx) * u;
  const rz = a.rz + (b.rz - a.rz) * u;
  const rl = Math.hypot(rx, rz) || 1;
  const s = branch ? branch.mapS((hit.i + u) * branch.spacing) : (a.s + track.spacing * u) % track.length;
  return {
    i: hit.i,
    route: hit.route,
    index: hit.route * ROUTE_STRIDE + hit.i,
    s,
    d: ((x - cx) * rx + (z - cz) * rz) / rl,
    y: a.y + (b.y - a.y) * u,
    width: a.width + (b.width - a.width) * u,
    bank: a.bank + (b.bank - a.bank) * u,
  };
}

/** Circular distance between two main sample indices. */
function ringDist(a: number, b: number, n: number): number {
  const d = Math.abs(a - b) % n;
  return Math.min(d, n - d);
}

/**
 * `Track.project` for tracks with shortcuts. `hint` is the previous `Projection.index`
 * (route + sample). Search order: the hinted road near the hint; swap roads only inside a
 * junction zone, and only if the other road's centerline is clearly closer; if the hint is
 * missing or the kart is far from it (respawn, teleport), take the nearest road overall.
 */
export function projectWithBranches(track: Track, x: number, z: number, hint: number): Projection {
  const S = track.samples;
  const n = S.length;
  const branches = track.branches;
  let route = 0;
  let idx = -1;
  if (hint >= 0) {
    route = Math.floor(hint / ROUTE_STRIDE);
    idx = hint % ROUTE_STRIDE;
    if (route > branches.length) [route, idx] = [0, -1];
  }
  const scanMain = (lo: number, hi: number) => scan(S, true, 0, x, z, lo, hi);
  const scanBranch = (b: Branch, lo: number, hi: number) => scan(b.samples, false, b.route, x, z, lo, hi);

  let best: Hit | null = null;
  if (idx >= 0) {
    best = route === 0 ? scanMain(idx - 12, idx + 12) : scanBranch(branches[route - 1], idx - 12, idx + 12);
    if (best.d2 > 60 * 60) best = null; // lost track of it
  }
  if (!best) {
    // Nearest road overall (ties go to the main road). A branch only counts if the kart is on
    // its road or off-road strip: driving across the grass near a branch earns nothing from it.
    best = scanMain(0, n - 1);
    for (const bch of branches) {
      const c = scanBranch(bch, 0, bch.samples.length);
      const reach = bch.samples[c.i].width / 2 + CURB_WIDTH + track.def.offroadWidth + 1;
      if (c.d2 < best.d2 - 1e-6 && c.d2 <= reach * reach) best = c;
    }
  } else {
    // Junction zones: allowed to swap between the main road and a branch.
    const Z = JUNCTION_ZONE;
    for (const b of branches) {
      let cand: Hit | null = null;
      const last = b.samples.length - 1;
      if (best.route === 0) {
        if (ringDist(best.i, b.fromIdx, n) <= Z + 2) cand = scanBranch(b, 0, Z);
        if (ringDist(best.i, b.toIdx, n) <= Z + 2) {
          const c = scanBranch(b, last - Z, last);
          if (!cand || c.d2 < cand.d2) cand = c;
        }
      } else if (best.route === b.route) {
        // On a branch: swap back to the main road wherever it runs alongside at the same level.
        const mi = b.nearMain[best.i];
        if (mi >= 0) cand = scanMain(mi - 16, mi + 16);
      }
      if (cand && Math.sqrt(cand.d2) + SWITCH_MARGIN < Math.sqrt(best.d2)) best = cand;
    }
  }
  return toProjection(track, best, x, z);
}

/** Nearest point on the MAIN road only (a hint is a main sample index; -1 = search everywhere). */
export function projectOnMain(track: Track, x: number, z: number, hintIdx = -1): Projection {
  const n = track.samples.length;
  let hit = hintIdx >= 0 ? scan(track.samples, true, 0, x, z, hintIdx - 12, hintIdx + 12) : null;
  if (!hit || hit.d2 > 60 * 60) hit = scan(track.samples, true, 0, x, z, 0, n - 1);
  return toProjection(track, hit, x, z);
}

/**
 * The sample `k` steps ahead of position `i` on `route`, following the road: a branch
 * continues onto the main road after its end junction; a negative position (before a
 * branch starts) is the main road leading up to the junction.
 */
export function sampleAhead(track: Track, route: number, i: number, k: number): TrackSample {
  const S = track.samples;
  const n = S.length;
  const j = i + k;
  if (route === 0) return S[((j % n) + n) % n];
  const b = track.branches[route - 1];
  const last = b.samples.length - 1;
  if (j < 0) return S[(((b.fromIdx + j) % n) + n) % n];
  if (j <= last) return b.samples[j];
  return S[(b.toIdx + (j - last)) % n];
}

// ---------------------------------------------------------------------------
// Terrain: blend the ground toward the branch roads too
// ---------------------------------------------------------------------------

/** Nearest road among the main loop and the branches; `hit.route` says which. */
class MultiRoadField implements RoadLookup {
  constructor(
    private readonly main: RoadField,
    private readonly branches: { route: number; field: RoadField }[],
  ) {}

  nearest(x: number, z: number): RoadHit | null {
    let best = this.main.nearest(x, z);
    if (best) best.route = 0;
    for (const { route, field } of this.branches) {
      const hit = field.nearest(x, z);
      if (hit && (!best || hit.dist < best.dist)) best = { ...hit, route };
    }
    return best;
  }
}

/**
 * Wrap the main road's terrain field so the ground also blends toward the branch
 * roads. Branch stretches that pass OVER the main road (>= 5 m above it) are left
 * out, like bridges are for the main road, so they don't lift the ground under them
 * onto the road below. `reach` = main half-width + off-road strip.
 */
export function withBranchField(track: Track, main: RoadField, reach: number): RoadLookup {
  if (track.branches.length === 0) return main;
  const influence = reach + TERRAIN_SKIRT + (track.def.terrain?.blend ?? TERRAIN_BLEND);
  const fields = track.branches.map((b) => {
    const m = b.samples.length;
    const over = b.samples.map((p) => passesOverMain(track, p, reach));
    // Segment k joins samples k and k + 1; the last entry is the (unused) wrap-around segment.
    const skip = over.map((o, k) => k === m - 1 || o || over[k + 1]);
    return { route: b.route, field: new RoadField(b.samples, skip, influence, b.spacing) };
  });
  return new MultiRoadField(main, fields);
}

/** True if branch sample p is at least 5 m above a main-road sample within `reach` (horizontally). */
function passesOverMain(track: Track, p: TrackSample, reach: number): boolean {
  for (const q of track.samples) {
    if (p.y - q.y >= 5 && (p.x - q.x) ** 2 + (p.z - q.z) ** 2 < reach * reach) return true;
  }
  return false;
}
