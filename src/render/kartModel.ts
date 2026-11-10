/**
 * Smooth, glossy procedural karts and drivers, built entirely from code (no
 * model or image files). Four body styles (see KART_STYLES) x eight drivers
 * (see CHARACTERS in shared/characters.ts).
 *
 * Model space: kart faces +Z, Y up, origin on the ground between the axles,
 * roughly 1.9 m long.
 *
 * How it is organised (the heavy lifting is in src/render/kart/):
 *  - geo.ts       geometry toolkit (smooth lofts, lathes, sweeps, merging)
 *  - wheels.ts    tyre + rim + brake disc + spokes
 *  - bodies.ts    the four bodies
 *  - drivers.ts   the eight drivers (torso / head / arm pieces)
 *  - materials.ts clear-coated paint + one shared per-vertex PBR material
 *  - driverRig.ts animation of the driver (used by KartView)
 *
 * Performance design (4 viewports x 4 karts at 60 fps):
 *  - Geometry is built ONCE per (body, quality) and per (driver, quality) and
 *    shared by every kart. Only the paint materials depend on the player colour.
 *  - Static parts that share a material are merged, so a whole kart is
 *    3 body meshes (paint, accent, detail) + 4 wheels + steering wheel +
 *    torso, head and 2 arms = 12 draw calls.
 */
import * as THREE from 'three';
import { CHARACTERS, DEFAULT_LOADOUT } from '../shared/characters';
import { PartBuilder, withDetail, type Bucket } from './kart/geo';
import { STYLE_BUILDERS, buildSteeringWheelGeometry, type StyleLayout } from './kart/bodies';
import { buildDriverGeometries, NECK, SHOULDER_R, type DriverGeometries } from './kart/drivers';
import { getDetailMaterial, getPaintMaterials } from './kart/materials';
import { buildWheelGeometry } from './kart/wheels';

/**
 * Nominal wheel radius. Kart views use it to convert speed into wheel spin.
 * Individual styles use slightly different radii (see KartModel.wheelRadii).
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

  // --- driver rig (see kart/driverRig.ts for the animation) ---
  /** Index into CHARACTERS. */
  character: number;
  /** Sits at the hip; scaled by the character's size. Child of `body`. */
  driver: THREE.Group;
  /** Torso pivot (origin at the hip). Child of `driver`. */
  torso: THREE.Group;
  /** Head pivot (origin at the neck). Child of `torso`. */
  head: THREE.Group;
  /** Shoulder pivots [left, right] (children of `torso`); the hand is at local +Z. */
  arms: THREE.Group[];
  /** Spin this around its local Z to turn the steering wheel. */
  steeringWheel: THREE.Object3D;
  /** Steering wheel centre and tilt in body space, and the radius where the hands grip. */
  wheelSpec: { pos: THREE.Vector3; tilt: number; handRadius: number };
}

// ---------------------------------------------------------------------------
// Quality level (Low = fewer segments, no clear coat)
// ---------------------------------------------------------------------------

export type KartDetail = 'high' | 'low';
let currentDetail: KartDetail = 'high';

/** Choose the level of detail used by karts built from now on (call it when the quality preset changes, before building karts). */
export function setKartDetail(d: KartDetail): void {
  currentDetail = d;
}
export function getKartDetail(): KartDetail {
  return currentDetail;
}

// ---------------------------------------------------------------------------
// Cached shared geometry
// ---------------------------------------------------------------------------

interface StyleAssets {
  body: Partial<Record<Bucket, THREE.BufferGeometry>>;
  wheels: [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry];
  steering: THREE.BufferGeometry;
  layout: StyleLayout;
}

const styleCache = new Map<string, StyleAssets>();

function getStyleAssets(style: number, high: boolean): StyleAssets {
  const key = `${style}|${high ? 1 : 0}`;
  let a = styleCache.get(key);
  if (!a) {
    a = withDetail(high ? 0.8 : 0.5, () => {
      const b = new PartBuilder();
      const layout = STYLE_BUILDERS[style](b, high);
      return {
        body: b.build(),
        wheels: [
          buildWheelGeometry(layout.front, false, high),
          buildWheelGeometry(layout.front, true, high),
          buildWheelGeometry(layout.rear, false, high),
          buildWheelGeometry(layout.rear, true, high),
        ] as StyleAssets['wheels'],
        steering: buildSteeringWheelGeometry(),
        layout,
      };
    });
    styleCache.set(key, a);
  }
  return a;
}

const driverCache = new Map<string, DriverGeometries>();

function getDriverGeometries(character: number, high: boolean): DriverGeometries {
  const key = `${character}|${high ? 1 : 0}`;
  let g = driverCache.get(key);
  if (!g) {
    g = withDetail(high ? 0.8 : 0.5, () => buildDriverGeometries(CHARACTERS[character].look));
    driverCache.set(key, g);
  }
  return g;
}

/** Triangle count of one kart (body + 4 wheels + steering wheel + driver), for the preview page and tests. */
export function kartTriangleCount(style: number, character: number, detail: KartDetail = currentDetail): number {
  const high = detail === 'high';
  const a = getStyleAssets(style, high);
  const d = getDriverGeometries(character, high);
  const tri = (g?: THREE.BufferGeometry) => (g ? (g.index ? g.index.count : g.getAttribute('position').count) / 3 : 0);
  let n = tri(a.body.paint) + tri(a.body.accent) + tri(a.body.detail) + tri(a.steering) + tri(d.torso) + tri(d.head) + 2 * tri(d.arm);
  n += 2 * tri(a.wheels[0]) + 2 * tri(a.wheels[2]);
  return n;
}

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

/**
 * Build one kart. `style` is an index into KART_STYLES and `character` an index
 * into CHARACTERS (both wrap around, so any integer is safe). Cheap to call
 * repeatedly: geometry is shared.
 */
export function buildKartModel(
  colorHex: string,
  style = 0,
  character: number = DEFAULT_LOADOUT.character,
  detail: KartDetail = currentDetail,
): KartModel {
  const wrap = (v: number, n: number) => ((Math.trunc(v) % n) + n) % n;
  style = wrap(style, STYLE_BUILDERS.length);
  character = wrap(character, CHARACTERS.length);
  const high = detail === 'high';
  const assets = getStyleAssets(style, high);
  const paint = getPaintMaterials(colorHex, high);
  const detailMat = getDetailMaterial();

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.name = name;
    return mesh;
  };

  // Bodywork: paint, accent, detail.
  if (assets.body.paint) body.add(mk(assets.body.paint, paint.paint, 'kart-paint'));
  if (assets.body.accent) body.add(mk(assets.body.accent, paint.accent, 'kart-accent'));
  if (assets.body.detail) body.add(mk(assets.body.detail, detailMat, 'kart-detail'));

  // Exhaust markers (empty objects; flames go along local -Z).
  const exhausts: THREE.Object3D[] = assets.layout.exhausts.map(({ pos, tilt }, i) => {
    const marker = new THREE.Object3D();
    marker.name = `exhaust-${i}`;
    marker.position.set(...pos);
    marker.rotation.x = tilt;
    body.add(marker);
    return marker;
  });

  // Steering wheel: a tilted pivot with the spinning wheel inside.
  const { wheel } = assets.layout;
  const wheelTilt = new THREE.Group();
  wheelTilt.position.set(...wheel.pos);
  wheelTilt.rotation.x = wheel.tilt;
  body.add(wheelTilt);
  const steeringWheel = mk(assets.steering, detailMat, 'steering-wheel');
  wheelTilt.add(steeringWheel);

  // Driver: root at the hip, scaled by the character; torso > head + arms.
  const look = CHARACTERS[character].look;
  const dg = getDriverGeometries(character, high);
  const driver = new THREE.Group();
  driver.name = 'driver';
  driver.position.set(...assets.layout.hip);
  driver.scale.setScalar(look.scale);
  body.add(driver);
  const torso = new THREE.Group();
  torso.add(mk(dg.torso, detailMat, 'driver-torso'));
  driver.add(torso);
  const head = new THREE.Group();
  head.position.set(...NECK);
  head.add(mk(dg.head, detailMat, 'driver-head'));
  torso.add(head);
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(SHOULDER_R[0] * side, SHOULDER_R[1], SHOULDER_R[2]);
    arm.scale.x = side; // the left arm is the mirrored right arm
    arm.add(mk(dg.arm, detailMat, side < 0 ? 'driver-arm-l' : 'driver-arm-r'));
    torso.add(arm);
    arms.push(arm);
  }

  // Wheels (children of root, not body, so they don't lean).
  const wheels: THREE.Mesh[] = [];
  const wheelRadii: number[] = [];
  const frontPivots: THREE.Group[] = [];
  const rearWheelContacts: THREE.Vector3[] = [];
  const { front, rear } = assets.layout;
  const spots = [
    { spec: front, side: 1, geo: assets.wheels[0], isFront: true },
    { spec: front, side: -1, geo: assets.wheels[1], isFront: true },
    { spec: rear, side: 1, geo: assets.wheels[2], isFront: false },
    { spec: rear, side: -1, geo: assets.wheels[3], isFront: false },
  ];
  for (const { spec, side, geo, isFront } of spots) {
    const pivot = new THREE.Group();
    pivot.position.set(spec.x * side, spec.radius, spec.z);
    root.add(pivot);
    const w = mk(geo, detailMat, 'wheel');
    pivot.add(w);
    wheels.push(w);
    wheelRadii.push(spec.radius);
    if (isFront) frontPivots.push(pivot);
    else rearWheelContacts.push(new THREE.Vector3(spec.x * side, 0, spec.z));
  }

  return {
    root, body, frontPivots, wheels, wheelRadii, exhausts, rearWheelContacts, style,
    character, driver, torso, head, arms, steeringWheel,
    wheelSpec: { pos: new THREE.Vector3(...wheel.pos), tilt: wheel.tilt, handRadius: 0.15 },
  };
}

export { WHEEL_RADIUS };
