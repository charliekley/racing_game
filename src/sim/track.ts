/**
 * Turns a TrackDef (control points) into everything the simulation needs:
 * an evenly sampled centerline with width/banking/walls, a "project a point
 * onto the track" query, and the Ground (height + surface) the karts drive on.
 *
 * Pure math; the renderer builds its meshes from the same samples so visuals
 * and physics always agree.
 */
import { DRAWBRIDGE_GAP } from '../track/hazardTypes';
import type { TrackDef } from '../track/types';
import { ITEMS } from './config';
import type { Ground, GroundHit, Surface } from './ground';
import type { ItemBox } from './items/types';
import { RoadField, Terrain, TERRAIN_BLEND, TERRAIN_SKIRT, type RoadHit } from './terrain';
import { CANNON, resolveCannons, type ResolvedCannon } from './cannon';
import { branchRoute, mainRoute, type RouteLine } from './routes';
import { buildBranches, projectOnMain, projectWithBranches, sampleAhead, ROUTE_STRIDE, withBranchField, type Branch } from './shortcuts';
import { LANDING_LENGTH, landingHeight, shapeHeight, type RampShape } from './jumps';

/** Distance between centerline samples (m). */
export const SAMPLE_SPACING = 2;
/** Curb width (m) – drivable like road, drawn red/white. */
export const CURB_WIDTH = 1.2;

export interface TrackSample {
  x: number;
  y: number;
  z: number;
  /** Unit tangent (direction of travel) and unit right vector, horizontal. */
  tx: number;
  tz: number;
  rx: number;
  rz: number;
  /** Distance from the start line along the centerline (m). */
  s: number;
  heading: number;
  /** Signed curvature (1/m); negative = turning right. */
  curvature: number;
  /** Signed bank angle (rad); positive = right edge raised. */
  bank: number;
  width: number;
  wallLeft: boolean;
  wallRight: boolean;
}

export interface Projection {
  /** Index of the sample at the start of the nearest segment (within its route: see `route`). */
  i: number;
  /** Which road: 0 = main loop, 1+ = shortcut branch `track.branches[route - 1]`. */
  route: number;
  /** Route + sample packed into one number: store it as the kart's `trackIndex` and pass it back as the hint. Equals `i` on the main road. */
  index: number;
  /** Distance along the track (0..length). On a shortcut branch this is MAPPED onto the main route between its junctions. */
  s: number;
  /** Signed lateral offset from the centerline (m), positive = right of travel direction. */
  d: number;
  /** Interpolated centerline height, width and bank at this point. */
  y: number;
  width: number;
  bank: number;
}

interface V3 {
  x: number;
  y: number;
  z: number;
}

// ---------------------------------------------------------------------------
// Centripetal Catmull-Rom spline (passes through every control point and,
// unlike the uniform variant, never makes loops or cusps on uneven spacing).
// ---------------------------------------------------------------------------
function catmullRom(p0: V3, p1: V3, p2: V3, p3: V3, u: number): V3 {
  const knot = (a: V3, b: V3) => Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)));
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const mix = (a: V3, b: V3, ta: number, tb: number): V3 => {
    const wa = (tb - t) / (tb - ta);
    const wb = (t - ta) / (tb - ta);
    return { x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb, z: a.z * wa + b.z * wb };
  };
  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

const wrapRad = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface Ramp {
  s0: number;
  s1: number;
  height: number;
  /** Shape of the ramp surface (see jumps.ts). */
  shape: RampShape;
  /** Gap length behind the ramp (0 = none). The gap itself is in `gaps`. */
  gap: number;
  /** Landing apron after the gap: height at the gap's far end (0 = none); slopes to 0 over LANDING_LENGTH. */
  landHeight: number;
}
/** Stretch of water or chasm (no ground) across the whole track width. */
export interface Gap {
  s0: number;
  s1: number;
  /**
   * 'water' (default; drawn as a pond), 'void' (a chasm: dark walls going down) or 'sky' (the long gap of a
   * mandatory cannon: no road mesh, no cut in the terrain, open air or a crater below).
   */
  kind: 'water' | 'void' | 'sky';
}
/** A bridge/viaduct section (distance along the track). */
export interface BridgeRange {
  s0: number;
  s1: number;
  /** Railings are drawn (decoration only; see BridgeDef.rails). */
  rails: boolean;
}
/** A stretch where the ground ends beside the road (see CliffDef). */
export interface CliffRange {
  s0: number;
  s1: number;
  side: 'left' | 'right' | 'both';
  /** Distance from the centerline where the ground ends (m). */
  edge: number;
}
/** Over the last this-many metres of a cliff the ground edge widens back out to the full off-road strip. */
export const CLIFF_TAPER = 6;
export interface BoostPad {
  s0: number;
  s1: number;
  d0: number;
  d1: number;
}

export class Track implements Ground {
  readonly samples: TrackSample[] = [];
  readonly length: number;
  /** Actual distance between samples (≈ SAMPLE_SPACING, divides the length evenly). */
  readonly spacing: number;
  /** s at each control point. */
  readonly controlS: number[] = [];
  readonly ramps: Ramp[] = [];
  readonly gaps: Gap[] = [];
  /** Bridge sections (no ground blending underneath, no off-road strip beside the road). */
  readonly bridges: BridgeRange[] = [];
  /** Cliff stretches (ground ends beside the road). */
  readonly cliffs: CliffRange[] = [];
  /** Height field around the road (flat 0 + legacy behaviour when the track has no terrain def). */
  readonly terrain: Terrain;
  readonly boostPads: BoostPad[] = [];
  /** s where each checkpoint segment starts; checkpoint 0 = start/finish line (s = 0). */
  readonly checkpoints: number[] = [];
  /** Where item boxes float (rows of three across the road). */
  readonly itemBoxes: Pick<ItemBox, 'x' | 'y' | 'z' | 's'>[] = [];
  /** Launch cannons with world positions (see sim/cannon.ts). */
  readonly cannons: ResolvedCannon[];
  /** Shortcut branch roads (route ids 1, 2, ...; see shortcuts.ts). Empty when the def has no shortcuts. */
  readonly branches: Branch[];

  /**
   * Every road on the track as polylines (main loop, plus shortcut branches once
   * those exist). Maps draw from this. See `routes.ts`.
   */
  get routes(): RouteLine[] {
    return (this._routes ??= [mainRoute(this), ...this.branches.map((b) => branchRoute(b))]);
  }
  private _routes: RouteLine[] | null = null;

  constructor(readonly def: TrackDef) {
    const ctrl: V3[] = def.points.map((p) => ({ x: p[0], y: p[2] ?? 0, z: p[1] }));
    const n = ctrl.length;

    // 1) Dense polyline through the spline, remembering s at each control point.
    const dense: V3[] = [];
    const denseS: number[] = [];
    const STEPS = 48;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const p0 = ctrl[(i - 1 + n) % n];
      const p1 = ctrl[i];
      const p2 = ctrl[(i + 1) % n];
      const p3 = ctrl[(i + 2) % n];
      for (let k = 0; k < STEPS; k++) {
        const p = catmullRom(p0, p1, p2, p3, k / STEPS);
        if (dense.length > 0) {
          const q = dense[dense.length - 1];
          acc += Math.hypot(p.x - q.x, p.z - q.z);
        }
        if (k === 0) this.controlS.push(acc);
        dense.push(p);
        denseS.push(acc);
      }
    }
    const last = dense[dense.length - 1];
    acc += Math.hypot(dense[0].x - last.x, dense[0].z - last.z);
    this.length = acc;

    // 2) Resample at even spacing.
    const count = Math.max(8, Math.round(this.length / SAMPLE_SPACING));
    const spacing = this.length / count;
    let j = 0;
    for (let k = 0; k < count; k++) {
      const s = k * spacing;
      while (j < dense.length - 1 && denseS[j + 1] < s) j++;
      const a = dense[j];
      const b = j + 1 < dense.length ? dense[j + 1] : dense[0];
      const sb = j + 1 < dense.length ? denseS[j + 1] : this.length;
      const u = sb > denseS[j] ? (s - denseS[j]) / (sb - denseS[j]) : 0;
      this.samples.push({
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        z: a.z + (b.z - a.z) * u,
        tx: 0,
        tz: 0,
        rx: 0,
        rz: 0,
        s,
        heading: 0,
        curvature: 0,
        bank: 0,
        width: def.width,
        wallLeft: false,
        wallRight: false,
      });
    }
    this.spacing = spacing;

    // 3) Tangents, headings, curvature.
    const S = this.samples;
    for (let k = 0; k < count; k++) {
      const prev = S[(k - 1 + count) % count];
      const next = S[(k + 1) % count];
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      Object.assign(S[k], { tx, tz, rx: -tz, rz: tx, heading: Math.atan2(tx, tz) });
    }
    for (let k = 0; k < count; k++) {
      const dh = wrapRad(S[(k + 1) % count].heading - S[(k - 1 + count) % count].heading);
      S[k].curvature = dh / (2 * spacing);
    }

    // 4) Banking from curvature, smoothed so it eases in and out of corners.
    const maxBank = (def.maxBankDeg * Math.PI) / 180;
    const raw = S.map((p) => Math.max(-maxBank, Math.min(maxBank, p.curvature * def.bankPerCurvature)));
    const R = Math.round(12 / spacing);
    for (let k = 0; k < count; k++) {
      let sum = 0;
      for (let o = -R; o <= R; o++) sum += raw[(k + o + count) % count];
      S[k].bank = sum / (2 * R + 1);
    }

    // 5) Walls.
    for (const w of def.walls) {
      this.forRange(this.sAt(w.from), this.sAt(w.to), (p) => {
        const outerLeft = p.curvature < 0; // turning right -> outside is the left
        if (w.side === 'left' || w.side === 'both' || (w.side === 'outer' && outerLeft)) p.wallLeft = true;
        if (w.side === 'right' || w.side === 'both' || (w.side === 'outer' && !outerLeft)) p.wallRight = true;
      });
    }

    // 5b) Shortcut branches (need the main samples and sAt; the terrain below blends toward them too).
    this.branches = buildBranches(this);

    // 6) Features.
    for (const r of def.ramps) {
      const s0 = this.sAt(r.at);
      const gap = r.gap ?? 0;
      const landing = gap > 0 && (r.landing ?? true);
      this.ramps.push({ s0, s1: s0 + r.length, height: r.height, shape: r.shape ?? 'kicker', gap, landHeight: landing ? landingHeight(r.height) : 0 });
      if (r.gap) this.gaps.push({ s0: s0 + r.length, s1: s0 + r.length + r.gap, kind: r.gapKind ?? 'water' });
    }
    // A drawbridge's opening is water (no road) in the static track; the hazard puts the leaves back (groundAt).
    for (const h of def.hazards ?? []) {
      if (h.kind !== 'drawbridge') continue;
      const mid = (this.sAt(h.from) + this.sAt(h.to)) / 2;
      const half = (h.gap ?? DRAWBRIDGE_GAP) / 2;
      this.gaps.push({ s0: mid - half, s1: mid + half, kind: 'water' });
    }
    // A mandatory cannon turns the main route between its mouth and landing into a 'sky' gap: the road ends
    // at the launch pad and starts again at the landing platform (see CannonDef.mandatory, sim/cannon.ts).
    for (const c of def.cannons ?? []) {
      if (c.mandatory) this.gaps.push({ s0: this.sAt(c.at) + CANNON.padAhead, s1: this.sAt(c.target.at) - CANNON.landBehind, kind: 'sky' });
    }
    const reach = def.width / 2 + def.offroadWidth;
    for (const b of def.bridges ?? []) this.bridges.push({ s0: this.sAt(b.from), s1: this.sAt(b.to), rails: b.rails ?? true });
    for (const c of def.cliffs ?? []) {
      const edge = c.edge ?? def.width / 2 + CURB_WIDTH + 2;
      this.cliffs.push({ s0: this.sAt(c.from), s1: this.sAt(c.to), side: c.side, edge });
    }

    // Terrain: active when the def asks for it or the track has bridges (they need ground to be above).
    const terrainOn = def.terrain !== undefined || this.bridges.length > 0;
    let field: RoadField | null = null;
    if (terrainOn) {
      // Segments touching a bridge are left out of the road blend: under a bridge the ground is natural.
      const onBridge = S.map((p) => this.onBridge(p.s));
      // (Same for the sky gap of a mandatory cannon: the ground under the flight stays natural, a crater or open sky.)
      const sky = S.map((p) => this.inSkyGap(p.s));
      const skip = onBridge.map((b, i) => b || onBridge[(i + 1) % count] || sky[i] || sky[(i + 1) % count]);
      const influence = reach + TERRAIN_SKIRT + (def.terrain?.blend ?? TERRAIN_BLEND);
      field = new RoadField(S, skip, influence, spacing);
    }
    // Shortcut roads shape the ground like the main road does.
    this.terrain = new Terrain(def.terrain, terrainOn, field && withBranchField(this, field, reach), reach, (hit) => this.roadLevel(hit));
    for (const b of def.boostPads) {
      const s0 = this.sAt(b.at);
      const c = (b.offset * def.width) / 2;
      this.boostPads.push({ s0, s1: s0 + b.length, d0: c - b.width / 2, d1: c + b.width / 2 });
    }
    for (let c = 0; c < def.checkpoints; c++) this.checkpoints.push((c * this.length) / def.checkpoints);
    this.placeItemBoxes();
    this.cannons = resolveCannons(this, def.cannons); // cannon agent: needs pointAt/sample, so it comes last
  }

  /**
   * Rows of 3 item boxes spread evenly around the lap, nudged out of the way of
   * the start line, jumps, water and boost pads.
   */
  private placeItemBoxes(): void {
    const rows = Math.max(3, Math.round(this.length / ITEMS.rowSpacing));
    const clear = (s: number): boolean => {
      if (this.deltaS(0, s) > -45 && this.deltaS(0, s) < 40) return false; // start/finish area
      for (const r of this.ramps) if (this.deltaS(r.s0 - 25, s) >= 0 && this.deltaS(s, r.s1 + 20) >= 0) return false;
      for (const g of this.gaps) if (this.deltaS(g.s0 - 25, s) >= 0 && this.deltaS(s, g.s1 + 25) >= 0) return false;
      for (const b of this.boostPads) if (this.deltaS(b.s0 - 10, s) >= 0 && this.deltaS(s, b.s1 + 10) >= 0) return false;
      return true;
    };
    for (let i = 0; i < rows; i++) {
      let s = ((i + 0.5) * this.length) / rows;
      // Slide forward in small steps until the spot is clear (bounded search).
      for (let tries = 0; tries < 40 && !clear(s); tries++) s = (s + 5) % this.length;
      if (!clear(s)) continue;
      for (const lateral of [-0.3, 0, 0.3]) {
        const p = this.pointAt(s, lateral * this.def.width);
        const ground = this.sample(p.x, p.z, p.index);
        if (!ground) continue;
        this.itemBoxes.push({ x: p.x, y: ground.height, z: p.z, s });
      }
    }
  }

  /** Control-point units (e.g. 3.5) -> distance along the track. */
  sAt(at: number): number {
    const n = this.controlS.length;
    const i = Math.floor(at);
    const f = at - i;
    const a = this.controlS[((i % n) + n) % n];
    let b = this.controlS[(((i + 1) % n) + n) % n];
    if (b < a) b += this.length;
    return (a + (b - a) * f) % this.length;
  }

  private forRange(s0: number, s1: number, fn: (p: TrackSample) => void): void {
    for (const p of this.samples) {
      const inRange = s0 <= s1 ? p.s >= s0 && p.s <= s1 : p.s >= s0 || p.s <= s1;
      if (inRange) fn(p);
    }
  }

  /** Signed distance along the loop from a to b, in (-L/2, L/2]. */
  deltaS(a: number, b: number): number {
    let d = (b - a) % this.length;
    if (d > this.length / 2) d -= this.length;
    if (d <= -this.length / 2) d += this.length;
    return d;
  }

  /**
   * Nearest point on the centerline. With a `hint` (sample index from last
   * frame) only nearby segments are searched – fast, and it keeps a kart on
   * "its" part of the track where the track passes close to itself.
   */
  project(x: number, z: number, hint = -1): Projection {
    // With shortcuts the hint also says which road the kart is on (see shortcuts.ts).
    if (this.branches.length > 0) return projectWithBranches(this, x, z, hint);
    const S = this.samples;
    const n = S.length;
    let best = Infinity;
    let bi = 0;
    let bu = 0;
    const test = (i: number) => {
      const a = S[i];
      const b = S[(i + 1) % n];
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
        bi = i;
        bu = u;
      }
    };
    if (hint >= 0) {
      for (let o = -12; o <= 12; o++) test((hint + o + n) % n);
      // Lost track of it (respawn, huge shortcut): fall back to a full search.
      if (best > 60 * 60) for (let i = 0; i < n; i++) test(i);
    } else {
      for (let i = 0; i < n; i++) test(i);
    }
    const a = S[bi];
    const b = S[(bi + 1) % n];
    const cx = a.x + (b.x - a.x) * bu;
    const cz = a.z + (b.z - a.z) * bu;
    const rx = a.rx + (b.rx - a.rx) * bu;
    const rz = a.rz + (b.rz - a.rz) * bu;
    const rl = Math.hypot(rx, rz) || 1;
    return {
      i: bi,
      route: 0,
      index: bi,
      s: (a.s + this.spacing * bu) % this.length,
      d: ((x - cx) * rx + (z - cz) * rz) / rl,
      y: a.y + (b.y - a.y) * bu,
      width: a.width + (b.width - a.width) * bu,
      bank: a.bank + (b.bank - a.bank) * bu,
    };
  }

  /** Extra height from banking at lateral offset d (the low edge stays at the base height). */
  static bankLift(bank: number, halfWidth: number, d: number): number {
    const t = Math.tan(Math.abs(bank));
    const dd = Math.max(-halfWidth, Math.min(halfWidth, d));
    return Math.max(0, t * (halfWidth + Math.sign(bank) * dd));
  }

  /**
   * Height of the ramp surface at distance s along the track (0 outside ramps).
   * Several ramps may touch or sit close together (chains): the highest one wins,
   * so there is no overlap bug at the seams. The landing apron after a gap counts too.
   */
  rampHeight(s: number): number {
    let best = 0;
    for (const r of this.ramps) {
      const len = r.s1 - r.s0;
      const into = this.deltaS(r.s0, s);
      if (into >= 0 && into <= len) best = Math.max(best, shapeHeight(r.shape, r.height, into / len));
      if (r.landHeight > 0) {
        const after = this.deltaS(r.s1 + r.gap, s);
        if (after >= 0 && after <= LANDING_LENGTH) best = Math.max(best, r.landHeight * (1 - after / LANDING_LENGTH));
      }
    }
    return best;
  }

  /** True if distance s along the track is over water. */
  inGap(s: number): boolean {
    for (const g of this.gaps) {
      const into = this.deltaS(g.s0, s);
      if (into >= 0 && into <= g.s1 - g.s0) return true;
    }
    return false;
  }

  /** True if distance s is inside the 'sky' gap of a mandatory cannon (a flight, not a road). */
  inSkyGap(s: number): boolean {
    for (const g of this.gaps) if (g.kind === 'sky' && this.within(s, g.s0, g.s1)) return true;
    return false;
  }

  /** True if distance s along the track is on a bridge. */
  onBridge(s: number): boolean {
    for (const b of this.bridges) if (this.within(s, b.s0, b.s1)) return true;
    return false;
  }

  /** True if s lies in the loop range [s0, s1] (handles wrap-around). */
  private within(s: number, s0: number, s1: number): boolean {
    const L = this.length;
    const into = (((s - s0) % L) + L) % L;
    return into <= (((s1 - s0) % L) + L) % L;
  }

  /**
   * Where the ground ends beside the road at distance s along the track: the
   * lateral distance (m) from the centerline beyond which there is no ground,
   * on the given side (-1 = left, +1 = right). Infinity = no cliff there.
   * Over the last CLIFF_TAPER metres at each end of a cliff the edge widens
   * back out to the edge of the off-road strip, so the ground doesn't vanish abruptly.
   */
  cliffEdgeAt(s: number, side: number): number {
    let edge = Infinity;
    if (this.cliffs.length === 0) return edge;
    const reach = this.def.width / 2 + this.def.offroadWidth;
    const L = this.length;
    for (const c of this.cliffs) {
      if (c.side !== 'both' && (c.side === 'left') !== side < 0) continue;
      const len = (((c.s1 - c.s0) % L) + L) % L;
      const into = (((s - c.s0) % L) + L) % L;
      if (into > len) continue;
      const t = Math.min(1, Math.min(into, len - into) / CLIFF_TAPER); // 0 at the ends, 1 inside
      const e = Math.min(c.edge, reach);
      edge = Math.min(edge, reach + (e - reach) * t);
    }
    return edge;
  }

  /** True where a cliff or a void gap removes the ground (water gaps are NOT counted). */
  isVoid(p: Pick<Projection, 's' | 'd' | 'width'>): boolean {
    const ad = Math.abs(p.d);
    if (this.cliffs.length && ad > this.cliffEdgeAt(p.s, p.d < 0 ? -1 : 1)) return true;
    if (ad <= p.width / 2 + this.def.offroadWidth + 1) {
      for (const g of this.gaps) {
        if (g.kind === 'void' && this.within(p.s, g.s0, g.s1)) return true;
      }
    }
    return false;
  }

  /**
   * Ground level at lateral offset d for a centerline height y and bank:
   * the banked road, then the off-road strip sloping from the road edge down to y.
   */
  static groundLevel(y: number, bank: number, halfWidth: number, d: number, offroadWidth: number): number {
    const ad = Math.abs(d);
    const lift = Track.bankLift(bank, halfWidth, d);
    if (ad <= halfWidth + CURB_WIDTH) return y + lift;
    const span = offroadWidth - CURB_WIDTH;
    const f = Math.min(1, (ad - halfWidth - CURB_WIDTH) / Math.max(0.1, span));
    return y + lift * (1 - f);
  }

  /** Road/strip level at a nearest-segment hit (what the terrain blends toward). */
  private roadLevel(hit: RoadHit): number {
    let level = this.roadLevelOf(hit);
    // Overlapping roads (shortcut fork / lip): never rise above any of them.
    if (hit.others) for (const o of hit.others) level = Math.min(level, this.roadLevelOf(o));
    return level;
  }

  private roadLevelOf(hit: RoadHit): number {
    const S = hit.route ? this.branches[hit.route - 1].samples : this.samples; // shortcut branches have their own samples
    const a = S[hit.i];
    const b = S[(hit.i + 1) % S.length];
    let y = a.y + (b.y - a.y) * hit.u;
    // A branch's kicker is built ON the ground: the terrain follows the ground level under it, not its top.
    if (hit.route) y -= this.branches[hit.route - 1].kickAt((hit.i + hit.u) * this.branches[hit.route - 1].spacing);
    const bank = a.bank + (b.bank - a.bank) * hit.u;
    const half = hit.route ? (a.width + (b.width - a.width) * hit.u) / 2 : this.def.width / 2;
    return Track.groundLevel(y, bank, half, hit.d, this.def.offroadWidth);
  }

  /**
   * Height and surface at a projected point (null = no ground: water, chasm or
   * beyond a cliff edge). Pass x/z so ground beyond the off-road strip (and
   * beside bridges) can come from the terrain height field.
   */
  surfaceAt(p: Projection, x?: number, z?: number): GroundHit | null {
    if (p.route > 0) return this.branchSurfaceAt(p, x, z);
    const hw = p.width / 2;
    const ad = Math.abs(p.d);
    const outer = hw + this.def.offroadWidth;
    if (this.gaps.length && ad <= outer + 1 && this.inGap(p.s)) return null;
    if (this.cliffs.length && ad > this.cliffEdgeAt(p.s, p.d < 0 ? -1 : 1)) return null;
    const edgeLift = Track.bankLift(p.bank, hw, p.d);
    let surface: Surface;
    let height: number;
    if (ad <= hw + CURB_WIDTH) {
      surface = 'road';
      height = p.y + edgeLift + (ad <= hw ? this.rampHeight(p.s) : 0);
      for (const b of this.boostPads) {
        const into = this.deltaS(b.s0, p.s);
        if (into >= 0 && into <= b.s1 - b.s0 && p.d >= b.d0 && p.d <= b.d1) surface = 'boost';
      }
    } else {
      surface = 'offroad';
      // Beyond the strip, and beside a bridge (no strip there), the ground is the terrain.
      if (this.terrain.enabled && x !== undefined && z !== undefined && (ad > outer || this.onBridge(p.s))) {
        height = this.terrain.height(x, z);
      } else {
        // The off-road strip slopes from the road edge back down to the terrain.
        height = Track.groundLevel(p.y, p.bank, hw, p.d, this.def.offroadWidth);
      }
    }
    return { height, surface };
  }

  /**
   * Ground on a shortcut branch: banked road (a dirt branch counts as 'offroad' for speed),
   * then the off-road strip, then the terrain. No ramps, gaps, cliffs or bridges here.
   */
  private branchSurfaceAt(p: Projection, x?: number, z?: number): GroundHit | null {
    const hw = p.width / 2;
    const ad = Math.abs(p.d);
    const br = this.branches[p.route - 1];
    if (ad <= hw + CURB_WIDTH) {
      const dirt = br.isDirt(p.i);
      return { height: p.y + Track.bankLift(p.bank, hw, p.d), surface: dirt ? 'offroad' : 'road' };
    }
    const height =
      this.terrain.enabled && x !== undefined && z !== undefined && ad > hw + this.def.offroadWidth
        ? this.terrain.height(x, z)
        : Track.groundLevel(p.y - br.kickAt(((p.s - br.s0 + this.length) % this.length) * (br.length / br.span)), p.bank, hw, p.d, this.def.offroadWidth);
    return { height, surface: 'offroad' };
  }

  /** Ground interface (vertical raycast). Off the road: the terrain height field (flat 0 by default). */
  sample(x: number, z: number, hint = -1): (GroundHit & { index: number }) | null {
    const p = this.project(x, z, hint);
    const hit = this.surfaceAt(p, x, z);
    return hit ? { ...hit, index: p.index } : null;
  }

  /** Safe spot on the centerline at distance s (for respawns). */
  pointAt(s: number, lateral = 0): { x: number; y: number; z: number; heading: number; index: number } {
    const n = this.samples.length;
    const i = ((Math.floor(s / this.spacing) % n) + n) % n;
    const p = this.samples[i];
    return { x: p.x + p.rx * lateral, y: p.y, z: p.z + p.rz * lateral, heading: p.heading, index: i };
  }

  /** Lateral position of the wall on each side (m from centerline), or null if no wall here. */
  wallsAt(i: number, route = 0): { left: number | null; right: number | null } {
    const p = this.sampleOf(route, i);
    // On a bridge there is no off-road strip (the ground ends at the deck edge), so a parapet stands AT the edge.
    const off = p.width / 2 + (route === 0 && this.onBridge(p.s) ? CURB_WIDTH : this.def.offroadWidth);
    if (route > 0) return { left: p.wallLeft ? -off : null, right: p.wallRight ? off : null }; // branches: no cliffs
    // A wall on a cliff side stands at the cliff edge (a guard rail) instead of floating over the drop.
    const left = Math.min(off, this.cliffEdgeAt(p.s, -1));
    const right = Math.min(off, this.cliffEdgeAt(p.s, 1));
    return { left: p.wallLeft ? -left : null, right: p.wallRight ? right : null };
  }

  /** Sample `i` of road `route` (0 = main loop, 1+ = shortcut branches). */
  sampleOf(route: number, i: number): TrackSample {
    return route > 0 ? this.branches[route - 1].samples[i] : this.samples[i];
  }

  /** Which road a kart is on, from its `trackIndex`: 0 = main loop, 1+ = shortcut branch. */
  onRoute(k: { trackIndex: number }): number {
    return k.trackIndex >= 0 ? Math.floor(k.trackIndex / ROUTE_STRIDE) : 0;
  }

  /** Like `project`, but only against the main road (e.g. a bot that wants to ignore a branch). */
  projectOnMain(x: number, z: number, hintIdx = -1): Projection {
    return projectOnMain(this, x, z, hintIdx);
  }

  /** The centerline sample `k` steps ahead of a position on a road, following branches back onto the main road. */
  sampleAhead(route: number, i: number, k: number): TrackSample {
    return sampleAhead(this, route, i, k);
  }

  /** World position and heading for a starting-grid slot (0 = pole). */
  gridSpot(index: number): { x: number; z: number; heading: number } {
    const s = this.length - 9 - index * 6;
    const k = Math.floor(s / this.spacing) % this.samples.length;
    const a = this.samples[k];
    const side = index % 2 === 0 ? -1 : 1; // pole on the left
    const lateral = side * this.def.width * 0.22;
    return { x: a.x + a.rx * lateral, z: a.z + a.rz * lateral, heading: a.heading };
  }
}
