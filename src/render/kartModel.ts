/**
 * An original low-poly kart built from primitives (boxes, cylinders, spheres).
 * Geometries are shared between all karts; only materials differ by color.
 *
 * Model space: kart faces +Z, Y up, origin on the ground between the axles.
 */
import * as THREE from 'three';

const WHEEL_RADIUS = 0.3;

// Shared geometries (created once). Wheel geometry has its axle along X baked
// in, so spinning is just rotation.x.
const geo = {
  chassis: new THREE.BoxGeometry(1.2, 0.22, 1.9),
  nose: new THREE.BoxGeometry(0.9, 0.2, 0.55),
  pod: new THREE.BoxGeometry(0.28, 0.24, 0.9),
  seat: new THREE.BoxGeometry(0.55, 0.5, 0.18),
  engine: new THREE.BoxGeometry(0.6, 0.32, 0.4),
  wing: new THREE.BoxGeometry(1.2, 0.06, 0.28),
  strut: new THREE.BoxGeometry(0.06, 0.32, 0.06),
  torso: new THREE.CapsuleGeometry(0.24, 0.3, 4, 10),
  head: new THREE.SphereGeometry(0.25, 16, 12),
  visor: new THREE.BoxGeometry(0.34, 0.12, 0.1),
  wheel: new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.28, 14).rotateZ(Math.PI / 2),
  hub: new THREE.CylinderGeometry(0.12, 0.12, 0.3, 8).rotateZ(Math.PI / 2),
  exhaust: new THREE.CylinderGeometry(0.07, 0.07, 0.3, 8).rotateX(Math.PI / 2),
  steeringWheel: new THREE.TorusGeometry(0.15, 0.03, 6, 14),
};

const darkMat = new THREE.MeshLambertMaterial({ color: '#23252b' });
const tireMat = new THREE.MeshLambertMaterial({ color: '#17181c' });
const metalMat = new THREE.MeshLambertMaterial({ color: '#b9bec8' });
const visorMat = new THREE.MeshLambertMaterial({ color: '#0e1a2b', emissive: '#10263f' });

export interface KartModel {
  root: THREE.Group;
  /** Leans with cornering; contains everything except the wheels. */
  body: THREE.Group;
  /** Front wheel pivots (rotate .y to steer). */
  frontPivots: THREE.Group[];
  /** All 4 wheel meshes (rotate .x to spin). */
  wheels: THREE.Mesh[];
}

export function buildKartModel(colorHex: string): KartModel {
  const paint = new THREE.MeshLambertMaterial({ color: colorHex });
  const accent = new THREE.MeshLambertMaterial({ color: new THREE.Color(colorHex).lerp(new THREE.Color('#ffffff'), 0.45) });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = body) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  add(geo.chassis, paint, 0, 0.32, 0);
  add(geo.nose, accent, 0, 0.36, 1.1);
  add(geo.pod, paint, 0.62, 0.36, 0.05);
  add(geo.pod, paint, -0.62, 0.36, 0.05);
  add(geo.seat, darkMat, 0, 0.62, -0.42);
  add(geo.engine, metalMat, 0, 0.55, -0.8);
  add(geo.exhaust, metalMat, 0.18, 0.55, -1.05);
  add(geo.exhaust, metalMat, -0.18, 0.55, -1.05);
  add(geo.strut, darkMat, 0.4, 0.75, -0.95);
  add(geo.strut, darkMat, -0.4, 0.75, -0.95);
  add(geo.wing, accent, 0, 0.93, -0.98);

  // Driver
  add(geo.torso, paint, 0, 0.88, -0.25);
  const head = add(geo.head, accent, 0, 1.3, -0.2);
  const visor = new THREE.Mesh(geo.visor, visorMat);
  visor.position.set(0, 0.02, 0.2);
  head.add(visor);
  const sw = add(geo.steeringWheel, darkMat, 0, 0.78, 0.28);
  sw.rotation.x = -0.9;

  // Wheels (not part of the leaning body)
  const wheels: THREE.Mesh[] = [];
  const frontPivots: THREE.Group[] = [];
  const wheelSpots: [number, number, boolean][] = [
    [0.72, 0.68, true],
    [-0.72, 0.68, true],
    [0.74, -0.7, false],
    [-0.74, -0.7, false],
  ];
  for (const [x, z, front] of wheelSpots) {
    const pivot = new THREE.Group();
    pivot.position.set(x, WHEEL_RADIUS, z);
    root.add(pivot);
    const w = new THREE.Mesh(geo.wheel, tireMat);
    w.castShadow = true;
    if (!front) w.scale.set(1.25, 1.08, 1.08); // chunkier rear tires
    pivot.add(w);
    const hub = new THREE.Mesh(geo.hub, metalMat);
    w.add(hub);
    wheels.push(w);
    if (front) frontPivots.push(pivot);
  }

  return { root, body, frontPivots, wheels };
}

export { WHEEL_RADIUS };
