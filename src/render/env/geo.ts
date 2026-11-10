/**
 * Geometry kit for smooth, rounded props (trees, rocks, bushes, containers...).
 *
 * 3D concepts used here, in short:
 *  - A BufferGeometry is just arrays: vertex positions, "normals" (the direction each
 *    vertex faces, which decides how light shades it) and triangle indices.
 *  - SMOOTH shading = every vertex shared by several triangles gets the AVERAGE of
 *    their face directions (computeVertexNormals). Faceted ("low-poly") shading is
 *    what you get when triangles do not share vertices.
 *  - A "lathe" spins a 2D outline around the vertical axis (like a potter's wheel):
 *    great for pine boughs. A "tube" sweeps a circle along a curve: trunks, branches.
 *  - Every shape here carries a baked per-vertex `color` (ambient occlusion-like
 *    darkening where leaves are dense, snow on upward faces...) and a `sway` weight
 *    (how much wind moves that vertex), see env/materials.ts.
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type ColorFn = (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color;

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Build an indexed geometry from raw arrays with smooth normals. */
export function fromArrays(pos: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Bake vertex colours (and optional wind-sway weights) from functions of position/normal. */
export function paint(geo: THREE.BufferGeometry, color: ColorFn, sway?: (p: THREE.Vector3) => number): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  const sw = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    _n.fromBufferAttribute(nor, i);
    const c = color(_p, _n);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    sw[i] = sway ? sway(_p) : 0;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
  return geo;
}

/** Concatenate parts (all must have position/normal/color/sway). Source geometries are disposed. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(parts, false);
  if (!m) throw new Error('merge failed: attribute mismatch');
  for (const p of parts) p.dispose();
  return m;
}

/** Clone + transform (position, scale, rotation as a matrix). */
export function placed(geo: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  return geo.clone().applyMatrix4(m);
}

export function matrix(x: number, y: number, z: number, sx = 1, sy = sx, sz = sx, ry = 0, rx = 0, rz = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
}

/**
 * Smooth lumpy sphere of radius ~1 (an icosphere with noise pushed along each vertex's
 * direction). `detail` n makes 20*(n+1)^2 triangles.
 */
export function blobGeo(detail: number, seed: number, bump: number, freq: number, noise: (x: number, y: number, z: number, s: number) => number): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g); // share vertices so normals are smooth
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i).normalize();
    const d = 1 + bump * (noise(_p.x * freq + seed * 7.1, _p.y * freq + seed * 3.7, _p.z * freq + seed * 5.3, seed) - 0.5) * 2;
    pos.setXYZ(i, _p.x * d, _p.y * d, _p.z * d);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Surface of revolution. `profile` = [radius, height] pairs ordered bottom to top
 * (the outside faces outwards). `mod(angle, t)` scales the radius per angle, for
 * scalloped edges; t = 0..1 along the profile.
 */
export function latheGeo(profile: [number, number][], seg: number, mod?: (angle: number, t: number) => number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = profile.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const r = profile[i][0] * (mod ? mod(a, i / (n - 1)) : 1);
      pos.push(Math.cos(a) * r, profile[i][1], Math.sin(a) * r);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j;
      const b = i * seg + ((j + 1) % seg);
      const c = (i + 1) * seg + j;
      const d = (i + 1) * seg + ((j + 1) % seg);
      idx.push(a, c, b, b, c, d);
    }
  }
  return fromArrays(pos, idx);
}

/**
 * A circle swept along a polyline with a radius per point (trunks, branches, palm
 * stems, poles). The first ring is open (hide it inside something else); a final
 * radius of 0 closes the end into a point.
 */
export function tubeGeo(path: THREE.Vector3[], radii: number[], seg: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const t = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const bin = new THREE.Vector3();
  const count = path.length;
  for (let i = 0; i < count; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(count - 1, i + 1)];
    t.subVectors(b, a).normalize();
    if (i === 0) {
      // Any vector not parallel to the tangent starts the frame.
      nrm.set(Math.abs(t.y) > 0.9 ? 1 : 0, Math.abs(t.y) > 0.9 ? 0 : 1, 0);
      nrm.sub(t.clone().multiplyScalar(nrm.dot(t))).normalize();
    } else {
      // Parallel transport: keep the frame from twisting as the curve bends.
      nrm.sub(t.clone().multiplyScalar(nrm.dot(t))).normalize();
    }
    bin.crossVectors(nrm, t);
    for (let j = 0; j < seg; j++) {
      const ang = (j / seg) * Math.PI * 2;
      const c = Math.cos(ang) * radii[i];
      const s = Math.sin(ang) * radii[i];
      pos.push(path[i].x + nrm.x * c + bin.x * s, path[i].y + nrm.y * c + bin.y * s, path[i].z + nrm.z * c + bin.z * s);
    }
  }
  for (let i = 0; i < count - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j;
      const b = i * seg + ((j + 1) % seg);
      const c = (i + 1) * seg + j;
      const d = (i + 1) * seg + ((j + 1) % seg);
      idx.push(a, c, b, b, c, d);
    }
  }
  return fromArrays(pos, idx);
}

/** Straight tube from a to b (convenience). */
export function pole(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, seg = 6): THREE.BufferGeometry {
  return tubeGeo([a, b], [r0, r1], seg);
}

/**
 * A double-sided ribbon along a path (fronds, grass blades, cloth). `across` is the direction
 * the width spreads in (unit vector); `widths` is the full width at each path point. Normals
 * face a fixed `up` bias so thin leaves are lit softly from above instead of going black.
 */
export function ribbonGeo(path: THREE.Vector3[], widths: number[], across: THREE.Vector3, upBias = 0.5): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const tan = new THREE.Vector3();
  const face = new THREE.Vector3();
  const n = path.length;
  for (let i = 0; i < n; i++) {
    for (const side of [-1, 1]) {
      pos.push(path[i].x + across.x * widths[i] * 0.5 * side, path[i].y + across.y * widths[i] * 0.5 * side, path[i].z + across.z * widths[i] * 0.5 * side);
    }
  }
  const verts = n * 2;
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    // front (a, a+1, a+2, a+3) and back with flipped winding
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    idx.push(verts + a, verts + a + 1, verts + a + 2, verts + a + 1, verts + a + 3, verts + a + 2);
  }
  // Normals: perpendicular to the ribbon, nudged toward up so leaves look soft.
  const normals: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    tan.subVectors(path[Math.min(n - 1, i + 1)], path[Math.max(0, i - 1)]).normalize();
    face.crossVectors(across, tan).normalize();
    if (face.y < 0) face.negate();
    face.y += upBias;
    normals.push(face.clone().normalize());
  }
  for (let i = 0; i < n * 2; i++) nor.push(normals[i >> 1].x, normals[i >> 1].y, normals[i >> 1].z);
  for (let i = 0; i < n * 2; i++) {
    const v = normals[i >> 1].clone().multiplyScalar(-1);
    v.y = Math.abs(v.y) * 0.5 + upBias * 0.5; // the back side also leans upward
    v.normalize();
    nor.push(v.x, v.y, v.z);
  }
  const doubled = [...pos, ...pos];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(doubled, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** Linear-space colour from a CSS hex. */
export const col = (hex: string): THREE.Color => new THREE.Color(hex);

/** Reusable scratch colour for colour functions (avoid allocations in per-vertex loops). */
export const scratch = new THREE.Color();
