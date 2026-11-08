/**
 * What the karts drive on. The kart physics only asks "what's directly below
 * (x, z)?" through this interface, so the flat test plane (M2) and the real
 * spline track (M3) are interchangeable.
 */
export type Surface = 'road' | 'offroad' | 'boost';

export interface GroundHit {
  /** Height of the surface at this point (m). */
  height: number;
  surface: Surface;
  /** Track sample index under this point (tracks only); pass back as `hint` next time. */
  index?: number;
}

export interface Ground {
  /**
   * Vertical raycast. Returns null where there is no ground (fell off the world).
   * `hint` = the `index` from this kart's previous hit, if any (speeds up track lookups).
   */
  sample(x: number, z: number, hint?: number): GroundHit | null;
}

// ---------------------------------------------------------------------------
// Test ground for M2: a flat plane with a stadium-shaped (two straights + two
// half circles) road loop painted on it. Everything off the road is grass.
// ---------------------------------------------------------------------------

export const TEST_OVAL = {
  /** Half length of each straight (m). */
  halfStraight: 60,
  /** Radius of the two end curves, measured to the road centerline (m). */
  radius: 38,
  /** Road width (m). */
  width: 16,
  /** The plane ends here (|x|, |z| beyond this = no ground). */
  extent: 400,
} as const;

/** Distance from (x, z) to the oval's centerline. Straights run along z at x = ±radius. */
export function distanceToOvalCenterline(x: number, z: number): number {
  const { halfStraight: L, radius: R } = TEST_OVAL;
  if (Math.abs(z) <= L) return Math.abs(Math.abs(x) - R);
  const cz = z > 0 ? L : -L; // center of the nearest end curve
  return Math.abs(Math.hypot(x, z - cz) - R);
}

/** Points along the oval centerline (for drawing the road), closed loop, counter-clockwise from above. */
export function ovalCenterline(segmentsPerCurve = 32): { x: number; z: number }[] {
  const { halfStraight: L, radius: R } = TEST_OVAL;
  const pts: { x: number; z: number }[] = [];
  // Right straight going +z, then far curve, left straight going -z, near curve.
  const straightSteps = 12;
  for (let i = 0; i < straightSteps; i++) pts.push({ x: R, z: -L + (2 * L * i) / straightSteps });
  for (let i = 0; i < segmentsPerCurve; i++) {
    const a = (Math.PI * i) / segmentsPerCurve;
    pts.push({ x: R * Math.cos(a), z: L + R * Math.sin(a) });
  }
  for (let i = 0; i < straightSteps; i++) pts.push({ x: -R, z: L - (2 * L * i) / straightSteps });
  for (let i = 0; i < segmentsPerCurve; i++) {
    const a = Math.PI + (Math.PI * i) / segmentsPerCurve;
    pts.push({ x: R * Math.cos(a), z: -L + R * Math.sin(a) });
  }
  return pts;
}

export class TestGround implements Ground {
  sample(x: number, z: number): GroundHit | null {
    if (Math.abs(x) > TEST_OVAL.extent || Math.abs(z) > TEST_OVAL.extent) return null;
    const onRoad = distanceToOvalCenterline(x, z) <= TEST_OVAL.width / 2;
    return { height: 0, surface: onRoad ? 'road' : 'offroad' };
  }
}
