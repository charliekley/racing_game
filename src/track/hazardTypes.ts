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

/**
 * Autumn Speedway: a big acorn beetle that marches back and forth across the road (and out over the verges)
 * at `at`, one crossing every `period / 2` seconds. Bumping into it bounces your kart back hard, but it does
 * not spin you out. It is always there (no warning phase): you see it coming and time your line.
 */
export interface BeetleDef extends HazardBase {
  kind: 'beetle';
  at: number;
  /** How far (m) from the road centre it walks to either side. Default: road half width + 4. */
  span?: number;
  /** Body radius (m, default 1.7). */
  radius?: number;
}

/**
 * Palm Plaza: a pair of parallel escalators going down between two floors. The main road is one lane (its moving part is
 * `from`..`to`), the other lane is the `deck` shortcut `branch` (its moving part is between the branch samples nearest to
 * the world points `branchFrom` and `branchTo`). Each escalator's surface moves: riding WITH it adds `speed` m/s along the
 * lane, AGAINST it takes `speed` m/s away, stopped does nothing. Which way each one runs follows a fixed timetable
 * (`schedule`, a pure function of the race clock; see sim/hazards/escalator.ts). It never spins anyone out.
 */
export interface EscalatorDef {
  kind: 'escalator';
  /** Unused (the timetable sets the rhythm); kept so every hazard has one. Use the timetable's total length. */
  period: number;
  phase?: number;
  /** Moving part of the main-road lane (control-point units). */
  from: number;
  to: number;
  /** Index into `shortcuts` of the second lane (a `deck` branch running beside the main road). */
  branch: number;
  /** World points [x, z] where the second lane's moving part starts and ends. */
  branchFrom: [number, number];
  branchTo: [number, number];
  /** Conveyor speed (m/s, default ESCALATOR_SPEED). */
  speed?: number;
  /**
   * Timetable: [main lane, branch lane, seconds] steps; +1 = runs with the traffic (down), -1 = against it, 0 = stopped.
   * Repeats forever. Default ESCALATOR_SCHEDULE.
   */
  schedule?: [number, number, number][];
}

/**
 * Palm Plaza's parking lot: a lane of cars driving straight across the road at `at`, from a garage gate on one side to
 * a gate on the other (`dir` +1 = from the left of the road to the right). `cars` cars, evenly spaced in time, each
 * crossing once per `period`; outside the gates a car is hidden (it is "in the garage"). A car is solid: hitting one
 * flips the kart over (a spin-out with a hop). Pure function of the race clock.
 */
export interface CarDef extends HazardBase {
  kind: 'car';
  at: number;
  dir: 1 | -1;
  /** Driving speed (m/s, default 9). */
  speed?: number;
  /** How many cars use this lane (default 1). */
  cars?: number;
  /** Distance (m) from the road centre to each garage gate (default road half width + 16). */
  reach?: number;
}

export type HazardDef = GeyserDef | DrawbridgeDef | GustDef | RollerDef | BeetleDef | EscalatorDef | CarDef;
export type HazardKind = HazardDef['kind'];
