/**
 * Acorn beetle (Autumn Speedway). A big beetle with a shell like an acorn cap marches back and forth
 * across the road, from beyond one verge to beyond the other and back, forever.
 *
 * Its sideways position is a sine wave of the race clock:
 *
 *   lat(t) = span * sin(2 * PI * (t - phase) / period)
 *
 * so it walks fastest in the middle of the road and slows down to turn round at each end, like a real
 * creature. Everything is a PURE function of the race clock (no state), like every hazard.
 *
 * Touching it does NOT spin you out: the kart bounces off its hard shell (the part of its velocity going
 * into the beetle is reversed, plus a shove away from it), which costs a lot of speed and can turn you
 * round. Karts with a Nova (invincibility) drive straight through; respawning and flying karts are safe.
 *
 * Phases: 'active' while any part of it is on the road, 'idle' while it is out on a verge (it never warns:
 * it is always in plain sight).
 */
import type { BeetleDef } from '../../track/hazardTypes';
import type { KartConfig } from '../config';
import { forwardOf, type KartState } from '../kart';
import type { Track } from '../track';
import { wrap } from './cycle';
import type { Hazard, HazardPose } from './types';

/** Default body radius (m). */
const DEFAULT_RADIUS = 1.7;
/** A kart counts as touching the beetle when its centre is within radius + this (m). */
const KART_REACH = 0.9;
/** How much of the kart's speed INTO the beetle comes back out (0 = dead stop, 1 = perfect bounce). */
const BOUNCE = 0.85;
/** Extra shove (m/s) straight away from the beetle on a real impact. */
const SHOVE = 5;
/** Impacts slower than this (m/s) are a nudge ('push'), not a hit (no event, no sound). */
const HIT_SPEED = 3;
/** Height of the shell (m): karts flying more than this above its back pass over. */
const HEIGHT = 2.4;

export class Beetle implements Hazard {
  readonly kind = 'beetle' as const;
  readonly s: number;
  readonly radius: number;
  /** Half the width of its march (m from the road centre). */
  readonly span: number;
  private readonly period: number;
  private readonly phase: number;
  /** Road centre at `s` and the unit vector pointing to the right of the road there. */
  private readonly base: { x: number; y: number; z: number; rx: number; rz: number; index: number };
  /** Ground height every metre along the march (index 0 = the far left end). */
  private readonly heights: number[];

  constructor(
    readonly id: number,
    def: BeetleDef,
    private readonly track: Track,
  ) {
    this.period = def.period;
    this.phase = def.phase ?? 0;
    this.radius = def.radius ?? DEFAULT_RADIUS;
    this.span = def.span ?? track.def.width / 2 + 4;
    this.s = track.sAt(def.at);
    const c = track.pointAt(this.s, 0);
    const r = track.pointAt(this.s, 1);
    this.base = { x: c.x, y: c.y, z: c.z, rx: r.x - c.x, rz: r.z - c.z, index: c.index };
    this.heights = [];
    for (let d = -Math.ceil(this.span); d <= Math.ceil(this.span); d++) {
      const p = track.pointAt(this.s, d);
      this.heights.push(track.sample(p.x, p.z, c.index)?.height ?? c.y);
    }
  }

  /** Sideways position (m, + = right of the road) and sideways speed (m/s) at race time `time`. */
  lateral(time: number): { lat: number; vel: number } {
    const w = (2 * Math.PI) / this.period;
    const a = w * wrap(time - this.phase, this.period);
    return { lat: this.span * Math.sin(a), vel: this.span * w * Math.cos(a) };
  }

  private heightAt(lat: number): number {
    const f = lat + Math.ceil(this.span);
    const i = Math.max(0, Math.min(this.heights.length - 2, Math.floor(f)));
    const u = Math.max(0, Math.min(1, f - i));
    return this.heights[i] * (1 - u) + this.heights[i + 1] * u;
  }

  /** Where the beetle is: world position, which way it faces, and how far through its stride it is. */
  where(time: number) {
    const { lat, vel } = this.lateral(time);
    const dir = vel >= 0 ? 1 : -1; // walking towards the right edge (+1) or the left (-1)
    return {
      lat,
      vel,
      x: this.base.x + this.base.rx * lat,
      y: this.heightAt(lat),
      z: this.base.z + this.base.rz * lat,
      // Facing: along the road's right vector, flipped when walking left (the view turns it smoothly).
      dirX: this.base.rx * dir,
      dirZ: this.base.rz * dir,
    };
  }

  pose(time: number): HazardPose {
    const b = this.where(time);
    const onRoad = Math.abs(b.lat) < this.track.def.width / 2 + this.radius + 1;
    const w = (2 * Math.PI) / this.period;
    return {
      phase: onRoad ? 'active' : 'idle',
      t: wrap(time - this.phase, this.period) / this.period,
      x: b.x,
      y: b.y,
      z: b.z,
      radius: this.radius,
      dirX: b.dirX,
      dirZ: b.dirZ,
      // Walking speed relative to its fastest (0 at the turn-round points), for the leg animation.
      pace: Math.abs(b.vel) / (this.span * w),
      lat: b.lat,
      // The road's right vector at the beetle (the view eases the facing between +right and -right).
      rx: this.base.rx,
      rz: this.base.rz,
    };
  }

  affect(k: KartState, time: number, _dt: number, _c: KartConfig): 'hit' | 'push' | null {
    if (k.respawnTime > 0 || k.flight) return null;
    if (k.starTime > 0) return null; // Nova: smash through
    const b = this.where(time);
    if (k.pos.y > b.y + HEIGHT || k.pos.y < b.y - 3) return null; // flying over it, or on a road far below
    const dx = k.pos.x - b.x;
    const dz = k.pos.z - b.z;
    const dist = Math.hypot(dx, dz);
    const reach = this.radius + KART_REACH;
    if (dist >= reach) return null;
    // Contact normal from the beetle to the kart (straight back along the road if exactly on top of it).
    const f = forwardOf(k.heading);
    const nx = dist > 1e-3 ? dx / dist : -f.x;
    const nz = dist > 1e-3 ? dz / dist : -f.z;
    // Push the kart out of the shell.
    k.pos.x += nx * (reach - dist);
    k.pos.z += nz * (reach - dist);
    // The beetle's own walking velocity counts: walking into a kart pushes it too.
    const bvx = this.base.rx * b.vel;
    const bvz = this.base.rz * b.vel;
    const vIn = -((k.vel.x - bvx) * nx + (k.vel.z - bvz) * nz); // closing speed
    if (vIn <= 0) return 'push';
    const hard = vIn >= HIT_SPEED;
    k.vel.x += nx * (vIn * (1 + BOUNCE) + (hard ? SHOVE : 0));
    k.vel.z += nz * (vIn * (1 + BOUNCE) + (hard ? SHOVE : 0));
    k.speed = k.vel.x * f.x + k.vel.z * f.z; // forward speed after the bounce (negative = rolling backwards)
    if (hard) {
      // A hard knock ends a drift (without its mini-turbo).
      k.driftDir = 0;
      k.driftCharge = 0;
      k.driftTier = 0;
    }
    return hard ? 'hit' : 'push';
  }

  danger(s: number, d: number, time: number, ahead: number): number {
    if (Math.abs(this.track.deltaS(this.s, s)) > this.radius + 3) return 0;
    // Where will it be when the kart gets here? Look a little either side of that moment.
    for (const dt of [-0.35, -0.15, 0, 0.15, 0.35]) {
      const { lat } = this.lateral(time + ahead + dt);
      if (Math.abs(d - lat) < this.radius + KART_REACH + 1) return 1;
    }
    return 0;
  }
}
