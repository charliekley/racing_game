/**
 * Track: "Mushroom Valley" – a mountain trail over deep, cloudy gorges (about 1.8 km).
 *
 * Giant mushrooms rise out of the gorges. ORANGE caps are trampolines: touch one and you are thrown along a big
 * arc onto the next cap or the far road (see src/sim/bouncers.ts for the rules). GREEN caps are solid: drive across
 * them like a bridge. Fall into a gorge and the carrier drone fetches you, like any other drop.
 *
 * The whole lap is a mountain road (north = +z, east = +x; the start line is at the foot of the mountain, heading east):
 *
 *   1. FOOTHILLS   (y 30)       a short warm-up through three bends, boost pad.
 *   2. SWITCHBACKS (30 -> 77)   three hairpins up the east face on a rock ledge (the cliff drops away on the outside
 *                               of every bend), the legs between them as steep as 15 %.
 *   3. SKY LEAP    (y 77 -> 73) a ridge road with a drop on both sides, then a 50 m gorge with ONE huge orange cap: a
 *                               single big floaty bounce (apex 9 m) lands you on the far side.
 *   4. STEPPING STONES (73)     the ridge winds on, then a 62 m gorge crossed on a snaking path of GREEN caps.
 *   5. TWIN SPANS  (72)         a road down the west face. The gorge has a CHOICE: the main road crosses on a long
 *                               green bridge; a rough dirt shortcut leaves to the left and hops over the same gorge on
 *                               three ORANGE caps (shorter, a trick on the last hop pays out a boost).
 *   6. THE CAVE    (68 -> 58)   a long bend into a huge glowing cave. The chasm inside has TWO ROUTES again: the main
 *                               road on green caps, or a dirt shortcut on a chain of five orange caps.
 *   7. DESCENT     (58 -> 30)   a fast run down the mountain (slopes up to 15 %) back to the foothills.
 *
 * HOW THE ROUTE IS WRITTEN: with a "turtle". A turtle stands on the road, heading somewhere, and obeys commands:
 * `line(len, dy)` drives straight, `turn(r, deg, dy)` drives a circle arc (positive = right turn, negative = left),
 * `mark(name)` names the point it stands on. The turtle writes the control points [x, z, height] for us, so every bend
 * is an exact circle arc with a known radius (which keeps the weight classes balanced: no bend is too tight for the
 * bots) and the mountain can be re-shaped by changing a few numbers. Caps and shortcuts are placed with `local()`:
 * "so many metres further along the road, so many metres to the right of it", which follows the road round its bends.
 */
import type { CapDef, TrackDef } from '../types';
import { Turtle, arcDeg, type RoutePoint } from '../turtle';

/** Gorge lengths (m): from the named point where the road ends to where it starts again. */
export const G1_LEN = 50;
export const G2_LEN = 62;
export const G3_LEN = 84;
export const CAVE_LEN = 126;


// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

const t = new Turtle(0, 0, 30, 90).mark('start');

// ---- 1. Foothills: a short warm-up through three bends, boost pad on the way to the first hairpin ----
t.line(8, 0.3).turn(80, 15, 0.2).turn(80, -24, 0.3).turn(80, 9, 0.2).line(6, 0.2).mark('foot');
// ---- 2. Switchbacks up the east face: three hairpins (left, right, left), steep legs between ----
t.turn(30, -180, 8.5).mark('hair1'); //  left hairpin: the cliff drops away on its outside (south)
t.wiggle(50, 7.5, 21).mark('leg2'); //   15 % climb, a gentle S
t.turn(30, 180, 8.5).mark('hair2'); //    right hairpin
t.wiggle(50, 7.0, 21).mark('leg3'); //   14 % climb
t.turn(30, -180, 8.5).mark('crest'); //   left hairpin: the crest, heading west
// ---- 3. Sky Leap: the ridge road (a drop on both sides) and ONE huge bounce over a 50 m gorge ----
t.line(19, 0); // a stretch of ridge (keeps everything from the Twin Spans on exactly where the mountain was built for it)
t.turn(200, 5, 0).mark('ridge1').turn(200, 5, 0).mark('g1a'); //  boost pad on the approach
t.turn(200, -arcDeg(G1_LEN, 200), -2.5).mark('g1b'); //   the far side is 2.5 m lower: a long floaty descent
t.turn(200, arcDeg(G1_LEN, 200) - 10, -1.5).mark('g1c');
t.turn(150, 6, -0.5).mark('g1end').turn(150, -6, -0.5); // the ridge winds
// ---- 4. Stepping Stones: a gorge crossed on a path of green caps ----
t.turn(170, 8, -0.2).mark('g2pre');
t.turn(170, 4, -0.1).mark('g2a');
t.turn(170, -arcDeg(G2_LEN, 170), -1.5).mark('g2b');
t.turn(170, arcDeg(G2_LEN, 170) - 12, -0.5).mark('g2end');
// ---- 5. Twin Spans: round the corner and down the west face to the gorge with the choice ----
t.turn(36, -90, -1.5).mark('turnSouth');
t.line(14, -0.3);
t.turn(200, 5, -0.2).mark('g3fork'); //  the dirt shortcut leaves here (about 36 m before the gorge)
t.turn(200, 5, -0.2).turn(200, 5, -0.2).mark('g3a'); //     the gorge: 84 m
t.turn(200, -arcDeg(G3_LEN, 200), -2).mark('g3b');
t.turn(200, arcDeg(G3_LEN, 200) - 9, -0.3); //            back to heading south...
t.turn(200, -6, -0.3).mark('g3join'); //                  ...and the shortcut rejoins
// ---- 6. The cave: the road bends into a huge glowing cave; the chasm inside has two routes ----
t.line(12, -0.4);
t.turn(200, -5, -0.2).mark('caveFork'); // the dirt shortcut leaves here
t.turn(200, -5, -0.2).turn(200, -5, -0.2).mark('caveIn'); //  the chasm: 126 m (an S-bend inside)
t.turn(200, arcDeg(CAVE_LEN / 2, 200), -1);
t.turn(200, -arcDeg(CAVE_LEN / 2, 200), -1).mark('caveOut');
t.turn(200, 15, -0.4).mark('caveEnd'); //                  ...and the shortcut rejoins
t.turn(40, -90, -1.5).mark('turnEast'); // the road comes out of the mountain heading east
// ---- 7. Descent: up the mountain side, two sweeping S-bends, then a right turn that closes the lap at the start line ----
{
  const total = t.y - 30; // the height still to lose
  // Sweeping S-bends (radius 70 to 120 m: bends you carve, not a straight you wait out), with a dip and a crest between them.
  const sBend = (r: number, side: 1 | -1, deg: number, dy: number) => t.turn(r, side * deg, dy / 2).turn(r, -side * deg, dy / 2);
  t.turn(36, -90, -0.1 * total).mark('chuteTop');
  sBend(90, 1, 26, -0.25 * total).mark('chute');
  sBend(110, -1, 20, -0.15 * total);
  sBend(80, 1, 18, -0.1 * total).mark('chuteS3');
  // The last turn is a circle arc whose radius is whatever puts its end exactly 34 m before the start line.
  const r = -34 - t.x;
  const run = -t.z - r; // metres to drive straight north before it
  if (run < 0 || r < 28) throw new Error(`mushroomValley: the lap does not close (run ${run.toFixed(0)}, r ${r.toFixed(0)}; at ${t.x.toFixed(0)}, ${t.z.toFixed(0)})`);
  const rest = t.y - 30; // what is left to lose, spread evenly over the last stretch
  const lenRun = run;
  const lenTurn = (Math.PI / 2) * r;
  t.line(run, (-rest * lenRun) / (lenRun + lenTurn)).mark('chuteBend');
  t.turn(r, 90, (-rest * lenTurn) / (lenRun + lenTurn)).mark('chuteEnd');
}

const route: RoutePoint[] = t.route;
const points = route.map((r) => r.p);

/** Position of a named point, in control-point units (what every feature below wants). */
export function at(name: string): number {
  const i = route.findIndex((r) => r.name === name);
  if (i < 0) throw new Error(`mushroomValley: no point named "${name}"`);
  return i;
}

/**
 * A spot on the road's own coordinates: `ds` metres further along the road from the named point and `lat` metres to
 * the right of the centre line (negative = left). Returns world x, z and the road height there. (Straight-line
 * interpolation between the control points: close enough, they are about 24 m apart.)
 */
export function local(name: string, ds: number, lat = 0): { x: number; z: number; y: number } {
  let i = at(name);
  let remaining = ds;
  const seg = (k: number) => {
    const a = route[k].p;
    const b = route[(k + 1) % route.length].p;
    return { a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  };
  while (remaining > seg(i).len) {
    remaining -= seg(i).len;
    i = (i + 1) % route.length;
  }
  const { a, b, len } = seg(i);
  const u = remaining / len;
  const dx = (b[0] - a[0]) / len;
  const dz = (b[1] - a[1]) / len;
  // right-hand normal of a heading (dx, dz) is (dz, -dx)
  return { x: a[0] + (b[0] - a[0]) * u + dz * lat, z: a[1] + (b[1] - a[1]) * u - dx * lat, y: a[2] + (b[2] - a[2]) * u };
}

// ---------------------------------------------------------------------------
// Mushroom caps
// ---------------------------------------------------------------------------

const G1 = G1_LEN;
const G2 = G2_LEN;
const G3 = G3_LEN;
const CAVE = CAVE_LEN;

const caps: CapDef[] = [];
/** Add a cap and return its index (so an earlier cap can aim at a later one). */
const add = (c: CapDef): number => caps.push(c) - 1;

// SKY LEAP: ONE huge orange cap on the lip of the gorge. It throws you across the whole gap in a single, long, floaty
// arc (1.8 s in the air, apex about 9 m, landing on the far road 4 m lower).
add({ kind: 'orange', radius: 11, at: at('g1a'), ds: 7, dy: -0.4, air: 1.8, to: { at: at('g1a'), ds: G1 + 12 } });
// STEPPING STONES: a snaking path of big green caps (they overlap, so it is one continuous bridge).
for (let k = 0; k < 5; k++) {
  const off = [0, 4.5, -3.5, 3.5, 0][k];
  add({ kind: 'green', radius: 9.5, at: at('g2a'), ds: 6 + k * 12.5, offset: off, dy: 0 });
}
// TWIN SPANS, main route: a long snaking bridge of green caps.
for (let k = 0; k < 7; k++) {
  const off = [0, -4, 0, 4, 0, -4, 0][k];
  add({ kind: 'green', radius: 10, at: at('g3a'), ds: 6 + k * 12.5, offset: off, dy: 0 });
}
/**
 * Time in the air of an orange hop from `a` to `b`: the shortcut hops are flown at about SHORTCUT_SPEED (faster than the
 * 28 m/s a kart drives, which is what makes the orange route quicker when flown well), but never shorter than 0.85 s (apex >= 2.5 m).
 */
const SHORTCUT_SPEED = 42;
const hopAir = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.max(0.85, Math.round((Math.hypot(b.x - a.x, b.z - a.z) / SHORTCUT_SPEED) * 100) / 100);
// TWIN SPANS, shortcut: three orange caps beside the gorge on the left, hop by hop (6 hops-worth of air each).
export const G3_SIDE = -27; // metres to the left of the main road
const G3_LAND = G3 + 22; // where the last hop lands (metres along from the gorge start)
const G3_CAPS = [10, 46, 82].map((ds) => local('g3a', ds, G3_SIDE));
{
  const first = caps.length;
  const land = local('g3a', G3_LAND, G3_SIDE);
  G3_CAPS.forEach((c, k) => {
    const last = k === G3_CAPS.length - 1;
    const to = last ? land : G3_CAPS[k + 1];
    add({ kind: 'orange', radius: 8.5, x: c.x, z: c.z, y: c.y - 0.4, air: hopAir(c, to), to: last ? { x: land.x, z: land.z } : first + k + 1 });
  });
}
// THE CAVE, main route: green caps all the way (a bit wider apart in the middle).
for (let k = 0; k < 9; k++) {
  const off = [0, 3, 0, -3, 0, 3, 0, -3, 0][k];
  add({ kind: 'green', radius: 10.5, at: at('caveIn'), ds: 5 + k * 14, offset: off, dy: 0 });
}
// THE CAVE, second route (the dirt shortcut on the right): orange caps on the branch's own line.
export const CAVE_SIDE = 30; // metres to the right of the main road
const CAVE_LAND = CAVE + 18; // where the last hop lands
export const ORANGE_ROUTE = [4, 44, 84, 124].map((ds) => {
  const c = local('caveIn', ds, CAVE_SIDE);
  return { x: c.x, z: c.z, y: c.y - 0.6 };
});
{
  const first = caps.length;
  const exit = local('caveIn', CAVE_LAND, CAVE_SIDE);
  ORANGE_ROUTE.forEach((c, k) => {
    const last = k === ORANGE_ROUTE.length - 1;
    add({ kind: 'orange', radius: 8, x: c.x, z: c.z, y: c.y, air: hopAir(c, last ? exit : ORANGE_ROUTE[k + 1]), to: last ? { x: exit.x, z: exit.z } : first + k + 1 });
  });
}

// ---------------------------------------------------------------------------
// The mountain
// ---------------------------------------------------------------------------

/** A smooth bump of the terrain (see TerrainDef.features). */
type Bump = { x: number; z: number; radius: number; height: number };
/** The bump's weight at an offset (dx, dz) from its centre: 1 at the top, 0 at the rim (the same formula as Terrain.natural). */
const w2 = (dx: number, dz: number, radius: number): number => {
  const u = 1 - (dx * dx + dz * dz) / (radius * radius);
  return u > 0 ? u * u : 0;
};

/**
 * The ground under the road is a sum of smooth bumps. We place one bump every ~50 m along the lap and fit its height
 * so that the natural ground lies a few metres BELOW the road (the road then sits on a ledge cut into the mountain
 * and the land falls away to the valleys), with a few jacked-up values on the outside of the hairpins.
 */
function massif(radius: number, below: number, extra: { x: number; z: number; y: number }[], base: Bump[]): Bump[] {
  const anchors: { x: number; z: number; y: number }[] = [...extra];
  let acc = 0;
  for (let i = 0; i < route.length; i++) {
    const a = route[i].p;
    const b = route[(i + 1) % route.length].p;
    acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (i === 0 || acc >= 30) {
      anchors.push({ x: a[0], z: a[1], y: a[2] });
      acc = 0;
    }
  }
  const w = (dx: number, dz: number) => w2(dx, dz, radius);
  // What the broad bumps (the foothills and the far peaks) already add under each anchor.
  const baseAt = (x: number, z: number) => base.reduce((sum, f) => sum + f.height * w2(x - f.x, z - f.z, f.radius), 0);
  const goal = anchors.map((a) => a.y - below - baseAt(a.x, a.z));
  const h = goal.map((g) => Math.max(0, g));
  // Jacobi iterations: shrink each bump by what its neighbours already add there.
  for (let it = 0; it < 30; it++) {
    const next = anchors.map((a, i) => {
      let others = 0;
      for (let j = 0; j < anchors.length; j++) if (j !== i) others += h[j] * w(a.x - anchors[j].x, a.z - anchors[j].z);
      return Math.max(0, h[i] + 0.7 * (goal[i] - others - h[i]));
    });
    for (let i = 0; i < h.length; i++) h[i] = next[i];
  }
  return anchors.map((a, i) => ({ x: a.x, z: a.z, radius, height: h[i] })).filter((f) => f.height > 0.5);
}

/**
 * The big, far landforms: a broad foothill under the whole course and a ring of peaks all round it (well clear of every
 * road: the nearest is over 150 m away), so the mountain stands in mountain country, not on a flat plain.
 */
const FOOTHILLS: Bump[] = [
  { x: 0, z: -60, radius: 620, height: 6 }, // (low: the cloud sea hides the valleys, the course stands high above)
  { x: 470, z: -40, radius: 190, height: 70 },
  { x: 450, z: 230, radius: 170, height: 85 },
  { x: 150, z: 480, radius: 190, height: 80 },
  { x: -220, z: 430, radius: 180, height: 95 },
  { x: -520, z: 120, radius: 200, height: 85 },
  { x: -500, z: -250, radius: 190, height: 90 },
  { x: -170, z: -560, radius: 200, height: 80 },
  { x: 240, z: -480, radius: 190, height: 70 },
];

/** Spots beside the road where the dirt shortcuts run: the mountain has to carry them too (see `massif`). */
const shortcutAnchors = [
  ...[-20, 105, 125].map((ds) => local('g3a', ds, G3_SIDE)), // the landing ledge of the Twin Spans shortcut (a pillar: see `valleyKeep`)
  ...[-30, -5, 150, 175].map((ds) => local('caveIn', ds, CAVE_SIDE)),
];

/** A pit (negative bump) round a point: the gorges' floors, deep below everything. */
const pit = (p: { x: number; z: number }, radius: number, depth = 110) => ({ x: p.x, z: p.z, radius, height: -depth });

/** The cave pit: holes along the cave's chasm, wide enough for both routes (the main road and the right-hand shortcut). */
const cavePits = [0, 1, 2].map((k) => pit(local('caveIn', 30 + k * 40, CAVE_SIDE), 42, 130));
// (The gorges themselves are `terrain.valleys`: the ground is carved away beside the road, so no pits are needed.)

// ---------------------------------------------------------------------------
// The track
// ---------------------------------------------------------------------------

/** Control-point units (about 24 m each) between a branch's junction and the first / last piece of fence beside it. */
const BRANCH_GAP = 1.6;

export const mushroomValley: TrackDef = {
  name: 'Mushroom Valley',
  blurb: 'A mountain trail up switchbacks and along misty ridges: bounce across orange mushroom trampolines, cross on green caps, and pick a route through the glowing cave.',
  points,
  width: 14,
  offroadWidth: 6,
  bankPerCurvature: 4,
  maxBankDeg: 8,
  walls: [
    // Rope-fence walls on the outside of every ledge and on both sides of the ridges (the same stretches as `cliffs`).
    { from: at('foot'), to: at('hair1'), side: 'right' },
    { from: at('hair1'), to: at('hair2'), side: 'left' },
    { from: at('hair2'), to: at('crest'), side: 'right' },
    { from: at('ridge1'), to: at('g1a'), side: 'both' },
    { from: at('g1b'), to: at('g1end'), side: 'both' },
    { from: at('g2pre'), to: at('g2a'), side: 'both' },
    { from: at('g2b'), to: at('g2end'), side: 'both' },
    // (The fences stop short of both ends of each orange branch: the dirt path crosses the verge there, so the opening
    // must be clear, no rope and no collision wall across it; `BRANCH_GAP` metres is where the path has left / not yet joined.)
    { from: at('g3fork') + BRANCH_GAP, to: at('g3a'), side: 'right' },
    { from: at('g3b'), to: at('g3join') - BRANCH_GAP, side: 'right' },
    { from: at('caveFork') + BRANCH_GAP, to: at('caveIn'), side: 'left' },
    { from: at('caveOut'), to: at('caveEnd') - BRANCH_GAP, side: 'left' },
  ],
  // A small rock kicker on the way down (a smooth crest, no gap: a trick off it pays a boost) in the S-bends that replaced the long run-in.
  ramps: [{ at: at('chute') + 0.5, length: 9, height: 1.2, shape: 'hump' }],
  boostPads: [
    { at: at('foot') - 0.4, offset: 0, length: 8, width: 5 }, // up the first climb
    { at: at('ridge1') + 0.4, offset: 0, length: 8, width: 5 }, // speed into the Sky Leap
    { at: at('g2pre') - 0.2, offset: 0, length: 8, width: 5 }, // ...and into the green bridge
    { at: at('turnEast') + 0.4, offset: 0, length: 8, width: 5 }, // into the cave
    { at: at('chuteTop') + 1.2, offset: 0, length: 8, width: 5 }, // down the chute
  ],
  laps: 3,
  checkpoints: 20,
  itemRowSpacing: 160, // eleven rows of boxes about 158 m apart: one before and one after every crossing
  scenery: {
    seed: 61,
    trees: 320,
    buildings: 0,
    mushroom: {
      gorges: [
        { from: at('g1a'), to: at('g1b') },
        { from: at('g2a'), to: at('g2b') },
        { from: at('g3a'), to: at('g3b') },
      ],
      cave: { from: at('caveIn'), to: at('caveOut'), halfWidth: 58, roof: 46, offset: -CAVE_SIDE * 0.42 }, // the vault is centred between the main road and the orange route (NB: `offset` is in the track's own lateral axis `d`, which is the opposite of `local()`'s `lat`: the route at local lat +30 is at d -30)
      glow: 130,
    },
  },
  theme: { grass: '#5f8a3e', offroad: '#9a8a5c', sky: '#8fb8e8', horizon: '#dcebf5', mood: 'bright' },
  terrain: {
    seed: 17,
    hills: { amplitude: 6, wavelength: 90 },
    features: [
      ...FOOTHILLS,
      ...massif(80, 2, shortcutAnchors, FOOTHILLS),
      // The pits of the gorges with a shortcut (the walls of the main gorges are cut by `chasms`).
      ...cavePits,
    ],
    blend: 10,
    // THE GORGES. The road runs along a ridge and the ground falls away steeply on BOTH sides of every crossing into a broad
    // abyss under the cloud sea, so the caps stand on tall stalks over an open chasm and the far side is a separate cliff.
    ceiling: { rise: 6, slope: 0.45 },
    valleyFloor: 8,
    valleyKeep: [-24, -14, G3_LAND, G3_LAND + 14].map((ds) => local('g3a', ds, G3_SIDE)).map((p) => ({ x: p.x, z: p.z, radius: 16 })),
    valleys: [
      { from: at('g1a'), to: at('g1b'), pad: 14, fade: 45 },
      { from: at('g2a'), to: at('g2b'), pad: 14, fade: 45 },
      { from: at('g3a'), to: at('g3b'), pad: 6, fade: 40 },
      // The cave: the hill (the rock shell, +-58 m round its axis) stands as a mesa of its own; only the ground OUTSIDE it falls away.
      { from: at('caveIn'), to: at('caveOut'), pad: 26, fade: 40, inner: [74, 44], open: false },
    ],
  },
  // THE DIRT SHORTCUTS. Each leaves the road before a gorge, runs beside it and rejoins after it. Their middles are
  // held at the road's height (third number), far above a pit, and the orange caps are the only ground there.
  shortcuts: [
    {
      from: at('g3fork'),
      to: at('g3join'),
      points: [
        ...G3_CAPS.map((c) => [c.x, c.z, c.y - 1.3] as [number, number, number]),
        (() => {
          const e = local('g3a', G3_LAND, G3_SIDE);
          return [e.x, e.z, e.y - 0.5] as [number, number, number];
        })(),
      ],
      width: 10,
      hold: true,
      surface: 'road', // hard-packed: no dirt slow-down, the orange route's only cost is the skill it asks
    },
    {
      from: at('caveFork'),
      to: at('caveEnd'),
      points: [
        ...ORANGE_ROUTE.map((c) => [c.x, c.z, c.y - 0.8] as [number, number, number]),
        (() => {
          const e = local('caveIn', CAVE_LAND, CAVE_SIDE);
          return [e.x, e.z, e.y - 0.5] as [number, number, number];
        })(),
      ],
      width: 10,
      hold: true,
      surface: 'road', // hard-packed: no dirt slow-down, the orange route's only cost is the skill it asks
    },
  ],
  caps,
  chasms: [
    { at: at('g1a'), length: G1 },
    { at: at('g2a'), length: G2 },
    { at: at('g3a'), length: G3 },
    { at: at('caveIn'), length: CAVE },
  ],
  // No `cliffs`: a cliff would cut the ground away on that whole side (and in a wedge reaching out to the horizon). The
  // mountain's own steep flanks fall away outside the rope-fence walls instead; the gorges are `chasms`.
};
