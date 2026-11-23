/**
 * Track: "Autumn Speedway" – a treetop course through a forest of giant autumn trees (about 1.9 km).
 *
 * The road leaves a mossy clearing on the forest floor, climbs a huge root onto wooden branch roads,
 * crosses a sagging rope bridge, spirals up round the biggest trunk of the forest, jumps a gap between
 * two crowns and then PLUNGES back down to the floor on one long, steep branch.
 *
 * Layout (north = +z, east = +x). The start line is in the clearing, heading east:
 *
 *   1. MOSSY HOLLOW (floor, ~3 m): S-bends through the clearing.
 *   2. ROOT RAMP: an S-shaped climb up a giant root onto the first branch (5 m -> 28 m, ~15 %).
 *   3. BRANCH ROAD: a winding plank road, the ROPE BRIDGE (it sags in the middle and has springy
 *      rope humps you can trick off), a tight HAIRPIN round the Lantern Oak and an S-bend west.
 *   4. THE SPIRAL: one and a quarter turns clockwise round the Great Trunk, climbing 64 m at about
 *      21 % (the steepest sustained climb in the game).
 *   5. CROWN JUMP: a level deck at the top (92 m), a boost pad and a kicker over the gap to the
 *      neighbouring crown.
 *   6. THE PLUNGE: a crest, then one long branch dropping about 76 m at up to ~33 % back to the floor.
 *   7. ACORN HOLLOW (floor): S-bends back to the line.
 *
 * Every control point is [x, z, height] in metres. Important points get a NAME in `route` and the
 * features below refer to them with `at('name')` (control-point units, so `at('x') + 0.5` is halfway to
 * the next point). The spiral and the hairpin are built from circle arcs (`arc`), so they are exact.
 *
 * Elevated roads are `bridges` (the ground under them stays the natural forest floor; fall off and the
 * carrier drone brings you back). Walls along most of the high road are the wooden guard rails.
 */
import type { TrackDef } from '../types';

/** A control point, optionally named so features can refer to it. */
interface RoutePoint {
  name?: string;
  p: [number, number, number];
}

const pt = (x: number, z: number, h: number, name?: string): RoutePoint => ({ name, p: [x, z, h] });

/**
 * Points on a circle arc round (cx, cz) with radius r, from compass bearing `a0` to `a1` (degrees; 0 = north
 * of the centre, 90 = east), every `step` degrees, the height going linearly from y0 to y1. a1 > a0 runs
 * clockwise seen from above (a right-hand turn), a1 < a0 anticlockwise (left). Both ends are included.
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

/** The Great Trunk: the spiral climbs round it. Centre, spiral radius and the heights at the bottom and top. */
export const GREAT_TRUNK = { x: 180, z: 330, spiralRadius: 38, bottom: 28, top: 92 };
/** The Lantern Oak: the hairpin wraps round it. */
export const LANTERN_OAK = { x: 385, z: 290, hairpinRadius: 28 };

const G = GREAT_TRUNK;

/**
 * The root ridge under the shortcut: mounds every ~5 m along the line from the hollow's north end to its south
 * end, [x, z, height]. Lower at both ends so the path climbs onto the root and back down gently.
 */
const ROOT_RIDGE: [number, number, number][] = [];
for (let k = 0; k <= 18; k++) {
  const f = k / 18;
  const x = -93 + (-77 - -93) * f;
  const z = 120 + (40 - 120) * f;
  ROOT_RIDGE.push([x, z, 1 + 6 * Math.pow(Math.sin(Math.PI * f), 0.6)]);
}
const L = LANTERN_OAK;

const route: RoutePoint[] = [
  // ---- 1. Mossy Hollow: the clearing on the forest floor, heading east ----
  pt(0, 0, 3, 'start'),
  pt(30, 0, 3),
  pt(62, 4, 3.2),
  pt(95, 16, 3.6, 'hollowS'),
  pt(128, 18, 4),
  pt(158, 6, 4.2),
  pt(188, -6, 4.4),
  pt(220, -4, 4.6),
  pt(246, 10, 5, 'rootRamp'),
  // ---- 2. Root Ramp: an S-shaped climb north up a giant root onto the first branch ----
  pt(262, 36, 8),
  pt(264, 66, 12.5),
  pt(252, 94, 17),
  pt(244, 124, 21.5),
  pt(252, 152, 25.5),
  pt(268, 176, 28, 'branchRoad'),
  // ---- 3. Branch road, rope bridge (sagging), hairpin round the Lantern Oak ----
  pt(290, 198, 28.5),
  pt(316, 214, 29, 'ropeBridge'),
  pt(346, 232, 27.5),
  pt(374, 250, 28.5),
  pt(400, 266, 30, 'ropeEnd'),
  ...arc(L.x, L.z, L.hairpinRadius, 148, -5, 30, 31, 30, { 0: 'hairpin' }).slice(1),
  pt(350, 316, 31, 'hollowBranch'),
  pt(318, 300, 30.5),
  pt(286, 296, 30),
  pt(254, 304, 29.5),
  pt(220, 296, 28.5),
  // ---- 4. The spiral: 1.25 turns clockwise round the Great Trunk, from its south side (heading west) ----
  ...arc(G.x, G.z, G.spiralRadius, 180, 630, G.bottom, G.top, 22.5, { 0: 'spiral', 20: 'spiralTop' }),
  // ---- 5. Crown deck and the jump to the neighbouring crown ----
  pt(140, 352, 92.5, 'crownDeck'),
  pt(132, 374, 92.6, 'kicker'),
  pt(120, 400, 91, 'landing'),
  pt(100, 420, 89.5),
  pt(70, 428, 88),
  pt(40, 422, 86, 'plungeTop'),
  // ---- 6. The Plunge: down to the floor on one long branch ----
  pt(14, 404, 84),
  pt(-8, 380, 76),
  pt(-24, 352, 66),
  pt(-34, 322, 56),
  pt(-38, 292, 46),
  pt(-36, 262, 36),
  pt(-40, 232, 27),
  pt(-50, 204, 19),
  pt(-64, 178, 13),
  pt(-80, 154, 9.5, 'plungeEnd'),
  // ---- 7. Acorn Hollow: S-bends on the floor back to the line ----
  pt(-112, 134, 8),
  pt(-142, 106, 7, 'acornHollow'),
  pt(-150, 70, 6),
  pt(-130, 34, 5),
  pt(-92, 12, 4),
  pt(-50, 2, 3.3, 'home'),
  pt(-20, 0, 3),
];

const points = route.map((r) => r.p);

/** Position of a named point, in control-point units (what every feature below wants). */
export function at(name: string): number {
  const i = route.findIndex((r) => r.name === name);
  if (i < 0) throw new Error(`autumnSpeedway: no point named "${name}"`);
  return i;
}

export const autumnSpeedway: TrackDef = {
  name: 'Autumn Speedway',
  blurb: 'Branch roads and rope bridges through giant autumn trees: spiral up the Great Trunk, leap between crowns and plunge back to the forest floor.',
  points,
  width: 13,
  offroadWidth: 7,
  bankPerCurvature: 4,
  maxBankDeg: 8,
  walls: [
    // Wooden guard rails along the high road (a wall on a bridge stands at the deck edge).
    { from: at('rootRamp') + 0.6, to: at('ropeBridge'), side: 'both' },
    { from: at('ropeEnd'), to: at('crownDeck') + 0.8, side: 'both' },
    { from: at('landing') + 0.3, to: at('plungeEnd') - 0.5, side: 'both' },
  ],
  ramps: [
    // Springy rope humps on the rope bridge: hit them fast and you can trick off each one.
    { at: at('ropeBridge') + 0.6, length: 10, height: 0.7, shape: 'hump' },
    { at: at('ropeBridge') + 1.3, length: 10, height: 0.7, shape: 'hump' },
    { at: at('ropeBridge') + 2.0, length: 10, height: 0.7, shape: 'hump' },
    // THE CROWN JUMP: a kicker over a 12 m gap to the next crown.
    { at: at('kicker') - 0.2, length: 10, height: 2.2, gap: 12, gapKind: 'void', shape: 'kicker' },
    // A crest at the top of the plunge (big air when you are fast).
    { at: at('plungeTop') + 0.3, length: 14, height: 1.0, shape: 'hump' },
  ],
  boostPads: [
    { at: at('crownDeck') + 0.1, offset: 0, length: 8, width: 5 }, // speed for the crown jump
  ],
  laps: 3,
  checkpoints: 18,
  scenery: {
    seed: 23,
    trees: 220,
    buildings: 0,
    treetop: {
      // 40 more giant trees scattered by the scenery planner, clear of the roads: the forest itself.
      forest: { count: 40, seed: 5 },
      // Leaf piles on the floor roads: heaps on the verges and a few smaller ones on the road edge to drive through.
      leafPiles: [
        { at: 1.2, offset: 1.5 },
        { at: 2.4, offset: -1.4, size: 1.6 },
        { at: 3.1, offset: 0.75, size: 1.3 },
        { at: 4.6, offset: -1.6 },
        { at: 5.5, offset: 1.4, size: 2.6 },
        { at: 6.6, offset: -0.8, size: 1.3 },
        { at: 7.4, offset: 1.6 },
        { at: at('plungeEnd') + 1.4, offset: -1.5 },
        { at: at('acornHollow') + 0.6, offset: 1.4, size: 2.8 },
        { at: at('acornHollow') + 1.3, offset: -0.75, size: 1.3 },
        { at: at('acornHollow') + 2.8, offset: 1.5 },
        { at: at('home') + 0.4, offset: -1.6, size: 2.4 },
      ],
      // Giant trees. The road winds between them, so each trunk stands just beyond the guard rail of the road
      // passing it (autumnSpeedway.test.ts checks the clearance). Heights are to the middle of the crown.
      giantTrees: [
        { x: G.x, z: G.z, radius: 21, height: 150, crown: 62 }, // the Great Trunk (the spiral)
        { x: L.x, z: L.z, radius: 11, height: 84, lanterns: 36 }, // the Lantern Oak (the hairpin), lanterns above the road
        { x: 90, z: 388, radius: 11, height: 120, crown: 46 }, // the landing crown of the jump
        { x: 286, z: 86, radius: 9, height: 70 }, // beside the root ramp
        { x: 312, z: 178, radius: 10, height: 76 }, // where the branch road leaves the root
        { x: 302, z: 246, radius: 9, height: 70 }, // the rope bridge's west anchor
        { x: 300, z: 326, radius: 10, height: 74 }, // above the hollow branch
        { x: -4, z: 330, radius: 11, height: 110 }, // beside the top of the plunge
        { x: -18, z: 206, radius: 9, height: 80 }, // halfway down the plunge
        { x: -68, z: 262, radius: 11, height: 90 }, // west of the plunge
        { x: 100, z: 180, radius: 16, height: 130, crown: 52 }, // the giant in the middle of the course
        { x: 30, z: 120, radius: 9, height: 75 },
        { x: 180, z: 120, radius: 10, height: 85 },
        { x: 150, z: 40, radius: 8, height: 60 }, // the clearing
        { x: 60, z: -32, radius: 9, height: 70 },
        { x: 200, z: -50, radius: 9, height: 66 },
        { x: -22, z: 78, radius: 9, height: 70 }, // Acorn Hollow, east of the root shortcut
        { x: -190, z: 40, radius: 12, height: 95 },
        { x: 380, z: 150, radius: 12, height: 90 },
        { x: 210, z: 450, radius: 13, height: 120 },
        { x: -60, z: 420, radius: 12, height: 100 },
      ],
    },
  },
  // Rust-brown forest floor, golden leaf litter on the verge, warm hazy golden sky (the 'autumn' light).
  theme: { grass: '#7a5530', offroad: '#b9803c', sky: '#f0b070', horizon: '#ffd79a', mood: 'autumn' },
  terrain: {
    seed: 31,
    hills: { amplitude: 2.5, wavelength: 90 },
    // THE ROOT RIDGE: a giant root arching across Acorn Hollow, a narrow ridge about 7 m above the hollow,
    // which the shortcut runs along (a chain of small steep mounds), with the hollow dug out either side.
    features: [
      ...ROOT_RIDGE.map(([x, z, h]) => ({ x, z, radius: 7, height: h })),
      { x: -108, z: 80, radius: 20, height: -3 }, // the hollow west of the root
      { x: -60, z: 76, radius: 20, height: -3 }, // ...and east of it
    ],
    blend: 18,
  },
  // THE ROOT RIDGE SHORTCUT: a narrow dirt path along the top of the giant root across Acorn Hollow. Much shorter
  // than the road's swing west, but only 6 m wide with a drop either side: fall off and the drone fetches you.
  shortcuts: [
    {
      from: at('plungeEnd') + 0.3,
      to: at('home') - 0.5,
      points: [
        [-92, 114],
        [-86, 90],
        [-81, 66],
        [-77, 44],
      ],
      width: 6,
    },
  ],
  // ACORN BEETLES: big beetles marching back and forth across the floor roads (one crossing every 4.5 s).
  // Bump one and you bounce off its shell (no spin-out). Staggered so the three never move in step.
  hazards: [
    { kind: 'beetle', at: at('hollowS') + 2.5, period: 9, phase: 0 },
    { kind: 'beetle', at: at('acornHollow'), period: 9, phase: 3 },
    { kind: 'beetle', at: at('acornHollow') + 2.2, period: 9, phase: 6 },
  ],
  // Everything above the floor is a branch road on a bridge (the forest floor stays natural underneath).
  bridges: [
    { from: at('rootRamp') + 0.8, to: at('ropeBridge') - 0.2 },
    { from: at('ropeBridge') - 0.2, to: at('ropeEnd') + 0.2, look: 'rope' }, // the rope bridge (no rails: fall off and the drone fetches you)
    { from: at('ropeEnd') + 0.2, to: at('plungeEnd') - 0.8 },
  ],
};
