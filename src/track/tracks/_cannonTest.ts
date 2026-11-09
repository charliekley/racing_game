/**
 * DEV-ONLY test track for the launch cannon (not listed in TRACKS).
 *
 * A "paperclip": up the left straight, around a wide U-turn at the top, down the right
 * straight, around a U-turn at the bottom. The cannon on the left straight fires you across
 * the gap to the right straight, skipping the top U-turn (about 40 % of the lap).
 *
 * To drive it: temporarily add it to src/track/index.ts (import + put it in TRACKS), run
 *   NO_SSL=1 npx vite --port 5180
 * and open  /host/?drive=2&track=Cannon%20Test   (don't commit that change to TRACKS).
 */
import type { TrackDef } from '../types';

export const cannonTest: TrackDef = {
  name: 'Cannon Test',
  points: [
    [0, -100], // 0: start/finish, heading +z
    [0, 0],
    [0, 100], // 2: cannon mouth sits just after here
    [0, 200],
    [20.5, 249.5], // top U-turn (radius 70)
    [70, 270],
    [119.5, 249.5],
    [140, 200], // 7
    [140, 100], // 8: landing is just after here
    [140, 0],
    [140, -100], // 10
    [119.5, -149.5], // bottom U-turn
    [70, -170],
    [20.5, -149.5],
  ],
  width: 15,
  offroadWidth: 9,
  bankPerCurvature: 4,
  maxBankDeg: 7,
  walls: [
    { from: 3, to: 7, side: 'outer' },
    { from: 10, to: 14, side: 'outer' },
  ],
  ramps: [],
  boostPads: [],
  laps: 2,
  checkpoints: 16,
  scenery: { seed: 3, trees: 120, buildings: 6 },
  theme: { grass: '#5fae4a', offroad: '#c9b27a', sky: '#3f8fe0', horizon: '#cfeaff' },
  cannons: [{ at: 2.0, offset: 0, target: { at: 8.0, offset: 0 }, flightTime: 3.0, apex: 14 }],
};
