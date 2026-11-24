/**
 * Track: "Rainbow Route" – a wide, glowing, translucent ribbon road floating in space far above a planet (about 1.7 km).
 *
 * There is no ground anywhere: the ribbon is all there is, and the few rails (rainbow glass) stand only on the hardest corners.
 * Step off the edge and you fall into the void; the carrier drone fetches you (the usual respawn rule).
 *
 * The lap runs anticlockwise (north = +z, east = +x; the start line is at the west end of the south edge, heading east):
 *
 *   1. LAUNCH RUN  (y 72 -> 58)   a boost pad on the grid, a diving S-bend, then a KICKER over a short gap in the ribbon.
 *   2. THE FORK    (y 58 -> 54)   a clear Y: the ribbon splits in two equal ribbons with a void between them. The main ribbon
 *                                 swings out to the right and keeps its boost pads; the high line stays on the left, is a little
 *                                 shorter and higher, and has no pads. They merge again at a glowing divider post.
 *   3. EAST CURL   (y 54 -> 37)   a wide, strongly banked half-pipe turn through 180 degrees that drops to the lowest point of the lap.
 *   4. WAVE ROAD   (y 37)         westbound: a row of trick bumps ("waves"), then
 *   5. CLIMB       (y 37 -> 66)   a long climbing S-bend (the steepest part is the lap's highest grade, under 20 %).
 *   6. STAR TUNNEL (y 66 -> 102)  the ribbon ends at a glowing launch pad: a tube of star rings fires every kart
 *                                 along ONE fixed arc (whatever its speed) and sets it down on the high ribbon 36 m up.
 *   7. HIGH RIBBON (y 102 -> 75)  a kicker right after the landing, then S-bends and a long, steep descent, and
 *   8. SKY SWEEP   (y 75 -> 72)   the long banked sweeper that comes down to the start line.
 *
 * Like Mushroom Valley the route is written with a turtle (src/track/turtle.ts): every bend is an exact circle arc, so
 * the radius (>= 28 m everywhere: the bots never have to brake hard for a bend on a road with few rails) is known and the lap can
 * be closed exactly (see `closeTo`).
 *
 * How the look works: `scenery.rainbow` turns the standard road, kerbs, terrain and scenery off and draws the ribbon,
 * the planet, the stars and the arches instead (src/render/env/rainbow.ts). The ground ENDS at the ribbon's edge (`cliffs`
 * on both sides all round the lap), so the physics has nothing but the ribbon to stand on. The fork is a `deck` shortcut.
 */
import type { TrackDef } from '../types';
import { Turtle, type RoutePoint } from '../turtle';

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Arc length (m) of a circle arc of radius r through deg degrees. */
const arcLen = (r: number, deg: number): number => (Math.abs(deg) * Math.PI * r) / 180;

/** Start height (m above the planet's cloud tops: only relative heights matter). */
const Y0 = 72;
/** The road ends here before the launch (height of the star tunnel's mouth is wherever the turtle stands). */
export const TUNNEL_GAP = 100;
/**
 * Gap lengths (m) of the two jumps. Short ones, and the ramps low: a kicker's flight grows with the SQUARE of the speed, so a
 * high ramp and a long gap would be cleared by a few metres at a slow 22 m/s but overshoot by 30 m at a boosted 44 m/s. These
 * (see the landing tests) land on the apron or just past it at every speed from 20 to 44 m/s, and the road is straight for 40 m
 * after each gap.
 */
export const JUMP1_GAP = 9;
export const JUMP2_GAP = 9;
/** Start/landing heights are set by the route; this is how much higher the star tunnel puts the high ribbon (m). */
export const TUNNEL_CLIMB = 36;
/** Width of the ribbon (m): the main road and the fork's branch. */
export const RIBBON_WIDTH = 18;

const t = new Turtle(0, 0, Y0, 90).mark('start');

// ---- 1. Launch run: a pad on the grid, a diving S-bend, then the first kicker (flat, with a straight run-up and run-out) ----
t.turn(60, 18, 0).turn(60, -18, 0).mark('run'); // (nothing is dead straight: the grid, then a gentle S)
t.turn(42, 45, -3).mark('e1a').turn(42, -90, -6).mark('e1b').turn(42, 45, -3).mark('esses1'); // (a dive: 12 m in 138 m)
t.line(20, 0).mark('jump1'); // the kicker (see `ramps`): 10 m ramp, 9 m of nothing, a 10 m landing apron...
t.line(38, 0); // ...and a straight run-out, so a flat-out flight lands on the road
t.turn(46, 26, -0.5).turn(46, -26, -0.5).mark('land1');

// ---- 2. The fork: a Y. One ribbon splits at 'forkA'; the main ribbon bulges out to the right, the high line stays left ----
t.line(16, -0.6).mark('forkA');
t.turn(70, 20, -0.3).line(36, -0.6).turn(70, -40, -0.6).line(36, -0.6).turn(70, 20, -0.3).mark('forkB'); // (net sideways shift 0)

// ---- 3. East curl: a wide half-pipe in two quarters, strongly banked, dropping 17 m (the bank follows the curvature, see bankPerCurvature) ----
t.turn(50, -90, -5).mark('pipeE');
t.turn(52, 36, -2).turn(52, -36, -2).mark('pipeMid'); // (the straight between the quarters: pads, and room to breathe)
t.turn(50, -90, -5);
t.turn(54, 28, -1.5).turn(54, -28, -1.5).mark('padN'); //                      boost pads on the way out
// ---- 4. Wave road (westbound): a field of bumps on a long, easy bend (the lowest point of the lap) ----
t.line(10, 0).mark('waves'); // (the wave road: 5 humps on a long easy S: karts fly the bumps flat out, so no tight bend and no boost pad here)
t.turn(100, 10, 0).turn(100, -20, 0).turn(100, 10, 0).mark('wavesEnd');
// ---- 5. The climb: one big S-bend, then the funnel into the tunnel ----
t.turn(44, 60, 6).mark('c1').turn(44, -120, 12).mark('c2').turn(44, 60, 6).mark('climbTop');
t.line(14, 2).mark('tunnelIn');
// ---- 6. Star tunnel: the road ends at the launch pad; 100 m of sky; the high ribbon starts at the landing ----
t.line(26, 2).mark('tunnelMouth');
// (A straight line across the gap, nobody drives it; but the launch pad's 7 m and the landing platform's 10 m are on it, so they stay level.)
t.line(12, 0).line(TUNNEL_GAP - 24, TUNNEL_CLIMB).line(12, 0).mark('tunnelLand');
// ---- 7. High ribbon: the kicker right after the landing, a straight run-out, then S-bends and the long descent ----
t.line(4, 0).mark('highStart');
t.line(10, 0).mark('jump2'); // (right after the landing: the star tunnel drops you into the second jump)
t.line(30, 0);
t.turn(46, 26, -2).turn(46, -26, -2).mark('land2');
t.turn(42, -45, -5).mark('h1a').turn(42, 90, -8).mark('h1b').turn(42, -45, -5).mark('highEsses');

/** The pose the turtle stands in. */
const here = () => ({ x: t.x, z: t.z, heading: t.heading });

// ---- 8. Sky sweep: whatever it takes to come back to the start line heading east ----
/**
 * Close the lap: a circle arc, a straight, then a second circle arc that ends on the pose (targetX, targetZ, targetHeading).
 * Both arcs have the given radius and either may turn either way (the shortest of the four combinations is used).
 * Returns the two arc angles (degrees, positive = right turn) and the straight's length. Throws nothing: if the pose
 * is too close for a combination it is skipped.
 */
function closeTo(radius: number, targetX: number, targetZ: number, targetHeading: number): { a1: number; len: number; a2: number; r: number } {
  const p = here();
  /** Centre of the circle of a turn of direction `side` (+1 = right) through the pose (x, z, heading). */
  const centre = (x: number, z: number, heading: number, side: number) => ({ x: x + side * radius * Math.cos(rad(heading)), z: z - side * radius * Math.sin(rad(heading)) });
  /** Turn through `d` degrees in the direction `side`: 0..350 degrees (a hair more is taken as a hair the other way round). */
  const wrap = (d: number, side: number) => {
    const v = (((d * side) % 360) + 360) % 360;
    return (v > 350 ? v - 360 : v) * side;
  };
  let best: { a1: number; len: number; a2: number; r: number; total: number } | null = null;
  for (const s1 of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      const c1 = centre(p.x, p.z, p.heading, s1);
      const c2 = centre(targetX, targetZ, targetHeading, s2);
      const dx = c2.x - c1.x;
      const dz = c2.z - c1.z;
      const D = Math.hypot(dx, dz);
      const phi = Math.atan2(dx, dz); // compass heading (rad) from the first centre to the second
      let theta: number; // heading of the straight
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
      const a1 = wrap(th - p.heading, s1);
      const a2 = wrap(targetHeading - th, s2);
      const total = arcLen(radius, a1) + len + arcLen(radius, a2);
      if (!best || total < best.total) best = { a1, len, a2, r: radius, total };
    }
  }
  return best!;
}

const END_X = -90; // the road arrives heading east at x = -100: a gentle S, then a straight to the start line (and the grid behind it)
const CLOSE_R = 46;
// (The final S shifts the road 2 r (1 - cos 14.5 deg) to its right, so the closure aims that far left of the start line's axis.)
const END_Z = 2 * 120 * (1 - Math.cos(rad(14.5)));
const close = closeTo(CLOSE_R, END_X, END_Z, 90);
{
  const rest = t.y - Y0; // height still to lose
  const total = arcLen(CLOSE_R, close.a1) + close.len + arcLen(CLOSE_R, close.a2);
  const drop = (len: number) => (-rest * len) / total;
  if (Math.abs(close.a1) > 0.01) t.turn(CLOSE_R, close.a1, drop(arcLen(CLOSE_R, close.a1))).mark('sweep1');
  if (close.len > 100) {
    // A long run between the two arcs: an S in the middle of it (three arcs, neutral sideways and in heading).
    const S_R = 60;
    const S_A = 20;
    const sForward = 4 * S_R * Math.sin(rad(S_A));
    const sLen = 4 * arcLen(S_R, S_A);
    const rest = (close.len - sForward) / 2;
    t.line(rest, drop(rest)).turn(S_R, S_A, drop(sLen / 4)).turn(S_R, -2 * S_A, drop(sLen / 2)).turn(S_R, S_A, drop(sLen / 4)).line(rest, drop(rest)).mark('sweep2');
  } else if (close.len > 0.01) t.line(close.len, drop(close.len)).mark('sweep2');
  if (Math.abs(close.a2) > 0.01) t.turn(CLOSE_R, close.a2, drop(arcLen(CLOSE_R, close.a2))).mark('sweep2');
  t.turn(120, 14.5, 0).turn(120, -14.5, 0).line(29.9, 0); // a gentle S, then 30 m dead straight (the grid) to the start line
}

const route: RoutePoint[] = t.route;
// The last point is the start again (the loop closes by itself): drop the duplicate.
if (Math.hypot(route[route.length - 1].p[0] - route[0].p[0], route[route.length - 1].p[1] - route[0].p[1]) < 1.5) route.pop();

/**
 * The turtle steps the height arc by arc, so the grade jumps where one arc ends and the next begins. A kart does not
 * like that: a rising kart whose ground bends away at 38 m/s (boost speed) leaves the ground (the "crest launch" rule), so
 * a +4 % grade step is a ramp. So the heights are smoothed (a triangular average over +-SMOOTH_M metres of road), in two
 * parts that never mix: from the star tunnel's landing round the lap to its mouth. (The straight across the flight gap
 * keeps its own line; nobody drives it.) The ends of each part are left flat by the average's one-sided window.
 */
const SMOOTH_M = 28;
{
  const n = route.length;
  const iMouth = route.findIndex((r) => r.name === 'tunnelMouth');
  const iLand = route.findIndex((r) => r.name === 'tunnelLand');
  const order: number[] = [];
  for (let i = iLand; ; i = (i + 1) % n) {
    order.push(i);
    if (i === iMouth) break;
  }
  const d: number[] = [0];
  for (let k = 1; k < order.length; k++) {
    const a = route[order[k - 1]].p;
    const b = route[order[k]].p;
    d.push(d[k - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  for (let pass = 0; pass < 2; pass++) {
    const y = order.map((i) => route[i].p[2]);
    order.forEach((i, k) => {
      let sum = 0;
      let wsum = 0;
      for (let j = 0; j < order.length; j++) {
        const w = 1 - Math.abs(d[j] - d[k]) / SMOOTH_M;
        if (w <= 0) continue;
        sum += w * y[j];
        wsum += w;
      }
      route[i].p[2] = sum / wsum;
    });
  }
}
const points = route.map((r) => r.p);

/** Position of a named point, in control-point units (what every feature below wants). */
export function at(name: string): number {
  const i = route.findIndex((r) => r.name === name);
  if (i < 0) throw new Error(`rainbowRoute: no point named "${name}"`);
  return i;
}

/** Control-point units `ds` metres further along the road from a named point (straight lines between control points). */
export function along(name: string, ds: number): number {
  let i = at(name);
  let remaining = ds;
  for (;;) {
    const a = route[i % route.length].p;
    const b = route[(i + 1) % route.length].p;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (remaining <= len) return i + remaining / len;
    remaining -= len;
    i++;
  }
}

/**
 * A spot in the road's own coordinates: `ds` metres further along the road from the named point and `lat` metres to the
 * right of the centre line (negative = left). Returns world x, z and the road height there.
 */
export function local(name: string, ds: number, lat = 0): { x: number; z: number; y: number } {
  let i = at(name);
  let remaining = ds;
  const seg = (k: number) => {
    const a = route[k % route.length].p;
    const b = route[(k + 1) % route.length].p;
    return { a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  };
  while (remaining > seg(i).len) {
    remaining -= seg(i).len;
    i++;
  }
  const { a, b, len } = seg(i);
  const u = remaining / len;
  const dx = (b[0] - a[0]) / len;
  const dz = (b[1] - a[1]) / len;
  return { x: a[0] + (b[0] - a[0]) * u + dz * lat, z: a[1] + (b[1] - a[1]) * u - dx * lat, y: a[2] + (b[2] - a[2]) * u };
}

/** Distance (m) along the road between two named points. */
const dist = (from: string, to: string): number => {
  let d = 0;
  for (let i = at(from); i < at(to); i++) d += Math.hypot(route[i + 1].p[0] - route[i].p[0], route[i + 1].p[1] - route[i].p[1]);
  return d;
};
export { dist as routeDistance };

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

/** A boost pad `ds` metres past a named point (arch = a star-ring arch stands over it). */
const pad = (name: string, ds: number, arch = false, offset = 0, length = 9, width = 6) => ({ at: along(name, ds), offset, length, width, arch });

const boostPads = [
  pad('start', 14, true), //                  the grid launch
  pad('run', 10, true),
  pad('esses1', 10, false, 0.3),
  pad('land1', 14, true), //                  after the first jump
  // The fork's main ribbon: a row of pads (the branch has none).
  pad('forkA', 52, false, -0.25),
  pad('forkA', 78, true, 0.15),
  pad('forkA', 106, false, -0.1),
  pad('padN', 0, true, 0),
  pad('climbTop', 6, true),
  pad('sweep1', 30, true),
  pad('highEsses', 4, false, 0.3),
  pad('jump2', 44, false, -0.3), // (the straight run-out after the second kicker)
  pad('land2', 12, true),
  pad('pipeMid', 12, true),
  pad('sweep2', 30, true),
];

/** Waves: a row of smooth humps (trick bumps) over 6 x 18 m. */
const waves = [0, 1, 2, 3, 4].map((k) => ({ at: along('waves', 12 + k * 14), length: 12, height: 0.8, shape: 'hump' as const }));

// ---------------------------------------------------------------------------
// The track
// ---------------------------------------------------------------------------

const FORK_FROM = at('forkA');
const FORK_TO = at('forkB');

/**
 * The high line of the fork: the other arm of the Y. It leaves the main ribbon's centre line at the split, swings out to
 * about 10 m to the LEFT of the line the road had before the split (while the main ribbon bulges 20 m to the right of it:
 * the void between them is about 12 m wide at its widest) and comes back to the centre line at the merge. Control points are
 * given in the split's own frame (metres forward, metres to the right), the height is the main ribbon's height there plus a
 * lift of up to 2.2 m (the high line climbs a little and comes back: higher and a few metres shorter).
 */
const FORK_POINTS = (
  [
    [36, -5, 0.5],
    [80, -10, 2.2],
    [120, -5, 1.4],
  ] as const
).map(([f, lat, dy]) => {
  const o = route[at('forkA')];
  const h = rad(o.heading);
  const base = local('forkA', f, 0); // (for the height only: the main ribbon's height `f` metres on)
  return [o.p[0] + Math.sin(h) * f + Math.cos(h) * lat, o.p[1] + Math.cos(h) * f - Math.sin(h) * lat, base.y + dy] as [number, number, number];
});

export const rainbowRoute: TrackDef = {
  name: 'Rainbow Route',
  blurb: 'A glowing ribbon road in space: boost-pad arches, a banked half-pipe, trick waves, a Y-shaped split, steep dives and climbs and a star tunnel that fires you back up to the high road.',
  points,
  width: RIBBON_WIDTH,
  offroadWidth: 2,
  // Bots on a wide, grip-everywhere ribbon would be far quicker than a person: see docs/TRACKS.md (Rainbow Route, bots).
  botTuning: { pace: 0.97, cornerCurvature: 0.022, wander: 4.5, trickScale: 0.5, noDrift: true },
  bankPerCurvature: 16,
  maxBankDeg: 20,
  // Rainbow rails ONLY on the sharpest corners: the dive's middle swing, the half-pipe (outside), the climb's middle swing, the
  // funnel into the star tunnel and the last big sweeper.
  walls: [
    { from: at('e1a') + 1, to: at('e1b') - 1, side: 'outer' },
    { from: at('forkB') + 0.6, to: at('pipeE'), side: 'outer' },
    { from: at('c1') + 1.5, to: at('c2') - 1.5, side: 'outer' },
    { from: along('tunnelMouth', -46), to: at('tunnelMouth'), side: 'both' },
    { from: at('sweep1') + 1, to: at('sweep1') + 5, side: 'outer' },
  ],
  ramps: [
    // Low ramps and short gaps: the flight at a boosted 44 m/s still lands on the apron or just past it (see the tests).
    { at: at('jump1'), length: 10, height: 1.4, gap: JUMP1_GAP, gapKind: 'void', shape: 'kicker' },
    ...waves,
    { at: at('jump2'), length: 10, height: 1.4, gap: JUMP2_GAP, gapKind: 'void', shape: 'kicker' },
  ],
  boostPads,
  laps: 3,
  checkpoints: 11, // (even spacing, ~153 m: no checkpoint lies on a ramp, in a jump gap or within 50 m before one; the jump after the star tunnel respawns before the tunnel)
  itemRowSpacing: 120,
  scenery: { seed: 71, trees: 0, buildings: 0, rainbow: { seed: 7 } },
  theme: { grass: '#1b1650', offroad: '#2a2266', sky: '#0b0c3c', horizon: '#3d2a7c', mood: 'space' },
  // (Terrain only exists because the fork's branch needs it; the ground beside the ribbon is gone: see `cliffs`.)
  terrain: { blend: 4 },
  // The ground ENDS at the edge of the road, all round the lap (two overlapping stretches so no taper shows). The fork's
  // high line is a deck with ground of its own, so the main ribbon has no ground beside it there either.
  cliffs: [
    { from: FORK_TO + 0.5, to: FORK_FROM - 0.5, side: 'both', edge: RIBBON_WIDTH / 2 + 1.2 + 0.6 },
    { from: FORK_FROM - 0.5, to: FORK_TO + 0.5, side: 'both', edge: RIBBON_WIDTH / 2 + 1.2 + 0.6 },
  ],
  cannons: [
    // The star tunnel. Mouth at the end of the ribbon, landing on the high ribbon 36 m up.
    { at: at('tunnelMouth'), offset: 0, target: { at: at('tunnelLand') + 0.3 }, flightTime: 2.0, apex: 12, mandatory: true },
  ],
  shortcuts: [
    {
      from: FORK_FROM,
      to: FORK_TO,
      points: FORK_POINTS,
      width: RIBBON_WIDTH,
      deck: true,
      hold: true,
      surface: 'road',
    },
  ],
};
