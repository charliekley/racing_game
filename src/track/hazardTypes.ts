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

/**
 * Dockside Loop: a drawbridge over water. Two leaves hinged at the outer ends of the span
 * (`from` and `to`). Cycle: down (flat road) -> bell + lights (`warn`) -> rising -> up -> lowering.
 * While up each leaf is a kicker ramp with an open gap between the two tips (see sim/hazards/drawbridge.ts).
 */
export interface DrawbridgeDef extends HazardBase {
  kind: 'drawbridge';
  /** Ends of the bridge (control-point units): the two hinges. The road between them must be straight and level. */
  from: number;
  to: number;
  /** Width (m) of the opening between the two tips when fully up. Default DRAWBRIDGE_GAP. */
  gap?: number;
  /** Height (m) of each tip when fully up. Default DRAWBRIDGE_LIFT. */
  lift?: number;
  /** Bell and flashing lights before the leaves move (s, default 2). */
  warn?: number;
  /** Time the leaves take to rise (s, default 2). */
  rise?: number;
  /** Time the bridge stays fully up (s, default 4). */
  hold?: number;
  /** Time the leaves take to come down (s, default 2). */
  lower?: number;
}

/** Default opening between the tips (m) and tip height (m) of a raised drawbridge. */
export const DRAWBRIDGE_GAP = 12;
export const DRAWBRIDGE_LIFT = 3.8;

/** Cloud Garden: a gust of wind pushing karts sideways while it is active, on the stretch `from`..`to`. */
export interface GustDef extends HazardBase {
  kind: 'gust';
  from: number;
  to: number;
  /** +1 pushes to the right of the direction of travel, -1 to the left. */
  dir: 1 | -1;
  /** Peak sideways acceleration (m/s^2). A kart that does not steer drifts sideways at about strength / 9 m/s. */
  strength: number;
  /** Warning time (s, default 1.5): wind streaks and a rising whistle. */
  warn?: number;
  /** Time the wind blows (s, default 1.5). */
  active?: number;
}

/** Switchback Summit: a snowball rolling down the slope and across the road. */
export interface RollerDef extends HazardBase {
  kind: 'roller';
  at: number;
  /** Which side it starts from: -1 = left of the road, 1 = right. Default 1. */
  from?: 1 | -1;
  radius?: number;
}

export type HazardDef = GeyserDef | DrawbridgeDef | GustDef | RollerDef;
export type HazardKind = HazardDef['kind'];
