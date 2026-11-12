/**
 * Drawbridge (Dockside Loop): a 50 m span over the water with two leaves hinged at its outer ends.
 *
 *   down (flat road) -> warn (bell + flashing lights, ~2 s) -> rising -> up -> lowering -> down ...
 *
 * While the leaves are raised each one is a KICKER RAMP and between the two tips there is an
 * opening over the water (`ground = null`, so a kart there falls and is carried back: the normal
 * respawn). A fast kart flies the opening off the leaf; a slow one drops in.
 *
 * How the sim sees it (all numbers along the road, `a` = metres from hinge A):
 *
 *      hinge A                                              hinge B
 *        |==== leaf A ====\          opening          /==== leaf B ====|
 *        0               reachA                    span - reach        span
 *
 * - `lift` (0..1) is the whole animation: 0 = flat, 1 = fully up. It is a pure function of the race clock.
 * - The reach of a leaf shrinks from half the span (the two tips touch when down) to
 *   `(span - gap) / 2` when up, like a rolling-lift bascule bridge that also rolls back as it rises.
 * - The leaf surface is a straight wedge: height = tipHeight * u / reach, tipHeight = lift * DRAWBRIDGE_LIFT.
 *
 * The static track already has the opening as a water gap (Track adds it for every drawbridge), so
 * the road mesh stops there. `groundAt` puts the road back while the leaves are down, and lifts the
 * leaf surfaces while they are up. The span must be straight and level (Dockside points 57 to 60).
 *
 * Fair play: with the default numbers (opening 12 m, slope 0.2) a kart needs about 26 m/s to clear
 * the opening (top speed is 28, a boost pad gives 37). A kart that just falls short is bounced off
 * the far leaf's end face (see `affect`) instead of being teleported up onto it.
 */
import { DRAWBRIDGE_GAP, DRAWBRIDGE_LIFT, type DrawbridgeDef } from '../../track/hazardTypes';
import { KART, type KartConfig } from '../config';
import type { KartState } from '../kart';
import { CURB_WIDTH, type Track } from '../track';
import { cyclePose } from './cycle';
import type { Hazard, HazardPose } from './types';

/** A kart that is lifted by more than this (m) in ONE tick while on the bridge was snapped up onto a leaf's end face. */
const SNAP_UP = 0.6;
/** Seconds either side of its arrival time that a bot treats the bridge as "might be moving". */
const DANGER_MARGIN = 0.6;
/** Bots at least this fast (relative to the speed that clears the opening) commit and jump instead of waiting. */
const BOT_COMMIT = 1;

const smoothstep = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};

/** The fixed geometry of one bridge, in world coordinates. The view builds its meshes from this. */
export interface BridgeFrame {
  /** World position of hinge A on the road surface, and of hinge B. */
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  /** Unit direction of travel (horizontal), from A to B. */
  tx: number;
  tz: number;
  /** Unit vector to the right of the direction of travel. */
  rx: number;
  rz: number;
  /** Length of the span (m) and the half width of the drivable deck including the curbs (m). */
  span: number;
  halfWidth: number;
}

export class Drawbridge implements Hazard {
  readonly kind = 'drawbridge' as const;
  /** Main-route distance of the middle of the span. */
  readonly s: number;
  /** Half the span length (m): bots see the bridge from this far out on each side of `s`. */
  readonly halfLength: number;
  readonly frame: BridgeFrame;
  /** Opening between the tips when fully up (m), and the tip height (m). */
  readonly gap: number;
  readonly liftHeight: number;
  /** Horizontal reach of a leaf when down and when up (m). */
  readonly reachDown: number;
  readonly reachUp: number;
  private readonly period: number;
  private readonly phase: number;
  private readonly warn: number;
  private readonly rise: number;
  private readonly hold: number;
  private readonly lower: number;
  /** Where each kart was (height) at the previous tick: used to spot a kart snapped up onto a leaf's end face. */
  private readonly lastY = new WeakMap<KartState, number>();

  constructor(
    readonly id: number,
    def: DrawbridgeDef,
    private readonly track: Track,
  ) {
    this.period = def.period;
    this.phase = def.phase ?? 0;
    this.warn = def.warn ?? 2;
    this.rise = def.rise ?? 2;
    this.hold = def.hold ?? 4;
    this.lower = def.lower ?? 2;
    this.gap = def.gap ?? DRAWBRIDGE_GAP;
    this.liftHeight = def.lift ?? DRAWBRIDGE_LIFT;
    const sA = track.sAt(def.from);
    const sB = track.sAt(def.to);
    this.s = (sA + sB) / 2;
    const a = track.pointAt(sA);
    const b = track.pointAt(sB);
    const span = Math.hypot(b.x - a.x, b.z - a.z);
    const tx = (b.x - a.x) / span;
    const tz = (b.z - a.z) / span;
    this.halfLength = span / 2;
    this.reachDown = span / 2;
    this.reachUp = (span - this.gap) / 2;
    this.frame = {
      ax: a.x,
      ay: a.y,
      az: a.z,
      bx: b.x,
      by: b.y,
      bz: b.z,
      tx,
      tz,
      rx: -tz, // right of travel = the tangent turned 90 degrees clockwise seen from above (see rightOf in kart.ts)
      rz: tx,
      span,
      halfWidth: track.def.width / 2 + CURB_WIDTH,
    };
  }

  /** How far up the leaves are (0 = flat, 1 = fully up) at race time `time`. */
  lift(time: number): number {
    const c = cyclePose(time, this.period, this.phase, this.warn, this.rise + this.hold + this.lower);
    if (c.phase !== 'active') return 0;
    const into = c.t * (this.rise + this.hold + this.lower);
    if (into < this.rise) return smoothstep(into / this.rise);
    if (into < this.rise + this.hold) return 1;
    return 1 - smoothstep((into - this.rise - this.hold) / this.lower);
  }

  /** Horizontal reach (m) and tip height (m) of each leaf at a given lift. */
  leafAt(lift: number): { reach: number; tipHeight: number } {
    return { reach: this.reachDown + (this.reachUp - this.reachDown) * lift, tipHeight: this.liftHeight * lift };
  }

  pose(time: number): HazardPose {
    const c = cyclePose(time, this.period, this.phase, this.warn, this.rise + this.hold + this.lower);
    const lift = this.lift(time);
    const { reach, tipHeight } = this.leafAt(lift);
    // `moving` = the leaves are between down and up; `flash` = the warning lights run (warn and the whole active phase).
    return { phase: c.phase, t: c.t, lift, reach, tipHeight, flash: c.phase !== 'idle', moving: lift > 0 && lift < 1 };
  }

  /**
   * Height (m) of the lowered road `u` metres from hinge A and `lateral` metres to the right of the centre line: the static
   * road at the two hinges (it is banked a little on the set-up curve), blended along the span. The view uses it too.
   */
  roadHeight(u: number, lateral = 0): number {
    const f = this.frame;
    const hA = this.track.sample(f.ax + f.rx * lateral, f.az + f.rz * lateral)?.height ?? f.ay;
    const hB = this.track.sample(f.bx + f.rx * lateral, f.bz + f.rz * lateral)?.height ?? f.by;
    return hA + ((hB - hA) * u) / f.span;
  }

  /**
   * The ground the leaves make. `u` = metres along the span from hinge A.
   *  - lift 0: the road itself, flat (the static track has a hole there, so it is filled in here);
   *  - otherwise each leaf is a wedge from its hinge up to its tip and between the tips there is nothing (null).
   */
  groundAt(x: number, z: number, time: number): number | null | undefined {
    const f = this.frame;
    const dx = x - f.ax;
    const dz = z - f.az;
    const u = dx * f.tx + dz * f.tz; // along the span
    if (u < 0 || u > f.span) return undefined;
    const lateral = dx * f.rx + dz * f.rz;
    if (Math.abs(lateral) > f.halfWidth) return undefined; // beside the deck: the static track decides (walls, drop)
    const roadY = this.roadHeight(u, lateral);
    const { reach, tipHeight } = this.leafAt(this.lift(time));
    if (u <= reach) return roadY + (tipHeight * u) / reach; // leaf A
    if (u >= f.span - reach) return roadY + (tipHeight * (f.span - u)) / reach; // leaf B
    return null; // the opening
  }

  /**
   * A kart that falls just short of the far leaf would be snapped UP onto its end face by the ground
   * following (the face is a step of up to a few metres). Undo that: the kart bumps into the end face
   * and drops into the water instead. Reported as a 'hit' once (sound), then it just falls and respawns.
   */
  affect(k: KartState, time: number, _dt: number, _c: KartConfig): 'hit' | 'push' | null {
    const prevY = this.lastY.get(k);
    this.lastY.set(k, k.pos.y);
    if (prevY === undefined || k.respawnTime > 0 || k.flight || !k.grounded) return null;
    if (k.pos.y - prevY < SNAP_UP) return null;
    // Only the end faces matter: the kart must be next to a tip, while the bridge is (partly) up.
    const f = this.frame;
    const dx = k.pos.x - f.ax;
    const dz = k.pos.z - f.az;
    const u = dx * f.tx + dz * f.tz;
    const { reach } = this.leafAt(this.lift(time));
    if (reach >= this.reachDown - 0.01) return null;
    const nearFar = Math.abs(u - (f.span - reach)) < Math.abs(u - reach); // which tip are we next to?
    const tipU = nearFar ? f.span - reach : reach;
    if (Math.abs(u - tipU) > 3 || Math.abs(dx * f.rx + dz * f.rz) > f.halfWidth) return null;
    // Bounce back over the opening (1.5 m from the tip), stall the engine and let go of the ground: gravity does the rest.
    const back = (nearFar ? tipU - 1.5 : tipU + 1.5) - u;
    k.pos.x += f.tx * back;
    k.pos.z += f.tz * back;
    k.grounded = false;
    k.pos.y = prevY;
    k.vel.y = -3;
    k.speed = -2;
    k.boostTime = 0;
    k.stallTime = 1;
    return 'hit';
  }

  /**
   * Is the bridge a danger to a kart of main-route distance `s` that arrives `ahead` s from now?
   * Yes while it is moving or up, and during the warning (it is about to move).
   * Lateral position does not matter: the whole road is cut.
   */
  danger(_s: number, _d: number, time: number, ahead: number): number {
    const t = time + ahead;
    for (const dt of [-DANGER_MARGIN, 0, DANGER_MARGIN]) {
      if (cyclePose(t + dt, this.period, this.phase, this.warn, this.rise + this.hold + this.lower).phase !== 'idle') return 1;
    }
    return 0;
  }

  /** Speed (m/s) at which a kart clears the opening of the fully raised bridge (ballistic estimate, see `jumps.ts`). */
  clearSpeed(): number {
    // Slope of a leaf, and the time to cross the opening at speed v: t = gap / v.
    // Height relative to the far tip when it arrives there: slope * gap - (gravity / 2) * gap^2 / v^2.
    const slope = this.liftHeight / this.reachUp;
    const g = this.gap;
    const tolerance = 0.6; // less than this below the far tip counts as a clean catch
    const need = ((KART.gravity / 2) * g * g) / (slope * g + tolerance);
    return Math.sqrt(need);
  }

  /** Bots: a kart that is fast enough (or boosting) jumps the opening instead of waiting for the leaves to come down. */
  botCommits(speed: number, boosting: boolean): boolean {
    return boosting || speed >= this.clearSpeed() * BOT_COMMIT;
  }
}
