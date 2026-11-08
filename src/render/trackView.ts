/**
 * Builds the visible track from the same samples the physics uses: banked
 * road, curbs, off-road strips, walls, ramp, boost pads, start line, gantry
 * and procedural scenery. Static geometry is created once per track.
 */
import * as THREE from 'three';
import { CURB_WIDTH, Track, type TrackSample } from '../sim/track';
import {
  boostTexture,
  checkerTexture,
  curbTexture,
  grassTexture,
  rampTexture,
  roadTexture,
  seededRandom,
  wallTexture,
} from './textures';

interface Edge {
  d: number;
  h: number;
}

/**
 * Generic strip along a run of samples. For each sample, `edges` returns the
 * two lateral points (a = more to the left, i.e. smaller d). U goes 0..1
 * from a to b; V = distance along / vRepeat.
 */
function strip(samples: TrackSample[], closed: boolean, edges: (p: TrackSample) => [Edge, Edge], vRepeat: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const count = closed ? samples.length + 1 : samples.length;
  let dist = 0;
  for (let i = 0; i < count; i++) {
    const p = samples[i % samples.length];
    if (i > 0) {
      const q = samples[(i - 1) % samples.length];
      dist += Math.hypot(p.x - q.x, p.z - q.z);
    }
    const [a, b] = edges(p);
    pos.push(p.x + p.rx * a.d, p.y + a.h, p.z + p.rz * a.d, p.x + p.rx * b.d, p.y + b.h, p.z + p.rz * b.d);
    uv.push(0, dist / vRepeat, 1, dist / vRepeat);
    if (i < count - 1) {
      const k = i * 2;
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

/** Split sample indices into contiguous runs where `pred` is true (handles wrap-around). */
function runs(samples: TrackSample[], pred: (p: TrackSample) => boolean): TrackSample[][] {
  const n = samples.length;
  const start = samples.findIndex((p) => !pred(p));
  if (start < 0) return [samples];
  const out: TrackSample[][] = [];
  let cur: TrackSample[] = [];
  for (let k = 1; k <= n; k++) {
    const p = samples[(start + k) % n];
    if (pred(p)) cur.push(p);
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Samples covering [s0, s1] (with wrap). */
function samplesBetween(track: Track, s0: number, s1: number): TrackSample[] {
  const out: TrackSample[] = [];
  const n = track.samples.length;
  const i0 = Math.floor(s0 / track.spacing);
  const steps = Math.ceil((s1 - s0) / track.spacing);
  for (let k = 0; k <= steps; k++) out.push(track.samples[(i0 + k) % n]);
  return out;
}

export class TrackView {
  readonly group = new THREE.Group();
  private boostTex: THREE.Texture;

  constructor(readonly track: Track) {
    const def = track.def;
    const hw = def.width / 2;
    const lift = (p: TrackSample, d: number) => Track.bankLift(p.bank, hw, d);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, shadows = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = shadows;
      this.group.add(m);
      return m;
    };

    // Terrain
    const grassTex = grassTexture(def.theme.grass);
    grassTex.repeat.set(250, 250);
    const terrain = add(new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: grassTex }));
    terrain.position.y = -0.05;

    // Road (banked), curbs, off-road strips
    add(strip(track.samples, true, (p) => [{ d: -hw, h: lift(p, -hw) + 0.02 }, { d: hw, h: lift(p, hw) + 0.02 }], 12), new THREE.MeshLambertMaterial({ map: roadTexture() }));
    const curbMat = new THREE.MeshLambertMaterial({ map: curbTexture() });
    add(strip(track.samples, true, (p) => [{ d: -hw - CURB_WIDTH, h: lift(p, -hw) + 0.03 }, { d: -hw, h: lift(p, -hw) + 0.03 }], 3), curbMat);
    add(strip(track.samples, true, (p) => [{ d: hw, h: lift(p, hw) + 0.03 }, { d: hw + CURB_WIDTH, h: lift(p, hw) + 0.03 }], 3), curbMat);
    const offTex = grassTexture(def.theme.offroad, 3);
    offTex.repeat.set(1, 1);
    const offMat = new THREE.MeshLambertMaterial({ map: offTex });
    const outer = hw + def.offroadWidth;
    add(strip(track.samples, true, (p) => [{ d: -outer, h: 0.01 }, { d: -hw - CURB_WIDTH, h: lift(p, -hw) + 0.01 }], 8), offMat);
    add(strip(track.samples, true, (p) => [{ d: hw + CURB_WIDTH, h: lift(p, hw) + 0.01 }, { d: outer, h: 0.01 }], 8), offMat);

    // Walls (tire barriers): vertical strips at the outer edge of the off-road.
    const wallMat = new THREE.MeshLambertMaterial({ map: wallTexture(), side: THREE.DoubleSide });
    const WALL_H = 1.1;
    for (const side of [-1, 1]) {
      const has = (p: TrackSample) => (side < 0 ? p.wallLeft : p.wallRight);
      for (const run of runs(track.samples, has)) {
        // A vertical strip: "a" at the bottom, "b" at the top, same lateral position.
        const g = strip(run, false, () => [{ d: side * outer, h: 0 }, { d: side * outer, h: WALL_H }], 2.2);
        const w = add(g, wallMat);
        w.castShadow = true;
      }
    }

    // Jump ramps: sloped top + back face.
    const rampMat = new THREE.MeshLambertMaterial({ map: rampTexture(), side: THREE.DoubleSide });
    for (const r of track.ramps) {
      const ss = samplesBetween(track, r.s0, r.s1);
      const top = strip(ss, false, (p) => {
        const h = track.rampHeight(p.s) + 0.03;
        return [{ d: -hw, h: lift(p, -hw) + h }, { d: hw, h: lift(p, hw) + h }];
      }, 3);
      add(top, rampMat).castShadow = true;
      const end = ss[ss.length - 1];
      const hEnd = track.rampHeight(end.s);
      const back = strip([end, end], false, () => [{ d: -hw, h: 0 }, { d: hw, h: 0 }], 1);
      // Re-shape the back face: second row raised to the ramp top.
      const pos = back.getAttribute('position') as THREE.BufferAttribute;
      pos.setY(2, end.y + lift(end, -hw) + hEnd);
      pos.setY(3, end.y + lift(end, hw) + hEnd);
      back.computeVertexNormals();
      add(back, new THREE.MeshLambertMaterial({ color: '#5a4a2a', side: THREE.DoubleSide }));
    }

    // Boost pads (scrolling arrows)
    this.boostTex = boostTexture();
    const boostMat = new THREE.MeshBasicMaterial({ map: this.boostTex, transparent: true });
    for (const b of track.boostPads) {
      const ss = samplesBetween(track, b.s0, b.s1);
      add(strip(ss, false, (p) => [{ d: b.d0, h: lift(p, b.d0) + 0.05 }, { d: b.d1, h: lift(p, b.d1) + 0.05 }], b.s1 - b.s0), boostMat, false);
    }

    // Start/finish line + gantry
    const s0 = track.samples[0];
    const checker = checkerTexture();
    checker.repeat.set(def.width / 1.5, 1);
    const line = add(strip([s0, track.samples[1]], false, (p) => [{ d: -hw, h: lift(p, -hw) + 0.04 }, { d: hw, h: lift(p, hw) + 0.04 }], track.spacing), new THREE.MeshLambertMaterial({ map: checker }));
    line.renderOrder = 1;
    this.group.add(buildGantry(s0, hw + 1.5));

    // Grid boxes
    const gridMat = new THREE.MeshBasicMaterial({ color: '#e8e8e8' });
    for (let i = 0; i < 4; i++) {
      const g = track.gridSpot(i);
      const mark = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.25).rotateX(-Math.PI / 2), gridMat);
      mark.position.set(g.x + Math.sin(g.heading) * 1.4, 0.05, g.z + Math.cos(g.heading) * 1.4);
      mark.rotation.y = g.heading;
      this.group.add(mark);
    }

    this.group.add(buildScenery(track));
  }

  /** Animate (boost arrows). */
  update(time: number): void {
    this.boostTex.offset.y = -time * 2;
  }
}

function buildGantry(s: TrackSample, halfSpan: number): THREE.Group {
  const g = new THREE.Group();
  const postMat = new THREE.MeshLambertMaterial({ color: '#dfe3ea' });
  const post = new THREE.BoxGeometry(0.5, 6, 0.5).translate(0, 3, 0);
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(post, postMat);
    m.position.set(s.x + s.rx * side * halfSpan, 0, s.z + s.rz * side * halfSpan);
    m.castShadow = true;
    g.add(m);
  }
  const bannerTex = checkerTexture();
  bannerTex.repeat.set(halfSpan, 1);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(halfSpan * 2 + 0.5, 1.2, 0.3), new THREE.MeshLambertMaterial({ map: bannerTex }));
  banner.position.set(s.x, 6.2, s.z);
  banner.rotation.y = s.heading; // box's long (x) axis across the road
  banner.castShadow = true;
  g.add(banner);
  return g;
}

/** Trees, buildings, rocks and distant hills, placed away from the track. */
function buildScenery(track: Track): THREE.Group {
  const def = track.def;
  const rnd = seededRandom(def.scenery.seed);
  const group = new THREE.Group();
  const clearance = def.width / 2 + def.offroadWidth + 5;
  const S = track.samples;
  const xs = S.map((p) => p.x);
  const zs = S.map((p) => p.z);
  const minX = Math.min(...xs) - 120;
  const maxX = Math.max(...xs) + 120;
  const minZ = Math.min(...zs) - 120;
  const maxZ = Math.max(...zs) + 120;
  const distToTrack = (x: number, z: number) => {
    let best = Infinity;
    for (let i = 0; i < S.length; i += 2) best = Math.min(best, (S[i].x - x) ** 2 + (S[i].z - z) ** 2);
    return Math.sqrt(best);
  };
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();

  // Trees
  const N = def.scenery.trees;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 2, 6).translate(0, 1, 0), new THREE.MeshLambertMaterial({ color: '#7a5230' }), N);
  const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1.8, 4.5, 7).translate(0, 4, 0), new THREE.MeshLambertMaterial({ color: '#ffffff' }), N);
  const blobs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2, 0).translate(0, 3.6, 0), new THREE.MeshLambertMaterial({ color: '#ffffff' }), N);
  let ti = 0;
  let bi = 0;
  for (let tries = 0; tries < N * 8 && ti + bi < N; tries++) {
    const x = minX + rnd() * (maxX - minX);
    const z = minZ + rnd() * (maxZ - minZ);
    if (distToTrack(x, z) < clearance) continue;
    const s = 0.7 + rnd() * 0.9;
    m.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(up, rnd() * 6.28), new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(ti + bi, m);
    if (rnd() < 0.6) {
      crowns.setMatrixAt(ti, m);
      crowns.setColorAt(ti, color.setHSL(0.3 + rnd() * 0.06, 0.5, 0.22 + rnd() * 0.1));
      ti++;
    } else {
      blobs.setMatrixAt(bi, m);
      blobs.setColorAt(bi, color.setHSL(0.24 + rnd() * 0.1, 0.55, 0.3 + rnd() * 0.12));
      bi++;
    }
  }
  trunks.count = ti + bi;
  crowns.count = ti;
  blobs.count = bi;
  for (const im of [trunks, crowns, blobs]) {
    im.castShadow = true;
    group.add(im);
  }

  // Buildings: simple houses (box + roof) around the outside
  const B = def.scenery.buildings;
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: '#ffffff' }), B);
  const roofs = new THREE.InstancedMesh(new THREE.ConeGeometry(0.75, 0.6, 4).rotateY(Math.PI / 4).translate(0, 0.3, 0), new THREE.MeshLambertMaterial({ color: '#ffffff' }), B);
  const palette = ['#f2e3c6', '#e9c9a4', '#d7e4ef', '#f6d6d6', '#e4efd2'];
  let hi = 0;
  for (let tries = 0; tries < B * 30 && hi < B; tries++) {
    const x = minX + rnd() * (maxX - minX);
    const z = minZ + rnd() * (maxZ - minZ);
    const d = distToTrack(x, z);
    if (d < clearance + 12 || d > 140) continue;
    const w = 6 + rnd() * 6;
    const h = 4 + rnd() * 6;
    const depth = 6 + rnd() * 5;
    q.setFromAxisAngle(up, rnd() * 6.28);
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(w, h, depth));
    walls.setMatrixAt(hi, m);
    walls.setColorAt(hi, color.set(palette[Math.floor(rnd() * palette.length)]));
    m.compose(new THREE.Vector3(x, h, z), q, new THREE.Vector3(w * 1.05, Math.max(w, depth) * 0.6, depth * 1.05));
    roofs.setMatrixAt(hi, m);
    roofs.setColorAt(hi, color.setHSL(0.02 + rnd() * 0.05, 0.55, 0.38));
    hi++;
  }
  walls.count = roofs.count = hi;
  walls.castShadow = roofs.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls, roofs);

  // Distant hills
  const hills = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#4f9a45' }), 28);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const R = Math.max(maxX - minX, maxZ - minZ) / 2 + 160;
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + rnd() * 0.2;
    const r = R + rnd() * 60;
    const s = 50 + rnd() * 60;
    m.compose(new THREE.Vector3(cx + Math.cos(a) * r, -2, cz + Math.sin(a) * r), new THREE.Quaternion(), new THREE.Vector3(s * 1.6, s * 0.45, s));
    hills.setMatrixAt(i, m);
    hills.setColorAt(i, color.setHSL(0.28 + rnd() * 0.05, 0.4, 0.3 + rnd() * 0.08));
  }
  group.add(hills);
  return group;
}
