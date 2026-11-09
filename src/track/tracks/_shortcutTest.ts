/**
 * DEV-ONLY test track for shortcuts (not listed in TRACKS).
 *
 * A big rounded rectangle (about 1.5 km) with three branch roads:
 *   R  road shortcut across the top (from point 6 to 9): clearly shorter than the main road there.
 *   D  dirt shortcut near the start/finish line: it leaves the bottom road at point 16 and rejoins
 *      after the line (to = 0.6 < from = 16, so it wraps across s = 0).
 *   X  a road branch that goes UNDER the main road: the left straight rises onto a bridge (points
 *      2-4) and X (from point 1 to 5.5) swings out to the east, passes beneath the bridge at
 *      (0, 104) and rejoins from the west. It is a scenic detour, not a shortcut.
 *
 * To drive it: temporarily add it to src/track/index.ts (import + put it in TRACKS), run
 *   NO_SSL=1 npx vite --port 5181
 * and open  /host/?drive=2&track=N  (don't commit that change to TRACKS).
 */
import type { TrackDef } from '../types';

export const shortcutTest: TrackDef = {
  name: 'Shortcut Test',
  points: [
    [0, -100], // 0: start/finish, heading +z
    [0, 0], // 1: X leaves here
    [0, 60, 5], // 2: bridge starts
    [0, 100, 10], // 3: crest, X passes underneath
    [0, 140, 5], // 4
    [0, 180, 0], // 5: bridge ends, X rejoins here
    [35, 260], // 6: R leaves here
    [110, 360],
    [200, 360],
    [285, 260], // 9: R rejoins here
    [320, 180],
    [320, 80],
    [320, -20],
    [320, -120],
    [290, -210],
    [200, -290],
    [110, -290], // 16: D leaves here
    [-45, -235],
  ],
  width: 14,
  offroadWidth: 9,
  bankPerCurvature: 4,
  maxBankDeg: 7,
  walls: [],
  ramps: [],
  boostPads: [],
  laps: 3,
  checkpoints: 12,
  scenery: { seed: 1, trees: 0, buildings: 0 },
  theme: { grass: '#5fae4a', offroad: '#c9b27a', sky: '#3f8fe0', horizon: '#cfeaff' },
  bridges: [{ from: 2, to: 4 }],
  shortcuts: [
    {
      // R: road shortcut across the top (a gentle arc inside the main road's bend), with a barrier on the outside of its bend.
      from: 6,
      to: 9,
      points: [
        [85, 300],
        [159, 313],
        [233, 300],
      ],
      walls: [{ from: 1, to: 3, side: 'outer' }],
    },
    {
      // D: dirt shortcut beside the start line; crosses s = 0 (wraps).
      from: 16,
      to: 0.6,
      points: [
        [59, -257],
        [27, -191],
        [9, -112],
      ],
      surface: 'dirt',
    },
    {
      // X: loops out to the east, passes under the bridge at (0, 104) at ground level and rejoins from the west.
      from: 1,
      to: 5.5,
      points: [
        [21, 31, 0],
        [42, 62, 0],
        [30, 92, 0],
        [0, 104, 0],
        [-28, 114, 0],
        [-40, 140, 0],
        [-21, 178, 0],
      ],
    },
  ],
};
