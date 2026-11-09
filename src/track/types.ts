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

// ---------------------------------------------------------------------------
// Track format v2 (the "track overhaul"). Everything below is optional, so old
// tracks keep working. See docs/TRACKS.md for how the pieces fit together and
// which part of the code owns each one.
// ---------------------------------------------------------------------------

/** Rolling terrain around the road. Without it the world is flat at height 0. */
export interface TerrainDef {
  /** Seed for the hill noise (same seed = same hills). */
  seed?: number;
  /** Gentle rolling hills: amplitude (m, default 0) and wavelength (m, default 140). */
  hills?: { amplitude: number; wavelength: number };
  /** Extra mounds (height > 0) or pits (height < 0) in world metres: smooth bumps with the given radius. */
  features?: { x: number; z: number; radius: number; height: number }[];
  /** Distance over which the terrain blends from road level out to natural height (m, default 16). */
  blend?: number;
}

/**
 * A stretch where the ground ENDS beside the road: step off the edge and you fall
 * (the carrier drone then brings you back). Think mountain ridge roads and sky
 * islands. Without walls on that side, nothing stops you.
 */
export interface CliffDef {
  from: number;
  to: number;
  side: 'left' | 'right' | 'both';
  /** Distance from the centerline where the ground ends (m). Default: road half-width + curb + 2. */
  edge?: number;
}

/** The road is carried on a bridge/viaduct over the terrain (it does not flatten the ground under it). */
export interface BridgeDef {
  from: number;
  to: number;
}

/** A launch cannon: drive into its mouth and you are fired along an arc to the target. */
export interface CannonDef {
  /** Where the mouth is on the track (control-point units) and sideways (-1 = left edge … 1 = right edge). */
  at: number;
  offset?: number;
  /** Where you land: a point on the track (control-point units + lateral offset). */
  target: { at: number; offset?: number };
  /** Time in the air (s, default 2.2) and extra arc height above the straight line (m, default 14). */
  flightTime?: number;
  apex?: number;
}

/**
 * A shortcut: a second road that leaves the main road at `from` and rejoins it at
 * `to`. Skipped checkpoints are credited when you take it (Race.grantProgress).
 */
export interface ShortcutDef {
  /** Junctions on the MAIN road (control-point units). */
  from: number;
  to: number;
  /** Extra control points of the branch between the junctions, [x, z] or [x, z, height]. */
  points: ([number, number] | [number, number, number])[];
  /** Branch road width (m, default 0.7 × main width). */
  width?: number;
  /** 'dirt' slows you like off-road (a risk/reward shortcut); default 'road'. */
  surface?: 'road' | 'dirt';
}

export interface TrackDef {
  name: string;
  /** One-line description for menus and docs. */
  blurb?: string;
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
  /**
   * Jump ramps spanning the road: rise linearly over `length` m to `height` m,
   * then drop. Optional `gap`: metres of water right after the ramp – too slow
   * and you fall in (and the carrier drone brings you back).
   */
  ramps: {
    at: number;
    length: number;
    height: number;
    gap?: number;
    /** What is in the gap: 'water' (default) or 'void' (a chasm: fall and respawn). */
    gapKind?: 'water' | 'void';
    /** Ramp shape: 'kicker' (default, rises to a lip), 'hump' (smooth crest), 'double' (two kickers back to back). */
    shape?: 'kicker' | 'hump' | 'double';
    /**
     * Landing apron after the gap (default true when there is a gap): a gentle slope down
     * from a slightly raised edge, so the far lip is never a wall. false = flat road right after the gap.
     */
    landing?: boolean;
  }[];
  /** Boost pads: `offset` is lateral position, -1 = left edge … 1 = right edge. */
  boostPads: { at: number; offset: number; length: number; width: number }[];
  laps: number;
  /** Number of checkpoints the lap is split into (must pass them all, in order). */
  checkpoints: number;
  scenery: { seed: number; trees: number; buildings: number };
  /** Colors for this track's look. */
  theme: { grass: string; offroad: string; sky: string; horizon: string };

  // ---- v2 (all optional) ----
  terrain?: TerrainDef;
  cliffs?: CliffDef[];
  bridges?: BridgeDef[];
  cannons?: CannonDef[];
  shortcuts?: ShortcutDef[];
}
