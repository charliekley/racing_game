/**
 * Draws the ground around the track from the SAME height field the physics uses
 * (`track.terrain.height`), so what you see is what you drive on.
 *
 * What it builds:
 *   1. the terrain: a grid of vertices (fine near the track, growing coarser toward the edge,
 *      which is hidden by fog) with SMOOTH normals and vertex colours blended by slope, height,
 *      distance to the road and noise (grass -> rock -> snow, ash, sand...). Where the ground
 *      ends (cliffs, chasms, water pits) the grid cells are clipped along the true edge
 *      (see "marching squares" below), so edges are smooth curves, not staircases.
 *   2. rock walls: rough, banded, noise-displaced faces dropping from every ground edge,
 *   3. bridge decks, pillars, abutments and railings,
 *   4. the floor far below (lava sea, cloud sea, or dark rock) and basin lakes (lava lake in the
 *      crater, ice on a frozen lake).
 *
 * "Marching squares": for each grid cell we know which corners have ground. A cell that is
 * partly cut is clipped: corners with ground are kept and, on each edge between a ground and a
 * cut corner, we binary-search (bisect) for the exact point where the ground ends. The clipped
 * polygon is then triangulated, and its cut side becomes the top of a rock wall.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CURB_WIDTH, Track, type TrackSample } from '../sim/track';
import { concreteMaps, grassMaps, rockMaps } from './textures';
import { fbm3, noise3, ridged3, smoothstep } from './env/noise';
import { fluidMaterial, discGeo, gridPlane } from './env/fluids';
import { groundMaterial } from './env/materials';
import { latheGeo, merge, paint, scratch, tubeGeo, matrix } from './env/geo';
import { boxPart } from './env/parts';
import { tiledGroup } from './env/tiles';
import { envQuality } from './env/batch';
import { styleFor } from './scenery';
import { biomeFor } from '../track/sceneryPlan';

/** The floor far below everything sits this low (m). */
export const FLOOR_Y = -48;
/** Depth of a water pit (m). */
const PIT_DEPTH = 3.2;
/** The terrain grid reaches this far beyond the track (m): beyond the fog distance. */
const GRID_REACH = 900;
const MAX_INNER_CELLS = 230;
const MIN_CELL = 2.6;
/** Edge length (m) of the culling tiles the ground and the rock walls are cut into (see env/tiles.ts). */
const TERRAIN_TILE = 300;
const WALL_TILE = 200;

interface V3 {
  x: number;
  y: number;
  z: number;
}

/** Axis: uniform steps over [min, max], then steps that grow x1.6 out to GRID_REACH on both sides. */
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

/** Colours of a theme's ground, rock, and so on. */
interface Palette {
  grass: THREE.Color;
  grassLight: THREE.Color;
  shoulder: THREE.Color;
  rock: THREE.Color;
  rockDark: THREE.Color;
  high: THREE.Color;
  snowLine: number; // height above which snow settles (Infinity = none)
}

function paletteFor(track: Track, style: ReturnType<typeof styleFor>): Palette {
  const t = track.def.theme;
  const grass = new THREE.Color(t.grass);
  const shoulder = new THREE.Color(t.offroad);
  const p: Palette = {
    grass,
    grassLight: grass.clone().offsetHSL(0.015, 0.02, 0.07),
    shoulder,
    rock: shoulder.clone().lerp(new THREE.Color('#7a746c'), 0.55),
    rockDark: shoulder.clone().lerp(new THREE.Color('#3c3835'), 0.7),
    high: grass.clone().offsetHSL(0, -0.05, 0.1),
    snowLine: Infinity,
  };
  switch (style) {
    case 'alpine':
      p.rock = new THREE.Color('#7f8a98');
      p.rockDark = new THREE.Color('#4b5563');
      p.grassLight = new THREE.Color('#ffffff');
      p.high = new THREE.Color('#ffffff');
      break;
    case 'volcanic':
      p.rock = new THREE.Color('#6a3a2a');
      p.rockDark = new THREE.Color('#1d1514');
      p.grassLight = new THREE.Color('#5a3d36');
      p.high = new THREE.Color('#2c2120');
      break;
    case 'sky':
      p.rock = new THREE.Color('#d8bf8a');
      p.rockDark = new THREE.Color('#8a7050');
      break;
    case 'harbour':
      p.rock = new THREE.Color('#8c9098');
      p.rockDark = new THREE.Color('#50555d');
      break;
    default:
      break;
  }
  return p;
}

/** Accumulates rock walls (indexed, then welded and smoothed at build time). */
class WallSink {
  private pos: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];
  private count = 0;

  constructor(
    private readonly pal: Palette,
    private readonly floorY: number,
  ) {}

  get isEmpty(): boolean {
    return this.count === 0;
  }

  /**
   * A wall hanging from the polyline `top`. `out[i]` = horizontal unit vector pointing away from
   * the ground (into the void); rock bulges along it. `depth` metres down (or to the floor when
   * `toFloor`). `lip[i]` = ground colour at the top, blended into the rock.
   */
  wall(top: V3[], out: V3[], depth: number | 'floor', lip: THREE.Color[], bulge = 1): void {
    const n = top.length;
    if (n < 2) return;
    const base = this.count;
    // Rows spaced densely near the top, growing with depth.
    const maxDepth = depth === 'floor' ? Math.max(4, Math.max(...top.map((p) => p.y)) - this.floorY + 1) : depth;
    const rows = maxDepth > 20 ? 12 : maxDepth > 6 ? 7 : 3;
    for (let r = 0; r <= rows; r++) {
      const t = Math.pow(r / rows, maxDepth > 20 ? 1.7 : 1.0);
      for (let i = 0; i < n; i++) {
        const d = depth === 'floor' ? Math.max(1, top[i].y - this.floorY + 1) : depth;
        const y = top[i].y - d * t;
        // Rough rock: noise pushes the face in and out; none at the very top so it meets the ground.
        const k = smoothstep(0.0, 0.12, t);
        const bump = (fbm3(top[i].x * 0.16, y * 0.14, top[i].z * 0.16, 3, 3) - 0.5) * 3.2 * bulge * k + (ridged3(top[i].x * 0.4, y * 0.35, top[i].z * 0.4, 8, 2) - 0.5) * 0.9 * k;
        const x = top[i].x + out[i].x * bump;
        const z = top[i].z + out[i].z * bump;
        this.pos.push(x, y, z);
        // Colour: grass lip -> banded rock -> dark depths.
        const band = noise3(x * 0.05, y * 0.6, z * 0.05, 5);
        const rockC = scratch.copy(this.pal.rockDark).lerp(this.pal.rock, THREE.MathUtils.clamp(0.25 + band * 0.9 + (fbm3(x * 0.3, y * 0.3, z * 0.3, 9) - 0.5), 0, 1));
        rockC.multiplyScalar(1 - 0.55 * smoothstep(0.35, 1.0, t) * (depth === 'floor' ? 0.7 : 0.4));
        rockC.lerp(lip[i], 1 - smoothstep(0.0, 0.1, t));
        this.col.push(rockC.r, rockC.g, rockC.b);
        this.uv.push((x + z) / 14, y / 14);
      }
    }
    this.count += n * (rows + 1);
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < n - 1; i++) {
        const a = base + r * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        this.idx.push(a, c, b, b, c, d);
      }
    }
  }

  build(material: THREE.Material): THREE.Mesh {
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g = mergeVertices(g, 0.02); // weld shared edges so neighbouring walls shade smoothly
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    return m;
  }
}

export class TerrainView {
  readonly group = new THREE.Group();
  /** For performance reports. */
  readonly stats = { terrainTriangles: 0, faceTriangles: 0, meshes: 0 };

  private readonly style: ReturnType<typeof styleFor>;
  private readonly pal: Palette;

  constructor(private readonly track: Track) {
    const def = track.def;
    this.style = styleFor(def, biomeFor(def.theme));
    this.pal = paletteFor(track, this.style);
    if (!track.terrain.enabled) {
      this.buildLegacyPlane();
      return;
    }
    const walls = new WallSink(this.pal, FLOOR_Y);
    this.buildHeightField(walls);
    this.buildCliffWalls(walls);
    this.buildBridges();
    if (!walls.isEmpty) {
      const mesh = walls.build(groundMaterial({ maps: rockMaps(), strata: 0.9, mottle: 0.4, side: THREE.DoubleSide }));
      this.stats.faceTriangles = (mesh.geometry.getIndex()!.count / 3) | 0;
      // The rock walls hang DOWN from the ground edge into the void, so they shade nothing worth a shadow draw
      // (they used to cast, which cost 50-120k triangles in every shadow pass): receive only.
      const tiles = tiledGroup(mesh.geometry, mesh.material as THREE.Material, WALL_TILE, false, true);
      this.group.add(tiles);
      this.stats.meshes += tiles.children.length;
    }
    this.buildFloorAndLakes();
  }

  /** The old look: one flat grass plane (tracks without a terrain def). */
  private buildLegacyPlane(): void {
    const maps = grassMaps(this.track.def.theme.grass);
    for (const t of [maps.map, maps.normalMap, maps.roughnessMap]) t.repeat.set(250, 250);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ ...maps, roughness: 1 }));
    plane.position.y = -0.05;
    plane.receiveShadow = true;
    this.group.add(plane);
    this.stats.meshes++;
  }

  // -------------------------------------------------------------------------
  // 1. Height-field mesh with clipped (marching squares) edges
  // -------------------------------------------------------------------------
  private buildHeightField(walls: WallSink): void {
    const track = this.track;
    const def = track.def;
    const terrain = track.terrain;
    const hw = def.width / 2;
    const outer = hw + def.offroadWidth;
    const pal = this.pal;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.samples) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const margin = outer + terrain.influence + 30;
    minX -= margin; maxX += margin; minZ -= margin; maxZ += margin;
    // Medium/Low (envQuality.cheap) use a coarser grid: about half the terrain triangles, still smooth-shaded.
    const cheap = envQuality.cheap;
    const step = Math.max(cheap ? MIN_CELL * 1.35 : MIN_CELL, Math.max(maxX - minX, maxZ - minZ) / (cheap ? MAX_INNER_CELLS * 0.72 : MAX_INNER_CELLS));
    const xs = axis(minX, maxX, step);
    const zs = axis(minZ, maxZ, step);
    const nx = xs.length;
    const nz = zs.length;

    const coarse: number[] = [];
    for (let i = 0; i < track.samples.length; i += 8) coarse.push(i);

    /** 0 = ground, 1 = void (cliff / chasm), 2 = water pit. */
    const cutAt = (x: number, z: number): number => {
      const S = track.samples;
      let best = Infinity;
      let bi = 0;
      for (const i of coarse) {
        const d2 = (S[i].x - x) ** 2 + (S[i].z - z) ** 2;
        if (d2 < best) { best = d2; bi = i; }
      }
      let proj: { s: number; d: number; width: number };
      if (best < 60 * 60) proj = track.project(x, z, bi);
      else {
        const p = S[bi];
        proj = { s: p.s, d: (x - p.x) * p.rx + (z - p.z) * p.rz, width: p.width };
      }
      if (track.isVoid(proj)) return 1;
      if (track.gaps.length && Math.abs(proj.d) <= proj.width / 2 + def.offroadWidth + 1 && track.inGap(proj.s)) return 2;
      return 0;
    };
    const hasCut = track.cliffs.length > 0 || track.gaps.length > 0;

    const heightAt = (x: number, z: number): number => {
      let h = terrain.height(x, z);
      const dist = terrain.roadDistance(x, z);
      // Dip a little under the road strips so the flat road ribbons are never poked through.
      if (dist < outer) h -= 0.03 + 0.4 * (1 - smooth((dist - (hw + CURB_WIDTH)) / (outer - hw - CURB_WIDTH)));
      return h;
    };

    const heights = new Float32Array(nx * nz);
    const cut = new Uint8Array(nx * nz);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const k = iz * nx + ix;
        heights[k] = heightAt(xs[ix], zs[iz]);
        if (hasCut) cut[k] = cutAt(xs[ix], zs[iz]);
      }
    }

    const positions: number[] = [];
    const colors: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];

    const slopeAt = (ix: number, iz: number): number => {
      const xl = Math.max(0, ix - 1), xr = Math.min(nx - 1, ix + 1);
      const zl = Math.max(0, iz - 1), zr = Math.min(nz - 1, iz + 1);
      const dhx = (heights[iz * nx + xr] - heights[iz * nx + xl]) / (xs[xr] - xs[xl]);
      const dhz = (heights[zr * nx + ix] - heights[zl * nx + ix]) / (zs[zr] - zs[zl]);
      return Math.hypot(dhx, dhz);
    };

    const c = new THREE.Color();
    /** Colour at a point: grass -> rock by slope, height tints, snow/ash, soft blend into the road shoulders. */
    const colorAt = (x: number, y: number, z: number, slope: number): THREE.Color => {
      const n1 = fbm3(x * 0.02, 0, z * 0.02, 12, 3);
      const n2 = fbm3(x * 0.11, 0, z * 0.11, 14, 2);
      c.copy(pal.grass).lerp(pal.grassLight, THREE.MathUtils.clamp((n1 - 0.35) * 2.2, 0, 1));
      c.lerp(pal.high, smooth((y - 8) / 40) * 0.5);
      // Cliffs: steep slopes show rock, with strata-ish variation.
      const rockAmt = smooth((slope - 0.38 + (n2 - 0.5) * 0.25) / 0.5);
      const rockCol = scratch.copy(pal.rockDark).lerp(pal.rock, THREE.MathUtils.clamp(0.4 + (n1 - 0.5) * 1.4 + noise3(x * 0.05, y * 0.5, z * 0.05, 4) * 0.4, 0, 1));
      c.lerp(rockCol, rockAmt);
      if (this.style === 'alpine') {
        // Snow settles on gentle slopes; steep faces stay bare.
        c.lerp(new THREE.Color('#f8fbff'), smooth((0.55 - slope) / 0.3) * 0.85 * (1 - rockAmt * 0.8));
      } else if (this.style === 'volcanic') {
        // Ash drifts darker in hollows; faint hot cracks high up on the cone.
        const crack = smoothstep(0.8, 0.93, ridged3(x * 0.03, y * 0.02, z * 0.03, 22, 3)) * smoothstep(12, 30, y) * rockAmt;
        c.lerp(new THREE.Color(2.2, 0.55, 0.12), crack * 0.5);
      }
      // Blend into the road shoulders so there is no hard seam.
      const dist = track.terrain.roadDistance(x, z);
      const shoulder = 1 - smooth((dist - outer + 1) / 12);
      if (shoulder > 0) c.lerp(pal.shoulder, shoulder * 0.55 * (1 - rockAmt));
      return c;
    };

    // Output vertices for grid points (lazy) and for edge crossings (cached by edge).
    const gridId = new Int32Array(nx * nz).fill(-1);
    const emit = (x: number, y: number, z: number, col: THREE.Color): number => {
      positions.push(x, y, z);
      colors.push(col.r, col.g, col.b);
      uvs.push(x / 10, z / 10);
      return positions.length / 3 - 1;
    };
    const gridVertex = (ix: number, iz: number): number => {
      const k = iz * nx + ix;
      if (gridId[k] < 0) gridId[k] = emit(xs[ix], heights[k], zs[iz], colorAt(xs[ix], heights[k], zs[iz], slopeAt(ix, iz)));
      return gridId[k];
    };
    interface Cross { id: number; x: number; y: number; z: number; ox: number; oz: number; kind: number; colorLip: THREE.Color }
    const crossCache = new Map<number, Cross>();
    const crossing = (ia: number, ib: number): Cross => {
      // ia: ground vertex index (k), ib: cut vertex index (k)
      const key = ia < ib ? ia * 4194304 + ib : ib * 4194304 + ia;
      let cr = crossCache.get(key);
      if (cr) return cr;
      const ax = xs[ia % nx], az = zs[(ia / nx) | 0];
      const bx = xs[ib % nx], bz = zs[(ib / nx) | 0];
      let lo = 0, hi = 1;
      for (let i = 0; i < 8; i++) {
        const m = (lo + hi) / 2;
        if (cutAt(ax + (bx - ax) * m, az + (bz - az) * m)) hi = m;
        else lo = m;
      }
      const t = lo;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const y = heightAt(x, z);
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const lipCol = colorAt(x, y, z, slopeAt(ia % nx, (ia / nx) | 0)).clone();
      const id = emit(x, y, z, lipCol);
      cr = { id, x, y, z, ox: (bx - ax) / len, oz: (bz - az) / len, kind: cut[ib], colorLip: lipCol };
      crossCache.set(key, cr);
      return cr;
    };

    const wallTop: V3[][] = [];
    const wallOut: V3[][] = [];
    const wallLip: THREE.Color[][] = [];
    const wallKind: number[] = [];

    for (let iz = 0; iz < nz - 1; iz++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const a = iz * nx + ix; // (x, z)
        const cc = a + nx; // (x, z+)
        const d = cc + 1; // (x+, z+)
        const b = a + 1; // (x+, z)
        const loop = [a, cc, d, b]; // counter-clockwise seen from above: faces up
        const cutCount = (cut[a] ? 1 : 0) + (cut[cc] ? 1 : 0) + (cut[d] ? 1 : 0) + (cut[b] ? 1 : 0);
        if (cutCount === 4) continue;
        if (cutCount === 0) {
          const va = gridVertex(ix, iz), vc = gridVertex(ix, iz + 1), vd = gridVertex(ix + 1, iz + 1), vb = gridVertex(ix + 1, iz);
          // Split along the shorter diagonal-ish: alternate to avoid directional artefacts.
          if ((ix + iz) % 2 === 0) index.push(va, vc, vd, va, vd, vb);
          else index.push(va, vc, vb, vb, vc, vd);
          continue;
        }
        // Clip: walk the loop, keep ground corners, add crossings on edges that change.
        const poly: number[] = [];
        let exit: Cross | null = null;
        for (let k = 0; k < 4; k++) {
          const i = loop[k];
          const j = loop[(k + 1) % 4];
          if (!cut[i]) poly.push(gridVertex(i % nx, (i / nx) | 0));
          if (!!cut[i] !== !!cut[j]) {
            const cr = cut[i] ? crossing(j, i) : crossing(i, j);
            poly.push(cr.id);
            if (!cut[i]) exit = cr;
            else if (exit) {
              // Boundary segment from `exit` (leaving ground) to `cr` (back onto ground).
              wallTop.push([{ x: exit.x, y: exit.y, z: exit.z }, { x: cr.x, y: cr.y, z: cr.z }]);
              wallOut.push([{ x: exit.ox, y: 0, z: exit.oz }, { x: cr.ox, y: 0, z: cr.oz }]);
              wallLip.push([exit.colorLip, cr.colorLip]);
              wallKind.push(cr.kind);
              exit = null;
            }
          }
        }
        // A segment that wraps past the loop start (exit found last, entry first).
        if (exit) {
          // find the entry crossing: first transition cut->ground in the loop
          for (let k = 0; k < 4; k++) {
            const i = loop[k], j = loop[(k + 1) % 4];
            if (cut[i] && !cut[j]) {
              const cr = crossing(j, i);
              wallTop.push([{ x: exit.x, y: exit.y, z: exit.z }, { x: cr.x, y: cr.y, z: cr.z }]);
              wallOut.push([{ x: exit.ox, y: 0, z: exit.oz }, { x: cr.ox, y: 0, z: cr.oz }]);
              wallLip.push([exit.colorLip, cr.colorLip]);
              wallKind.push(cr.kind);
              break;
            }
          }
        }
        for (let k = 1; k + 1 < poly.length; k++) index.push(poly[0], poly[k], poly[k + 1]);
      }
    }

    // Rock walls from the clipped edges. Cliffs next to the road are drawn from the road strip
    // (see buildCliffWalls), so here only the segments that are away from the road, plus water pits.
    for (let i = 0; i < wallTop.length; i++) {
      const mid = wallTop[i][0];
      if (wallKind[i] === 1 && terrain.roadDistance(mid.x, mid.z) < outer + 1.6) continue;
      walls.wall(wallTop[i], wallOut[i], wallKind[i] === 2 ? PIT_DEPTH : 'floor', wallLip[i], wallKind[i] === 2 ? 0.2 : 1);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(index);
    geo.computeVertexNormals(); // shared vertices -> smooth shading, no facets
    // One mesh per ~300 m tile instead of one huge mesh: tiles outside the camera view (or outside the
    // shadow box) are skipped, which cuts the terrain triangles per view to a fraction.
    const tiles = tiledGroup(geo, groundMaterial({ maps: grassMaps('#e4e4e4'), mottle: 0.32, speckle: 0.1 }), TERRAIN_TILE, false, true);
    this.group.add(tiles);
    this.stats.terrainTriangles = index.length / 3;
    this.stats.meshes += tiles.children.length;
  }

  // -------------------------------------------------------------------------
  // 2. Rock walls along the road's cliff edges and around chasms
  // -------------------------------------------------------------------------
  private buildCliffWalls(walls: WallSink): void {
    const track = this.track;
    const def = track.def;
    const hw = def.width / 2;
    const outer = hw + def.offroadWidth;
    const lip = (n: number) => Array.from({ length: n }, () => this.pal.shoulder);
    const level = (p: TrackSample, d: number) => Track.groundLevel(p.y, p.bank, hw, d, def.offroadWidth) + 0.01;
    const point = (p: TrackSample, d: number): V3 => ({ x: p.x + p.rx * d, y: level(p, d), z: p.z + p.rz * d });

    for (const c of track.cliffs) {
      for (const side of [-1, 1]) {
        if (c.side !== 'both' && (c.side === 'left') !== side < 0) continue;
        const ss = this.samplesBetween(c.s0, c.s1);
        const top = ss.map((p) => point(p, side * Math.min(outer, track.cliffEdgeAt(p.s, side))));
        const out = ss.map((p) => ({ x: p.rx * side, y: 0, z: p.rz * side }));
        walls.wall(top, out, 'floor', lip(top.length));
      }
    }
    for (const g of track.gaps) {
      if (g.kind !== 'void') continue;
      const ss = this.samplesBetween(g.s0, g.s1);
      const across = (p: TrackSample) => {
        const o: V3[] = [];
        for (let d = -outer - 1; d <= outer + 1.001; d += (outer + 1) / 4) o.push(point(p, d));
        return o;
      };
      // End walls: the void lies beyond the first sample's ground (forward) / before the last (backward).
      [ss[0], ss[ss.length - 1]].forEach((p, k) => {
        const row = across(p);
        const dir = k === 0 ? 1 : -1;
        walls.wall(row, row.map(() => ({ x: p.tx * dir, y: 0, z: p.tz * dir })), 'floor', lip(row.length), 0.5);
      });
      for (const side of [-1, 1]) {
        const top = ss.map((p) => point(p, side * (outer + 1)));
        walls.wall(top, ss.map((p) => ({ x: -p.rx * side, y: 0, z: -p.rz * side })), 'floor', lip(top.length), 0.5);
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
  // 3. Bridges: deck underside + sides, rounded pillars, abutments, railings
  // -------------------------------------------------------------------------
  private buildBridges(): void {
    const track = this.track;
    if (track.bridges.length === 0) return;
    const def = track.def;
    const hw = def.width / 2;
    const half = hw + CURB_WIDTH;
    const DECK = 1.5;
    const concrete = new THREE.Color('#aeb0b6');
    const shade = new THREE.Color('#70737b');
    const pos: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const quadStrip = (a: V3[], b: V3[], ca: THREE.Color, cb: THREE.Color, flip: boolean) => {
      const base = pos.length / 3;
      for (let i = 0; i < a.length; i++) {
        for (const [p, c] of [[a[i], ca], [b[i], cb]] as [V3, THREE.Color][]) {
          pos.push(p.x, p.y, p.z);
          col.push(c.r, c.g, c.b);
          uv.push((p.x + p.z) / 6, p.y / 6);
        }
      }
      for (let i = 0; i < a.length - 1; i++) {
        const k = base + i * 2;
        if (flip) idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        else idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    };
    const solids: THREE.BufferGeometry[] = [];
    const steel = new THREE.Color('#d9dde3');

    for (const b of track.bridges) {
      const ss = this.samplesBetween(b.s0, b.s1);
      const surf = (p: TrackSample, d: number): V3 => ({ x: p.x + p.rx * d, y: Track.groundLevel(p.y, p.bank, hw, d, def.offroadWidth) + 0.02, z: p.z + p.rz * d });
      const under = (v: V3): V3 => ({ x: v.x, y: v.y - DECK, z: v.z });
      for (const side of [-1, 1]) {
        const edge = ss.map((p) => surf(p, side * half));
        quadStrip(edge, edge.map(under), concrete, shade, side > 0);
      }
      const l = ss.map((p) => under(surf(p, -half)));
      const r = ss.map((p) => under(surf(p, half)));
      quadStrip(l, r, shade, shade, true);

      // Rounded bridge railings: posts every ~3 m and two smooth rails along each edge.
      for (const side of [-1, 1]) {
        const rail = (h: number) => ss.map((p) => ({ x: p.x + p.rx * side * (half + 0.15), y: surf(p, side * half).y + h, z: p.z + p.rz * side * (half + 0.15) }));
        for (const h of [0.55, 1.05]) {
          const path = rail(h).filter((_, i) => i % 3 === 0 || i === ss.length - 1).map((v) => new THREE.Vector3(v.x, v.y, v.z));
          if (path.length > 1) solids.push(paint(tubeGeo(path, path.map(() => 0.07), 6), () => scratch.copy(steel)));
        }
        const step = Math.max(1, Math.round(3 / track.spacing));
        for (let i = 0; i < ss.length; i += step) {
          const v = rail(0)[i];
          solids.push(paint(tubeGeo([new THREE.Vector3(v.x, v.y - 0.1, v.z), new THREE.Vector3(v.x, v.y + 1.1, v.z)], [0.1, 0.1], 6), () => scratch.copy(steel)));
        }
      }

      const pillarEvery = Math.max(1, Math.round(14 / track.spacing));
      for (let k = 0; k < ss.length; k += pillarEvery) this.addPillar(solids, ss[k], k === 0, DECK, half);
      this.addPillar(solids, ss[ss.length - 1], true, DECK, half);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const deck = new THREE.Mesh(g, groundMaterial({ maps: concreteMaps(), mottle: 0.2, speckle: 0.1, roughness: 1, side: THREE.DoubleSide }));
    deck.castShadow = true;
    deck.receiveShadow = true;
    this.group.add(deck);
    this.stats.meshes++;
    if (solids.length) {
      const mesh = new THREE.Mesh(merge(solids), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1 }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.stats.meshes++;
    }
  }

  /** One round pier (flared column + cap beam) under the deck at sample `p`; ends get a wide abutment. */
  private addPillar(out: THREE.BufferGeometry[], p: TrackSample, abutment: boolean, deck: number, half: number): void {
    const track = this.track;
    const hw = track.def.width / 2;
    const deckBottom = p.y + Track.bankLift(p.bank, hw, 0) - deck;
    const ground = track.terrain.height(p.x, p.z) - 0.5;
    const h = deckBottom - ground;
    if (h < 0.5) return;
    const col = new THREE.Color('#9a9ca3');
    const shadeFn = (c: THREE.Color) => (q: THREE.Vector3) => scratch.copy(c).multiplyScalar(0.7 + 0.3 * THREE.MathUtils.clamp((q.y + 3) / (h + 3), 0, 1));
    const place = (g: THREE.BufferGeometry) => out.push(g.applyMatrix4(matrix(p.x, 0, p.z, 1, 1, 1, p.heading)));
    if (abutment) {
      place(paint(boxPart(0, ground + h / 2, 0, half * 2 + 1, h, 3, col, 0, 0.6), (q, n) => scratch.copy(col).multiplyScalar(n.y > 0.5 ? 1 : 0.85 + 0.15 * THREE.MathUtils.clamp((q.y - ground) / h, 0, 1))));
      return;
    }
    // Flared round column: wider at the foot and under the beam.
    const prof: [number, number][] = [];
    const R = 1.25;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      prof.push([R * (1 + 0.45 * Math.pow(1 - t, 6) + 0.25 * Math.pow(t, 6)), ground + h * t]);
    }
    place(paint(latheGeo(prof, 14), shadeFn(col)));
    place(paint(boxPart(0, deckBottom - 0.5, 0, half * 2 * 0.8, 1.0, 3.2, col, 0, 0.8), shadeFn(col)));
  }

  // -------------------------------------------------------------------------
  // 4. The floor far below, and basin lakes
  // -------------------------------------------------------------------------
  private buildFloorAndLakes(): void {
    const def = this.track.def;
    const sky = new THREE.Color(def.theme.sky);
    const horizon = new THREE.Color(def.theme.horizon);
    const colors = { sky, horizon };
    const big = 7000;
    let floor: THREE.Mesh;
    if (this.style === 'volcanic') {
      // A sea of lava far below: glimpsed through chasms and past the crater rim.
      floor = new THREE.Mesh(gridPlane(-big, -big, big, big, FLOOR_Y, big, () => 50), fluidMaterial('lava', colors));
    } else if (this.style === 'sky') {
      const deep = new THREE.Color('#8fb2d8').lerp(sky, 0.2);
      const light = new THREE.Color('#ffffff').lerp(horizon, 0.3);
      floor = new THREE.Mesh(gridPlane(-big, -big, big, big, -52, big, () => 50), fluidMaterial('cloud', { ...colors, deep, shallow: light }));
    } else {
      const far = new THREE.Color(def.theme.grass).lerp(horizon, 0.6).multiplyScalar(0.8);
      floor = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: far }));
      floor.position.y = FLOOR_Y;
    }
    floor.frustumCulled = false;
    this.group.add(floor);
    this.stats.meshes++;

    // Basin lakes: a negative terrain feature with a small radius becomes lava (volcano) or ice (alpine).
    const feats = def.terrain?.features ?? [];
    for (const f of feats) {
      if (f.height >= 0 || f.radius > 160) continue;
      const nat = this.track.terrain.natural(f.x, f.z);
      if (this.style === 'volcanic') {
        const y = nat + Math.abs(f.height) * 0.3;
        const lake = new THREE.Mesh(discGeo(f.x, f.z, f.radius * 0.72, y), fluidMaterial('lava', colors));
        this.group.add(lake);
        this.stats.meshes++;
      } else if (this.style === 'alpine') {
        const y = nat + Math.abs(f.height) * 0.55;
        const lake = new THREE.Mesh(discGeo(f.x, f.z, f.radius * 1.1, y), fluidMaterial('ice', { ...colors, deep: new THREE.Color('#7fb8dc'), shallow: new THREE.Color('#b9e2f4') }));
        lake.receiveShadow = true;
        this.group.add(lake);
        this.stats.meshes++;
      }
    }
  }
}
