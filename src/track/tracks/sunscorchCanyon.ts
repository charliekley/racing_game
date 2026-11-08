/**
 * Track 2: "Sunscorch Canyon" – a ~1.5 km desert circuit squeezed between
 * rock walls. Narrower road than Meadow Ring and far more barriers, so it
 * rewards precise lines:
 *
 *   start straight → tight left hairpin → chicane → long fast sweeper
 *   → ramp over a dry wash → S-section → the "Mesa Run" back straight
 *   → wiggling canyon floor → final hairpin onto the start straight.
 */
import type { TrackDef } from '../types';

export const sunscorchCanyon: TrackDef = {
  name: 'Sunscorch Canyon',
  points: [
    [0, -60], // 0: start/finish, heading +z
    [0, 40],
    [0, 112], // brake for the hairpin
    [7.6, 133.4],
    [26, 141], // hairpin apex
    [44.4, 133.4], // 5
    [52, 112], // exit heading -z
    [52, 60],
    [66, 38], // chicane: jink right…
    [66, 10],
    [52, -12], // …and back left. 10
    [52, -50], // into the big sweeper
    [70, -100],
    [115, -125],
    [165, -110],
    [190, -65], // 15: heading +z again
    [190, -10], // ramp over the wash
    [175, 40], // S-section: left…
    [195, 85], // …right…
    [175, 130], // …left
    [150, 175], // 20
    [100, 200],
    [40, 215], // Mesa Run (back straight)
    [-30, 200],
    [-70, 160],
    [-80, 90], // 25: canyon floor wiggle
    [-65, 30],
    [-85, -30],
    [-75, -100],
    [-45, -130], // final hairpin
    [-8, -110], // 30
  ],
  width: 13,
  offroadWidth: 7,
  bankPerCurvature: 4,
  maxBankDeg: 8,
  walls: [
    { from: 2.5, to: 6, side: 'outer' }, // hairpin
    { from: 7.5, to: 10.5, side: 'both' }, // chicane
    { from: 12, to: 15, side: 'outer' }, // sweeper
    { from: 17, to: 19.8, side: 'both' }, // S-section between rock walls
    { from: 24.5, to: 28, side: 'both' }, // narrow canyon floor
    { from: 28.5, to: 30.5, side: 'outer' }, // final hairpin
  ],
  ramps: [{ at: 15.6, length: 9, height: 2 }],
  boostPads: [
    { at: 6.3, offset: 0.45, length: 6, width: 4 }, // hairpin exit, on the inside line
    { at: 13.6, offset: -0.5, length: 6, width: 4 }, // sweeper apex
    { at: 21.4, offset: 0, length: 6, width: 5 }, // start of the Mesa Run
  ],
  laps: 3,
  checkpoints: 18,
  scenery: { seed: 31, trees: 90, buildings: 6 },
  theme: { grass: '#d9a066', offroad: '#b9764a', sky: '#5aa6e8', horizon: '#f6dcb0' },
};
