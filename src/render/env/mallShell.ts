/**
 * Palm Plaza's building shell: the outer walls that close in the indoor part of the lap (so from the road you never see
 * the hills, the sky line or the other floors outside), the skylight roof and its sunbeams.
 *
 *   - WALLS run along both sides of the road from the mall's entrance (the top of the parking ramp) to its exit (the end of the
 *     garden). They keep ~30 m from the road and bulge outward where another lane is close (the second escalator), following a
 *     smoothed offset so they never cut into a lane. From the floor the road is on they are three bands: a painted shop zone
 *     (the shop fronts stand against it), a tall clerestory of glass panes, and a plain base wall down to the ground floor.
 *     A lintel with the mall's name closes both gates.
 *   - ROOF: tinted glass with a fine lattice texture (one transparent mesh) on a coarse structural grid of slim steel beams
 *     (instanced). It only covers the building.
 *   - SUNBEAMS: a few slanted additive light shafts through the glass (crossed quads, no particles).
 *
 * Cost: 4-5 draw calls, ~8k triangles.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Track } from '../../sim/track';
import { matrix } from './geo';
import { beamTexture, clerestoryTexture, facadeTexture, roofTexture } from './mallStyle';
import type { RibbonTools } from './rainbow';

/** Where the walls stand: this far (m) from the road centre when nothing is in the way. */
export const WALL_D = 30.6;
/** Height of the shop zone above the floor (m). */
export const SHOP_ZONE = 9;
/** Direction of the light the sunbeams follow (matches the 'mall' mood in scene.ts): azimuth and elevation, degrees. */
export const MALL_SUN = { azimuth: 30, elevation: 62 };

/** A point of a wall line: position, floor height there, the unit vector pointing from the wall back to the road. */
export interface WallPoint {
  x: number;
  z: number;
  y: number;
  /** Unit vector (x, z) pointing inward (towards the road). */
  nx: number;
  nz: number;
  /** Distance along the wall (m). */
  u: number;
}

export interface Shell {
  /** The wall lines (one run per side and continuous stretch), for the things that hang on the walls. */
  walls: WallPoint[][];
  /** The two gates: where the road enters/leaves the building (position, floor height, heading, width). */
  gates: { x: number; z: number; y: number; rotY: number; w: number }[];
}

interface ShellOptions {
  track: Track;
  tools: RibbonTools;
  group: THREE.Group;
  /** Is arc length s inside the building? */
  inMall: (s: number) => boolean;
  /** Distance to the nearest road (main or branch) at about floor height y. */
  roadDist: (x: number, z: number, y: number) => number;
  roofY: number;
}

export function buildShell(o: ShellOptions): Shell {
  const { track, tools, group, roofY } = o;
  const S = track.samples;
  const shell: Shell = { walls: [], gates: [] };

  // ---- Wall lines: smoothed offsets that stay clear of every lane ---------------------------------------------
  const runs = tools.runs(S, (p) => o.inMall(p.s));
  const wallMats = {
    base: new THREE.MeshStandardMaterial({ color: '#d4c4ae', roughness: 0.7, side: THREE.DoubleSide }),
    shop: new THREE.MeshStandardMaterial({ map: facadeTexture(), roughness: 0.55, side: THREE.DoubleSide }),
    glass: new THREE.MeshBasicMaterial({ map: clerestoryTexture(), side: THREE.DoubleSide }),
  };
  const bands: Record<'base' | 'shop' | 'glass', THREE.BufferGeometry[]> = { base: [], shop: [], glass: [] };
  for (const run of runs) {
    if (run.length < 3) continue;
    for (const side of [-1, 1]) {
      // Raw distance: the first one of 30.6, 33.6... m whose spot is at least 28 m from every road at this level.
      const raw = run.map((p) => {
        for (let d = WALL_D; d < 62; d += 3) {
          if (o.roadDist(p.x + p.rx * side * d, p.z + p.rz * side * d, p.y) >= WALL_D - 2.5) return d;
        }
        return WALL_D;
      });
      // Widen over neighbours, then relax (never below the raw value), so the wall flows round the obstacle.
      let d = raw.map((_, i) => Math.max(...raw.slice(Math.max(0, i - 5), i + 6)));
      for (let pass = 0; pass < 8; pass++) d = d.map((v, i) => Math.max(raw[i], (d[Math.max(0, i - 1)] + v * 2 + d[Math.min(d.length - 1, i + 1)]) / 4));
      const pts: WallPoint[] = [];
      let u = 0;
      run.forEach((p, i) => {
        const x = p.x + p.rx * side * d[i];
        const z = p.z + p.rz * side * d[i];
        if (i > 0) u += Math.hypot(x - pts[i - 1].x, z - pts[i - 1].z);
        pts.push({ x, z, y: p.y, nx: -p.rx * side, nz: -p.rz * side, u });
      });
      shell.walls.push(pts);
      bands.base.push(strip(pts, () => 0, (p) => p.y, 8, () => 1));
      bands.shop.push(strip(pts, (p) => p.y, (p) => p.y + SHOP_ZONE, 24, () => 1));
      bands.glass.push(strip(pts, (p) => p.y + SHOP_ZONE, () => roofY + 2, 24, (p) => (roofY + 2 - p.y - SHOP_ZONE) / 8));
    }
    // Gates: a lintel closing the building above the road at both ends.
    for (const i of [0, run.length - 1]) {
      const p = run[i];
      const left = shell.walls[shell.walls.length - 2][i];
      const right = shell.walls[shell.walls.length - 1][i];
      const pts: WallPoint[] = [left, right].map((w, k) => ({ ...w, u: k * Math.hypot(left.x - right.x, left.z - right.z) }));
      bands.shop.push(strip(pts, () => p.y + 9, () => p.y + 12.5, 24, () => 1));
      bands.glass.push(strip(pts, () => p.y + 12.5, () => roofY + 2, 24, () => (roofY + 2 - p.y - 12.5) / 8));
      shell.gates.push({ x: p.x, y: p.y, z: p.z, rotY: Math.atan2(p.tx, p.tz), w: Math.hypot(left.x - right.x, left.z - right.z) });
    }
  }
  for (const k of ['base', 'shop', 'glass'] as const) {
    if (!bands[k].length) continue;
    const m = new THREE.Mesh(mergeGeometries(bands[k])!, wallMats[k]);
    m.receiveShadow = k !== 'glass';
    group.add(m);
  }

  // ---- Roof: glass on a coarse grid of slim beams, over the building only ---------------------------------------
  const CELL = 16;
  const mallPts = S.filter((p) => o.inMall(p.s));
  const covering: { x: number; z: number }[] = [...mallPts];
  for (const b of track.branches) for (const q of b.samples) if (mallPts.some((p) => Math.hypot(p.x - q.x, p.z - q.z) < 45 && Math.abs(p.y - q.y) < 6)) covering.push(q);
  const cells = new Set<string>();
  for (const p of covering) {
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) cells.add(`${Math.floor(p.x / CELL) + dx},${Math.floor(p.z / CELL) + dz}`);
  }
  const beams: THREE.Matrix4[] = [];
  const panes: THREE.BufferGeometry[] = [];
  for (const key of cells) {
    const [cx, cz] = key.split(',').map(Number);
    const x = (cx + 0.5) * CELL;
    const z = (cz + 0.5) * CELL;
    beams.push(matrix(x - CELL / 2, roofY, z, 0.22, 0.4, CELL));
    beams.push(matrix(x, roofY, z - CELL / 2, CELL, 0.4, 0.22));
    panes.push(new THREE.PlaneGeometry(CELL, CELL).rotateX(Math.PI / 2).translate(x, roofY + 0.22, z));
  }
  const beamMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#cfd6de', roughness: 0.35, metalness: 0.7 }), beams.length);
  beams.forEach((m, i) => beamMesh.setMatrixAt(i, m));
  group.add(beamMesh);
  if (panes.length) {
    const glass = new THREE.Mesh(mergeGeometries(panes)!, new THREE.MeshBasicMaterial({ map: roofTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    group.add(glass);
  }

  // ---- Sunbeams: crossed, slanted light shafts every ~40 m ----------------------------------------------------------
  const az = (MALL_SUN.azimuth * Math.PI) / 180;
  const run = Math.cos((MALL_SUN.elevation * Math.PI) / 180) / Math.sin((MALL_SUN.elevation * Math.PI) / 180); // horizontal metres per metre of fall
  const quads: THREE.BufferGeometry[] = [];
  const stepI = Math.max(1, Math.round(40 / track.spacing));
  mallPts.forEach((p, i) => {
    if (i % stepI !== 0) return;
    const side = (i / stepI) % 2 ? 1 : -1;
    const bx = p.x + p.rx * side * (5 + ((i * 7) % 9));
    const bz = p.z + p.rz * side * (5 + ((i * 7) % 9));
    const H = roofY - p.y;
    const tx = bx;
    const tz = bz;
    const ex = bx - Math.cos(az) * run * H; // the beam travels away from the sun
    const ez = bz - Math.sin(az) * run * H;
    for (const ang of [0, Math.PI / 2]) {
      const w = 3.2;
      const wx = Math.cos(ang) * w;
      const wz = Math.sin(ang) * w;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([tx - wx, roofY, tz - wz, tx + wx, roofY, tz + wz, ex - wx, p.y + 0.05, ez - wz, ex + wx, p.y + 0.05, ez + wz], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));
      g.setIndex([0, 2, 1, 1, 2, 3]);
      quads.push(g);
    }
  });
  if (quads.length) {
    const m = new THREE.Mesh(mergeGeometries(quads)!, new THREE.MeshBasicMaterial({ map: beamTexture(), color: new THREE.Color(0.55, 0.46, 0.28), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.frustumCulled = false;
    group.add(m);
  }
  return shell;
}

/** A vertical strip along a wall line between two heights: u = distance / uRepeat, v = 0 at the bottom to `vTop(p)` at the top. */
function strip(pts: WallPoint[], y0: (p: WallPoint) => number, y1: (p: WallPoint) => number, uRepeat: number, vTop: (p: WallPoint) => number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  pts.forEach((p, i) => {
    pos.push(p.x, y0(p), p.z, p.x, y1(p), p.z);
    uv.push(p.u / uRepeat, 0, p.u / uRepeat, vTop(p));
    if (i > 0) idx.push((i - 1) * 2, i * 2, (i - 1) * 2 + 1, (i - 1) * 2 + 1, i * 2, i * 2 + 1);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

