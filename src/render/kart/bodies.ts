/**
 * The four kart bodies (Sprinter, Mudlark, Comet, Splash), built from smooth
 * lofts, lathes and swept pipes (see geo.ts). Each builder adds its parts to a
 * PartBuilder and returns the layout (wheel positions, exhaust tips, where the
 * driver sits and where the steering wheel is).
 *
 * Body space: faces +Z, Y up, origin on the ground between the axles.
 * Parts mirrored with `...Pair` are built on the +X side and copied to -X.
 */
import * as THREE from 'three';
import {
  PartBuilder, SURF, capsule, ellipseLoop, helix, loft, loftRimPoints, lathe, roundBox, roundCone, sphere, sweep, type Section, type V3,
} from './geo';
import { PAL } from './materials';
import { addWheelParts, type WheelSpec } from './wheels';

export interface WheelSpot extends WheelSpec {
  x: number;
  z: number;
}

export interface StyleLayout {
  front: WheelSpot;
  rear: WheelSpot;
  /** Exhaust tips: position, plus rotation.x tilt (0 = flame straight back, >0 tilts it upward). */
  exhausts: { pos: V3; tilt: number }[];
  /** Driver hip point (seat surface) in body space. */
  hip: V3;
  /** Steering wheel centre and tilt (radians, rotation about X). */
  wheel: { pos: V3; tilt: number };
}

export type StyleBuilder = (b: PartBuilder, high: boolean) => StyleLayout;

const S = (hw: number, ht: number, hb: number, z: number, cy: number, n = 2.6): Section => ({ z, cy, hw, ht, hb, n });

// --- shared small parts ------------------------------------------------------------

const unitSphere = () => sphere(14, 10);

/** Steering column from the wheel centre forward-down to `base`. */
function addColumn(b: PartBuilder, wheelPos: V3, tilt: number, len: number): void {
  const dir = new THREE.Vector3(0, -Math.sin(tilt), Math.cos(tilt));
  const a: V3 = wheelPos;
  const e: V3 = [wheelPos[0], wheelPos[1] + dir.y * len, wheelPos[2] + dir.z * len];
  b.pipe('detail', [a, e], 0.024, PAL.black, SURF.plastic);
  b.part(lathe([[0, 0], [0.05, 0], [0.05, 0.06], [0.035, 0.09], [0, 0.09]], 14), { p: [e[0], e[1] - 0.005, e[2]], r: [Math.PI / 2 - tilt + Math.PI / 2, 0, 0] }, PAL.dark, SURF.plastic);
}

/** A flared pipe tip (exhaust bell) at `p` pointing along `dir`. */
function addBell(b: PartBuilder, p: V3, dir: V3, r: number, color = PAL.chrome): void {
  const d = new THREE.Vector3(...dir).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  const e = new THREE.Euler().setFromQuaternion(q);
  // bottom-to-top profile with the outside on the right: a short flared cup
  const prof: [number, number][] = [[r * 0.85, -0.06], [r * 0.95, -0.02], [r * 1.35, 0.05], [r * 1.3, 0.055], [r * 1.0, 0.04], [r * 0.7, 0.0]];
  b.part(lathe(prof, 18), { p, r: [e.x, e.y, e.z] }, color, SURF.chrome);
  // dark inside
  b.part(lathe([[r * 1.0, 0.045], [r * 0.9, 0.0], [0, -0.02]], 14), { p, r: [e.x, e.y, e.z] }, PAL.black, SURF.matte);
}

/** Round lamp: chrome ring plus glowing lens facing `dir`. */
function addLamp(b: PartBuilder, p: V3, dir: V3, r: number, color: string): void {
  const d = new THREE.Vector3(...dir).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  const e = new THREE.Euler().setFromQuaternion(q);
  b.part(lathe([[r * 1.25, -0.03], [r * 1.3, 0.0], [r * 1.15, 0.03], [r * 0.95, 0.035], [r * 0.95, 0.0]], 18), { p, r: [e.x, e.y, e.z] }, PAL.chrome, SURF.chrome);
  b.part(lathe([[0, -0.01], [r * 0.95, -0.005], [r * 0.9, 0.02], [r * 0.6, 0.045], [0, 0.055]], 16), { p, r: [e.x, e.y, e.z] }, color, SURF.glow);
}

/**
 * A mudguard: a flat ribbon arching over a wheel (centre x, wheel centre y/z, radius R),
 * with a stay down to the body at `attach` so it does not float.
 */
function addMudguard(b: PartBuilder, bucket: 'paint' | 'accent', x: number, wy: number, wz: number, R: number, halfWidth: number, attach: V3, arcDeg = 78): void {
  const pts: V3[] = [];
  const n = 7;
  const rr = R + 0.05;
  for (let i = 0; i < n; i++) {
    const a = ((i / (n - 1)) * 2 - 1) * (arcDeg * Math.PI) / 180;
    pts.push([0, wy + rr * Math.cos(a), wz + rr * Math.sin(a)]);
  }
  const t = 0.024;
  const arc = sweep(pts, t, 18, 6);
  b.addPair(bucket, arc, { p: [x, 0, 0], s: [halfWidth / t, 1, 1] });
  const capG = sphere(8, 6);
  for (const pt of [pts[0], pts[n - 1]]) b.addPair(bucket, capG, { p: [x, pt[1], pt[2]], s: [halfWidth, t, t] });
  b.pipe('detail', [[x, wy + rr, wz], attach], 0.016, PAL.steel, SURF.metal, { pair: true, rad: 6 });
}

/** A thick rod along X (axle). */
function addAxle(b: PartBuilder, y: number, z: number, half: number, r: number): void {
  b.pipe('detail', [[-half, y, z], [half, y, z]], r, PAL.steel, SURF.metal);
}

// ---------------------------------------------------------------------------------
// 0. Sprinter: open-wheel racing kart
// ---------------------------------------------------------------------------------

const buildSprinter: StyleBuilder = (b) => {
  // Floor tray.
  b.part(loft([S(0.04, 0.02, 0.02, -0.97, 0.22), S(0.3, 0.045, 0.04, -0.85, 0.22, 4), S(0.46, 0.045, 0.045, -0.4, 0.22, 4), S(0.42, 0.045, 0.045, 0.7, 0.22, 4), S(0.2, 0.04, 0.04, 1.02, 0.23, 3), S(0.04, 0.02, 0.02, 1.08, 0.23)]), {}, PAL.dark, SURF.plastic);
  // Side pods (player paint).
  const pod = loft([S(0.02, 0.02, 0.02, -0.4, 0.33), S(0.1, 0.1, 0.09, -0.3, 0.33), S(0.15, 0.14, 0.1, 0.0, 0.34, 2.8), S(0.14, 0.12, 0.09, 0.3, 0.33, 2.8), S(0.03, 0.04, 0.04, 0.58, 0.31)]);
  b.paintPair(pod, { p: [0.47, 0, 0] });
  // Nose cone.
  b.paint(loft([S(0.02, 0.02, 0.02, 0.2, 0.3), S(0.33, 0.14, 0.09, 0.34, 0.3, 2.8), S(0.3, 0.12, 0.08, 0.72, 0.3, 2.8), S(0.2, 0.09, 0.07, 1.0, 0.27, 2.6), S(0.09, 0.05, 0.05, 1.15, 0.26), S(0.01, 0.01, 0.01, 1.22, 0.26)]), {});
  // Number plate on the nose: white board with a player-colour field.
  b.part(roundBox(0.36, 0.3, 0.03, 0.012), { p: [0, 0.455, 0.78], r: [-0.62, 0, 0] }, PAL.white, SURF.gloss);
  b.paint(roundBox(0.28, 0.22, 0.03, 0.012), { p: [0, 0.462, 0.785], r: [-0.62, 0, 0] });
  // Headlights and bumper.
  b.partPair(sphere(10, 8), { p: [0.17, 0.3, 1.05], s: [0.05, 0.035, 0.04] }, PAL.chrome, SURF.chrome);
  addLamp(b, [0.16, 0.32, 1.09], [0.2, 0.1, 1], 0.045, PAL.lampWhite);
  addLamp(b, [-0.16, 0.32, 1.09], [-0.2, 0.1, 1], 0.045, PAL.lampWhite);
  b.pipe('detail', [[-0.52, 0.25, 0.8], [-0.42, 0.23, 1.05], [-0.2, 0.22, 1.2], [0, 0.22, 1.22], [0.2, 0.22, 1.2], [0.42, 0.23, 1.05], [0.52, 0.25, 0.8]], 0.024, PAL.steel, SURF.metal);
  // Cowl in front of the driver.
  b.paint(sphere(16, 10), { p: [0, 0.4, 0.48], s: [0.2, 0.1, 0.22] });
  // Bucket seat: base pad, tilted back, side bolsters and a head cushion.
  b.part(roundBox(0.46, 0.09, 0.5, 0.04), { p: [0, 0.31, -0.33] }, PAL.seat, SURF.fur);
  b.part(roundBox(0.46, 0.5, 0.12, 0.05), { p: [0, 0.56, -0.57], r: [-0.22, 0, 0] }, PAL.seat, SURF.fur);
  b.partPair(sphere(10, 8), { p: [0.24, 0.46, -0.5], s: [0.07, 0.18, 0.1] }, PAL.seat, SURF.fur);
  // Engine on the right, with cylinder head, air filter and twin exhausts.
  b.part(roundBox(0.34, 0.26, 0.34, 0.06), { p: [0.2, 0.4, -0.82] }, PAL.steel, SURF.metal);
  b.part(lathe([[0, 0], [0.1, 0], [0.1, 0.1], [0.08, 0.13], [0, 0.13]], 18), { p: [0.2, 0.52, -0.82] }, PAL.dark, SURF.plastic);
  for (let i = 0; i < 4; i++) b.part(roundBox(0.38, 0.018, 0.34, 0.008, 1), { p: [0.2, 0.34 + i * 0.045, -0.82] }, PAL.chrome, SURF.metal);
  for (const x of [0.17, 0.33]) {
    b.pipe('detail', [[x, 0.42, -0.95], [x, 0.43, -1.0], [x, 0.44, -1.06]], 0.04, PAL.chrome, SURF.chrome);
    addBell(b, [x, 0.44, -1.07], [0, 0, -1], 0.04);
  }
  // Rear wing: struts, wing, endplates.
  b.pipe('detail', [[0.36, 0.34, -0.9], [0.38, 0.5, -0.95], [0.4, 0.62, -0.98]], 0.02, PAL.steel, SURF.metal, { pair: true });
  b.accent(roundBox(1.3, 0.045, 0.26, 0.02), { p: [0, 0.64, -1.0], r: [-0.12, 0, 0] });
  b.paint(roundBox(1.22, 0.035, 0.1, 0.016), { p: [0, 0.7, -1.01], r: [-0.4, 0, 0] });
  b.paintPair(roundBox(0.04, 0.24, 0.38, 0.018), { p: [0.66, 0.64, -1.0] });
  // Rear bumper bar and tail lights.
  b.pipe('detail', [[-0.55, 0.26, -0.86], [-0.4, 0.25, -1.02], [0, 0.25, -1.08], [0.4, 0.25, -1.02], [0.55, 0.26, -0.86]], 0.024, PAL.steel, SURF.metal);
  b.partPair(roundBox(0.12, 0.05, 0.03, 0.015), { p: [0.3, 0.33, -1.06] }, PAL.lampRed, SURF.glow);
  // Axles, brake hardware.
  addAxle(b, 0.27, 0.68, 0.63, 0.03);
  addAxle(b, 0.31, -0.68, 0.64, 0.04);
  const wheel: StyleLayout['wheel'] = { pos: [0, 0.69, 0.22], tilt: 0.75 };
  addColumn(b, wheel.pos, wheel.tilt, 0.32);
  return {
    front: { radius: 0.27, width: 0.22, rim: PAL.chrome, kind: 'sport', x: 0.72, z: 0.68 },
    rear: { radius: 0.31, width: 0.32, rim: PAL.chrome, kind: 'sport', x: 0.76, z: -0.68 },
    exhausts: [
      { pos: [0.17, 0.44, -1.15], tilt: 0 },
      { pos: [0.33, 0.44, -1.15], tilt: 0 },
    ],
    hip: [0, 0.36, -0.33],
    wheel,
  };
};

// ---------------------------------------------------------------------------------
// 1. Mudlark: off-road buggy
// ---------------------------------------------------------------------------------

const buildMudlark: StyleBuilder = (b, high) => {
  // Chunky tub.
  b.paint(loft([S(0.02, 0.02, 0.02, -0.92, 0.6), S(0.3, 0.14, 0.1, -0.84, 0.6, 3), S(0.47, 0.24, 0.17, -0.55, 0.6, 3.2), S(0.5, 0.26, 0.17, 0, 0.6, 3.2), S(0.46, 0.2, 0.16, 0.5, 0.58, 3.2), S(0.36, 0.13, 0.12, 0.86, 0.55, 3), S(0.14, 0.07, 0.07, 1.04, 0.52), S(0.01, 0.01, 0.01, 1.1, 0.5)]), {});
  // Dark cockpit floor/opening inset.
  b.part(sphere(16, 8), { p: [0, 0.84, -0.22], s: [0.3, 0.06, 0.42] }, PAL.black, SURF.plastic);
  // Fender flares over each wheel (accent).
  addMudguard(b, 'accent', 0.8, 0.36, 0.72, 0.36, 0.17, [0.5, 0.74, 0.72]);
  addMudguard(b, 'accent', 0.82, 0.4, -0.7, 0.4, 0.2, [0.5, 0.78, -0.7]);
  // Skid plate and front bumper.
  b.part(roundBox(0.62, 0.05, 0.5, 0.02), { p: [0, 0.4, 0.92], r: [-0.3, 0, 0] }, PAL.steel, SURF.metal);
  b.pipe('detail', [[-0.4, 0.58, 0.95], [-0.34, 0.5, 1.1], [0, 0.46, 1.15], [0.34, 0.5, 1.1], [0.4, 0.58, 0.95]], 0.03, PAL.steel, SURF.metal);
  b.pipe('detail', [[-0.2, 0.46, 1.14], [-0.2, 0.7, 1.0]], 0.02, PAL.steel, SURF.metal);
  b.pipe('detail', [[0.2, 0.46, 1.14], [0.2, 0.7, 1.0]], 0.02, PAL.steel, SURF.metal);
  // Roll cage (accent tone): main hoop, front pillars, roof rails and cross bars.
  const cage = (pts: V3[], pair = false) => b.pipe('accent', pts, 0.036, undefined, undefined, { pair });
  cage([[0.46, 0.8, -0.58], [0.46, 1.35, -0.52], [0.42, 1.78, -0.42], [0.2, 1.93, -0.36], [0, 1.97, -0.35], [-0.2, 1.93, -0.36], [-0.42, 1.78, -0.42], [-0.46, 1.35, -0.52], [-0.46, 0.8, -0.58]]);
  cage([[0.44, 0.86, 0.3], [0.4, 1.4, 0.18], [0.36, 1.8, 0.02]], true);
  cage([[0.42, 1.78, -0.42], [0.38, 1.8, -0.2], [0.36, 1.8, 0.02]], true);
  cage([[-0.36, 1.8, 0.02], [0, 1.82, 0.02], [0.36, 1.8, 0.02]]);
  cage([[0.46, 1.3, -0.52], [0.42, 1.34, -0.1], [0.4, 1.4, 0.18]], true);
  // Light bar with three lamps.
  b.part(roundBox(0.82, 0.1, 0.09, 0.035), { p: [0, 1.9, 0.1] }, PAL.black, SURF.plastic);
  for (const x of [-0.26, 0, 0.26]) addLamp(b, [x, 1.9, 0.16], [0, 0.06, 1], 0.07, PAL.lampWhite);
  // Suspension: A-arms and coil springs over damper rods.
  const spring = (x: number, z: number) => {
    b.pipe('detail', helix(0.055, 0.5, 0.74, 3.5, 7, x, z), 0.014, PAL.red, SURF.metal, { rad: 5, segsPerPoint: 2 });
    b.pipe('detail', [[x, 0.46, z], [x, 0.8, z]], 0.02, PAL.steel, SURF.metal, { rad: 6 });
  };
  for (const sx of [1, -1]) {
    spring(0.56 * sx, 0.72);
    spring(0.58 * sx, -0.7);
    b.pipe('detail', [[0.3 * sx, 0.5, 0.72], [0.62 * sx, 0.4, 0.72]], 0.03, PAL.dark, SURF.metal, { rad: 6 });
    b.pipe('detail', [[0.3 * sx, 0.5, -0.7], [0.64 * sx, 0.42, -0.7]], 0.035, PAL.dark, SURF.metal, { rad: 6 });
  }
  addAxle(b, 0.36, 0.72, 0.68, 0.035);
  addAxle(b, 0.4, -0.7, 0.7, 0.04);
  // Spare tyre on the back and twin vertical exhaust stacks.
  addWheelParts(b, { radius: 0.27, width: 0.14, rim: PAL.mustard, kind: 'retro', cap: PAL.mustard }, high, new THREE.Matrix4().compose(new THREE.Vector3(0, 0.72, -0.96), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), new THREE.Vector3(1, 1, 1)));
  for (const sx of [1, -1]) {
    b.pipe('detail', [[0.42 * sx, 0.8, -0.82], [0.42 * sx, 1.15, -0.84], [0.41 * sx, 1.36, -0.9]], 0.05, PAL.chrome, SURF.chrome, { rad: 10 });
    addBell(b, [0.41 * sx, 1.38, -0.92], [0, 0.4, -1], 0.05);
  }
  // Seat.
  b.part(roundBox(0.46, 0.09, 0.46, 0.04), { p: [0, 0.76, -0.28] }, PAL.seat, SURF.fur);
  b.part(roundBox(0.46, 0.5, 0.12, 0.05), { p: [0, 1.0, -0.52], r: [-0.2, 0, 0] }, PAL.seat, SURF.fur);
  // Headlights in the hood and tail lights.
  addLamp(b, [0.28, 0.66, 1.03], [0.1, 0.1, 1], 0.07, PAL.lampWhite);
  addLamp(b, [-0.28, 0.66, 1.03], [-0.1, 0.1, 1], 0.07, PAL.lampWhite);
  b.partPair(roundBox(0.1, 0.07, 0.03, 0.014), { p: [0.2, 0.66, -0.92], r: [0, 0.2, 0] }, PAL.lampRed, SURF.glow);
  const wheel: StyleLayout['wheel'] = { pos: [0, 1.05, 0.26], tilt: 0.8 };
  addColumn(b, wheel.pos, wheel.tilt, 0.34);
  return {
    front: { radius: 0.36, width: 0.3, rim: PAL.mustard, kind: 'knob', x: 0.8, z: 0.72 },
    rear: { radius: 0.4, width: 0.38, rim: PAL.mustard, kind: 'knob', x: 0.82, z: -0.7 },
    exhausts: [
      { pos: [0.41, 1.4, -0.95], tilt: 1.15 },
      { pos: [-0.41, 1.4, -0.95], tilt: 1.15 },
    ],
    hip: [0, 0.8, -0.28],
    wheel,
  };
};

// ---------------------------------------------------------------------------------
// 2. Comet: sleek bullet
// ---------------------------------------------------------------------------------

const buildComet: StyleBuilder = (b) => {
  // Fuselage.
  b.paint(loft([S(0.01, 0.01, 0.01, -1.04, 0.38), S(0.14, 0.12, 0.1, -0.88, 0.38), S(0.24, 0.22, 0.17, -0.55, 0.38, 2.4), S(0.34, 0.27, 0.18, -0.1, 0.37, 2.4), S(0.33, 0.25, 0.17, 0.35, 0.36, 2.4), S(0.24, 0.17, 0.12, 0.8, 0.28), S(0.13, 0.1, 0.09, 1.08, 0.18), S(0.05, 0.05, 0.05, 1.22, 0.16), S(0.01, 0.01, 0.01, 1.28, 0.16)], 28), {});
  // Dark cockpit opening with a rolled coaming.
  b.part(sphere(18, 8), { p: [0, 0.625, -0.22], s: [0.2, 0.05, 0.4] }, PAL.black, SURF.gloss);
  b.pipe('accent', ellipseLoop(0, 0.625, -0.22, 0.23, 0.43, 28, 2.4), 0.03, undefined, undefined, { rad: 8 });
  // Racing stripe along the nose (accent).
  b.accent(loft([S(0.01, 0.005, 0.0, 0.5, 0.57), S(0.055, 0.02, 0.0, 0.7, 0.485, 3), S(0.05, 0.02, 0.0, 1.0, 0.33, 3), S(0.01, 0.01, 0.0, 1.2, 0.22)], 16, 3), {});
  // Canopy bubble (tinted glossy glass) ahead of the driver.
  b.part(sphere(18, 10), { p: [0, 0.6, 0.26], s: [0.19, 0.12, 0.2] }, PAL.glassDark, SURF.glass);
  b.part(sphere(10, 8), { p: [0.1, 0.66, 0.31], s: [0.04, 0.02, 0.06], r: [0.3, 0.3, 0] }, '#ffffff', SURF.glow);
  // Seat back inside the cockpit.
  b.part(roundBox(0.4, 0.4, 0.1, 0.045), { p: [0, 0.56, -0.5], r: [-0.4, 0, 0] }, PAL.seat, SURF.fur);
  // Tail fin (paint) with a cap (accent).
  b.paint(loft([S(0.01, 0.01, 0.01, -0.6, 0.58), S(0.03, 0.05, 0.08, -0.7, 0.62), S(0.032, 0.14, 0.2, -0.85, 0.7), S(0.03, 0.15, 0.3, -1.0, 0.78), S(0.01, 0.02, 0.1, -1.08, 0.7)], 14), {});
  b.accent(loft([S(0.01, 0.01, 0.01, -0.8, 0.83), S(0.04, 0.03, 0.03, -0.9, 0.9), S(0.04, 0.03, 0.03, -1.0, 0.95), S(0.01, 0.01, 0.01, -1.07, 0.9)], 12), {});
  // Jet nozzle: a flared bell (chrome outside, dark inside).
  const nozzle: [number, number][] = [[0.12, 0.0], [0.13, -0.06], [0.17, -0.18], [0.185, -0.2], [0.16, -0.2], [0.14, -0.12]];
  b.part(lathe(nozzle, 24), { p: [0, 0.38, -1.02], r: [-Math.PI / 2, 0, 0] }, PAL.chrome, SURF.chrome);
  b.part(lathe([[0.16, -0.2], [0.12, -0.12], [0, -0.04]], 20), { p: [0, 0.38, -1.02], r: [-Math.PI / 2, 0, 0] }, '#ff9a3c', SURF.glow);
  // Wheel struts and teardrop fenders.
  b.pipe('detail', [[0.28, 0.32, 0.75], [0.5, 0.26, 0.75], [0.6, 0.24, 0.75]], 0.032, PAL.steel, SURF.metal, { pair: true });
  b.pipe('detail', [[0.3, 0.34, -0.68], [0.52, 0.29, -0.68], [0.62, 0.27, -0.68]], 0.034, PAL.steel, SURF.metal, { pair: true });
  addMudguard(b, 'accent', 0.7, 0.24, 0.75, 0.24, 0.1, [0.3, 0.4, 0.75], 70);
  addMudguard(b, 'accent', 0.72, 0.27, -0.68, 0.27, 0.13, [0.3, 0.42, -0.68], 70);
  // Slit headlights and tail light.
  b.partPair(sphere(10, 6), { p: [0.15, 0.27, 0.93], s: [0.08, 0.025, 0.05], r: [0, 0.4, -0.3] }, PAL.lampWhite, SURF.glow);
  b.part(sphere(10, 6), { p: [0, 0.5, -0.9], s: [0.12, 0.02, 0.05], r: [0.6, 0, 0] }, PAL.lampRed, SURF.glow);
  addAxle(b, 0.24, 0.75, 0.6, 0.025);
  addAxle(b, 0.27, -0.68, 0.62, 0.03);
  const wheel: StyleLayout['wheel'] = { pos: [0, 0.74, 0.18], tilt: 0.9 };
  addColumn(b, wheel.pos, wheel.tilt, 0.25);
  return {
    front: { radius: 0.24, width: 0.2, rim: PAL.chrome, kind: 'sport', x: 0.7, z: 0.75, spokes: 6 },
    rear: { radius: 0.27, width: 0.26, rim: PAL.chrome, kind: 'sport', x: 0.72, z: -0.68, spokes: 6 },
    exhausts: [{ pos: [0, 0.38, -1.3], tilt: 0 }],
    hip: [0, 0.5, -0.3],
    wheel,
  };
};

// ---------------------------------------------------------------------------------
// 3. Splash: retro bathtub racer
// ---------------------------------------------------------------------------------

const TUB: Section[] = [
  S(0.02, 0.02, 0.02, -1.04, 0.84),
  S(0.3, 0.2, 0.2, -0.92, 0.7, 2.6),
  S(0.5, 0.22, 0.22, -0.5, 0.68, 3.2),
  S(0.54, 0.17, 0.23, 0.0, 0.66, 3.4),
  S(0.5, 0.15, 0.22, 0.5, 0.64, 3.2),
  S(0.4, 0.16, 0.26, 0.85, 0.7, 2.8),
  S(0.2, 0.12, 0.3, 1.04, 0.72, 2.4),
  S(0.01, 0.01, 0.2, 1.12, 0.78),
];

const buildSplash: StyleBuilder = (b) => {
  // Outer tub (player paint) and white enamel inside.
  b.paint(loft(TUB, 28), {});
  const inner: Section[] = TUB.map((s) => ({ ...s, cy: s.cy + s.ht * 0.97, hw: Math.max(0.005, s.hw - 0.08), ht: 0.02, hb: 0.01, n: 2.4 }));
  inner[0].hw = inner[inner.length - 1].hw = 0.003;
  b.part(loft(inner, 28), {}, PAL.white, SURF.gloss);
  // Rolled rim following the outline of the tub.
  b.pipe('accent', loftRimPoints(TUB, 0.93, 0.995, 3), 0.045, undefined, undefined, { rad: 10, closed: true });
  // Four brass claw feet.
  const foot = (x: number, z: number) => {
    const sx = Math.sign(x);
    const sz = Math.sign(z);
    b.pipe('detail', [[x * 0.8, 0.48, z * 0.96], [x, 0.38, z], [x * 1.12, 0.26, z + sz * 0.06], [x * 1.1, 0.2, z + sz * 0.13]], 0.035, PAL.brass, SURF.metal, { rad: 8 });
    b.part(sphere(10, 8), { p: [x * 1.1 + sx * 0.0, 0.2, z + sz * 0.13], s: 0.05 }, PAL.brass, SURF.metal);
  };
  foot(0.3, 0.55);
  foot(-0.3, 0.55);
  foot(0.3, -0.6);
  foot(-0.3, -0.6);
  addAxle(b, 0.3, 0.66, 0.68, 0.032);
  addAxle(b, 0.34, -0.66, 0.7, 0.035);
  // Faucet: escutcheon, curved spout, hot/cold knobs.
  b.part(lathe([[0.07, 0], [0.07, 0.03], [0.04, 0.05], [0.03, 0.08]], 16), { p: [0, 0.78, 0.8] }, PAL.brass, SURF.metal);
  b.pipe('detail', [[0, 0.84, 0.8], [0, 1.05, 0.81], [0, 1.15, 0.9], [0, 1.1, 1.0], [0, 1.02, 1.03]], 0.03, PAL.brass, SURF.metal, { rad: 10 });
  b.partPair(sphere(12, 8), { p: [0.15, 0.88, 0.78], s: [0.05, 0.04, 0.05] }, PAL.red, SURF.gloss);
  b.part(sphere(12, 8), { p: [-0.15, 0.88, 0.78], s: [0.05, 0.04, 0.05] }, PAL.blue, SURF.gloss);
  // Soap bubbles heaped around the back and sides.
  const bubbles: [number, number, number, number][] = [
    [0.3, 0.92, -0.62, 0.1], [0.4, 0.9, -0.34, 0.08], [-0.34, 0.92, -0.55, 0.11], [-0.42, 0.9, -0.28, 0.08],
    [0.14, 0.97, -0.86, 0.09], [-0.12, 1.0, -0.84, 0.1], [0.3, 1.0, -0.78, 0.07], [0.0, 0.88, 0.1, 0.06],
    [0.36, 0.88, 0.0, 0.06], [-0.34, 0.88, 0.04, 0.07], [0.22, 1.02, -0.52, 0.06], [-0.28, 1.0, -0.74, 0.06],
  ];
  for (const [x, y, z, r] of bubbles) b.part(sphere(14, 10), { p: [x, y, z], s: r }, '#eaf6ff', SURF.gloss);
  // Tail pipes curling up out of the back.
  b.pipe('detail', [[0.2, 0.62, -0.95], [0.2, 0.66, -1.14], [0.21, 0.8, -1.22]], 0.045, PAL.chrome, SURF.chrome, { pair: true });
  addBell(b, [0.21, 0.82, -1.25], [0, 0.45, -1], 0.045);
  addBell(b, [-0.21, 0.82, -1.25], [0, 0.45, -1], 0.045);
  // Lamps.
  addLamp(b, [0.28, 0.8, 0.95], [0.2, 0.2, 1], 0.06, PAL.lampWhite);
  addLamp(b, [-0.28, 0.8, 0.95], [-0.2, 0.2, 1], 0.06, PAL.lampWhite);
  b.partPair(roundBox(0.12, 0.06, 0.03, 0.015), { p: [0.34, 0.74, -1.0], r: [0, 0.3, 0] }, PAL.lampRed, SURF.glow);
  // Rubber duck on the rim.
  b.part(sphere(14, 10), { p: [-0.38, 1.03, 0.5], s: [0.07, 0.06, 0.09] }, '#ffd23a', SURF.gloss);
  b.part(sphere(12, 8), { p: [-0.38, 1.12, 0.55], s: 0.05 }, '#ffd23a', SURF.gloss);
  b.part(sphere(10, 6), { p: [-0.38, 1.11, 0.6], s: [0.035, 0.015, 0.03] }, '#ff8a2a', SURF.gloss);
  const wheel: StyleLayout['wheel'] = { pos: [0, 1.06, 0.3], tilt: 0.8 };
  addColumn(b, wheel.pos, wheel.tilt, 0.3);
  return {
    front: { radius: 0.3, width: 0.17, rim: PAL.chrome, kind: 'retro', cap: PAL.red, x: 0.78, z: 0.66 },
    rear: { radius: 0.34, width: 0.22, rim: PAL.chrome, kind: 'retro', cap: PAL.red, x: 0.8, z: -0.66 },
    exhausts: [
      { pos: [0.21, 0.85, -1.3], tilt: 0.5 },
      { pos: [-0.21, 0.85, -1.3], tilt: 0.5 },
    ],
    hip: [0, 0.86, -0.3],
    wheel,
  };
};

export const STYLE_BUILDERS: StyleBuilder[] = [buildSprinter, buildMudlark, buildComet, buildSplash];

/**
 * The steering wheel (own mesh so it can turn): rim, three spokes, hub, and a
 * coloured marker at the top so the turning is easy to see. Lies in the XY plane.
 */
export function buildSteeringWheelGeometry(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const R = 0.15;
  const ring: V3[] = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    ring.push([Math.cos(a) * R, Math.sin(a) * R, 0]);
  }
  b.part(sweep(ring, 0.03, 20, 7, true), {}, PAL.black, SURF.rubber);
  const bar = capsule(1, 1, 8, 3);
  for (const a of [Math.PI * 1.5, Math.PI * 0.12, Math.PI * 0.88]) {
    b.part(bar, { p: [Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5, 0], r: [0, 0, a - Math.PI / 2], s: [0.022, R * 0.5, 0.016] }, PAL.steel, SURF.metal);
  }
  b.part(sphere(14, 10), { s: [0.05, 0.05, 0.04] }, PAL.chrome, SURF.chrome);
  b.part(roundBox(0.03, 0.045, 0.05, 0.012), { p: [0, R, 0] }, PAL.red, SURF.gloss);
  return b.build().detail!;
}

// Silence unused-import warnings for helpers kept for future tuning.
void roundCone;
void unitSphere;
