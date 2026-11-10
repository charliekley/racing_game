/**
 * Track: "Cloud Garden" – a bright, airy course over floating sky islands.
 *
 * The world under the road is a bottomless bowl (see `terrain` below): its
 * natural height is about 100 m BELOW the islands, so everything past the
 * edge of an island fades into the white fog. Step off and the carrier drone
 * fetches you. There are almost no fences on purpose: staying on the road IS
 * the challenge.
 *
 * Layout (north = +z, east = +x, counter-clockwise lap, about 1.7 km):
 *
 *   Island A (south, start)   straight with a chain of humps, then a long BRIDGE east
 *   Island B (south-east)     a chicane with open edges, then a big VOID JUMP north
 *   Island C (north-east)     fast curve west; here is the CANNON (see below)
 *       ── bridge ──>
 *   Island D (north)          a wide, tight bend around the island and a second VOID JUMP
 *   Island E (west)           double kicker, S-bends, then a BRIDGE back to A
 *
 * THE CANNON (high risk): its mouth sits on the LEFT SIDE of island C's road
 * (the racing line misses it). Hit it and you are fired straight across the
 * sky, skipping the whole island D (bridge, bend and void jump) and landing on
 * island E. Miss the mouth by a metre and you just drive the normal way round.
 *
 * Features used: bridges, void gaps (chasm jumps), a cannon, hump chain,
 * double kicker, boost pads, open drop-offs everywhere, deep-sky terrain.
 *
 * Control points are [x, z, height] in metres; the comment on each one says
 * what is near it. Features refer to them by number ("9.25" = a quarter of the
 * way from point 9 to point 10).
 */
import type { TrackDef } from '../types';

const points: [number, number, number][] = [
  // ---- Island A: start straight, heading east ----
  [-115, -210, 20], //  0: start/finish line
  [-50, -212, 20], //  1: hump chain on this straight
  [30, -205, 20], //  2: the bridge to island B starts just after this
  [115, -185, 21], //  3: on the bridge
  [195, -150, 23], //  4: bridge ends, island B begins
  // ---- Island B: chicane, then the big jump north ----
  [238, -118, 24], //  5
  [322, -42, 24], //  6: sweeper to the left
  [272, 22, 25], //  7: S-bend: hard left...
  [262, 78, 25], //  8: ...then right again
  [304, 112, 26], //  9: boost pad, then a kicker over the void
  [285, 182, 27], // 10: landing on island C
  // ---- Island C: curve west; the cannon mouth is on the left edge near 13.2 ----
  [240, 215, 28], // 11
  [170, 205, 29], // 12: small hump
  [100, 185, 30], // 13: end of the straight; the cannon is just after this
  [45, 215, 30], // 14: the road turns north-west onto the bridge
  // ---- Island D: bridge over the sky, wide bend, second void jump ----
  [10, 270, 30], // 15: on the bridge
  [-55, 288, 30], // 16: island D
  [-112, 258, 30], // 17
  [-135, 205, 29], // 18: boost pad then a kicker over the void (heading south)
  [-140, 125, 28], // 19: landing on island E; the cannon lands near 18.85
  // ---- Island E: double kicker, S-bends, bridge home ----
  [-145, 78, 27], // 20
  [-200, 42, 26], // 21
  [-286, 22, 25], // 22
  [-270, -92, 24], // 23
  [-268, -150, 23], // 24: the bridge to island A starts here
  [-215, -198, 21], // 25
];

export const cloudGarden: TrackDef = {
  name: 'Cloud Garden',
  blurb: 'Sky islands joined by bridges and void jumps. Risk the cannon to skip a whole island.',
  points,
  width: 14,
  offroadWidth: 6,
  bankPerCurvature: 4,
  maxBankDeg: 8,
  walls: [
    // Fence both sides of the two chasm runs so nobody drives around the gap.
    { from: 9.2, to: 9.85, side: 'both' },
    { from: 18.1, to: 18.8, side: 'both' },
  ],
  ramps: [
    // Island A: a chain of humps to wake you up.
    { at: 0.5, length: 14, height: 1.0, shape: 'hump' },
    { at: 0.85, length: 14, height: 1.0, shape: 'hump' },
    { at: 1.2, length: 14, height: 1.0, shape: 'hump' },
    // Void jump B -> C.
    { at: 9.25, length: 10, height: 2.4, gap: 14, gapKind: 'void', shape: 'kicker' },
    // A hump on island C.
    { at: 12.2, length: 12, height: 1.0, shape: 'hump' },
    // Void jump D -> E.
    { at: 18.2, length: 10, height: 2.4, gap: 14, gapKind: 'void', shape: 'kicker' },
    // Double kicker on island E.
    { at: 20.3, length: 24, height: 1.4, shape: 'double' },
  ],
  boostPads: [
    { at: 9.1, offset: 0, length: 8, width: 5 }, // speed for the first void jump
    { at: 18.0, offset: 0, length: 8, width: 5 }, // speed for the second one
    { at: 4.2, offset: 0, length: 8, width: 5 }, // welcome to island B
    { at: 24.6, offset: 0, length: 8, width: 5 }, // down the home bridge
  ],
  laps: 3,
  checkpoints: 18,
  // No trees: they would float in the sky next to the islands.
  scenery: { seed: 5, trees: 40, buildings: 0, openSky: true },
  // Fresh green islands, pale sandstone rock, blue sky fading to white cloud.
  theme: { grass: '#7ccf5a', offroad: '#f0e2b4', sky: '#4aa8f0', horizon: '#f2f9ff', mood: 'bright' },
  terrain: {
    seed: 3,
    // One enormous bowl: about -100 m under the whole course, deeper in the middle.
    features: [{ x: 0, z: 40, radius: 1600, height: -125 }],
    blend: 14,
  },
  bridges: [
    { from: 2.3, to: 3.9 }, // A -> B
    { from: 14.25, to: 15.75 }, // C -> D
    { from: 24.2, to: 25.8 }, // E -> A
  ],
  cannons: [{ at: 13.2, offset: -0.55, target: { at: 18.8, offset: 0 }, flightTime: 3.4, apex: 24 }],
};
