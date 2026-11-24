/**
 * Track: "Rainbow Route" – a narrow, glowing, translucent ribbon road floating in space far above a planet (about 1.9 km).
 *
 * There is no ground anywhere: the ribbon is all there is, and the few rails stand only on the hardest corners.
 * Step off the edge and you fall into the void; the carrier drone fetches you (the usual respawn rule).
 *
 * The lap runs anticlockwise (north = +z, east = +x; the start line is at the west end of the south edge, heading east):
 *
 *   1. LAUNCH RUN  (y 72 -> 66)   a boost pad on the grid, a flowing S-bend, then a KICKER over a 14 m gap in the ribbon.
 *   2. THE FORK    (y 66 -> 64)   the ribbon splits in two. The main ribbon keeps its boost pads (and a star-ring arch);
 *                                 the high-line branch to the left is a little shorter but has no pads. They rejoin.
 *   3. EAST CURL   (y 64 -> 59)   a wide, strongly banked half-pipe turn through 180 degrees, boost pad on the way out.
 *   4. WAVE ROAD   (y 59 -> 62)   westbound: a row of trick bumps ("waves"), then
 *   5. CLIMB       (y 62 -> 80)   a long climbing S-bend with boost pads on its crests.
 *   6. STAR TUNNEL (y 80 -> 108)  the ribbon ends at a glowing launch pad: a tube of star rings fires every kart
 *                                 along an arc and sets it down on the high ribbon 28 m up (a mandatory cannon).
 *   7. HIGH RIBBON (y 108 -> 82)  S-bends and a DOUBLE KICKER over a 15 m gap, then a long sweeping descent
 *   8. SKY SWEEP   (y 82 -> 72)   the long banked sweeper that comes down to the start line.
 *
 * Like Mushroom Valley the route is written with a turtle (src/track/turtle.ts): every bend is an exact circle arc, so
 * the radius (>= 40 m everywhere: the bots never have to brake for a bend on a road with no rails) is known and the lap can
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
export const TUNNEL_GAP = 120;
/** Gap lengths (m) of the two jumps. */
export const JUMP1_GAP = 14;
export const JUMP2_GAP = 15;
/** Start/landing heights are set by the route; this is how much higher the star tunnel puts the high ribbon (m). */
export const TUNNEL_CLIMB = 26;

const t = new Turtle(0, 0, Y0, 90).mark('start');

// ---- 1. Launch run: pads on the grid, an S-bend, then the first kicker ----
t.turn(80, 18, -0.25).turn(80, -18, -0.25).mark('run'); // (nothing is dead straight: every straight is a gentle S)
t.turn(38, 45, -1).turn(38, -90, -1.5).turn(38, 45, -1).mark('esses1');
t.line(26, 0).mark('jump1'); // the kicker (see `ramps`): 11 m ramp, 14 m of nothing, a 10 m landing apron
t.turn(50, 22, -0.4).turn(50, -22, -0.4).mark('land1');
t.turn(40, -30, -0.4).turn(40, 60, -0.4).turn(40, -30, -0.4).mark('esses1b'); // a quick left-right-left

// ---- 2. The fork: main ribbon bends right then left; the high line is on the left (inside) ----
t.line(30, -0.4).mark('forkA');
t.turn(60, 36, -0.6).turn(60, -36, -0.6);
t.turn(50, 22, -0.2).turn(50, -22, -0.2).mark('forkB');
t.line(10, -0.2);

// ---- 3. East curl: a wide half-pipe in two quarters, strongly banked (the bank follows the curvature, see bankPerCurvature) ----
t.turn(46, -90, -2.2).mark('pipeE');
t.turn(50, 22, -0.15).turn(50, -22, -0.15).mark('pipeMid'); // (the straight between the quarters: pads, and room to breathe)
t.turn(46, -90, -2.2);
t.turn(40, 30, -0.25).turn(40, -30, -0.25).mark('padN'); //                      boost pads on the way out
// ---- 4. Wave road (westbound): a field of bumps on a long, easy bend ----
t.line(10, 0).mark('waves'); // (the wave road: 6 humps on a long easy S: karts fly the bumps flat out, so no tight bend and no boost pad here)
t.turn(150, 12, 0.3).turn(150, -24, 0.5).turn(150, 12, 0.4).mark('wavesEnd');
// ---- 5. The climb: one big S-bend ----
t.turn(34, 50, 3).turn(34, -100, 7).turn(34, 50, 4).mark('climbTop');
t.line(14, 1.2).mark('tunnelIn');
// ---- 6. Star tunnel: the road ends at the launch pad; 124 m of sky; the high ribbon starts at the landing ----
t.line(26, 1).mark('tunnelMouth');
t.line(TUNNEL_GAP, TUNNEL_CLIMB).mark('tunnelLand'); // (a straight line across the gap: nobody drives these points)
t.turn(50, 22, 0).turn(50, -22, 0).mark('highStart');
// ---- 7. High ribbon: the double kicker right after the landing, then S-bends and the long descent ----
t.turn(50, 22, 0).turn(50, -22, 0).mark('highStart');
t.line(34, -1.5).mark('jump2');
t.turn(50, 22, -0.75).turn(50, -22, -0.75).mark('land2');
t.turn(32, -45, -2).turn(32, 90, -3).turn(32, -45, -2).mark('highEsses');

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
  if (close.len > 0.01) t.line(close.len, drop(close.len)).mark('sweep2');
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
  pad('esses1', 30), //                     out of the S-bend
  pad('land1', 14, true), //                  after the first jump
  // The fork's main ribbon: a row of pads (the branch has none).
  pad('forkA', 16, true, -0.3),
  pad('forkA', 60, false, 0.3),
  pad('forkA', 110, true, 0),
  pad('padN', 0, true, 0),
  pad('padN', 14, false, 0.3),
  pad('wavesEnd', 14, true),
  pad('climbTop', 6, true),
  pad('climbTop', 40, false, -0.3),
  pad('tunnelIn', 20, false),
  pad('tunnelIn', 52, false),
  pad('highStart', 4, true),
  pad('highEsses', 4, false, 0.3),
  pad('land2', 12, true),
  pad('pipeMid', 12, true),
  pad('sweep1', 40, false, -0.3),
  pad('sweep2', 30, true),
];

/** Waves: a row of smooth humps (trick bumps) over 6 x 18 m. */
const waves = [0, 1, 2, 3, 4, 5].map((k) => ({ at: along('waves', 14 + k * 18), length: 12, height: 0.8, shape: 'hump' as const }));

// ---------------------------------------------------------------------------
// The track
// ---------------------------------------------------------------------------

const FORK_FROM = along('forkA', 6);
const FORK_TO = along('forkB', 0);

/**
 * The high line of the fork: leaves the main ribbon on the left, swings out to about 28 m beside it and comes back. Its
 * height is the main ribbon's own height at the point beside it, so it can never cut a step into the road.
 */
const FORK_POINTS = (
  [
    [34, -22, 0.3],
    [64, -31, 1.6],
    [94, -24, 0.8],
  ] as const
).map(([ds, lat, dy]) => {
  const p = local('forkA', ds, lat);
  return [p.x, p.z, p.y + dy] as [number, number, number];
});

export const rainbowRoute: TrackDef = {
  name: 'Rainbow Route',
  blurb: 'A narrow, glowing ribbon road in space: boost-pad arches, a banked half-pipe, trick waves, a split ribbon and a star tunnel that fires you up to the high road.',
  points,
  width: 14,
  offroadWidth: 2,
  bankPerCurvature: 16,
  maxBankDeg: 20,
  // Rails ONLY on the hardest corners: the half-pipe (outside), the funnel into the star tunnel and the last big sweeper.
  walls: [
    { from: at('forkB') + 0.6, to: at('pipeE'), side: 'outer' },
    { from: along('tunnelMouth', -46), to: at('tunnelMouth'), side: 'both' },
    { from: at('sweep1') + 1, to: at('sweep1') + 5, side: 'outer' },
  ],
  ramps: [
    { at: at('jump1'), length: 11, height: 2.4, gap: JUMP1_GAP, gapKind: 'void', shape: 'kicker' },
    ...waves,
    { at: at('jump2'), length: 16, height: 2.2, gap: JUMP2_GAP, gapKind: 'void', shape: 'double' },
  ],
  boostPads,
  laps: 3,
  checkpoints: 12, // (even spacing, ~135 m: every respawn point has a run-up of 55 m or more to the two jumps, and none lies on a ramp or in a gap)
  itemRowSpacing: 120,
  scenery: { seed: 71, trees: 0, buildings: 0, rainbow: { seed: 7 } },
  theme: { grass: '#1b1650', offroad: '#2a2266', sky: '#0b0c3c', horizon: '#3d2a7c', mood: 'space' },
  // (Terrain only exists because the fork's branch needs it; the ground beside the ribbon is gone: see `cliffs`.)
  terrain: { blend: 4 },
  // The ground ENDS at the edge of the road, all round the lap (two overlapping stretches so no taper shows), except on the
  // left of the fork, where the high line leaves and rejoins.
  cliffs: [
    { from: FORK_TO + 0.5, to: FORK_FROM - 0.5, side: 'both', edge: 7 + 1.2 + 0.6 },
    { from: FORK_FROM - 0.5, to: FORK_TO + 0.5, side: 'right', edge: 7 + 1.2 + 0.6 },
  ],
  cannons: [
    // The star tunnel. Mouth at the end of the ribbon, landing on the high ribbon 28 m up.
    { at: at('tunnelMouth'), offset: 0, target: { at: at('tunnelLand') + 0.3 }, flightTime: 2.2, apex: 11, mandatory: true },
  ],
  shortcuts: [
    {
      from: FORK_FROM,
      to: FORK_TO,
      points: FORK_POINTS,
      width: 11,
      deck: true,
      hold: true,
      surface: 'road',
    },
  ],
};
