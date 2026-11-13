/**
 * Shortcuts: dirt paths that leave the MAIN road at one place and merge back into it at another
 * (`TrackDef.shortcuts`).
 *
 * The design in one paragraph
 * ---------------------------
 * The main road is NOT touched by a shortcut: same mesh, kerbs, height, bank and terrain as if
 * the shortcut did not exist. A shortcut is only a worn dirt path across the land. It starts at
 * the main road's outer edge (just outside the kerb) and leaves it at a shallow angle; it ends by
 * merging back into the main road's edge, again at a shallow angle and at ground level. In between it
 * follows the natural ground: the path's height is the terrain height, lightly smoothed, and the
 * terrain under it is only nudged toward that smoothed line (see `PathField`). There is no
 * tarmac, no embankment, no kicker.
 *
 * How it fits together
 * --------------------
 * * Every road is a "route". Route 0 is the main loop (`track.samples`), routes 1, 2, … are the
 *   branches (`track.branches[route - 1]`).
 * * A branch has its own evenly spaced samples (same `TrackSample` shape as the main road, so most
 *   code is shared). `sample.s` is the MAPPED main-route distance: s = s0 + (b / B) · (s1 - s0), where b is
 *   the distance along the branch and B its length. A shorter branch simply advances `s` faster per metre
 *   driven, and driving it passes every checkpoint between the two junctions in order.
 * * "Which road is the kart on?" The kart's `trackIndex` (the hint) encodes the route and the
 *   sample index: `index = route * ROUTE_STRIDE + sampleIndex`. The projection searches the hinted
 *   route first and only swaps roads at the two ends (see `projectWithBranches`): off the main
 *   road's tarmac onto the path, and back as soon as the kart is on the main road's tarmac or kerb.
 * * Ground: everywhere off the main road the ground is the terrain height field, so the dirt path is
 *   simply terrain. Dirt counts as off-road for speed (so does grass).
 *
 * Pure math, no Three.js.
 */
import type { ShortcutDef } from '../track/types';
import { GROOVE_FALLOFF, RoadField, type PathHit, type PathLookup } from './terrain';
import { CURB_WIDTH, SAMPLE_SPACING, type Projection, type Track, type TrackSample } from './track';

/** Sample indices are encoded as `route * ROUTE_STRIDE + index` (any real track has far fewer samples). */
export const ROUTE_STRIDE = 1 << 20;
/** Angle (degrees) between the main road and the path where the path leaves it / merges into it. */
export const JOIN_ANGLE_DEG = 14;
/** The path runs straight at that angle for this many metres at each end, so the entry and exit are clean. */
const LEAD = 16;
/** Steepest path grade (rise / run). Steeper natural ground is cut or filled to this. */
export const MAX_GRADE = 0.18;
/** Metres over which the path's ground height is smoothed (each side), so it does not follow every bump. */
const SMOOTH_RADIUS = 6;
/** How far (m) the dirt surface is drawn above the terrain. The terrain itself is the physics ground. */
export const DIRT_LIFT = 0.05;
/** Junction zone: the kart may step from the main road onto the path this many samples after its start. */
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
  width: number;
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
  /** Always 'dirt' (a shortcut is a dirt path; kept as a field for the maps). */
  readonly surface: 'dirt';
  /** Main-route distance at the junctions and the (wrapped, positive) span between them. */
  readonly s0: number;
  readonly s1: number;
  readonly span: number;
  /** Main sample index at each junction. */
  readonly fromIdx: number;
  readonly toIdx: number;
  /** Which side of the main road (+1 = right of travel, -1 = left) the path leaves from / comes back to. */
  readonly startSide: number;
  readonly endSide: number;
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
}

interface V2 {
  x: number;
  z: number;
}

const wrapRad = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The main road's position, direction and width at distance s (interpolated between samples). */
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
  return { x: lerp(a.x, b.x), y: lerp(a.y, b.y), z: lerp(a.z, b.z), tx, tz, width: lerp(a.width, b.width), idx };
}

// ---------------------------------------------------------------------------
// Building a branch
// ---------------------------------------------------------------------------

interface Node {
  x: number;
  z: number;
  /** Branch-local control index (0 … points.length + 1); -1 for implicit nodes. */
  user: number;
  /** Forced direction at this node (the straight stretches at both ends); otherwise the bisector of the neighbours. */
  tan?: V2;
}

/**
 * Build every branch of a track (empty array when the def has no shortcuts), then let the terrain
 * flatten itself a little under them. The track's terrain must already exist (the path follows its height).
 */
export function buildBranches(track: Track): Branch[] {
  const built = (track.def.shortcuts ?? []).map((def, k) => buildBranch(track, def, k + 1));
  if (built.length > 0) {
    track.terrain.setPaths(new PathField(built));
    // Now that the ground has been nudged toward the smoothed path, the samples' height is the real ground height.
    for (const { branch } of built) for (const p of branch.samples) p.y = track.terrain.height(p.x, p.z);
  }
  return built.map((b) => b.branch);
}

/** A branch plus the smoothed ground level along it (what the terrain is pulled toward). */
interface Built {
  branch: Branch;
  level: number[];
}

function buildBranch(track: Track, def: ShortcutDef, route: number): Built {
  const L = track.length;
  const s0 = track.sAt(def.from);
  const s1 = track.sAt(def.to);
  const span = (((s1 - s0) % L) + L) % L;
  if (span < 20) throw new Error(`shortcut ${route} of "${track.def.name}": junctions are too close (from ${def.from} to ${def.to})`);
  const A = mainPoint(track, s0);
  const Q = mainPoint(track, s1);
  const branchWidth = def.width ?? track.def.width * 0.7;

  // 1) Control nodes. The path starts on the main road's outer edge (just outside the kerb) and leaves at JOIN_ANGLE
  //    to it; it ends the same way, arriving at the edge at JOIN_ANGLE. Both ends are straight for LEAD metres.
  const pts = def.points;
  const rightOf = (m: MainPoint): V2 => ({ x: -m.tz, z: m.tx });
  const sideOf = (m: MainPoint, px: number, pz: number) => {
    const r = rightOf(m);
    return (px - m.x) * r.x + (pz - m.z) * r.z >= 0 ? 1 : -1;
  };
  // The side is where the first / last control point lies (the path goes that way, the points say so).
  const startSide = pts.length > 0 ? sideOf(A, pts[0][0], pts[0][1]) : 1;
  const endSide = pts.length > 0 ? sideOf(Q, pts[pts.length - 1][0], pts[pts.length - 1][1]) : startSide;
  const ang = (JOIN_ANGLE_DEG * Math.PI) / 180;
  const rA = rightOf(A);
  const rQ = rightOf(Q);
  const edgeA = A.width / 2 + CURB_WIDTH;
  const edgeQ = Q.width / 2 + CURB_WIDTH;
  const start: V2 = { x: A.x + rA.x * startSide * edgeA, z: A.z + rA.z * startSide * edgeA };
  const end: V2 = { x: Q.x + rQ.x * endSide * edgeQ, z: Q.z + rQ.z * endSide * edgeQ };
  // Leaving: main direction turned toward the path's side. Arriving: main direction turned toward the road.
  const dirOut: V2 = { x: A.tx * Math.cos(ang) + rA.x * startSide * Math.sin(ang), z: A.tz * Math.cos(ang) + rA.z * startSide * Math.sin(ang) };
  const dirIn: V2 = { x: Q.tx * Math.cos(ang) - rQ.x * endSide * Math.sin(ang), z: Q.tz * Math.cos(ang) - rQ.z * endSide * Math.sin(ang) };
  const nodes: Node[] = [
    { ...start, user: 0, tan: dirOut },
    { x: start.x + dirOut.x * LEAD, z: start.z + dirOut.z * LEAD, user: -1, tan: dirOut },
    ...pts.map((p, i): Node => ({ x: p[0], z: p[1], user: i + 1 })),
    { x: end.x - dirIn.x * LEAD, z: end.z - dirIn.z * LEAD, user: -1, tan: dirIn },
    { ...end, user: pts.length + 1, tan: dirIn },
  ];

  // 2) A smooth cubic Hermite path through the nodes. Interior tangents point along the bisector of the two
  //    neighbouring directions; the end stretches use the forced directions.
  const unit = (x: number, z: number): V2 => {
    const l = Math.hypot(x, z) || 1;
    return { x: x / l, z: z / l };
  };
  const dirs = nodes.slice(0, -1).map((nd, i) => unit(nodes[i + 1].x - nd.x, nodes[i + 1].z - nd.z));
  const tangents: V2[] = nodes.map((nd, i) => {
    if (nd.tan) return unit(nd.tan.x, nd.tan.z);
    const t = unit(dirs[i - 1].x + dirs[i].x, dirs[i - 1].z + dirs[i].z);
    return t.x === 0 && t.z === 0 ? dirs[i] : t;
  });
  const STEPS = 32;
  const TANGENT_SCALE = 1.1; // tangent length = this × the chord to the next node
  const dense: V2[] = [];
  const denseB: number[] = [];
  const nodeB: number[] = new Array(nodes.length).fill(0);
  let acc = 0;
  for (let j = 0; j < nodes.length - 1; j++) {
    const p0 = nodes[j];
    const p1 = nodes[j + 1];
    const chord = Math.hypot(p1.x - p0.x, p1.z - p0.z) * TANGENT_SCALE;
    nodeB[j] = acc;
    for (let k = 0; k < STEPS; k++) {
      const t = k / STEPS;
      const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
      const h10 = t ** 3 - 2 * t ** 2 + t;
      const h01 = -2 * t ** 3 + 3 * t ** 2;
      const h11 = t ** 3 - t ** 2;
      const p = {
        x: h00 * p0.x + h10 * chord * tangents[j].x + h01 * p1.x + h11 * chord * tangents[j + 1].x,
        z: h00 * p0.z + h10 * chord * tangents[j].z + h01 * p1.z + h11 * chord * tangents[j + 1].z,
      };
      if (dense.length > 0) acc += Math.hypot(p.x - dense[dense.length - 1].x, p.z - dense[dense.length - 1].z);
      dense.push(p);
      denseB.push(acc);
    }
  }
  acc += Math.hypot(end.x - dense[dense.length - 1].x, end.z - dense[dense.length - 1].z);
  dense.push({ x: end.x, z: end.z });
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
      y: 0,
      z: p.z + (q.z - p.z) * u,
      tx: 0,
      tz: 0,
      rx: 0,
      rz: 0,
      s: (s0 + (b / length) * span) % L,
      heading: 0,
      curvature: 0,
      bank: 0, // a dirt path is not banked
      width: branchWidth,
      wallLeft: false,
      wallRight: false,
    });
  }

  // 4) Tangents and headings (the ends take the exact join directions), then curvature.
  const last = count;
  for (let k = 0; k <= last; k++) {
    let t: V2;
    if (k === 0) t = unit(dirOut.x, dirOut.z);
    else if (k === last) t = unit(dirIn.x, dirIn.z);
    else t = unit(samples[k + 1].x - samples[k - 1].x, samples[k + 1].z - samples[k - 1].z);
    Object.assign(samples[k], { tx: t.x, tz: t.z, rx: -t.z, rz: t.x, heading: Math.atan2(t.x, t.z) });
  }
  for (let k = 0; k <= last; k++) {
    const a = Math.max(0, k - 1);
    const b = Math.min(last, k + 1);
    samples[k].curvature = wrapRad(samples[b].heading - samples[a].heading) / ((b - a) * spacing);
  }

  // 5) Height: the natural ground (terrain without any path), lightly smoothed along the path. The smoothing
  //    window shrinks toward both ends, so the two ends sit exactly on the ground beside the main road.
  const ground = samples.map((p) => track.terrain.height(p.x, p.z));
  const R = Math.max(1, Math.round(SMOOTH_RADIUS / spacing));
  const level = ground.map((_, k) => {
    const r = Math.min(R, k, last - k);
    let sum = 0;
    for (let o = -r; o <= r; o++) sum += ground[k + o];
    return sum / (2 * r + 1);
  });
  // A kart must be able to drive it: where the ground is steeper than MAX_GRADE the path's level is limited to that
  // grade (the terrain is then cut or filled a little to match, like a track bench cut into a hillside). Both ends stay
  // pinned to the ground beside the main road; a few forward/backward passes settle it.
  const step = MAX_GRADE * spacing;
  const ends = [level[0], level[last]];
  for (let pass = 0; pass < 4; pass++) {
    level[0] = ends[0];
    for (let k = 1; k <= last; k++) level[k] = Math.max(level[k - 1] - step, Math.min(level[k - 1] + step, level[k]));
    level[last] = ends[1];
    for (let k = last - 1; k >= 0; k--) level[k] = Math.max(level[k + 1] - step, Math.min(level[k + 1] + step, level[k]));
  }
  samples.forEach((p, k) => (p.y = level[k]));

  // 6) Walls (branch-local control units).
  const controlB: number[] = [];
  for (let c = 0; c <= def.points.length + 1; c++) controlB.push(nodeB[nodes.findIndex((nd) => nd.user === c)]);
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

  const branch: Branch = {
    route,
    def,
    samples,
    length,
    spacing,
    surface: 'dirt',
    s0,
    s1,
    span,
    fromIdx: A.idx,
    toIdx: Q.idx,
    startSide,
    endSide,
    controlB,
    nearMain,
    mapS: (b: number) => (s0 + (Math.max(0, Math.min(length, b)) / length) * span) % L,
  };
  return { branch, level };
}

// ---------------------------------------------------------------------------
// Terrain: a light groove under each path
// ---------------------------------------------------------------------------

/**
 * Lets the terrain follow the dirt paths a little: within the path's core the ground is pulled to the path's
 * (smoothed) level, easing back to the natural ground over GROOVE_FALLOFF metres. Because that level IS the
 * smoothed natural ground, the change is small: a worn track across the land, not an embankment. (The terrain
 * ignores the groove near the main road, so the road's surroundings are untouched: see `Terrain.height`.)
 */
class PathField implements PathLookup {
  private readonly fields: { field: RoadField; branch: Branch; level: number[] }[];

  constructor(built: Built[]) {
    this.fields = built.map(({ branch, level }) => {
      // Segment k joins samples k and k + 1; the last entry is the (unused) wrap-around segment.
      const skip = branch.samples.map((_, k) => k === branch.samples.length - 1);
      const field = new RoadField(branch.samples, skip, branch.samples[0].width / 2 + GROOVE_FALLOFF + 1, branch.spacing);
      return { field, branch, level };
    });
  }

  nearest(x: number, z: number): PathHit | null {
    let best: PathHit | null = null;
    for (const { field, branch, level } of this.fields) {
      const hit = field.nearest(x, z);
      if (!hit || (best && hit.dist >= best.dist)) continue;
      best = { dist: hit.dist, level: level[hit.i] + (level[hit.i + 1] - level[hit.i]) * hit.u, halfWidth: branch.samples[0].width / 2 };
    }
    return best;
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
 * (route + sample). Search order: the hinted road near the hint; swap roads only at the ends of a
 * path, and only if the other road's centerline is clearly closer; if the hint is missing or the
 * kart is far from it (respawn, teleport), take the nearest road overall.
 *
 * The swap rules keep physics and looks honest: a kart on the main road's tarmac or kerb is ALWAYS on the main
 * route (so it gets road grip and the main road's own `s`), and it only steps onto a path once it has left
 * the kerb on the path's side.
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
  /** Is this main-road hit on the tarmac or kerb (as opposed to the verge or beyond)? */
  const onTarmac = (h: Hit) => {
    const pr = toProjection(track, h, x, z);
    return Math.abs(pr.d) <= pr.width / 2 + CURB_WIDTH + 0.2;
  };

  let best: Hit | null = null;
  if (idx >= 0) {
    best = route === 0 ? scanMain(idx - 12, idx + 12) : scanBranch(branches[route - 1], idx - 12, idx + 12);
    if (best.d2 > 60 * 60) best = null; // lost track of it
  }
  if (!best) {
    // Nearest road overall (ties go to the main road). A branch only counts if the kart is on
    // its path or right beside it: driving across the grass near a branch earns nothing from it.
    best = scanMain(0, n - 1);
    for (const bch of branches) {
      const c = scanBranch(bch, 0, bch.samples.length);
      const reach = bch.samples[c.i].width / 2 + CURB_WIDTH + track.def.offroadWidth + 1;
      if (c.d2 < best.d2 - 1e-6 && c.d2 <= reach * reach) best = c;
    }
  } else {
    for (const b of branches) {
      if (best.route === 0) {
        // Start of a path: once off the main road's tarmac and kerb, and closer to the path's centerline.
        if (ringDist(best.i, b.fromIdx, n) <= JUNCTION_ZONE + 2 && !onTarmac(best)) {
          const cand = scanBranch(b, 0, JUNCTION_ZONE);
          if (Math.sqrt(cand.d2) + SWITCH_MARGIN < Math.sqrt(best.d2)) best = cand;
        }
      } else if (best.route === b.route) {
        // On a path: step back onto the main road wherever it runs alongside at the same level AND the kart is on its
        // tarmac/kerb (the end of the path), or is clearly closer to the main road than to the path.
        const mi = b.nearMain[best.i];
        if (mi >= 0) {
          const cand = scanMain(mi - 16, mi + 16);
          if (onTarmac(cand) || Math.sqrt(cand.d2) + SWITCH_MARGIN < Math.sqrt(best.d2)) best = cand;
        }
      }
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
