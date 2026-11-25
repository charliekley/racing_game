/**
 * The Peel: a yellow fruit-peel lying on the road, built from code (no model files).
 *
 *   - a low rounded cap in the middle with a darker stem on top,
 *   - three strips (120 degrees apart) that run outward along the ground and then curl back up and over (like a peeled fruit),
 *   - bright yellow all over, with only a hint of warm gold at the tips and a few tiny tan freckles (little brown), smooth shading.
 *
 * Maths, since this is the interesting part: each strip is a "ribbon". Its centre line lives in a
 * 2-D plane (distance r from the middle, height y). We walk along it in small steps; at each step the
 * direction angle `theta` says where we head (0 = flat along the ground, pi/2 = straight up, beyond
 * that = curling back toward the middle). `theta` grows smoothly after the strip's flat start, which
 * makes the curl. Across its width the ribbon is a shallow dome (edges lower than the middle) and
 * it narrows toward the tip. An inner and an outer skin (a few mm apart) give it thickness.
 *
 * Everything is merged into ONE geometry with per-vertex colours: the whole peel is a single draw call.
 * The model's origin is the middle of its footprint, on the ground (lowest point is ~y = 0).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Approximate radius of the peel's footprint (m). */
export const PEEL_RADIUS = 1.05;

const STRIPS = [
  // angle (rad) around the middle, length (m), maximum curl (rad), base width (m)
  { angle: 0.4, length: 1.05, curl: 2.7, width: 0.55 },
  { angle: 0.4 + (Math.PI * 2) / 3, length: 0.95, curl: 2.4, width: 0.52 },
  { angle: 0.4 + (Math.PI * 4) / 3, length: 1.05, curl: 2.9, width: 0.55 },
];

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Small deterministic pseudo-random sequence (so the speckles are the same every time). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Paint every vertex of `geo` with one colour (the merged geometry needs a colour on every part). Returns a non-indexed copy. */
function paint(source: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const geo = source.index ? source.toNonIndexed() : source;
  const n = geo.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([color.r, color.g, color.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

const U = 20; // steps along a strip
const V = 6; // steps across it
const OUTER = new THREE.Color('#ffe81a');
const OUTER_DEEP = new THREE.Color('#ffd400');
const TIP = new THREE.Color('#e0a812');
const INNER = new THREE.Color('#fff4a8');

/** Point on a strip's surface: u = 0..1 along, v = 0..1 across, `lift` = distance out of the surface (m). */
function stripPoint(s: (typeof STRIPS)[number], u: number, v: number, lift: number, out: THREE.Vector3): THREE.Vector3 {
  // Walk the centre line from the start up to u (cheap: at most U steps).
  const steps = Math.max(1, Math.round(u * U));
  let r = 0.22;
  let y = 0.06;
  let theta = 0;
  const ds = s.length / U;
  for (let i = 0; i < steps; i++) {
    const uu = (i + 0.5) / U;
    theta = s.curl * Math.pow(smoothstep(0.32, 1, uu), 1.15);
    r += Math.cos(theta) * ds;
    y += Math.sin(theta) * ds;
  }
  // Surface normal in the (r, y) plane is perpendicular to the direction of travel.
  const nr = -Math.sin(theta);
  const ny = Math.cos(theta);
  const w = s.width * (1 - 0.78 * Math.pow(u, 1.4));
  const across = (v - 0.5) * w;
  const dome = 0.055 * (1 - Math.pow(2 * v - 1, 2)) * (1 - 0.5 * u);
  const o = dome + lift;
  const rr = r + nr * o;
  const yy = y + ny * o;
  // Radial direction d = (cos a, sin a); sideways direction = (-sin a, cos a) (mapped onto x and z).
  const ca = Math.cos(s.angle);
  const sa = Math.sin(s.angle);
  return out.set(rr * ca - across * sa, yy, rr * sa + across * ca);
}

/** One skin of a strip as an indexed grid with smooth normals. */
function stripSkin(s: (typeof STRIPS)[number], lift: number, inner: boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i <= U; i++) {
    const u = i / U;
    for (let j = 0; j <= V; j++) {
      stripPoint(s, u, j / V, lift, p);
      pos.push(p.x, p.y, p.z);
      if (inner) c.copy(INNER);
      else c.copy(OUTER).lerp(OUTER_DEEP, u).lerp(TIP, smoothstep(0.78, 1, u) * 0.55);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < U; i++) {
    for (let j = 0; j < V; j++) {
      const a = i * (V + 1) + j;
      const b = a + 1;
      const d = a + V + 1;
      const e = d + 1;
      // Winding chosen so the outer skin's front faces point out of the peel.
      if (inner) idx.push(a, b, d, b, e, d);
      else idx.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed(); // merging needs every part to be indexed the same way; the normals are kept
}

/** The whole peel as a single geometry. */
export function buildPeelGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of STRIPS) {
    parts.push(stripSkin(s, 0, false));
    parts.push(stripSkin(s, -0.035, true));
  }

  // Middle cap: a low dome that hides where the strips start.
  const cap = new THREE.SphereGeometry(0.36, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.scale(1, 0.5, 1);
  cap.translate(0, 0.02, 0);
  parts.push(paint(cap, OUTER_DEEP));

  // Stem: a short dark, tapered stalk leaning a little, with a darker cut end.
  const stem = new THREE.CylinderGeometry(0.055, 0.095, 0.3, 10, 1);
  stem.translate(0, 0.15, 0);
  stem.rotateZ(0.28);
  stem.translate(0.02, 0.1, 0.0);
  parts.push(paint(stem, new THREE.Color('#a8841a')));
  const stemEnd = new THREE.CircleGeometry(0.055, 10).rotateX(-Math.PI / 2).rotateZ(0.28);
  stemEnd.translate(0.02 - Math.sin(0.28) * 0.3, 0.1 + Math.cos(0.28) * 0.3 + 0.002, 0); // top centre of the tilted stem
  parts.push(paint(stemEnd, new THREE.Color('#7a5a10')));

  // Speckles: tiny flattened dark blobs on the flat start of each strip, and a few on the cap.
  const rnd = lcg(11);
  const p = new THREE.Vector3();
  const speck = new THREE.Color('#c79a1c');
  for (const s of STRIPS) {
    for (let i = 0; i < 3; i++) {
      const u = 0.1 + rnd() * 0.38;
      const v = 0.2 + rnd() * 0.6;
      stripPoint(s, u, v, 0.006, p);
      const g = new THREE.IcosahedronGeometry(0.03 + rnd() * 0.02, 0);
      g.scale(1, 0.45, 1);
      g.translate(p.x, p.y, p.z);
      parts.push(paint(g, speck));
    }
  }
  for (let i = 0; i < 4; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = 0.12 + rnd() * 0.14;
    const g = new THREE.IcosahedronGeometry(0.026, 0);
    g.scale(1, 0.45, 1);
    g.translate(Math.cos(a) * rr, 0.02 + 0.5 * Math.sqrt(Math.max(0, 0.36 * 0.36 - rr * rr)) + 0.004, Math.sin(a) * rr);
    parts.push(paint(g, speck));
  }

  for (const g of parts) {
    // mergeGeometries needs the same attributes everywhere: drop uvs.
    g.deleteAttribute('uv');
  }
  const merged = mergeGeometries(parts, false)!;
  for (const g of parts) g.dispose();
  return merged;
}
