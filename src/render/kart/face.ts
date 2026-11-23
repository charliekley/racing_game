/**
 * Driver FACES as geometry, one per expression ("pose").
 *
 * Technique: MORPH TARGETS. Three.js can store several copies of a mesh's vertex positions and blend
 * them on the GPU with one weight per copy. We build the head once per pose (neutral, blink, happy,
 * shocked...) with the exact same parts in the exact same order, so vertex number N is "the same
 * vertex" in every copy. The neutral head is the base mesh and every other pose becomes a morph
 * target (stored as the difference to neutral). The weights come from `DriverFace` (expression.ts).
 * Result: no extra meshes or draw calls, smooth blends between faces, and blinking for free.
 *
 * What changes between poses: eye openness and size, pupil size and gaze, an eyelid that slides down
 * (angry, smug, tired), eyebrow height and tilt, mouth curve, mouth opening, teeth and tongue.
 * Parts that are not needed in a pose are shrunk to (almost) nothing instead of removed, so the vertex
 * count never changes.
 *
 * Head space: the origin is the neck, +Z is forward (see drivers.ts). Each species gives a `FaceSpec`
 * that says where its eyes, brows and mouth sit.
 */
import { SURF, type Surf, type V3 } from './geo';
import type { Piece } from './drivers';

/** How a face looks. All of these blend linearly, so poses can be mixed. */
export interface FacePose {
  /** Eye openness: 1 = normal, 0 = shut (a blink). */
  open: number;
  /** Eye size factor (shock = wide eyes). */
  wide: number;
  /** Pupil size factor. */
  pupil: number;
  /** Pupil offset in eye radii (x: toward the model's left, y: up). */
  gazeX: number;
  gazeY: number;
  /** Eyelid cover from the top, 0..1, and its tilt (+ = inner end lower = angry, - = outer end lower = sad). */
  lid: number;
  lidTilt: number;
  /** Eyebrow lift (eye radii/2) and tilt (+ = inner end down = angry, - = inner end up = worried). */
  brow: number;
  browTilt: number;
  /** One brow up and the other down (smug). */
  browAsym: number;
  /** Mouth curve: +1 smile, -1 frown. */
  smile: number;
  /** One corner of the mouth up (smirk). */
  smirk: number;
  /** Mouth opening 0..1 and width factor. */
  mouthOpen: number;
  mouthW: number;
  /** Teeth band (gritted/angry) and tongue (cheering), 0..1. */
  teeth: number;
  tongue: number;
}

export const NEUTRAL_POSE: FacePose = {
  open: 1, wide: 1, pupil: 1, gazeX: 0, gazeY: 0, lid: 0, lidTilt: 0,
  brow: 0, browTilt: 0, browAsym: 0, smile: 0.35, smirk: 0, mouthOpen: 0, mouthW: 1, teeth: 0, tongue: 0,
};

const pose = (o: Partial<FacePose>): FacePose => ({ ...NEUTRAL_POSE, ...o });

/**
 * The pose of each morph target, in the order of TARGET (expression.ts): blink, then EXPRESSIONS.
 * The weight of a target is how much of this pose is mixed in.
 */
export const FACE_POSES: readonly FacePose[] = [
  pose({ open: 0.05 }), // blink
  pose({ open: 0.62, brow: 0.7, smile: 1, mouthOpen: 0.35, mouthW: 1.1, pupil: 1.1 }), // happy
  pose({ wide: 1.2, pupil: 0.55, brow: 1.4, smile: 0, mouthOpen: 1, mouthW: 0.5 }), // shocked
  pose({ open: 0.85, pupil: 0.5, gazeX: 0.8, gazeY: -0.3, brow: 0.5, browTilt: -0.8, smile: -0.3, mouthOpen: 0.45, mouthW: 0.9, tongue: 0.9 }), // dizzy
  pose({ lid: 0.32, lidTilt: 0.2, brow: -0.2, browTilt: 0.7, smile: 0, mouthOpen: 0.5, mouthW: 1.15, teeth: 1, pupil: 0.85 }), // gritted
  pose({ lid: 0.42, gazeX: 0.45, brow: 0.1, browAsym: 0.8, smile: 0.7, smirk: 1, pupil: 0.9 }), // smug
  pose({ lid: 0.3, lidTilt: -0.5, gazeY: -0.5, pupil: 0.85, brow: 0.8, browTilt: -1.2, smile: -1, mouthOpen: 0.15, mouthW: 0.85 }), // despair
  pose({ lid: 0.5, lidTilt: 0.55, brow: -0.4, browTilt: 1.2, smile: -0.7, mouthOpen: 0.4, teeth: 0.7, pupil: 0.8 }), // angry
  pose({ open: 0.55, brow: 1, smile: 1, mouthOpen: 1, mouthW: 1.25, tongue: 0.8, pupil: 1.15 }), // celebrate
];

/** Where the features sit on one species' head. */
export interface FaceSpec {
  /** Right eye centre and radius (the left eye is mirrored). */
  eye: { x: number; y: number; z: number; r: number };
  white: string;
  whiteSurf?: Surf;
  /** Coloured iris (optional). */
  iris?: string;
  pupil: string;
  /** Pupil radius in eye radii (before the pose scales it). */
  pupilK: number;
  /** Squash the pupil sideways (cat/dino slits): 1 = round. */
  slit?: number;
  /** Eye depth relative to the usual 0.75 radius (flat screens). */
  zk?: number;
  /** Tilt of the eye white (fox). */
  slant?: number;
  /** Eyelid colour: the colour of the skin around the eye. */
  lid: string;
  brow: { color: string; surf?: Surf; thick?: number; maxY: number; liftK?: number; surfZ: (x: number, y: number) => number };
  /**
   * A drawn mouth (lip line, opening, tongue, teeth). OMIT it for species whose anatomy has none on the
   * face: beaked birds (they use `beak`) and the elephant (its mouth is hidden under the trunk). Which
   * features a species has never changes with the pose, so the vertex count still does not.
   */
  mouth?: { y: number; w: number; color: string; surf?: Surf; inside: string; tongue?: string; teeth?: string; surfZ: (x: number, y: number) => number };
  /**
   * Beaked species: the UPPER beak is part of the static head; this is the hinged LOWER beak that swings
   * down when the mouth opens (happy, shocked, celebrate...). `hinge` is [y, z] of the joint at the back
   * of the beak, `off` the lower beak centre relative to the hinge when shut, `maxOpen` the swing (radians)
   * at mouthOpen = 1. A dark gape shows between the two halves while it is open.
   */
  beak?: { hinge: [number, number]; off: [number, number]; r: V3; tilt: number; color: string; inside: string; maxOpen: number; gape: number };
}

/** z of an ellipsoid's front surface at (x, y) (a function of |x|). Used to lay brows and mouths on a head or muzzle. */
export function ellipsoidZ(c: V3, r: V3): (x: number, y: number) => number {
  return (x, y) => {
    const u = (Math.abs(x) - c[0]) / r[0];
    const v = (y - c[1]) / r[1];
    return c[2] + r[2] * Math.sqrt(Math.max(0, 1 - u * u - v * v));
  };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const TINY = 1e-4;

/**
 * Add the eyes, brows and mouth of `spec` in `pose` to a head piece. The number of parts and their order
 * depend only on the spec, never on the pose.
 */
export function addFace(p: Piece, spec: FaceSpec, f: FacePose): void {
  const { eye, brow, mouth } = spec;
  const r = eye.r;
  const oy = Math.max(0.05, f.open); // vertical squash of the whole eye (a blink)
  const wide = f.wide;
  const zk = spec.zk ?? 0.75;
  const kz = zk / 0.75; // flat eyes (screens) keep their pupils flat too
  const darkK = spec.pupilK * f.pupil;
  const slit = spec.slit ?? 1;

  for (const sx of [1, -1]) {
    const ex = eye.x * sx;
    const ey = eye.y;
    const ez = eye.z;
    const H = r * 1.12 * wide * oy; // half height of the eye white
    // White of the eye (all eye parts squash around the eye centre with `oy`).
    p.e([ex, ey, ez], [r * wide, H, r * zk * wide], spec.white, spec.whiteSurf ?? SURF.eye, [0, 0, (spec.slant ?? 0) * sx], 'mid');
    // Iris and pupil, shifted by the gaze.
    const gx = f.gazeX * r * 0.32;
    const gy = f.gazeY * r * 0.32 * oy;
    if (spec.iris) {
      p.e([ex + gx * 0.8, ey - r * 0.02 * oy + gy * 0.8, ez + r * 0.5 * kz * wide], [r * 0.62 * wide, r * 0.7 * wide * oy, r * 0.35 * kz], spec.iris, SURF.eye, [0, 0, 0], 'mid');
    }
    p.e([ex + gx, ey - r * 0.03 * oy + gy, ez + r * 0.6 * kz * wide], [Math.max(TINY, r * darkK * slit * wide), Math.max(TINY, r * darkK * 1.2 * wide * oy), r * 0.3 * kz], spec.pupil, SURF.eye, [0, 0, 0], 'mid');
    // Little white sparkle: it makes the eyes look alive.
    p.e([ex - sx * r * 0.08 + gx * 0.6, ey + r * 0.32 * oy, ez + r * 0.8 * kz * wide], [r * 0.2, r * 0.22 * oy, r * 0.12 * kz], '#ffffff', SURF.glow, [0, 0, 0], 'low');

    // Eyelid: a skin-coloured cap that slides down over the eye (hidden at lid = 0).
    const cover = f.lid;
    const lidK = clamp(cover * 3, 0, 1);
    const lowEdge = ey + H * (1 - 2 * cover);
    const hv = Math.max(TINY, H * 0.5 * lidK);
    p.e(
      [ex, lowEdge + hv, ez + r * 0.42],
      [Math.max(TINY, r * 1.12 * wide * lidK), hv, Math.max(TINY, r * 0.55 * lidK * wide)],
      spec.lid, SURF.fur, [0, 0, f.lidTilt * sx], 'mid',
    );

    // Eyebrow: a thin tube from the inner to the outer end, lying on the head surface.
    const thick = brow.thick ?? 0.17;
    const bw = r * 1.15;
    const lift = (r * 0.5 + f.brow * r * 0.5 * (brow.liftK ?? 1)) + f.browAsym * sx * r * 0.5;
    const by = Math.min(brow.maxY, ey + r * 1.12 + lift);
    const tilt = f.browTilt;
    const pts: V3[] = [];
    for (let i = 0; i < 3; i++) {
      const t = i / 2; // 0 inner, 1 outer
      const x = ex - sx * bw * (1 - 2 * t);
      const y = by - tilt * bw * (0.5 - t * 0.85) * 0.6 + Math.sin(Math.PI * t) * r * 0.12;
      pts.push([x, y, brow.surfZ(x, y) + r * thick * 0.3]);
    }
    p.line(pts, Math.max(0.006, r * thick), brow.color, brow.surf ?? SURF.matte);
  }

  // ---- Beak (birds): a hinged lower beak instead of a mouth ----
  if (spec.beak) {
    const b = spec.beak;
    const a = f.mouthOpen * b.maxOpen;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const [hy, hz] = b.hinge;
    // Rotate the shut offset about the hinge (x axis): +a swings the tip down.
    const y = hy + b.off[0] * ca - b.off[1] * sa;
    const z = hz + b.off[0] * sa + b.off[1] * ca;
    const o = clamp(f.mouthOpen * 1.6, 0, 1);
    // Dark gape inside the beak (invisible when shut).
    p.e([0, hy - 0.004, hz + b.r[2] * 0.8], [Math.max(TINY, b.gape * o), Math.max(TINY, b.gape * 0.5 * o), Math.max(TINY, b.r[2] * 0.7 * o)], b.inside, SURF.matte, [0, 0, 0], 'low');
    p.e([0, y, z], b.r, b.color, SURF.gloss, [b.tilt + a, 0, 0], 'mid');
  }

  // ---- Mouth ----
  if (!mouth) return;
  const mw = mouth.w * f.mouthW;
  const dep = mw * 0.5;
  const mpts: V3[] = [];
  for (let i = 0; i < 5; i++) {
    const u = i / 2 - 1; // -1..1 across the mouth
    const x = mw * u;
    const y = mouth.y + f.smile * dep * (u * u - 0.55) + f.smirk * dep * 0.9 * u;
    mpts.push([x, y, mouth.surfZ(x, y) + 0.004]);
  }
  const lipR = Math.max(0.0055, mouth.w * 0.085);
  p.line(mpts, lipR, mouth.color, mouth.surf ?? SURF.matte);
  // Open mouth: a dark disc hanging below the lip line, with a tongue and a band of teeth inside.
  const o = f.mouthOpen;
  const rx = Math.max(TINY, mw * (0.3 + 0.6 * o) * (o > 0.001 ? 1 : 0));
  const ry = Math.max(TINY, o * mw * 0.62);
  const my = mouth.y - ry * 0.35;
  const mz = mouth.surfZ(0, my);
  p.e([0, my, mz - 0.002], [rx, ry, 0.016], mouth.inside, SURF.matte, [0, 0, 0], 'mid');
  const tg = f.tongue * clamp(o * 2, 0, 1);
  p.e([0, my - ry * 0.55, mz + 0.0], [Math.max(TINY, rx * 0.55 * tg), Math.max(TINY, ry * 0.42 * tg), 0.016], mouth.tongue ?? '#ea6f80', SURF.matte, [0, 0, 0], 'low');
  const tt = f.teeth;
  p.e([0, my, mz + 0.004], [Math.max(TINY, rx * 0.92 * tt), Math.max(TINY, ry * 0.62 * tt), 0.014], mouth.teeth ?? '#fbfbf6', SURF.gloss, [0, 0, 0], 'mid');
}
