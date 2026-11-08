/**
 * Original low-poly karts built entirely from Three.js primitives (boxes,
 * cylinders, spheres, capsules, cones, tori). There are several body styles
 * (see KART_STYLES); every style shares the same driver.
 *
 * Model space: kart faces +Z, Y up, origin on the ground between the axles,
 * roughly 1.9 m long.
 *
 * Performance design (4 viewports x 4 karts at 60 fps):
 *  - Each style's geometry is built ONCE and cached; every kart of that style
 *    reuses the same BufferGeometries. Only the materials depend on color.
 *  - All static parts that share a material are merged into one geometry, so
 *    a whole kart is just 8 draw calls:
 *      paint + accent + trim (player-color tones) + neutral (fixed colors,
 *      via per-vertex colors) for the body, and 1 per wheel (4).
 *  - Lambert materials (cheap per-pixel lighting). Materials are cached per
 *    color, so two karts with the same color share them.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Nominal wheel radius. Kart views use it to convert speed into wheel spin.
 * Individual styles use slightly different radii (see KartModel.wheelRadii),
 * which only changes how fast the wheels look like they turn.
 */
const WHEEL_RADIUS = 0.3;

/** The selectable body styles. The index is what `buildKartModel` takes. */
export const KART_STYLES = [
  { id: 'sprinter', name: 'Sprinter', blurb: 'Classic open-wheel kart with a rear wing' },
  { id: 'mudlark', name: 'Mudlark', blurb: 'Chunky off-road buggy with a roll cage' },
  { id: 'comet', name: 'Comet', blurb: 'Sleek, low bullet with a tail fin' },
  { id: 'splash', name: 'Splash', blurb: 'Retro bathtub racer, faucet and all' },
] as const;

export interface KartModel {
  root: THREE.Group;
  /** Leans with cornering; contains everything except the wheels. */
  body: THREE.Group;
  /** Front wheel pivots (rotate .y to steer). */
  frontPivots: THREE.Group[];
  /** All 4 wheel meshes (rotate .x to spin). Order: front-right, front-left, rear-right, rear-left. */
  wheels: THREE.Mesh[];
  /** Radius of each wheel in `wheels` (same order). */
  wheelRadii: number[];
  /**
   * Empty marker objects (children of `body`, so they lean with it) at the tip
   * of each exhaust pipe. A boost flame should shoot along the marker's
   * local -Z axis (usually straight backwards; up-and-back for vertical stacks).
   */
  exhausts: THREE.Object3D[];
  /** Where the rear tires touch the ground, in `root`-local space (for drift sparks). */
  rearWheelContacts: THREE.Vector3[];
  /** Index into KART_STYLES this kart was built with. */
  style: number;
}

// ---------------------------------------------------------------------------
// Fixed (non player) colors, used through per-vertex colors in the "neutral" mesh
// ---------------------------------------------------------------------------
const C = {
  black: '#1c1d22',
  tire: '#1a1b20',
  rubber: '#2b2d33',
  metal: '#b9bec8',
  chrome: '#dfe3ea',
  brass: '#d4a73a',
  visor: '#1b2c44',
  glove: '#26272d',
  scarf: '#f3ead7',
  seat: '#2e3038',
  glass: '#9fd8f5',
  lamp: '#ffe9a6',
  enamel: '#f4f1e8',
  bubble: '#e3f3ff',
  mustard: '#e0b23c',
  white: '#f2f2f2',
  red: '#d8433b',
  blue: '#3b7bd8',
} as const;

// ---------------------------------------------------------------------------
// Geometry building helpers
// ---------------------------------------------------------------------------

/** Material "buckets": every part goes into one, and each bucket becomes one merged mesh. */
type Bucket = 'paint' | 'accent' | 'trim' | 'neutral';
const BUCKETS: Bucket[] = ['paint', 'accent', 'trim', 'neutral'];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _color = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Collects transformed copies of primitive geometries per bucket, then merges
 * each bucket into a single BufferGeometry.
 */
class PartBuilder {
  private parts: Record<Bucket, THREE.BufferGeometry[]> = { paint: [], accent: [], trim: [], neutral: [] };

  /**
   * Add a primitive at a position, with optional Euler rotation (radians,
   * XYZ order) and scale. `color` is required for the neutral bucket.
   */
  add(
    bucket: Bucket,
    geo: THREE.BufferGeometry,
    pos: [number, number, number],
    rot: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1],
    color?: string,
  ): void {
    _e.set(rot[0], rot[1], rot[2]);
    _q.setFromEuler(_e);
    _m.compose(_p.set(...pos), _q, _s.set(...scale));
    this.push(bucket, geo, _m, color);
  }

  /** Same as `add`, plus a copy mirrored to the other side (x -> -x). */
  addPair(
    bucket: Bucket,
    geo: THREE.BufferGeometry,
    pos: [number, number, number],
    rot: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1],
    color?: string,
  ): void {
    this.add(bucket, geo, pos, rot, scale, color);
    // Mirroring a rotation about the YZ plane flips the sign of the Y and Z angles.
    this.add(bucket, geo, [-pos[0], pos[1], pos[2]], [rot[0], -rot[1], -rot[2]], scale, color);
  }

  /** A round tube (cylinder) from point a to point b, e.g. an arm or a roll-cage bar. */
  tube(bucket: Bucket, a: THREE.Vector3, b: THREE.Vector3, radius: number, color?: string, sides = 6): void {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(radius, radius, len, sides, 1);
    _q.setFromUnitVectors(UP, dir.normalize());
    _m.compose(_p.addVectors(a, b).multiplyScalar(0.5), _q, _s.set(1, 1, 1));
    this.push(bucket, geo, _m, color);
  }

  /** `tube` plus its mirror image across x = 0. */
  tubePair(bucket: Bucket, a: THREE.Vector3, b: THREE.Vector3, radius: number, color?: string): void {
    this.tube(bucket, a, b, radius, color);
    this.tube(bucket, new THREE.Vector3(-a.x, a.y, a.z), new THREE.Vector3(-b.x, b.y, b.z), radius, color);
  }

  private push(bucket: Bucket, geo: THREE.BufferGeometry, m: THREE.Matrix4, color?: string): void {
    // Non-indexed so every primitive type (indexed or not) can be merged together.
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    if (bucket === 'neutral') {
      if (!color) throw new Error('neutral parts need a color');
      paintVertices(g, color);
    }
    this.parts[bucket].push(g);
  }

  /** Merge everything; returns one geometry per non-empty bucket. */
  build(): Partial<Record<Bucket, THREE.BufferGeometry>> {
    const out: Partial<Record<Bucket, THREE.BufferGeometry>> = {};
    for (const b of BUCKETS) {
      const list = this.parts[b];
      if (list.length === 0) continue;
      const merged = mergeGeometries(list, false);
      if (!merged) throw new Error(`could not merge kart bucket "${b}"`);
      merged.computeBoundingSphere();
      out[b] = merged;
      list.forEach((g) => g.dispose());
    }
    return out;
  }
}

/** Give every vertex of `g` the same color (stored in a "color" attribute). */
function paintVertices(g: THREE.BufferGeometry, hex: string): void {
  _color.set(hex); // Color.set converts sRGB hex to the linear working space already
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _color.r;
    arr[i * 3 + 1] = _color.g;
    arr[i * 3 + 2] = _color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// Commonly reused unit primitives (scaled/positioned per part).
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
/** Cylinder whose axis runs along X (like an axle). */
const cylX = (r: number, len: number, sides = 10) => new THREE.CylinderGeometry(r, r, len, sides).rotateZ(Math.PI / 2);
/** Cylinder whose axis runs along Z (like a pipe pointing backwards). */
const cylZ = (r: number, len: number, sides = 10) => new THREE.CylinderGeometry(r, r, len, sides).rotateX(Math.PI / 2);
const sphere = (r: number, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);

// ---------------------------------------------------------------------------
// Wheels
// ---------------------------------------------------------------------------

interface WheelSpec {
  radius: number;
  width: number;
  hub: string;
  /** Draw a white ring on the sidewall (retro tires). */
  whitewall?: boolean;
}

/**
 * One wheel = tire + hub disc + a cross of spokes, merged into a single
 * vertex-colored geometry (1 draw call). Axle along X. The spokes stick out
 * slightly past the hub so the spin is visible from behind and the side.
 */
function buildWheelGeometry(w: WheelSpec): THREE.BufferGeometry {
  const b = new PartBuilder();
  const r = w.radius;
  b.add('neutral', cylX(r, w.width, 16), [0, 0, 0], undefined, undefined, C.tire);
  if (w.whitewall) b.add('neutral', cylX(r * 0.78, w.width + 0.01, 16), [0, 0, 0], undefined, undefined, C.white);
  b.add('neutral', cylX(r * 0.55, w.width + 0.02, 12), [0, 0, 0], undefined, undefined, w.hub);
  const spokeColor = '#' + new THREE.Color(w.hub).multiplyScalar(0.55).getHexString();
  b.add('neutral', box(w.width + 0.04, r * 1.05, r * 0.16), [0, 0, 0], undefined, undefined, spokeColor);
  b.add('neutral', box(w.width + 0.04, r * 0.16, r * 1.05), [0, 0, 0], undefined, undefined, spokeColor);
  return b.build().neutral!;
}

// ---------------------------------------------------------------------------
// Driver (shared by all styles)
// ---------------------------------------------------------------------------

/** Where the driver sits: hip point and steering wheel center (body space). */
interface DriverSpot {
  hipY: number;
  hipZ: number;
  wheelY: number;
  wheelZ: number;
}

/**
 * A chunky, cartoon-proportioned driver designed to read well from behind at
 * small split-screen sizes: big helmet with a player-color stripe over the
 * top, dark visor, wide shoulders, arms reaching to the wheel, and a scarf
 * trailing behind.
 */
function addDriver(b: PartBuilder, d: DriverSpot): void {
  const { hipY: y, hipZ: z } = d;

  // Steering wheel + column. Tilted so its top leans towards the driver.
  b.add('neutral', new THREE.TorusGeometry(0.15, 0.028, 6, 16), [0, d.wheelY, d.wheelZ], [-0.45, 0, 0], undefined, C.black);
  b.tube('neutral', v(0, d.wheelY - 0.03, d.wheelZ + 0.02), v(0, d.wheelY - 0.28, d.wheelZ + 0.32), 0.025, C.black);

  // Torso (racing suit, player color), leaning forward a little.
  b.add('paint', new THREE.CapsuleGeometry(0.2, 0.22, 4, 10), [0, y + 0.24, z + 0.02], [0.18, 0, 0], [1.05, 1, 0.85]);
  // Shoulders: a wide horizontal capsule in the darker trim tone.
  const shY = y + 0.43;
  const shZ = z + 0.07;
  b.add('trim', new THREE.CapsuleGeometry(0.1, 0.32, 4, 8), [0, shY, shZ], [0, 0, Math.PI / 2]);

  // Arms: shoulder -> elbow -> hand on the wheel rim.
  const shoulder = v(0.23, shY, shZ);
  const hand = v(0.13, d.wheelY + 0.03, d.wheelZ - 0.03);
  const elbow = v(0.29, (shoulder.y + hand.y) / 2 - 0.08, (shoulder.z + hand.z) / 2 - 0.02);
  b.tubePair('paint', shoulder, elbow, 0.062);
  b.tubePair('paint', elbow, hand, 0.055);
  b.addPair('neutral', sphere(0.07, 8, 6), [hand.x, hand.y, hand.z], undefined, undefined, C.glove);

  // Scarf: a ring around the neck and two tails fluttering backwards.
  const neckY = y + 0.53;
  b.add('neutral', new THREE.TorusGeometry(0.12, 0.05, 6, 12), [0, neckY, z + 0.04], [Math.PI / 2, 0, 0], undefined, C.scarf);
  b.add('neutral', box(0.13, 0.035, 0.32), [0.07, neckY - 0.02, z - 0.2], [-0.35, 0.15, 0.1], undefined, C.scarf);
  b.add('neutral', box(0.1, 0.03, 0.22), [0.13, neckY + 0.04, z - 0.42], [0.25, 0.3, 0.2], undefined, C.scarf);

  // Helmet (light accent tone) with a player-color stripe front-to-back over the top.
  const headY = y + 0.71;
  const headZ = z + 0.06;
  const hr = 0.22;
  b.add('accent', new THREE.SphereGeometry(hr, 16, 12), [0, headY, headZ]);
  // Half torus in the YZ plane = an arc over the top of the helmet.
  b.add('paint', new THREE.TorusGeometry(hr + 0.004, 0.045, 6, 18, Math.PI), [0, headY, headZ], [0, Math.PI / 2, 0]);
  // Visor: a band cut out of a slightly bigger sphere, facing forward.
  b.add(
    'neutral',
    new THREE.SphereGeometry(hr + 0.012, 14, 6, Math.PI / 2 - 0.95, 1.9, 1.2, 0.55),
    [0, headY, headZ],
    undefined,
    undefined,
    C.visor,
  );
  // Helmet chin bar / lower rim so the head doesn't look like a plain ball.
  b.add('trim', new THREE.TorusGeometry(hr * 0.86, 0.035, 5, 16), [0, headY - 0.12, headZ], [Math.PI / 2, 0, 0]);
}

// ---------------------------------------------------------------------------
// Body styles
// ---------------------------------------------------------------------------

interface WheelSpot {
  x: number;
  z: number;
}

/** Everything a style defines besides its merged body geometry. */
interface StyleLayout {
  front: WheelSpec & WheelSpot;
  rear: WheelSpec & WheelSpot;
  /** Exhaust tips: position, plus rotation.x tilt (0 = flame straight back, >0 tilts it upward). */
  exhausts: { pos: [number, number, number]; tilt: number }[];
}

type StyleBuilder = (b: PartBuilder) => StyleLayout;

/** 0 – Sprinter: the classic open-wheel kart. Flat tray, side pods, nose fairing, big rear wing. */
const buildSprinter: StyleBuilder = (b) => {
  // Low floor tray in the dark trim tone, with the colored bodywork on top.
  b.add('trim', box(1.0, 0.07, 1.75), [0, 0.2, 0]);
  b.addPair('paint', box(0.26, 0.2, 0.82), [0.6, 0.32, 0.02], [0, 0, -0.08]);
  // Nose fairing sloping down toward the front, plus a front "number plate".
  b.add('paint', box(0.92, 0.18, 0.5), [0, 0.32, 1.02], [0.14, 0, 0]);
  b.add('accent', box(0.5, 0.3, 0.04), [0, 0.47, 0.78], [-0.5, 0, 0]);
  b.add('neutral', cylX(0.04, 1.15, 6), [0, 0.24, 1.3], undefined, undefined, C.rubber);
  // Seat, engine on the right, twin exhausts.
  b.add('neutral', box(0.5, 0.46, 0.14), [0, 0.5, -0.5], [-0.25, 0, 0], undefined, C.seat);
  b.add('neutral', box(0.38, 0.3, 0.36), [0.3, 0.4, -0.72], undefined, undefined, C.metal);
  b.add('neutral', cylZ(0.055, 0.34), [0.22, 0.46, -1.0], undefined, undefined, C.chrome);
  b.add('neutral', cylZ(0.055, 0.34), [0.38, 0.46, -1.0], undefined, undefined, C.chrome);
  b.add('neutral', cylX(0.045, 1.4, 6), [0, 0.25, -1.06], undefined, undefined, C.rubber);
  // Rear wing on struts, with player-color endplates.
  b.addPair('trim', box(0.05, 0.42, 0.05), [0.4, 0.66, -0.94]);
  b.add('accent', box(1.25, 0.05, 0.3), [0, 0.88, -0.97], [-0.08, 0, 0]);
  b.addPair('paint', box(0.04, 0.24, 0.36), [0.64, 0.86, -0.97]);
  addDriver(b, { hipY: 0.48, hipZ: -0.34, wheelY: 0.74, wheelZ: 0.24 });
  return {
    front: { radius: 0.27, width: 0.22, hub: C.metal, x: 0.72, z: 0.68 },
    rear: { radius: 0.31, width: 0.32, hub: C.metal, x: 0.76, z: -0.68 },
    exhausts: [
      { pos: [0.22, 0.46, -1.17], tilt: 0 },
      { pos: [0.38, 0.46, -1.17], tilt: 0 },
    ],
  };
};

/** 1 – Mudlark: off-road buggy. Big knobbly wheels, raised tub, roll cage, light bar, upright stacks. */
const buildMudlark: StyleBuilder = (b) => {
  b.add('paint', box(1.0, 0.36, 1.45), [0, 0.6, -0.1]);
  b.add('paint', box(0.9, 0.26, 0.42), [0, 0.64, 0.8], [-0.12, 0, 0]);
  // Angled skid plate under the nose.
  b.add('neutral', box(0.82, 0.05, 0.5), [0, 0.42, 1.0], [-0.45, 0, 0], undefined, C.metal);
  // Fenders above every wheel (accent tone).
  b.addPair('accent', box(0.4, 0.06, 0.66), [0.78, 0.8, 0.72], [0.1, 0, 0]);
  b.addPair('accent', box(0.46, 0.06, 0.72), [0.8, 0.88, -0.7], [-0.1, 0, 0]);
  // Axle arms from the tub to the wheels.
  b.tubePair('trim', v(0.4, 0.5, 0.72), v(0.7, 0.36, 0.72), 0.04);
  b.tubePair('trim', v(0.4, 0.5, -0.7), v(0.7, 0.4, -0.7), 0.045);
  // Roll cage (trim tone): back hoop, front hoop, top rails and cross bars.
  const cageTop = 1.78;
  b.tubePair('trim', v(0.44, 0.78, -0.62), v(0.4, cageTop, -0.5), 0.04);
  b.tubePair('trim', v(0.44, 0.78, 0.32), v(0.38, cageTop - 0.08, 0.04), 0.04);
  b.tubePair('trim', v(0.4, cageTop, -0.5), v(0.38, cageTop - 0.08, 0.04), 0.04);
  b.tube('trim', v(-0.4, cageTop, -0.5), v(0.4, cageTop, -0.5), 0.04);
  b.tube('trim', v(-0.38, cageTop - 0.08, 0.04), v(0.38, cageTop - 0.08, 0.04), 0.04);
  // Light bar with three lamps on the front cross bar.
  b.add('neutral', box(0.72, 0.09, 0.1), [0, cageTop + 0.0, 0.08], undefined, undefined, C.black);
  for (const x of [-0.24, 0, 0.24]) b.add('neutral', box(0.15, 0.07, 0.03), [x, cageTop, 0.14], undefined, undefined, C.lamp);
  // Spare tire on the back, between the two upright exhaust stacks.
  b.add('neutral', cylZ(0.24, 0.13, 14), [0, 0.74, -0.9], undefined, undefined, C.tire);
  b.add('neutral', cylZ(0.13, 0.15, 10), [0, 0.74, -0.9], undefined, undefined, C.mustard);
  b.addPair('neutral', new THREE.CylinderGeometry(0.06, 0.07, 0.6, 8), [0.42, 1.0, -0.86], undefined, undefined, C.chrome);
  b.add('neutral', box(0.5, 0.42, 0.14), [0, 0.98, -0.5], [-0.2, 0, 0], undefined, C.seat);
  addDriver(b, { hipY: 0.74, hipZ: -0.34, wheelY: 1.0, wheelZ: 0.24 });
  return {
    front: { radius: 0.36, width: 0.3, hub: C.mustard, x: 0.8, z: 0.72 },
    rear: { radius: 0.4, width: 0.38, hub: C.mustard, x: 0.82, z: -0.7 },
    exhausts: [
      { pos: [0.42, 1.31, -0.86], tilt: 1.15 },
      { pos: [-0.42, 1.31, -0.86], tilt: 1.15 },
    ],
  };
};

/** 2 – Comet: a sleek, low bullet. Long rounded body, pointed nose cone, tail fin, one big nozzle. */
const buildComet: StyleBuilder = (b) => {
  // Main body: a capsule lying along Z, squashed to be wide and low.
  b.add('paint', new THREE.CapsuleGeometry(0.34, 1.2, 6, 14), [0, 0.38, 0], [Math.PI / 2, 0, 0], [1.25, 1, 0.7]);
  // Nose cone (pointing +Z) and a racing stripe along the top.
  b.add('accent', new THREE.ConeGeometry(0.2, 0.36, 14), [0, 0.37, 1.06], [Math.PI / 2, 0, 0], [1.25, 1, 0.7]);
  b.add('accent', box(0.14, 0.02, 1.2), [0, 0.615, 0.05]);
  // Low windscreen bubble ahead of the driver.
  b.add('neutral', new THREE.SphereGeometry(0.25, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0.56, 0.48], undefined, [1, 0.55, 1.1], C.glass);
  // Wheel arms and teardrop fenders over each wheel.
  b.tubePair('trim', v(0.35, 0.34, 0.75), v(0.62, 0.24, 0.75), 0.035);
  b.tubePair('trim', v(0.35, 0.34, -0.68), v(0.62, 0.27, -0.68), 0.035);
  const fender = new THREE.CapsuleGeometry(0.1, 0.34, 4, 8);
  b.addPair('accent', fender, [0.7, 0.53, 0.75], [Math.PI / 2, 0, 0], [1.3, 1, 0.55]);
  b.addPair('accent', fender, [0.72, 0.59, -0.68], [Math.PI / 2, 0, 0], [1.5, 1, 0.55]);
  // Swept-back tail fin.
  b.add('paint', box(0.05, 0.42, 0.42), [0, 0.74, -0.78], [-0.55, 0, 0]);
  b.add('accent', box(0.06, 0.08, 0.36), [0, 0.92, -0.92], [-0.55, 0, 0]);
  // Single round jet nozzle at the tail.
  b.add('neutral', cylZ(0.15, 0.22, 14), [0, 0.38, -1.0], undefined, undefined, C.chrome);
  b.add('neutral', cylZ(0.105, 0.24, 12), [0, 0.38, -1.0], undefined, undefined, C.black);
  b.add('neutral', box(0.46, 0.4, 0.12), [0, 0.6, -0.5], [-0.3, 0, 0], undefined, C.seat);
  addDriver(b, { hipY: 0.42, hipZ: -0.32, wheelY: 0.66, wheelZ: 0.24 });
  return {
    front: { radius: 0.24, width: 0.2, hub: C.chrome, x: 0.7, z: 0.75 },
    rear: { radius: 0.27, width: 0.26, hub: C.chrome, x: 0.72, z: -0.68 },
    exhausts: [{ pos: [0, 0.38, -1.13], tilt: 0 }],
  };
};

/** 3 – Splash: a retro bathtub on wheels. Rolled rim, brass feet and faucet, soap bubbles, whitewalls. */
const buildSplash: StyleBuilder = (b) => {
  const rimY = 0.72;
  // Tub: the bottom half of a stretched sphere (open at the top), painted on the outside.
  b.add('paint', new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), [0, rimY, -0.05], undefined, [0.5, 0.46, 0.95]);
  // Enamel deck covering the opening, and the rolled rim around it.
  b.add('neutral', new THREE.CylinderGeometry(1, 1, 0.02, 20), [0, rimY - 0.04, -0.05], undefined, [0.47, 1, 0.92], C.enamel);
  b.add('accent', new THREE.TorusGeometry(1, 0.07, 6, 28), [0, rimY, -0.05], [Math.PI / 2, 0, 0], [0.5, 0.95, 1]);
  // Four brass claw feet.
  for (const [x, z] of [[0.28, 0.5], [-0.28, 0.5], [0.28, -0.6], [-0.28, -0.6]] as const) {
    b.add('neutral', new THREE.ConeGeometry(0.07, 0.16, 8), [x, 0.3, z], [Math.PI, 0, 0], undefined, C.brass);
  }
  // Axles from the tub out to the wheels.
  b.add('trim', cylX(0.035, 1.5, 6), [0, 0.3, 0.66]);
  b.add('trim', cylX(0.035, 1.56, 6), [0, 0.34, -0.66]);
  // Faucet hood ornament: riser, spout and hot/cold knobs.
  b.add('neutral', new THREE.CylinderGeometry(0.035, 0.035, 0.26, 8), [0, rimY + 0.13, 0.82], undefined, undefined, C.brass);
  b.add('neutral', new THREE.CylinderGeometry(0.03, 0.03, 0.26, 8), [0, rimY + 0.23, 0.92], [1.2, 0, 0], undefined, C.brass);
  b.add('neutral', sphere(0.045, 8, 6), [0.13, rimY + 0.05, 0.8], undefined, undefined, C.red);
  b.add('neutral', sphere(0.045, 8, 6), [-0.13, rimY + 0.05, 0.8], undefined, undefined, C.blue);
  // Soap bubbles heaped around the back of the rim.
  const bubbles: [number, number, number, number][] = [
    [0.34, 0.07, -0.55, 0.09],
    [0.22, 0.1, -0.78, 0.11],
    [-0.3, 0.08, -0.62, 0.1],
    [-0.12, 0.09, -0.86, 0.08],
    [0.05, 0.13, -0.84, 0.07],
  ];
  for (const [x, dy, z, r] of bubbles) b.add('neutral', sphere(r, 8, 6), [x, rimY + dy, z], undefined, undefined, C.bubble);
  // Twin chrome pipes curling up out of the back.
  b.addPair('neutral', cylZ(0.05, 0.4), [0.2, 0.5, -0.98], [0.5, 0, 0], undefined, C.chrome);
  addDriver(b, { hipY: 0.6, hipZ: -0.3, wheelY: 0.86, wheelZ: 0.3 });
  return {
    front: { radius: 0.3, width: 0.17, hub: C.red, x: 0.78, z: 0.66, whitewall: true },
    rear: { radius: 0.34, width: 0.22, hub: C.red, x: 0.8, z: -0.66, whitewall: true },
    exhausts: [
      { pos: [0.2, 0.6, -1.15], tilt: 0.5 },
      { pos: [-0.2, 0.6, -1.15], tilt: 0.5 },
    ],
  };
};

const STYLE_BUILDERS: StyleBuilder[] = [buildSprinter, buildMudlark, buildComet, buildSplash];

/** Shared, cached data for one style: merged body geometries + wheels + layout. */
interface StyleAssets {
  body: Partial<Record<Bucket, THREE.BufferGeometry>>;
  frontWheel: THREE.BufferGeometry;
  rearWheel: THREE.BufferGeometry;
  layout: StyleLayout;
}

const styleCache = new Map<number, StyleAssets>();

function getStyleAssets(style: number): StyleAssets {
  let assets = styleCache.get(style);
  if (!assets) {
    const b = new PartBuilder();
    const layout = STYLE_BUILDERS[style](b);
    assets = {
      body: b.build(),
      frontWheel: buildWheelGeometry(layout.front),
      rearWheel: buildWheelGeometry(layout.rear),
      layout,
    };
    styleCache.set(style, assets);
  }
  return assets;
}

// ---------------------------------------------------------------------------
// Materials (cached per player color)
// ---------------------------------------------------------------------------

/** Fixed-color parts and all wheels use per-vertex colors with one shared material. */
const neutralMat = new THREE.MeshLambertMaterial({ vertexColors: true });

const materialCache = new Map<string, Record<Exclude<Bucket, 'neutral'>, THREE.MeshLambertMaterial>>();

/** Paint = player color; accent = lighter tint of it; trim = darker shade of it. */
function getColorMaterials(colorHex: string) {
  let mats = materialCache.get(colorHex);
  if (!mats) {
    const base = new THREE.Color(colorHex);
    mats = {
      paint: new THREE.MeshLambertMaterial({ color: base }),
      accent: new THREE.MeshLambertMaterial({ color: base.clone().lerp(new THREE.Color('#ffffff'), 0.5) }),
      trim: new THREE.MeshLambertMaterial({ color: base.clone().lerp(new THREE.Color('#15161b'), 0.6) }),
    };
    materialCache.set(colorHex, mats);
  }
  return mats;
}

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

/**
 * Build one kart. `style` is an index into KART_STYLES (wraps around, so any
 * integer is safe). Cheap to call repeatedly: geometry is shared per style.
 */
export function buildKartModel(colorHex: string, style = 0): KartModel {
  const n = STYLE_BUILDERS.length;
  style = ((Math.trunc(style) % n) + n) % n;
  const assets = getStyleAssets(style);
  const colorMats = getColorMaterials(colorHex);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // Body: one mesh per material bucket.
  for (const bucket of BUCKETS) {
    const geo = assets.body[bucket];
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, bucket === 'neutral' ? neutralMat : colorMats[bucket]);
    mesh.castShadow = true;
    mesh.name = `kart-${bucket}`;
    body.add(mesh);
  }

  // Exhaust markers (empty objects; flames go along local -Z).
  const exhausts: THREE.Object3D[] = assets.layout.exhausts.map(({ pos, tilt }, i) => {
    const marker = new THREE.Object3D();
    marker.name = `exhaust-${i}`;
    marker.position.set(...pos);
    marker.rotation.x = tilt;
    body.add(marker);
    return marker;
  });

  // Wheels (children of root, not body, so they don't lean).
  const wheels: THREE.Mesh[] = [];
  const wheelRadii: number[] = [];
  const frontPivots: THREE.Group[] = [];
  const rearWheelContacts: THREE.Vector3[] = [];
  const { front, rear } = assets.layout;
  const spots: [WheelSpec & WheelSpot, number, THREE.BufferGeometry, boolean][] = [
    [front, 1, assets.frontWheel, true],
    [front, -1, assets.frontWheel, true],
    [rear, 1, assets.rearWheel, false],
    [rear, -1, assets.rearWheel, false],
  ];
  for (const [spec, side, geo, isFront] of spots) {
    const pivot = new THREE.Group();
    pivot.position.set(spec.x * side, spec.radius, spec.z);
    root.add(pivot);
    const wheel = new THREE.Mesh(geo, neutralMat);
    wheel.castShadow = true;
    pivot.add(wheel);
    wheels.push(wheel);
    wheelRadii.push(spec.radius);
    if (isFront) frontPivots.push(pivot);
    else rearWheelContacts.push(new THREE.Vector3(spec.x * side, 0, spec.z));
  }

  return { root, body, frontPivots, wheels, wheelRadii, exhausts, rearWheelContacts, style };
}

export { WHEEL_RADIUS };
