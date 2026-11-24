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
  /**
   * Valleys (Mushroom Valley): stretches of road where the natural ground falls away to `valleyFloor` on BOTH sides, so the
   * road runs along a narrow ridge (or a pillar) and the gorge beside it is a broad open abyss, not a slot cut in a massif.
   */
  valleys?: ValleyDef[];
  /** Ground level (m) at the bottom of a valley: below the cloud sea, so the floor is never seen. */
  valleyFloor?: number;
  /**
   * A ceiling on the natural ground (Mushroom Valley: no lone spires, only road-following ridges stand up): within 150 m of
   * the road the ground may be at most `rise` metres above the nearest road, plus `slope` metres for every metre farther than 20 m away.
   */
  ceiling?: { rise: number; slope: number };
  /** Discs (world metres) the valleys never carve: the pillars that carry a shortcut's landing ledge. Eased out over 10 m. */
  valleyKeep?: { x: number; z: number; radius: number }[];
}

/** One valley: the ground is carved away beside the road between `from` and `to` (+ `pad`), easing in over `fade` metres. */
export interface ValleyDef {
  /** Control-point units of the first and last road point of the fully open stretch. */
  from: number;
  to: number;
  /** Extra metres of fully open valley before `from` and after `to` (default 0). */
  pad?: number;
  /** Metres along the road over which the ridge widens back to the mountain at either end (default 40). */
  fade?: number;
  /** Distance from the centerline (m) where the carving starts on the [left, right] side (default [4, 4]). */
  inner?: [number, number];
  /** Void gaps (chasms) inside the stretch: leave their road segments out of the ground blend, so the ground there is the valley. Default true. */
  open?: boolean;
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
  /** Draw railings along the edges (default true). Railings are only decoration: karts never hit them,
   *  so open-edged bridges (e.g. where the wind can blow you off) should set this to false. */
  rails?: boolean;
  /**
   * Treetop tracks only (`scenery.treetop`): 'rope' draws this span as a rope bridge (sagging hand ropes,
   * hangers, slatted deck) instead of a plank branch road. Looks only. Default: a plank branch road.
   */
  look?: 'rope';
}

/**
 * A giant tree (treetop tracks): a huge trunk with spreading branches and an autumn crown. Its trunk is
 * SOLID (a circle collider `radius` wide, from the ground up to `height`), so roads must keep clear of it.
 */
export interface GiantTreeDef {
  x: number;
  z: number;
  /** Trunk radius at road level (m); the foot flares out wider over its roots. */
  radius: number;
  /** Height of the trunk top / middle of the crown (m above the forest floor). */
  height: number;
  /** Crown radius (m, default 1.4 x height / 3). */
  crown?: number;
  /** Glowing lanterns hung round the trunk at this height above the floor (m). Looks only. */
  lanterns?: number;
}

/**
 * Treetop look (Autumn Speedway): plank roads, wooden rails, log supports, giant trees, falling leaves and
 * leaf piles. Looks only, apart from the giant trunks, which are solid.
 */
export interface TreetopDef {
  /** Hand-placed giant trees (the ones the road winds round). */
  giantTrees: GiantTreeDef[];
  /** Extra giant trees scattered by the scenery planner (seeded), keeping clear of every road: the forest. */
  forest?: { count: number; seed?: number };
  /** Leaf piles on the floor sections: soft heaps (you drive through them), in control-point units + lateral (-1..1). */
  leafPiles?: { at: number; offset: number; size?: number }[];
}

/**
 * A giant mushroom cap standing in a gorge or chasm (Mushroom Valley). The cap is a flat-topped disc of ground
 * (a circle with a `radius` and its top at some height):
 *  - 'green' caps are ordinary solid road (platforms and bridges you drive across);
 *  - 'orange' caps are TRAMPOLINES: touch the top and the kart is thrown up and forward along an arc that lands
 *    exactly on `to` (see src/sim/bouncers.ts for the rules and constants).
 * Caps are only the ground; the stalk and the cap's looks are drawn from the same data (src/render/env/mushroom.ts).
 *
 * Where a cap stands: either ON THE MAIN ROAD (`at` in control-point units, `offset` = metres to the right of the
 * centerline, `dy` = metres of the top above the road) so it follows the road wherever the road bends, or at a
 * world point `x, z, y` (for the second route through the cave, which is not on the main road).
 */
export interface CapDef {
  kind: 'green' | 'orange';
  radius: number;
  at?: number;
  /** Metres further along the road from `at` (default 0). */
  ds?: number;
  offset?: number;
  dy?: number;
  x?: number;
  z?: number;
  y?: number;
  /** Orange only: where the bounce lands: the index of another cap in `caps`, a point on the main road, or a world point (y = the ground there). */
  to?: number | { at: number; ds?: number; offset?: number } | { x: number; z: number };
  /** Orange only: time in the air (s). Default: from the distance, so the horizontal speed is about BOUNCE.speed. */
  air?: number;
}

/** Mushroom Valley look: gorge mist, the cave shell and its glowing mushrooms. Looks only (the caps are `TrackDef.caps`). */
export interface MushroomDef {
  /** Gorges: stretches of the main road (control-point units) where a mist layer fills the chasm below. */
  gorges: { from: number; to: number }[];
  /** The cave: main-road stretch (control-point units) under the rock shell, its half width (m) and roof height above the road (m). */
  cave: { from: number; to: number; halfWidth: number; roof: number; /** Metres the vault's centre line lies to the right of the main road (default -0.26 x halfWidth: to the left). */ offset?: number };
  /** Bioluminescent little mushrooms scattered round the cave and the gorge walls (default 90). */
  glow?: number;
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
  /**
   * true = EVERY kart goes through this cannon (it is not a shortcut). The main route between the mouth and the
   * landing becomes a gap with no ground at all (a crater, open sky), so the road ends at a launch pad and the
   * cannon is the only way across. The capture covers the full road width, bots always use it, and a kart that
   * misses it falls and respawns before the pad. The control points across the gap are only a straight line
   * (nobody drives them); keep them on the line from the mouth to the landing. Default false.
   */
  mandatory?: boolean;
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
  /**
   * true = the third number of each control point ([x, z, height]) is a height the path is HELD at (Mushroom Valley's
   * orange route, high above a pit). Points without a height are left on the ground. Default false: heights are
   * ignored and the path follows the terrain.
   */
  hold?: boolean;
  /** 'dirt' (default): the path slows you like off-road. 'road': a hard-packed trail, driven at full speed (it is still drawn as dirt). */
  surface?: 'road' | 'dirt';
  /**
   * true = the branch is a DECK (Rainbow Route's second ribbon): it follows its own control-point heights (the third number
   * of every point is required, and they are measured above sea level like the main road), has its own ground (its width,
   * nothing beside it: step off and you fall) and no dirt look. The terrain is not shaped under it. Default false.
   * A deck is the second arm of a Y: it starts ON the main road's centre line at `from` and ends on it at `to`
   * (the two ribbons overlap until they have pulled apart), so the main route should veer away from it in between.
   */
  deck?: boolean;
  /**
   * Barriers along the branch. Same shape as the main `walls`, but `from`/`to` are in
   * BRANCH-local control-point units: 0 = the junction where the branch starts,
   * 1..points.length = your `points`, points.length + 1 = the junction where it rejoins.
   */
  walls?: { from: number; to: number; side: 'left' | 'right' | 'both' | 'outer' }[];
}

/** A hand-placed solid box on the ground: a container stack or a warehouse. */
export interface BlockDef {
  kind: 'container' | 'warehouse';
  x: number;
  z: number;
  /** Size in metres: w across (local x), d along (local z), h tall. */
  w: number;
  d: number;
  h: number;
  /** Yaw in radians (same convention as scenery rotationY). Default 0. */
  rot?: number;
  /** Wall colour, e.g. '#c0392b'. */
  color: string;
}

/** Rainbow Route look: a ribbon road floating in space above a planet. Everything is optional. */
export interface RainbowDef {
  /** The planet under the course: centre (world metres), radius. Default: below the lap, radius 1000, top 170 m under the lowest road. */
  planet?: { x: number; y: number; z: number; radius: number };
  /** Seed for the planet's continents, the star field and the dust. */
  seed?: number;
}

import type { HazardDef } from './hazardTypes';

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
  boostPads: {
    at: number;
    offset: number;
    length: number;
    width: number;
    /** Rainbow Route only: a glowing star-ring arch stands over this pad (looks only). */
    arch?: boolean;
  }[];
  laps: number;
  /** Number of checkpoints the lap is split into (must pass them all, in order). */
  checkpoints: number;
  scenery: {
    seed: number;
    trees: number;
    buildings: number;
    /** Hand-placed solid blocks (container stacks, warehouses...). Optional. */
    blocks?: BlockDef[];
    /** Mushroom Valley: gorge mist, a glowing cave and the giant caps' looks (see MushroomDef). */
    mushroom?: MushroomDef;
    /** Treetop course: giant trees, plank roads and falling leaves (see TreetopDef). */
    treetop?: TreetopDef;
    /**
     * Sky-island look: leave out the ring of green hills and mountains that normally stands on the
     * horizon, so the course floats in open sky (clouds are kept). Default false.
     */
    openSky?: boolean;
    /** Rainbow Route: a glowing translucent ribbon road in space above a planet (see RainbowDef). Looks only. */
    rainbow?: RainbowDef;
  };
  /** Colors for this track's look. */
  /**
   * `mood` (optional) picks the lighting preset in src/render/scene.ts (sun colour and height, exposure,
   * bloom, colour grade, stars...). Default 'day'.
   */
  theme: { grass: string; offroad: string; sky: string; horizon: string; mood?: 'day' | 'dusk' | 'evening' | 'bright' | 'snow' | 'night' | 'autumn' | 'space' };

  // ---- v2 (all optional) ----
  terrain?: TerrainDef;
  cliffs?: CliffDef[];
  bridges?: BridgeDef[];
  cannons?: CannonDef[];
  /** Giant mushroom caps in gorges and chasms: green = solid platforms, orange = trampolines (see CapDef). */
  caps?: CapDef[];
  /** Chasms in the MAIN road: no ground from `at` for `length` metres (like a ramp's void gap, but without the ramp). */
  chasms?: { at: number; length: number }[];
  shortcuts?: ShortcutDef[];
  /** Metres between rows of item boxes (default ITEMS.rowSpacing). Mushroom Valley uses a shorter spacing so every crossing has a row on both sides. */
  itemRowSpacing?: number;
  /**
   * Holds the computer drivers back on a track whose road never makes them brake (Rainbow Route: wide, gentle bends and no
   * grip loss, so a bot that is as good as on the other tracks is far faster than a human). All optional; see sim/autopilot.ts.
   */
  botTuning?: {
    /** Multiplier on the bots' straight-line pace (default 1). */
    pace?: number;
    /** Curvature (1/m) above which a bot lifts for a bend (default 0.03). */
    cornerCurvature?: number;
    /** Amplitude (m) of the slow sideways drift of a bot's line: humans do not hit every boost pad either. Skill scales it. */
    wander?: number;
    /** Multiplier on the chance that a bot does a trick off a ramp (default 1): every trick landing pays a boost, and this track is all ramps. */
    trickScale?: number;
    /** true = bots never drift here (the rails stand on the S-bends' apexes, where a bot's drift would carry it off the rail-less ribbon). */
    noDrift?: boolean;
  };
  /** Timed dangers and moving parts (geysers, drawbridges...). Their state depends only on the race clock; see src/sim/hazards/. */
  hazards?: HazardDef[];
}
