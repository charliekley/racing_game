/**
 * Track 1: "Meadow Ring" – a ~1.2 km countryside circuit with a long start
 * straight, a sweeping hairpin, an S-bend, a boost pad and a jump.
 */
import type { TrackDef } from '../types';

export const meadowRing: TrackDef = {
  name: 'Meadow Ring',
  points: [
    [0, -60], // 0: start/finish line, heading +z
    [0, 60],
    [10, 130],
    [60, 175],
    [130, 180],
    [185, 145], // 5
    [200, 80],
    [170, 30],
    [120, 20],
    [90, -20], // S-bend
    [110, -70], // 10
    [170, -95],
    [210, -150],
    [190, -215],
    [130, -235],
    [60, -220], // 15
    [20, -180],
    [0, -130],
  ],
  width: 15,
  offroadWidth: 9,
  bankPerCurvature: 4,
  maxBankDeg: 7,
  walls: [
    { from: 3.5, to: 6.5, side: 'outer' }, // big right-hand sweep
    { from: 8.2, to: 10.2, side: 'both' }, // S-bend chicane
    { from: 12, to: 14, side: 'outer' },
    { from: 16, to: 17.5, side: 'outer' },
  ],
  ramps: [{ at: 15.45, length: 9, height: 1.9 }],
  boostPads: [
    { at: 10.55, offset: 0, length: 6, width: 5 },
    { at: 1.4, offset: -0.45, length: 6, width: 4 },
  ],
  laps: 3,
  checkpoints: 16,
  scenery: { seed: 7, trees: 420, buildings: 26 },
  theme: { grass: '#5fae4a', offroad: '#c9b27a', sky: '#3f8fe0', horizon: '#cfeaff' },
};
