/**
 * Track: "Ember Peaks" – a volcanic mountain road at dusk.
 *
 * You start on the plain south of the volcano and CLIMB a switchback (a long
 * leg west, a hairpin, a leg back east), then turn north up a straight ramp to
 * the crater rim. Up there the choice is:
 *
 *   * ridge road (counter-clockwise round the rim): cliffs on the crater side
 *     and on the outer slope, a knife-edge stretch with a drop on BOTH sides,
 *     a hump on the crest. About 270 m of careful driving;
 *   * CANNON: just drive straight on at the end of the ramp instead of turning
 *     onto the rim. The cannon flings you across the crater onto the north rim.
 *     Miss the mouth and you simply take the ridge.
 *
 * After the rim the road drops down the west side of the mountain: a boost pad,
 * then a kicker over a CHASM (void gap: too slow and you fall), a double
 * kicker, and a fast run back to the start line.
 *
 * Every control point is [x, z, height] in metres. The crater centre is
 * (30, 0); the rim road circles it at a radius of about 85 m and a height of
 * about 30 m. Positions of features are given in control-point units, so the
 * comment on each point says what happens near it.
 */
import type { TrackDef } from '../types';

/** Crater centre and rim radius (m); only used to build the rim points below. */
const CRATER = { x: 30, z: 0 };

/**
 * One rim control point. `angle` is measured counter-clockwise from due south
 * (0 = south, 90 = east, 180 = north), `radius` is the distance from the
 * crater centre. Varying the radius a little gives the ridge some wiggle.
 */
function rim(angle: number, radius: number, height: number): [number, number, number] {
  const a = (angle * Math.PI) / 180;
  return [
    Math.round(CRATER.x + radius * Math.sin(a)),
    Math.round(CRATER.z - radius * Math.cos(a)),
    height,
  ];
}

const points: [number, number, number][] = [
  // ---- Start straight on the plain (heading east) ----
  [-90, -310, 0], //  0: start/finish line
  [10, -312, 0], //  1: hump on the straight
  [110, -310, 1], //  2
  // ---- Hairpin 1 (left, east -> west) ----
  [175, -308, 2], //  3
  [201, -299, 3], //  4
  [212, -272, 4], //  5
  [201, -245, 5], //  6
  // ---- Climb, leg 1: west ----
  [175, -235, 6], //  7
  [100, -233, 8], //  8: hump
  [20, -235, 10], //  9
  [-60, -236, 12], // 10
  // ---- Hairpin 2 (right, west -> east) ----
  [-85, -225, 13], // 11
  [-95, -200, 14], // 12
  [-85, -175, 15], // 13
  // ---- Climb, leg 2: east, then left up the ramp to the crater ----
  [-60, -168, 16], // 14
  [-20, -170, 17.5], // 15
  [10, -165, 19], // 16
  [27, -148, 21.5], // 17
  [30, -128, 24], // 18: the CANNON mouth sits just after this point
  [38, -100, 27], // 19: end of the straight, the ridge turns right here
  // ---- The rim ridge (counter-clockwise) ----
  rim(30, 85, 30), // 20
  rim(60, 88, 31), // 21: crater-side cliff starts
  rim(90, 80, 30), // 22: hump on the crest
  rim(120, 90, 29), // 23: knife edge (cliffs on both sides)
  rim(150, 84, 31), // 24: outer-slope cliff
  rim(180, 85, 30), // 25: north rim, the cannon lands here
  rim(210, 86, 29), // 26
  // ---- Descent down the west side ----
  [-60, 80, 26], // 27
  [-130, 95, 22], // 28
  [-200, 85, 18], // 29
  [-255, 45, 14], // 30
  [-285, -10, 11], // 31: straight south: boost pad, then the chasm
  [-290, -70, 9], // 32: kicker over the chasm
  [-290, -130, 7], // 33: double kicker
  [-280, -190, 5], // 34
  [-245, -250, 3], // 35
  [-200, -290, 1.5], // 36
  [-150, -308, 0.5], // 37: back to the start line
];

export const emberPeaks: TrackDef = {
  name: 'Ember Peaks',
  blurb: 'Climb a volcano, race the crater rim or fire across it with the cannon, then leap the chasm.',
  points,
  width: 14,
  offroadWidth: 8,
  bankPerCurvature: 4,
  maxBankDeg: 8,
  walls: [
    // Hairpin barriers on the outside of both switchback turns.
    { from: 3.3, to: 6.7, side: 'outer' },
    { from: 10.7, to: 13.3, side: 'outer' },
    // Fence both sides of the chasm run so nobody drives around the gap.
    { from: 31.9, to: 32.9, side: 'both' },
  ],
  ramps: [
    { at: 1.0, length: 8, height: 1.0 }, // warm-up kicker on the start straight
    { at: 8.0, length: 8, height: 1.0 }, // small kicker on the first climbing leg
    { at: 22.0, length: 8, height: 1.0 }, // small kicker on the ridge crest
    { at: 32.1, length: 10, height: 2.4, gap: 12, gapKind: 'void', shape: 'kicker' }, // the chasm
    { at: 33.3, length: 24, height: 1.4, shape: 'double' }, // double kicker after the chasm
  ],
  boostPads: [
    { at: 31.5, offset: 0, length: 8, width: 5 }, // speed for the chasm
    { at: 26.6, offset: 0, length: 8, width: 5 }, // after the cannon landing / ridge: keep the speed up
  ],
  laps: 3,
  checkpoints: 18,
  scenery: { seed: 17, trees: 70, buildings: 0 },
  // Dark ash ground, rust-orange rock, purple dusk sky glowing orange at the horizon.
  theme: { grass: '#4a2f2a', offroad: '#7a3b22', sky: '#3a2a5c', horizon: '#ff8a4a', mood: 'dusk' },
  terrain: {
    seed: 7,
    hills: { amplitude: 4, wavelength: 70 },
    features: [
      { x: CRATER.x, z: CRATER.z, radius: 300, height: 34 }, // the volcano
      { x: CRATER.x, z: CRATER.z, radius: 80, height: -36 }, // the crater bowl inside it
    ],
    blend: 20,
  },
  cliffs: [
    { from: 21.0, to: 22.6, side: 'left', edge: 15 }, // crater side
    { from: 22.8, to: 23.7, side: 'both', edge: 15 }, // knife edge
    { from: 23.9, to: 25.0, side: 'right', edge: 15 }, // outer slope
  ],
  cannons: [{ at: 18.6, offset: 0, target: { at: 25.0, offset: 0 }, flightTime: 3.8, apex: 18 }],
};
