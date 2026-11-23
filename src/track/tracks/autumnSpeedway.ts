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
  pt(-102, 128, 8),
  pt(-116, 96, 7, 'acornHollow'),
  pt(-112, 64, 6),
  pt(-98, 36, 5),
  pt(-78, 14, 4),
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
  scenery: { seed: 23, trees: 300, buildings: 0 },
  // Rust-brown forest floor, golden leaf litter on the verge, warm hazy sky.
  theme: { grass: '#6b4a2a', offroad: '#b07a3a', sky: '#f2b878', horizon: '#ffd9a0', mood: 'dusk' },
  terrain: {
    seed: 31,
    hills: { amplitude: 2.5, wavelength: 90 },
    blend: 18,
  },
  bridges: [
    { from: at('rootRamp') + 0.8, to: at('plungeEnd') - 0.8 },
  ],
};
