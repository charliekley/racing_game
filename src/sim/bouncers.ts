/**
 * Mushroom caps (Mushroom Valley): solid platforms and trampolines standing in gorges and chasms.
 *
 * A cap is a flat-topped disc of ground: a circle (centre x, z, radius) with its top at height y.
 *  - GREEN caps are plain road. Drive across them like a bridge.
 *  - ORANGE caps are trampolines. A kart that touches the top is thrown into the air along an arc that
 *    lands exactly on the cap's TARGET: the next cap of the chain, or the road on the far side of the gorge.
 *
 * Why the arc is computed instead of "launch with a fixed speed":
 *   the kart's position (x, z, y) and the target (tx, tz, ty) are known, so the arc follows from school
 *   physics. Pick the time in the air T. Then
 *       horizontal speed  v = D / T            (D = distance to the target)
 *       launch speed     vy = (ty - y + g T^2 / 2) / T
 *   (from  y(T) = y + vy T - g T^2 / 2 = ty). The kart lands on the target whatever speed it arrived with, so
 *   a bounce can never be "too slow" or "too fast". T grows with the distance, so the horizontal speed is
 *   about BOUNCE.speed (close to a kart's top speed: the bounce route is about as quick as driving).
 *
 * While the kart is in the air after a bounce the kart is GUIDED: each tick its heading points at the target and
 * its speed is (distance left) / (time left). Steering in the air cannot make it miss. (Tricks still work: a
 * bounce counts as a ramp launch, so a trick gives its boost on landing.)
 *
 * Deterministic: pure functions of the kart state and the track; no randomness, no clock.
 *
 * Hooks in world.ts: `wrapGround` (the caps are ground) and `step` (touching an orange cap starts a bounce).
 */
import type { CapDef } from '../track/types';
import { KART, type KartConfig } from './config';
import type { Ground, GroundHit } from './ground';
import type { KartState } from './kart';
import type { Track } from './track';

/** The bounce rules (all in one place so tests and the renderer agree). */
export const BOUNCE = {
  /** Wanted horizontal speed (m/s) of a bounce arc: the time in the air is chosen as distance / speed. */
  speed: 25,
  /** Shortest and longest time in the air (s). */
  airMin: 1.3,
  airMax: 2.1,
  /** A kart touches a cap when it is within this much above its top (m)... */
  touchAbove: 0.15,
  /** ...and not more than this far below it (so a kart falling past the side of a cap never triggers it). */
  touchBelow: 0.6,
  /** Over the last this-many seconds of a flight the guidance stops changing the speed (avoids a spike at landing). */
  settle: 0.08,
} as const;

/** A cap with its bounce target worked out. */
export interface Cap {
  index: number;
  kind: 'green' | 'orange';
  x: number;
  z: number;
  radius: number;
  y: number;
  /** Orange: where a bounce lands (world point). */
  target: { x: number; z: number; y: number } | null;
  /** Orange: fixed time in the air (s) or 0 to work it out from the distance. */
  air: number;
}

/** Events the world reports for a bounce (audio, haptics, the cap wobble in the renderer). */
export interface BounceEvent {
  kind: 'bounce';
  slot: number;
  cap: number;
}

/** The launch numbers of a bounce from a given spot: speed and angle of the arc. */
export interface Arc {
  /** Time in the air (s). */
  air: number;
  /** Horizontal speed (m/s) and launch speed upwards (m/s). */
  speed: number;
  vy: number;
  /** Heading (rad) that points at the target. */
  heading: number;
  /** Highest point above the launch height (m). */
  apex: number;
}

/** Work out the arc from (x, y, z) to a target. `air` 0 = choose from the distance. Pure. */
export function bounceArc(x: number, y: number, z: number, target: { x: number; y: number; z: number }, air = 0, gravity: number = KART.gravity): Arc {
  const dx = target.x - x;
  const dz = target.z - z;
  const dist = Math.hypot(dx, dz);
  const T = air > 0 ? air : Math.min(BOUNCE.airMax, Math.max(BOUNCE.airMin, dist / BOUNCE.speed));
  const vy = (target.y - y + (gravity * T * T) / 2) / T;
  return { air: T, speed: dist / T, vy, heading: Math.atan2(dx, dz), apex: vy > 0 ? (vy * vy) / (2 * gravity) : 0 };
}

/** A bounce in progress for one kart. */
interface Flight {
  cap: number;
  /** Seconds of flight still to come. */
  left: number;
}

export class Bouncers {
  readonly caps: Cap[];
  private readonly flights = new Map<number, Flight>();

  constructor(private readonly track: Track) {
    const defs: CapDef[] = track.def.caps ?? [];
    // Where a cap stands: on the main road (at / offset / dy) or at a world point.
    const place = (d: CapDef): { x: number; z: number; y: number } => {
      if (d.at !== undefined) {
        const p = track.pointAt(track.sAt(d.at) + (d.ds ?? 0), d.offset ?? 0);
        return { x: p.x, z: p.z, y: p.y + (d.dy ?? 0) };
      }
      return { x: d.x ?? 0, z: d.z ?? 0, y: d.y ?? 0 };
    };
    const spots = defs.map(place);
    this.caps = defs.map((d, index) => {
      const me = spots[index];
      let target: Cap['target'] = null;
      if (d.kind === 'orange' && d.to !== undefined) {
        if (typeof d.to === 'number') {
          target = spots[d.to];
        } else {
          // A point on a road beyond the gorge: its height is whatever the ground is there.
          const t = 'at' in d.to ? track.pointAt(track.sAt(d.to.at) + (d.to.ds ?? 0), d.to.offset ?? 0) : d.to;
          target = { x: t.x, z: t.z, y: track.sample(t.x, t.z)?.height ?? me.y };
        }
      }
      return { index, kind: d.kind, x: me.x, z: me.z, radius: d.radius, y: me.y, target, air: d.air ?? 0 };
    });
  }

  /** The cap whose disc contains (x, z), or null. (Caps never overlap each other except green ones, which share a height.) */
  capAt(x: number, z: number): Cap | null {
    for (const c of this.caps) {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz <= c.radius * c.radius) return c;
    }
    return null;
  }

  /** Ground with the caps added: inside a cap's disc the surface is at least as high as the cap's top. */
  wrapGround(base: Ground): Ground {
    if (this.caps.length === 0) return base;
    return {
      sample: (x, z, hint) => {
        const hit = base.sample(x, z, hint);
        const cap = this.capAt(x, z);
        if (!cap) return hit;
        if (hit && hit.height >= cap.y) return hit;
        // Keep the kart's "which road am I on" hint alive over the void (the base ground has no index there).
        const index = hit?.index ?? this.track.project(x, z, hint ?? -1).index;
        const out: GroundHit = { height: cap.y, surface: 'road', index };
        return out;
      },
    };
  }

  /**
   * Run after the kart physics each tick: start a bounce for karts touching an orange cap, and guide karts that are
   * in the air after one. `configOf` gives each kart's physics numbers (the gravity may differ per class).
   */
  step(karts: Map<number, KartState>, dt: number, configOf: (slot: number) => KartConfig = () => KART): BounceEvent[] {
    const events: BounceEvent[] = [];
    if (this.caps.length === 0) return events;
    for (const [slot, k] of karts) {
      // Not on the ground-physics path: carried by the drone, inside a cannon, or a rocket.
      if (k.flight || k.respawnTime > 0 || k.rocketTime > 0) {
        this.flights.delete(slot);
        continue;
      }
      const f = this.flights.get(slot);
      if (f) {
        if (k.grounded) this.flights.delete(slot);
        else this.guide(k, f, dt);
      }
      if (this.flights.has(slot)) continue; // still in the air from the last bounce
      const hit = this.touching(k);
      if (!hit || !hit.target) continue;
      const g = configOf(slot).gravity;
      const arc = bounceArc(k.pos.x, k.pos.y, k.pos.z, hit.target, hit.air, g);
      k.heading = arc.heading;
      k.speed = arc.speed;
      k.vel.x = Math.sin(arc.heading) * arc.speed;
      k.vel.z = Math.cos(arc.heading) * arc.speed;
      k.vel.y = arc.vy;
      k.pos.y = Math.max(k.pos.y, hit.y) + 0.02; // a hair above the cap so the next tick is clearly airborne
      k.grounded = false;
      k.hopping = false;
      k.driftDir = 0;
      k.driftCharge = 0;
      k.driftTier = 0;
      k.yawRate = 0;
      k.trickable = true; // the bounce counts as a ramp launch: a trick in the air pays out a boost on landing
      k.trickDone = false;
      this.flights.set(slot, { cap: hit.index, left: arc.air });
      events.push({ kind: 'bounce', slot, cap: hit.index });
    }
    return events;
  }

  /** The orange cap this kart is touching (on or just above its top, not rising), or null. */
  private touching(k: KartState): Cap | null {
    if (!k.grounded && k.vel.y > 0) return null; // on its way up: not touching
    for (const c of this.caps) {
      if (c.kind !== 'orange') continue;
      const dx = k.pos.x - c.x;
      const dz = k.pos.z - c.z;
      if (dx * dx + dz * dz > c.radius * c.radius) continue;
      const above = k.pos.y - c.y;
      if (above <= BOUNCE.touchAbove && above >= -BOUNCE.touchBelow) return c;
    }
    return null;
  }

  /** One tick of guidance: point at the target and fly at the speed that gets there on time. */
  private guide(k: KartState, f: Flight, dt: number): void {
    f.left -= dt;
    const target = this.caps[f.cap].target;
    if (!target) return;
    const dx = target.x - k.pos.x;
    const dz = target.z - k.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1) k.heading = Math.atan2(dx, dz); // (right above the target the bearing is meaningless)
    k.yawRate = 0;
    if (f.left > BOUNCE.settle) k.speed = Math.min(60, dist / f.left);
    // Over a chasm there is no ground, so nothing else updates the kart's "where am I on the road" hint. On a long flight
    // the hint would fall further behind than the track search window, and the landing would be looked up on the wrong
    // part of the road. Follow the kart ourselves, every tick.
    k.trackIndex = this.track.project(k.pos.x, k.pos.z, k.trackIndex).index;
  }

  /** Is this kart in the air after a bounce? (Renderer and audio may ask.) */
  bouncing(slot: number): boolean {
    return this.flights.has(slot);
  }
}
