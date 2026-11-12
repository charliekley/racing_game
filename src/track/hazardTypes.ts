/**
 * Hazard definitions: moving objects or timed dangers placed on a track (data only).
 *
 * A hazard's state is a PURE FUNCTION OF THE RACE CLOCK: the same time always gives the
 * same pose. So the simulation, the renderer and the bots all agree, with no random
 * numbers and no state carried from tick to tick (see src/sim/hazards/).
 *
 * Positions ("at", "from", "to") are in control-point units, like the other track
 * features: 3.5 = halfway between control points 3 and 4. `period` and `phase` are in
 * seconds of race time: the hazard repeats every `period` s, shifted by `phase`.
 */

/** Fields every hazard has. */
interface HazardBase {
  /** Seconds between the start of two cycles. */
  period: number;
  /** Shifts the cycle (s, default 0). Different phases make neighbouring hazards erupt one after another. */
  phase?: number;
}

/** Ember Peaks: a lava geyser. Warns for `warn` s (glowing crack), then erupts for `active` s. */
export interface GeyserDef extends HazardBase {
  kind: 'geyser';
  /** Position on the main road (control-point units). */
  at: number;
  /** Sideways position: -1 = left edge of the road, 0 = centre, 1 = right edge. Default 0. */
  offset?: number;
  /** Radius of the lava column (m, default 3). */
  radius?: number;
  /** Warning time before the eruption (s, default 1.5). */
  warn?: number;
  /** Eruption time (s, default 1.2). */
  active?: number;
}

/** Dockside Loop: a drawbridge over water (built by a later agent). */
export interface DrawbridgeDef extends HazardBase {
  kind: 'drawbridge';
  /** Ends of the bridge (control-point units). */
  from: number;
  to: number;
}

/** Cloud Garden: a gust of wind pushing karts sideways (built by a later agent). */
export interface GustDef extends HazardBase {
  kind: 'gust';
  from: number;
  to: number;
  /** +1 pushes to the right of the direction of travel, -1 to the left. */
  dir: 1 | -1;
  /** Sideways acceleration (m/s^2). */
  strength: number;
}

/** Switchback Summit: a snowball rolling across the road (built by a later agent). */
export interface RollerDef extends HazardBase {
  kind: 'roller';
  at: number;
  /** Which side it starts from: -1 = left of the road, 1 = right. Default 1. */
  from?: 1 | -1;
  radius?: number;
}

export type HazardDef = GeyserDef | DrawbridgeDef | GustDef | RollerDef;
export type HazardKind = HazardDef['kind'];
