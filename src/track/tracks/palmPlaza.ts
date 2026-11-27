/**
 * Track: "Palm Plaza" – an original, bright, modern two-storey shopping mall with palm trees (about 1.5 km).
 *
 * The lap (north = +z, east = +x; careful: +x is on a driver's LEFT when facing +z). The start line is on the entrance
 * plaza at ground level, heading east:
 *
 *   1. PARKING RAMP   (0 -> 13 m)          from the grid, climbing S-bends up the parking deck to the upper floor.
 *   2. SKY PROMENADE  (upper floor, 13 m)  an S along the gallery (glass railings, shops, palms), a bend north.
 *   3. THE BOUTIQUE   (upper floor)        the main road swings LEFT round a big store; the shortcut turns RIGHT
 *                                          straight through it: in at one door, out at the other (`shortcuts[0]`, a deck).
 *   4. THE ESCALATORS (13 m -> 0 m)        the road splits into TWO parallel escalator lanes going down (the main road on
 *                                          the driver's left, `shortcuts[1]` on the right). The belts move: with you = faster,
 *                                          against you = slower, sometimes both stop; a fixed timetable (sim/hazards/
 *                                          escalator.ts). A guide robot between them points at the good lane.
 *   5. GARDEN ATRIUM  (ground floor, 0 m)  boost pads, grass patches (slow), and the FOUNTAIN: its rim is a kicker with a
 *                                          row of item boxes floating over the pool.
 *   6. PARKING LOT    (outside, 0 m)      S-bends through the car park; cars drive across the road from garage gate to
 *                                          garage gate (sim/hazards/car.ts), sometimes over the boost pads. Hit one = flip.
 *   7. HOME           (outside, 0 m)      a sweeping bend and an S back to the entrance plaza and the grid.
 *
 * Written with the turtle (src/track/turtle.ts): every bend is a circle arc of radius >= 28 m (bots never brake hard,
 * which keeps the three weight classes balanced), named points place the features, and the lap is closed exactly by
 * `closeTo` (as on Rainbow Route).
 *
 * Everything here is original: the mall, its made-up stores, signs, posters and the guide robot are invented for this game.
 */
import type { TrackDef } from '../types';
import { Turtle, type RoutePoint } from '../turtle';
import { ESCALATOR_SCHEDULE } from '../../sim/hazards/escalator';

const rad = (deg: number): number => (deg * Math.PI) / 180;
const arcLen = (r: number, deg: number): number => (Math.abs(deg) * Math.PI * r) / 180;

/** Height of the upper floor (m); the ground floor and the parking lot are at 0. */
export const UPPER = 13;
/** Road width (m) everywhere, both escalator lanes included. */
export const MALL_WIDTH = 16;
/** Width of the shortcut aisle through the store (m). */
export const STORE_WIDTH = 10;
/** Length (m) of the moving part of each escalator, and of the split / merge on either side of it. */
export const ESC_LEN = 78;
const ESC_R = 40;
const ESC_DEG = 25;
const ESC_LINE = 14;

const t = new Turtle(0, 0, 0, 90).mark('start');

// ---- 1. Parking ramp: from the grid on the entrance plaza, S-bends up the parking deck to the upper floor ----
t.turn(50, 40, 1.5).mark('ramp1').turn(50, -80, 5).mark('ramp2').turn(50, 80, 5).mark('ramp3').turn(50, -40, 1.5).mark('upperIn');

// ---- 2. Sky Promenade (upper floor): an S along the gallery, then a left bend to head north ----
t.line(6).turn(60, 18).mark('prom').turn(60, -18).mark('promEnd').turn(42, -90).mark('promTurn');

// ---- 3. The Boutique: the main road swings LEFT round the store; the shortcut aisle goes straight through it ----
// (Careful with left and right: +x is on a driver's LEFT when facing +z, so a turtle "right" turn (positive degrees,
// heading towards +x) is a LEFT bend from the driver's seat. Here the main road swings to the driver's left, so the store
// aisle, straight on, is a turn to the RIGHT.)
t.line(8).mark('storeA');
t.turn(40, 45).line(18).mark('bulge1').turn(40, -90).line(18).mark('bulge2').turn(40, 45).mark('storeB');
t.line(14).mark('landing').line(10).mark('escA');

// ---- 4. The escalators: the main lane swings to the driver's left, runs down beside the other lane, and comes back ----
t.turn(ESC_R, ESC_DEG).line(ESC_LINE).turn(ESC_R, -ESC_DEG).mark('escTop');
t.line(ESC_LEN, -UPPER).mark('escBot');
t.turn(ESC_R, -ESC_DEG).line(ESC_LINE).turn(ESC_R, ESC_DEG).mark('escB');

// ---- 5. Garden atrium (ground floor): left into the garden, an S with pads and grass, the fountain, an S out ----
t.line(6).turn(40, -90).line(4).mark('gardenIn');
t.turn(48, 35).mark('g1').turn(48, -70).mark('g2').turn(48, 35).mark('g3');
t.line(14).mark('fountain'); //   the rim's kicker (10 m), the pool, and a straight run-out
t.line(34).mark('fountainOut');
t.turn(48, -30).mark('g4').turn(48, 30).mark('g5').line(4).mark('gardenOut');

// ---- 6. Parking lot (outside): left out through the doors, then S-bends past the car lanes ----
t.turn(40, -90).mark('lotIn');
t.turn(56, 30).mark('lot1').turn(56, -60).mark('lot2').turn(56, 30).mark('lot3');
t.line(6).mark('lotEnd');

/** The pose the turtle stands in. */
const here = () => ({ x: t.x, z: t.z, heading: t.heading });

/**
 * Close the lap: a circle arc, a straight, then a second circle arc that ends on the pose (targetX, targetZ, targetHeading)
 * (copied from Rainbow Route: the shortest of the four left/right combinations).
 */
function closeTo(radius: number, targetX: number, targetZ: number, targetHeading: number): { a1: number; len: number; a2: number } {
  const p = here();
  const centre = (x: number, z: number, heading: number, side: number) => ({ x: x + side * radius * Math.cos(rad(heading)), z: z - side * radius * Math.sin(rad(heading)) });
  const wrapDeg = (d: number, side: number) => {
    const v = (((d * side) % 360) + 360) % 360;
    return (v > 350 ? v - 360 : v) * side;
  };
  let best: { a1: number; len: number; a2: number; total: number } | null = null;
  for (const s1 of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      const c1 = centre(p.x, p.z, p.heading, s1);
      const c2 = centre(targetX, targetZ, targetHeading, s2);
      const dx = c2.x - c1.x;
      const dz = c2.z - c1.z;
      const D = Math.hypot(dx, dz);
      const phi = Math.atan2(dx, dz);
      let theta: number;
      let len: number;
      if (s1 === s2) {
        theta = phi;
        len = D;
      } else {
        if (D < 2 * radius) continue;
        theta = phi + Math.asin((2 * s1 * radius) / D);
        len = Math.sqrt(D * D - 4 * radius * radius);
      }
      const th = (theta * 180) / Math.PI;
      const a1 = wrapDeg(th - p.heading, s1);
      const a2 = wrapDeg(targetHeading - th, s2);
      const total = arcLen(radius, a1) + len + arcLen(radius, a2);
      if (!best || total < best.total) best = { a1, len, a2, total };
    }
  }
  return best!;
}

// ---- back to the grid on the entrance plaza: whatever it takes to arrive heading east on the start line ----
/** The road arrives heading east at x = END_X, then a gentle S and a straight grid to the start line. */
const END_X = -100;
const S_R = 110;
const S_DEG = 14;
const END_Z = 2 * S_R * (1 - Math.cos(rad(S_DEG))); // (the final S shifts the road this far to its right)
const CLOSE_R = 44;
const close = closeTo(CLOSE_R, END_X, END_Z, 90);
{
  if (Math.abs(close.a1) > 0.01) t.turn(CLOSE_R, close.a1).mark('home1');
  if (close.len > 100) {
    // A long run between the two arcs: an S in the middle of it (neutral sideways and in heading), past the lot's exit.
    const R2 = 60;
    const A2 = 22;
    const rest = (close.len - 4 * R2 * Math.sin(rad(A2))) / 2;
    t.line(rest).turn(R2, A2).mark('homeS').turn(R2, -2 * A2).turn(R2, A2).line(rest);
  } else if (close.len > 0.01) t.line(close.len);
  if (Math.abs(close.a2) > 0.01) t.turn(CLOSE_R, close.a2).mark('home2');
  t.turn(S_R, S_DEG).mark('plaza').turn(S_R, -S_DEG).line(-END_X - 2 * S_R * Math.sin(rad(S_DEG))); // gentle S, then the straight grid to the line
}

const route: RoutePoint[] = t.route;
if (Math.hypot(route[route.length - 1].p[0] - route[0].p[0], route[route.length - 1].p[1] - route[0].p[1]) < 1.5) route.pop();
else throw new Error(`palmPlaza: the lap does not close (${route[route.length - 1].p[0].toFixed(1)}, ${route[route.length - 1].p[1].toFixed(1)})`);

/**
 * Smooth the heights (a triangular average over +-SMOOTH_M metres of road): the turtle steps the grade arc by arc, and a
 * sudden grade change at speed is a ramp (the crest-launch rule). The flat floors stay flat, the escalators and the
 * parking ramp get eased ends.
 */
const SMOOTH_M = 24;
{
  const n = route.length;
  const d: number[] = [0];
  for (let k = 1; k <= n; k++) {
    const a = route[k - 1].p;
    const b = route[k % n].p;
    d.push(d[k - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const L = d[n];
  for (let pass = 0; pass < 2; pass++) {
    const y = route.map((r) => r.p[2]);
    route.forEach((r, i) => {
      let sum = 0;
      let wsum = 0;
      for (let j = 0; j < n; j++) {
        let dd = Math.abs(d[j] - d[i]);
        dd = Math.min(dd, L - dd);
        const w = 1 - dd / SMOOTH_M;
        if (w <= 0) continue;
        sum += w * y[j];
        wsum += w;
      }
      r.p[2] = sum / wsum;
    });
  }
}
const points = route.map((r) => r.p);

/** Position of a named point, in control-point units. */
export function at(name: string): number {
  const i = route.findIndex((r) => r.name === name);
  if (i < 0) throw new Error(`palmPlaza: no point named "${name}"`);
  return i;
}

/** Control-point units `ds` metres further along the road from a named point (negative = back). */
export function along(name: string, ds: number): number {
  let i = at(name);
  let remaining = ds;
  const n = route.length;
  const segLen = (k: number) => {
    const a = route[((k % n) + n) % n].p;
    const b = route[(((k + 1) % n) + n) % n].p;
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  };
  if (remaining < 0) {
    while (remaining < 0) {
      i--;
      remaining += segLen(i);
    }
    return i + remaining / segLen(i);
  }
  for (;;) {
    const len = segLen(i);
    if (remaining <= len) return i + remaining / len;
    remaining -= len;
    i++;
  }
}

/** World [x, z] of a control point mirrored across the escalator fork's axis (the line through 'escA', heading north). */
const escAxisX = route[at('escA')].p[0];
const mirror = (p: [number, number, number]): [number, number, number] => [2 * escAxisX - p[0], p[1], p[2]];

/**
 * The second escalator lane (a deck branch): the main lane's route mirrored across the fork's axis (on the driver's right), same heights.
 * The first and last points of the split arcs are left out: the branch builder adds its own straight 16 m lead at each
 * junction (a deck leaves the main centre line at 9 degrees).
 */
const ESC_POINTS = route
  .slice(at('escA') + 1, at('escB'))
  .filter((r) => r.p[1] >= route[at('escTop')].p[1] - 1 && r.p[1] <= route[at('escBot')].p[1] + 1)
  .map((r) => mirror(r.p));

/** The store aisle: straight on from 'storeA' to 'storeB', 2.5 m to the (driver's) right of the line the road had. */
const STORE_POINTS = (() => {
  const a = route[at('storeA')].p;
  const b = route[at('storeB')].p;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  // The driver's right of the direction a -> b: (-tz, tx) (the game's `rightOf`).
  const rx = -(b[1] - a[1]) / len;
  const rz = (b[0] - a[0]) / len;
  const out: [number, number, number][] = [];
  for (const f of [0.25, 0.5, 0.75]) out.push([a[0] + (b[0] - a[0]) * f + rx * 2.5, a[1] + (b[1] - a[1]) * f + rz * 2.5, UPPER]);
  return out;
})();

/** Main-road stretches (control-point units) with walls on both sides, minus holes (e.g. where a fork's arms overlap). */
type Wall = TrackDef['walls'][number];
const wall = (from: number, to: number, side: Wall['side'] = 'both'): Wall => ({ from, to, side });

/** Boost pad `ds` metres past a named point. */
const pad = (name: string, ds: number, offset = 0, length = 8, width = 6) => ({ at: along(name, ds), offset, length, width });

/** Car lanes across the parking lot: [named point, metres past it, direction, period, phase]. */
const CAR_LANES: [string, number, 1 | -1, number, number][] = [
  ['lotIn', 12, 1, 9, 0],
  ['lot1', 8, -1, 8, 2.5],
  ['lot1', 40, 1, 10, 5],
  ['lot2', 20, -1, 9, 1.2],
];

export const palmPlaza: TrackDef = {
  name: 'Palm Plaza',
  blurb: 'A bright two-storey shopping mall: a shortcut through a boutique, racing escalators that change direction, a garden atrium with a fountain jump, and a car park full of moving cars.',
  points,
  width: MALL_WIDTH,
  // No grass verge indoors: the glass railings stand right at the kerb (and a deck lane's floor ends there too).
  offroadWidth: 2,
  // Flat floors (no banking): the deck lanes beside the main road (the store aisle, the second escalator) are flat too, so
  // stepping from one onto the other is seamless.
  bankPerCurvature: 0,
  maxBankDeg: 0,
  walls: [
    // Parking ramp, Sky Promenade and the store's outside lane (open on the right only where the store aisle splits off / joins).
    // (A kart steps from the main road onto a deck lane only once it is off the main road's kerb, so the open side must
    // stay open well past the point where the two roads have pulled apart: 56 m.)
    wall(along('start', 30), along('storeA', -6)),
    wall(along('storeA', -6), along('storeA', 56), 'left'),
    wall(along('storeA', 56), along('storeB', -56)),
    wall(along('storeB', -56), along('storeB', 6), 'left'),
    wall(along('storeB', 6), along('escA', -6)),
    // The escalator fork (the main lane swings to the driver's left): its right side stays open where the two lanes overlap.
    wall(along('escA', -6), along('escA', 52), 'left'),
    wall(along('escA', 52), along('escB', -52)),
    wall(along('escB', -52), along('escB', 6), 'left'),
    // Garden: low planter walls, open round the fountain pool (the pool rim is part of the road).
    wall(along('escB', 6), along('fountain', -6)),
    wall(along('fountainOut', 0), at('gardenOut')),
    // Parking lot: kerbs, with a gap where each car lane crosses.
    ...lotWalls(),
    // The way back to the entrance plaza (the grid itself is open: a plaza).
    wall(along(CAR_LANES[CAR_LANES.length - 1][0], CAR_LANES[CAR_LANES.length - 1][1] + 3.5), along('start', -60)),
  ],
  ramps: [
    // The fountain's rim: a low kicker over the pool (a trick off it pays a boost; the floating boxes are over the pool).
    { at: at('fountain'), length: 10, height: 1.4, shape: 'kicker' },
  ],
  boostPads: [
    pad('start', 12),
    pad('prom', 6, 0.35),
    pad('landing', 2),
    pad('g1', 4, -0.3),
    pad('g2', 0, 0.3),
    pad('g3', 4, 0, 8, 7), //  the run-up to the fountain
    pad('g5', 4, -0.25),
    // Parking lot: pads ON the car lanes, so a car sometimes sits on them.
    ...CAR_LANES.map(([name, ds], i) => pad(name, ds - 4, i % 2 ? 0.35 : -0.35)),
    pad('ramp1', 8),
  ],
  grassPatches: [
    { at: along('g1', 16), offset: 0.5, length: 18, width: 7 },
    { at: along('g2', -10), offset: -0.5, length: 16, width: 7 },
    { at: along('g2', 24), offset: 0.55, length: 14, width: 6 },
    { at: along('g4', 6), offset: 0.5, length: 16, width: 7 },
    { at: along('g5', 10), offset: -0.5, length: 14, width: 7 },
  ],
  floatingItemRows: [{ at: along('fountain', 19), lift: 2.2 }],
  laps: 3,
  checkpoints: 10,
  itemRowSpacing: 150,
  scenery: {
    seed: 88,
    trees: 0,
    buildings: 0,
    mall: {
      seed: 5,
      upper: UPPER,
      upperFloor: [{ from: at('upperIn'), to: at('escA') }],
      garden: { from: at('gardenIn'), to: at('gardenOut') },
      fountain: { at: at('fountain'), length: 24 },
      lot: { from: at('lotIn'), to: at('lotEnd') },
      storeBranch: 0,
    },
  },
  theme: { grass: '#7fbf5a', offroad: '#d9d2c4', sky: '#8fcfff', horizon: '#ead8bd', mood: 'mall' },
  // (The terrain is only the floor the scenery stands on: level with the road for 12 m either side, then a wide blend, so
  // the palms beside the upper floor stand at its height. The renderer draws its own floors instead of the terrain.)
  terrain: { blend: 30 },
  shortcuts: [
    // The Boutique: straight through the store (in one door, out the other). A deck at the upper floor's height.
    { from: at('storeA'), to: at('storeB'), points: STORE_POINTS, width: STORE_WIDTH, deck: true, hold: true, surface: 'road', walls: [{ from: 0.55, to: STORE_POINTS.length + 0.45, side: 'both' }] },
    // The second escalator lane, mirrored to the left of the main lane.
    { from: at('escA'), to: at('escB'), points: ESC_POINTS, width: MALL_WIDTH, deck: true, hold: true, surface: 'road', walls: [{ from: 0.9, to: ESC_POINTS.length + 0.1, side: 'both' }] },
  ],
  hazards: [
    {
      kind: 'escalator',
      period: ESCALATOR_SCHEDULE.reduce((a, s) => a + s[2], 0),
      from: at('escTop'),
      to: at('escBot'),
      branch: 1,
      branchFrom: [mirror(route[at('escTop')].p)[0], route[at('escTop')].p[1]],
      branchTo: [mirror(route[at('escBot')].p)[0], route[at('escBot')].p[1]],
    },
    ...CAR_LANES.map(([name, ds, dir, period, phase]) => ({ kind: 'car' as const, at: along(name, ds), dir, period, phase, cars: 1 })),
  ],
};

/** Parking-lot kerbs: both sides from the garden's exit to the last car lane, with a 7 m gap where each car lane crosses. */
function lotWalls(): Wall[] {
  const out: Wall[] = [];
  let from = at('gardenOut');
  for (const [name, ds] of CAR_LANES) {
    out.push(wall(from, along(name, ds - 3.5)));
    from = along(name, ds + 3.5);
  }
  return out;
}
