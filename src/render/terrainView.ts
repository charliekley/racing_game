/**
 * Draws the ground around the track from the SAME height field the physics
 * uses (`track.terrain.height`), so what you see is what you drive on.
 *
 * What it builds (each is ONE mesh = one draw call per viewport):
 *   1. the terrain: a grid of vertices (fine near the track, growing coarser
 *      toward the edge, which is hidden by fog) with vertex colors
 *      (grass -> rock on steep slopes),
 *   2. "faces": dark vertical cliff walls going down ~40 m wherever there is
 *      no ground (cliff edges, chasm gaps) plus the bridge decks,
 *   3. bridge pillars and abutments (merged boxes),
 *   4. one huge flat plane far below, so the horizon is never empty.
 *
 * Tracks WITHOUT a terrain def (all the old ones) just get the old flat plane.
 *
 * Three.js notes: a BufferGeometry is arrays of numbers (positions, colors,
 * indices). Building one mesh for the whole ground is much cheaper to draw
 * than many small meshes.
 */
import * as THREE from 'three';
import { CURB_WIDTH, Track, type TrackSample } from '../sim/track';
import { grassTexture } from './textures';
import { MeshBatch } from './meshBatch';

/** How far the dark cliff faces go down (m). */
const CLIFF_DEPTH = 40;
/** The big plane under everything sits this low (m). */
const FAR_PLANE_Y = -CLIFF_DEPTH - 8;
/** The terrain grid reaches this far beyond the track (m): beyond the fog distance. */
const GRID_REACH = 900;
/** Terrain cell size aims for at most this many cells across the area around the track. */
const MAX_INNER_CELLS = 170;
const MIN_CELL = 3;

interface V3 {
  x: number;
  y: number;
  z: number;
}

/** Collects vertex-colored quads (two triangles each) into one geometry. */
class QuadSink {
  private pos: number[] = [];
  private col: number[] = [];

  /** Quad between two rows of points: `top[i]` over `bottom[i]`, consecutive i joined. */
  strip(top: V3[], bottom: V3[], cTop: THREE.Color, cBottom: THREE.Color): void {
    for (let i = 0; i + 1 < top.length; i++) {
      this.quad(top[i], top[i + 1], bottom[i], bottom[i + 1], cTop, cBottom);
    }
  }

  quad(a: V3, b: V3, c: V3, d: V3, cTop: THREE.Color, cBottom: THREE.Color): void {
    const push = (p: V3, c: THREE.Color) => {
      this.pos.push(p.x, p.y, p.z);
      this.col.push(c.r, c.g, c.b);
    };
    push(a, cTop); push(c, cBottom); push(b, cTop);
    push(b, cTop); push(c, cBottom); push(d, cBottom);
  }

  get isEmpty(): boolean {
    return this.pos.length === 0;
  }

  build(material: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals(); // non-indexed: flat shading per triangle
    return new THREE.Mesh(g, material);
  }
}

/** Grid coordinates: uniform steps over [min, max], then steps that grow ×1.6 out to GRID_REACH on both sides. */
function axis(min: number, max: number, step: number): number[] {
  const inner = Math.max(1, Math.ceil((max - min) / step));
  const h = (max - min) / inner;
  const out: number[] = [];
  for (let i = 0; i <= inner; i++) out.push(min + i * h);
  let w = h;
  let lo = min;
  let hi = max;
  for (let reach = 0; reach < GRID_REACH; reach += w) {
    w *= 1.6;
    lo -= w;
    hi += w;
    out.unshift(lo);
    out.push(hi);
  }
  return out;
}

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export class TerrainView {
  readonly group = new THREE.Group();
  /** For performance reports: triangles in the terrain mesh and in the faces mesh. */
  readonly stats = { terrainTriangles: 0, faceTriangles: 0, meshes: 0 };

  constructor(private readonly track: Track) {
    const def = track.def;
    if (!track.terrain.enabled) {
      this.buildLegacyPlane();
      return;
    }
    const faces = new QuadSink();
    this.buildHeightField(faces);
    this.buildCliffFaces(faces);
    this.buildBridges(faces);
    if (!faces.isEmpty) {
      // Double-sided so a face is visible from both the road and from below.
      const mesh = faces.build(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.stats.faceTriangles = (mesh.geometry.getAttribute('position').count / 3) | 0;
      this.stats.meshes++;
    }

    // Far-away flat plane under everything (visible through chasms, fading into fog).
    const far = new THREE.Color(def.theme.grass).lerp(new THREE.Color(def.theme.horizon), 0.6).multiplyScalar(0.8);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: far }));
    plane.position.y = FAR_PLANE_Y;
    this.group.add(plane);
    this.stats.meshes++;
  }

  /** The old look: one flat 2000 m grass plane (tracks without a terrain def). */
  private buildLegacyPlane(): void {
    const tex = grassTexture(this.track.def.theme.grass);
    tex.repeat.set(250, 250);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: tex }));
    plane.position.y = -0.05;
    plane.receiveShadow = true;
    this.group.add(plane);
    this.stats.meshes++;
  }

  // -------------------------------------------------------------------------
  // 1. Height-field mesh
  // -------------------------------------------------------------------------
  private buildHeightField(faces: QuadSink): void {
    const track = this.track;
    const def = track.def;
    const terrain = track.terrain;
    const hw = def.width / 2;
    const outer = hw + def.offroadWidth;

    // Area around the track.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.samples) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const margin = outer + terrain.influence + 30;
    minX -= margin; maxX += margin; minZ -= margin; maxZ += margin;
    const step = Math.max(MIN_CELL, Math.max(maxX - minX, maxZ - minZ) / MAX_INNER_CELLS);
    const xs = axis(minX, maxX, step);
    const zs = axis(minZ, maxZ, step);
    const nx = xs.length;
    const nz = zs.length;

    // Where is there no ground (cliffs, void gaps)? Those vertices are "cut".
    const hasVoid = track.cliffs.length > 0 || track.gaps.some((g) => g.kind === 'void');
    const cut = hasVoid ? new Uint8Array(nx * nz) : null;
    const coarse = this.coarseIndex();

    // Heights, with the terrain dipping a few cm to dm under the road so the (flat) road
    // strips are never poked through by the coarser terrain mesh.
    const heights = new Float32Array(nx * nz);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const x = xs[ix];
        const z = zs[iz];
        const k = iz * nx + ix;
        let h = terrain.height(x, z);
        const dist = terrain.roadDistance(x, z);
        if (dist < outer) h -= 0.03 + 0.4 * (1 - smooth((dist - (hw + CURB_WIDTH)) / (outer - hw - CURB_WIDTH)));
        heights[k] = h;
        if (cut) cut[k] = this.isCut(x, z, coarse) ? 1 : 0;
      }
    }

    // Colors: grass, turning to rock on slopes, a little lighter up high.
    const grass = new THREE.Color(def.theme.grass);
    const rock = new THREE.Color(def.theme.offroad).lerp(new THREE.Color('#6d6a66'), 0.5);
    const c = new THREE.Color();
    const colors = new Float32Array(nx * nz * 3);
    const positions = new Float32Array(nx * nz * 3);
    const uvs = new Float32Array(nx * nz * 2);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const k = iz * nx + ix;
        const xl = Math.max(0, ix - 1), xr = Math.min(nx - 1, ix + 1);
        const zl = Math.max(0, iz - 1), zr = Math.min(nz - 1, iz + 1);
        const dhx = (heights[iz * nx + xr] - heights[iz * nx + xl]) / (xs[xr] - xs[xl]);
        const dhz = (heights[zr * nx + ix] - heights[zl * nx + ix]) / (zs[zr] - zs[zl]);
        const slope = Math.hypot(dhx, dhz); // rise over run
        c.copy(grass).lerp(rock, smooth((slope - 0.35) / 0.5));
        // Cheap per-vertex brightness variation so large areas aren't one flat color.
        const n = Math.sin(xs[ix] * 0.071 + 1.3) * Math.sin(zs[iz] * 0.083) * 0.06;
        c.multiplyScalar(1 + n + Math.min(0.25, Math.max(0, heights[k]) * 0.004));
        colors.set([c.r, c.g, c.b], k * 3);
        positions.set([xs[ix], heights[k], zs[iz]], k * 3);
        uvs.set([xs[ix] / 12, zs[iz] / 12], k * 2);
      }
    }

    // Triangles for every cell whose four corners have ground.
    const cells = (nx - 1) * (nz - 1);
    const present = new Uint8Array(cells);
    const index: number[] = [];
    for (let iz = 0; iz < nz - 1; iz++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const a = iz * nx + ix;
        const b = a + 1;
        const cc = a + nx;
        const d = cc + 1;
        if (cut && (cut[a] || cut[b] || cut[cc] || cut[d])) continue;
        present[iz * (nx - 1) + ix] = 1;
        index.push(a, cc, b, b, cc, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const tex = grassTexture('#e0e0e0', 5);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, vertexColors: true }));
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.stats.terrainTriangles = index.length / 3;
    this.stats.meshes++;

    // Dark walls where the ground mesh ends (next to a cut cell).
    if (cut) {
      const top = new THREE.Color('#6b5d4f');
      const bottom = new THREE.Color('#1d1a18');
      const at = (ix: number, iz: number): V3 => {
        const k = iz * nx + ix;
        return { x: xs[ix], y: heights[k], z: zs[iz] };
      };
      const down = (p: V3): V3 => ({ x: p.x, y: p.y - CLIFF_DEPTH, z: p.z });
      const isPresent = (ix: number, iz: number) => ix >= 0 && iz >= 0 && ix < nx - 1 && iz < nz - 1 && present[iz * (nx - 1) + ix] === 1;
      for (let iz = 0; iz < nz - 1; iz++) {
        for (let ix = 0; ix < nx - 1; ix++) {
          if (!isPresent(ix, iz)) continue;
          // The four edges of this cell, each against its neighbour (only inside the grid).
          const sides: [number, number, V3, V3][] = [
            [ix - 1, iz, at(ix, iz), at(ix, iz + 1)],
            [ix + 1, iz, at(ix + 1, iz), at(ix + 1, iz + 1)],
            [ix, iz - 1, at(ix, iz), at(ix + 1, iz)],
            [ix, iz + 1, at(ix, iz + 1), at(ix + 1, iz + 1)],
          ];
          for (const [jx, jz, p, q] of sides) {
            if (jx < 0 || jz < 0 || jx >= nx - 1 || jz >= nz - 1 || isPresent(jx, jz)) continue;
            faces.quad(p, q, down(p), down(q), top, bottom);
          }
        }
      }
    }
  }

  /** Every 8th sample, for a cheap "nearest part of the track" guess far from the road. */
  private coarseIndex(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.track.samples.length; i += 8) out.push(i);
    return out;
  }

  /** True where there is no ground at (x, z) because of a cliff or a chasm. */
  private isCut(x: number, z: number, coarse: number[]): boolean {
    const track = this.track;
    const S = track.samples;
    let best = Infinity;
    let bi = 0;
    for (const i of coarse) {
      const d2 = (S[i].x - x) ** 2 + (S[i].z - z) ** 2;
      if (d2 < best) {
        best = d2;
        bi = i;
      }
    }
    // Refine around the coarse guess with the real projection (also gives s and d).
    if (best < 60 * 60) return track.isVoid(track.project(x, z, bi));
    // Far from the road: s and d from the guessed sample are accurate enough.
    const p = S[bi];
    return track.isVoid({ s: p.s, d: (x - p.x) * p.rx + (z - p.z) * p.rz, width: p.width });
  }

  // -------------------------------------------------------------------------
  // 2. Cliff walls along the road edge and around chasms
  // -------------------------------------------------------------------------
  private buildCliffFaces(faces: QuadSink): void {
    const track = this.track;
    const def = track.def;
    const hw = def.width / 2;
    const outer = hw + def.offroadWidth;
    const top = new THREE.Color('#6b5d4f');
    const bottom = new THREE.Color('#1d1a18');
    const level = (p: TrackSample, d: number) => Track.groundLevel(p.y, p.bank, hw, d, def.offroadWidth);
    const point = (p: TrackSample, d: number): V3 => ({ x: p.x + p.rx * d, y: level(p, d), z: p.z + p.rz * d });
    const down = (v: V3): V3 => ({ x: v.x, y: v.y - CLIFF_DEPTH, z: v.z });

    // Cliffs: a wall straight down from the edge of the ground.
    for (const c of track.cliffs) {
      for (const side of [-1, 1]) {
        if (c.side !== 'both' && (c.side === 'left') !== side < 0) continue;
        const ss = this.samplesBetween(c.s0, c.s1);
        const upper = ss.map((p) => point(p, side * Math.min(outer, track.cliffEdgeAt(p.s, side))));
        faces.strip(upper, upper.map(down), top, bottom);
      }
    }

    // Chasm gaps: walls on both ends and along both sides of the missing road.
    for (const g of track.gaps) {
      if (g.kind !== 'void') continue;
      const ss = this.samplesBetween(g.s0, g.s1);
      const across = (p: TrackSample) => {
        const out: V3[] = [];
        for (let d = -outer - 1; d <= outer + 1.001; d += (outer + 1) / 4) out.push(point(p, d));
        return out;
      };
      for (const p of [ss[0], ss[ss.length - 1]]) {
        const row = across(p);
        faces.strip(row, row.map(down), top, bottom);
      }
      for (const side of [-1, 1]) {
        const upper = ss.map((p) => point(p, side * (outer + 1)));
        faces.strip(upper, upper.map(down), top, bottom);
      }
    }
  }

  /** Samples covering [s0, s1] (with wrap-around). */
  private samplesBetween(s0: number, s1: number): TrackSample[] {
    const track = this.track;
    const n = track.samples.length;
    const len = (((s1 - s0) % track.length) + track.length) % track.length;
    const i0 = Math.floor(s0 / track.spacing);
    const out: TrackSample[] = [];
    for (let k = 0; k <= Math.ceil(len / track.spacing); k++) out.push(track.samples[(i0 + k) % n]);
    return out;
  }

  // -------------------------------------------------------------------------
  // 3. Bridges: deck underside + sides, pillars and abutments
  // -------------------------------------------------------------------------
  private buildBridges(faces: QuadSink): void {
    const track = this.track;
    if (track.bridges.length === 0) return;
    const def = track.def;
    const hw = def.width / 2;
    const half = hw + CURB_WIDTH;
    const DECK = 1.5; // deck thickness below the road surface (m)
    const concrete = new THREE.Color('#9a9a9f');
    const shade = new THREE.Color('#6d6e74');
    const batch = new MeshBatch();
    const box = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pillarColor = new THREE.Color('#8a8b90');

    for (const b of track.bridges) {
      const ss = this.samplesBetween(b.s0, b.s1);
      const surf = (p: TrackSample, d: number): V3 => ({ x: p.x + p.rx * d, y: Track.groundLevel(p.y, p.bank, hw, d, def.offroadWidth) + 0.02, z: p.z + p.rz * d });
      const under = (v: V3): V3 => ({ x: v.x, y: v.y - DECK, z: v.z });
      // Side faces (a band of concrete below each curb) and the underside.
      for (const side of [-1, 1]) {
        const edge = ss.map((p) => surf(p, side * half));
        faces.strip(edge, edge.map(under), concrete, shade);
      }
      const l = ss.map((p) => under(surf(p, -half)));
      const r = ss.map((p) => under(surf(p, half)));
      faces.strip(l, r, shade, shade); // underside: quads between the left and right rows

      // Pillars every ~14 m plus an abutment at each end, down to the natural ground.
      const pillarEvery = Math.max(1, Math.round(14 / track.spacing));
      for (let k = 0; k < ss.length; k += pillarEvery) {
        const p = ss[k];
        const end = k === 0;
        this.addPillar(batch, box, m, q, up, p, end, DECK, half, pillarColor);
      }
      this.addPillar(batch, box, m, q, up, ss[ss.length - 1], true, DECK, half, pillarColor);
    }
    box.dispose();
    if (!batch.isEmpty) {
      const mesh = batch.build(new THREE.MeshLambertMaterial({ vertexColors: true }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.stats.meshes++;
    }
  }

  /** One T-shaped pier (column + cross beam) under the deck at sample `p`; ends get a wide abutment instead. */
  private addPillar(batch: MeshBatch, box: THREE.BoxGeometry, m: THREE.Matrix4, q: THREE.Quaternion, up: THREE.Vector3, p: TrackSample, abutment: boolean, deck: number, half: number, color: THREE.Color): void {
    const track = this.track;
    const hw = track.def.width / 2;
    const deckBottom = p.y + Track.bankLift(p.bank, hw, 0) - deck;
    // The ground under the middle of the deck (natural terrain, or the road below).
    const ground = track.terrain.height(p.x, p.z) - 0.5;
    const h = deckBottom - ground;
    if (h < 0.5) return;
    q.setFromAxisAngle(up, p.heading);
    const place = (w: number, hh: number, dd: number, y: number) => {
      m.compose(new THREE.Vector3(p.x, y, p.z), q, new THREE.Vector3(w, hh, dd));
      batch.add(box, m, color);
    };
    if (abutment) {
      place(half * 2 + 1, h, 3, ground + h / 2);
    } else {
      place(2.6, h, 2.6, ground + h / 2); // column
      place(half * 2 * 0.8, 1.0, 3.2, deckBottom - 0.5); // cross beam under the deck
    }
  }
}
