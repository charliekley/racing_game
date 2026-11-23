/**
 * Track: "Mushroom Valley" – a mountain road over deep, cloudy gorges (about 1.9 km).
 *
 * Giant mushrooms rise out of the gorges. ORANGE caps are trampolines: touch one and you are thrown along a big
 * arc onto the next cap or the far road (see src/sim/bouncers.ts for the rules). GREEN caps are solid: drive across
 * them like a bridge. Fall into a gorge and the carrier drone fetches you, like any other drop.
 *
 * Layout (north = +z, east = +x). The start line is in a high meadow, heading east. The lap runs anticlockwise:
 *
 *   1. MEADOW      (y 30)     S-bends along the south edge.
 *   2. ZIG-ZAG     (30 -> 51) three hairpins climbing the east slope, with a boost-pad warm-up.
 *   3. GORGE ONE   (y 57)     a mountain road along a cliff, then a gap with NOTHING but a chain of three ORANGE
 *                             caps: the only way across is to bounce (a trick in the air pays out a boost).
 *   4. GORGE TWO   (y 57)     a ridge road, then a gap crossed on a snaking path of GREEN caps.
 *   5. THE CAVE    (y 50)     a hairpin into a huge glowing cave. The chasm inside is full of giant mushrooms and
 *                             has TWO ROUTES: the main road crosses on a path of green caps, while a rough dirt
 *                             SHORTCUT branches off to the right and hops from orange cap to orange cap.
 *                             About the same time, different risk (see docs/TRACKS.md).
 *   6. DESCENT     (47 -> 30) a flowing run down through the pines back to the meadow.
 *
 * Every control point is [x, z, height] in metres. Named points are what the features refer to, with
 * `at('name')` (control-point units, so `at('x') + 0.5` is halfway to the next point). Bends are circle arcs
 * (`arc()`), so their radius is exact. Caps are placed on the road with `at` + `ds` (metres further along the road)
 * + `offset` (metres to the right), so they follow the road wherever it bends.
 */
import type { CapDef, TrackDef } from '../types';

/** A control point, optionally named so features can refer to it. */
interface RoutePoint {
  name?: string;
  p: [number, number, number];
}

const pt = (x: number, z: number, h: number, name?: string): RoutePoint => ({ name, p: [x, z, h] });

/**
 * Points on a circle arc round (cx, cz) with radius r, from compass bearing `a0` to `a1` (degrees; 0 = north of the
 * centre, 90 = east), every `step` degrees, the height going linearly from y0 to y1. a1 > a0 runs clockwise seen
 * from above (a right-hand turn), a1 < a0 anticlockwise (left). Both ends are included.
 */
function arc(cx: number, cz: number, r: number, a0: number, a1: number, y0: number, y1: number, step: number, names: Record<number, string> = {}): RoutePoint[] {
  const n = Math.max(1, Math.round(Math.abs(a1 - a0) / step));
  const out: RoutePoint[] = [];
  for (let k = 0; k <= n; k++) {
    const a = ((a0 + ((a1 - a0) * k) / n) * Math.PI) / 180;
    out.push(pt(cx + r * Math.sin(a), cz + r * Math.cos(a), y0 + ((y1 - y0) * k) / n, names[k]));
  }
  return out;
}

const route: RoutePoint[] = [
  // ---- 1. Meadow: S-bends heading east ----
  pt(0, 0, 30, 'start'),
  pt(40, 2, 30),
  pt(84, 18, 30.4),
  pt(128, 16, 30.9),
  pt(170, -6, 31.6),
  pt(214, -16, 32.4),
  pt(240, -4, 33.2),
  // ---- 2. Zig-zag up the east slope: two wide hairpins (U1 left, U2 right) and a left corner north ----
  ...arc(280, 40, 40, 180, 0, 33.6, 38, 20, { 0: 'hair1' }),
  pt(250, 88, 38.8),
  pt(214, 76, 39.6),
  pt(188, 84, 40.4),
  ...arc(160, 120, 40, 180, 360, 41, 45, 20, { 0: 'hair2' }),
  pt(196, 168, 45.8),
  pt(232, 156, 46.6),
  pt(262, 164, 47.4),
  // a left-hand corner turns north up the east edge
  ...arc(290, 200, 40, 180, 90, 48, 52, 20, { 0: 'turnNorth' }),
  // ---- 3. Gorge one: a cliff road north, then the chain of orange caps ----
  pt(332, 236, 53, 'cliffRoad'),
  pt(328, 268, 54.4, 'g1a'), // the road ends here: 80 m of chasm
  pt(334, 310, 55),
  pt(328, 348, 55.4, 'g1b'), // the road starts again
  // ---- 4. Gorge two: a left-hand corner onto the north edge, then the green stepping path ----
  ...arc(290, 368, 40, 90, 0, 55.6, 56.4, 20, { 0: 'turnWest' }),
  pt(258, 412, 56.6),
  pt(228, 404, 56.8, 'g2a'),
  pt(202, 410, 56.9),
  pt(176, 402, 56.8, 'g2b'),
  pt(146, 406, 56.6),
  pt(120, 400, 56.5),
  // ---- 5. The cave: a hairpin south, the chasm with its two routes ----
  ...arc(96, 374, 28, 0, -90, 56.4, 55, 30),
  pt(72, 346, 54.4, 'caveFork'),
  pt(68, 312, 53, 'caveIn'),
  pt(72, 276, 52.4),
  pt(63, 240, 51.8),
  pt(71, 204, 51.2),
  pt(68, 170, 50.6, 'caveOut'),
  pt(67, 144, 50),
  // ---- 6. Descent: through the pines back to the meadow ----
  pt(58, 116, 47.5),
  pt(24, 100, 44),
  pt(-16, 100, 40.5),
  pt(-54, 80, 37.5),
  pt(-70, 44, 34.5),
  pt(-56, 8, 32),
  pt(-30, -8, 30.8),
];

const points = route.map((r) => r.p);

/** Position of a named point, in control-point units (what every feature below wants). */
export function at(name: string): number {
  const i = route.findIndex((r) => r.name === name);
  if (i < 0) throw new Error(`mushroomValley: no point named "${name}"`);
  return i;
}

// ---------------------------------------------------------------------------
// Mushroom caps
// ---------------------------------------------------------------------------

/** Chasm lengths (m): from the named point where the road ends to where it starts again. */
const G1 = 80;
const G2 = 54;
const CAVE = 126;

const caps: CapDef[] = [];
/** Add a cap and return its index (so an earlier cap can aim at a later one). */
const add = (c: CapDef): number => caps.push(c) - 1;

// GORGE ONE: three orange caps. Each throws you to the next, the last one to the road beyond the gap.
{
  const r = 8;
  const a = caps.length;
  add({ kind: 'orange', radius: r, at: at('g1a'), ds: 6, dy: -0.4, to: a + 1 });
  add({ kind: 'orange', radius: r, at: at('g1a'), ds: 38, dy: -0.4, offset: 2, to: a + 2 });
  add({ kind: 'orange', radius: r, at: at('g1a'), ds: 68, dy: -0.4, to: { at: at('g1a'), ds: G1 + 10 } });
}
// GORGE TWO: a snaking path of green caps (they overlap, so it is one continuous bridge).
for (let k = 0; k < 5; k++) {
  const off = [0, 4, -3, 3, 0][k];
  add({ kind: 'green', radius: 9, at: at('g2a'), ds: 4 + k * 12, offset: off, dy: -0.3 });
}
// THE CAVE, main route: green caps all the way (a bit wider apart in the middle).
for (let k = 0; k < 9; k++) {
  const off = [0, 3, 0, -3, 0, 3, 0, -3, 0][k];
  add({ kind: 'green', radius: 10, at: at('caveIn'), ds: 5 + k * 14, offset: off, dy: -0.3 });
}
// THE CAVE, second route (the dirt shortcut): orange caps on the branch's own line, in world coordinates.
export const ORANGE_ROUTE: { x: number; z: number; y: number }[] = [
  { x: 46, z: 314, y: 52.2 },
  { x: 34, z: 272, y: 51.8 },
  { x: 36, z: 230, y: 51.3 },
  { x: 34, z: 190, y: 50.8 },
];
{
  const first = caps.length;
  ORANGE_ROUTE.forEach((c, k) => {
    add({ kind: 'orange', radius: 7.5, x: c.x, z: c.z, y: c.y, to: k < ORANGE_ROUTE.length - 1 ? first + k + 1 : { x: 48, z: 158 } });
  });
}

export const mushroomValley: TrackDef = {
  name: 'Mushroom Valley',
  blurb: 'A mountain road over misty gorges: bounce across orange mushroom trampolines, cross on green caps, and pick a route through the glowing cave.',
  points,
  width: 14,
  offroadWidth: 6,
  bankPerCurvature: 4,
  maxBankDeg: 8,
  walls: [
    // Guard rails on the cliff roads and the hairpin legs that face the next leg.
    { from: at('cliffRoad') - 0.3, to: at('g1a'), side: 'both' },
    { from: at('g1b'), to: at('turnWest') + 0.5, side: 'both' },
    { from: at('g2b'), to: at('caveFork') + 1, side: 'both' },
    { from: at('caveOut') + 0.2, to: at('caveOut') + 1.5, side: 'both' },
  ],
  ramps: [],
  boostPads: [
    { at: at('cliffRoad') - 0.5, offset: 0, length: 8, width: 5 }, // speed into gorge one
    { at: at('g2a') - 0.9, offset: 0, length: 8, width: 5 }, // ...and into the green bridge
    { at: at('caveOut') + 0.9, offset: 0, length: 8, width: 5 }, // out of the cave
  ],
  laps: 3,
  checkpoints: 18,
  scenery: {
    seed: 61,
    trees: 150,
    buildings: 0,
    mushroom: {
      gorges: [
        { from: at('g1a'), to: at('g1b') },
        { from: at('g2a'), to: at('g2b') },
      ],
      cave: { from: at('caveIn'), to: at('caveOut'), halfWidth: 62, roof: 46 },
      glow: 110,
    },
  },
  theme: { grass: '#5f8a3e', offroad: '#9a8a5c', sky: '#8fb8e8', horizon: '#dcebf5', mood: 'bright' },
  terrain: {
    seed: 17,
    hills: { amplitude: 5, wavelength: 110 },
    features: [
      // The mountain: a big bump the roads climb, so the land stays near road level all round.
      { x: 150, z: 160, radius: 380, height: 52 },
      // The cave's pit: three overlapping holes (the main road and the shortcut cross over them).
      { x: 52, z: 269, radius: 44, height: -50 },
      { x: 52, z: 232, radius: 44, height: -50 },
      { x: 52, z: 209, radius: 38, height: -50 },
    ],
    blend: 18,
  },
  // THE ORANGE ROUTE: a dirt path that leaves the road at the cave's mouth, runs beside the chasm and rejoins it
  // after the exit. Its middle is held at the cave's height (third number), far above the pit, and the orange caps
  // are the only ground there (so you bounce from cap to cap).
  shortcuts: [
    {
      from: at('caveFork'),
      to: at('caveOut') + 0.7,
      points: [
        [ORANGE_ROUTE[0].x, ORANGE_ROUTE[0].z, ORANGE_ROUTE[0].y],
        [ORANGE_ROUTE[1].x, ORANGE_ROUTE[1].z, ORANGE_ROUTE[1].y],
        [ORANGE_ROUTE[2].x, ORANGE_ROUTE[2].z, ORANGE_ROUTE[2].y],
        [ORANGE_ROUTE[3].x, ORANGE_ROUTE[3].z, ORANGE_ROUTE[3].y],
        [48, 158],
      ],
      width: 10,
      hold: true,
    },
  ],
  caps,
  chasms: [
    { at: at('g1a'), length: G1 },
    { at: at('g2a'), length: G2 },
    { at: at('caveIn'), length: CAVE },
  ],
  cliffs: [
    { from: at('cliffRoad'), to: at('g1a'), side: 'both', edge: 14 },
    { from: at('g1b'), to: at('turnWest'), side: 'both', edge: 14 },
    { from: at('g2b'), to: at('caveFork'), side: 'right', edge: 14 },
  ],
};
