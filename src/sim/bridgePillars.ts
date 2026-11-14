/**
 * Where the piers under each bridge stand. Pure maths on the Track (no Three.js), shared by the
 * renderer (terrainView draws a column here) and the simulation (sceneryPlan turns each one into
 * a solid collider), so the columns you see are exactly the ones you bump into.
 */
import { Track, CURB_WIDTH, type TrackSample } from './track';

/** Thickness of a bridge deck (m): the pier stops under it. */
export const BRIDGE_DECK = 1.5;
/** Spacing of the piers along a bridge (m). */
export const PILLAR_SPACING = 14;
/** Base radius of a round column (m); the drawn column flares to ~1.4x this at its foot. */
export const PILLAR_RADIUS = 1.25;

export interface BridgePier {
  /** The track sample above it (position and heading). */
  sample: TrackSample;
  /** true = a wide end wall (abutment) instead of a round column. */
  abutment: boolean;
  /** Ground height at its foot and the height of the deck's underside (m). */
  ground: number;
  deckBottom: number;
  /** Half width of the deck incl. curbs (m): the abutment is this wide each side. */
  half: number;
}

/** All piers of all bridges (only those with at least 0.5 m of clear height: shorter ones are not built). */
export function bridgePiers(track: Track): BridgePier[] {
  const out: BridgePier[] = [];
  const hw = track.def.width / 2;
  const half = hw + CURB_WIDTH;
  const n = track.samples.length;
  const every = Math.max(1, Math.round(PILLAR_SPACING / track.spacing));
  for (const b of track.bridges) {
    const len = (((b.s1 - b.s0) % track.length) + track.length) % track.length;
    const i0 = Math.floor(b.s0 / track.spacing);
    const count = Math.ceil(len / track.spacing) + 1;
    const at = (k: number, abutment: boolean) => {
      const p = track.samples[(i0 + k) % n];
      const deckBottom = p.y + Track.bankLift(p.bank, hw, 0) - BRIDGE_DECK;
      const ground = track.terrain.height(p.x, p.z) - 0.5;
      if (deckBottom - ground < 0.5) return; // too short to build
      if (onOtherRoad(track, p, ground, deckBottom)) return; // the deck spans a road crossing below: no pier there
      out.push({ sample: p, abutment, ground, deckBottom, half });
    };
    for (let k = 0; k < count; k += every) at(k, k === 0);
    at(count - 1, true);
  }
  return out;
}

/**
 * Would a pier at sample `p` (foot at `ground`, top at `deckBottom`) stand on ANOTHER road at its level, such as
 * the road passing under an overpass or a shortcut? (The bridge's own deck and ramps, within 40 m along the
 * road, don't count.)
 */
function onOtherRoad(track: Track, p: TrackSample, ground: number, deckBottom: number): boolean {
  const roads = [track.samples, ...track.branches.map((b) => b.samples)];
  for (const road of roads) {
    for (const q of road) {
      if (road === track.samples && Math.abs(track.deltaS(p.s, q.s)) < 40) continue;
      if (q.y > deckBottom || q.y < ground - 4) continue; // above the pier, or far below it
      const clear = q.width / 2 + CURB_WIDTH + PILLAR_RADIUS + 0.5;
      if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 < clear * clear) return true;
    }
  }
  return false;
}
