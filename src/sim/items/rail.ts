/**
 * "Rails": a way for an item to follow the ROAD instead of flying in a straight line.
 *
 * The Seeker shot and the Rocket kart both use it. The idea is pure pursuit, the same trick a bot driver
 * uses: find where the thing is on the road (the nearest centerline point), look a few metres FURTHER along
 * the road, and steer toward that point. Because the road's centerline exists even where there is no ground
 * (over a ravine, a water gap, the long hop of a launch cannon), a thing steered this way keeps following
 * the track through the air instead of falling in or flying off the course. Branches (shortcuts) are
 * followed too: it stays on the road it is on, or takes a branch on request.
 *
 * Pure maths on plain data; no DOM, no Three.js, deterministic.
 */
import type { Track } from '../track';

/** Where to steer: a world point on (or beside) the road ahead, plus where we are on the road. */
export interface RailAim {
  x: number;
  z: number;
  /** Distance along the track (m) of the point we are at (the nearest centerline point). */
  s: number;
  /** Which road we are on (0 = main loop, 1+ = shortcut branch) and our sideways offset from its centerline (m, + = right). */
  route: number;
  d: number;
  /** Road width here (m). */
  width: number;
  /** Packed route + sample index of our position: pass it back as `hint` next tick (cheap lookup). */
  index: number;
}

/**
 * The aim point `lookMeters` further along the road from (x, z), shifted `lane` metres to the right of the
 * centerline. `hint` is last tick's `index` (or a kart's `trackIndex`). `wantRoute` > 0 asks to take that
 * shortcut branch when its junction is just ahead (like a bot that likes shortcuts does).
 */
export function railAim(track: Track, x: number, z: number, hint: number, lookMeters: number, lane = 0, wantRoute = 0): RailAim {
  const p = track.project(x, z, hint);
  let route = p.route;
  // Position along the road in (fractional) samples. `project` only returns the NEAREST sample, so on its own the
  // aim point would hop 2 m every time the nearest sample changes: at 50 m/s that is every 2-3 ticks, the heading
  // updates in a stair-step (yaw rate 0, 0, -2.2, 0, ...) and the camera that looks along it shudders. So we add
  // the kart's own along-the-road offset from that sample (a dot product with the tangent) and interpolate.
  let u: number;
  const here = track.sampleOf(p.route, p.i);
  const along = ((x - here.x) * here.tx + (z - here.z) * here.tz) / (p.route > 0 ? track.branches[p.route - 1].spacing : track.spacing);
  u = p.i + Math.max(-1, Math.min(1, along));
  if (wantRoute > 0 && route === 0) {
    const b = track.branches[wantRoute - 1];
    if (b) {
      const dist = track.deltaS(p.s, b.s0); // metres to the junction (negative = just past it)
      if (dist > -20 && dist < 80) {
        route = b.route;
        u = -dist / track.spacing; // negative = still on the main road before the fork
      }
    }
  }
  const spacing = route > 0 ? track.branches[route - 1].spacing : track.spacing;
  u += Math.max(2, lookMeters / spacing);
  const lo = Math.floor(u);
  const fr = u - lo;
  const a = track.sampleAhead(route, lo, 0);
  const c = track.sampleAhead(route, lo, 1);
  const ax = a.x + (c.x - a.x) * fr;
  const az = a.z + (c.z - a.z) * fr;
  const rx = a.rx + (c.rx - a.rx) * fr;
  const rz = a.rz + (c.rz - a.rz) * fr;
  return { x: ax + rx * lane, z: az + rz * lane, s: p.s, route: p.route, d: p.d, width: p.width, index: p.index };
}

/** Smallest signed angle from `from` to `to` (rad, -PI..PI). */
export function angleDiff(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** Turn `heading` toward the direction of the point (tx, tz) seen from (x, z), by at most `maxTurn` rad. */
export function steerToward(heading: number, x: number, z: number, tx: number, tz: number, maxTurn: number): number {
  const err = angleDiff(heading, Math.atan2(tx - x, tz - z));
  return heading + Math.max(-maxTurn, Math.min(maxTurn, err));
}
