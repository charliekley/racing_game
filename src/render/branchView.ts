/**
 * Meshes for shortcut dirt paths (see sim/shortcuts.ts), built from the same samples and the same terrain
 * height the physics uses.
 *
 * A path is only a dirt surface "draped" on the terrain: every vertex sits DIRT_LIFT above `terrain.height`,
 * so it can never float or sink. Its soft edges fade into the grass/snow (vertex alpha), it fades in over
 * the first metres and out over the last (it emerges from the verge and melts back into it), and it is
 * hidden over the main road's tarmac and kerb, so the main road is untouched. Plus the tire barriers the
 * def asked for, and a small fork marker (chevron sign and cones) on the verge beside the main road.
 */
import * as THREE from 'three';
import type { Branch } from '../sim/shortcuts';
import { DIRT_LIFT } from '../sim/shortcuts';
import { CURB_WIDTH, Track, type TrackSample } from '../sim/track';
import { dirtTexture, chevronSignTexture, wallTexture } from './textures';

interface Edge {
  d: number;
  h: number;
}
/** trackView's ribbon builder, passed in so the two files do not import each other. */
type StripFn = (samples: TrackSample[], closed: boolean, edges: (p: TrackSample) => [Edge, Edge], vRepeat: number) => THREE.BufferGeometry;

/** Contiguous index ranges [a, b] (inclusive, at least two samples long) where `pred(index)` is true. */
function ranges(count: number, pred: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < count; i++) {
    if (pred(i)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start, count - 1]);
  return out.filter(([a, b]) => b > a);
}

const smooth01 = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** Width of the soft, fading edge on each side of the path (m). */
const SOFT_EDGE = 2.6;
/** Vertices across the path (odd, so there is one on the centerline). */
const ACROSS = 13;
/** The path is this fraction of its full width right at its ends and widens to the full width over FLARE metres. */
const END_WIDTH_FRACTION = 0.4;
const FLARE = 22;
/** Metres over which the dirt fades in / out at its two ends. */
const FADE = 5;

/**
 * The dirt surface of one path as a single mesh: a ribbon across the path, draped on the terrain.
 * Vertex colour carries the alpha (white, fading to nothing at the soft edges, at the two ends and over the main road).
 */
function dirtGeometry(track: Track, b: Branch): THREE.BufferGeometry {
  const S = b.samples;
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const half = S[0].width / 2;
  let dist = 0;
  S.forEach((p, k) => {
    if (k > 0) dist += Math.hypot(p.x - S[k - 1].x, p.z - S[k - 1].z);
    const along = k * b.spacing;
    // Narrow at the very ends (where the path touches the main road), full width in between.
    const flare = Math.min(smooth01(along / FLARE), smooth01((b.length - along) / FLARE));
    const body = half * (END_WIDTH_FRACTION + (1 - END_WIDTH_FRACTION) * flare);
    const extent = body + SOFT_EDGE;
    const lengthAlpha = smooth01(along / FADE) * smooth01((b.length - along) / FADE);
    for (let j = 0; j < ACROSS; j++) {
      const t = (2 * j) / (ACROSS - 1) - 1; // -1 .. 1 across the path
      const l = t * extent;
      const x = p.x + p.rx * l;
      const z = p.z + p.rz * l;
      let y = track.terrain.height(x, z) + DIRT_LIFT;
      // Soft edge: solid inside 55 % of the body, fading to nothing at the outside of the soft band.
      let alpha = 1 - smooth01((Math.abs(l) - body * 0.55) / (extent - body * 0.55));
      alpha *= lengthAlpha;
      // Over the main road's tarmac and kerb (same level): hidden, so the main road looks exactly as it would without the path.
      const m = track.projectOnMain(x, z);
      if (Math.abs(m.y - y) < 3) {
        const off = Math.abs(m.d) - (m.width / 2 + CURB_WIDTH);
        alpha *= smooth01((off - 0.1) / 0.9);
        if (off < 0.1) y -= 0.3;
      }
      pos.push(x, y, z);
      col.push(1, 1, 1, alpha);
      uv.push(j / (ACROSS - 1), dist / 10);
    }
    if (k < S.length - 1) {
      for (let j = 0; j < ACROSS - 1; j++) {
        const q = k * ACROSS + j;
        idx.push(q, q + 1, q + ACROSS, q + 1, q + ACROSS + 1, q + ACROSS);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); // RGBA: three.js uses the 4th as alpha
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildBranchViews(track: Track, strip: StripFn): THREE.Group {
  const group = new THREE.Group();
  if (track.branches.length === 0) return group;
  const def = track.def;

  // Dirt: transparent (soft edges), drawn without writing depth and pulled toward the camera a little (polygon offset)
  // so it never z-fights with the strip or the terrain under it.
  const dirtMat = new THREE.MeshStandardMaterial({
    map: dirtTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), side: THREE.DoubleSide });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, cast = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.castShadow = cast;
    group.add(m);
    return m;
  };

  for (const b of track.branches) {
    const S = b.samples;
    const count = S.length;
    const hw = (p: TrackSample) => p.width / 2;

    add(dirtGeometry(track, b), dirtMat).renderOrder = 1;

    // Walls (the same tire barriers as the main road), where the def asked for them.
    for (const side of [-1, 1]) {
      const has = (i: number) => (side < 0 ? S[i].wallLeft : S[i].wallRight);
      for (const [a, c] of ranges(count, has)) {
        add(strip(S.slice(a, c + 1), false, (p) => [{ d: side * (hw(p) + def.offroadWidth), h: 0 }, { d: side * (hw(p) + def.offroadWidth), h: 1.1 }], 2.2), wallMat, true);
      }
    }

    group.add(buildForkMarker(track, b));
  }
  return group;
}

/** Shared by all fork markers. */
let signTex: THREE.CanvasTexture | null = null;
let markerMats: { post: THREE.Material; board: THREE.Material; back: THREE.Material; cone: THREE.Material; band: THREE.Material } | null = null;

/**
 * The fork marker, deliberately low-key, on the VERGE beside the main road (never on it): a knee-high
 * chevron sign a little before the opening, pointing toward the path, and a short row of traffic cones
 * along the kerb leading up to where the dirt leaves the road. Nothing is written on it.
 */
function buildForkMarker(track: Track, b: Branch): THREE.Group {
  const g = new THREE.Group();
  const S = track.samples;
  const n = S.length;
  const side = b.startSide; // +1 = the path leaves on the right of the main road
  const edge = track.def.width / 2 + CURB_WIDTH;
  /** A spot on the verge `back` samples before the fork, `out` metres outside the kerb. */
  const spot = (back: number, out: number) => {
    const p = S[(((b.fromIdx - back) % n) + n) % n];
    const x = p.x + p.rx * side * (edge + out);
    const z = p.z + p.rz * side * (edge + out);
    return { p, x, z, y: track.terrain.height(x, z) };
  };

  markerMats ??= {
    post: new THREE.MeshStandardMaterial({ color: '#4a4f58', roughness: 0.6 }),
    board: new THREE.MeshBasicMaterial({ map: (signTex ??= chevronSignTexture()) }),
    back: new THREE.MeshStandardMaterial({ color: '#8a8f96' }),
    cone: new THREE.MeshStandardMaterial({ color: '#ff6a1a', roughness: 0.5 }),
    band: new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.4 }),
  };
  const M = markerMats;

  // --- Chevron sign, facing drivers coming along the main road. ---
  const sp = spot(8, 1.6);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.5, 0.14), M.post);
  post.position.set(sp.x, sp.y + 0.75, sp.z);
  post.castShadow = true;
  g.add(post);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), M.board);
  board.position.set(sp.x, sp.y + 1.45, sp.z);
  board.rotation.y = Math.atan2(-sp.p.tx, -sp.p.tz); // face the driver coming along the road
  // The texture's arrows point right: mirror the board when the path leaves on the driver's left.
  if (side < 0) board.scale.x = -1;
  g.add(board);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), M.back);
  back.position.copy(board.position).addScaledVector(new THREE.Vector3(sp.p.tx, 0, sp.p.tz), 0.02);
  back.rotation.y = board.rotation.y + Math.PI;
  g.add(back);

  // --- Cones along the kerb, just before the opening (one InstancedMesh per colour). ---
  // InstancedMesh = one geometry drawn many times in a single draw call, each with its own matrix.
  const spots = [6, 4, 2].map((back) => spot(back, 0.7));
  const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(0.28, 0.75, 10), M.cone, spots.length);
  const bands = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.21, 0.12, 10), M.band, spots.length);
  const m = new THREE.Matrix4();
  spots.forEach((v, i) => {
    cones.setMatrixAt(i, m.makeTranslation(v.x, v.y + 0.375, v.z));
    bands.setMatrixAt(i, m.makeTranslation(v.x, v.y + 0.45, v.z));
  });
  cones.castShadow = true;
  g.add(cones, bands);
  return g;
}
