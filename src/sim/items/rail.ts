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
  let at = p.i;
  if (wantRoute > 0 && route === 0) {
    const b = track.branches[wantRoute - 1];
    if (b) {
      const dist = track.deltaS(p.s, b.s0); // metres to the junction (negative = just past it)
      if (dist > -20 && dist < 80) {
        route = b.route;
        at = Math.round(-dist / track.spacing); // negative = still on the main road before the fork
      }
    }
  }
  const spacing = route > 0 ? track.branches[route - 1].spacing : track.spacing;
  const ahead = track.sampleAhead(route, at, Math.max(2, Math.round(lookMeters / spacing)));
  return { x: ahead.x + ahead.rx * lane, z: ahead.z + ahead.rz * lane, s: p.s, route: p.route, d: p.d, width: p.width, index: p.index };
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
