/**
 * The eight drivers. Each is built as three rigid pieces (torso, head, arm) so
 * the animation code can lean the torso, turn the head and aim the arms
 * without any skinning. Every piece is ONE vertex-coloured geometry that uses
 * the shared "detail" material.
 *
 * Driver space: origin at the hip (sitting point), +Z forward, Y up.
 *  - torso piece : origin = hip
 *  - head piece  : origin = neck; the head centre is about (0, 0.28, 0.03)
 *  - arm piece   : origin = shoulder, hand at (0, 0, ARM_LEN) (the right arm; the left is mirrored)
 * Shapes are rounded ellipsoids, capsules and cones, toy-like with big heads.
 */
import * as THREE from 'three';
import type { DriverLook } from '../../shared/characters';
import { PartBuilder, SURF, capsule, lathe, mix, roundBox, roundCone, shade, sphere, sweep, type Place, type Surf, type V3 } from './geo';
import { FACE_POSES, NEUTRAL_POSE, addFace, ellipsoidZ, type FacePose, type FaceSpec } from './face';

export const ARM_LEN = 0.5;
/** Pivot positions in driver space. */
export const NECK: V3 = [0, 0.44, 0.0];
export const SHOULDER_R: V3 = [0.17, 0.4, 0.03];

export interface DriverGeometries {
  torso: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
}

const EYE_WHITE = '#fbfbf6';
const EYE_DARK = '#1b1a22';

/** Small helper bundle so species code reads like a description of the character. */
export class Piece {
  readonly b = new PartBuilder();
  // Three ellipsoid qualities: big shapes (heads, bellies) need many segments to look round.
  private readonly sphBig = sphere(26, 18);
  private readonly sph = sphere(16, 12);
  private readonly sphLo = sphere(8, 6);
  /**
   * Sphere quality for a part. `lo` = true/'low' forces the coarse sphere, 'mid' forces the medium one
   * (face parts use it so their vertex count never depends on the pose), otherwise it is chosen by size.
   */
  private pick(r: V3, lo: boolean | 'low' | 'mid') {
    if (lo === 'mid') return this.sph;
    const m = Math.max(r[0], r[1], r[2]);
    if (m >= 0.17 && !lo) return this.sphBig;
    return lo || m < 0.06 ? this.sphLo : this.sph;
  }

  /** Ellipsoid at p with radii r. */
  e(p: V3, r: V3 | number, color: string, surf: Surf = SURF.fur, rot: V3 = [0, 0, 0], lo: boolean | 'low' | 'mid' = false): this {
    const radii: V3 = typeof r === 'number' ? [r, r, r] : r;
    this.b.part(this.pick(radii, lo), { p, r: rot, s: radii }, color, surf);
    return this;
  }
  /** Mirrored ellipsoid pair (x -> -x). */
  ep(p: V3, r: V3 | number, color: string, surf: Surf = SURF.fur, rot: V3 = [0, 0, 0], lo = false): this {
    const radii: V3 = typeof r === 'number' ? [r, r, r] : r;
    this.b.partPair(this.pick(radii, lo), { p, r: rot, s: radii }, color, surf);
    return this;
  }
  /** Rounded cone (base at p, pointing along the local +Y rotated by rot). */
  cone(p: V3, r: number, h: number, color: string, rot: V3 = [0, 0, 0], pair = false, surf: Surf = SURF.fur, bulge = 0.85): this {
    const g = roundCone(r, h, 14, bulge);
    if (pair) this.b.partPair(g, { p, r: rot }, color, surf);
    else this.b.part(g, { p, r: rot }, color, surf);
    return this;
  }
  /** Eye: white ball, coloured iris, pupil and a bright highlight. `look` offsets the pupil. */
  eye(x: number, y: number, z: number, r: number, opts: { iris?: string; pupil?: number; slant?: number; glow?: boolean } = {}): this {
    const side = Math.sign(x) || 1;
    this.e([x, y, z], [r, r * 1.12, r * 0.75], EYE_WHITE, SURF.eye, [0, 0, (opts.slant ?? 0) * side]);
    const pr = r * (opts.pupil ?? 0.62);
    if (opts.iris) this.e([x + side * 0.0, y - r * 0.02, z + r * 0.3], [pr * 1.05, pr * 1.15, pr * 0.6], opts.iris, SURF.eye);
    this.e([x, y - r * 0.03, z + r * 0.42], [pr * 0.62, pr * 0.78, pr * 0.4], EYE_DARK, SURF.eye);
    this.e([x - side * r * 0.2 + r * 0.12, y + r * 0.3, z + r * 0.62], [r * 0.2, r * 0.22, r * 0.12], '#ffffff', SURF.glow, [0, 0, 0], true);
    return this;
  }
  /** Smooth curved line (mouth, brow, whisker): a thin tube through points. */
  line(points: V3[], r: number, color: string, surf: Surf = SURF.matte, pair = false): this {
    const g = sweep(points, r, Math.max(8, points.length * 6), 6);
    const cap = this.sphLo;
    if (pair) {
      this.b.partPair(g, {}, color, surf);
      this.b.partPair(cap, { p: points[0], s: r }, color, surf);
      this.b.partPair(cap, { p: points[points.length - 1], s: r }, color, surf);
    } else {
      this.b.part(g, {}, color, surf);
      this.b.part(cap, { p: points[0], s: r }, color, surf);
      this.b.part(cap, { p: points[points.length - 1], s: r }, color, surf);
    }
    return this;
  }
  rbox(p: V3, size: V3, r: number, color: string, surf: Surf = SURF.plastic, rot: V3 = [0, 0, 0]): this {
    this.b.part(roundBox(size[0], size[1], size[2], r), { p, r: rot }, color, surf);
    return this;
  }
  build(): THREE.BufferGeometry {
    return this.b.build().detail!;
  }
}

interface Palette {
  P: string;
  S: string;
  /** Darker primary (shadows, shoes, inner ears). */
  D: string;
  /** Lighter primary. */
  L: string;
}

export type Species = DriverLook['species'];

interface SpeciesBuild {
  torso: (p: Piece, c: Palette) => void;
  /** The head WITHOUT eyes, brows and mouth (those come from `face`, so they can change shape). */
  head: (p: Piece, c: Palette) => void;
  /** Where the eyes, brows and mouth go (see face.ts). */
  face: (c: Palette) => FaceSpec;
  /** Arm colours: sleeve, hand. */
  arm: (c: Palette) => { sleeve: string; hand: string; glove?: boolean; surf?: Surf };
}

/** Shared body: egg-shaped torso, belly patch, seated legs with shoes. */
function baseBody(p: Piece, o: { body: string; belly?: string; pants?: string; shoes: string; w?: number; round?: number }): void {
  const w = o.w ?? 1;
  const rd = o.round ?? 1;
  // Torso egg: wider at the bottom.
  p.e([0, 0.22, 0], [0.2 * w, 0.25, 0.19 * w], o.body);
  p.e([0, 0.1, 0.0], [0.22 * w * rd, 0.16, 0.2 * w * rd], o.body);
  if (o.belly) p.e([0, 0.2, 0.12 * w], [0.14 * w, 0.17, 0.105], o.belly);
  // Legs: thighs forward, shoes at the pedals.
  const legColor = o.pants ?? o.body;
  for (const sx of [1, -1]) {
    const a: V3 = [0.1 * sx, 0.06, 0.04];
    const k: V3 = [0.11 * sx, 0.1, 0.34];
    p.b.part(sweep([a, [(a[0] + k[0]) / 2, 0.1, 0.19], k], 0.074, 14, 10), {}, legColor, SURF.fur);
    p.e(k, 0.077, legColor, SURF.fur, [0, 0, 0], true);
    p.e([0.11 * sx, 0.03, 0.44], [0.085, 0.06, 0.13], o.shoes, SURF.gloss, [0, 0, 0], true);
    p.e([0.11 * sx, 0.075, 0.4], [0.065, 0.075, 0.08], legColor, SURF.fur, [0, 0, 0], true);
  }
}

/** Head ball (an ellipsoid) in head space. */
const HEAD_C: V3 = [0, 0.28, 0.03];

const SPECIES: Record<Species, SpeciesBuild> = {
  // --- CHICK ------------------------------------------------------------------------
  chick: {
    torso(p, c) {
      baseBody(p, { body: c.P, belly: c.L, shoes: c.S, w: 1.0 });
      // Tail feathers.
      p.cone([0, 0.18, -0.15], 0.06, 0.22, c.D, [-1.9, 0, 0]);
      p.cone([0.07, 0.2, -0.14], 0.05, 0.18, c.P, [-1.9, 0.0, -0.5]);
      p.cone([-0.07, 0.2, -0.14], 0.05, 0.18, c.P, [-1.9, 0.0, 0.5]);
    },
    head(p, c) {
      p.e(HEAD_C, [0.31, 0.28, 0.28], c.P);
      // Cheek blush, beak and a little tuft.
      p.ep([0.2, 0.2, 0.2], [0.06, 0.04, 0.03], '#ff9aa8', SURF.matte, [0, 0.5, 0]);
      p.e([0, 0.26, 0.32], [0.075, 0.04, 0.09], c.S, SURF.gloss);
      p.e([0, 0.225, 0.3], [0.062, 0.028, 0.075], shade(c.S, 0.85), SURF.gloss);
      p.cone([0, 0.5, 0.02], 0.045, 0.17, c.P, [0.4, 0, 0]);
      p.cone([0.03, 0.5, 0.02], 0.04, 0.14, c.L, [0.35, 0, -0.5]);
      p.cone([-0.03, 0.5, 0.02], 0.04, 0.14, c.L, [0.35, 0, 0.5]);
    },
    face: (c) => ({
      eye: { x: 0.115, y: 0.34, z: 0.235, r: 0.09 },
      white: EYE_WHITE, pupil: EYE_DARK, pupilK: 0.5, lid: c.P,
      brow: { color: c.D, maxY: 0.5, liftK: 0.6, surfZ: ellipsoidZ(HEAD_C, [0.31, 0.28, 0.28]) },
      mouth: { y: 0.15, w: 0.06, color: shade(c.S, 0.5), inside: '#7a2a1c', surfZ: ellipsoidZ(HEAD_C, [0.31, 0.28, 0.28]) },
    }),
    arm: (c) => ({ sleeve: c.P, hand: c.S }),
  },

  // --- CAT --------------------------------------------------------------------------
  cat: {
    torso(p, c) {
      baseBody(p, { body: c.P, belly: c.L, shoes: c.S });
      // Curled tail rising behind the seat with a pink tip.
      p.b.part(sweep([[0, 0.1, -0.17], [0, 0.07, -0.38], [0, 0.22, -0.5], [0.02, 0.45, -0.44]], (t) => 0.05 - 0.018 * t, 16, 8), {}, c.P, SURF.fur);
      p.e([0.02, 0.46, -0.43], 0.045, c.S, SURF.fur);
      p.e([0.01, 0.3, -0.49], [0.052, 0.03, 0.052], '#b8a99a', SURF.fur);
    },
    head(p, c) {
      p.e(HEAD_C, [0.32, 0.26, 0.26], c.P);
      // Triangular ears with pink insides.
      p.cone([0.17, 0.4, -0.02], 0.1, 0.2, c.P, [0.1, 0, -0.3], true);
      p.cone([0.17, 0.41, 0.0], 0.065, 0.15, c.S, [0.2, 0, -0.3], true, SURF.matte);
      // Forehead stripes and cheeks.
      for (const dx of [-0.06, 0, 0.06]) p.e([dx, 0.5, 0.15], [0.017, 0.045, 0.012], '#b4a79a', SURF.matte, [0.9, 0, dx * -3]);
      p.ep([0.2, 0.19, 0.2], [0.07, 0.045, 0.05], c.L, SURF.fur);
      // Nose and whiskers (the eyes and mouth come from the face).
      p.e([0, 0.255, 0.283], [0.03, 0.022, 0.02], c.S, SURF.gloss);
      p.line([[0, 0.24, 0.285], [0, 0.215, 0.285]], 0.005, '#8a7f78');
      for (const [dy, dz] of [[0.03, 0.04], [0, 0.0], [-0.03, -0.05]] as const) {
        p.line([[0.1, 0.22 + dy * 0.3, 0.27], [0.22, 0.22 + dy, 0.27 + dz * 0.5], [0.34, 0.22 + dy * 2, 0.22 + dz]], 0.004, '#fbfbfb', SURF.matte, true);
      }
    },
    face: (c) => ({
      eye: { x: 0.12, y: 0.31, z: 0.235, r: 0.077 },
      white: EYE_WHITE, iris: '#46b86f', pupil: EYE_DARK, pupilK: 0.42, slit: 0.4, lid: c.P,
      brow: { color: '#7a6d64', maxY: 0.47, surfZ: ellipsoidZ(HEAD_C, [0.32, 0.26, 0.26]) },
      mouth: { y: 0.2, w: 0.07, color: '#8a7f78', inside: '#7a2a3a', surfZ: ellipsoidZ(HEAD_C, [0.32, 0.26, 0.26]) },
    }),
    arm: (c) => ({ sleeve: c.P, hand: c.P }),
  },

  // --- FROG -------------------------------------------------------------------------
  frog: {
    torso(p, c) {
      baseBody(p, { body: c.P, belly: c.S, shoes: c.D, w: 1.0, round: 1.08 });
      // Back spots.
      p.e([0.1, 0.33, -0.16], [0.045, 0.045, 0.02], c.D, SURF.fur, [0.4, 0, 0], true);
      p.e([-0.08, 0.2, -0.18], [0.04, 0.04, 0.02], c.D, SURF.fur, [0.4, 0, 0], true);
    },
    head(p, c) {
      p.e([0, 0.23, 0.03], [0.34, 0.22, 0.27], c.P);
      // Eye bulges up on top of the head (the eyeball itself comes from the face).
      for (const sx of [1, -1]) p.e([0.16 * sx, 0.44, 0.07], 0.115, c.P);
      // Nostrils, cheeks, head spots.
      p.ep([0.06, 0.255, 0.285], [0.014, 0.01, 0.01], '#27543a', SURF.matte, [0, 0, 0], true);
      p.ep([0.22, 0.2, 0.18], [0.06, 0.04, 0.03], '#ff9fb0', SURF.matte, [0, 0.6, 0], true);
      p.ep([0.08, 0.38, 0.19], [0.035, 0.02, 0.03], c.D, SURF.fur, [0.3, 0, 0], true);
    },
    face: (c) => ({
      eye: { x: 0.16, y: 0.47, z: 0.15, r: 0.092 },
      white: EYE_WHITE, pupil: EYE_DARK, pupilK: 0.58, zk: 0.76, lid: c.P,
      brow: { color: '#27543a', maxY: 0.545, liftK: 0.7, surfZ: ellipsoidZ([0.16, 0.44, 0.07], [0.115, 0.115, 0.115]) },
      mouth: { y: 0.16, w: 0.19, color: '#27543a', inside: '#4a1a24', surfZ: ellipsoidZ([0, 0.23, 0.03], [0.34, 0.22, 0.27]) },
    }),
    arm: (c) => ({ sleeve: c.P, hand: c.S }),
  },

  // --- ASTRONAUT ----------------------------------------------------------------------
  astronaut: {
    torso(p, c) {
      baseBody(p, { body: c.P, belly: undefined, pants: c.P, shoes: c.S, w: 1.02 });
      // Chest control panel with buttons, belt and backpack.
      p.rbox([0, 0.27, 0.17], [0.17, 0.12, 0.04], 0.02, c.S, SURF.gloss, [-0.2, 0, 0]);
      p.e([-0.04, 0.28, 0.197], 0.012, '#ff5a4a', SURF.glow, [0, 0, 0], true);
      p.e([0.0, 0.28, 0.2], 0.012, '#ffd84a', SURF.glow, [0, 0, 0], true);
      p.e([0.04, 0.28, 0.197], 0.012, '#6fe0ff', SURF.glow, [0, 0, 0], true);
      p.b.part(lathe([[0.215, 0.0], [0.225, 0.02], [0.225, 0.06], [0.215, 0.08]], 20), { p: [0, 0.12, 0] }, c.S, SURF.gloss);
      p.rbox([0, 0.28, -0.25], [0.3, 0.38, 0.17], 0.07, shade(c.P, 0.82), SURF.plastic);
      p.rbox([0, 0.28, -0.335], [0.2, 0.3, 0.03], 0.012, c.S, SURF.gloss);
      p.e([0.0, 0.52, -0.25], [0.04, 0.05, 0.04], '#ff5a4a', SURF.glow, [0, 0, 0], true);
    },
    head(p, c) {
      // Big glossy helmet, dark visor with a bright rim, ear modules and an antenna.
      p.e([0, 0.3, 0.0], 0.34, c.P, SURF.gloss);
      p.e([0, 0.3, 0.19], [0.255, 0.21, 0.17], '#17284a', SURF.glass);
      // Visor rim: thin torus-like ring made of a sweep around the visor outline.
      // Find where the visor ellipsoid meets the helmet sphere (numerically) and lay a ring along that curve.
      const rim: V3[] = [];
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        let lo = 0;
        let hi = 1.2;
        for (let k = 0; k < 24; k++) {
          const sc = (lo + hi) / 2;
          const x = Math.cos(a) * 0.255 * sc;
          const y = Math.sin(a) * 0.21 * sc;
          const z = Math.sqrt(Math.max(0, 0.34 * 0.34 - x * x - y * y));
          const f = (x / 0.255) ** 2 + (y / 0.21) ** 2 + ((z - 0.19) / 0.17) ** 2 - 1;
          if (f < 0) lo = sc;
          else hi = sc;
        }
        const x = Math.cos(a) * 0.255 * lo;
        const y = Math.sin(a) * 0.21 * lo;
        rim.push([x, 0.3 + y, Math.sqrt(Math.max(0, 0.34 * 0.34 - x * x - y * y))]);
      }
      p.b.part(sweep(rim, 0.016, 28, 6, true), {}, c.S, SURF.gloss);
      // (Friendly eyes, brows and a mouth are drawn on the visor by the face.)
      // Visor gloss streak.
      p.e([0.14, 0.4, 0.31], [0.07, 0.015, 0.03], '#ffffff', SURF.glow, [0.2, 0.5, -0.5], true);
      // Ear modules and a bobble antenna.
      for (const sx of [1, -1]) {
        p.b.part(lathe([[0, -0.05], [0.07, -0.05], [0.07, 0.05], [0, 0.05]], 14), { p: [0.335 * sx, 0.3, 0.0], r: [0, 0, Math.PI / 2 * -sx] }, c.S, SURF.gloss);
      }
      p.line([[0.08, 0.6, -0.12], [0.1, 0.7, -0.15], [0.12, 0.78, -0.16]], 0.012, '#c8ced8', SURF.metal);
      p.e([0.12, 0.8, -0.16], 0.036, '#ff5a4a', SURF.glow, [0, 0, 0], true);
      // Neck seal ring.
      p.b.part(lathe([[0.15, -0.02], [0.18, -0.01], [0.18, 0.04], [0.15, 0.05]], 20), {}, c.S, SURF.gloss);
    },
    face: () => {
      const visor = ellipsoidZ([0, 0.3, 0.19], [0.255, 0.21, 0.17]);
      return {
        eye: { x: 0.095, y: 0.31, z: 0.335, r: 0.052 },
        white: '#d8f4ff', whiteSurf: SURF.glow, pupil: '#0b1220', pupilK: 0.52, zk: 0.4, lid: '#17284a',
        brow: { color: '#d8f4ff', surf: SURF.glow, thick: 0.12, maxY: 0.46, surfZ: visor },
        mouth: { y: 0.195, w: 0.06, color: '#d8f4ff', surf: SURF.glow, inside: '#0b1220', tongue: '#ff8aa0', surfZ: visor },
      };
    },
    arm: (c) => ({ sleeve: c.P, hand: c.S, glove: true, surf: SURF.plastic }),
  },

  // --- ROBOT ------------------------------------------------------------------------
  robot: {
    torso(p, c) {
      const metal = c.P;
      p.rbox([0, 0.24, 0.0], [0.4, 0.48, 0.34], 0.12, metal, SURF.metal);
      p.rbox([0, 0.09, 0.0], [0.44, 0.2, 0.38], 0.09, shade(metal, 0.82), SURF.metal);
      p.b.part(lathe([[0.2, 0.18], [0.215, 0.19], [0.215, 0.215], [0.2, 0.225]], 20), {}, '#33363d', SURF.plastic);
      // Chest plate with a glowing core.
      p.rbox([0, 0.28, 0.16], [0.2, 0.2, 0.05], 0.04, c.S, SURF.gloss, [-0.15, 0, 0]);
      p.e([0, 0.28, 0.19], [0.06, 0.06, 0.025], '#fffbd6', SURF.glow, [0, 0, 0], true);
      p.rbox([0, 0.34, -0.2], [0.26, 0.3, 0.12], 0.04, shade(metal, 0.7), SURF.metal);
      // Legs: plain capsules + boots.
      for (const sx of [1, -1]) {
        p.b.part(sweep([[0.1 * sx, 0.06, 0.04], [0.105 * sx, 0.1, 0.19], [0.11 * sx, 0.1, 0.34]], 0.07, 10, 8), {}, shade(metal, 0.85), SURF.metal);
        p.e([0.11 * sx, 0.035, 0.44], [0.085, 0.06, 0.13], c.S, SURF.gloss, [0, 0, 0], true);
        p.e([0.11 * sx, 0.1, 0.35], 0.08, '#33363d', SURF.metal, [0, 0, 0], true);
      }
    },
    head(p, c) {
      p.b.part(roundBox(0.52, 0.4, 0.44, 0.13), { p: [0, 0.27, 0.0] }, c.P, SURF.metal);
      // Dark screen; the glowing eyes, brows and mouth are drawn on it by the face.
      p.rbox([0, 0.28, 0.185], [0.42, 0.28, 0.1], 0.06, '#0d1219', SURF.gloss);
      // Ear discs, neck and antenna.
      for (const sx of [1, -1]) {
        p.b.part(lathe([[0, -0.03], [0.065, -0.03], [0.065, 0.03], [0, 0.03]], 14), { p: [0.27 * sx, 0.27, 0.0], r: [0, 0, Math.PI / 2 * -sx] }, shade(c.P, 0.7), SURF.metal);
        p.b.part(lathe([[0, 0.028], [0.04, 0.03], [0.04, 0.045], [0, 0.047]], 12), { p: [0.27 * sx, 0.27, 0.0], r: [0, 0, Math.PI / 2 * -sx] }, c.S, SURF.glow);
      }
      p.b.part(lathe([[0.07, -0.02], [0.09, 0.0], [0.09, 0.05], [0.07, 0.07]], 14), {}, '#33363d', SURF.metal);
      p.line([[0.0, 0.46, -0.02], [0.02, 0.58, -0.02], [0.0, 0.68, 0.0]], 0.013, '#9aa3b0', SURF.metal);
      p.e([0, 0.7, 0.0], 0.045, c.S, SURF.glow);
    },
    face: (c) => ({
      eye: { x: 0.105, y: 0.32, z: 0.238, r: 0.062 },
      white: c.S, whiteSurf: SURF.glow, pupil: '#fffbd6', pupilK: 0.0001, zk: 0.2, lid: '#0d1219',
      brow: { color: c.S, surf: SURF.glow, thick: 0.14, maxY: 0.405, surfZ: () => 0.236 },
      mouth: { y: 0.2, w: 0.09, color: c.S, surf: SURF.glow, inside: '#0d1219', teeth: c.S, tongue: '#ff8a5a', surfZ: () => 0.24 },
    }),
    arm: (c) => ({ sleeve: shade(c.P, 0.85), hand: c.S, surf: SURF.metal }),
  },

  // --- FOX --------------------------------------------------------------------------
  fox: {
    torso(p, c) {
      baseBody(p, { body: c.P, belly: c.S, shoes: '#4a3026', w: 0.95 });
      // Big bushy tail with a cream tip. It rises behind the seat (and stays within 0.52 of the hip) so it
      // never pokes into an engine, a wing or a tail fin (see the clearance test).
      p.b.part(sweep([[0, 0.12, -0.15], [0, 0.1, -0.3], [0, 0.24, -0.43], [0.02, 0.42, -0.46]], (t) => 0.06 + 0.07 * Math.sin(Math.PI * Math.min(1, t * 1.1)) , 22, 12), {}, c.P, SURF.fur);
      p.e([0.025, 0.47, -0.47], [0.08, 0.1, 0.08], c.S, SURF.fur, [0.3, 0, 0]);
    },
    head(p, c) {
      p.e(HEAD_C, [0.31, 0.25, 0.25], c.P);
      // Muzzle with a dark nose, cream cheek tufts.
      p.e([0, 0.2, 0.25], [0.11, 0.085, 0.16], c.S, SURF.fur);
      p.e([0, 0.236, 0.4], [0.038, 0.03, 0.03], '#2b1c16', SURF.gloss);
      p.ep([0.22, 0.18, 0.1], [0.12, 0.05, 0.1], c.S, SURF.fur, [0, 0.5, 0.35]);
      // Tall ears with dark tips and cream inner.
      p.cone([0.16, 0.43, -0.03], 0.105, 0.3, c.P, [0.05, 0, -0.32], true, SURF.fur, 0.95);
      p.cone([0.165, 0.45, 0.0], 0.062, 0.22, c.S, [0.1, 0, -0.32], true, SURF.fur, 0.95);
      p.cone([0.228, 0.635, -0.03], 0.034, 0.074, '#3a241b', [0.05, 0, -0.32], true, SURF.fur, 0.95);
      // (Sly slanted eyes with amber irises, brows and the mouth come from the face.)
    },
    face: () => ({
      eye: { x: 0.115, y: 0.31, z: 0.215, r: 0.07 },
      white: EYE_WHITE, iris: '#e9a21e', pupil: EYE_DARK, pupilK: 0.4, slit: 0.55, slant: -0.35, lid: '#e8742c',
      brow: { color: '#3a241b', maxY: 0.46, surfZ: ellipsoidZ(HEAD_C, [0.31, 0.25, 0.25]) },
      mouth: { y: 0.185, w: 0.065, color: '#3a241b', inside: '#5a1c1c', surfZ: ellipsoidZ([0, 0.2, 0.25], [0.11, 0.085, 0.16]) },
    }),
    arm: (c) => ({ sleeve: c.P, hand: '#4a3026' }),
  },

  // --- BEAR -------------------------------------------------------------------------
  bear: {
    torso(p, c) {
      baseBody(p, { body: c.P, belly: c.S, shoes: c.D, w: 1.12, round: 1.08 });
      p.e([0, 0.14, -0.2], [0.09, 0.09, 0.07], c.P, SURF.fur); // little round tail
    },
    head(p, c) {
      p.e(HEAD_C, [0.34, 0.3, 0.3], c.P);
      // Round ears with tan insides.
      p.ep([0.24, 0.52, -0.02], 0.115, c.P);
      p.ep([0.24, 0.52, 0.04], [0.07, 0.07, 0.04], c.S, SURF.fur, [0, 0.2, 0], true);
      // Muzzle, nose, mouth.
      p.e([0, 0.2, 0.28], [0.15, 0.115, 0.1], c.S, SURF.fur);
      p.e([0, 0.255, 0.365], [0.055, 0.036, 0.03], '#241713', SURF.gloss);
      // (Small eyes, thick brows and the mouth come from the face.)
      p.ep([0.22, 0.2, 0.22], [0.06, 0.04, 0.03], '#e58f8f', SURF.matte, [0, 0.6, 0], true);
    },
    face: (c) => ({
      eye: { x: 0.125, y: 0.34, z: 0.262, r: 0.062 },
      white: EYE_WHITE, pupil: '#1a1514', pupilK: 0.62, lid: c.P,
      brow: { color: '#2a1b15', thick: 0.26, maxY: 0.5, surfZ: ellipsoidZ(HEAD_C, [0.34, 0.3, 0.3]) },
      mouth: { y: 0.165, w: 0.07, color: '#241713', inside: '#4a1a1a', surfZ: ellipsoidZ([0, 0.2, 0.28], [0.15, 0.115, 0.1]) },
    }),
    arm: (c) => ({ sleeve: c.P, hand: c.D }),
  },

  // --- DINO -------------------------------------------------------------------------
  dino: {
    torso(p, c) {
      baseBody(p, { body: c.P, belly: c.S, shoes: c.D, w: 1.04 });
      // Thick tail (short, curling up so it clears engines, wings and fins) and row of rounded back spikes.
      p.b.part(sweep([[0, 0.1, -0.12], [0, 0.06, -0.3], [0, 0.12, -0.42], [0, 0.27, -0.5]], (t) => 0.1 * (1 - 0.8 * t) + 0.015, 22, 10), {}, c.P, SURF.fur);
      p.cone([0, 0.42, -0.15], 0.055, 0.13, c.S, [-0.75, 0, 0]);
      p.cone([0, 0.32, -0.2], 0.06, 0.14, c.S, [-1.0, 0, 0]);
      p.cone([0, 0.2, -0.22], 0.062, 0.14, c.S, [-1.35, 0, 0]);
      p.cone([0, 0.1, -0.34], 0.05, 0.11, c.S, [-1.6, 0, 0]);
    },
    head(p, c) {
      p.e(HEAD_C, [0.28, 0.25, 0.27], c.P);
      // Long snout with nostrils, lighter jaw, smile and a few teeth.
      p.e([0, 0.2, 0.3], [0.17, 0.12, 0.2], c.P);
      p.e([0, 0.13, 0.31], [0.15, 0.06, 0.18], c.S, SURF.fur);
      p.ep([0.05, 0.275, 0.46], [0.016, 0.012, 0.012], '#1f3d34', SURF.matte, [0, 0, 0], true);
      // (Brows, big yellow eyes and the mouth come from the face.)
      // Crest of rounded spikes down the back of the head.
      p.cone([0, 0.5, 0.1], 0.05, 0.12, c.S, [-0.4, 0, 0]);
      p.cone([0, 0.5, -0.02], 0.055, 0.14, c.S, [-0.7, 0, 0]);
      p.cone([0, 0.44, -0.14], 0.05, 0.12, c.S, [-1.0, 0, 0]);
    },
    face: (c) => ({
      eye: { x: 0.125, y: 0.365, z: 0.2, r: 0.077 },
      white: EYE_WHITE, iris: '#e8c326', pupil: EYE_DARK, pupilK: 0.42, slit: 0.4, lid: c.P,
      brow: { color: c.D, thick: 0.22, maxY: 0.52, surfZ: ellipsoidZ(HEAD_C, [0.28, 0.25, 0.27]) },
      mouth: { y: 0.165, w: 0.115, color: '#1f3d34', inside: '#4a1a24', surfZ: ellipsoidZ([0, 0.2, 0.3], [0.17, 0.12, 0.2]) },
    }),
    arm: (c) => ({ sleeve: c.P, hand: c.P }),
  },
};

/** Build the arm piece (right arm, rest hand at (0, 0, ARM_LEN)): upper arm, bent elbow, forearm, hand. */
function buildArm(sleeve: string, hand: string, surf: Surf, glove: boolean): THREE.BufferGeometry {
  const p = new Piece();
  const L = ARM_LEN;
  const elbow: V3 = [0.075, -0.03, L * 0.5];
  const r = 0.058;
  p.b.part(sweep([[0, 0, 0], [elbow[0] * 0.6, elbow[1] * 0.6, L * 0.28], elbow], r, 14, 10), {}, sleeve, surf);
  p.e(elbow, r * 1.02, sleeve, surf, [0, 0, 0], true);
  p.b.part(sweep([elbow, [0.04, -0.02, L * 0.78], [0, 0, L * 0.94]], r * 0.92, 14, 10), {}, sleeve, surf);
  p.e([0, 0, 0], r * 1.1, sleeve, surf, [0, 0, 0], true);
  // Hand (a round mitt; astronauts get a bigger glove with a cuff ring).
  p.e([0, 0, L], glove ? 0.078 : 0.068, hand, glove ? SURF.plastic : SURF.fur);
  if (glove) p.b.part(lathe([[0.062, -0.025], [0.075, -0.02], [0.075, 0.02], [0.062, 0.025]], 14), { p: [0, 0, L * 0.9], r: [Math.PI / 2, 0, 0] }, hand, SURF.gloss);
  return p.build();
}

/**
 * How much bigger than the plain model each species' head is drawn (chunky cartoon proportions, so faces
 * stay readable from the chase camera and in 4-way split screen). The model scales the head pivot by this.
 */
export const HEAD_SCALE: Record<Species, number> = {
  chick: 1.42, cat: 1.4, frog: 1.32, astronaut: 1.2, robot: 1.24, fox: 1.4, bear: 1.34, dino: 1.34,
};

/**
 * The head is built once per face pose with identical parts, so vertex N is the same point in every copy.
 * The neutral copy is the mesh; the others are stored as morph targets (differences to neutral), in the order
 * of FACE_POSES (see face.ts and expression.ts).
 */
function buildHead(def: SpeciesBuild, c: Palette): THREE.BufferGeometry {
  const spec = def.face(c);
  const make = (f: FacePose): THREE.BufferGeometry => {
    const piece = new Piece();
    def.head(piece, c);
    addFace(piece, spec, f);
    return piece.build();
  };
  const head = make(NEUTRAL_POSE);
  const base = head.getAttribute('position');
  const targets = FACE_POSES.map((f) => {
    const g = make(f);
    const pos = g.getAttribute('position');
    if (pos.count !== base.count) throw new Error(`face pose changed the vertex count (${pos.count} vs ${base.count})`);
    const delta = new Float32Array(base.count * 3);
    for (let i = 0; i < delta.length; i++) delta[i] = (pos.array as Float32Array)[i] - (base.array as Float32Array)[i];
    g.dispose();
    return new THREE.Float32BufferAttribute(delta, 3);
  });
  head.morphAttributes.position = targets;
  head.morphTargetsRelative = true;
  // Faces may stick out a little in some poses: keep the culling sphere generous.
  head.computeBoundingSphere();
  if (head.boundingSphere) head.boundingSphere.radius += 0.08;
  return head;
}

export function buildDriverGeometries(look: DriverLook): DriverGeometries {
  const def = SPECIES[look.species];
  const c: Palette = { P: look.primary, S: look.secondary, D: shade(look.primary, 0.68), L: mix(look.primary, '#ffffff', 0.4) };
  const torso = new Piece();
  def.torso(torso, c);
  const a = def.arm(c);
  return { torso: torso.build(), head: buildHead(def, c), arm: buildArm(a.sleeve, a.hand, a.surf ?? SURF.fur, !!a.glove) };
}

// Unused helper imports kept for quick iteration.
void capsule;
void ({} as Place);
