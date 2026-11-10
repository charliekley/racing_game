/**
 * Man-made structures from the scenery plan: grandstands with a crowd of little people,
 * houses, container stacks, warehouses, fences, hay bales, banner boards and flags.
 *
 * Each structure is authored in its own LOCAL frame (origin on the ground, same
 * conventions as the plan) and stamped into the shared batches with the item's matrix, so
 * footprints and colliders from the plan always match what you see.
 */
import * as THREE from 'three';
import type { BannerBoardItem, BlockItem, FenceItem, GrandstandItem, HayItem, HouseItem } from '../../track/sceneryPlan';
import { seededRandom, BANNER_LOGO, BANNER_SLOGAN } from '../textures';
import { ChunkBatch, LodBatch } from './batch';
import { blobGeo, latheGeo, matrix, merge, paint, scratch, tubeGeo } from './geo';
import { noise3 } from './noise';
import { boxPart, corrugated, flagGeo, gableEave, gableRoof, polePart, slab } from './parts';

/** Where structures put their geometry. */
export interface Batches {
  /** Big static pieces (no LOD). */
  solid: ChunkBatch;
  /** Repeated detailed pieces with a cheap far version: people, containers. */
  lod: LodBatch;
  /** Self-lit pieces: window glow, warning lights. */
  glow: ChunkBatch;
  /** Waving cloth: flags, pennants. */
  cloth: ChunkBatch;
  /** Textured banner sheets. */
  banners: ChunkBatch;
}

export interface StructureLook {
  walls: string[];
  roof: (r: () => number) => THREE.Color;
  fence: THREE.Color;
  fencePost: THREE.Color;
  snowy: boolean;
  /** Evening/dusk: windows glow warm. */
  dusk: boolean;
  flatRoofs: boolean;
}

const WHITE = new THREE.Color('#ffffff');
const planeGeo = new THREE.PlaneGeometry(1, 1);

/** Matrix of a plan item's local frame: origin at (x, y, z), turned by rotationY. */
export function frameM(it: { x: number; y: number; z: number; rotationY: number }): THREE.Matrix4 {
  return matrix(it.x, it.y, it.z, 1, 1, 1, it.rotationY);
}

/** Frame × local offset/scale/turn. */
function inFrame(f: THREE.Matrix4, x: number, y: number, z: number, sx = 1, sy = sx, sz = sx, ry = 0, rx = 0, rz = 0): THREE.Matrix4 {
  return matrix(x, y, z, sx, sy, sz, ry, rx, rz).premultiply(f);
}

const hsl = (h: number, s: number, l: number) => new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l, THREE.SRGBColorSpace);

// ---------------------------------------------------------------------------
// Grandstand + crowd
// ---------------------------------------------------------------------------

/** Unit person parts, painted white so each instance can be tinted (shirt / skin / hair). */
const crowdParts = (() => {
  const shade = (y0: number, y1: number) => (p: THREE.Vector3) => scratch.setScalar(0.65 + 0.4 * THREE.MathUtils.clamp((p.y - y0) / (y1 - y0), 0, 1));
  const torso = blobGeo(1, 1, 0.04, 1, noise3);
  torso.applyMatrix4(matrix(0, 0, 0, 0.2, 0.3, 0.17));
  paint(torso, shade(-0.3, 0.3));
  const head = blobGeo(1, 2, 0.03, 1, noise3);
  head.applyMatrix4(matrix(0, 0, 0, 0.115, 0.125, 0.115));
  paint(head, (p) => scratch.setScalar(0.85 + 0.2 * (p.y > 0 ? 1 : 0.8)));
  const hair = blobGeo(0, 3, 0.05, 1, noise3);
  hair.applyMatrix4(matrix(-0.02, 0.05, 0, 0.125, 0.09, 0.125));
  paint(hair, shade(-0.1, 0.1));
  const arm = tubeGeo([new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.02, 0.28, 0.03), new THREE.Vector3(-0.03, 0.5, 0.05)], [0.05, 0.045, 0.04], 5);
  paint(arm, () => scratch.setScalar(1));
  const torsoFar = blobGeo(0, 1, 0, 1, noise3);
  torsoFar.applyMatrix4(matrix(0, 0.12, 0, 0.2, 0.42, 0.17));
  paint(torsoFar, shade(-0.3, 0.6));
  return { torso, head, hair, arm, torsoFar };
})();

const SKINS = ['#f2c9a0', '#d9a577', '#b57a50', '#7a4b2e', '#f6d8bd'];
const HAIRS = ['#2a1d14', '#4a3020', '#8a5a2b', '#d8b45a', '#1a1a1a', '#b8b8b8', '#7a2e1a'];

export function addGrandstand(gs: GrandstandItem, b: Batches, _look: StructureLook): void {
  const rnd = seededRandom(gs.seed);
  const L = gs.length;
  const ROWS = gs.rows;
  const RD = gs.rowDepth;
  const f = frameM(gs);
  const concrete = new THREE.Color('#bcbfc7');
  const dark = new THREE.Color('#2b2f3a');
  const roofColors = ['#d23b3b', '#2f6fd6'];
  const roofCol = new THREE.Color(roofColors[gs.index % roofColors.length]);
  const seatCols = ['#e03a3a', '#2f6fd6', '#f2f2f2', '#f2c230'].map((c) => new THREE.Color(c));
  const backX = ROWS * RD;
  const roofY = 1.0 + ROWS * 0.7 + 3.2;

  const parts: THREE.BufferGeometry[] = [];
  parts.push(boxPart(-0.1, 0.85, 0, 0.3, 1.7, L, dark)); // front wall under the banners
  for (let r = 0; r < ROWS; r++) {
    const top = 1.0 + (r + 1) * 0.7;
    parts.push(boxPart(r * RD + RD / 2, top / 2, 0, RD, top, L, concrete.clone().multiplyScalar(r % 2 ? 0.93 : 1)));
    // Seat shells in three colour sections per row.
    const third = (L - 0.6) / 3;
    for (let s = 0; s < 3; s++) parts.push(boxPart(r * RD + 0.55, top + 0.07, -L / 2 + 0.3 + third * (s + 0.5), 0.55, 0.14, third - 0.12, seatCols[(r + s + gs.index) % seatCols.length], 0, 0.9));
  }
  parts.push(boxPart(backX + 0.15, roofY / 2, 0, 0.3, roofY, L, concrete.clone().multiplyScalar(0.78))); // back wall
  // Side walls stepping up with the rows, and a handrail along the front.
  for (const zs of [-L / 2, L / 2]) parts.push(boxPart(backX / 2, (1.0 + ROWS * 0.7) / 2, zs, backX + 0.3, 1.0 + ROWS * 0.7, 0.3, concrete.clone().multiplyScalar(0.85)));
  const rail = tubeGeo([new THREE.Vector3(-0.1, 1.45, -L / 2), new THREE.Vector3(-0.1, 1.45, L / 2)], [0.04, 0.04], 5);
  parts.push(paint(rail, () => scratch.set('#d8dde4')));
  // Roof posts and a curved, two-tone canopy.
  for (let z = -L / 2; z <= L / 2 + 0.01; z += 9) parts.push(polePart(0.4, z, roofY, 0.12, new THREE.Color('#e3e7ee')));
  parts.push(
    slab(
      [
        [-0.9, roofY - 0.15],
        [backX * 0.3, roofY + 0.12],
        [backX * 0.65, roofY + 0.45],
        [backX + 1.0, roofY + 0.7],
      ],
      -L / 2 - 0.5,
      L / 2 + 0.5,
      0.32,
      roofCol,
      roofCol.clone().multiplyScalar(0.55),
    ),
  );
  b.solid.add(merge(parts), f, WHITE);

  // Pennant flags along the front roof edge.
  const flagColors = ['#ffd23a', '#2f7be0', '#e03a3a', '#ffffff', '#33b54a'];
  for (let z = -L / 2; z <= L / 2; z += 6) {
    const pole = polePart(0, 0, 2.6, 0.035, new THREE.Color('#ffffff'), 4);
    b.solid.add(pole, inFrame(f, -0.8, roofY - 0.3, z), WHITE);
    b.cloth.add(flagGeo(1.3, 0.8, new THREE.Color(flagColors[Math.floor(rnd() * flagColors.length)]), true), inFrame(f, -0.8, roofY + 2.2, z, 1, 1, 1, Math.PI / 2 + rnd() * 0.5), WHITE);
  }
  // Banners along the front wall, facing the road.
  for (let z = -L / 2 + 3.5; z <= L / 2 - 3; z += 6.5) {
    const rect = Math.round(z / 6.5) % 2 === 0 ? BANNER_LOGO : BANNER_SLOGAN;
    b.banners.add(planeGeo, inFrame(f, -0.27, 0.85, z, 6, 1.5, 1, -Math.PI / 2), WHITE, rect);
  }

  // The crowd: seated and cheering people on every row.
  for (let r = 0; r < ROWS; r++) {
    const top = 1.0 + (r + 1) * 0.7 + 0.14;
    for (let z = -L / 2 + 0.6; z < L / 2 - 0.4; z += 0.75) {
      if (rnd() < 0.16) continue; // a few empty seats
      const x = r * RD + 0.75 + (rnd() - 0.5) * 0.1;
      const zz = z + (rnd() - 0.5) * 0.12;
      const shirt = hsl(rnd(), 0.6 + rnd() * 0.35, 0.42 + rnd() * 0.22);
      const skin = new THREE.Color(SKINS[Math.floor(rnd() * SKINS.length)]);
      const hair = new THREE.Color(HAIRS[Math.floor(rnd() * HAIRS.length)]);
      const tall = 0.92 + rnd() * 0.2;
      const cheer = rnd() < 0.22;
      const yaw = (rnd() - 0.5) * 0.5;
      const torsoY = top + 0.3 * tall;
      b.lod.near.add(crowdParts.torso, inFrame(f, x, torsoY, zz, 1, tall, 1, yaw), shirt);
      b.lod.near.add(crowdParts.head, inFrame(f, x, top + 0.72 * tall, zz, 1, 1, 1, yaw), skin);
      b.lod.near.add(crowdParts.hair, inFrame(f, x - 0.01, top + 0.72 * tall, zz, 1, 1, 1, yaw), hair);
      if (cheer) b.lod.near.add(crowdParts.arm, inFrame(f, x - 0.03, top + 0.55 * tall, zz + 0.19, 1, 1, 1, yaw, 0, 0.3), skin);
      // Far version: one blob.
      b.lod.far.add(crowdParts.torsoFar, inFrame(f, x, torsoY, zz, 1, tall, 1), shirt);
    }
  }
}

// ---------------------------------------------------------------------------
// Houses
// ---------------------------------------------------------------------------

export function addHouse(hs: HouseItem, b: Batches, look: StructureLook): void {
  const rnd = seededRandom(hs.seed);
  const { w, h, d } = hs;
  const f = frameM(hs);
  const wall = new THREE.Color(look.walls[Math.floor(rnd() * look.walls.length)]);
  const roof = look.roof(rnd);
  const trim = new THREE.Color('#f4efe4');
  const parts: THREE.BufferGeometry[] = [];
  parts.push(boxPart(0, h / 2, 0, w, h, d, wall, 0, 0.6));
  parts.push(boxPart(0, 0.25, 0, w + 0.25, 0.5, d + 0.25, new THREE.Color('#8f8c86'))); // stone plinth
  parts.push(boxPart(w / 2, h / 2, d / 2, 0.3, h, 0.3, trim)); // corner trim
  parts.push(boxPart(-w / 2, h / 2, d / 2, 0.3, h, 0.3, trim));
  // Front door with frame and step (front = local +z).
  parts.push(boxPart(0, 1.15, d / 2 + 0.02, 1.5, 2.3, 0.14, trim));
  parts.push(boxPart(0, 1.1, d / 2 + 0.08, 1.15, 2.15, 0.14, new THREE.Color('#7a4a2a')));
  parts.push(boxPart(0, 0.1, d / 2 + 0.5, 2.0, 0.2, 0.9, new THREE.Color('#a9a6a0')));
  const windows: [number, number][] = [];
  for (const wx of [-w / 4 - 0.3, w / 4 + 0.3]) windows.push([wx, h * 0.58]);
  for (const [wx, wy] of windows) {
    parts.push(boxPart(wx, wy, d / 2 + 0.02, 1.5, 1.4, 0.14, trim));
    parts.push(boxPart(wx, wy - 0.78, d / 2 + 0.1, 1.7, 0.12, 0.3, trim)); // sill
  }
  // Roof (gabled, or flat for the desert look) and chimney.
  if (look.flatRoofs) {
    parts.push(boxPart(0, h + 0.18, 0, w + 0.4, 0.36, d + 0.4, roof));
  } else {
    const rise = Math.max(w, d) * 0.32;
    const roofG = gableRoof(w, d, rise, 0.5, roof, wall);
    roofG.applyMatrix4(matrix(0, h - gableEave(w, rise, 0.5), 0));
    parts.push(roofG);
    parts.push(boxPart(w * 0.22, h + rise * 0.65, -d * 0.18, 0.75, rise * 0.9, 0.75, new THREE.Color('#8a4b3a')));
    parts.push(boxPart(w * 0.22, h + rise * 1.12, -d * 0.18, 0.95, 0.14, 0.95, new THREE.Color('#5a5a60')));
  }
  b.solid.add(merge(parts), f, WHITE);
  // Window panes: warm glow in the evening, sky-blue glass by day.
  for (const [wx, wy] of windows) {
    const pane = boxPart(0, 0, 0, 1.15, 1.05, 0.04, look.dusk ? new THREE.Color(3.2, 2.2, 0.9) : new THREE.Color('#8fc4e6'), 0, 1);
    (look.dusk ? b.glow : b.solid).add(pane, inFrame(f, wx, wy, d / 2 + 0.11), WHITE);
  }
}

// ---------------------------------------------------------------------------
// Containers and warehouses (Dockside)
// ---------------------------------------------------------------------------

const containerNear = new Map<string, THREE.BufferGeometry>();

/** One shipping container (6.1 or 12.2 m), local origin at the bottom centre, length along z. */
function containerGeo(len: number, wid: number, hgt: number, color: THREE.Color): THREE.BufferGeometry {
  const key = `${len.toFixed(2)}|${wid.toFixed(2)}|${hgt.toFixed(2)}|${color.getHexString()}`;
  let g = containerNear.get(key);
  if (g) return g;
  const parts: THREE.BufferGeometry[] = [];
  const steel = new THREE.Color('#5a6068');
  parts.push(boxPart(0, hgt / 2, 0, wid - 0.06, hgt - 0.1, len - 0.06, color.clone().multiplyScalar(0.8), 0, 0.8));
  // Corrugated side panels (ribs run top to bottom).
  for (const s of [-1, 1]) {
    const panel = corrugated(len - 0.34, hgt - 0.3, 0.3, 0.05, color, 1);
    panel.applyMatrix4(matrix(s * (wid / 2 - 0.03), hgt / 2, 0, 1, 1, 1, s * (Math.PI / 2)));
    parts.push(panel);
  }
  // Roof ribs and rails.
  parts.push(boxPart(0, hgt - 0.03, 0, wid - 0.2, 0.08, len - 0.2, color.clone().multiplyScalar(0.7), 0, 1));
  // Corner posts (castings) and bottom rails.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) parts.push(boxPart(sx * (wid / 2 - 0.08), hgt / 2, sz * (len / 2 - 0.08), 0.16, hgt, 0.16, steel, 0, 0.85));
    parts.push(boxPart(sx * (wid / 2 - 0.05), 0.1, 0, 0.1, 0.2, len, steel, 0, 1));
  }
  // End doors: two leaves, locking rods and a handle bar.
  for (const sz of [-1, 1]) {
    parts.push(boxPart(0, hgt / 2, sz * (len / 2 - 0.02), wid - 0.3, hgt - 0.28, 0.06, color.clone().multiplyScalar(0.92), 0, 0.85));
    for (const rx of [-0.55, -0.2, 0.2, 0.55]) parts.push(boxPart(rx * (wid / 2.4), hgt / 2, sz * (len / 2 + 0.02), 0.05, hgt - 0.4, 0.05, steel, 0, 1));
    parts.push(boxPart(0, hgt / 2, sz * (len / 2 + 0.01), 0.04, hgt - 0.3, 0.05, new THREE.Color('#1c1f24'), 0, 1));
  }
  g = merge(parts);
  containerNear.set(key, g);
  return g;
}

export function addBlock(bl: BlockItem, b: Batches): void {
  const rnd = seededRandom(bl.seed);
  const f = frameM(bl);
  const base = new THREE.Color(bl.color);
  if (bl.kind === 'container') {
    const nx = Math.max(1, Math.round(bl.w / 2.5));
    const nz = Math.max(1, Math.round(bl.d / 12.2));
    const lenC = bl.d / nz;
    const widC = bl.w / nx;
    const layers = Math.max(1, Math.round(bl.h / 2.6));
    const hC = bl.h / layers;
    for (let iy = 0; iy < layers; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        for (let iz = 0; iz < nz; iz++) {
          // Per-container colour variation so the stack is not a flat block of one paint.
          const c = base.clone();
          const hsl2 = { h: 0, s: 0, l: 0 };
          c.getHSL(hsl2);
          c.setHSL(hsl2.h + (rnd() - 0.5) * 0.04, THREE.MathUtils.clamp(hsl2.s * (0.75 + rnd() * 0.3), 0, 1), THREE.MathUtils.clamp(hsl2.l * (0.82 + rnd() * 0.3), 0, 1));
          const x = -bl.w / 2 + widC * (ix + 0.5);
          const z = -bl.d / 2 + lenC * (iz + 0.5);
          const m = inFrame(f, x, iy * hC, z);
          b.lod.add(containerGeo(lenC, widC, hC, WHITE), farBox(widC, hC, lenC), m, c);
        }
      }
    }
    return;
  }
  // Warehouse: corrugated cladding on all four walls, shallow gabled roof, big roller door, window strip.
  const { w, h, d } = bl;
  const parts: THREE.BufferGeometry[] = [];
  const wall = base.clone();
  const steel = new THREE.Color('#4a5058');
  parts.push(boxPart(0, h / 2, 0, w - 0.08, h, d - 0.08, wall.clone().multiplyScalar(0.8), 0, 0.7));
  const longPanel = (len: number, ry: number, x: number, z: number) => {
    const p = corrugated(len, h - 0.7, 0.45, 0.07, wall, 1);
    p.applyMatrix4(matrix(x, (h - 0.7) / 2 + 0.7, z, 1, 1, 1, ry));
    parts.push(p);
  };
  longPanel(d, Math.PI / 2, w / 2 - 0.03, 0);
  longPanel(d, -Math.PI / 2, -w / 2 + 0.03, 0);
  longPanel(w, 0, 0, d / 2 - 0.03);
  longPanel(w, Math.PI, 0, -d / 2 + 0.03);
  parts.push(boxPart(0, 0.35, 0, w + 0.1, 0.7, d + 0.1, new THREE.Color('#8b8f96'))); // concrete base
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(boxPart(sx * (w / 2), h / 2, sz * (d / 2), 0.35, h, 0.35, steel)); // corner posts
  // Roof: low gable with the ridge along the long side.
  const roofCol = wall.clone().multiplyScalar(0.55);
  const alongX = w > d;
  const rw = alongX ? d : w;
  const rd = alongX ? w : d;
  const rise = Math.min(2.2, rw * 0.16);
  const roof = gableRoof(rw, rd, rise, 0.45, roofCol, wall.clone().multiplyScalar(0.7));
  roof.applyMatrix4(matrix(0, h - gableEave(rw, rise, 0.45) + 0.02, 0, 1, 1, 1, alongX ? Math.PI / 2 : 0));
  parts.push(roof);
  // Roof vents.
  for (let k = 0; k < 3; k++) {
    const t = (k + 1) / 4 - 0.5;
    parts.push(boxPart(alongX ? t * w : 0, h + rise + 0.3, alongX ? 0 : t * d, 1.1, 0.6, 1.1, steel));
  }
  // Front (+z face): roller door with slats, side door, lamp.
  const doorW = Math.min(5.2, w * 0.45);
  const doorH = Math.min(4.6, h * 0.65);
  parts.push(boxPart(0, doorH / 2 + 0.7, d / 2 + 0.04, doorW + 0.4, doorH + 0.3, 0.16, new THREE.Color('#d7d9de')));
  parts.push(boxPart(0, doorH / 2 + 0.7, d / 2 + 0.1, doorW, doorH, 0.1, new THREE.Color('#5f6670')));
  for (let k = 1; k < 9; k++) parts.push(boxPart(0, 0.7 + (doorH * k) / 9, d / 2 + 0.16, doorW - 0.1, 0.05, 0.06, new THREE.Color('#3f454d'), 0, 1));
  parts.push(boxPart(w / 2 - 1.3, 1.9, d / 2 + 0.06, 1.3, 2.4, 0.12, new THREE.Color('#2d5f8a')));
  parts.push(boxPart(w / 2 - 1.3, 3.4, d / 2 + 0.2, 0.5, 0.18, 0.3, steel)); // lamp bracket
  b.solid.add(merge(parts), f, WHITE);
  // Window strip + lamp glow.
  const pane = new THREE.Color(2.6, 2.0, 1.1);
  b.glow.add(boxPart(0, 0, 0, w * 0.7, 0.8, 0.04, pane, 0, 1), inFrame(f, 0, h * 0.8, d / 2 + 0.05), WHITE);
  b.glow.add(boxPart(0, 0, 0, 0.4, 0.14, 0.2, new THREE.Color(4, 3.4, 2), 0, 1), inFrame(f, w / 2 - 1.3, 3.28, d / 2 + 0.3), WHITE);
}

const farBoxes = new Map<string, THREE.BufferGeometry>();
function farBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = `${w.toFixed(2)}|${h.toFixed(2)}|${d.toFixed(2)}`;
  let g = farBoxes.get(key);
  if (!g) {
    g = boxPart(0, h / 2, 0, w, h, d, WHITE, 0, 0.8);
    farBoxes.set(key, g);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Fences, hay, banner boards
// ---------------------------------------------------------------------------

export function makeTrackside(look: StructureLook) {
  const post = polePart(0, 0, 1.15, 0.075, look.fencePost);
  const snowTop = look.snowy;
  const rail = tubeGeo([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1)], [0.045, 0.045], 6);
  paint(rail, (p, n) => {
    scratch.copy(look.fence);
    if (snowTop) scratch.lerp(new THREE.Color('#f6faff'), THREE.MathUtils.clamp(n.y * 1.4, 0, 0.9));
    return scratch.multiplyScalar(0.85 + 0.2 * noise3(p.z * 4, 0, 0, 2));
  });
  // Hay bale: rounded cylinder lying along x, 1.2 m long, 0.6 m radius.
  const bale = latheGeo(
    [
      [0, -0.5],
      [0.44, -0.5],
      [0.49, -0.46],
      [0.5, -0.4],
      [0.5, 0.4],
      [0.49, 0.46],
      [0.44, 0.5],
      [0, 0.5],
    ],
    14,
  );
  paint(bale, (p, n) => {
    const side = Math.abs(n.y) < 0.6;
    const band = side ? 0.82 + 0.18 * Math.sin(p.y * 38 + Math.atan2(p.z, p.x) * 2) : 0.72 + 0.28 * Math.sin(Math.hypot(p.x, p.z) * 44);
    return scratch.set(side ? '#dcb85f' : '#c79a3e').multiplyScalar(band * (0.85 + 0.2 * noise3(p.x * 7, p.y * 7, p.z * 7, 4)));
  });
  bale.applyMatrix4(matrix(0, 0, 0, 1.2, 1.2, 1.2, 0, 0, Math.PI / 2));
  const boardPost = polePart(0, 0, 2.9, 0.1, new THREE.Color('#e6e6e6'));
  const flagPole = polePart(0, 0, 1.7, 0.035, new THREE.Color('#ffffff'), 4);
  const frame = boxPart(0, 2.0, -0.1, 6.8, 1.8, 0.14, new THREE.Color('#2b2f3a'));
  const flagColors = ['#ffd23a', '#2f7be0', '#e03a3a', '#33b54a'];

  return {
    fence(fe: FenceItem, b: Batches): void {
      b.solid.add(post, matrix(fe.x, fe.y, fe.z, 1, 1, 1, fe.rotationY), WHITE);
      const f = frameM(fe);
      for (const y of [0.5, 0.95]) b.solid.add(rail, inFrame(f, 0, y, 0, 1, 1, fe.len), WHITE);
    },
    hay(hb: HayItem, b: Batches): void {
      const f = frameM(hb);
      const rnd = seededRandom(Math.floor(hb.x * 73 + hb.z * 31));
      for (const [ox, oy] of [
        [-0.8, 0],
        [0.8, 0],
        [0, 1.2],
      ]) {
        b.solid.add(bale, inFrame(f, ox, 0.6 + oy, 0, 1, 1, 1, (rnd() - 0.5) * 0.12), WHITE);
      }
    },
    banner(bb: BannerBoardItem, b: Batches): void {
      const rnd = seededRandom(bb.seed);
      const f = frameM(bb);
      for (const bx of [-3.2, 3.2]) {
        b.solid.add(boardPost, inFrame(f, bx, 0, -0.1), WHITE);
        b.solid.add(flagPole, inFrame(f, bx, 2.9, -0.1), WHITE);
        b.cloth.add(flagGeo(1.1, 0.7, new THREE.Color(flagColors[Math.floor(rnd() * flagColors.length)]), rnd() < 0.5), inFrame(f, bx, 4.3, -0.1, 1, 1, 1, rnd() * Math.PI), WHITE);
      }
      b.solid.add(frame, f, WHITE);
      b.banners.add(planeGeo, inFrame(f, 0, 2.0, -0.02, 6.4, 1.6), WHITE, rnd() < 0.5 ? BANNER_LOGO : BANNER_SLOGAN);
      b.banners.add(planeGeo, inFrame(f, 0, 2.0, -0.18, 6.4, 1.6, 1, Math.PI), WHITE, rnd() < 0.5 ? BANNER_LOGO : BANNER_SLOGAN);
    },
  };
}
