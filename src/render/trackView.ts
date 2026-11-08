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
  wallTexture,
  waterTexture,
} from './textures';
import { buildGantry, buildScenery } from './scenery';

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
  private waterTex: THREE.Texture | null = null;

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

    // Surfaces that run along the whole loop, interrupted only by water gaps.
    const solidRuns = track.gaps.length ? runs(track.samples, (p) => !track.inGap(p.s)) : null;
    const alongTrack = (edges: (p: TrackSample) => [Edge, Edge], vRepeat: number, mat: THREE.Material) => {
      if (!solidRuns) return void add(strip(track.samples, true, edges, vRepeat), mat);
      for (const run of solidRuns) add(strip(run, false, edges, vRepeat), mat);
    };

    // Road (banked), curbs, off-road strips
    alongTrack((p) => [{ d: -hw, h: lift(p, -hw) + 0.02 }, { d: hw, h: lift(p, hw) + 0.02 }], 12, new THREE.MeshLambertMaterial({ map: roadTexture() }));
    const curbMat = new THREE.MeshLambertMaterial({ map: curbTexture() });
    alongTrack((p) => [{ d: -hw - CURB_WIDTH, h: lift(p, -hw) + 0.03 }, { d: -hw, h: lift(p, -hw) + 0.03 }], 3, curbMat);
    alongTrack((p) => [{ d: hw, h: lift(p, hw) + 0.03 }, { d: hw + CURB_WIDTH, h: lift(p, hw) + 0.03 }], 3, curbMat);
    const offTex = grassTexture(def.theme.offroad, 3);
    offTex.repeat.set(1, 1);
    const offMat = new THREE.MeshLambertMaterial({ map: offTex });
    const outer = hw + def.offroadWidth;
    alongTrack((p) => [{ d: -outer, h: 0.01 }, { d: -hw - CURB_WIDTH, h: lift(p, -hw) + 0.01 }], 8, offMat);
    alongTrack((p) => [{ d: hw + CURB_WIDTH, h: lift(p, hw) + 0.01 }, { d: outer, h: 0.01 }], 8, offMat);

    // Water in the gaps after jumps (flush with the ground; karts that fall in sink below it).
    this.waterTex = waterTexture();
    const waterMat = new THREE.MeshLambertMaterial({ map: this.waterTex, emissive: '#0b3a66' });
    for (const g of track.gaps) {
      const ss = samplesBetween(track, g.s0 - track.spacing, g.s1 + track.spacing);
      add(strip(ss, false, () => [{ d: -outer - 1, h: 0.0 }, { d: outer + 1, h: 0.0 }], 6), waterMat, false);
    }

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
    if (this.waterTex) this.waterTex.offset.set(Math.sin(time * 0.6) * 0.05, time * 0.08);
  }
}
