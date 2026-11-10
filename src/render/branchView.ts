/**
 * Meshes for shortcut branch roads (see sim/shortcuts.ts), built from the same samples the
 * physics uses: banked road, curbs, off-road strips, walls, plus a "SHORTCUT" gate at the fork.
 *
 * Near a fork the branch overlaps the main road for a while. Its road is drawn a hair above the
 * main road (and with a polygon offset, so it does not flicker); its curbs and strips are only
 * drawn where they do not lie on the main road.
 */
import * as THREE from 'three';
import type { Branch } from '../sim/shortcuts';
import { CURB_WIDTH, Track, type TrackSample } from '../sim/track';
import { curbTexture, dirtTexture, grassTexture, roadTexture, shortcutSignTexture, wallTexture } from './textures';

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

    group.add(buildGate(b, clearAt));
  }
  return group;
}

/** Shared by all gates. */
let signTex: THREE.CanvasTexture | null = null;

/**
 * The fork marker: two posts and a "SHORTCUT" board across the branch road, a little way
 * past the fork where the branch has cleared the main road. Faces the oncoming driver.
 */
function buildGate(b: Branch, clear: (p: TrackSample, d: number) => boolean): THREE.Group {
  const g = new THREE.Group();
  const S = b.samples;
  // First sample (after the first 6) whose whole road width is clear of the main road.
  let k = 6;
  while (k < S.length - 8 && !(clear(S[k], 0) && clear(S[k], -S[k].width / 2 - 1.5) && clear(S[k], S[k].width / 2 + 1.5))) k++;
  const p = S[Math.min(k, S.length - 8)];
  const half = p.width / 2 + 1.4;
  const postH = 5.2;
  const postMat = new THREE.MeshStandardMaterial({ color: b.surface === 'dirt' ? '#7a5230' : '#3a3f4a' });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, postH, 0.45), postMat);
    post.position.set(p.x + p.rx * side * half, p.y + postH / 2, p.z + p.rz * side * half);
    post.castShadow = true;
    g.add(post);
  }
  signTex ??= shortcutSignTexture();
  const w = half * 2 + 0.6;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: signTex, transparent: true }));
  board.position.set(p.x, p.y + postH - 0.9, p.z);
  board.rotation.y = Math.atan2(-p.tx, -p.tz); // face the driver coming along the road
  g.add(board);
  // A plain back so the board is not see-through from behind.
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshStandardMaterial({ color: '#d79a1a' }));
  back.position.copy(board.position).addScaledVector(new THREE.Vector3(p.tx, 0, p.tz), 0.03);
  back.rotation.y = board.rotation.y + Math.PI;
  g.add(back);
  return g;
}
