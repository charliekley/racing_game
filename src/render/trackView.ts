/**
 * Builds the visible track from the same samples the physics uses: banked road with lane
 * markings, raised rounded kerbs, off-road shoulders, jersey barriers with rails, ramps, glowing
 * boost pads, the start grid and finish line, the gantry, water pits and the scenery.
 * Static geometry is created once per track.
 *
 * Roads are "ribbons": for every centerline sample we place a few points across the road (an
 * edge profile: lateral distance + height) and join consecutive rows with triangles. A kerb is
 * just a ribbon whose profile rises and falls, which is how we get rounded shapes cheaply.
 */
import * as THREE from 'three';
import { CURB_WIDTH, Track, type TrackSample } from '../sim/track';
import { asphaltMaps, boostTexture, checkerTexture, concreteMaps, grassMaps, kerbMaps, roadTexture, snowMaps, metalMaps } from './textures';
import { ENV_TIME, buildGantry, buildScenery } from './scenery';
import { buildRamps } from './rampView';
import { FLOOR_Y, TerrainView } from './terrainView';
import { buildBranchViews, mainKerbCovered } from './branchView';
import { fluidMaterial } from './env/fluids';
import { merge, paint, scratch, tubeGeo } from './env/geo';

interface Edge {
  d: number;
  h: number;
}

/**
 * Generic ribbon along a run of samples. For each sample, `edges` returns the points across the
 * road, ordered from left (smaller d) to right. U goes 0..1 across; V = distance along / vRepeat.
 */
export function ribbon(samples: TrackSample[], closed: boolean, edges: (p: TrackSample) => Edge[], vRepeat: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const count = closed ? samples.length + 1 : samples.length;
  let dist = 0;
  let m = 2;
  for (let i = 0; i < count; i++) {
    const p = samples[i % samples.length];
    if (i > 0) {
      const q = samples[(i - 1) % samples.length];
      dist += Math.hypot(p.x - q.x, p.z - q.z);
    }
    const es = edges(p);
    m = es.length;
    for (let j = 0; j < m; j++) {
      pos.push(p.x + p.rx * es[j].d, p.y + es[j].h, p.z + p.rz * es[j].d);
      uv.push(j / (m - 1), dist / vRepeat);
    }
    if (i < count - 1) {
      for (let j = 0; j < m - 1; j++) {
        const k = i * m + j;
        idx.push(k, k + 1, k + m, k + 1, k + m + 1, k + m);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Two-edge ribbon (kept as the shape branchView expects). */
function strip(samples: TrackSample[], closed: boolean, edges: (p: TrackSample) => [Edge, Edge], vRepeat: number): THREE.BufferGeometry {
  return ribbon(samples, closed, edges, vRepeat);
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

/** Shapes of the raised kerb and the jersey barrier as [distance toward the road edge, height] profiles. */
const KERB_PROFILE: [number, number][] = [
  [0, 0.0],
  [0.12, 0.06],
  [0.4, 0.11],
  [0.8, 0.12],
  [1.05, 0.08],
  [1.2, 0.0],
];
const BARRIER_PROFILE: [number, number][] = [
  [0.34, 0],
  [0.32, 0.1],
  [0.2, 0.42],
  [0.14, 0.88],
  [0.08, 1.05],
  [-0.08, 1.05],
  [-0.14, 0.88],
  [-0.1, 0],
];

export class TrackView {
  readonly group = new THREE.Group();
  private boostTex: THREE.Texture;
  private boostMat: THREE.MeshBasicMaterial;
  /** The ground meshes (terrain, cliff faces, bridges); `stats` holds triangle counts. */
  readonly terrainView: TerrainView;

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

    // Terrain: height-field mesh + rock walls + bridges + floor (or the old flat plane without a terrain def).
    const terrainView = new TerrainView(track);
    this.group.add(terrainView.group);
    this.terrainView = terrainView;
    const hasTerrain = track.terrain.enabled;

    // Surfaces that run along the whole loop, interrupted by gaps (water or chasm).
    // Off-road strips are also left out beside bridges (nothing to stand on there).
    const solidRuns = track.gaps.length ? runs(track.samples, (p) => !track.inGap(p.s)) : null;
    const groundRuns = track.bridges.length ? runs(track.samples, (p) => !track.inGap(p.s) && !track.onBridge(p.s)) : solidRuns;
    const alongTrack = (edges: (p: TrackSample) => Edge[], vRepeat: number, mat: THREE.Material, rs = solidRuns, shadows = true) => {
      if (!rs) return void add(ribbon(track.samples, true, edges, vRepeat), mat, shadows);
      for (const run of rs) add(ribbon(run, false, edges, vRepeat), mat, shadows);
    };

    // Road: the asphalt texture carries the lane markings (edge lines, dashed centre line).
    const asphalt = asphaltMaps();
    const roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.86, metalness: 0, roughnessMap: asphalt.roughnessMap });
    alongTrack((p) => [{ d: -hw, h: lift(p, -hw) + 0.02 }, { d: 0, h: lift(p, 0) + 0.02 }, { d: hw, h: lift(p, hw) + 0.02 }], 12, roadMat);

    // Rounded raised kerbs with red/white stone bands.
    const kerb = kerbMaps();
    for (const t of [kerb.map, kerb.normalMap, kerb.roughnessMap]) t.repeat.set(1, 1);
    const kerbMat = new THREE.MeshStandardMaterial({ ...kerb, roughness: 1 });
    // Where a shortcut branch road opens through the verge, the main kerb is left out (it would poke through the branch road).
    const kerbCover = mainKerbCovered(track);
    for (const side of [-1, 1]) {
      const covered = kerbCover(side);
      alongTrack(
        (p) => {
          // From the road edge outward (inner edge first), mirrored so the left side runs outer -> inner.
          const pts = KERB_PROFILE.map(([dd, hh]) => ({ d: side * (hw + dd), h: lift(p, side * hw) + 0.02 + hh }));
          return side < 0 ? pts.reverse() : pts;
        },
        3,
        kerbMat,
        covered.size > 0 ? runs(track.samples, (p) => !track.inGap(p.s) && !covered.has(p)) : solidRuns,
      );
    }

    // Off-road shoulders.
    const shoulder = '#' + new THREE.Color(def.theme.offroad).lerp(new THREE.Color(def.theme.grass), 0.4).getHexString();
    const alpine = hexLight(def.theme.grass) > 0.72;
    const offMaps = alpine ? snowMaps() : grassMaps(shoulder);
    for (const t of [offMaps.map, offMaps.normalMap, offMaps.roughnessMap]) t.repeat.set(1, 1);
    const offMat = new THREE.MeshStandardMaterial({ ...offMaps, roughness: 1, color: alpine ? new THREE.Color(shoulder).lerp(new THREE.Color('#ffffff'), 0.5) : new THREE.Color('#ffffff') });
    const outer = hw + def.offroadWidth;
    const stripH = (p: TrackSample, d: number) => Track.groundLevel(p.y, p.bank, hw, d, def.offroadWidth) - p.y + 0.01;
    const outerD = (p: TrackSample, side: number) => Math.min(outer, track.cliffEdgeAt(p.s, side));
    alongTrack((p) => {
      const o = outerD(p, -1);
      return [{ d: -o, h: stripH(p, -o) }, { d: -hw - CURB_WIDTH, h: lift(p, -hw) + 0.01 }];
    }, 8, offMat, groundRuns);
    alongTrack((p) => {
      const o = outerD(p, 1);
      return [{ d: hw + CURB_WIDTH, h: lift(p, hw) + 0.01 }, { d: o, h: stripH(p, o) }];
    }, 8, offMat, groundRuns);

    // Water pits in the gaps after jumps (quay walls come from TerrainView; see terrainView.ts).
    const sky = new THREE.Color(def.theme.sky);
    const horizon = new THREE.Color(def.theme.horizon);
    const waterMat = fluidMaterial('water', { sky, horizon });
    const concrete = concreteMaps();
    for (const t of [concrete.map, concrete.normalMap, concrete.roughnessMap]) t.repeat.set(1, 1);
    const capMat = new THREE.MeshStandardMaterial({ ...concrete, roughness: 1, color: '#c8cacf', side: THREE.DoubleSide });
    for (const g of track.gaps) {
      if (g.kind !== 'water') continue;
      const ss = samplesBetween(track, g.s0 - track.spacing, g.s1 + track.spacing);
      const y0 = ss.reduce((a, p) => a + p.y, 0) / ss.length;
      const level = hasTerrain ? y0 - 0.9 : y0 + 0.02;
      const half = outer + 1.4;
      const cols = 8;
      const pos: number[] = [];
      const edge: number[] = [];
      const idx: number[] = [];
      ss.forEach((p, i) => {
        for (let c = 0; c <= cols; c++) {
          const d = -half + (2 * half * c) / cols;
          pos.push(p.x + p.rx * d, level, p.z + p.rz * d);
          edge.push(Math.min(half - Math.abs(d), i * track.spacing, (ss.length - 1 - i) * track.spacing) - 0.4);
        }
        if (i < ss.length - 1) for (let c = 0; c < cols; c++) {
          const k = i * (cols + 1) + c;
          idx.push(k, k + cols + 1, k + 1, k + 1, k + cols + 1, k + cols + 2);
        }
      });
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      wg.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
      wg.setIndex(idx);
      this.group.add(new THREE.Mesh(wg, waterMat));
      if (hasTerrain) {
        // Concrete end faces under the road strips where the road stops at the water.
        for (const p of [samplesBetween(track, g.s0, g.s0)[0], samplesBetween(track, g.s1, g.s1)[0]]) {
          const q = new THREE.BufferGeometry();
          const wd = hw + CURB_WIDTH;
          const top = (d: number) => [p.x + p.rx * d, p.y + lift(p, d) - 0.02, p.z + p.rz * d];
          const bot = (d: number) => [p.x + p.rx * d, level - 1.2, p.z + p.rz * d];
          q.setAttribute('position', new THREE.Float32BufferAttribute([...top(-wd), ...top(wd), ...bot(-wd), ...bot(wd)], 3));
          q.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 4, 1, 0, 0, 4, 0], 2));
          q.setIndex([0, 2, 1, 1, 2, 3]);
          q.computeVertexNormals();
          add(q, capMat);
        }
      }
    }
    void FLOOR_Y;

    // Barriers: smooth jersey walls at the outer edge of the off-road, with posts and a rail on top.
    const barrier = kerbMaps();
    for (const t of [barrier.map, barrier.normalMap, barrier.roughnessMap]) t.repeat.set(1, 1);
    const barrierMat = new THREE.MeshStandardMaterial({ ...barrier, roughness: 1, side: THREE.DoubleSide });
    const steel = new THREE.Color('#d6dae0');
    const posts: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const has = (p: TrackSample) => (side < 0 ? p.wallLeft : p.wallRight);
      for (const run of runs(track.samples, has)) {
        // A wall on a cliff side stands at the cliff edge (like the collision wall does).
        // On a bridge the parapet stands at the deck edge (like the collision wall: Track.wallsAt).
        const wallD = (p: TrackSample) => side * Math.min(track.onBridge(p.s) ? hw + CURB_WIDTH : outer, track.cliffEdgeAt(p.s, side));
        const m = add(ribbon(run, false, (p) => BARRIER_PROFILE.map(([dIn, h]) => ({ d: wallD(p) - side * dIn, h })), 6), barrierMat);
        m.castShadow = true;
        const pts: THREE.Vector3[] = [];
        const step = Math.max(1, Math.round(5 / track.spacing));
        run.forEach((p, i) => {
          if (i % step !== 0 && i !== run.length - 1) return;
          const d = wallD(p);
          pts.push(new THREE.Vector3(p.x + p.rx * d, p.y + 1.55, p.z + p.rz * d));
          const base = new THREE.Vector3(p.x + p.rx * d, p.y + 0.9, p.z + p.rz * d);
          posts.push(paint(tubeGeo([base, base.clone().setY(base.y + 0.75)], [0.07, 0.07], 6), () => scratch.copy(steel)));
        });
        if (pts.length > 1) posts.push(paint(tubeGeo(pts, pts.map(() => 0.06), 6), () => scratch.copy(steel)));
      }
    }
    if (posts.length) {
      const metal = metalMaps();
      void metal;
      const pm = new THREE.Mesh(merge(posts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 }));
      pm.castShadow = true;
      this.group.add(pm);
    }

    // Jump ramps (kicker / hump / double shapes, landing aprons, chasm floors): see rampView.ts.
    this.group.add(buildRamps(track));

    // Boost pads: bright chevrons scrolling forward. Colour above 1 so they glow (and bloom).
    this.boostTex = boostTexture();
    this.boostMat = new THREE.MeshBasicMaterial({ map: this.boostTex, color: new THREE.Color(2.4, 2.4, 2.4) });
    const padFrame = new THREE.MeshStandardMaterial({ color: '#ffb020', emissive: new THREE.Color('#ff8a00'), emissiveIntensity: 2.6, roughness: 0.5 });
    for (const b of track.boostPads) {
      const ss = samplesBetween(track, b.s0, b.s1);
      add(strip(ss, false, (p) => [{ d: b.d0, h: lift(p, b.d0) + 0.05 }, { d: b.d1, h: lift(p, b.d1) + 0.05 }], b.s1 - b.s0), this.boostMat, false);
      // Glowing border: two thin bars along the sides.
      for (const d of [b.d0, b.d1]) {
        add(strip(ss, false, (p) => [{ d: d - 0.09, h: lift(p, d) + 0.06 }, { d: d + 0.09, h: lift(p, d) + 0.06 }], 4), padFrame, false);
      }
    }

    // Start/finish line + gantry
    const s0 = track.samples[0];
    const checker = checkerTexture();
    checker.repeat.set(def.width / 1.5, 1);
    const line = add(strip([s0, track.samples[1]], false, (p) => [{ d: -hw, h: lift(p, -hw) + 0.04 }, { d: hw, h: lift(p, hw) + 0.04 }], track.spacing), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.6 }));
    line.renderOrder = 1;
    this.group.add(buildGantry(s0, hw + 1.5));

    // Starting grid: a painted box per kart (a bar across the front and two side ticks).
    const gridPos: number[] = [];
    const gridIdx: number[] = [];
    const quad = (cx: number, cz: number, y: number, h: number, ox: number, oz: number, w: number, l: number) => {
      // local x = across, local z = along the heading
      const fx = Math.sin(h);
      const fz = Math.cos(h);
      const rx = fz;
      const rz = -fx;
      const c = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      const base = gridPos.length / 3;
      for (const [a, b] of c) gridPos.push(cx + rx * (ox + a * w / 2) + fx * (oz + b * l / 2), y, cz + rz * (ox + a * w / 2) + fz * (oz + b * l / 2));
      gridIdx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    };
    for (let i = 0; i < 4; i++) {
      const g = track.gridSpot(i);
      const y = (track.sample(g.x, g.z)?.height ?? 0) + 0.05;
      quad(g.x, g.z, y, g.heading, 0, 1.6, 2.6, 0.22);
      quad(g.x, g.z, y, g.heading, -1.3, 0.8, 0.2, 1.8);
      quad(g.x, g.z, y, g.heading, 1.3, 0.8, 0.2, 1.8);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gridPos, 3));
    gg.setIndex(gridIdx);
    gg.computeVertexNormals();
    const gm = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    gm.receiveShadow = true;
    this.group.add(gm);

    // Shortcut branch roads, curbs, walls and the fork gates (render/branchView.ts).
    this.group.add(buildBranchViews(track, strip));

    this.group.add(buildScenery(track));
  }

  /** Animate (boost arrows and glow, water, lava, flags and foliage through the shared clock). */
  update(time: number): void {
    ENV_TIME.value = time;
    this.boostTex.offset.y = -time * 2.2;
    const k = 2.4 + 0.9 * Math.sin(time * 6);
    this.boostMat.color.setRGB(k, k, k);
  }
}

function hexLight(hex: string): number {
  return new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }).l;
}
