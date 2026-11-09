/**
 * DEVELOPMENT-ONLY test track for the terrain system (NOT listed in TRACKS).
 *
 * A figure-8 (lemniscate) laid on its side:
 *   - the east lobe CLIMBS from 0 to 25 m and comes back down,
 *   - the road crosses ITSELF in the middle: the second pass is a 14 m high
 *     BRIDGE over the first (which is on the ground),
 *   - the west lobe is a ridge road with a CLIFF on its outer (left) side,
 *   - just before the start line there is a jump over a VOID (chasm).
 *
 * To drive it: temporarily add it to TRACKS in src/track/index.ts (don't
 * commit that) and open /host/?drive=4&track=<index>. The tests use it directly.
 */
import type { TrackDef } from '../types';

/** Figure-8 parameters: east/west half size and north/south half size (m). */
const A = 250;
const B = 170;
const COUNT = 24;
/** Control-point heights (m) around the figure-8, indexed from the middle crossing. */
const HEIGHTS = [0, 0, 1, 5, 11, 18, 24, 24, 22, 19, 16.5, 14.5, 14, 14, 14, 14, 13, 11, 9, 6, 3, 1, 0, 0];
/** The loop starts this many points before the first (ground-level) crossing. */
const START = 22;

/** Index in the figure-8 table -> control point number in the track (point 0 = start line). */
const at = (i: number) => (i - START + COUNT) % COUNT;

const points: [number, number, number][] = [];
for (let j = 0; j < COUNT; j++) {
  const i = (START + j) % COUNT;
  const t = (i / COUNT) * Math.PI * 2;
  points.push([Math.round(A * Math.sin(t)), Math.round(B * Math.sin(t) * Math.cos(t) * 1.0), HEIGHTS[i]]);
}

export const terrainTest: TrackDef = {
  name: 'Terrain Test',
  blurb: 'Dev track: climb, bridge over the road, cliff ridge, void jump.',
  points,
  width: 14,
  offroadWidth: 8,
  bankPerCurvature: 4,
  maxBankDeg: 7,
  walls: [
    { from: at(20.2), to: at(21.6) + 0, side: 'both' }, // fence the chasm jump so nobody drives around it
  ],
  ramps: [{ at: at(20.55), length: 9, height: 2.2, gap: 12, gapKind: 'void' }],
  boostPads: [{ at: at(20.15), offset: 0, length: 8, width: 5 }],
  laps: 2,
  checkpoints: 16,
  scenery: { seed: 3, trees: 0, buildings: 0 },
  theme: { grass: '#5fae4a', offroad: '#c9b27a', sky: '#3f8fe0', horizon: '#cfeaff' },
  terrain: {
    seed: 11,
    hills: { amplitude: 7, wavelength: 150 },
    // A mountain under the east lobe so the climb sits on a believable slope.
    features: [{ x: 240, z: 0, radius: 170, height: 20 }],
    blend: 16,
  },
  bridges: [{ from: at(11.1), to: at(12.9) }],
  cliffs: [{ from: at(15.4), to: at(18.8), side: 'left' }],
};
