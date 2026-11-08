/**
 * Visuals for the M2 test ground: grass, the oval road with curbs, a
 * checkered start line, cones and trees for a sense of speed.
 * Repeated objects use InstancedMesh (one draw call for many copies).
 */
import * as THREE from 'three';
import { TEST_OVAL, distanceToOvalCenterline, ovalCenterline } from '../sim/ground';
import { checkerTexture, curbTexture, grassTexture, roadTexture, seededRandom } from './textures';

type P2 = { x: number; z: number };

/**
 * Build a flat ribbon following a closed centerline, between lateral offsets
 * `a` and `b` (negative = left of travel direction). U runs across, V along
 * (one texture repeat every `vRepeat` metres).
 */
export function buildRibbon(points: P2[], a: number, b: number, y: number, vRepeat: number): THREE.BufferGeometry {
  if (a > b) [a, b] = [b, a]; // keep triangle winding facing up
  const n = points.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let dist = 0;
  for (let i = 0; i <= n; i++) {
    const p = points[i % n];
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    // Tangent from neighbours; left normal = (tz, -tx) rotated so + is right of travel.
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    const rx = -tz; // right of travel (matches sim rightOf)
    const rz = tx;
    if (i > 0) dist += Math.hypot(p.x - points[(i - 1) % n].x, p.z - points[(i - 1) % n].z);
    pos.push(p.x + rx * a, y, p.z + rz * a, p.x + rx * b, y, p.z + rz * b);
    uv.push(0, dist / vRepeat, 1, dist / vRepeat);
    if (i < n) {
      const k = i * 2;
      // Counter-clockwise seen from above -> front face points up.
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildTestGround(scene: THREE.Scene): void {
  const { width: W, radius: R, extent } = TEST_OVAL;
  const line = ovalCenterline(48);

  // Grass
  const grassTex = grassTexture();
  grassTex.repeat.set(extent / 4, extent / 4);
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(extent * 2, extent * 2).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: grassTex }),
  );
  grass.receiveShadow = true;
  scene.add(grass);

  // Road + curbs
  const road = new THREE.Mesh(buildRibbon(line, -W / 2, W / 2, 0.02, 10), new THREE.MeshLambertMaterial({ map: roadTexture() }));
  road.receiveShadow = true;
  scene.add(road);
  const curbMat = new THREE.MeshLambertMaterial({ map: curbTexture() });
  for (const side of [-1, 1]) {
    const curb = new THREE.Mesh(buildRibbon(line, side * (W / 2), side * (W / 2 + 1.1), 0.03, 2), curbMat);
    curb.receiveShadow = true;
    scene.add(curb);
  }

  // Start/finish line across the right straight at z = 0
  const start = new THREE.Mesh(
    new THREE.PlaneGeometry(W, 2).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: checkerTexture() }),
  );
  (start.material as THREE.MeshLambertMaterial).map!.repeat.set(W / 2, 1);
  start.position.set(R, 0.04, 0);
  scene.add(start);

  // Cones along the outside of the curves
  const coneGeo = new THREE.ConeGeometry(0.35, 0.9, 8).translate(0, 0.45, 0);
  const cones = new THREE.InstancedMesh(coneGeo, new THREE.MeshLambertMaterial({ color: '#ff7a1a' }), 200);
  const m = new THREE.Matrix4();
  let ci = 0;
  for (let i = 0; i < line.length && ci < 200; i += 2) {
    const p = line[i];
    if (Math.abs(p.z) < TEST_OVAL.halfStraight) continue; // only around curves
    // Push outward from the curve's center.
    const cz = p.z > 0 ? TEST_OVAL.halfStraight : -TEST_OVAL.halfStraight;
    const len = Math.hypot(p.x, p.z - cz) || 1;
    const off = W / 2 + 3;
    const ox = (p.x / len) * off;
    const oz = ((p.z - cz) / len) * off;
    m.makeTranslation(p.x + ox, 0, p.z + oz);
    cones.setMatrixAt(ci++, m);
  }
  cones.count = ci;
  cones.castShadow = true;
  scene.add(cones);

  // Trees: trunk + crown instanced, scattered on grass away from the road
  const rnd = seededRandom(42);
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2, 6).translate(0, 1, 0);
  const crownGeo = new THREE.ConeGeometry(1.8, 4.5, 7).translate(0, 4, 0);
  const N = 260;
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#7a5230' }), N);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: '#2f7d3a' }), N);
  const color = new THREE.Color();
  let ti = 0;
  for (let tries = 0; tries < 4000 && ti < N; tries++) {
    const x = (rnd() * 2 - 1) * 300;
    const z = (rnd() * 2 - 1) * 300;
    if (distanceToOvalCenterline(x, z) < W / 2 + 8) continue;
    const s = 0.7 + rnd() * 0.8;
    m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6), new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(ti, m);
    crowns.setMatrixAt(ti, m);
    crowns.setColorAt(ti, color.setHSL(0.3 + rnd() * 0.06, 0.5, 0.25 + rnd() * 0.12));
    ti++;
  }
  trunks.count = crowns.count = ti;
  trunks.castShadow = crowns.castShadow = true;
  scene.add(trunks, crowns);

  // Distant low hills ring for a horizon
  const hillMat = new THREE.MeshLambertMaterial({ color: '#4f9a45' });
  const hillGeo = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const hills = new THREE.InstancedMesh(hillGeo, hillMat, 24);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 + rnd() * 0.2;
    const r = 340 + rnd() * 40;
    const s = 40 + rnd() * 50;
    m.compose(new THREE.Vector3(Math.cos(a) * r, -2, Math.sin(a) * r), new THREE.Quaternion(), new THREE.Vector3(s * 1.6, s * 0.5, s));
    hills.setMatrixAt(i, m);
  }
  scene.add(hills);
}
