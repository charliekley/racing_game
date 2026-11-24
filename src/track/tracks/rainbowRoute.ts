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
export const TUNNEL_GAP = 112;
/** Gap lengths (m) of the two jumps. */
export const JUMP1_GAP = 14;
export const JUMP2_GAP = 15;
/** Start/landing heights are set by the route; this is how much higher the star tunnel puts the high ribbon (m). */
export const TUNNEL_CLIMB = 28;

const t = new Turtle(0, 0, Y0, 90).mark('start');

// ---- 1. Launch run: pads on the grid, an S-bend, then the first kicker ----
t.turn(80, 18, -0.25).turn(80, -18, -0.25).mark('run'); // (nothing is dead straight: every straight is a gentle S)
t.turn(48, 40, -1).turn(48, -80, -1.5).turn(48, 40, -1).mark('esses1');
t.line(26, 0).mark('jump1'); // the kicker (see `ramps`): 11 m ramp, 14 m of nothing, a 10 m landing apron
t.turn(80, 18, -0.4).turn(80, -18, -0.4).mark('land1');
t.turn(48, -36, -0.5).turn(48, 72, -0.5).turn(48, -36, -0.5).mark('esses1b'); // the second S, bending the other way round

// ---- 2. The fork: main ribbon bends right then left; the high line is on the left (inside) ----
t.line(30, -0.4).mark('forkA');
t.turn(130, 26, -0.6).turn(130, -26, -0.6);
t.turn(90, 16, -0.2).turn(90, -16, -0.2).mark('forkB');
t.line(10, -0.2);

// ---- 3. East curl: a wide half-pipe in two quarters, strongly banked (the bank follows the curvature, see bankPerCurvature) ----
t.turn(50, -90, -2.2).mark('pipeE');
t.turn(80, 18, -0.15).turn(80, -18, -0.15).mark('pipeMid'); // (the straight between the quarters: pads, and room to breathe)
t.turn(50, -90, -2.2);
t.turn(80, 18, -0.25).turn(80, -18, -0.25).mark('padN'); //                      boost pads on the way out
// ---- 4. Wave road (westbound): a field of bumps on a long, easy bend ----
t.turn(100, 20, 0.3).turn(100, -40, 0.5).turn(100, 20, 0.4).mark('waves'); //(the wave road: 6 humps on a snaking road)
t.line(2, 0).mark('wavesEnd');
// ---- 5. The climb: one big S-bend ----
t.turn(52, 50, 4).turn(52, -100, 9).turn(52, 50, 5).mark('climbTop');
t.line(14, 1.2).mark('tunnelIn');
// ---- 6. Star tunnel: the road ends at the launch pad; 124 m of sky; the high ribbon starts at the landing ----
t.line(26, 1).mark('tunnelMouth');
t.line(TUNNEL_GAP, TUNNEL_CLIMB).mark('tunnelLand'); // (a straight line across the gap: nobody drives these points)
t.line(18, 0).mark('highStart');
// ---- 7. High ribbon: S-bends, then the double kicker, then the long descent ----
t.turn(44, -45, -4).turn(44, 90, -6).turn(44, -45, -4).mark('highEsses');
t.line(30, -1.5).mark('jump2');
t.turn(80, 18, -0.75).turn(80, -18, -0.75).mark('land2');

/** The pose the turtle stands in. */
const here = () => ({ x: t.x, z: t.z, heading: t.heading });

// ---- 8. Sky sweep: whatever it takes to come back to the start line heading east ----
/**
 * Close the lap: a circle arc, a straight, then a second circle arc (same radius, same side) that ends 60 m before the
 * start line heading east. Returns the three lengths. Throws if the numbers do not allow it (then change the route above).
 */
function closeTo(radius: number, targetX: number, targetZ: number, targetHeading: number): { a1: number; len: number; a2: number } {
  const p = here();
  let best: { a1: number; len: number; a2: number; total: number } | null = null;
  for (const side of [-1, 1]) {
    // Centres of the first and the last circle (the centre is `radius` to the right of the heading for a right turn).
    const c1 = { x: p.x + side * radius * Math.cos(rad(p.heading)), z: p.z - side * radius * Math.sin(rad(p.heading)) };
    const c2 = { x: targetX + side * radius * Math.cos(rad(targetHeading)), z: targetZ - side * radius * Math.sin(rad(targetHeading)) };
    const dx = c2.x - c1.x;
    const dz = c2.z - c1.z;
    const len = Math.hypot(dx, dz);
    const theta = (Math.atan2(dx, dz) * 180) / Math.PI; // compass heading of the straight between the circles
    const wrap = (d: number) => ((((d * side) % 360) + 360) % 360) * side; // turn through d in the direction `side`, 0..360
    const a1 = wrap(theta - p.heading);
    const a2 = wrap(targetHeading - theta);
    const total = Math.abs(a1) + Math.abs(a2) + (len / radius) * (180 / Math.PI);
    if (!best || total < best.total) best = { a1, len, a2, total };
  }
  return best!;
}

const END_X = -60; // the road arrives heading east at x = -60: a 60 m straight to the start line (and the grid behind it)
const CLOSE_R = 58;
const close = closeTo(CLOSE_R, END_X, 0, 90);
{
  const rest = t.y - Y0; // height still to lose
  const total = arcLen(CLOSE_R, close.a1) + close.len + arcLen(CLOSE_R, close.a2);
  const drop = (len: number) => (-rest * len) / total;
  if (Math.abs(close.a1) > 1) t.turn(CLOSE_R, close.a1, drop(arcLen(CLOSE_R, close.a1))).mark('sweep1');
  if (close.len > 1) t.line(close.len, drop(close.len)).mark('sweep2');
  if (Math.abs(close.a2) > 1) t.turn(CLOSE_R, close.a2, drop(arcLen(CLOSE_R, close.a2))).mark('sweep2');
  t.turn(120, 14.5, 0).turn(120, -14.5, 0); // the last 60 m: a gentle S onto the start straight (it ends exactly on the start line)
}

const route: RoutePoint[] = t.route;
// The last point is the start again (the loop closes by itself): drop the duplicate.
if (Math.hypot(route[route.length - 1].p[0] - route[0].p[0], route[route.length - 1].p[1] - route[0].p[1]) < 1.5) route.pop();
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
  pad('esses1b', 14), //                     out of the S-bend
  pad('land1', 14, true), //                  after the first jump
  // The fork's main ribbon: a row of pads (the branch has none).
  pad('forkA', 16, true, -0.3),
  pad('forkA', 60, false, 0.3),
  pad('forkA', 110, true, 0),
  pad('padN', 0, true, 0),
  pad('padN', 14, false, 0.3),
  pad('wavesEnd', 0, true),
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
const waves = [0, 1, 2, 3, 4, 5].map((k) => ({ at: along('waves', 24 + k * 18), length: 10, height: 1.15, shape: 'hump' as const }));

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
    [52, -26, 0.3],
    [96, -34, 1.8],
    [140, -28, 1.2],
    [178, -17, 0],
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
  checkpoints: 20,
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
    { at: at('tunnelMouth'), offset: 0, target: { at: at('tunnelLand') + 0.3 }, flightTime: 3.5, apex: 16, mandatory: true },
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
