/**
 * Track: "Cloud Garden" – a bright, airy course over floating sky islands.
 *
 * The world under the road is a bottomless bowl (see `terrain` below): its
 * natural height is about 100 m BELOW the islands, so everything past the
 * edge of an island fades into the white fog. Step off and the carrier drone
 * fetches you. There are no fences on purpose: staying on the road IS
 * the challenge.
 *
 * Layout (north = +z, east = +x, counter-clockwise lap, about 1.8 km). The road is one
 * long ribbon of bends (no straight over ~15 m) that climbs from island A to the high island D:
 *
 *   Island A (south, start)   hump chain on the first bend, an S-bend, then BRIDGE 1 east
 *   Island B (south-east)     a serpentine with two hairpins, then a big VOID JUMP north
 *   Island C (north-east)     S-bends and a left curve; the CANNON is here (see below)
 *       ── BRIDGE 2 ──>
 *   Island D (north, highest) a wide bend, then a second VOID JUMP
 *   Island E (west)           double kicker, a hairpin pair, then BRIDGE 3 back to A
 *
 * THE CANNON (high risk): its mouth sits on the RIGHT SIDE of island C's left curve (the
 * racing line hugs the inside, so it misses the mouth). Hit it and you are fired across the
 * sky, skipping island D (bridge, bend and void jump) and landing on island E. Miss the mouth
 * by a metre and you just drive the normal way round.
 *
 * Features used: bridges, void gaps (chasm jumps), a cannon, hump chain, double kicker,
 * boost pads, open drop-offs everywhere, deep-sky terrain.
 *
 * ROOM LEFT FOR LATER GIMMICKS (control-point numbers): the three EXPOSED BRIDGES have no
 * walls and are the places for wind gusts: bridge 1 = points 11 to 15, bridge 2 = 49 to 54,
 * bridge 3 = 85 to 90 (each is a gentle curve about 80-100 m long). The open edges of the
 * void-jump approaches (points 36 to 39 and 61 to 64) work too.
 *
 * Control points are [x, z, height] in metres; the comment on each landmark point says what is
 * near it. Features refer to them by number ("9.25" = a quarter of the way from point 9 to 10).
 */
import type { TrackDef } from '../types';

const points: [number, number, number][] = [
  [-80, -150, 14.0], //  0: start/finish line, heading east (island A): hump chain on the first bend
  [-65, -150, 14.0], //  1
  [-43.3, -148.4, 14.0], //  2
  [-22, -143.7, 14.0], //  3
  [-1.6, -135.9, 14.0], //  4: end of the hump chain
  [17.5, -130.9, 14.0], //  5
  [37.1, -133, 14.0], //  6
  [54.8, -141.9, 14.0], //  7
  [73.6, -151.1, 14.0], //  8
  [94.5, -152.6, 14.1], //  9
  [114.5, -146.1, 14.3], // 10
  [130.5, -132.7, 14.7], // 11: island A: S-bend done; EXPOSED BRIDGE 1 (A to B) starts
  [141.9, -117.2, 15.2], // 12
  [151.8, -100.8, 15.7], // 13
  [160, -83.4, 16.4], // 14
  [166.5, -65.4, 17.0], // 15: bridge 1 ends: island B (boost pad)
  [168.9, -47.1, 17.6], // 16
  [165.2, -29.1, 18.3], // 17
  [155.7, -13.3, 18.8], // 18
  [146.9, 0.7, 19.3], // 19
  [142.6, 16.7, 19.7], // 20
  [143.4, 33.3, 19.9], // 21
  [149, 48.8, 20.0], // 22
  [155.5, 68.5, 20.0], // 23
  [155, 89.2, 20.1], // 24
  [147.5, 108.5, 20.1], // 25: island B: serpentine, first hairpin starts
  [142, 126.9, 20.2], // 26
  [146.2, 145.7, 20.3], // 27
  [159.1, 160, 20.4], // 28
  [177.3, 166.1, 20.5], // 29
  [196.2, 162.6, 20.6], // 30
  [215.3, 159.1, 20.7], // 31
  [233.6, 165.4, 20.8], // 32
  [246.4, 179.9, 20.9], // 33
  [250.4, 198.9, 20.9], // 34
  [244.5, 217.4, 21.0], // 35
  [230.2, 230.5, 21.0], // 36: island B: second hairpin done; boost pad, then the first VOID JUMP north
  [217.5, 238.1, 21.2], // 37
  [205.4, 246.7, 21.5], // 38
  [194.1, 256.3, 21.8], // 39: landing on island C
  [179.3, 266.2, 22.0], // 40
  [162.1, 270.8, 22.1], // 41
  [144.3, 269.7, 22.3], // 42
  [125.7, 268.7, 22.5], // 43
  [107.8, 273.9, 22.8], // 44
  [92.7, 284.9, 23.2], // 45
  [82.2, 300.2, 23.5], // 46
  [73.8, 314.3, 23.7], // 47
  [62.7, 326.4, 23.9], // 48
  [49.4, 336, 24.0], // 49: island C: left curve; the CANNON mouth is on its right side near point 46.8; EXPOSED BRIDGE 2 (C to D) starts
  [32.4, 344.8, 24.1], // 50
  [14.6, 352.1, 24.5], // 51
  [-3.7, 357.9, 25.1], // 52
  [-22.4, 362, 25.8], // 53
  [-41.5, 364.5, 26.6], // 54: bridge 2 ends: island D
  [-62, 361.4, 27.4], // 55
  [-79, 349.5, 28.2], // 56
  [-88.8, 331.2, 28.9], // 57: island D: wide bend
  [-97.5, 313.5, 29.5], // 58
  [-112.5, 300.5, 29.9], // 59
  [-131.3, 294.4, 30.0], // 60
  [-151.9, 287.6, 30.0], // 61: boost pad, then the second VOID JUMP (heading south-west)
  [-164.5, 279.8, 30.0], // 62
  [-176.4, 270.8, 30.0], // 63
  [-187.4, 260.9, 30.0], // 64: landing on island E; the cannon lands just after this
  [-198.1, 246.1, 29.9], // 65
  [-203.4, 228.7, 29.7], // 66
  [-207.7, 207.3, 29.4], // 67
  [-215.1, 186.8, 29.0], // 68
  [-225.4, 167.6, 28.5], // 69: island E: double kicker on the sweeper before this point
  [-231.4, 149.8, 27.8], // 70
  [-228.6, 131.1, 27.1], // 71
  [-217.6, 115.9, 26.4], // 72
  [-200.8, 107.3, 25.6], // 73
  [-182, 107.4, 24.7], // 74
  [-162.9, 107.4, 23.8], // 75
  [-146, 98.6, 22.9], // 76
  [-135.1, 82.9, 22.0], // 77
  [-132.7, 64, 21.1], // 78: island E: hairpin pair
  [-139, 44.9, 20.2], // 79
  [-152.2, 29.8, 19.3], // 80
  [-170.4, 21.1, 18.4], // 81
  [-189.8, 11.5, 17.6], // 82
  [-203.3, -5.4, 16.9], // 83
  [-208.4, -26.4, 16.2], // 84
  [-204.2, -47.6, 15.5], // 85: EXPOSED BRIDGE 3 (E to A) starts
  [-195.4, -65.1, 15.0], // 86
  [-185, -81.6, 14.6], // 87
  [-173, -97, 14.3], // 88
  [-159.6, -111.2, 14.1], // 89
  [-144.8, -124, 14.0], // 90: bridge 3 ends: back on island A
  [-137.3, -131.1, 14.0], // 91
  [-125.5, -141.3, 14.0], // 92
  [-111.3, -147.8, 14.0], // 93
  [-95.9, -150, 14.0], // 94
];

export const cloudGarden: TrackDef = {
  name: 'Cloud Garden',
  blurb: 'Sky islands joined by bridges and void jumps. Risk the cannon to skip a whole island.',
  points,
  width: 14,
  offroadWidth: 6,
  bankPerCurvature: 4,
  maxBankDeg: 8,
  walls: [
    // Fence both sides of the two chasm runs so nobody drives around the gap.
    { from: 36.3, to: 37.7, side: 'both' },
    { from: 61.1, to: 62.5, side: 'both' },
  ],
  ramps: [
    // Island A: a chain of humps to wake you up.
    { at: 0.8, length: 14, height: 1.0, shape: 'hump' },
    { at: 1.8, length: 14, height: 1.0, shape: 'hump' },
    { at: 2.8, length: 14, height: 1.0, shape: 'hump' },
    // Void jump B -> C.
    { at: 36.4, length: 10, height: 2.4, gap: 14, gapKind: 'void', shape: 'kicker' },
    // A hump on island C.
    { at: 44.0, length: 12, height: 1.0, shape: 'hump' },
    // Void jump D -> E.
    { at: 61.2, length: 10, height: 2.4, gap: 14, gapKind: 'void', shape: 'kicker' },
    // Double kicker on island E.
    { at: 66.5, length: 24, height: 1.4, shape: 'double' },
  ],
  boostPads: [
    { at: 36.0, offset: 0, length: 8, width: 5 }, // speed for the first void jump
    { at: 60.9, offset: 0, length: 8, width: 5 }, // speed for the second one
    { at: 15.3, offset: 0, length: 8, width: 5 }, // welcome to island B
    { at: 85.4, offset: 0, length: 8, width: 5 }, // down the home bridge
  ],
  laps: 3,
  checkpoints: 18,
  // No trees: they would float in the sky next to the islands.
  scenery: { seed: 5, trees: 40, buildings: 0, openSky: true },
  // Fresh green islands, pale sandstone rock, blue sky fading to white cloud.
  theme: { grass: '#7ccf5a', offroad: '#f0e2b4', sky: '#4aa8f0', horizon: '#f2f9ff', mood: 'bright' },
  terrain: {
    seed: 3,
    // One enormous bowl: about -100 m under the whole course, deeper in the middle.
    features: [{ x: 10, z: 105, radius: 1600, height: -125 }],
    blend: 14,
  },
  bridges: [
    { from: 11.2, to: 14.9 }, // A -> B (bridge 1)
    { from: 49.2, to: 53.8 }, // C -> D (bridge 2)
    { from: 85.1, to: 89.9 }, // E -> A (bridge 3)
  ],
  cannons: [{ at: 46.8, offset: 0.6, target: { at: 64.5, offset: 0 }, flightTime: 3.4, apex: 24 }],
};
