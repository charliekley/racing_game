/**
 * Track definition format. A track is just data: a closed loop of control
 * points plus some features placed along it. Adding a track = adding a file
 * in src/track/tracks/ and listing it in src/track/index.ts.
 *
 * Positions ALONG the track ("at", "from", "to") are given in control-point
 * units: 3 = at control point 3, 3.5 = halfway between points 3 and 4. That
 * keeps features attached to the right corner when you move points around.
 * (A future track editor can write this same format.)
 */
export interface TrackDef {
  name: string;
  /** Closed loop of [x, z] or [x, z, height] in metres. Start/finish line is at point 0. */
  points: ([number, number] | [number, number, number])[];
  /** Road width (m). */
  width: number;
  /** Width of the grass/sand strip beside the road, each side (m). Walls stand at its outer edge. */
  offroadWidth: number;
  /** Automatic banking: bank angle (rad) = curvature (1/m) × this, capped at maxBankDeg. */
  bankPerCurvature: number;
  maxBankDeg: number;
  /** Barriers. 'outer' = on the outside of whichever way the track is curving. */
  walls: { from: number; to: number; side: 'left' | 'right' | 'both' | 'outer' }[];
  /** Jump ramps spanning the road: rise linearly over `length` m to `height` m, then drop. */
  ramps: { at: number; length: number; height: number }[];
  /** Boost pads: `offset` is lateral position, -1 = left edge … 1 = right edge. */
  boostPads: { at: number; offset: number; length: number; width: number }[];
  laps: number;
  /** Number of checkpoints the lap is split into (must pass them all, in order). */
  checkpoints: number;
  scenery: { seed: number; trees: number; buildings: number };
  /** Colors for this track's look. */
  theme: { grass: string; offroad: string; sky: string; horizon: string };
}
