/**
 * Track: "Dockside Loop" – an evening harbour figure-8 (about 1.8 km, ~20 tight corners).
 *
 * Layout (north = +z, east = +x; the start line is on the south quay, heading east).
 * The lap is built from many short bends on purpose: no straight is longer than ~55 m.
 *
 *   START quay: four plank humps on a gentle bend, boost pad, a kicker over a flooded gap
 *      → tight right, wide left, then an S-bend north to the GROUND CROSSING at the middle
 *        (you pass UNDER the overpass; point 23)
 *      → climb up the east lobe through an S-bend, a sweeper and a chicane onto the
 *        elevated viaduct (bridge with parapets) round the container yard
 *      → east chicane and the SE hairpin, then a 50 m straight water crossing on the high road
 *      → the viaduct crosses OVER the ground road (point 64, deck 13 m up)
 *      → descent through the west lobe: sweeper, two chicanes, a hairpin round the west end.
 *
 *   SHORTCUT (dirt): a U-turn through the inside of the west lobe, hidden behind warehouses.
 *
 * Features used: figure-8 with bridge overpass (>= 7 m separation), solid container
 * stacks and warehouses (scenery.blocks), water gaps, hump chain, dirt shortcut, boost
 * pads, banked walls.
 *
 * THE DRAWBRIDGE (hazard, see src/sim/hazards/drawbridge.ts): points 57 to 60 are a dead-straight
 * 50 m water crossing on the viaduct. Points 52 to 57 are the set-up: the SE hairpin exit and a
 * gentle curve (R ~ 180 m), boost pad at 56.3. Two leaves hinged at the ends rise (kicker ramps with
 * a 12 m opening between the tips); the boost pad gives the speed to jump it, a slow kart drops in.
 *
 * Control point numbers (the numbers in `at`/`from`/`to` refer to these; the comment on
 * each landmark point says what is there):
 *   0 start … 23 ground crossing … 36-74 viaduct … 57-60 water crossing … 64 overpass …
 *   80 shortcut leaves … 90 west end hairpin … 96 shortcut rejoins.
 */
import type { BlockDef, TrackDef } from '../types';

// ---- Scenery blocks (solid) ------------------------------------------------

/** A container stack: `layers` high (2.6 m each), `len` m long along `rot`. */
function stack(x: number, z: number, layers: number, color: string, rot = 0, len = 12.2, wide = 5): BlockDef {
  return { kind: 'container', x, z, w: wide, d: len, h: layers * 2.6, rot, color };
}
/** A warehouse: w across x, d along z (rot 0). */
function warehouse(x: number, z: number, w: number, d: number, color: string, rot = 0): BlockDef {
  return { kind: 'warehouse', x, z, w, d, h: 8, rot, color };
}

const R = Math.PI / 2; // containers lying along the x axis
const blocks: BlockDef[] = [
  // Warehouses inside the west lobe: the dirt shortcut runs behind them.
  warehouse(-308, -45, 12, 34, '#b7573d'),
  warehouse(-228, -45, 30, 14, '#6d8aa8'),
  // Container rows in the middle of the west lobe, north of the quay.
  stack(-190, -72, 3, '#c0392b', R),
  stack(-176, -72, 2, '#2e86c1', R),
  stack(-162, -72, 3, '#d4a017', R),
  stack(-148, -72, 2, '#27ae60', R),
  stack(-120, -66, 3, '#8e44ad', R),
  // Backdrop on the harbour side of the quay.
  stack(-200, -160, 3, '#e67e22', R),
  stack(-186, -160, 3, '#2e86c1', R),
  stack(-172, -160, 2, '#c0392b', R),
  stack(-60, -170, 3, '#27ae60', R),
  // Container yard inside the east lobe, far below the viaduct.
  stack(130, 45, 3, '#c0392b', 0),
  stack(146, 45, 3, '#d4a017', 0),
  stack(162, 45, 2, '#2e86c1', 0),
  stack(178, 45, 2, '#27ae60', 0),
  stack(122, 75, 2, '#e67e22', 0),
  stack(138, 75, 3, '#8e44ad', 0),
  stack(154, 75, 3, '#c0392b', 0),
  stack(170, 75, 2, '#d4a017', 0),
  stack(205, 62, 2, '#c0392b', R),
  // A warehouse north-east of the east lobe, below the road.
  warehouse(215, 218, 30, 16, '#8a8f98'),
];

const points: [number, number, number][] = [
  [-225, -130, 0.0], //  0: start/finish on the south quay, heading east (hump chain starts)
  [-211, -130, 0.0], //  1
  [-190.6, -128.1, 0.0], //  2
  [-171, -122.5, 0.0], //  3
  [-152.7, -113.3, 0.0], //  4: end of the hump chain (end of the first gentle bend)
  [-134.4, -104.1, 0.0], //  5
  [-114.8, -98.5, 0.1], //  6
  [-94.4, -96.6, 0.1], //  7: quay gap (flooded) after the boost pad; end of the gentle S
  [-77.1, -96.6, 0.1], //  8
  [-61.4, -99.1, 0.1], //  9
  [-47.3, -106.5, 0.1], // 10
  [-36.2, -117.9, 0.1], // 11: quay: tight right-hander
  [-20.2, -132.5, 0.2], // 12
  [0.4, -139, 0.2], // 13
  [21.9, -136.2, 0.2], // 14
  [40.1, -124.6, 0.2], // 15: quay: wide left, now heading north-east
  [50.7, -114, 0.2], // 16
  [61.5, -96.8, 0.2], // 17
  [63.6, -76.7, 0.3], // 18
  [56.7, -57.7, 0.3], // 19
  [50.9, -44.4, 0.3], // 20
  [49.5, -30, 0.3], // 21: S-bend ('quay chicane') on the way to the ground crossing
  [51.1, -8.5, 0.3], // 22
  [52.6, 13, 0.3], // 23: GROUND CROSSING at the middle (you pass UNDER the viaduct, point 64)
  [54, 32.9, 0.4], // 24
  [58.4, 50.2, 0.6], // 25
  [68.3, 65.1, 1.0], // 26
  [77, 77.1, 1.5], // 27
  [82.1, 91.1, 2.1], // 28
  [83.4, 105.9, 2.8], // 29: the road climbs: S-bend done
  [86, 123.8, 3.6], // 30
  [95.4, 139.3, 4.4], // 31
  [110, 150, 5.3], // 32
  [127.6, 154.2, 6.2], // 33: NE sweeper; the viaduct (bridge) begins at about point 36
  [145.2, 157.5, 7.1], // 34
  [161, 166.1, 8.0], // 35
  [175.8, 174.4, 8.9], // 36
  [192.4, 178, 9.7], // 37
  [209.3, 176.7, 10.5], // 38
  [225.1, 170.5, 11.2], // 39: NE chicane
  [240.3, 158, 11.8], // 40
  [250.4, 141.1, 12.3], // 41
  [254.3, 121.9, 12.7], // 42
  [254.7, 107.2, 12.9], // 43
  [255.2, 92.6, 13.0], // 44
  [259.9, 71.3, 13.0], // 45
  [272.2, 53.2, 13.0], // 46
  [283.8, 36.7, 13.0], // 47
  [289.1, 17.3, 13.0], // 48: east chicane (east end of the viaduct)
  [287.6, -0.3, 13.0], // 49
  [280, -16.2, 13.0], // 50
  [267.4, -28.5, 13.0], // 51
  [251.3, -35.7, 13.0], // 52: SE hairpin
  [233, -39.2, 13.0], // 53
  [214.5, -40.8, 13.0], // 54
  [195.9, -40.5, 13.0], // 55
  [177.4, -38.1, 13.0], // 56
  [159.3, -33.9, 13.0], // 57: water crossing: 50 m straight (future drawbridge slot) starts; the set-up is the curve 52 to 57
  [143.2, -29.3, 13.0], // 58
  [127.2, -24.7, 13.0], // 59
  [111.2, -20, 13.0], // 60: water crossing ends
  [92.5, -11.7, 13.0], // 61
  [79.2, -3.5, 13.0], // 62
  [66, 4.8, 13.0], // 63
  [52.7, 13, 13.0], // 64: OVERPASS: the viaduct crosses 13 m above the ground road (point 23)
  [35.7, 23.5, 12.9], // 65
  [24.1, 29.4, 12.7], // 66
  [6.3, 33.9, 12.4], // 67
  [-12, 33.5, 12.0], // 68
  [-29.5, 28.2, 11.5], // 69
  [-45, 18.4, 11.0], // 70: descent begins: west sweeper
  [-59.3, 10, 10.3], // 71
  [-75.6, 6.7, 9.6], // 72
  [-92.1, 9, 8.9], // 73
  [-113.6, 10.8, 8.1], // 74
  [-133.8, 3.5, 7.3], // 75: west chicane, first half
  [-153.5, -3.3, 6.5], // 76
  [-174, -0.5, 5.7], // 77
  [-191.2, 11.1, 4.9], // 78
  [-201.9, 19.7, 4.1], // 79
  [-214.6, 24.7, 3.4], // 80: west chicane, second half; the dirt shortcut leaves here
  [-235.2, 27.5, 2.7], // 81
  [-256, 26.6, 2.0], // 82
  [-276.4, 22.2, 1.5], // 83
  [-295.7, 14.3, 1.0], // 84
  [-313.3, 3.2, 0.6], // 85
  [-328.7, -10.7, 0.3], // 86
  [-341.5, -27.2, 0.1], // 87
  [-347.4, -42.2, 0.0], // 88
  [-346.8, -58.4, 0.0], // 89
  [-339.8, -73.1, 0.0], // 90: west end hairpin
  [-327.4, -85.7, 0.0], // 91
  [-312, -94.7, 0.0], // 92
  [-301.1, -101.2, 0.0], // 93
  [-292.5, -110.6, 0.0], // 94
  [-276.4, -124.8, 0.0], // 95
  [-255.5, -130, 0.0], // 96: the dirt shortcut rejoins here, just before the start line
  [-240.2, -130, 0.0], // 97
];

export const docksideLoop: TrackDef = {
  name: 'Dockside Loop',
  blurb: 'Harbour figure-8: pass under, then over, the overpass; quay jumps and a dirt shortcut behind the warehouses.',
  points,
  width: 15,
  offroadWidth: 9,
  bankPerCurvature: 5,
  maxBankDeg: 8,
  walls: [
    { from: 5.9, to: 7.6, side: 'both' }, // fence the flooded quay gap so nobody drives around it
    { from: 36, to: 74, side: 'both' }, // viaduct parapets (they stand at the deck edge)
  ],
  ramps: [
    // Quay: a chain of four small humps (the old planks), then a kicker over a flooded gap.
    { at: 0.9, length: 14, height: 1.2, shape: 'hump' },
    { at: 1.85, length: 14, height: 1.2, shape: 'hump' },
    { at: 2.8, length: 14, height: 1.2, shape: 'hump' },
    { at: 3.75, length: 14, height: 1.2, shape: 'hump' },
    { at: 5.9, length: 10, height: 2.2, gap: 11, gapKind: 'water', shape: 'kicker' },
  ],
  boostPads: [
    { at: 5.0, offset: 0, length: 8, width: 5 }, // just before the quay gap
    { at: 56.3, offset: 0, length: 8, width: 5 }, // just before the water crossing
    { at: 90, offset: 0.45, length: 7, width: 4 }, // west end hairpin apex
  ],
  hazards: [
    // The DRAWBRIDGE over the 50 m water crossing (points 57 to 60, straight and level). The leaves are down
    // for ~14 s of every 24 s; then bell and lights (2 s), up (8 s with the rising and lowering). The boost
    // pad at 56.3 gives a kart the speed to jump the 12 m opening: see sim/hazards/drawbridge.ts.
    { kind: 'drawbridge', from: 57, to: 60, period: 24, phase: 9 },
  ],
  laps: 3,
  checkpoints: 16,
  scenery: { seed: 22, trees: 60, buildings: 0, blocks },
  // Evening harbour: slate concrete, sandy verge, orange-pink sky.
  theme: { grass: '#5f6d7a', offroad: '#8d8270', sky: '#e9895d', horizon: '#ffd2a0', mood: 'evening' },
  terrain: { seed: 7, blend: 14 },
  bridges: [{ from: 36, to: 74 }],
  shortcuts: [
    {
      // Dirt U-turn through the inside of the west lobe, behind the warehouses. It is only a dirt path: it starts
      // beside the kerb of the west chicane, cuts across the inside of the lobe, then hugs the inside of the
      // hairpin and merges back into the road's edge at a shallow angle (see sim/shortcuts.ts).
      from: 80,
      to: 96,
      points: [
        [-252, 12],
        [-274, -20],
        [-286, -48],
        [-294, -72],
        [-288, -88],
        [-279, -101],
      ],
      width: 11,
    },
  ],
};
