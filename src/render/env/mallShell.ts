/**
 * Palm Plaza's building shell: the outer walls that close in the indoor part of the lap, the skylight roof and its sunbeams.
 *
 *   - WALLS stand along the edges of the building's footprint (`MallDef.building`, planned in track/mallPlan.ts with an
 *     opening wherever a road passes through, sized for its width and the crossing angle). Bands from the ground up: a
 *     painted shop zone for the ground floor, a plain band at the upper floor's slab, a second shop zone for the upper
 *     floor, and a tall clerestory of glass panes up to the roof. Over an opening only the part above its lintel stands.
 *   - ROOF: tinted glass with a fine lattice texture (one transparent mesh) on a coarse structural grid of slim steel beams
 *     (instanced). It covers the footprint.
 *   - SUNBEAMS: a few slanted additive light shafts through the glass (crossed quads, no particles).
 *
 * Cost: 5-6 draw calls, a few thousand triangles.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Track } from '../../sim/track';
import { insidePolygon, type MallShellPlan } from '../../track/mallPlan';
import { matrix } from './geo';
import { beamTexture, clerestoryTexture, facadeTexture, roofTexture } from './mallStyle';

/** Height of a shop zone above its floor (m). */
export const SHOP_ZONE = 9;
/** Direction of the light the sunbeams follow (matches the 'mall' mood in scene.ts): azimuth and elevation, degrees. */
export const MALL_SUN = { azimuth: 30, elevation: 62 };

/** A point of a wall line: position, the upper floor's height, the unit vector pointing from the wall into the building. */
export interface WallPoint {
  x: number;
  z: number;
  y: number;
  /** Unit vector (x, z) pointing inward. */
  nx: number;
  nz: number;
  /** Distance along the wall (m). */
  u: number;
}

export interface Shell {
  /** Points along the solid parts of the walls (one run per piece of wall), for the things that hang on them. */
  walls: WallPoint[][];
  /** The gates: where a road passes through a wall (centre on the wall, the lintel's height, facing inward, width). */
  gates: { x: number; z: number; y: number; rotY: number; w: number }[];
}

interface ShellOptions {
  track: Track;
  group: THREE.Group;
  plan: MallShellPlan;
  /** The upper floor's height (m). */
  upper: number;
}

export function buildShell(o: ShellOptions): Shell {
  const { track, group, plan } = o;
  const roofY = plan.roofY;
  const poly = track.def.scenery.mall!.building;
  const shell: Shell = { walls: [], gates: [] };
  const wallMats = {
    base: new THREE.MeshStandardMaterial({ color: '#d4c4ae', roughness: 0.7, side: THREE.DoubleSide }),
    shop: new THREE.MeshStandardMaterial({ map: facadeTexture(), roughness: 0.55, side: THREE.DoubleSide }),
    glass: new THREE.MeshBasicMaterial({ map: clerestoryTexture(), side: THREE.DoubleSide }),
  };
  const bands: Record<'base' | 'shop' | 'glass', THREE.BufferGeometry[]> = { base: [], shop: [], glass: [] };
  // The bands: [material, bottom, top, metres per texture repeat along, texture repeats up].
  const layout: ['base' | 'shop' | 'glass', number, number, number, number][] = [
    ['shop', 0, SHOP_ZONE, 24, 1],
    ['base', SHOP_ZONE, o.upper, 8, 1],
    ['shop', o.upper, o.upper + SHOP_ZONE, 24, 1],
    ['glass', o.upper + SHOP_ZONE, roofY + 2, 24, (roofY + 2 - o.upper - SHOP_ZONE) / 8],
  ];
  for (const w of plan.walls) {
    const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
    const ux = (w.bx - w.ax) / len;
    const uz = (w.bz - w.az) / len;
    // Inward normal: the side of the edge the footprint is on.
    let nx = -uz;
    let nz = ux;
    if (!insidePolygon(poly, (w.ax + w.bx) / 2 + nx * 2, (w.az + w.bz) / 2 + nz * 2)) [nx, nz] = [-nx, -nz];
    // Cut the edge at the openings: each piece is either solid (top = -inf) or an opening (only above its lintel).
    const cuts: { u0: number; u1: number; top: number }[] = [];
    let u = 0;
    for (const op of w.openings) {
      const a = Math.max(u, op.u0);
      const b = Math.min(len, op.u1);
      if (a > u) cuts.push({ u0: u, u1: a, top: -Infinity });
      if (b > a) cuts.push({ u0: a, u1: b, top: op.top });
      u = Math.max(u, b);
    }
    if (u < len) cuts.push({ u0: u, u1: len, top: -Infinity });
    for (const c of cuts) {
      for (const [mat, y0, y1, uRep, vRep] of layout) {
        const lo = Math.max(y0, c.top);
        if (lo >= y1) continue;
        const v0 = ((lo - y0) / (y1 - y0)) * vRep;
        bands[mat].push(quad(w.ax + ux * c.u0, w.az + uz * c.u0, w.ax + ux * c.u1, w.az + uz * c.u1, lo, y1, c.u0 / uRep, c.u1 / uRep, v0, vRep));
      }
      if (c.top > -Infinity) {
        shell.gates.push({ x: w.ax + (ux * (c.u0 + c.u1)) / 2, z: w.az + (uz * (c.u0 + c.u1)) / 2, y: c.top, rotY: Math.atan2(nx, nz), w: c.u1 - c.u0 });
      } else {
        const pts: WallPoint[] = [];
        for (let k = c.u0 + 2; k < c.u1 - 2; k += 4) pts.push({ x: w.ax + ux * k, z: w.az + uz * k, y: o.upper, nx, nz, u: k });
        if (pts.length > 1) shell.walls.push(pts);
      }
    }
  }
  for (const k of ['base', 'shop', 'glass'] as const) {
    if (!bands[k].length) continue;
    const m = new THREE.Mesh(mergeGeometries(bands[k])!, wallMats[k]);
    m.receiveShadow = k !== 'glass';
    group.add(m);
  }

  // ---- Roof: glass on a coarse grid of slim beams, over the footprint ---------------------------------------------
  const CELL = 16;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [x, z] of poly) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  const beams: THREE.Matrix4[] = [];
  const panes: THREE.BufferGeometry[] = [];
  for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
    for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
      const x = (cx + 0.5) * CELL;
      const z = (cz + 0.5) * CELL;
      // A cell is roofed when its middle is inside the footprint (the walls reach 2 m above the roof and hide the ragged edge).
      if (!insidePolygon(poly, x, z)) continue;
      beams.push(matrix(x - CELL / 2, roofY, z, 0.22, 0.4, CELL));
      beams.push(matrix(x, roofY, z - CELL / 2, CELL, 0.4, 0.22));
      panes.push(new THREE.PlaneGeometry(CELL, CELL).rotateX(Math.PI / 2).translate(x, roofY + 0.22, z));
    }
  }
  const beamMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#cfd6de', roughness: 0.35, metalness: 0.7 }), beams.length);
  beams.forEach((m, i) => beamMesh.setMatrixAt(i, m));
  group.add(beamMesh);
  if (panes.length) group.add(new THREE.Mesh(mergeGeometries(panes)!, new THREE.MeshBasicMaterial({ map: roofTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide })));

  // ---- Sunbeams: crossed, slanted light shafts every ~40 m of the road indoors -----------------------------------
  const az = (MALL_SUN.azimuth * Math.PI) / 180;
  const slope = Math.cos((MALL_SUN.elevation * Math.PI) / 180) / Math.sin((MALL_SUN.elevation * Math.PI) / 180); // horizontal metres per metre of fall
  const quads: THREE.BufferGeometry[] = [];
  const stepI = Math.max(1, Math.round(40 / track.spacing));
  track.samples.forEach((p, i) => {
    if (i % stepI !== 0 || !insidePolygon(poly, p.x, p.z)) return;
    const side = (i / stepI) % 2 ? 1 : -1;
    const bx = p.x + p.rx * side * (5 + ((i * 7) % 9));
    const bz = p.z + p.rz * side * (5 + ((i * 7) % 9));
    const H = roofY - p.y;
    const ex = bx - Math.cos(az) * slope * H; // the beam travels away from the sun
    const ez = bz - Math.sin(az) * slope * H;
    for (const ang of [0, Math.PI / 2]) {
      const wx = Math.cos(ang) * 3.2;
      const wz = Math.sin(ang) * 3.2;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([bx - wx, roofY, bz - wz, bx + wx, roofY, bz + wz, ex - wx, p.y + 0.05, ez - wz, ex + wx, p.y + 0.05, ez + wz], 3));
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

/** A vertical quad from (ax, az) to (bx, bz) between heights y0 and y1, with u running u0..u1 and v v0..v1. */
function quad(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, u0: number, u1: number, v0: number, v1: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([ax, y0, az, bx, y0, bz, ax, y1, az, bx, y1, bz], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u0, v1, u1, v1], 2));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  g.computeVertexNormals();
  return g;
}
