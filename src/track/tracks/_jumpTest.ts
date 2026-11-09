/**
 * DEVELOPMENT-ONLY test track for the jump system (NOT listed in TRACKS).
 *
 * A flat stadium loop (two 400 m straights, two half-circle ends), about 1.4 km.
 * Control points are 100 m apart on the straights, so "at: 1.3" is 130 m from point 1's
 * straight start. It holds one of everything:
 *
 *   straight A (points 0..4):  boost pad -> kicker over a VOID chasm (landing apron),
 *                              then a DOUBLE kicker;
 *   straight B (points 8..12): kicker over WATER, then a CHAIN of five humps.
 *
 * To drive it: temporarily add it to TRACKS in src/track/index.ts (don't commit that)
 * and open /host/?drive=2&track=<index>. The tests use it directly.
 */
import type { TrackDef } from '../types';

// Control points: straight A (heading +x), right end, straight B (heading -x), left end.
const points: [number, number][] = [
  [-200, -100], [-100, -100], [0, -100], [100, -100], [200, -100],
  [270.7, -70.7], [300, 0], [270.7, 70.7],
  [200, 100], [100, 100], [0, 100], [-100, 100], [-200, 100],
  [-270.7, 70.7], [-300, 0], [-270.7, -70.7],
];

export const jumpTest: TrackDef = {
  name: 'Jump Test',
  blurb: 'Dev track: void jump, double kicker, water jump, hump chain, boost pad.',
  points,
  width: 14,
  offroadWidth: 8,
  bankPerCurvature: 4,
  maxBankDeg: 7,
  walls: [
    // Fence both sides of the gaps so nobody drives around them.
    { from: 1.0, to: 2.0, side: 'both' },
    { from: 8.5, to: 9.4, side: 'both' },
  ],
  ramps: [
    // Straight A: kicker over a 14 m chasm, then a double kicker (24 m long in total).
    { at: 1.3, length: 10, height: 2.4, gap: 14, gapKind: 'void', shape: 'kicker' },
    { at: 2.8, length: 24, height: 1.4, shape: 'double' },
    // Straight B: kicker over a 12 m pond, then five humps back to back (20 m each).
    { at: 8.5, length: 10, height: 2.2, gap: 12, gapKind: 'water', shape: 'kicker' },
    { at: 9.5, length: 20, height: 1.4, shape: 'hump' },
    { at: 9.7, length: 20, height: 1.4, shape: 'hump' },
    { at: 9.9, length: 20, height: 1.4, shape: 'hump' },
    { at: 10.1, length: 20, height: 1.4, shape: 'hump' },
    { at: 10.3, length: 20, height: 1.4, shape: 'hump' },
  ],
  boostPads: [{ at: 0.8, offset: 0, length: 8, width: 5 }],
  laps: 2,
  checkpoints: 12,
  scenery: { seed: 5, trees: 0, buildings: 0 },
  theme: { grass: '#5fae4a', offroad: '#c9b27a', sky: '#3f8fe0', horizon: '#cfeaff' },
};
