/**
 * Track: "Switchback Summit" – an alpine snow mountain (about 1.9 km, ~24 tight corners).
 *
 * Layout (north = +z, east = +x). The start line is in the valley, heading east:
 *
 *   1. HAIRPIN CLIMB: a valley S-bend, then four legs zig-zagging north up the mountain,
 *      joined by three tight hairpins (points 8-14, 23-29, 38-44). Every leg has a slow
 *      S-bend in the middle, so there is no real straight anywhere. Guard rails on the sides
 *      that face the next leg stop you cutting across the hillside.
 *   2. SUMMIT (point 53, 42 m up), then a long FAST DOWNHILL heading west and south: boost
 *      pad, hump, DOUBLE KICKER, a long left sweeper, a blind crest into a chicane.
 *   3. FROZEN LAKE: the main road swings wide round the west and south of the lake (points
 *      74 to 99). A DIRT SHORTCUT cuts straight across the ice: shorter, but dirt slows you.
 *   4. FOREST: the road runs east through dense pine woods (solid trees: hit one and you
 *      bounce off and lose speed), points 89 to 101.
 *   5. SKI-JUMP FINALE (points 101 to 104): a boost pad, a big kicker and a CHASM. Clear it
 *      and you land down the slope, then it is a short run to the line.
 *
 * Heights (third number of each point) go 0 -> 42 m up the mountain and back to 0.
 *
 * SNOWBALLS (`hazards`): the downhill from the summit, points 59 to 64, has an open snow slope
 * on its north side (two hill features in `terrain`; sideways sign -1, so `from: -1`). Four snowballs
 * roll down it and across the road, one every 9 s each, at different moments (phases), so there
 * is always a gap: time it, or take the other lane.
 *
 * Control point numbers (the numbers in `at`/`from`/`to` refer to these; the comments on
 * the points say what is there).
 */
import type { TrackDef } from '../types';

const points: [number, number, number][] = [
  [0, 0, 0.0], //  0: start/finish in the valley, heading east (warm-up kicker just after it)
  [15, 0, 0.8], //  1
  [30, 0, 1.6], //  2
  [49.1, -1.8, 2.4], //  3
  [67.5, -7.3, 3.2], //  4
  [85.8, -12.7, 4.0], //  5
  [104.9, -14.6, 4.8], //  6: valley S-bend
  [119.9, -14.6, 5.5], //  7
  [134.9, -14.6, 6.3], //  8: leg 1 ends: HAIRPIN 1 (left) starts
  [152.9, -9.7, 7.1], //  9
  [166.1, 3.4, 7.9], // 10
  [170.9, 21.4, 8.7], // 11
  [166.1, 39.4, 9.5], // 12
  [152.9, 52.6, 10.3], // 13
  [134.9, 57.4, 11.1], // 14: hairpin 1 done: leg 2 heads west (S-bends in every leg)
  [122.9, 57.4, 11.9], // 15
  [107.7, 56, 12.7], // 16
  [93, 51.6, 13.5], // 17
  [73.2, 46.4, 14.3], // 18
  [52.8, 46.4, 15.1], // 19
  [33, 51.6, 15.8], // 20
  [18.3, 56, 16.6], // 21
  [3, 57.4, 17.4], // 22
  [-9, 57.4, 18.2], // 23: leg 2 ends: HAIRPIN 2 (right) starts
  [-27, 62.3, 19.0], // 24
  [-40.1, 75.4, 19.8], // 25
  [-45, 93.4, 20.6], // 26
  [-40.1, 111.4, 21.4], // 27
  [-27, 124.6, 22.2], // 28
  [-9, 129.4, 23.0], // 29: hairpin 2 done: leg 3 heads east
  [3, 129.4, 23.8], // 30
  [18.3, 128, 24.6], // 31
  [33, 123.6, 25.4], // 32
  [52.8, 118.4, 26.2], // 33
  [73.2, 118.4, 26.9], // 34
  [93, 123.6, 27.7], // 35
  [107.7, 128, 28.5], // 36
  [122.9, 129.4, 29.3], // 37
  [134.9, 129.4, 30.1], // 38: leg 3 ends: HAIRPIN 3 (left) starts
  [152.9, 134.3, 30.9], // 39
  [166.1, 147.4, 31.7], // 40
  [170.9, 165.4, 32.5], // 41
  [166.1, 183.4, 33.3], // 42
  [152.9, 196.6, 34.1], // 43
  [134.9, 201.4, 34.9], // 44: hairpin 3 done: leg 4 heads west to the summit
  [122.9, 201.4, 35.7], // 45
  [107.7, 200, 36.5], // 46
  [93, 195.6, 37.2], // 47
  [73.2, 190.4, 38.0], // 48
  [52.8, 190.4, 38.8], // 49
  [33, 195.6, 39.6], // 50
  [18.3, 200, 40.4], // 51
  [3, 201.4, 41.2], // 52
  [-9, 201.4, 42.0], // 53: SUMMIT (42 m). The long fast downhill starts: boost pad, hump, double kicker
  [-24, 202.3, 41.8], // 54
  [-38.9, 204.9, 41.7], // 55
  [-53.4, 209.3, 41.5], // 56
  [-67.9, 213.6, 41.3], // 57
  [-82.8, 216.2, 41.2], // 58
  [-97.9, 217.1, 41.0], // 59: downhill: end of the S-sweeper. ROLLER SLOT: points 59 to 72 are the open-slope stretch
  [-117.4, 215.5, 40.5], // 60
  [-136.5, 210.8, 40.0], // 61
  [-154.5, 202.9, 39.5], // 62
  [-171, 192.3, 39.0], // 63
  [-185.5, 179.1, 38.5], // 64: downhill: long left sweeper ends
  [-200, 167.8, 38.0], // 65
  [-217.3, 161.3, 37.5], // 66
  [-235.7, 160.5, 36.2], // 67
  [-253.6, 165.2, 35.0], // 68
  [-273.1, 170.2, 33.8], // 69
  [-293.2, 168.4, 32.5], // 70
  [-311.5, 160, 31.2], // 71: downhill: chicane (blind crest just before it)
  [-325, 145.7, 30.0], // 72
  [-331.2, 133.2, 29.3], // 73
  [-335.6, 120.1, 28.6], // 74: the dirt shortcut across the frozen lake leaves here
  [-338.5, 103.8, 27.9], // 75
  [-338.6, 87.3, 27.2], // 76
  [-339.3, 69.3, 26.5], // 77
  [-343.9, 52, 25.0], // 78
  [-352.3, 36.1, 23.5], // 79
  [-364.1, 22.5, 22.0], // 80
  [-377.3, 6.6, 21.1], // 81
  [-386, -12.2, 20.2], // 82
  [-389.7, -32.5, 19.3], // 83: west end of the valley floor: wide swing round the lake
  [-387.1, -52.9, 18.4], // 84
  [-377.8, -71.2, 17.6], // 85
  [-362.9, -85.3, 16.7], // 86
  [-344.2, -93.6, 15.8], // 87
  [-323.7, -95, 14.9], // 88
  [-304, -89.5, 14.0], // 89: forest starts (road heads east through the woods)
  [-287.6, -83.4, 13.5], // 90
  [-270.5, -80.3, 13.0], // 91
  [-253, -80.1, 12.5], // 92
  [-235.6, -80, 12.0], // 93
  [-218.5, -76.8, 11.5], // 94
  [-202.1, -70.8, 11.0], // 95
  [-188.1, -65.1, 10.3], // 96
  [-173.6, -61, 9.7], // 97
  [-158.6, -58.7, 9.0], // 98
  [-143.7, -56.4, 8.3], // 99: the dirt shortcut rejoins here
  [-129.1, -52.4, 7.7], // 100
  [-115.1, -46.7, 7.0], // 101: forest ends; boost pad, then the SKI JUMP over a chasm
  [-98.7, -38, 6.1], // 102
  [-83.2, -27.7, 5.2], // 103
  [-68.6, -16, 4.4], // 104: landing, then a short run to the line
  [-58.9, -9, 3.5], // 105
  [-47.9, -4.1, 2.6], // 106
  [-35.4, -1, 1.8], // 107
  [-22.6, 0, 0.9], // 108
  [-11.3, 0, 0.0], // 109
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
    { from: 8.4, to: 13.6, side: 'outer' },
    { from: 23.4, to: 28.6, side: 'outer' },
    { from: 38.4, to: 43.6, side: 'outer' },
    // Guard rails on the sides of the climbing legs that face the next leg, so nobody can
    // cut across the hillside from one leg to another (that would skip checkpoints).
    { from: 2.5, to: 7.0, side: 'left' }, // leg 1 (east): leg 2 is to the north = left
    { from: 16.0, to: 22.0, side: 'both' }, // leg 2: legs 1 and 3 on either side
    { from: 31.0, to: 37.0, side: 'both' }, // leg 3: legs 2 and 4 on either side
    { from: 46.0, to: 52.0, side: 'left' }, // leg 4 (west): leg 3 is to the south = left
    // Fence both sides of the ski-jump chasm so nobody drives round it.
    { from: 101.6, to: 103.3, side: 'both' },
  ],
  ramps: [
    { at: 1.6, length: 8, height: 1.0 }, // warm-up kicker on the start straight
    { at: 31.5, length: 14, height: 1.2, shape: 'hump' }, // a bump on climbing leg 3
    { at: 53.6, length: 14, height: 1.2, shape: 'hump' }, // a bump at the top of the downhill
    { at: 56.0, length: 26, height: 1.5, shape: 'double' }, // THE double kicker
    { at: 69.3, length: 14, height: 1.2, shape: 'hump' }, // a blind crest just before the chicane
    { at: 101.5, length: 12, height: 2.6, gap: 14, gapKind: 'void', shape: 'kicker' }, // ski jump
  ],
  boostPads: [
    { at: 55.0, offset: 0, length: 8, width: 5 }, // speed for the double kicker
    { at: 101.0, offset: 0, length: 8, width: 5 }, // speed for the ski jump
  ],
  laps: 3,
  checkpoints: 16,
  // Lots of trees: the plan clumps them in woods, which makes the forest section.
  scenery: { seed: 55, trees: 600, buildings: 0 },
  // Snow ground (pale -> snow biome: pines with snow caps), blue-grey packed snow verge, pale sky.
  theme: { grass: '#eef3f8', offroad: '#aebccc', sky: '#9fc2e6', horizon: '#eef4fb', mood: 'snow' },
  terrain: {
    seed: 11,
    hills: { amplitude: 3, wavelength: 90 },
    features: [
      { x: 70, z: 110, radius: 200, height: 26 }, // the mountain behind the climb
      { x: -240, z: 35, radius: 55, height: -4 }, // the frozen lake basin between the shortcut and the main road
      { x: -140, z: 262, radius: 105, height: 58 }, // an open snow slope rising on the left of the downhill (points 59-72): the snowballs roll down it
      { x: -240, z: 235, radius: 100, height: 52 }, // ...continuing along the road
    ],
    blend: 18,
  },
  hazards: [
    // period 9 s, staggered: a ball crosses somewhere every ~2.3 s. Each warns ~1.5 s up the slope first.
    { kind: 'roller', at: 59.9, period: 9, phase: 0, from: -1 },
    { kind: 'roller', at: 61.0, period: 9, phase: 2.3, from: -1 },
    { kind: 'roller', at: 62.1, period: 9, phase: 4.6, from: -1 },
    { kind: 'roller', at: 63.2, period: 9, phase: 6.8, from: -1 },
  ],
  shortcuts: [
    {
      // Straight across the frozen lake, on dirt (it is slower than tarmac).
      from: 74,
      to: 99,
      points: [
        [-300, 110],
        [-256, 96],
        [-266, 54],
        [-225, 38],
        [-250, 5],
        [-205, -22],
        [-172, -48],
      ],
      surface: 'dirt',
      width: 12,
    },
  ],
};
