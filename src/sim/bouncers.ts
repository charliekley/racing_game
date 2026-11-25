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
 * AIR CONTROL (no guidance): the arc is aimed at the target from the cap, but the kart keeps part of how it arrived. Its
 * launch velocity is the ideal one plus BOUNCE.carryLateral / carryForward of the entry velocity's error (sideways, and
 * too fast / too slow), and half of its offset from the cap's centre stays. A straight, centred kart at ANY speed from 20 m/s
 * up to a boosted top speed (40) lands on the target without a touch of the controls (forward error is forgiven within
 * BOUNCE.slowFree / fastFree); one that comes in off-centre, at a bad angle or crawling drifts off it. In the air the steering moves the
 * kart sideways (lateral acceleration, capped) and gas / brake nudge it forward / back (see `BOUNCE.air*`), so the player
 * has to line the landing up. Missing the cap and the road means the abyss and a respawn. Bots fly with `Bouncers.pilot`.
 * (Tricks still work: a bounce counts as a ramp launch, so a trick gives its boost on landing.)
 *
 * Deterministic: pure functions of the kart state and the track; no randomness, no clock.
 *
 * Hooks in world.ts: `wrapGround` (the caps are ground) and `step` (touching an orange cap starts a bounce).
 */
import { Buttons, type ControlInput } from '../shared/protocol';
import type { CapDef } from '../track/types';
import { KART, type KartConfig } from './config';
import type { Ground, GroundHit } from './ground';
import type { KartState } from './kart';
import { ROUTE_STRIDE } from './shortcuts';
import { Track } from './track';

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
  /** Share of the entry velocity's error that survives the launch: sideways (angle) and forward (too fast / slow). */
  carryLateral: 0.9,
  carryForward: 0.8,
  /** The entry speed that counts as "right" when a kart arrives from the road (a kart's top speed, m/s); chained hops use the previous arc's ideal velocity. */
  refSpeed: 28,
  /** The entry error that counts is capped at this (m/s). */
  carryMax: 14,
  /**
   * Forward entry error that is FORGIVEN (m/s). Too fast: a kart may arrive anywhere up to refSpeed + fastFree (40 m/s: a
   * boosted kart's top speed) and the bounce still lands on the target: full racing speed and a boost pad must never cost
   * the cap. Too slow: a kart down to refSpeed - slowFree (20 m/s) still makes it; below that the shortfall is carried.
   * (The skill is lining up sideways and not crawling in, not lifting off the gas.)
   */
  fastFree: 12,
  slowFree: 8,
  /** Share of the kart's offset from the cap's centre that is still there on landing (0 = always lands on the target). */
  keepOffset: 0.5,
  /** Air control: sideways acceleration at full steering and its cap (m/s^2, m/s); forward / back nudge from gas / brake. */
  airLateralAccel: 24,
  airLateralMax: 12,
  airForwardAccel: 8,
  airForwardMax: 7,
} as const;

/**
 * Caps are gently domed: the surface is highest in the middle (the cap's `y`) and sinks at the rim:
 * height(r) = y - droop x r^2 / radius. ORANGE caps droop by CAP_DROOP (6 %: a 10 m cap is 0.6 m lower at its edge, a
 * pleasant trampoline dome). GREEN caps are bridges and must feel like road, so they are almost flat (GREEN_DROOP, 1.2 %:
 * 0.12 m at the rim of a 10 m cap) and they TILT with the road under them (`Cap.gx / gz`), so the first and the last cap meet
 * the road flush and the overlapping caps do not make steps or a ripple. (Round domes of 6 % used to give a 0.5 m lip at the
 * joint with the road: the kart's crest-launch rule threw it into the air.) The renderer draws the same surface.
 */
export const CAP_DROOP = 0.06;
export const GREEN_DROOP = 0.012;
export const capDroop = (kind: 'orange' | 'green'): number => (kind === 'green' ? GREEN_DROOP : CAP_DROOP);

/** A cap with its bounce target worked out. */
export interface Cap {
  index: number;
  kind: 'green' | 'orange';
  x: number;
  z: number;
  radius: number;
  y: number;
  /** Slope of the cap's surface (m of height per m of x / z): a green cap tilts with the road it bridges, orange caps are level. */
  gx: number;
  gz: number;
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
  /** Heading of the ideal arc (rad) and the horizontal launch velocity. */
  heading: number;
  vx: number;
  vz: number;
  /** The ideal arc's velocity (no entry error, no controls): what the next hop of a chain is compared with. */
  idealX: number;
  idealZ: number;
  /** Velocity added in the air by the controls: along the ideal heading and to its right (m/s). */
  dvF: number;
  dvR: number;
}

/** What a computer driver should do in the air (see `Bouncers.pilot`). */
export interface AirControl {
  steer: number;
  gas: boolean;
  brake: boolean;
}

export class Bouncers {
  readonly caps: Cap[];
  private readonly flights = new Map<number, Flight>();
  /** Karts that landed from a bounce this tick (a landing straight on the next orange cap chains the hops). */
  private readonly chained = new Map<number, Flight>();

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
      // A green cap IS the road (see `groundTop`): its top and tilt are the road's height and slope under it, so the cap
      // joins the road without a step. (Banking and the road's own slope are folded into the tilt, by finite differences.)
      let y = me.y;
      let gx = 0;
      let gz = 0;
      if (d.kind === 'green') {
        const top = (x: number, z: number) => this.roadTop(x, z);
        y = top(me.x, me.z);
        gx = (top(me.x + 1.5, me.z) - top(me.x - 1.5, me.z)) / 3;
        gz = (top(me.x, me.z + 1.5) - top(me.x, me.z - 1.5)) / 3;
      }
      return { index, kind: d.kind, x: me.x, z: me.z, radius: d.radius, y, gx, gz, target, air: d.air ?? 0 };
    });
  }

  /** The cap whose disc contains (x, z) and whose surface is highest there, or null. (Green caps overlap to make bridges.) */
  capAt(x: number, z: number): Cap | null {
    let best: Cap | null = null;
    let bestH = -Infinity;
    for (const c of this.caps) {
      const dx = x - c.x;
      const dz = z - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > c.radius * c.radius) continue;
      const h = c.y + c.gx * dx + c.gz * dz - (capDroop(c.kind) * d2) / c.radius;
      if (h > bestH) {
        bestH = h;
        best = c;
      }
    }
    return best;
  }

  /** Height of a cap's surface at (x, z) (inside its disc). */
  static surface(c: Cap, x: number, z: number): number {
    const dx = x - c.x;
    const dz = z - c.z;
    return c.y + c.gx * dx + c.gz * dz - (capDroop(c.kind) * (dx * dx + dz * dz)) / c.radius;
  }

  /**
   * The height you drive on over a cap. Orange caps: the dome (`surface`). GREEN caps are a bridge and ARE the road: the
   * ground there is exactly the height the road would have (centre line + banking), so the joints with the real road
   * have no step at all. (Even a 3 cm step makes the kart's crest-launch rule throw it: it reads the sudden change in
   * the ground's slope as a crest. The visible green dome, `surface`, is within a few cm of this.)
   */
  private groundTop(c: Cap, x: number, z: number, hint?: number): number {
    if (c.kind !== 'green') return Bouncers.surface(c, x, z);
    return this.roadTop(x, z, hint);
  }

  /** Height the main road has (or would have) at (x, z): centre line plus banking. */
  private roadTop(x: number, z: number, hint?: number): number {
    const p = this.track.projectOnMain(x, z, hint !== undefined && hint >= 0 && hint < ROUTE_STRIDE ? hint : -1);
    return p.y + Track.bankLift(p.bank, p.width / 2, p.d);
  }

  /** Ground with the caps added: inside a cap's disc the surface is at least as high as the cap's top. */
  wrapGround(base: Ground): Ground {
    if (this.caps.length === 0) return base;
    return {
      sample: (x, z, hint) => {
        const hit = base.sample(x, z, hint);
        const cap = this.capAt(x, z);
        if (!cap) return hit;
        const top = this.groundTop(cap, x, z, hint);
        if (hit && hit.height >= top) return hit;
        // Keep the kart's "which road am I on" hint alive over the void (the base ground has no index there).
        const index = hit?.index ?? this.track.project(x, z, hint ?? -1).index;
        const out: GroundHit = { height: top, surface: 'road', index };
        return out;
      },
    };
  }

  /**
   * Run after the kart physics each tick: start a bounce for karts touching an orange cap, and fly karts that are
   * in the air after one (air control from `inputs`). `configOf` gives each kart's physics numbers (the gravity may differ per class).
   */
  step(karts: Map<number, KartState>, dt: number, configOf: (slot: number) => KartConfig = () => KART, inputs: Map<number, ControlInput> = new Map()): BounceEvent[] {
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
        if (k.grounded) {
          this.flights.delete(slot);
          this.chained.set(slot, f);
        } else this.fly(k, f, inputs.get(slot), dt);
      }
      if (this.flights.has(slot)) continue; // still in the air from the last bounce
      const hit = this.touching(k);
      const prev = this.chained.get(slot); // (landed from a bounce this tick: the next hop keeps what the last one did)
      this.chained.delete(slot);
      if (!hit || !hit.target) continue;
      const g = configOf(slot).gravity;
      // The ideal arc leaves from where the kart is, aimed so that it would land on the target if the kart had started
      // from the cap's centre; half of the kart's offset from the centre is kept (come in off-centre, land off-target).
      const keep = BOUNCE.keepOffset;
      const aim = { x: hit.target.x + (k.pos.x - hit.x) * keep, y: hit.target.y, z: hit.target.z + (k.pos.z - hit.z) * keep };
      const arc = bounceArc(k.pos.x, k.pos.y, k.pos.z, aim, hit.air, g);
      // ...and the kart keeps part of how it ARRIVED: sideways error (angle) and forward error (too fast / too slow).
      const ux = Math.sin(arc.heading);
      const uz = Math.cos(arc.heading);
      const rx = -uz;
      const rz = ux;
      // The error is measured against the velocity the kart SHOULD arrive with: on the road a racing speed along the line of
      // the arc; on a chained hop the ideal velocity of the hop before (so the bends of the route cost nothing).
      const refX = prev ? prev.idealX : ux * Math.min(BOUNCE.refSpeed, arc.speed);
      const refZ = prev ? prev.idealZ : uz * Math.min(BOUNCE.refSpeed, arc.speed);
      const ex = k.vel.x - refX;
      const ez = k.vel.z - refZ;
      const cap = (v: number) => Math.max(-BOUNCE.carryMax, Math.min(BOUNCE.carryMax, v));
      // Forward error: forgiven inside [-slowFree, +fastFree], carried beyond (see BOUNCE.fastFree).
      const rawF = ex * ux + ez * uz;
      // (Only for an entry from the road: a chained hop carries the error of the hop before in full, so a crawl stays a crawl.)
      const outF = prev ? rawF : rawF > 0 ? Math.max(0, rawF - BOUNCE.fastFree) : Math.min(0, rawF + BOUNCE.slowFree);
      const errF = cap(outF) * BOUNCE.carryForward;
      const errR = cap(ex * rx + ez * rz) * BOUNCE.carryLateral;
      const vx = ux * (arc.speed + errF) + rx * errR;
      const vz = uz * (arc.speed + errF) + rz * errR;
      k.heading = Math.atan2(vx, vz);
      k.speed = Math.hypot(vx, vz);
      k.vel.x = vx;
      k.vel.z = vz;
      k.vel.y = arc.vy;
      k.pos.y = Math.max(k.pos.y, Bouncers.surface(hit, k.pos.x, k.pos.z)) + 0.02; // a hair above the cap so the next tick is clearly airborne
      k.grounded = false;
      k.hopping = false;
      k.driftDir = 0;
      k.driftCharge = 0;
      k.driftTier = 0;
      k.yawRate = 0;
      k.trickable = true; // the bounce counts as a ramp launch: a trick in the air pays out a boost on landing
      k.trickDone = false;
      this.flights.set(slot, { cap: hit.index, left: arc.air, heading: arc.heading, vx, vz, idealX: ux * arc.speed, idealZ: uz * arc.speed, dvF: 0, dvR: 0 });
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
      const above = k.pos.y - Bouncers.surface(c, k.pos.x, k.pos.z);
      if (above <= BOUNCE.touchAbove && above >= -BOUNCE.touchBelow) return c;
    }
    return null;
  }

  /**
   * One tick in the air: steering pushes the kart sideways (right of the ideal heading), gas / brake forward / back, each
   * within a cap. The horizontal velocity is launch velocity + what the controls added; the kart's nose follows it.
   * (World.tick feeds `stepKart` zero steering during a flight, so the plain turning physics stays out of the way.)
   */
  private fly(k: KartState, f: Flight, input: ControlInput | undefined, dt: number): void {
    f.left -= dt;
    if (input) {
      const steer = Number.isFinite(input.steer) ? Math.max(-1, Math.min(1, input.steer)) : 0;
      const pedal = (input.buttons & Buttons.GAS ? 1 : 0) - (input.buttons & Buttons.BRAKE ? 1 : 0);
      f.dvR = Math.max(-BOUNCE.airLateralMax, Math.min(BOUNCE.airLateralMax, f.dvR + steer * BOUNCE.airLateralAccel * dt));
      f.dvF = Math.max(-BOUNCE.airForwardMax, Math.min(BOUNCE.airForwardMax, f.dvF + pedal * BOUNCE.airForwardAccel * dt));
    }
    const ux = Math.sin(f.heading);
    const uz = Math.cos(f.heading);
    const vx = f.vx + ux * f.dvF - uz * f.dvR;
    const vz = f.vz + uz * f.dvF + ux * f.dvR;
    k.vel.x = vx;
    k.vel.z = vz;
    k.speed = Math.hypot(vx, vz);
    k.heading = Math.atan2(vx, vz);
    k.yawRate = 0;
    // Over a chasm there is no ground, so nothing else updates the kart's "where am I on the road" hint. On a long flight
    // the hint would fall further behind than the track search window, and the landing would be looked up on the wrong
    // part of the road. Follow the kart ourselves, every tick.
    k.trackIndex = this.track.project(k.pos.x, k.pos.z, k.trackIndex).index;
  }

  /**
   * What a computer driver does in the air: predict where the kart will land if it stops steering, and push the
   * difference away (steer = sideways, gas / brake = forward / back). `aimOff` (m, to the right of the flight) is a
   * deliberate error for easier bots. Null when the kart is not on a bounce flight.
   */
  pilot(slot: number, k: KartState, aimOff = 0): AirControl | null {
    const f = this.flights.get(slot);
    const target = f ? this.caps[f.cap].target : null;
    if (!f || !target) return null;
    const tau = Math.max(f.left, 0.3);
    const ux = Math.sin(f.heading);
    const uz = Math.cos(f.heading);
    const ex = target.x + -uz * aimOff - (k.pos.x + k.vel.x * Math.max(f.left, 0));
    const ez = target.z + ux * aimOff - (k.pos.z + k.vel.z * Math.max(f.left, 0));
    const needF = (ex * ux + ez * uz) / tau; // velocity change wanted along / to the right of the flight
    const needR = (ex * -uz + ez * ux) / tau;
    return { steer: Math.max(-1, Math.min(1, needR / 3)), gas: needF > 1, brake: needF < -1 };
  }

  /** Is this kart in the air after a bounce? (Renderer and audio may ask.) */
  bouncing(slot: number): boolean {
    return this.flights.has(slot);
  }
}
