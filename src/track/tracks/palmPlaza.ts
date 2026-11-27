/**
 * Track: "Palm Plaza" – an original, bright, modern two-storey shopping mall with palm trees (about 1.5 km).
 *
 * The lap (north = +z, east = +x; careful: +x is on a driver's LEFT when facing +z). The start line is on the entrance
 * plaza at ground level, heading east:
 *
 *   1. ENTRANCE ESCALATORS (0 -> 13 m)   two parallel escalator lanes carry the road UP through the mall's front into
 *                                        the upper floor (the main road and `shortcuts[0]`). Their belts switch
 *                                        direction on their own timetable (sim/hazards/escalator.ts); direction lights
 *                                        and signs only, no guide robot here.
 *   2. SKY GALLERY  (upper floor, 13 m)  an S along the gallery (glass railings, shops, palms, boost pads).
 *   3. THE ATRIUM SPLIT (choice)         the road splits in two levels:
 *        - UPPER: the main road carries on along the gallery (boost pads) and comes down the second pair of switching
 *          ESCALATORS (main road + `shortcuts[1]`); the guide robot between them points at the lane that helps;
 *        - LOWER: `shortcuts[2]` (a `deck`, wider) turns off over a KICKER at the gallery's edge and drops onto the
 *          ground floor of the atrium (any speed lands on it; a trick in the air pays a boost), then runs down the
 *          atrium floor and rejoins.
 *   4. GARDEN ATRIUM (ground floor, 0 m) S-bends with grass patches (slow) and the FOUNTAIN: its rim is a kicker with a
 *                                        row of item boxes floating over the pool.
 *   5. THE SPIRAL   (0 -> 13 m)          a wide helix (r 38 m, 330 degrees) climbing round the atrium's sculpture
 *                                        column; it leaves the building at the top, over its own entry.
 *   6. PARKING DECK (outside, 13 m)      cars drive ALONG the road (sim/hazards/car.ts): oncoming ones first, then
 *                                        slow ones going your way that change sides with their indicators on. Each
 *                                        holds the left or the right half of the road: steer round. Hit one = flip.
 *   7. DECK RAMP    (13 -> 0 m)          S-bends down the parking ramp and a sweeping bend back to the plaza and the grid.
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

/** Height of the upper floor (m); the ground floor and the plaza are at 0. */
export const UPPER = 13;
/** Road width (m) everywhere on the main road, both escalator lanes included. */
export const MALL_WIDTH = 16;
/** Width of the lower (ground-floor) route of the atrium split (m): wider than the gallery. */
export const LOW_WIDTH = 20;
/** Length (m) of the moving part of each escalator. */
export const ESC_LEN = 78;
const ESC_R = 40;
const ESC_DEG = 25;
const ESC_LINE = 14;
/** The spiral: radius (m) and how far round it goes (degrees). */
export const SPIRAL_R = 38;
export const SPIRAL_DEG = 330;
/** Height of the kicker at the gallery's edge (m above the upper floor) and its length (m). */
export const LEDGE_KICK = 1.7;
const LEDGE_KICK_LEN = 11;

const t = new Turtle(0, 0, 0, 90).mark('start');

/**
 * A pair of escalators: the main lane swings `swing` (+1 = a turtle right turn) away from the fork's axis, runs ESC_LEN m
 * straight while the height changes by `dy`, and swings back. Named points: `${name}A` (fork), `${name}On` / `${name}Off`
 * (the moving part), `${name}B` (merge). The other lane is the main lane mirrored across the axis (see `escalatorLane`).
 */
function escalators(name: string, dy: number, swing: 1 | -1): void {
  t.mark(`${name}A`);
  t.turn(ESC_R, swing * ESC_DEG).line(ESC_LINE).turn(ESC_R, -swing * ESC_DEG).mark(`${name}On`);
  t.line(ESC_LEN, dy).mark(`${name}Off`);
  t.turn(ESC_R, -swing * ESC_DEG).line(ESC_LINE).turn(ESC_R, swing * ESC_DEG).mark(`${name}B`);
}

// ---- 1. The plaza and the entrance escalators: up into the mall (the main lane swings north, the other south) ----
t.line(44);
escalators('e1', UPPER, -1);

// ---- 2. Sky Gallery (upper floor): an S along the gallery, then the split ----
t.line(6).mark('gallery').turn(56, 30).mark('gal1').turn(56, -30).mark('split');

// ---- 3. The atrium split: the main road stays up (gallery, then the down escalators); the lower route turns off ----
t.line(56).mark('galPad').turn(44, 90).mark('galTurn').line(8);
escalators('e2', -UPPER, 1);

// ---- 4. Garden atrium (ground floor): right into the garden, an S with grass, the fountain ----
t.line(4).turn(40, 90).mark('gardenIn').turn(90, -15).turn(90, 15).line(36).mark('rejoin');
t.line(14).mark('fountain'); //   the rim's kicker (10 m), the pool, and a straight run-out
t.line(28).mark('fountainOut');
t.turn(48, -30).mark('g1').turn(48, 30).mark('g2').turn(48, 14).mark('gardenOut');

// ---- 5. The spiral: a climbing helix round the sculpture column, out of the building at the top ----
t.line(4).mark('spiralIn').turn(SPIRAL_R, SPIRAL_DEG, UPPER).mark('spiralOut').line(14).mark('mallExit');

// ---- 6. Parking deck (outside, upper level): a right bend, then the car stretch (gentle S-bends) ----
t.turn(44, 60).mark('deckIn').line(12).turn(70, -26).mark('cars1').turn(70, 26).mark('cars2').line(12).turn(70, 26).mark('cars3').turn(70, -26).mark('deckEnd');

// ---- 7. Deck ramp: S-bends down to the plaza ----
t.turn(56, -30, -1.5).mark('ramp1').turn(56, 60, -5).mark('ramp2').turn(56, -40, -5).mark('ramp3').turn(56, 40, -1.5).mark('rampEnd');

/** The pose the turtle stands in. */
const here = () => ({ x: t.x, z: t.z, heading: t.heading });

/**
 * Close the lap: a circle arc, a straight, then a second circle arc that ends on the pose (targetX, targetZ, targetHeading)
 * (copied from Rainbow Route: the shortest of the four left/right combinations).
 */
function closeTo(radius: number, targetX: number, targetZ: number, targetHeading: number, maxDeg = 360, firstSide = 0): { a1: number; len: number; a2: number } {
  const p = here();
  const centre = (x: number, z: number, heading: number, side: number) => ({ x: x + side * radius * Math.cos(rad(heading)), z: z - side * radius * Math.sin(rad(heading)) });
  const wrapDeg = (d: number, side: number) => {
    const v = (((d * side) % 360) + 360) % 360;
    return (v > 350 ? v - 360 : v) * side;
  };
  let best: { a1: number; len: number; a2: number; total: number } | null = null;
  for (const s1 of firstSide ? [firstSide] : [-1, 1]) {
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
      if (Math.abs(a1) > maxDeg || Math.abs(a2) > maxDeg) continue;
      if (!best || total < best.total) best = { a1, len, a2, total };
    }
  }
  if (!best) throw new Error('palmPlaza: cannot close the path');
  return best;
}

// ---- back to the grid on the entrance plaza: whatever it takes to arrive heading east on the start line ----
/** The road arrives heading east at x = END_X, then a gentle S and a straight grid to the start line. */
const END_X = -50;
const S_R = 80;
const S_DEG = 10;
const END_Z = 2 * S_R * (1 - Math.cos(rad(S_DEG))); // (the final S shifts the road this far to its right)
const CLOSE_R = 36;
const close = closeTo(CLOSE_R, END_X, END_Z, 90, 150);
{
  if (Math.abs(close.a1) > 0.01) t.turn(CLOSE_R, close.a1).mark('home1');
  if (close.len > 100) {
    // A long run between the two arcs: an S in the middle of it (neutral sideways and in heading).
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
 * sudden grade change at speed is a ramp (the crest-launch rule). The flat floors stay flat, the escalators, the spiral
 * and the ramp get eased ends.
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

type P3 = [number, number, number];

/** A point mirrored across the axis of the fork at `${name}A` (the line through it along the road's heading there). */
function mirrorAcross(name: string): (p: P3) => P3 {
  const a = route[at(`${name}A`)];
  const ux = Math.sin(rad(a.heading));
  const uz = Math.cos(rad(a.heading));
  return (p) => {
    const vx = p[0] - a.p[0];
    const vz = p[1] - a.p[1];
    const along = vx * ux + vz * uz;
    return [a.p[0] + 2 * along * ux - vx, a.p[1] + 2 * along * uz - vz, p[2]];
  };
}

/**
 * The second lane of an escalator pair (a deck branch): the main lane's moving part mirrored across the fork's axis, same
 * heights. The split arcs are left out: the branch builder adds its own straight 16 m lead at each junction (a deck
 * leaves the main centre line at 9 degrees) and a smooth curve to the first point.
 */
function escalatorLane(name: string): P3[] {
  const m = mirrorAcross(name);
  return route.slice(at(`${name}On`), at(`${name}Off`) + 1).map((r) => m(r.p));
}
const E1_POINTS = escalatorLane('e1');
const E2_POINTS = escalatorLane('e2');

/**
 * The lower route of the atrium split (a deck branch, LOW_WIDTH wide), written with a second turtle. It leaves the gallery
 * at 'split' on the inside of the coming right-hand bend, swings right towards the atrium, runs up a kicker to the gallery's
 * edge (the LEDGE), drops onto the ground floor (the height line falls 13 m in 2 m: in practice everyone flies), runs
 * south down the atrium floor beside the escalators and curves right to rejoin the main road at 'rejoin'.
 * The branch builder adds the 16 m leads at both junctions; this path starts at the end of the first lead and is closed
 * onto the start of the last one with the same circle-line-circle construction as the lap.
 */
const LOW_POINTS: P3[] = (() => {
  const LEAD = 16;
  const ANG = 9;
  const a = route[at('split')];
  // Leave towards the right of the main road (a turtle right turn = +degrees): the inside of the coming bend.
  const h0 = a.heading + ANG;
  const lt = new Turtle(a.p[0] + Math.sin(rad(h0)) * LEAD, a.p[1] + Math.cos(rad(h0)) * LEAD, UPPER, h0);
  // (Arcs in small steps: the branch builder joins the points with Hermite curves, which only stay round when the points are dense.)
  const arc = (r: number, deg: number) => {
    const n = Math.max(1, Math.ceil(Math.abs(deg) / 6));
    for (let k = 0; k < n; k++) lt.turn(r, deg / n);
    return lt;
  };
  lt.line(3).line(3);
  arc(90, 12);
  arc(46, 74).line(6);
  const kickFrom = lt.route.length - 1;
  lt.line(LEDGE_KICK_LEN, LEDGE_KICK).mark('lip');
  const lip = lt.route.length - 1;
  // The drop: 2 m past the lip the height line is down on the ground floor; then a long straight landing.
  lt.line(2, -UPPER - LEDGE_KICK).line(10).line(10).line(10).mark('landed');
  // Down the atrium floor: S-bends round the palm islands.
  arc(46, -14);
  arc(46, 14);
  // Close onto the start of the end lead: arriving at 'rejoin' from the main road's right at 9 degrees.
  const q = route[at('rejoin')];
  const hq = q.heading - ANG;
  // (Aim 20 m short of the lead's start and run in straight: the joint stays round. The last 3 steps are left out.)
  const ex = q.p[0] - Math.sin(rad(hq)) * (LEAD + 20);
  const ez = q.p[1] - Math.cos(rad(hq)) * (LEAD + 20);
  const c = closeWith(lt, 36, ex, ez, hq);
  if (Math.abs(c.a1) > 0.01) arc(36, c.a1);
  if (c.len > 0.01) for (let k = 0; k < Math.ceil(c.len / 8); k++) lt.line(c.len / Math.ceil(c.len / 8));
  if (Math.abs(c.a2) > 0.01) arc(36, c.a2);
  for (let k = 0; k < 5; k++) lt.line(4);
  // The first point (the lead's end) is the builder's own; heights: the upper floor up to the kicker, then the kicker,
  // then the ground floor.
  // (The last point is where the builder's end lead starts: left out too.)
  return lt.route.slice(3, -3).map((r, i): P3 => {
    const k = i + 3;
    const y = k <= kickFrom ? UPPER : k <= lip ? r.p[2] : 0;
    return [r.p[0], r.p[1], y];
  });
})();

/** `closeTo` for any turtle (see above). */
function closeWith(tt: Turtle, radius: number, targetX: number, targetZ: number, targetHeading: number): { a1: number; len: number; a2: number } {
  const saved = { x: t.x, z: t.z, heading: t.heading };
  t.x = tt.x;
  t.z = tt.z;
  t.heading = tt.heading;
  const r = closeTo(radius, targetX, targetZ, targetHeading, 150);
  Object.assign(t, saved);
  return r;
}

/** Main-road stretches (control-point units) with walls. */
type Wall = TrackDef['walls'][number];
const wall = (from: number, to: number, side: Wall['side'] = 'both'): Wall => ({ from, to, side });

/** Boost pad `ds` metres past a named point. */
const pad = (name: string, ds: number, offset = 0, length = 8, width = 6) => ({ at: along(name, ds), offset, length, width });

/**
 * Walls round a deck fork: both sides, except the side where the deck leaves / rejoins, which stays OPEN for `open` metres
 * after the split and before the merge (a kart steps from the main road onto a deck only once it is off the main road's
 * kerb, so the opening must outlast the point where the two roads have pulled apart).
 */
function forkWalls(a: string, b: string, side: 'left' | 'right', open = 52): Wall[] {
  const keep = side === 'left' ? 'right' : 'left';
  return [wall(along(a, -6), along(a, open), keep), wall(along(a, open), along(b, -open)), wall(along(b, -open), along(b, 6), keep)];
}

/**
 * The parking deck's traffic: stretches of road (from / to as [named point, metres past it]), the way the cars drive
 * (+1 = with the race), the half of the road they hold (+1 = the race's right) in each part of their drive, and timing.
 */
const CAR_STRETCHES: { from: [string, number]; to: [string, number]; dir: 1 | -1; sides: (1 | -1)[]; period: number; phase: number; cars: number }[] = [
  { from: ['deckIn', 4], to: ['cars2', 0], dir: -1, sides: [1], period: 9, phase: 0, cars: 2 },
  { from: ['cars2', 16], to: ['deckEnd', 6], dir: 1, sides: [-1, 1], period: 11, phase: 3, cars: 2 },
];

/**
 * Parapets from `from` to `to` (control-point units), open on one side where a car of the deck's traffic drives out of / into
 * its garage gate (from 3 m behind the gate's door to 11 m past it, on the gate's side).
 */
function deckWalls(from: number, to: number): Wall[] {
  const gaps: { a: number; b: number; side: 'left' | 'right' }[] = [];
  for (const c of CAR_STRETCHES) {
    const start = c.dir > 0 ? c.from : c.to;
    const end = c.dir > 0 ? c.to : c.from;
    const sideOf = (v: number) => (v > 0 ? 'right' : 'left') as 'left' | 'right';
    // Out of the gate: the car drives the race's way (dir) from `start`; into the gate: it arrives at `end`.
    const a0 = along(start[0], start[1] - 3 * c.dir);
    const a1 = along(start[0], start[1] + 11 * c.dir);
    const b0 = along(end[0], end[1] - 11 * c.dir);
    const b1 = along(end[0], end[1] + 3 * c.dir);
    gaps.push({ a: Math.min(a0, a1), b: Math.max(a0, a1), side: sideOf(c.sides[0]) });
    gaps.push({ a: Math.min(b0, b1), b: Math.max(b0, b1), side: sideOf(c.sides[c.sides.length - 1]) });
  }
  gaps.sort((g, h) => g.a - h.a);
  const out: Wall[] = [];
  let cur = from;
  for (const g of gaps) {
    out.push(wall(cur, g.a), wall(g.a, g.b, g.side === 'left' ? 'right' : 'left'));
    cur = g.b;
  }
  out.push(wall(cur, to));
  return out;
}

// The game's sides: + lateral = the driver's right = the turtle's... (see `rightOf` in the sim: (-tz, tx)). A turtle
// right turn (+deg) swings the road towards +lateral... no: towards the driver's LEFT. So:
//   e1's main lane swings with a turtle LEFT turn -> to the driver's right; the second lane leaves on the driver's left.
//   e2's main lane swings with a turtle RIGHT turn -> to the driver's left; the second lane leaves on the driver's right.
//   The lower route leaves with a turtle right turn -> on the driver's left; it rejoins from the same side.

export const palmPlaza: TrackDef = {
  name: 'Palm Plaza',
  blurb: 'A bright two-storey shopping mall: switching escalators, a split between the gallery and the atrium floor with a leap off the ledge, a garden fountain jump, a spiral ramp and a parking deck full of traffic.',
  points,
  width: MALL_WIDTH,
  // No grass verge indoors: the glass railings stand right at the kerb (and a deck lane's floor ends there too).
  offroadWidth: 2,
  // Flat floors (no banking): the deck lanes beside the main road are flat too, so stepping from one onto the other is seamless.
  bankPerCurvature: 0,
  maxBankDeg: 0,
  walls: [
    // The plaza is open; railings from the entrance fork on.
    ...forkWalls('e1A', 'e1B', 'left'),
    wall(along('e1B', 6), along('split', -6)),
    // The atrium split: the lower route leaves on the driver's left; the gallery's left side stays open for it.
    wall(along('split', -6), along('split', 56), 'right'),
    wall(along('split', 56), along('e2A', -6)),
    ...forkWalls('e2A', 'e2B', 'right'),
    wall(along('e2B', 6), along('rejoin', -56)),
    wall(along('rejoin', -56), along('rejoin', 6), 'right'),
    // Garden: low planter walls, open round the fountain pool (the pool rim is part of the road).
    wall(along('rejoin', 6), along('fountain', -6)),
    wall(at('fountainOut'), at('mallExit')),
    // Parking deck and ramp: parapets (with gaps where the cars come out of / go into their garage gates), down to the
    // plaza (the grid itself is open: a plaza).
    ...deckWalls(at('mallExit'), along('start', -60)),
  ],
  ramps: [
    // The fountain's rim: a low kicker over the pool (a trick off it pays a boost; the floating boxes are over the pool).
    { at: at('fountain'), length: 10, height: 1.4, shape: 'kicker' },
  ],
  boostPads: [
    pad('start', 14),
    pad('e1B', 2, 0.3),
    pad('gal1', 0, -0.35),
    pad('galPad', -6, 0.3),
    pad('galPad', 18, -0.3),
    pad('galTurn', 4, 0.35),
    pad('rejoin', 2, 0, 8, 7), //  the run-up to the fountain
    pad('spiralIn', 0),
    pad('rampEnd', 10),
  ],
  grassPatches: [
    { at: along('g1', 4), offset: 0.5, length: 16, width: 7 },
    { at: along('g1', 30), offset: -0.5, length: 14, width: 7 },
  ],
  floatingItemRows: [{ at: along('fountain', 19), lift: 2.2 }],
  laps: 3,
  checkpoints: 10,
  itemRowSpacing: 130,
  scenery: {
    seed: 88,
    trees: 0,
    buildings: 0,
    mall: {
      seed: 5,
      upper: UPPER,
      upperFloor: [{ from: at('e1Off'), to: at('e2On') }],
      garden: { from: at('gardenIn'), to: at('gardenOut') },
      fountain: { at: at('fountain'), length: 24 },
      spiral: { from: at('spiralIn'), to: at('spiralOut') },
      deck: { from: at('mallExit'), to: at('ramp1') },
      low: 2,
      // The building: round everything from the top of the entrance escalators to the top of the spiral.
      building: [
        [155, 34],
        [405, 34],
        [405, -318],
        [72, -318],
        [72, -190],
        [155, -100],
      ],
    },
  },
  theme: { grass: '#7fbf5a', offroad: '#d9d2c4', sky: '#8fcfff', horizon: '#ead8bd', mood: 'mall' },
  // (The terrain is only the floor the scenery stands on: level with the road for 12 m either side, then a wide blend.
  // The renderer draws its own floors instead of the terrain.)
  terrain: { blend: 30 },
  shortcuts: [
    // The entrance escalators' second lane (on the driver's left of the main lane).
    { from: at('e1A'), to: at('e1B'), points: E1_POINTS, width: MALL_WIDTH, deck: true, hold: true, surface: 'road', walls: [{ from: 0.9, to: E1_POINTS.length + 0.1, side: 'both' }] },
    // The down escalators' second lane (on the driver's right).
    { from: at('e2A'), to: at('e2B'), points: E2_POINTS, width: MALL_WIDTH, deck: true, hold: true, surface: 'road', walls: [{ from: 0.9, to: E2_POINTS.length + 0.1, side: 'both' }] },
    // The lower route of the atrium split: over the ledge and down the atrium floor (a sharp height line: deckSmooth 1).
    { from: at('split'), to: at('rejoin'), points: LOW_POINTS, width: LOW_WIDTH, deck: true, hold: true, surface: 'road', deckSmooth: 1, alternate: true, walls: [{ from: 1.2, to: LOW_POINTS.length - 0.2, side: 'both' }] },
  ],
  hazards: [
    {
      kind: 'escalator',
      period: ESCALATOR_SCHEDULE.reduce((a, s) => a + s[2], 0),
      phase: 12,
      from: at('e1On'),
      to: at('e1Off'),
      branch: 0,
      branchFrom: E1_POINTS[0].slice(0, 2) as [number, number],
      branchTo: E1_POINTS[E1_POINTS.length - 1].slice(0, 2) as [number, number],
      mascot: false,
    },
    {
      kind: 'escalator',
      period: ESCALATOR_SCHEDULE.reduce((a, s) => a + s[2], 0),
      from: at('e2On'),
      to: at('e2Off'),
      branch: 1,
      branchFrom: E2_POINTS[0].slice(0, 2) as [number, number],
      branchTo: E2_POINTS[E2_POINTS.length - 1].slice(0, 2) as [number, number],
    },
    // Parking deck: oncoming cars on the first stretch, then slow cars going your way that change sides once.
    ...CAR_STRETCHES.map((c) => ({ kind: 'car' as const, from: along(c.from[0], c.from[1]), to: along(c.to[0], c.to[1]), dir: c.dir, sides: c.sides, period: c.period, phase: c.phase, cars: c.cars })),
  ],
};
