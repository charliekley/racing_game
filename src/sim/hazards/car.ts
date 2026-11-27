/**
 * Parking-lot cars (Palm Plaza). A "car lane" crosses the road at `at`: cars drive out of a garage gate on one side,
 * straight across the road and into the gate on the other side, at a steady `speed`. `cars` cars share a lane, evenly
 * spaced in time; each one crosses once per `period` and spends the rest of it in the garages (hidden).
 *
 *   lat(t) = dir * (-reach + speed * u),   u = time since this car left its gate (0 .. 2 reach / speed)
 *
 * A pure function of the race clock, like every hazard. A car is a solid box (CAR_LENGTH x CAR_WIDTH). Driving into
 * one (or being driven into) FLIPS the kart: a spin-out plus a hop (`FLIP_POP` m/s up) and a shove along the car's way;
 * the renderer rolls the kart over once in the air (kartView `startFlip`). Nova (star) karts drive through; a kart that
 * is still invulnerable after a hit is only pushed out of the car. Respawning, flying and rocketing karts are safe.
 *
 * Phases: 'active' while any car of the lane is on the road (or its verge), 'idle' otherwise (no warning phase: the
 * cars are always in plain sight, the bots read `danger`).
 */
import type { CarDef } from '../../track/hazardTypes';
import type { KartConfig } from '../config';
import { spinOut, type KartState } from '../kart';
import { CURB_WIDTH, type Track } from '../track';
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
/** Default driving speed (m/s). */
export const CAR_SPEED = 9;

export interface CarState {
  /** Sideways position (m from the road centre, + = right) and whether it is out of its garage. */
  lat: number;
  visible: boolean;
  x: number;
  y: number;
  z: number;
  /** Unit direction it drives in (world x, z). */
  fx: number;
  fz: number;
}

export class Car implements Hazard {
  readonly kind = 'car' as const;
  readonly s: number;
  readonly dir: 1 | -1;
  readonly speed: number;
  readonly count: number;
  readonly reach: number;
  readonly period: number;
  private readonly phase: number;
  /** Road centre at `s` and the road's right vector there. */
  private readonly base: { x: number; y: number; z: number; rx: number; rz: number };
  /** Ground height every metre across (index 0 = -reach). */
  private readonly heights: number[];

  constructor(
    readonly id: number,
    def: CarDef,
    private readonly track: Track,
  ) {
    this.s = track.sAt(def.at);
    this.dir = def.dir;
    this.speed = def.speed ?? CAR_SPEED;
    this.count = def.cars ?? 1;
    this.reach = def.reach ?? track.def.width / 2 + 16;
    this.period = def.period;
    this.phase = def.phase ?? 0;
    if ((2 * this.reach) / this.speed > this.period / this.count) throw new Error('car lane: cars would overlap (period too short)');
    const c = track.pointAt(this.s, 0);
    const r = track.pointAt(this.s, 1);
    this.base = { x: c.x, y: c.y, z: c.z, rx: r.x - c.x, rz: r.z - c.z };
    this.heights = [];
    for (let d = -Math.ceil(this.reach); d <= Math.ceil(this.reach); d++) {
      const p = track.pointAt(this.s, d);
      this.heights.push(track.sample(p.x, p.z, c.index)?.height ?? c.y);
    }
  }

  private heightAt(lat: number): number {
    const f = lat + Math.ceil(this.reach);
    const i = Math.max(0, Math.min(this.heights.length - 2, Math.floor(f)));
    const u = Math.max(0, Math.min(1, f - i));
    return this.heights[i] * (1 - u) + this.heights[i + 1] * u;
  }

  /** Every car of the lane at race time `time`. */
  cars(time: number): CarState[] {
    const out: CarState[] = [];
    const crossing = (2 * this.reach) / this.speed;
    for (let k = 0; k < this.count; k++) {
      const u = wrap(time - this.phase - (k * this.period) / this.count, this.period);
      const visible = u <= crossing;
      const lat = this.dir * (-this.reach + this.speed * Math.min(u, crossing));
      out.push({
        lat,
        visible,
        x: this.base.x + this.base.rx * lat,
        y: this.heightAt(lat),
        z: this.base.z + this.base.rz * lat,
        fx: this.base.rx * this.dir,
        fz: this.base.rz * this.dir,
      });
    }
    return out;
  }

  /** Is a car (or part of one) on the road or its kerb? */
  private onRoad(c: CarState): boolean {
    return c.visible && Math.abs(c.lat) < this.track.def.width / 2 + CURB_WIDTH + CAR_LENGTH / 2;
  }

  pose(time: number): HazardPose {
    const cars = this.cars(time);
    return { phase: cars.some((c) => this.onRoad(c)) ? 'active' : 'idle', t: wrap(time - this.phase, this.period) / this.period, cars };
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

  /** Bots: is lateral line `d` (m) blocked by a car at the crossing `ahead` seconds from now (+- a margin)? */
  danger(s: number, d: number, time: number, ahead: number): number {
    if (Math.abs(this.track.deltaS(this.s, s)) > CAR_WIDTH / 2 + 3) return 0;
    for (const dt of [-0.35, -0.15, 0, 0.15, 0.35]) {
      for (const car of this.cars(time + ahead + dt)) {
        if (car.visible && Math.abs(d - car.lat) < CAR_LENGTH / 2 + KART_REACH + 0.8) return 1;
      }
    }
    return 0;
  }
}
