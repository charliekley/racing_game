/**
 * Parking-deck traffic (Palm Plaza). Cars drive ALONG the road between two points of the main road (`from`..`to`), with
 * the race (`dir` +1) or against it (-1, from `to` back to `from`), slower than the karts. A car always holds ONE half of
 * the road, the left or the right (`sides`, one entry per equal part of its drive, in its own driving order), so a kart
 * has to steer round it through the other half; where its side changes it puts its indicators on for INDICATE metres
 * first and then swings over within SWING metres. It drives out of a garage gate beside the road at the start of its
 * drive and into one at the end (GATE metres each), and stays hidden in the garages until its next turn:
 *
 *   u = time since the car left its gate (0 .. period);  travel = speed * u;  hidden once travel > the stretch's length.
 *
 * A pure function of the race clock, like every hazard. A car is a solid box (CAR_LENGTH x CAR_WIDTH). Driving into one
 * (or being driven into) FLIPS the kart: a spin-out plus a hop (`FLIP_POP` m/s up) and a shove along the car's way; the
 * renderer rolls the kart over once in the air (kartView `startFlip`). Nova (star) karts drive through; a kart that is
 * still invulnerable after a hit is only pushed out of the car. Respawning, flying and rocketing karts are safe.
 *
 * Phases: 'active' while any car of the stretch is on the road, 'idle' otherwise (no warning phase: the cars are in plain
 * sight and signal before they change sides). Bots ask `dangerFor` (where will this car be when I reach it?).
 */
import type { CarDef } from '../../track/hazardTypes';
import type { KartConfig } from '../config';
import { spinOut, type KartState } from '../kart';
import type { Track } from '../track';
import { wrap } from './cycle';
import type { Hazard, HazardPose } from './types';

/** Car body (m): length along its way, width. */
export const CAR_LENGTH = 4.4;
export const CAR_WIDTH = 2.0;
/** Kart "radius" added to the car's box for contact (m). */
const KART_REACH = 0.85;
/** Upward speed (m/s) of a kart flipped by a car, and the shove (m/s) along the car's direction. */
export const FLIP_POP = 7.5;
const SHOVE = 7;
/** Height of a car (m): a kart flying higher than this over its roof passes. */
const HEIGHT = 1.6;
/** Default driving speed (m/s): well under a kart's top speed (28 m/s). */
export const CAR_SPEED = 12;
/** Default distance (m) from the road centre to the middle of a car's half of the road. */
export const CAR_LANE = 4.2;
/** Metres a car signals before it changes sides, and the metres it takes to swing over. */
export const INDICATE = 30;
export const SWING = 16;
/** Metres of driving out of / into a garage gate at each end (from the gate beside the road onto its half, and back). */
export const GATE = 18;
/** Distance (m) from the road centre to the garage gates' doors. */
export const GATE_LAT = 15.5;

export interface CarState {
  /** Sideways position (m from the road centre, + = the race's right) and whether it is out of the garages. */
  lat: number;
  visible: boolean;
  x: number;
  y: number;
  z: number;
  /** Unit direction it drives in (world x, z). */
  fx: number;
  fz: number;
  /** Main-route distance of the car (m). */
  s: number;
  /** Indicators: -1 = left, +1 = right (seen from the car, i.e. towards the side it is moving to), 0 = off. */
  blink: number;
}

const smooth = (u: number) => {
  const v = Math.max(0, Math.min(1, u));
  return v * v * (3 - 2 * v);
};

export class Car implements Hazard {
  readonly kind = 'car' as const;
  /** Middle of the stretch (main-route distance) and half its length: the bots see the whole stretch. */
  readonly s: number;
  readonly halfLength: number;
  /** The stretch (main-route distance, s0 < s1 along the race; may wrap) and its length. */
  readonly s0: number;
  readonly s1: number;
  readonly length: number;
  readonly dir: 1 | -1;
  readonly speed: number;
  readonly count: number;
  readonly period: number;
  readonly lane: number;
  readonly sides: (1 | -1)[];
  private readonly phase: number;

  constructor(
    readonly id: number,
    def: CarDef,
    private readonly track: Track,
  ) {
    this.s0 = track.sAt(def.from);
    this.s1 = track.sAt(def.to);
    this.length = track.deltaS(this.s0, this.s1);
    if (this.length < 2 * GATE + 20) throw new Error('car stretch: too short');
    this.s = this.s0 + this.length / 2;
    this.halfLength = this.length / 2;
    this.dir = def.dir;
    this.speed = def.speed ?? CAR_SPEED;
    this.count = def.cars ?? 1;
    this.period = def.period;
    this.phase = def.phase ?? 0;
    this.lane = def.lane ?? CAR_LANE;
    this.sides = def.sides;
    if (this.length / this.speed > this.period) throw new Error('car stretch: the period is shorter than a drive');
    if ((this.speed * this.period) / this.count < 30) throw new Error('car stretch: cars would be closer than 30 m');
  }

  /** Side of the road (+-1, the race's right = +1) of a car that has driven `b` metres of its drive, and its indicator. */
  private sideAt(b: number): { lat: number; blink: number } {
    const n = this.sides.length;
    const part = this.length / n;
    const k = Math.max(0, Math.min(n - 1, Math.floor(b / part)));
    let lat = this.sides[k] * this.lane;
    let blink = 0;
    // Swing over to the next part's side over the first SWING metres of that part (signalled INDICATE metres before).
    if (k > 0 && this.sides[k] !== this.sides[k - 1]) {
      const into = b - k * part;
      lat = this.lane * (this.sides[k - 1] + (this.sides[k] - this.sides[k - 1]) * smooth(into / SWING));
      if (into < SWING) blink = this.sides[k];
    }
    if (k + 1 < n && this.sides[k + 1] !== this.sides[k] && (k + 1) * part - b < INDICATE) blink = this.sides[k + 1];
    // Out of the gate at the start and into the one at the end (on the side of the first / last part).
    const gateIn = 1 - smooth(b / GATE);
    const gateOut = smooth((b - (this.length - GATE)) / GATE);
    if (gateIn > 0) lat += (this.sides[0] * GATE_LAT - lat) * gateIn;
    if (gateOut > 0) {
      lat += (this.sides[n - 1] * GATE_LAT - lat) * gateOut;
      blink = this.sides[n - 1];
    }
    // (The sides are the race's; a car driving against the race sees them mirrored: its indicator flips.)
    return { lat, blink: blink * this.dir };
  }

  /** Main-route distance and lateral offset of a car `b` metres into its drive. */
  private placeAt(b: number): { s: number; lat: number; blink: number } {
    const side = this.sideAt(b);
    const s = this.dir > 0 ? this.s0 + b : this.s0 + this.length - b;
    return { s, lat: side.lat, blink: side.blink };
  }

  /** How far into its drive car `k` is at `time` (may be beyond the stretch: then it is in the garage). */
  private travel(k: number, time: number): number {
    return this.speed * wrap(time - this.phase - (k * this.period) / this.count, this.period);
  }

  /** Every car of the stretch at race time `time`. */
  cars(time: number): CarState[] {
    const out: CarState[] = [];
    for (let k = 0; k < this.count; k++) {
      const b = this.travel(k, time);
      const visible = b <= this.length;
      const bb = Math.min(b, this.length);
      const a = this.placeAt(bb);
      const q = this.placeAt(Math.min(this.length, bb + 0.5));
      const p0 = this.track.pointAt(a.s, a.lat);
      // Direction: towards a point a little further on its drive (the end of the drive looks back a little instead).
      let p1 = this.track.pointAt(q.s, q.lat);
      let sgn = 1;
      if (bb + 0.5 > this.length) {
        const r = this.placeAt(bb - 0.5);
        p1 = this.track.pointAt(r.s, r.lat);
        sgn = -1;
      }
      const dx = (p1.x - p0.x) * sgn;
      const dz = (p1.z - p0.z) * sgn;
      const l = Math.hypot(dx, dz) || 1;
      out.push({ lat: a.lat, visible, x: p0.x, y: p0.y, z: p0.z, fx: dx / l, fz: dz / l, s: a.s, blink: visible ? a.blink : 0 });
    }
    return out;
  }

  pose(time: number): HazardPose {
    const cars = this.cars(time);
    return { phase: cars.some((c) => c.visible) ? 'active' : 'idle', t: wrap(time - this.phase, this.period) / this.period, cars };
  }

  affect(k: KartState, time: number, _dt: number, c: KartConfig): 'hit' | 'push' | null {
    if (k.respawnTime > 0 || k.flight || k.rocketTime > 0 || k.starTime > 0) return null;
    for (const car of this.cars(time)) {
      if (!car.visible) continue;
      if (k.pos.y > car.y + HEIGHT || k.pos.y < car.y - 3) continue; // over its roof, or on another level
      // Kart in the car's frame: `along` its way, `side` across it.
      const dx = k.pos.x - car.x;
      const dz = k.pos.z - car.z;
      const along = dx * car.fx + dz * car.fz;
      const side = dx * -car.fz + dz * car.fx;
      const ha = CAR_LENGTH / 2 + KART_REACH;
      const hs = CAR_WIDTH / 2 + KART_REACH;
      if (Math.abs(along) >= ha || Math.abs(side) >= hs) continue;
      // Push the kart out through the nearest face.
      const outA = ha - Math.abs(along);
      const outS = hs - Math.abs(side);
      if (outA < outS) {
        const sg = along >= 0 ? 1 : -1;
        k.pos.x += car.fx * sg * outA;
        k.pos.z += car.fz * sg * outA;
      } else {
        const sg = side >= 0 ? 1 : -1;
        k.pos.x += -car.fz * sg * outS;
        k.pos.z += car.fx * sg * outS;
      }
      if (k.invulnTime > 0) return 'push'; // just hit: only kept out of the car
      // Flip: spin-out, a hop, and a shove the way the car drives.
      spinOut(k, c);
      k.vel.x += car.fx * SHOVE;
      k.vel.z += car.fz * SHOVE;
      k.vel.y = FLIP_POP;
      k.grounded = false;
      return 'hit';
    }
    return null;
  }

  /** The crossing-style query is not used for traffic along the road: see `dangerFor`. */
  danger(): number {
    return 0;
  }

  /**
   * Bots: would a kart at main-route distance `s`, driving at `speed` m/s on lateral line `d`, run into a car within the
   * next LOOK seconds? For each car: when does the kart reach it (closing speed = kart speed - the car's speed along the
   * race), and where is the car then (+- a margin in time, the car may be changing sides)?
   */
  dangerFor(s: number, speed: number, d: number, time: number): number {
    const LOOK = 2.6;
    const v = Math.max(speed, 8);
    for (let k = 0; k < this.count; k++) {
      const b = this.travel(k, time);
      if (b > this.length) continue;
      const now = this.placeAt(b);
      const gap = this.track.deltaS(s, now.s); // + = ahead of the kart
      if (gap < -CAR_LENGTH || gap > v * LOOK + 20) continue;
      const closing = v - this.dir * this.speed;
      if (closing <= 0.5) continue;
      const meet = Math.max(0, gap) / closing;
      if (meet > LOOK) continue;
      for (const dt of [-0.3, 0, 0.3]) {
        const bt = this.speed * (Math.max(0, meet + dt)) + b;
        if (bt > this.length) continue;
        if (Math.abs(d - this.placeAt(bt).lat) < CAR_WIDTH / 2 + KART_REACH + 1.1) return 1;
      }
    }
    return 0;
  }
}
