/**
 * Rolling snowball (Switchback Summit). Once per `period` a snowball starts up the open slope beside
 * the road, rolls down it, crosses the road and rolls off the far side, where it bursts into snow:
 *
 *   idle (no ball) -> warn (~1.5 s: the ball is visible up the slope, rumbling towards the road)
 *                  -> active (it crosses the road in about 1.3 s, rolls off, bursts)
 *
 * The path is a straight line across the road (along the road's sideways direction) at distance `s`.
 * Along it the ball speeds up like a real ball on a slope (constant acceleration), so the distance
 * it has rolled after `t` seconds is   d(t) = V0 * t + 0.5 * ACCEL * t^2.   It also grows a little as it
 * picks up snow. Everything is a PURE function of the race clock, like every hazard.
 *
 * A kart touching the ball spins out (`spinOut`, which also gives hit protection) and is shoved
 * in the direction the ball is rolling. The ball is only dangerous while it exists (not once it bursts).
 */
import type { RollerDef } from '../../track/hazardTypes';
import { spinOut, type KartState } from '../kart';
import type { KartConfig } from '../config';
import type { Track } from '../track';
import { cyclePose } from './cycle';
import type { Hazard, HazardPose } from './types';

/** Speed (m/s) the ball has at the start of its path, and how fast it speeds up (m/s^2). */
const V0 = 6;
const ACCEL = 2;
/** Seconds between the ball appearing and reaching the road edge: the telegraph. */
const WARN = 1.5;
/** How long (s) the ball takes to burst after it leaves the far side. */
const BURST = 0.45;
/** The ball ends this far (m) beyond the far road edge. */
const RUN_OUT = 5;
/** The ball grows by this fraction of its radius over the whole path. */
const GROWTH = 0.25;
/** A kart counts as touching the ball when its centre is within radius + this (m). */
const KART_REACH = 0.8;
/** Sideways speed (m/s) a hit adds to the kart, in the direction the ball rolls. */
const SHOVE = 7;
/** Default ball radius at the start (m). */
const DEFAULT_RADIUS = 1.5;

/** Distance (m) rolled after `t` seconds. */
const rolled = (t: number) => V0 * t + 0.5 * ACCEL * t * t;
/** Inverse of `rolled`: seconds needed to roll `d` metres. */
const timeFor = (d: number) => (-V0 + Math.sqrt(V0 * V0 + 2 * ACCEL * d)) / ACCEL;

export class Roller implements Hazard {
  readonly kind = 'roller' as const;
  readonly s: number;
  readonly radius: number;
  /** Direction the ball rolls in the world (unit vector in the XZ plane). */
  readonly dirX: number;
  readonly dirZ: number;
  private readonly period: number;
  private readonly phase: number;
  /** Length of the active phase (s): crossing, rolling off and bursting. */
  private readonly active: number;
  /** Which side the ball starts on (+1 = right of the road, -1 = left). */
  private readonly side: number;
  /** Length of the whole path (m) and the sideways offset (from the road centre, towards the start side) where it starts. */
  private readonly pathLength: number;
  private readonly startU: number;
  /** Road centre at `s` and the unit vector pointing right of the road. */
  private readonly base: { x: number; z: number; rx: number; rz: number };
  /** Ground height every metre along the path (index 0 = start of the path). */
  private readonly heights: number[];

  constructor(
    readonly id: number,
    def: RollerDef,
    private readonly track: Track,
  ) {
    this.period = def.period;
    this.phase = def.phase ?? 0;
    this.radius = def.radius ?? DEFAULT_RADIUS;
    this.side = (def.from ?? 1) < 0 ? -1 : 1;
    this.s = track.sAt(def.at);

    const half = track.def.width / 2;
    const edge = half + this.radius; // sideways position (from the centre) where the ball touches the road
    this.startU = edge + rolled(WARN);
    const endU = -(half + this.radius + RUN_OUT);
    this.pathLength = this.startU - endU;
    this.active = timeFor(this.pathLength) - WARN + BURST;

    // Road centre and sideways unit vector at s (pointAt(s, 1) is one metre to the right).
    const c = track.pointAt(this.s, 0);
    const r = track.pointAt(this.s, 1);
    this.base = { x: c.x, z: c.z, rx: r.x - c.x, rz: r.z - c.z };
    // The ball rolls from the start side towards the other side.
    this.dirX = -this.side * this.base.rx;
    this.dirZ = -this.side * this.base.rz;

    // Ground height under the path (terrain on the slope, road surface on the road), sampled once.
    this.heights = [];
    for (let d = 0; d <= Math.ceil(this.pathLength); d++) {
      const u = this.startU - Math.min(d, this.pathLength);
      const p = track.pointAt(this.s, this.side * u);
      this.heights.push(track.sample(p.x, p.z, c.index)?.height ?? c.y);
    }
  }

  private groundAtDistance(d: number): number {
    const f = Math.min(Math.max(d, 0), this.pathLength);
    const i = Math.min(this.heights.length - 2, Math.floor(f));
    const w = f - i;
    return this.heights[i] * (1 - w) + this.heights[i + 1] * w;
  }

  /** The ball at race time `time`: where it is, or `present: false` when there is none. */
  private ball(time: number) {
    const c = cyclePose(time, this.period, this.phase, WARN, this.active);
    if (c.phase === 'idle') return { phase: c.phase, t: c.t, present: false as const };
    // Seconds since the ball appeared; the path ends (and the burst starts) at `end`.
    const since = c.phase === 'warn' ? c.t * WARN : WARN + c.t * this.active;
    const end = timeFor(this.pathLength);
    const bursting = since > end;
    const d = Math.min(rolled(since), this.pathLength);
    const radius = this.radius * (1 + GROWTH * (d / this.pathLength));
    const lat = this.side * (this.startU - d); // sideways position on the road (m, + = right)
    return {
      phase: c.phase,
      t: c.t,
      present: true as const,
      bursting,
      burst: bursting ? Math.min(1, (since - end) / BURST) : 0,
      d,
      radius,
      lat,
      x: this.base.x + this.base.rx * lat,
      y: this.groundAtDistance(d) + radius,
      z: this.base.z + this.base.rz * lat,
    };
  }

  pose(time: number): HazardPose {
    const b = this.ball(time);
    if (!b.present) return { phase: b.phase, t: b.t, present: false };
    return {
      phase: b.phase,
      t: b.t,
      present: true,
      x: b.x,
      y: b.y,
      z: b.z,
      radius: b.radius,
      // Rolled angle (rad): the view turns the ball by this much around the axis across its direction.
      roll: b.d / b.radius,
      dirX: this.dirX,
      dirZ: this.dirZ,
      // 0 while rolling, 0..1 while it bursts into snow.
      burst: b.burst,
      lat: b.lat,
    };
  }

  affect(k: KartState, time: number, _dt: number, c: KartConfig): 'hit' | 'push' | null {
    if (k.respawnTime > 0 || k.flight || k.invulnTime > 0) return null;
    const b = this.ball(time);
    if (!b.present || b.bursting) return null;
    if (Math.hypot(k.pos.x - b.x, k.pos.z - b.z) > b.radius + KART_REACH) return null;
    // Height: a kart flying well over the ball (or on a road far below) is safe.
    if (k.pos.y > b.y + b.radius + 0.3 || k.pos.y < b.y - b.radius - 3) return null;
    if (k.starTime > 0) return null; // Nova (invincibility) smashes through
    spinOut(k, c);
    k.vel.x += this.dirX * SHOVE; // knocked sideways, the way the ball was rolling
    k.vel.z += this.dirZ * SHOVE;
    return 'hit';
  }

  danger(s: number, d: number, time: number, ahead: number): number {
    if (Math.abs(this.track.deltaS(this.s, s)) > this.radius + 2) return 0;
    // Where will the ball be when the kart gets here? Look a little either side of that moment.
    for (const dt of [-0.3, -0.15, 0, 0.15, 0.3]) {
      const b = this.ball(time + ahead + dt);
      if (!b.present || b.bursting) continue;
      if (Math.abs(d - b.lat) < b.radius + KART_REACH + 0.8) return 1;
    }
    return 0;
  }
}
