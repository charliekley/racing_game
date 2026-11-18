/**
 * How a flat object (the Peel) should lie on the ground: its height and its tilt.
 *
 * Think of a small plank laid on the road. We measure the ground height at four points around
 * the object, tilt the plank to match the slope in each direction (pitch along the heading,
 * roll across it), then lift it just enough that none of the four points pokes through.
 * That way it never sinks into banked road, hills or ramps, and floats at most a few cm.
 *
 * Pure function: only needs the `Ground` interface, so it works in tests without a renderer.
 */
import type { Ground } from '../ground';

/** Half the footprint we measure over (m): about the radius of the Peel. */
export const PEEL_FOOTPRINT = 1.0;
/** Gap kept between the object and the ground to avoid flicker (m). */
const CLEARANCE = 0.02;

export interface GroundPose {
  /** Height of the object's centre. */
  y: number;
  /** Tilt about the sideways axis (nose up/down), radians. Same sign convention as the kart body. */
  pitch: number;
  /** Tilt about the forward axis, radians. */
  roll: number;
}

/**
 * @param heading  direction the object faces (0 = +Z)
 * @param hint     track sample index near the object (speeds up the lookup)
 * @param fallbackY used when a point has no ground at all (a gap or water)
 */
export function groundPose(ground: Ground, x: number, z: number, heading: number, hint: number, fallbackY: number): GroundPose {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const r = PEEL_FOOTPRINT;
  /** Ground height at `f` metres ahead and `l` metres to the left of the centre. "Left" is +x when facing +z. */
  const h = (f: number, l: number) => ground.sample(x + fx * f + fz * l, z + fz * f - fx * l, hint)?.height ?? fallbackY;
  const hf = h(r, 0);
  const hb = h(-r, 0);
  const hl = h(0, r);
  const hr = h(0, -r);
  const pitch = -Math.atan2(hf - hb, 2 * r);
  const roll = Math.atan2(hl - hr, 2 * r);
  const slopeF = (hf - hb) / (2 * r); // rise per metre ahead
  const slopeL = (hl - hr) / (2 * r); // rise per metre to the left
  // Where would the tilted plane be at each sample point (relative to its centre)? Lift the centre until the plane
  // clears the ground at the centre, the four axis points and four diagonal points.
  let need = h(0, 0);
  const d = r * Math.SQRT1_2;
  for (const [f, l, hh] of [[r, 0, hf], [-r, 0, hb], [0, r, hl], [0, -r, hr], [d, d, h(d, d)], [d, -d, h(d, -d)], [-d, d, h(-d, d)], [-d, -d, h(-d, -d)]]) {
    need = Math.max(need, hh - (slopeF * f + slopeL * l));
  }
  return { y: need + CLEARANCE, pitch, roll };
}
