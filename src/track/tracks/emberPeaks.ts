/**
 * Track: "Ember Peaks" – a volcanic mountain road at dusk.
 *
 * Layout (north = +z, east = +x; the start line is on the plain south of the volcano, heading east):
 *
 *   1. START CHICANE: S-bends along the foot of the mountain, then HAIRPIN 1 (left).
 *   2. CLIMB: leg 1 heads west as a string of S-bends, HAIRPIN 2 (right) turns it round, and
 *      leg 2 (S-bends again) climbs east, then sweeps left up the ramp to the crater rim.
 *      Walls line the facing sides of the legs so nobody can cut across from one to the next.
 *   3. THE CRATER: at the end of the ramp the choice is
 *        * the RIDGE ROAD (counter-clockwise round the rim): cliffs on the crater side and on
 *          the outer slope, a knife-edge stretch with a drop on BOTH sides, a hump on the crest;
 *        * the CANNON: drive straight on at the end of the ramp instead of turning onto the
 *          rim and it flings you across the crater onto the north rim. Miss the mouth and you
 *          simply take the ridge.
 *   4. DESCENT: a winding road down the west side, a straight with a boost pad, a KICKER over
 *      a CHASM (void gap: too slow and you fall), a double kicker, and S-bends back to the line.
 *
 * LAVA GEYSERS (the `hazards` list at the bottom) sit on the road at five places. Each warns
 * (glowing crack, sparks, steam) for 1.5 s and then erupts for 1.2 s; touching the lava column
 * spins you out. They are staggered and never block the whole road: there is always a free lane.
 *
 * Every control point is [x, z, height] in metres. The crater centre is (30, 0); the rim road
 * circles it at a radius of about 85 m and a height of about 30 m. Rather than counting point
 * numbers by hand, important points get a NAME in `route` and the features below refer to them
 * with `at('name')`; a position like `at('chicane') + 0.5` means "halfway to the next point".
 *
 * Layout rules (see docs/TRACKS.md): no straight (|curvature| < 1/250) longer than 100 m
 * except the chasm run-up, at least 70 % of the lap curved, at least 1260 degrees of turning,
 * at least 8 tight corners (radius under 60 m) and a 12 m+ height range. src/track/layout.test.ts
 * and emberPeaks.test.ts check this.
 */
import type { GeyserDef } from '../hazardTypes';
import type { TrackDef } from '../types';

/** Crater centre and rim radius (m); only used to build the rim points below. */
const CRATER = { x: 30, z: 0 };

/**
 * One rim control point. `angle` is measured counter-clockwise from due south
 * (0 = south, 90 = east, 180 = north), `radius` is the distance from the crater
 * centre. Varying the radius a little gives the ridge some wiggle.
 */
function rim(angle: number, radius: number, height: number): [number, number, number] {
  const a = (angle * Math.PI) / 180;
  return [
    Math.round(CRATER.x + radius * Math.sin(a)),
    Math.round(CRATER.z - radius * Math.cos(a)),
    height,
  ];
}

/** A control point, optionally named so features can refer to it. */
interface RoutePoint {
  name?: string;
  p: [number, number, number];
}

/** Shorthand for building the route list. */
const pt = (x: number, z: number, h: number, name?: string): RoutePoint => ({ name, p: [x, z, h] });

const route: RoutePoint[] = [
  // ---- Start line and the first S-bends (heading east along the foot of the mountain) ----
  pt(-90, -310, 0, 'start'),
  pt(-40, -318, 0), // swing right...
  pt(10, -302, 0.5), // ...and left
  pt(60, -318, 1),
  pt(112, -302, 1.5),
  // ---- Hairpin 1 (left, east -> west) ----
  pt(156, -310, 2, 'hairpin1'),
  pt(190, -298, 3),
  pt(201, -272, 4),
  pt(190, -246, 5),
  pt(158, -234, 6, 'leg1'),
  // ---- Climb, leg 1: west, as S-bends ----
  pt(110, -241, 7),
  pt(64, -227, 8.5),
  pt(18, -241, 10),
  pt(-28, -227, 11.5),
  pt(-56, -236, 12.6, 'leg1End'),
  // ---- Hairpin 2 (right, west -> east) ----
  pt(-82, -229, 13.2, 'hairpin2'),
  pt(-103, -220, 13.7),
  pt(-112, -199, 14.2),
  pt(-103, -178, 14.7),
  pt(-82, -169, 15, 'leg2'),
  // ---- Climb, leg 2: east as S-bends, then a left sweeper north up the ramp ----
  pt(-46, -180, 16.2),
  pt(-8, -160, 17.8),
  pt(10, -150, 19.5, 'sweeper'),
  pt(22, -124, 22.5, 'ramp'), // the CANNON mouth sits just after this point
  pt(31, -100, 26, 'rimStart'), // end of the straight, the ridge turns right here
  // ---- The rim ridge (counter-clockwise) ----
  { name: 'rim30', p: rim(30, 85, 30) },
  { name: 'rim60', p: rim(60, 88, 31) }, // crater-side cliff starts
  { name: 'rim90', p: rim(90, 80, 30) }, // hump on the crest
  { name: 'rim120', p: rim(120, 90, 29) }, // knife edge (cliffs on both sides)
  { name: 'rim150', p: rim(150, 84, 31) }, // outer-slope cliff
  { name: 'rim180', p: rim(180, 85, 30) }, // north rim, the cannon lands here
  { name: 'rim210', p: rim(210, 86, 29) },
  // ---- Descent down the west side, winding ----
  pt(-58, 84, 26.5),
  pt(-100, 98, 24.5),
  pt(-146, 80, 22.5),
  pt(-190, 94, 20.5),
  pt(-232, 68, 17.5),
  pt(-262, 32, 14.5, 'descentEnd'),
  // ---- The chasm run: a straight with a boost pad, the chasm kicker and a double kicker ----
  pt(-284, -8, 11.5, 'chasmRun'),
  pt(-290, -70, 9.5), // boost pad, then the kicker over the chasm
  pt(-290, -130, 7.5, 'doubleKicker'),
  // ---- Back to the line: S-bends ----
  pt(-282, -190, 5.8),
  pt(-258, -228, 4.2),
  pt(-222, -252, 3),
  pt(-192, -284, 2),
  pt(-150, -300, 1, 'home'),
];

const points = route.map((r) => r.p);

/** Position of a named point, in control-point units (what every feature below wants). */
function at(name: string): number {
  const i = route.findIndex((r) => r.name === name);
  if (i < 0) throw new Error(`emberPeaks: no point named "${name}"`);
  return i;
}

/**
 * A lava geyser: erupts for 1.2 s every `GEYSER_PERIOD` s after a 1.5 s warning. `offset` is the sideways
 * position (-1 = left edge of the road, 1 = right edge); `phase` shifts the cycle (s).
 * A geyser is about 8 m wide, the road 14 m, so one lane is always free.
 */
const GEYSER_PERIOD = 7;
const geyser = (position: number, offset: number, phase: number): GeyserDef => ({
  kind: 'geyser',
  at: position,
  offset,
  phase,
  period: GEYSER_PERIOD,
});

export const emberPeaks: TrackDef = {
  name: 'Ember Peaks',
  blurb: 'Climb a volcano, race the crater rim or fire across it with the cannon, leap the chasm and dodge the lava geysers.',
  points,
  width: 14,
  offroadWidth: 8,
  bankPerCurvature: 4,
  maxBankDeg: 8,
  walls: [
    // Hairpin barriers on the outside of both switchback turns.
    { from: at('hairpin1') + 0.3, to: at('leg1') - 0.3, side: 'outer' },
    { from: at('hairpin2') - 0.3, to: at('leg2') + 0.3, side: 'outer' },
    // Facing sides of the parallel legs (start S-bends / leg 1 / leg 2), so nobody cuts across from one to the
    // next. Left and right are as seen when driving: heading east the neighbouring leg is on the right.
    { from: 0.5, to: at('hairpin1'), side: 'right' },
    { from: at('leg1') + 0.5, to: at('leg1End'), side: 'both' },
    { from: at('leg2') + 0.5, to: at('sweeper') - 0.3, side: 'left' },
    // Fence both sides of the chasm run so nobody drives around the gap.
    { from: at('doubleKicker') - 1.1, to: at('doubleKicker') - 0.1, side: 'both' },
  ],
  ramps: [
    { at: 2.5, length: 8, height: 1.0 }, // warm-up kicker on the start S-bends
    { at: 11.5, length: 8, height: 1.0 }, // small kicker on the first climbing leg
    { at: at('rim90'), length: 8, height: 1.0 }, // small kicker on the ridge crest
    { at: at('doubleKicker') - 0.9, length: 10, height: 2.4, gap: 12, gapKind: 'void', shape: 'kicker' }, // the chasm
    { at: at('doubleKicker') + 0.3, length: 24, height: 1.4, shape: 'double' }, // double kicker after the chasm
  ],
  boostPads: [
    { at: at('chasmRun') + 0.5, offset: 0, length: 8, width: 5 }, // speed for the chasm
    { at: at('rim210') + 0.3, offset: 0, length: 8, width: 5 }, // after the cannon landing / ridge: keep the speed up
  ],
  laps: 3,
  checkpoints: 18,
  scenery: { seed: 17, trees: 70, buildings: 0 },
  // Dark ash ground, rust-orange rock, purple dusk sky glowing orange at the horizon.
  theme: { grass: '#4a2f2a', offroad: '#7a3b22', sky: '#3a2a5c', horizon: '#ff8a4a', mood: 'dusk' },
  terrain: {
    seed: 7,
    hills: { amplitude: 4, wavelength: 70 },
    features: [
      { x: CRATER.x, z: CRATER.z, radius: 300, height: 34 }, // the volcano
      { x: CRATER.x, z: CRATER.z, radius: 80, height: -36 }, // the crater bowl inside it
    ],
    blend: 20,
  },
  cliffs: [
    { from: at('rim60'), to: at('rim90') + 0.6, side: 'left', edge: 15 }, // crater side
    { from: at('rim90') + 0.8, to: at('rim120') + 0.7, side: 'both', edge: 15 }, // knife edge
    { from: at('rim120') + 0.9, to: at('rim180'), side: 'right', edge: 15 }, // outer slope
  ],
  cannons: [{ at: at('ramp') + 0.6, offset: 0, target: { at: at('rim180'), offset: 0 }, flightTime: 3.8, apex: 18 }],
  // Five slalom pairs: two geysers about 30 m apart on opposite sides of the road, erupting at different
  // times, so you swing from one lane to the other. They sit on gentle parts of the road (never on an apex,
  // a jump or the knife-edge ridge) and every pair has a different phase.
  hazards: [
    // 1. Leg 1, in the S-bends.
    geyser(at('leg1') + 0.2, 0.5, 0),
    geyser(at('leg1') + 0.8, -0.5, 3.5),
    // 2. The first stretch of the rim (the cannon skips it).
    geyser(at('rimStart') + 0.9, -0.5, 1),
    geyser(at('rim30') + 0.5, 0.5, 4.5),
    // 3. The descent from the rim.
    geyser(at('rim210') + 0.65, 0.5, 2),
    geyser(at('rim210') + 1.3, -0.5, 5.5),
    // 4. The bottom of the descent, before the chasm run.
    geyser(at('descentEnd') - 1.4, -0.5, 6),
    geyser(at('descentEnd') - 0.7, 0.5, 2.5),
    // 5. The home stretch.
    geyser(at('home') - 0.15, 0.5, 4),
  ],
};
