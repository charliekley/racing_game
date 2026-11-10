/**
 * Meshes for jump ramps: kicker (yellow wedge), hump (orange mound), double (pink pair of
 * wedges) and the landing apron (green) behind a gap.
 *
 * Draw calls stay low: every piece is appended to one of a few "accumulators" (one per
 * material) and each accumulator becomes ONE mesh, no matter how many ramps the track has.
 * Colours are bold on purpose so a ramp reads from the chase camera 40 m away.
 *
 * The surfaces are computed from the same formulas the physics uses (`shapeHeight`,
 * `landHeight`), so what you see is what you drive on.
 */
import * as THREE from 'three';
import { LANDING_LENGTH, shapeHeight } from '../sim/jumps';
import { Track, type TrackSample } from '../sim/track';
import { rampTexture } from './textures';

/** A row of a strip: two vertices (left, right) and a texture V coordinate. */
interface Row {
  l: THREE.Vector3;
  r: THREE.Vector3;
  v: number;
}

/** Collects triangles that share a material; `build()` turns them into a single mesh. */
class Accumulator {
  private pos: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];
  private count = 0;

  /** A quad strip: consecutive rows are joined by two triangles each. */
  strip(rows: Row[]): void {
    const base = this.count;
    for (const row of rows) {
      this.pos.push(row.l.x, row.l.y, row.l.z, row.r.x, row.r.y, row.r.z);
      this.uv.push(0, row.v, 1, row.v);
      this.count += 2;
    }
    for (let i = 0; i < rows.length - 1; i++) {
      const k = base + i * 2;
      this.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  build(mat: THREE.Material, castShadow: boolean): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = castShadow;
    m.receiveShadow = true;
    return m;
  }
}

/** Centerline sample interpolated at distance s (wraps around the loop). */
function sampleAt(track: Track, s: number): TrackSample {
  const n = track.samples.length;
  const f = (((s % track.length) + track.length) % track.length) / track.spacing;
  const i = Math.floor(f) % n;
  const u = f - Math.floor(f);
  const a = track.samples[i];
  const b = track.samples[(i + 1) % n];
  const lerp = (x: number, y: number) => x + (y - x) * u;
  return { ...a, x: lerp(a.x, b.x), y: lerp(a.y, b.y), z: lerp(a.z, b.z), rx: lerp(a.rx, b.rx), rz: lerp(a.rz, b.rz), bank: lerp(a.bank, b.bank) };
}

type Kind = 'kicker' | 'hump' | 'double' | 'apron';

/** One surface piece of a ramp: a wedge (linear rise, then a drop), a mound (smooth cosine) or the landing apron. */
interface Piece {
  s0: number;
  s1: number;
  /** Surface height (m above the road) at a fraction 0..1 into the piece. */
  height: (u: number) => number;
  /** Does the surface end in a vertical drop (wedge)? Mounds fade out to 0 instead. */
  drop: boolean;
  kind: Kind;
}

/** [base, stripe] colours per kind: yellow/black, orange/brown, pink/dark, green/dark. */
const COLORS: Record<Kind, [string, string]> = {
  kicker: ['#f6c515', '#1c1c1c'],
  hump: ['#ff7a1a', '#2a1608'],
  double: ['#ff3d9a', '#2a0a1c'],
  apron: ['#3fd17a', '#0e3a22'],
};

/** Builds the group with every ramp (and landing apron) of the track: one mesh per colour kind, one for the sides, one for chasm floors. */
export function buildRamps(track: Track): THREE.Group {
  const group = new THREE.Group();
  if (track.ramps.length === 0) return group;
  const hw = track.def.width / 2;
  const tops = new Map<Kind, Accumulator>();
  const sides = new Accumulator(); // skirts along the edges and the vertical drop faces: dark, solid-looking
  const top = (kind: Kind) => {
    if (!tops.has(kind)) tops.set(kind, new Accumulator());
    return tops.get(kind)!;
  };
  /** World point at lateral offset d, `up` metres above the (banked) road. */
  const point = (p: TrackSample, d: number, up: number) => new THREE.Vector3(p.x + p.rx * d, p.y + Track.bankLift(p.bank, hw, d) + up, p.z + p.rz * d);

  const addPiece = (piece: Piece) => {
    const len = piece.s1 - piece.s0;
    const step = piece.kind === 'hump' ? 1 : 2; // mounds need more rows to look round
    const rows = Math.max(1, Math.ceil(len / step));
    const surface: Row[] = [];
    const left: Row[] = [];
    const right: Row[] = [];
    for (let k = 0; k <= rows; k++) {
      const u = k / rows;
      const p = sampleAt(track, piece.s0 + len * u);
      const h = piece.height(u) + 0.03;
      const v = (len * u) / 3;
      surface.push({ l: point(p, -hw, h), r: point(p, hw, h), v });
      // Side skirts: vertical strips from the surface down to the road.
      left.push({ l: point(p, -hw, h), r: point(p, -hw, 0), v });
      right.push({ l: point(p, hw, 0), r: point(p, hw, h), v });
    }
    top(piece.kind).strip(surface);
    sides.strip(left);
    sides.strip(right);
    if (piece.drop) {
      // Vertical face at the end: from the lip down to the road.
      const p = sampleAt(track, piece.s1);
      const h = piece.height(1) + 0.03;
      sides.strip([
        { l: point(p, -hw, h), r: point(p, hw, h), v: 0 },
        { l: point(p, -hw, 0), r: point(p, hw, 0), v: 1 },
      ]);
    }
  };

  for (const r of track.ramps) {
    const len = r.s1 - r.s0;
    const wedge = (u: number) => shapeHeight('kicker', r.height, u);
    if (r.shape === 'hump') {
      addPiece({ s0: r.s0, s1: r.s1, height: (u) => shapeHeight('hump', r.height, u), drop: false, kind: 'hump' });
    } else if (r.shape === 'double') {
      // Two wedges, each a kicker of half the length, with a dip between them.
      const mid = r.s0 + len / 2;
      addPiece({ s0: r.s0, s1: mid, height: wedge, drop: true, kind: 'double' });
      addPiece({ s0: mid, s1: r.s1, height: wedge, drop: true, kind: 'double' });
    } else {
      addPiece({ s0: r.s0, s1: r.s1, height: wedge, drop: true, kind: 'kicker' });
    }
    if (r.landHeight > 0) {
      // Landing apron: starts at the far edge of the gap, slopes gently down to the road.
      const a = r.s1 + r.gap;
      addPiece({ s0: a, s1: a + LANDING_LENGTH, height: (u) => r.landHeight * (1 - u), drop: false, kind: 'apron' });
      // Its front face (toward the gap) goes down to the road so the apron reads as solid.
      const p = sampleAt(track, a);
      const h = r.landHeight + 0.03;
      sides.strip([
        { l: point(p, -hw, h), r: point(p, hw, h), v: 0 },
        { l: point(p, -hw, 0), r: point(p, hw, 0), v: 1 },
      ]);
    }
  }

  for (const [kind, acc] of tops) {
    const [base, stripe] = COLORS[kind];
    group.add(acc.build(new THREE.MeshStandardMaterial({ map: rampTexture(base, stripe), roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }), true));
  }
  if (!sides.isEmpty) group.add(sides.build(new THREE.MeshStandardMaterial({ color: '#6b7078', roughness: 0.45, metalness: 0.5, side: THREE.DoubleSide }), true));

  return group;
}
