/**
 * Escalators (Palm Plaza). Two parallel escalator lanes take the road down from the upper floor to the ground floor:
 * lane 0 is the main road, lane 1 a `deck` shortcut branch beside it. Each lane's surface MOVES:
 *
 *   riding WITH it   -> the kart is carried forward  `speed` m/s faster (about +30 % at top speed)
 *   riding AGAINST it -> the kart is carried backward `speed` m/s        (about -30 %)
 *   stopped          -> nothing
 *
 * Which way each one runs comes from a fixed TIMETABLE (`ESCALATOR_SCHEDULE`): a list of steps [lane 0, lane 1, seconds]
 * that repeats forever, so the state is a pure function of the race clock (no state, no random numbers) like every
 * hazard: the sim, the renderer, the bots and the tests all agree. Between two steps the belts ramp over `RAMP` seconds.
 *
 * The conveyor is applied as a displacement of the kart along the lane (the kart's own speed is untouched), only while
 * the kart is on the ground on the moving part of a lane. Respawning, flying and rocketing karts are not carried.
 *
 * Phases (for the sounds and the guide mascot): 'warn' during the last WARN seconds before the timetable changes (the
 * mascot waves, a chime plays), 'active' while a belt moves, 'idle' while both are stopped.
 */
import type { EscalatorDef } from '../../track/hazardTypes';
import type { KartConfig } from '../config';
import type { KartState } from '../kart';
import { CURB_WIDTH, type Track } from '../track';
import { wrap } from './cycle';
import type { Hazard, HazardPose } from './types';

/** Conveyor speed (m/s): about 30 % of a kart's top speed (28 m/s). */
export const ESCALATOR_SPEED = 8.5;
/** Seconds a belt takes to change speed or direction. */
export const RAMP = 1.0;
/** Seconds before a change of the timetable during which the mascot waves (and a chime plays). */
export const WARN = 2.5;
/**
 * The default timetable: [main lane, branch lane, seconds]. +1 = with the traffic, -1 = against, 0 = stopped.
 * One lane always helps and the other hinders, except for the two pauses when both stand still. 61 s in all, so a
 * kart lapping in ~52 s meets a different state each lap.
 */
export const ESCALATOR_SCHEDULE: [number, number, number][] = [
  [1, -1, 13],
  [-1, 1, 13],
  [0, 0, 6],
  [-1, 1, 9],
  [1, -1, 11],
  [0, 0, 5],
  [1, -1, 4],
];

/** A kart this far (m) above or below a lane's surface is not on it (an overpass, or in the air). */
const SAME_LEVEL = 2.5;

export interface EscalatorPose extends HazardPose {
  /** Belt velocity of each lane (m/s, + = with the traffic, i.e. downhill), already ramped. */
  lanes: [number, number];
  /** Timetable direction of each lane in the current step (+1, -1, 0). */
  dirs: [number, number];
  /** Which lane runs WITH the traffic right now (0 = main, 1 = branch), or -1 when neither does. */
  good: number;
  /** Seconds until the timetable changes. */
  changeIn: number;
  /** Belt travel (m) of each lane since the race clock's zero: drives the moving steps texture (pure, so it never jumps). */
  travel: [number, number];
}

export class Escalator implements Hazard {
  readonly kind = 'escalator' as const;
  /** Middle of the moving part (main-route distance) and half its length. */
  readonly s: number;
  readonly halfLength: number;
  /** Moving part of the main lane (main-route distance). */
  readonly s0: number;
  readonly s1: number;
  /** Route id of the branch lane, and its moving part (branch sample indices, inclusive). */
  readonly branchRoute: number;
  readonly b0: number;
  readonly b1: number;
  readonly speed: number;
  readonly schedule: [number, number, number][];
  /** Length of one turn of the timetable (s). */
  readonly cycle: number;
  /** Start time of each step within the cycle. */
  private readonly starts: number[];
  private readonly phase: number;

  constructor(
    readonly id: number,
    def: EscalatorDef,
    private readonly track: Track,
  ) {
    this.s0 = track.sAt(def.from);
    this.s1 = track.sAt(def.to);
    this.s = (this.s0 + this.s1) / 2;
    this.halfLength = (this.s1 - this.s0) / 2;
    this.speed = def.speed ?? ESCALATOR_SPEED;
    this.schedule = def.schedule ?? ESCALATOR_SCHEDULE;
    this.phase = def.phase ?? 0;
    this.starts = [];
    let t = 0;
    for (const step of this.schedule) {
      this.starts.push(t);
      t += step[2];
    }
    this.cycle = t;
    const b = track.branches[def.branch];
    if (!b) throw new Error('escalator: no branch ' + def.branch);
    this.branchRoute = b.route;
    const nearest = (x: number, z: number) => {
      let best = 0;
      let bd = Infinity;
      b.samples.forEach((p, i) => {
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      return best;
    };
    this.b0 = nearest(def.branchFrom[0], def.branchFrom[1]);
    this.b1 = nearest(def.branchTo[0], def.branchTo[1]);
  }

  /** Index of the timetable step at cycle clock `c` (0..cycle). */
  private stepAt(c: number): number {
    let i = this.starts.length - 1;
    while (i > 0 && this.starts[i] > c) i--;
    return i;
  }

  /** Belt velocity (m/s, + = with the traffic) of `lane` at race time `time`: the step's direction, ramped from the previous step's. */
  velocity(lane: 0 | 1, time: number): number {
    const c = wrap(time - this.phase, this.cycle);
    const i = this.stepAt(c);
    const prev = this.schedule[(i - 1 + this.schedule.length) % this.schedule.length];
    const into = c - this.starts[i];
    const u = Math.min(1, into / RAMP);
    const k = u * u * (3 - 2 * u);
    return this.speed * (prev[lane] + (this.schedule[i][lane] - prev[lane]) * k);
  }

  /**
   * Belt travel (m) of `lane` since time 0: the integral of the velocity (exact for the smoothstep ramps), so the drawn
   * steps move at the belt's speed and never jump. Pure function of time.
   */
  travel(lane: 0 | 1, time: number): number {
    const t = time - this.phase;
    const turns = Math.floor(t / this.cycle);
    let perCycle = 0;
    const stepTravel = (i: number, upTo: number) => {
      // Integral over the first `upTo` seconds of step i: the ramp (smoothstep: average 1/2 over RAMP) then the steady part.
      const prev = this.schedule[(i - 1 + this.schedule.length) % this.schedule.length][lane];
      const cur = this.schedule[i][lane];
      const r = Math.min(upTo, RAMP);
      const u = r / RAMP;
      // integral of smoothstep from 0 to u = u^3 - u^4 / 2 (times RAMP)
      const ramp = RAMP * (u ** 3 - u ** 4 / 2);
      return this.speed * (prev * r + (cur - prev) * ramp + cur * Math.max(0, upTo - RAMP));
    };
    for (let i = 0; i < this.schedule.length; i++) perCycle += stepTravel(i, this.schedule[i][2]);
    const c = t - turns * this.cycle;
    const i = this.stepAt(c);
    let inCycle = 0;
    for (let j = 0; j < i; j++) inCycle += stepTravel(j, this.schedule[j][2]);
    inCycle += stepTravel(i, c - this.starts[i]);
    return turns * perCycle + inCycle;
  }

  pose(time: number): EscalatorPose {
    const c = wrap(time - this.phase, this.cycle);
    const i = this.stepAt(c);
    const step = this.schedule[i];
    const changeIn = this.starts[i] + step[2] - c;
    const lanes: [number, number] = [this.velocity(0, time), this.velocity(1, time)];
    const moving = step[0] !== 0 || step[1] !== 0;
    const phase = changeIn <= WARN ? 'warn' : moving ? 'active' : 'idle';
    return {
      phase,
      t: phase === 'warn' ? 1 - changeIn / WARN : (c - this.starts[i]) / step[2],
      lanes,
      dirs: [step[0], step[1]],
      good: step[0] > 0 ? 0 : step[1] > 0 ? 1 : -1,
      changeIn,
      travel: [this.travel(0, time), this.travel(1, time)],
    };
  }

  /** Which lane (0 = main road, 1 = branch) a kart at (x, z) on the ground is riding, and the lane's direction there; null = not on a moving part. */
  laneAt(k: Pick<KartState, 'pos' | 'trackIndex'>): { lane: 0 | 1; tx: number; tz: number } | null {
    const p = this.track.project(k.pos.x, k.pos.z, k.trackIndex);
    if (Math.abs(k.pos.y - p.y) > SAME_LEVEL) return null;
    if (Math.abs(p.d) > p.width / 2 + CURB_WIDTH) return null;
    if (p.route === 0) {
      if (this.track.deltaS(this.s0, p.s) < 0 || this.track.deltaS(p.s, this.s1) < 0) return null;
      const q = this.track.sampleOf(0, p.i);
      return { lane: 0, tx: q.tx, tz: q.tz };
    }
    if (p.route === this.branchRoute && p.i >= this.b0 && p.i <= this.b1) {
      const q = this.track.sampleOf(p.route, p.i);
      return { lane: 1, tx: q.tx, tz: q.tz };
    }
    return null;
  }

  affect(k: KartState, time: number, dt: number, _c: KartConfig): 'hit' | 'push' | null {
    if (k.respawnTime > 0 || k.flight || k.rocketTime > 0 || !k.grounded) return null;
    const on = this.laneAt(k);
    if (!on) return null;
    const v = this.velocity(on.lane, time);
    if (v === 0) return null;
    // The belt carries the kart along the lane (downhill = forward). The kart's own speed is not changed.
    k.pos.x += on.tx * v * dt;
    k.pos.z += on.tz * v * dt;
    return 'push';
  }

  /** The escalators never block a lane in the hazard sense: the bots choose a lane with `bestLane` instead. */
  danger(): number {
    return 0;
  }

  /**
   * Which lane is quicker for a kart that reaches the top in `arriveIn` seconds and needs about `ride` seconds to get
   * down: the average belt velocity of each lane over that ride. Returns 0 (main), 1 (branch) or -1 (no difference).
   */
  bestLane(time: number, arriveIn: number, ride: number): 0 | 1 | -1 {
    let a = 0;
    let b = 0;
    const n = 6;
    for (let k = 0; k <= n; k++) {
      const t = time + arriveIn + (ride * k) / n;
      a += this.velocity(0, t);
      b += this.velocity(1, t);
    }
    if (Math.abs(a - b) < 0.5 * n) return -1;
    return a > b ? 0 : 1;
  }
}
