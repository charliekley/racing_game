/**
 * Small man-made building blocks shared by the structures: shaded boxes, extruded
 * slabs, corrugated panels, gabled roofs, flags. Everything returns a geometry with
 * position / normal / color / sway so the batches can merge it.
 */
import * as THREE from 'three';
import { fromArrays, merge, paint, scratch, tubeGeo, ribbonGeo } from './geo';

const unitBox = new THREE.BoxGeometry(1, 1, 1);
unitBox.deleteAttribute('uv');

/**
 * A box centred at (x, y, z) of size w x h x d, turned by `ry`. Shaded: lighter on top,
 * darker toward the bottom (as if dirt and shadow collect there).
 */
export function boxPart(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.Color, ry = 0, aoBottom = 0.72): THREE.BufferGeometry {
  const g = unitBox.clone();
  paint(g, (p, n) => {
    const k = n.y > 0.5 ? 1.1 : n.y < -0.5 ? 0.5 : aoBottom + (1 - aoBottom) * (p.y + 0.5);
    return scratch.copy(color).multiplyScalar(k);
  });
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(w, h, d)));
  return g;
}

/** Flip all triangles if the average face normal points away from `dir`. */
export function orientTo(geo: THREE.BufferGeometry, dir: THREE.Vector3): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const idx = geo.getIndex()!;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const sum = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    n.crossVectors(b.sub(a), c.sub(a));
    sum.add(n);
  }
  if (sum.dot(dir) < 0) {
    for (let i = 0; i < idx.count; i += 3) {
      const t = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, t);
    }
    idx.needsUpdate = true;
  }
  geo.computeVertexNormals();
  return geo;
}

/** A surface between two equally long polylines (a ribbon from `a` to `b`), oriented toward `dir`. */
export function bridgeStrip(a: THREE.Vector3[], b: THREE.Vector3[], dir: THREE.Vector3): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = a.length;
  for (let i = 0; i < n; i++) pos.push(a[i].x, a[i].y, a[i].z, b[i].x, b[i].y, b[i].z);
  for (let i = 0; i < n - 1; i++) {
    const k = i * 2;
    idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  return orientTo(fromArrays(pos, idx), dir);
}

/**
 * A thin curved slab: a 2D cross-section (`profile` = [x, y] pairs, `thick` metres) extruded
 * along z from z0 to z1. Used for grandstand roofs and canopies.
 */
export function slab(profile: [number, number][], z0: number, z1: number, thick: number, top: THREE.Color, under: THREE.Color): THREE.BufferGeometry {
  const T0 = profile.map(([x, y]) => new THREE.Vector3(x, y, z0));
  const T1 = profile.map(([x, y]) => new THREE.Vector3(x, y, z1));
  const B0 = profile.map(([x, y]) => new THREE.Vector3(x, y - thick, z0));
  const B1 = profile.map(([x, y]) => new THREE.Vector3(x, y - thick, z1));
  const up = new THREE.Vector3(0, 1, 0);
  const parts = [
    paint(bridgeStrip(T0, T1, up), () => scratch.copy(top)),
    paint(bridgeStrip(B0, B1, up.clone().negate()), () => scratch.copy(under)),
    paint(bridgeStrip(T0, B0, new THREE.Vector3(0, 0, -1)), () => scratch.copy(under)),
    paint(bridgeStrip(T1, B1, new THREE.Vector3(0, 0, 1)), () => scratch.copy(under)),
    paint(bridgeStrip([T0[0], T1[0]], [B0[0], B1[0]], new THREE.Vector3(-1, 0, 0)), () => scratch.copy(under)),
    paint(bridgeStrip([T0[T0.length - 1], T1[T1.length - 1]], [B0[B0.length - 1], B1[B1.length - 1]], new THREE.Vector3(1, 0, 0)), () => scratch.copy(under)),
  ];
  return merge(parts);
}

/**
 * Corrugated sheet metal: a wavy strip in the x/y plane facing +z, `w` wide and `h` tall, with
 * ribs running vertically every `pitch` metres (containers, warehouse cladding). The smooth
 * normals along the waves are what make it read as ridged.
 */
export function corrugated(w: number, h: number, pitch: number, amp: number, color: THREE.Color, rows = 2): THREE.BufferGeometry {
  const cols = Math.max(2, Math.round((w / pitch) * 3)); // 3 samples per wave
  const pos: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const x = -w / 2 + (w * c) / cols;
      pos.push(x, (h * r) / rows - h / 2, Math.sin((x / pitch) * Math.PI * 2) * amp);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      idx.push(a, a + 1, a + cols + 1, a + 1, a + cols + 2, a + cols + 1);
    }
  }
  const g = fromArrays(pos, idx);
  paint(g, (p, n) => scratch.copy(color).multiplyScalar(0.82 + 0.3 * (n.x * 0.5 + 0.5) + 0.0 * p.y));
  return g;
}

/** Roof height above the wall top at the wall corner (so you can sit the roof with its eave line at wall height minus this). */
export function gableEave(w: number, rise: number, over: number): number {
  return rise * (1 - w / 2 / (w / 2 + over));
}

/** Gabled roof prism over a w x d footprint: ridge along z, `rise` metres high, eaves overhanging by `over`. */
export function gableRoof(w: number, d: number, rise: number, over: number, roof: THREE.Color, gable: THREE.Color): THREE.BufferGeometry {
  const hw = w / 2 + over;
  const hd = d / 2 + over;
  const y1 = gableEave(w, rise, over); // roof height right above the wall corner
  const left = bridgeStrip([new THREE.Vector3(-hw, 0, -hd), new THREE.Vector3(-hw, 0, hd)], [new THREE.Vector3(0, rise, -hd), new THREE.Vector3(0, rise, hd)], new THREE.Vector3(-1, 1, 0));
  const right = bridgeStrip([new THREE.Vector3(hw, 0, -hd), new THREE.Vector3(hw, 0, hd)], [new THREE.Vector3(0, rise, -hd), new THREE.Vector3(0, rise, hd)], new THREE.Vector3(1, 1, 0));
  const shade = (g: THREE.BufferGeometry) =>
    paint(g, (p) => scratch.copy(roof).multiplyScalar(0.85 + 0.2 * (p.y / rise) + 0.06 * Math.sin(p.z * 9)));
  const under = bridgeStrip([new THREE.Vector3(-hw, y1 - 0.02, -hd), new THREE.Vector3(hw, y1 - 0.02, -hd)], [new THREE.Vector3(-hw, y1 - 0.02, hd), new THREE.Vector3(hw, y1 - 0.02, hd)], new THREE.Vector3(0, -1, 0));
  const gab = (z: number, s: number) => {
    const g = fromArrays([-w / 2, y1, z, w / 2, y1, z, 0, rise, z], s > 0 ? [0, 1, 2] : [0, 2, 1]);
    return orientTo(g, new THREE.Vector3(0, 0, s));
  };
  return merge([shade(left), shade(right), paint(under, () => scratch.copy(roof).multiplyScalar(0.4)), paint(gab(-d / 2, -1), () => scratch.copy(gable)), paint(gab(d / 2, 1), () => scratch.copy(gable))]);
}

/** A flag: a subdivided rectangle hanging off a pole along +x; `sway` grows with distance from the pole. */
export function flagGeo(len: number, hgt: number, color: THREE.Color, pennant = false): THREE.BufferGeometry {
  const cols = 6;
  const path: THREE.Vector3[] = [];
  const widths: number[] = [];
  for (let i = 0; i <= cols; i++) {
    const t = i / cols;
    path.push(new THREE.Vector3(len * t, -hgt * 0.5, 0));
    widths.push(pennant ? hgt * (1 - t) : hgt);
  }
  // ribbonGeo spreads the width along `across`; here that is vertical.
  const g = ribbonGeo(path.map((p) => p.clone().setY(0)), widths, new THREE.Vector3(0, 1, 0), 0);
  paint(
    g,
    (p) => scratch.copy(color).multiplyScalar(0.85 + 0.3 * (p.x / len)),
    (p) => (p.x / len) * 1.2,
  );
  return g;
}

/** Slim pole with a rounded foot, from y = 0 to `h`. */
export function polePart(x: number, z: number, h: number, r: number, color: THREE.Color, seg = 6): THREE.BufferGeometry {
  const g = tubeGeo([new THREE.Vector3(x, -0.05, z), new THREE.Vector3(x, h * 0.5, z), new THREE.Vector3(x, h, z), new THREE.Vector3(x, h + r * 0.6, z)], [r * 1.25, r, r * 0.85, 0], seg);
  return paint(g, (p) => scratch.copy(color).multiplyScalar(0.8 + 0.3 * THREE.MathUtils.clamp(p.y / h, 0, 1)));
}
