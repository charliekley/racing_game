/**
 * Meshes for shortcut branch roads (see sim/shortcuts.ts), built from the same samples the
 * physics uses: banked road, curbs, off-road strips, walls, plus a small fork marker (chevron sign
 * and a row of cones at the split).
 *
 * Near a fork the branch overlaps the main road for a while. Its road is drawn a hair above the
 * main road (and with a polygon offset, so it does not flicker); its curbs and strips are only
 * drawn where they do not lie on the main road.
 */
import * as THREE from 'three';
import type { Branch } from '../sim/shortcuts';
import { CURB_WIDTH, Track, type TrackSample } from '../sim/track';
import { curbTexture, dirtTexture, grassTexture, roadTexture, chevronSignTexture, wallTexture } from './textures';

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

export function buildBranchViews(track: Track, strip: StripFn): THREE.Group {
  const group = new THREE.Group();
  if (track.branches.length === 0) return group;
  const def = track.def;
  const mainHalf = def.width / 2 + CURB_WIDTH;

  // Materials are shared by every branch. polygonOffset pulls the branch road toward the camera where it overlaps the main road.
  const onTop = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(), ...onTop });
  const dirtMat = new THREE.MeshStandardMaterial({ map: dirtTexture(), ...onTop });
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTexture(), ...onTop });
  const offTex = grassTexture(def.theme.offroad, 3);
  offTex.repeat.set(1, 1);
  const offMat = new THREE.MeshStandardMaterial({ map: offTex });
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), side: THREE.DoubleSide });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, cast = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.castShadow = cast;
    group.add(m);
  };

  /** Is the point (x, z) at height y clear of the main road (so branch decoration there is not on top of it)? */
  const clearOfMain = (x: number, z: number, y: number): boolean => {
    for (const q of track.samples) {
      if (Math.abs(q.y - y) >= 3) continue; // a different level (bridge): no overlap
      if ((q.x - x) ** 2 + (q.z - z) ** 2 < (mainHalf + 0.4) ** 2) return false;
    }
    return true;
  };

  for (const b of track.branches) {
    const S = b.samples;
    const count = S.length;
    const lift = (p: TrackSample, d: number) => Track.bankLift(p.bank, p.width / 2, d);
    const hw = (p: TrackSample) => p.width / 2;
    /** Is the point `d` metres to the side of sample p clear of the main road? */
    const clearAt = (p: TrackSample, d: number) => clearOfMain(p.x + p.rx * d, p.z + p.rz * d, p.y);

    // Which stretches are dirt (the ends of a dirt branch are still tarmac, like the physics says).
    const isDirt = (i: number) => b.isDirt(i);

    // Tarmac: edge to edge (all of a road branch; the two ends of a dirt branch).
    for (const [a, c] of ranges(count, (i) => !isDirt(i) || !isDirt(i + 1))) {
      add(strip(S.slice(a, c + 1), false, (p) => [{ d: -hw(p), h: lift(p, -hw(p)) + 0.04 }, { d: hw(p), h: lift(p, hw(p)) + 0.04 }], 12), roadMat);
    }
    // Dirt: packed earth over the road AND curb width.
    for (const [a, c] of ranges(count, (i) => isDirt(i))) {
      const run = S.slice(a, Math.min(count, c + 2)); // one more sample so it meets the tarmac end
      add(strip(run, false, (p) => [{ d: -hw(p) - CURB_WIDTH, h: lift(p, -hw(p)) + 0.045 }, { d: hw(p) + CURB_WIDTH, h: lift(p, hw(p)) + 0.045 }], 10), dirtMat);
    }

    // Curbs (tarmac only) and off-road strips, each side, only where they do not lie on the main road.
    for (const side of [-1, 1]) {
      const curbOk = (i: number) => !isDirt(i) && clearAt(S[i], side * (hw(S[i]) + CURB_WIDTH));
      for (const [a, c] of ranges(count, curbOk)) {
        add(
          strip(S.slice(a, c + 1), false, (p): [Edge, Edge] => {
            const e0 = side * hw(p);
            const e1 = side * (hw(p) + CURB_WIDTH);
            const h = lift(p, e0) + 0.05;
            return side < 0 ? [{ d: e1, h }, { d: e0, h }] : [{ d: e0, h }, { d: e1, h }];
          }, 3),
          curbMat,
        );
      }
      const outerD = (p: TrackSample) => hw(p) + def.offroadWidth;
      const stripOk = (i: number) => clearAt(S[i], side * (hw(S[i]) + CURB_WIDTH)) && clearAt(S[i], side * outerD(S[i]));
      for (const [a, c] of ranges(count, stripOk)) {
        add(
          strip(S.slice(a, c + 1), false, (p): [Edge, Edge] => {
            const inner = side * (hw(p) + CURB_WIDTH);
            const out = side * outerD(p);
            // Slopes from the road edge down to the road's base height, like Track.groundLevel.
            const hOut = Track.groundLevel(p.y, p.bank, hw(p), out, def.offroadWidth) - p.y + 0.01;
            const hIn = lift(p, inner) + 0.02;
            return side < 0 ? [{ d: out, h: hOut }, { d: inner, h: hIn }] : [{ d: inner, h: hIn }, { d: out, h: hOut }];
          }, 8),
          offMat,
        );
      }
    }

    // Walls (same tire barriers as the main road), where the def asked for them.
    for (const side of [-1, 1]) {
      const has = (i: number) => (side < 0 ? S[i].wallLeft : S[i].wallRight);
      for (const [a, c] of ranges(count, has)) {
        add(strip(S.slice(a, c + 1), false, (p) => [{ d: side * (hw(p) + def.offroadWidth), h: 0 }, { d: side * (hw(p) + def.offroadWidth), h: 1.1 }], 2.2), wallMat, true);
      }
    }

    group.add(buildForkMarker(b, clearAt));
  }
  return group;
}

/** Shared by all fork markers. */
let signTex: THREE.CanvasTexture | null = null;
let markerMats: { post: THREE.Material; board: THREE.Material; back: THREE.Material; cone: THREE.Material; band: THREE.Material } | null = null;

/**
 * The fork marker, deliberately low-key: at the "gore" (the wedge where the branch splits off
 * the main road) a knee-high chevron sign points into the branch, and a short row of traffic
 * cones lines the split. Nothing is written on it: you see the opening and the arrows.
 */
function buildForkMarker(b: Branch, clear: (p: TrackSample, d: number) => boolean): THREE.Group {
  const g = new THREE.Group();
  const S = b.samples;
  // First sample (after the first 6) whose whole road width is clear of the main road.
  let k = 6;
  while (k < S.length - 8 && !(clear(S[k], 0) && clear(S[k], -S[k].width / 2 - 1.5) && clear(S[k], S[k].width / 2 + 1.5))) k++;
  k = Math.min(k, S.length - 8);
  const p = S[k];

  // Which side of the branch is the main road on? Step outwards on both sides until we hit it.
  const reach = (side: number) => {
    for (let d = p.width / 2 + 2; d < 60; d += 2) if (!clear(p, side * d)) return d;
    return Infinity;
  };
  const mainSide = reach(-1) < reach(1) ? -1 : 1;

  markerMats ??= {
    post: new THREE.MeshStandardMaterial({ color: '#4a4f58', roughness: 0.6 }),
    board: new THREE.MeshBasicMaterial({ map: (signTex ??= chevronSignTexture()) }),
    back: new THREE.MeshStandardMaterial({ color: '#8a8f96' }),
    cone: new THREE.MeshStandardMaterial({ color: '#ff6a1a', roughness: 0.5 }),
    band: new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.4 }),
  };
  const M = markerMats;

  // --- Chevron sign at the gore, facing drivers coming along the main road. ---
  const signD = mainSide * (p.width / 2 + 1.6);
  const sx = p.x + p.rx * signD;
  const sz = p.z + p.rz * signD;
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.5, 0.14), M.post);
  post.position.set(sx, p.y + 0.75, sz);
  post.castShadow = true;
  g.add(post);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), M.board);
  board.position.set(sx, p.y + 1.45, sz);
  board.rotation.y = Math.atan2(-p.tx, -p.tz); // face the driver coming along the road
  // The texture points right. The branch lies on the side away from the main road, so the
  // arrows should point that way; mirror the board when that is the driver's left.
  if (-mainSide < 0) board.scale.x = -1;
  g.add(board);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), M.back);
  back.position.copy(board.position).addScaledVector(new THREE.Vector3(p.tx, 0, p.tz), 0.02);
  back.rotation.y = board.rotation.y + Math.PI;
  g.add(back);

  // --- Cones along the gore edge, after the sign, where the two roads part (one InstancedMesh per colour). ---
  // InstancedMesh = one geometry drawn many times in a single draw call, each with its own matrix.
  const spots: THREE.Vector3[] = [];
  for (let j = k + 3; j < S.length - 8 && spots.length < 5; j += 3) {
    const q = S[j];
    const d = mainSide * (q.width / 2 + 0.6);
    if (!clear(q, d)) continue; // this spot is on the main road
    spots.push(new THREE.Vector3(q.x + q.rx * d, q.y, q.z + q.rz * d));
  }
  if (spots.length) {
    const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(0.28, 0.75, 10), M.cone, spots.length);
    const bands = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.21, 0.12, 10), M.band, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach((v, i) => {
      cones.setMatrixAt(i, m.makeTranslation(v.x, v.y + 0.375, v.z));
      bands.setMatrixAt(i, m.makeTranslation(v.x, v.y + 0.45, v.z));
    });
    cones.castShadow = true;
    g.add(cones, bands);
  }
  return g;
}
