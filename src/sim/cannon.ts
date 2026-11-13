/**
 * Launch cannons (see docs/TRACKS.md).
 *
 * A cannon sits on the road. Drive into its mouth and you are
 *   1. CAPTURED  - the kart is pulled into the barrel ("load" phase, 0.5 s),
 *   2. FIRED     - flung along a parabola to the landing point ("air" phase),
 *   3. LANDED    - set down on the ground with a short boost, and credited with the
 *                  checkpoints you skipped (Race.grantProgress, done by the World).
 * During load and air the kart cannot steer and nothing can hurt it.
 *
 * Everything here is pure maths on plain data (no Three.js). The state of a kart
 * inside a cannon lives on the kart itself (`KartState.flight`), so the functions
 * below are stateless: `resolveCannons` runs once when a Track is built, and
 * `stepCannons` runs once per sim tick.
 *
 * Geometry cheat-sheet (all in world metres, heading 0 = +Z):
 *
 *            muzzle  *  (the kart leaves the barrel here)
 *                   /
 *                  /   barrel, tilted ~30 deg up
 *   road ---- mouth *--->  (the kart drives into the mouth)
 *
 *   air path: muzzle -> landing, y = straight line + 4*apex*u*(1-u),  u = t / flightTime
 */
import type { TrackDef } from '../track/types';
import { applyBoost, forwardOf, type KartState } from './kart';
import type { Track } from './track';

/** Tuning numbers for the cannon (kept together like config.ts). */
export const CANNON = {
  /** Seconds the kart spends being pulled into the barrel before it is fired. */
  loadTime: 0.5,
  /** The kart is captured when it is this close to the mouth (m, horizontal)... */
  triggerRadius: 2.6,
  /** ...and at least this fast (m/s) (so a parked kart is not swallowed). */
  minSpeed: 4,
  /** Default time in the air (s) and extra arc height (m) when the track gives none. */
  flightTime: 2.2,
  apex: 14,
  /** Speed (m/s) forward on landing, and the boost that comes with it (s). */
  landSpeed: 24,
  landBoostTime: 1.2,
  /** After landing a kart cannot be captured again for this long (s). */
  cooldown: 3,
  /** Where the barrel ends, relative to the mouth: metres forward and up. Matches the 3D model. */
  muzzleForward: 4.8,
  muzzleUp: 4.6,
  /** Mandatory cannon: the road ends this far (m) past the mouth (the launch pad's length)... */
  padAhead: 7,
  /** ...and the ground starts again this far (m) before the landing point (the landing platform). */
  landBehind: 10,
} as const;

export interface CannonPoint {
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Distance along the track (m). */
  s: number;
}

/** A cannon after the TrackDef numbers were turned into world positions. */
export interface ResolvedCannon {
  /** Where the kart drives in (centre of the funnel on the road). */
  mouth: CannonPoint;
  /** Where the kart is set down. `heading` is the track direction there. */
  landing: CannonPoint;
  /** The barrel's exit (mouth + forward + up): where the flight starts. */
  muzzle: { x: number; y: number; z: number };
  flightTime: number;
  apex: number;
  triggerRadius: number;
  /** Total signed yaw (rad) the kart turns through during the flight (mouth heading -> landing heading). */
  turn: number;
  /** Lateral position of the mouth across the road (m, positive = right of travel); bots aim for it. */
  lateral: number;
  /** true = every kart is captured (the road ends at the pad, see CannonDef.mandatory). */
  mandatory: boolean;
  /** Mandatory only: karts anywhere within this distance (m) of the road centre are captured at the pad. */
  captureHalfWidth: number;
}

/** Events the cannon system reports (the host plays sounds, camera effects and haptics from them). */
export type CannonEvent = { kind: 'cannonFire'; slot: number; cannon: number } | { kind: 'cannonLand'; slot: number; cannon: number };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Turn the cannon definitions of a track into world positions. Called once by the Track constructor. */
export function resolveCannons(track: Track, defs: TrackDef['cannons']): ResolvedCannon[] {
  const out: ResolvedCannon[] = [];
  const w = track.def.width;
  for (const def of defs ?? []) {
    const at = (units: number, offset: number): CannonPoint => {
      const s = track.sAt(units);
      const p = track.pointAt(s, (offset * w) / 2);
      const ground = track.sample(p.x, p.z, p.index);
      return { x: p.x, y: ground?.height ?? p.y, z: p.z, heading: p.heading, s };
    };
    const mouth = at(def.at, def.offset ?? 0);
    const landing = at(def.target.at, def.target.offset ?? 0);
    const f = forwardOf(mouth.heading);

    // Which way does the kart rotate on its way? Toward the landing first (that is the short way
    // for a U-turn shortcut); the total is mouth heading -> landing heading in that direction.
    const toward = Math.atan2(landing.x - mouth.x, landing.z - mouth.z);
    const turnDir = Math.sign(wrap(toward - mouth.heading)) || 1;
    let turn = wrap(landing.heading - mouth.heading);
    if (Math.abs(turn) > Math.PI / 2) turn = turnDir * Math.abs(turn);

    out.push({
      mouth,
      landing,
      muzzle: {
        x: mouth.x + f.x * CANNON.muzzleForward,
        y: mouth.y + CANNON.muzzleUp,
        z: mouth.z + f.z * CANNON.muzzleForward,
      },
      flightTime: def.flightTime ?? CANNON.flightTime,
      apex: def.apex ?? CANNON.apex,
      triggerRadius: CANNON.triggerRadius,
      turn,
      lateral: ((def.offset ?? 0) * w) / 2,
      mandatory: def.mandatory === true,
      // The whole road AND the off-road strip beside it: nobody can slip past the capture line.
      captureHalfWidth: w / 2 + track.def.offroadWidth,
    });
  }
  return out;
}

/** Position on the air path at fraction u (0 = muzzle, 1 = landing). */
export function flightPoint(c: ResolvedCannon, u: number): { x: number; y: number; z: number } {
  return {
    x: lerp(c.muzzle.x, c.landing.x, u),
    y: lerp(c.muzzle.y, c.landing.y, u) + 4 * c.apex * u * (1 - u),
    z: lerp(c.muzzle.z, c.landing.z, u),
  };
}

/** Can this kart be swallowed by a cannon right now? */
function capturable(k: KartState): boolean {
  return k.flight === null && k.grounded && k.spinTime <= 0 && k.respawnTime <= 0 && k.cannonCooldown <= 0 && k.speed > CANNON.minSpeed;
}

/**
 * Mandatory cannon: is this kart on the launch pad? The capture is a LINE across the whole road, a little before
 * the mouth, so it does not matter how fast or how sideways the kart arrives, whether it is spinning or hopping.
 * (Only a kart that is being carried back after a fall, or is already inside a cannon, is left alone.)
 */
function onLaunchPad(c: ResolvedCannon, k: KartState): boolean {
  if (k.flight !== null || k.respawnTime > 0 || k.cannonCooldown > 0 || Math.abs(k.pos.y - c.mouth.y) > 3) return false;
  const f = forwardOf(c.mouth.heading);
  const dx = k.pos.x - c.mouth.x;
  const dz = k.pos.z - c.mouth.z;
  const along = dx * f.x + dz * f.z; // metres past the mouth (negative = still on the road before it)
  const side = Math.abs(dx * f.z - dz * f.x); // metres from the road centre line
  return along >= -1.5 && along <= CANNON.padAhead + 1 && side <= c.captureHalfWidth;
}

/** Start the load phase: the kart loses control and everything it was doing (drift, hop, trick). */
function capture(k: KartState, cannon: number): void {
  k.flight = { cannon, phase: 'load', t: 0, fromX: k.pos.x, fromY: k.pos.y, fromZ: k.pos.z, duration: 0 };
  k.driftDir = 0;
  k.driftCharge = 0;
  k.driftTier = 0;
  k.hopping = false;
  k.trickable = false;
  k.trickDone = false;
  k.yawRate = 0;
  k.steer = 0;
}

/**
 * Advance every kart that is inside a cannon, and capture karts that just drove into one.
 * Call once per tick AFTER the karts have been stepped.
 */
export function stepCannons(track: Track, karts: Map<number, KartState>, dt: number): CannonEvent[] {
  const events: CannonEvent[] = [];
  const cannons = track.cannons;
  if (cannons.length === 0) return events;

  for (const [slot, k] of karts) {
    k.cannonCooldown = Math.max(0, k.cannonCooldown - dt);

    // --- Capture ------------------------------------------------------------------
    if (!k.flight) {
      for (let i = 0; i < cannons.length; i++) {
        const c = cannons[i];
        if (c.mandatory) {
          if (onLaunchPad(c, k)) capture(k, i);
          if (k.flight) break;
          continue;
        }
        if (!capturable(k)) continue;
        const dx = k.pos.x - c.mouth.x;
        const dz = k.pos.z - c.mouth.z;
        if (dx * dx + dz * dz > c.triggerRadius * c.triggerRadius || Math.abs(k.pos.y - c.mouth.y) > 2.5) continue;
        capture(k, i);
        break;
      }
      if (!k.flight) continue;
    }

    // --- Flight ---------------------------------------------------------------------
    const fl = k.flight;
    const c = cannons[fl.cannon];
    fl.t += dt;
    k.grounded = false;
    k.vel.y = 0;

    if (fl.phase === 'load') {
      // Pulled in: first to the mouth on the road (40 %), then up the barrel to the muzzle.
      const u = Math.min(1, fl.t / CANNON.loadTime);
      const split = 0.4;
      let tx: number, ty: number, tz: number;
      if (u < split) {
        const a = smooth(u / split);
        tx = lerp(fl.fromX, c.mouth.x, a);
        ty = lerp(fl.fromY, c.mouth.y, a);
        tz = lerp(fl.fromZ, c.mouth.z, a);
      } else {
        const a = smooth((u - split) / (1 - split));
        tx = lerp(c.mouth.x, c.muzzle.x, a);
        ty = lerp(c.mouth.y, c.muzzle.y, a);
        tz = lerp(c.mouth.z, c.muzzle.z, a);
      }
      k.pos.x = tx;
      k.pos.y = ty;
      k.pos.z = tz;
      k.heading += wrap(c.mouth.heading - k.heading) * Math.min(1, dt * 10);
      k.vel.x = 0;
      k.vel.z = 0;
      if (fl.t >= CANNON.loadTime) {
        fl.phase = 'air';
        fl.t = 0;
        fl.duration = c.flightTime;
        events.push({ kind: 'cannonFire', slot, cannon: fl.cannon });
      }
      continue;
    }

    // Air phase.
    const u = Math.min(1, fl.t / c.flightTime);
    const p = flightPoint(c, u);
    k.pos.x = p.x;
    k.pos.y = p.y;
    k.pos.z = p.z;
    k.heading = c.mouth.heading + c.turn * smooth(u);
    // Velocity for the camera / visuals (derivative of the path).
    const vx = (c.landing.x - c.muzzle.x) / c.flightTime;
    const vz = (c.landing.z - c.muzzle.z) / c.flightTime;
    k.vel.x = vx;
    k.vel.z = vz;
    k.vel.y = (c.landing.y - c.muzzle.y) / c.flightTime + (4 * c.apex * (1 - 2 * u)) / c.flightTime;
    k.speed = Math.hypot(vx, vz);

    if (fl.t >= c.flightTime) events.push(...land(track, slot, k, c, fl.cannon));
  }
  return events;
}

/** Set a kart down at the landing point: snap to the ground, give it speed and a boost. */
function land(track: Track, slot: number, k: KartState, c: ResolvedCannon, cannon: number): CannonEvent[] {
  const ground = track.sample(c.landing.x, c.landing.z);
  const f = forwardOf(c.landing.heading);
  k.flight = null;
  k.pos.x = c.landing.x;
  k.pos.z = c.landing.z;
  k.pos.y = ground?.height ?? c.landing.y;
  k.surface = ground?.surface ?? 'road';
  k.heading = c.landing.heading;
  k.speed = CANNON.landSpeed;
  k.vel.x = f.x * CANNON.landSpeed;
  k.vel.z = f.z * CANNON.landSpeed;
  k.vel.y = 0;
  k.grounded = true;
  k.trackIndex = track.pointAt(c.landing.s).index;
  k.cannonCooldown = CANNON.cooldown;
  applyBoost(k, CANNON.landBoostTime);
  return [{ kind: 'cannonLand', slot, cannon }];
}
