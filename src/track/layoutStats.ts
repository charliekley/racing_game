/**
 * Layout statistics of a track: how twisty is it? Pure functions over the sampled
 * centerline (`track.samples`, curvature in 1/m, evenly spaced by `track.spacing`).
 * Used by layout.test.ts to keep every track interesting (no long boring straights),
 * and handy for comparing layouts while designing them.
 */
import type { Track } from '../sim/track';

/** |curvature| below this counts as "straight" (radius > 250 m). */
export const STRAIGHT_CURVATURE = 1 / 250;
/** |curvature| above this counts as a "tight corner" (radius < 60 m). */
export const TIGHT_CURVATURE = 1 / 60;

export interface LayoutStats {
  /** Road length (m), including the flight gap of a mandatory cannon. */
  length: number;
  /** Lengths (m) of every straight run, longest first (the run that wraps over the lap line is joined). */
  straights: number[];
  /** Fraction (0..1) of the road that is not straight. */
  curvedShare: number;
  /** Total turning: the sum of |heading change| over the lap (degrees). */
  turningDeg: number;
  /** Number of separate tight corners (radius < 60 m); runs closer than 10 m are merged. */
  tightCorners: number;
  /** Highest minus lowest main-road height (m). */
  heightRange: number;
  /**
   * Steepest climb and steepest drop of the main road, as a grade (rise / run: 0.10 = 10 %), measured over
   * GRADE_WINDOW metres so a single sample's wobble does not count. Ramps (kickers, humps) are NOT included:
   * this is the road itself. `maxDrop` is positive (a 0.2 drop = 20 % downhill).
   */
  maxClimb: number;
  maxDrop: number;
  /** Mean |grade| over the driven road (how hilly the lap is overall). */
  meanGrade: number;
  /** Fraction of the driven road steeper than 8 % (up or down). */
  steepShare: number;
}

/** Window (m) over which grades are measured. */
export const GRADE_WINDOW = 10;

/** Runs of consecutive true flags (circular), as [start, count] pairs. */
function circularRuns(flags: boolean[]): [number, number][] {
  const n = flags.length;
  if (flags.every(Boolean)) return [[0, n]];
  // Start scanning just after a false sample so no run is split by the array end.
  const first = flags.indexOf(false);
  const runs: [number, number][] = [];
  let start = -1;
  for (let k = 1; k <= n; k++) {
    const i = (first + k) % n;
    if (flags[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      runs.push([start, (i - start + n) % n]);
      start = -1;
    }
  }
  return runs;
}

export function layoutStats(track: Track): LayoutStats {
  const S = track.samples;
  const n = S.length;
  const ds = track.spacing;

  // The flight gap of a mandatory cannon is not driven: it is left out of every measurement below
  // (it is also never "straight" and it splits the straights on either side of it).
  const driven = S.map((p) => !track.inSkyGap(p.s));
  const drivenLength = driven.filter(Boolean).length * ds;

  const straightFlags = S.map((p, i) => driven[i] && Math.abs(p.curvature) < STRAIGHT_CURVATURE);
  const straights = circularRuns(straightFlags)
    .map(([, count]) => count * ds)
    .sort((a, b) => b - a);
  const straightTotal = straightFlags.filter(Boolean).length * ds;

  const turning = S.reduce((sum, p, i) => sum + (driven[i] ? Math.abs(p.curvature) * ds : 0), 0);

  // Tight corners: runs of tight samples, merging runs separated by less than 10 m.
  const tightFlags = S.map((p, i) => driven[i] && Math.abs(p.curvature) > TIGHT_CURVATURE);
  const closeGap = Math.ceil(10 / ds);
  const merged = tightFlags.slice();
  for (const [start, count] of circularRuns(tightFlags.map((f) => !f))) {
    if (count <= closeGap) for (let k = 0; k < count; k++) merged[(start + k) % n] = true;
  }
  const tightCorners = merged.every(Boolean)
    ? 1
    : circularRuns(merged).filter(([s, c]) => {
        for (let k = 0; k < c; k++) if (tightFlags[(s + k) % n]) return true;
        return false;
      }).length;

  const ys = S.filter((_, i) => driven[i]).map((p) => p.y);

  // Grades: height change over GRADE_WINDOW metres ahead, for every driven sample whose window is driven too.
  const w = Math.max(1, Math.round(GRADE_WINDOW / ds));
  let maxClimb = 0;
  let maxDrop = 0;
  let gradeSum = 0;
  let gradeCount = 0;
  let steep = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + w) % n;
    if (!driven[i] || !driven[j]) continue;
    const g = (S[j].y - S[i].y) / (w * ds);
    maxClimb = Math.max(maxClimb, g);
    maxDrop = Math.max(maxDrop, -g);
    gradeSum += Math.abs(g);
    gradeCount++;
    if (Math.abs(g) > 0.08) steep++;
  }
  return {
    length: track.length,
    straights,
    curvedShare: 1 - straightTotal / drivenLength,
    turningDeg: (turning * 180) / Math.PI,
    tightCorners,
    heightRange: Math.max(...ys) - Math.min(...ys),
    maxClimb,
    maxDrop,
    meanGrade: gradeCount ? gradeSum / gradeCount : 0,
    steepShare: gradeCount ? steep / gradeCount : 0,
  };
}
