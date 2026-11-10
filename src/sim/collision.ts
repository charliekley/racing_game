/**
 * Arcade collisions: karts bounce off walls and each other, losing some speed
 * instead of stopping dead.
 */
import { KART, type KartConfig } from './config';
import { forwardOf, rightOf, type KartState } from './kart';
import type { Track } from './track';

export interface CollisionEvent {
  kind: 'wall' | 'kart';
  slot: number;
  /** Impact speed (m/s) along the collision normal. */
  impact: number;
}

/** Re-derive forward speed after velocity was changed by a collision. */
function syncSpeed(k: KartState): void {
  const f = forwardOf(k.heading);
  k.speed = k.vel.x * f.x + k.vel.z * f.z;
}

/**
 * Keep a kart inside the walls. Returns impact speed (0 if no hit).
 * nx/nz = wall normal pointing back toward the track.
 */
export function collideWalls(k: KartState, track: Track, c: KartConfig = KART): number {
  const p = track.project(k.pos.x, k.pos.z, k.trackIndex);
  const walls = track.wallsAt(p.i, p.route);
  const sample = track.sampleOf(p.route, p.i);
  let impact = 0;
  for (const side of ['left', 'right'] as const) {
    const wall = walls[side];
    if (wall === null) continue;
    const sign = side === 'right' ? 1 : -1;
    const limit = Math.abs(wall) - c.radius;
    const pen = sign * p.d - limit; // how far past the wall line
    if (pen <= 0) continue;
    // Outward normal = sign * right vector of the track here.
    const ox = sign * sample.rx;
    const oz = sign * sample.rz;
    k.pos.x -= ox * pen;
    k.pos.z -= oz * pen;
    const vOut = k.vel.x * ox + k.vel.z * oz;
    if (vOut > 0) {
      // Remove the outward velocity and bounce a bit back.
      k.vel.x -= ox * vOut * (1 + c.wallBounce);
      k.vel.z -= oz * vOut * (1 + c.wallBounce);
      const total = Math.hypot(k.vel.x, k.vel.z) + vOut;
      const headOn = Math.min(1, vOut / Math.max(1, total));
      const keep = 1 - c.wallSpeedLoss * headOn;
      k.vel.x *= keep;
      k.vel.z *= keep;
      // Steer the nose a little along the wall so glancing hits don't stick.
      const tangentHeading = Math.atan2(sample.tx, sample.tz);
      const flip = Math.cos(k.heading - tangentHeading) < 0 ? Math.PI : 0;
      const target = tangentHeading + flip;
      const dh = Math.atan2(Math.sin(target - k.heading), Math.cos(target - k.heading));
      k.heading += dh * 0.25 * headOn;
      syncSpeed(k);
      impact = Math.max(impact, vOut);
    }
  }
  return impact;
}

/**
 * Push overlapping karts apart and exchange momentum along the contact
 * normal. Returns events for haptics.
 *
 * `massOf(slot)` gives each kart's mass (default 1 for all). Like two billiard balls of
 * different weight: the impulse is the same for both karts (Newton's 3rd law) but the velocity
 * change is impulse / mass, so the lighter kart gets shoved more. With equal masses this is the
 * plain "half each" split the game always had.
 */
export function collideKarts(karts: Map<number, KartState>, c: KartConfig = KART, massOf: (slot: number) => number = () => 1): CollisionEvent[] {
  const events: CollisionEvent[] = [];
  const list = [...karts.entries()];
  const minDist = c.radius * 2;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [sa, a] = list[i];
      const [sb, b] = list[j];
      if (Math.abs(a.pos.y - b.pos.y) > 1.5) continue;
      let nx = b.pos.x - a.pos.x;
      let nz = b.pos.z - a.pos.z;
      const dist = Math.hypot(nx, nz);
      if (dist >= minDist) continue;
      if (dist < 1e-6) {
        nx = 1;
        nz = 0;
      } else {
        nx /= dist;
        nz /= dist;
      }
      const ma = Math.max(0.05, massOf(sa));
      const mb = Math.max(0.05, massOf(sb));
      const pen = minDist - dist;
      // Separate the overlap too: the heavier kart gives way less.
      const moveA = pen * (mb / (ma + mb));
      const moveB = pen * (ma / (ma + mb));
      a.pos.x -= nx * moveA;
      a.pos.z -= nz * moveA;
      b.pos.x += nx * moveB;
      b.pos.z += nz * moveB;
      // Relative velocity along the normal; only resolve if approaching.
      const rel = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
      if (rel < 0) {
        // Impulse along the normal: j = -(1+e) * rel / (1/ma + 1/mb); equal masses -> -(1+e)*rel/2 each.
        const j = (-(1 + c.kartBounce) * rel) / (1 / ma + 1 / mb);
        a.vel.x -= (nx * j) / ma;
        a.vel.z -= (nz * j) / ma;
        b.vel.x += (nx * j) / mb;
        b.vel.z += (nz * j) / mb;
        syncSpeed(a);
        syncSpeed(b);
        events.push({ kind: 'kart', slot: sa, impact: -rel }, { kind: 'kart', slot: sb, impact: -rel });
      }
    }
  }
  return events;
}

export { rightOf };
