/**
 * Track: "Dockside Loop" – an evening harbour figure-8 (about 1.7 km).
 *
 * Layout (north = +z, east = +x; the start line is on the south quay, heading east):
 *
 *   START quay ─ four planks-humps, boost pad, then a kicker over a flooded gap in the quay
 *      → ground crossing at the middle (you pass UNDER the overpass)
 *      → climb up the east lobe onto an elevated viaduct through the container yard
 *      → a drawbridge jump (kicker over a gap) on the high road
 *      → the viaduct crosses OVER the ground road at the middle (deck ~8.5 m up)
 *      → long descent through the west lobe, then a wide U-turn round the warehouses.
 *
 *   SHORTCUT (dirt): cuts the inside of that west U-turn, hidden behind the warehouses.
 *
 * Features used: figure-8 with bridge overpass (>= 7 m separation), solid container
 * stacks and warehouses (scenery.blocks), water gap, hump chain, void-free drawbridge
 * gap, dirt shortcut, boost pads, banked walls.
 *
 * Control point numbers (the numbers in `at`/`from`/`to` refer to these):
 *   0 start line … 3 → origin (ground crossing) … 6-9 viaduct east side …
 *   12-13 overpass over the origin … 14-16 descent … 17 west end … 18 back to the quay.
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
  // Warehouses between the west U-turn and the dirt shortcut (the shortcut runs behind them).
  warehouse(-276, 48, 14, 38, '#b7573d'),
  warehouse(-276, -20, 14, 30, '#6d8aa8'),
  // Container rows on the north side of the quay.
  stack(-195, -97, 3, '#c0392b', R),
  stack(-181, -97, 2, '#2e86c1', R),
  stack(-167, -97, 3, '#d4a017', R),
  stack(-153, -97, 2, '#27ae60', R),
  stack(-120, -92, 3, '#8e44ad', R),
  // Backdrop on the harbour side of the quay.
  stack(-200, -156, 3, '#e67e22', R),
  stack(-186, -156, 3, '#2e86c1', R),
  stack(-172, -156, 2, '#c0392b', R),
  stack(-120, -158, 3, '#27ae60', R),
  // Container yard inside the east lobe, 8 m below the viaduct.
  stack(150, 30, 3, '#c0392b', 0),
  stack(166, 30, 3, '#d4a017', 0),
  stack(182, 30, 2, '#2e86c1', 0),
  stack(150, -5, 2, '#27ae60', 0),
  stack(166, -5, 3, '#e67e22', 0),
  stack(182, -5, 3, '#8e44ad', 0),
  stack(205, 5, 2, '#c0392b', R),
  // A warehouse on the north side of the east lobe, below the road.
  warehouse(150, 180, 30, 16, '#8a8f98', R),
];

export const docksideLoop: TrackDef = {
  name: 'Dockside Loop',
  blurb: 'Harbour figure-8: pass under, then over, the overpass; quay jumps and a dirt shortcut behind the warehouses.',
  points: [
    [-225, -130, 0], // 0: start/finish on the south quay, heading east
    [-130, -125, 0], // 1
    [-60, -110, 0], // 2: quay ends, swing north-east
    [-45, -45, 0], // 3
    [45, 45, 0.3], // 4: (the road passes the origin at ground level between 3 and 4)
    [120, 100, 3.5], // 5: climbing
    [205, 125, 7], // 6: viaduct starts
    [270, 85, 8.5], // 7
    [290, -5, 8.5], // 8
    [250, -95, 8.5], // 9
    [170, -115, 8.5], // 10: drawbridge jump just before here
    [95, -80, 8.5], // 11
    [45, -45, 8.5], // 12
    [-45, 45, 8], // 13: (deck passes OVER the origin between 12 and 13)
    [-120, 100, 5], // 14: descending
    [-200, 125, 2], // 15
    [-300, 90, 0], // 16
    [-335, -5, 0], // 17: west end
    [-300, -100, 0], // 18
  ],
  width: 15,
  offroadWidth: 9,
  bankPerCurvature: 5,
  maxBankDeg: 8,
  walls: [
    { from: 1.0, to: 1.95, side: 'both' }, // fence the flooded quay gap so nobody drives around it
    { from: 6.3, to: 14.0, side: 'both' }, // viaduct parapets
    { from: 16.2, to: 18.0, side: 'outer' }, // around the west end
  ],
  ramps: [
    // Quay: a chain of four small humps (the old planks), then a kicker over a flooded gap.
    { at: 0.35, length: 14, height: 1.2, shape: 'hump' },
    { at: 0.55, length: 14, height: 1.2, shape: 'hump' },
    { at: 0.75, length: 14, height: 1.2, shape: 'hump' },
    { at: 0.95, length: 14, height: 1.2, shape: 'hump' },
    { at: 1.3, length: 10, height: 2.2, gap: 11, gapKind: 'water', shape: 'kicker' },
    // Drawbridge on the viaduct.
    { at: 9.35, length: 10, height: 2.0, gap: 10, gapKind: 'water', shape: 'kicker' },
  ],
  boostPads: [
    { at: 1.1, offset: 0, length: 8, width: 5 }, // just before the quay gap
    { at: 9.1, offset: 0, length: 8, width: 5 }, // just before the drawbridge
    { at: 16.9, offset: 0.45, length: 7, width: 4 }, // west end apex
  ],
  laps: 3,
  checkpoints: 16,
  scenery: { seed: 22, trees: 60, buildings: 0, blocks },
  // Evening harbour: slate concrete, sandy verge, orange-pink sky.
  theme: { grass: '#5f6d7a', offroad: '#8d8270', sky: '#e9895d', horizon: '#ffd2a0', mood: 'evening' },
  terrain: { seed: 7, blend: 14 },
  bridges: [{ from: 5.6, to: 14.3 }],
  shortcuts: [
    {
      // Dirt road through the middle of the west U-turn, behind the warehouses.
      from: 15.4,
      to: 18.3,
      points: [
        [-245, 72],
        [-225, 10],
        [-240, -62],
      ],
      surface: 'dirt',
      width: 11,
    },
  ],
};
