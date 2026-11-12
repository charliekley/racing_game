/**
 * Track: "Switchback Summit" – an alpine snow mountain (about 1.5 km).
 *
 * Layout (north = +z, east = +x). The start line is in the valley, heading east:
 *
 *   1. HAIRPIN CLIMB: three long legs zig-zagging north up the mountain, joined by
 *      three tight hairpins (points 3-5, 9-11, 15-17) with barriers on the outside.
 *   2. SUMMIT (point 20), then a long FAST DOWNHILL heading west and south, with a
 *      boost pad and a DOUBLE KICKER (between points 24 and 25).
 *   3. FROZEN LAKE (point 26 to 30): the main road swings wide round the south of the
 *      lake. A DIRT SHORTCUT cuts straight across the ice: shorter, but dirt slows you.
 *   4. FOREST: the road runs north through dense pine woods (solid trees: hit one and you
 *      bounce off and lose speed).
 *   5. SKI-JUMP FINALE (between points 31 and 32): a boost pad, a big kicker and a
 *      CHASM. Clear it and you land down the slope, then it is a short run to the line.
 *
 * Heights (third number of each point) go 0 -> 42 m up the mountain and back to 0.
 * The numbers in `at`/`from`/`to` below refer to the point indices in the comments.
 */
import type { TrackDef } from '../types';

const points: [number, number, number][] = [
  // ---- Valley start (heading east) ----
  [0, 0, 0], //  0: start/finish line
  [70, 0, 0], //  1
  [140, 0, 3], //  2: end of leg 1
  // ---- Hairpin 1 (left turn, east -> west; three points on a 32 m radius semicircle) ----
  [162.6, 9.4, 4], //  3
  [172, 32, 5], //  4
  [162.6, 54.6, 6], //  5
  // ---- Leg 2: west ----
  [140, 64, 7], //  6
  [70, 64, 10], //  7
  [0, 64, 13], //  8
  // ---- Hairpin 2 (right turn, west -> east) ----
  [-22.6, 73.4, 14.5], //  9
  [-32, 96, 16], // 10
  [-22.6, 118.6, 17.5], // 11
  // ---- Leg 3: east ----
  [0, 128, 19], // 12
  [70, 128, 23], // 13
  [140, 128, 27], // 14
  // ---- Hairpin 3 (left turn, east -> west) ----
  [162.6, 137.4, 29], // 15
  [172, 160, 31], // 16
  [162.6, 182.6, 33], // 17
  // ---- Leg 4: west, to the summit ----
  [140, 192, 35], // 18
  [70, 192, 39], // 19
  [0, 192, 42], // 20: summit
  // ---- Long downhill: west, then curving south ----
  [-80, 212, 41], // 21
  [-170, 202, 36], // 22
  [-250, 157, 29], // 23: boost pad on the way into the straight
  [-280, 80, 23], // 24: double kicker just after this point
  [-285, 0, 17], // 25
  // ---- Frozen lake ----
  [-270, -70, 13], // 26: the shortcut across the ice leaves here
  [-250, -150, 10.5], // 27: the main road swings south round the lake
  [-180, -190, 8.5], // 28
  [-110, -170, 7], // 29
  // ---- Forest, then the ski-jump straight (heading north) ----
  [-92, -150, 6.5], // 30: the shortcut rejoins here, forest starts
  [-96, -90, 5.5], // 31: ski jump starts just after this
  [-92, -30, 3.5], // 32
  [-60, -8, 1.5], // 33: sweeping right into the start line
];

export const switchbackSummit: TrackDef = {
  name: 'Switchback Summit',
  blurb: 'Hairpin climb, fast downhill with a double kicker, a frozen-lake shortcut, a pine forest and a ski-jump finale.',
  points,
  width: 14,
  offroadWidth: 8,
  bankPerCurvature: 4,
  maxBankDeg: 8,
  walls: [
    // Barriers on the outside of the three hairpins.
    { from: 2.6, to: 5.4, side: 'outer' },
    { from: 8.6, to: 11.4, side: 'outer' },
    { from: 14.6, to: 17.4, side: 'outer' },
    // Guard rails on the sides of the climbing legs that face the next leg, so nobody can
    // cut across the hillside from one leg to another (that would skip checkpoints).
    { from: 0.6, to: 2.2, side: 'left' }, // leg 1 (east): leg 2 is to the north = left
    { from: 6.0, to: 8.0, side: 'both' }, // leg 2: legs 1 and 3 on either side
    { from: 12.0, to: 14.0, side: 'both' }, // leg 3: legs 2 and 4 on either side
    { from: 18.0, to: 19.6, side: 'left' }, // leg 4 (west): leg 3 is to the south = left
    // Fence both sides of the ski-jump chasm so nobody drives round it.
    { from: 31.1, to: 31.8, side: 'both' },
  ],
  ramps: [
    { at: 1.0, length: 8, height: 1.0 }, // warm-up kicker on the start straight
    { at: 13.4, length: 14, height: 1.2, shape: 'hump' }, // a bump on climbing leg 3
    { at: 22.3, length: 14, height: 1.2, shape: 'hump' }, // a bump early in the downhill
    { at: 24.2, length: 26, height: 1.5, shape: 'double' }, // THE double kicker
    { at: 31.15, length: 12, height: 2.6, gap: 14, gapKind: 'void', shape: 'kicker' }, // ski jump
  ],
  boostPads: [
    { at: 23.3, offset: 0, length: 8, width: 5 }, // speed for the double kicker
    { at: 30.7, offset: 0, length: 8, width: 5 }, // speed for the ski jump
  ],
  laps: 3,
  checkpoints: 16,
  // Lots of trees: the plan clumps them in woods, which makes the forest section.
  scenery: { seed: 31, trees: 600, buildings: 0 },
  // Snow ground (pale -> snow biome: pines with snow caps), blue-grey packed snow verge, pale sky.
  theme: { grass: '#eef3f8', offroad: '#aebccc', sky: '#9fc2e6', horizon: '#eef4fb', mood: 'snow' },
  terrain: {
    seed: 11,
    hills: { amplitude: 3, wavelength: 90 },
    features: [
      { x: 70, z: 110, radius: 200, height: 26 }, // the mountain behind the climb
      { x: -185, z: -140, radius: 38, height: -4 }, // the frozen lake basin between shortcut and main road
    ],
    blend: 18,
  },
  shortcuts: [
    {
      // Straight across the frozen lake, on dirt (it is slower than tarmac).
      from: 26,
      to: 30,
      points: [
        [-225, -95],
        [-160, -115],
      ],
      surface: 'dirt',
      width: 12,
    },
  ],
};
