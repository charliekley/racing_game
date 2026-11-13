/**
 * Track: "Ember Peaks" – a volcanic mountain road at dusk.
 *
 * Layout (north = +z, east = +x; the start line is on the plain south of the volcano, heading east):
 *
 *   1. START CHICANE: S-bends along the foot of the mountain, then HAIRPIN 1 (left).
 *   2. CLIMB: leg 1 heads west as a string of S-bends, HAIRPIN 2 (right) turns it round, and
 *      leg 2 (S-bends again) climbs east, then sweeps left up the ramp to the crater rim.
 *      Walls line the facing sides of the legs so nobody can cut across from one to the next.
 *   3. THE CRATER: the road runs up to the crater rim and ENDS at a launch pad. The CANNON there is the
 *      only way on: every kart is captured at the pad (the capture covers the whole road) and fired
 *      about 170 m across the crater, with glowing lava far below, onto the far (north) rim. The old
 *      road round the rim is gone; the stretch between pad and landing has no ground at all
 *      (`cannons[].mandatory`, see docs/TRACKS.md).
 *   4. DESCENT: from the landing a cliff-edged sweep and a winding road down the west side, a straight with a boost pad, a KICKER over
 *      a CHASM (void gap: too slow and you fall), a double kicker, and S-bends back to the line.
 *
 * LAVA GEYSERS (the `hazards` list at the bottom) sit on the road at five places. Each warns
 * (glowing crack, sparks, steam) for 1.5 s and then erupts for 1.2 s; touching the lava column
 * spins you out. They are staggered and never block the whole road: there is always a free lane.
 *
 * Every control point is [x, z, height] in metres. The crater centre is (30, 0); the pad (south) and the
 * landing (north) sit on the rim at a radius of about 92-98 m and a height of 27 m. Rather than counting point
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

/** Crater centre (m): the terrain features below (the volcano and its crater bowl) are centred on it. */
const CRATER = { x: 30, z: 0 };

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
  pt(110, -241, 8),
  pt(64, -227, 9.5),
  pt(22, -238, 11, 'leg1End'),
  // ---- Hairpin 2 (right, west -> east) ----
  pt(-10, -231, 12, 'hairpin2'),
  pt(-34, -222, 12.6),
  pt(-44, -199, 13.2),
  pt(-34, -176, 13.8),
  pt(-10, -167, 14.6, 'leg2'),
  // ---- Climb, leg 2: a short run east, then a left sweeper north up the ramp ----
  pt(10, -150, 18, 'sweeper'),
  pt(22, -124, 22.5, 'ramp'),
  // ---- The launch pad: the road ENDS here (the mouth of the cannon is at this point) ----
  pt(29, -98, 27, 'pad'),
  // ---- Across the crater: no road, no ground. These points are only a straight line from the pad to the
  // landing (nobody drives them); the cannon flies along it. ----
  pt(29.5, -50, 27),
  pt(30, 0, 27),
  pt(30.6, 50, 27),
  // ---- The far rim: the landing, then a sweep west and the winding descent ----
  pt(31, 92, 27, 'land'),
  pt(28, 116, 26.5), // cliff on the crater side (left)
  pt(10, 136, 25.8),
  pt(-18, 144, 25),
  pt(-52, 134, 24.2, 'sweep'), // cliff on the outer side (right)
  pt(-88, 124, 23.4), // S-bends down the far slope
  pt(-124, 97, 22.6),
  pt(-158, 102, 21.6),
  pt(-196, 77, 20.4),
  pt(-232, 73, 17.5),
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
  blurb: 'Climb a volcano, get fired across the crater by the cannon, leap the chasm and dodge the lava geysers.',
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
    // The funnel into the launch pad: walls both sides of the last stretch, ending where the road does.
    { from: at('ramp') - 0.6, to: at('pad') + 0.25, side: 'both' },
    // Fence both sides of the chasm run so nobody drives around the gap.
    { from: at('doubleKicker') - 1.1, to: at('doubleKicker') - 0.1, side: 'both' },
  ],
  ramps: [
    { at: 2.5, length: 8, height: 1.0 }, // warm-up kicker on the start S-bends
    { at: 11.5, length: 8, height: 1.0 }, // small kicker on the first climbing leg
    { at: at('doubleKicker') - 0.9, length: 10, height: 2.4, gap: 12, gapKind: 'void', shape: 'kicker' }, // the chasm
    { at: at('doubleKicker') + 0.3, length: 24, height: 1.4, shape: 'double' }, // double kicker after the chasm
  ],
  boostPads: [
    { at: at('chasmRun') + 0.5, offset: 0, length: 8, width: 5 }, // speed for the chasm
    { at: at('land') + 4.4, offset: 0, length: 8, width: 5 }, // down the far rim: keep the speed up
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
      { x: CRATER.x, z: CRATER.z, radius: 90, height: -62 }, // the crater bowl inside it: about 35 m of air under the flight
    ],
    blend: 20,
  },
  cliffs: [
    { from: at('land') + 0.4, to: at('land') + 2.4, side: 'left', edge: 15 }, // crater side of the far rim
    { from: at('land') + 2.6, to: at('sweep') + 0.4, side: 'right', edge: 15 }, // outer slope
  ],
  // THE CANNON: mandatory. The mouth is at the pad, the target is the far rim: 190 m apart, about 170 m of it air.
  cannons: [{ at: at('pad'), offset: 0, target: { at: at('land'), offset: 0 }, flightTime: 4.4, apex: 16, mandatory: true }],
  // Five slalom pairs: two geysers about 30 m apart on opposite sides of the road, erupting at different
  // times, so you swing from one lane to the other. They sit on gentle parts of the road (never on an apex,
  // a jump or the knife-edge ridge) and every pair has a different phase.
  hazards: [
    // 1. Leg 1, in the S-bends.
    geyser(at('leg1') + 0.2, 0.5, 0),
    geyser(at('leg1') + 0.8, -0.5, 3.5),
    // 2. The far rim sweep, past the cliffs.
    geyser(at('land') + 4.9, -0.5, 1),
    geyser(at('land') + 5.9, 0.5, 4.5),
    // 3. The descent from the rim.
    geyser(at('land') + 6.9, -0.5, 2),
    geyser(at('land') + 7.7, 0.5, 5.5),
    // 4. The bottom of the descent, before the chasm run.
    geyser(at('descentEnd') - 1.4, -0.5, 6),
    geyser(at('descentEnd') - 0.7, 0.5, 2.5),
    // 5. The home stretch.
    geyser(at('home') - 0.15, 0.5, 4),
  ],
};
