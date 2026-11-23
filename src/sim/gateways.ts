/**
 * Gateways at the two ends of a shortcut branch (Mushroom Valley's orange routes): where the dirt path crosses the
 * verge, a pair of stone pillars flanks the opening and a signpost stands just before the fork.
 *
 * The LAYOUT lives here, in plain TypeScript, so the renderer (render/branchView.ts) and the collision plan
 * (track/sceneryPlan.ts: the pillars are solid) are built from the same numbers: what you see is what you hit.
 * The fences / walls stop short of the opening (see `BRANCH_GAP` in the track file), so the gap itself is clear.
 */
import type { Track } from './track';

/** Metres either side of the path's centre line where the two pillars of a gate stand (the opening between them is twice this). */
export const GATE_HALF = 8;
/** Radius of a pillar (m): solid. */
export const PILLAR_R = 0.85;
/** Signpost: samples before the fork, and its post radius (solid, small). */
export const SIGN_BACK = 22;
export const SIGN_R = 0.3;

export interface GatewaySpot {
  x: number;
  z: number;
}

export interface GatewayLayout {
  pillars: GatewaySpot[];
  /** Signposts, each with the heading (rad) of the road it faces and the side (+1 / -1) the path leaves on. */
  signs: (GatewaySpot & { tx: number; tz: number; side: number })[];
}

/** Where the pillars and signposts of every branch stand. Empty on tracks whose scenery is not 'mushroom'. */
export function gatewayLayout(track: Track): GatewayLayout {
  const out: GatewayLayout = { pillars: [], signs: [] };
  if (!track.def.scenery.mushroom) return out;
  const n = track.samples.length;
  const edge = track.def.width / 2 + track.def.offroadWidth; // the fence line
  for (const b of track.branches) {
    const side = b.startSide;
    const S = b.samples;
    for (const atStart of [true, false]) {
      // The first path sample (from this end) whose two pillars, each GATE_HALF to one side ACROSS THE PATH, both stand
      // clear of the road and its off-road strip.
      for (let k = 0; k < S.length; k++) {
        const c = S[atStart ? k : S.length - 1 - k];
        const spots = [-1, 1].map((dir) => ({ x: c.x + c.rx * dir * GATE_HALF, z: c.z + c.rz * dir * GATE_HALF }));
        if (spots.every((q) => Math.abs(track.projectOnMain(q.x, q.z).d) >= edge + 2.6) || k === S.length - 1) {
          out.pillars.push(...spots);
          break;
        }
      }
      if (atStart) {
        const m0 = track.projectOnMain(S[0].x, S[0].z);
        const p = track.samples[(((m0.index - SIGN_BACK) % n) + n) % n];
        const off = edge + 2.4; // (beyond the fence line, clear of the road and its off-road strip)
        out.signs.push({ x: p.x + p.rx * side * off, z: p.z + p.rz * side * off, tx: p.tx, tz: p.tz, side });
      }
    }
  }
  return out;
}
