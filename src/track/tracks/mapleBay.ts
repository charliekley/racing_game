/**
 * Track 3: "Maple Bay" – a ~1.1 km autumn coastal loop. Wide and flowing,
 * built around one long fast sweeper along the bay:
 *
 *   start straight → the Bayfront sweeper (flat out on a good line)
 *   → harbour chicane → Lighthouse hairpin → ramp → woodland S-section
 *   → tight right onto the start straight.
 */
import type { TrackDef } from '../types';

export const mapleBay: TrackDef = {
  name: 'Maple Bay',
  points: [
    [0, -50], // 0: start/finish, heading +z
    [0, 30],
    [-20, 100], // Bayfront sweeper begins (long right-hander)
    [-70, 155],
    [-140, 175],
    [-205, 155], // 5
    [-240, 105],
    [-240, 60], // harbour chicane: jink left…
    [-258, 35],
    [-258, 0],
    [-240, -25], // …and back right. 10
    [-240, -70], // Lighthouse hairpin (right)
    [-231.2, -91.2],
    [-210, -100],
    [-188.8, -91.2],
    [-180, -70], // 15: heading +z
    [-178, -20], // ramp
    [-150, 15],
    [-110, 10], // woodland S-section
    [-85, -30],
    [-62, -62], // 20
    [-56, -102], // final right-hander onto the straight
    [-47.8, -121.8],
    [-28, -130],
    [-8.2, -121.8],
    [0, -102],
  ],
  width: 15,
  offroadWidth: 9,
  bankPerCurvature: 5,
  maxBankDeg: 9,
  walls: [
    { from: 3, to: 6, side: 'outer' }, // sea wall along the sweeper
    { from: 6.8, to: 10.2, side: 'both' }, // harbour chicane
    { from: 11, to: 15, side: 'outer' }, // around the lighthouse
    { from: 21, to: 25, side: 'outer' },
  ],
  ramps: [{ at: 15.55, length: 9, height: 1.8 }],
  boostPads: [
    { at: 3.6, offset: 0.5, length: 6, width: 4 }, // sweeper apex, inside line
    { at: 15.05, offset: -0.45, length: 6, width: 4 }, // hairpin exit, lines you up for the ramp
    { at: 20.3, offset: 0, length: 6, width: 5 }, // end of the S-section
  ],
  laps: 3,
  checkpoints: 16,
  scenery: { seed: 113, trees: 520, buildings: 34 },
  theme: { grass: '#9a8f3c', offroad: '#c98a3a', sky: '#5d8fcf', horizon: '#f3d9b8' },
};
