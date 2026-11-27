/**
 * Palm Plaza's look (gated by `scenery.mall`, see TrackDef): a bright, modern two-storey shopping mall. Everything is
 * procedural (canvas textures and primitives, no asset files) and ORIGINAL: the store names, signs, posters and their
 * mascots are made up for this game.
 *
 *   - FLOORS: a polished tile floor for the ground floor and the garden, a thick upper-floor slab (with a walkway, shops
 *     and columns) along the upper-floor stretches, the store floor, the parking-deck ramp, and asphalt with painted bays
 *     for the outdoor parking lot. (The terrain mesh is not drawn on this track: these floors replace it.)
 *   - the DECK LANES (the store aisle and the second escalator lane: `deck` branches): tiled road ribbons with glass rails.
 *   - SHOPFRONTS with original sign boards (a canvas atlas of made-up names), lit windows, and POSTERS (abstract ads with
 *     made-up mascots) on the columns.
 *   - a SKYLIGHT roof (a steel lattice high above, 17 m over the upper floor, so it never gets near the chase camera) and
 *     slender columns.
 *   - PALMS in round planters (from the scenery plan, solid), festive STRING LIGHTS across the road, the GARDEN (lawns,
 *     grass patches on the road, the fountain's pool, rim and jets), the PARKING LOT (parked cars, lamp posts, garage gates).
 *
 * Cost: about 25 draw calls (instancing for palms, columns, cars, lamps, bulbs; one merged mesh per material otherwise).
 * The escalators and the guide robot are drawn by render/hazards/escalatorView.ts, the moving cars by carView.ts.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { planScenery } from '../../track/sceneryPlan';
import type { MallPlan } from '../../track/mallPlan';
import { CURB_WIDTH, type Track, type TrackSample } from '../../sim/track';
import { grassMaps } from '../textures';
import { ENV_TIME } from './materials';
import { blobGeo, latheGeo, matrix, merge, paint, ribbonGeo, scratch, tubeGeo } from './geo';
import { boxPart } from './parts';
import { noise3 } from './noise';
import type { RibbonTools } from './rainbow';

/** Does this track use the shopping-mall look? */
export const isMall = (track: Track): boolean => track.def.scenery.mall !== undefined;

/** Height of the skylight roof above the upper floor (m). */
const ROOF_ABOVE_UPPER = 17;

const _c = new THREE.Color();
const rand = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// ---------------------------------------------------------------------------------------------
// Textures (canvas)
// ---------------------------------------------------------------------------------------------

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/**
 * The mall's road: large polished stone tiles (4 across the road, 3 per 12 m), a soft darker band along each edge and a
 * dashed gold inlay down the middle (the "lane line" of an indoor floor).
 */
export function mallRoadTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 384);
  const rnd = rand(11);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      const k = 196 + Math.floor(rnd() * 14);
      g.fillStyle = `rgb(${k},${k - 6},${k - 16})`;
      g.fillRect(i * 128, j * 128, 128, 128);
      // marble veins
      g.strokeStyle = 'rgba(160,150,140,0.18)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(i * 128 + rnd() * 128, j * 128);
      g.bezierCurveTo(i * 128 + rnd() * 128, j * 128 + 40, i * 128 + rnd() * 128, j * 128 + 90, i * 128 + rnd() * 128, j * 128 + 128);
      g.stroke();
    }
  }
  g.fillStyle = 'rgba(120,110,100,0.55)';
  for (let i = 0; i <= 4; i++) g.fillRect(i * 128 - 1.5, 0, 3, 384);
  for (let j = 0; j <= 3; j++) g.fillRect(0, j * 128 - 1.5, 512, 3);
  // Edge bands (darker stone) and the gold centre inlay.
  g.fillStyle = 'rgba(70,80,95,0.55)';
  g.fillRect(0, 0, 18, 384);
  g.fillRect(494, 0, 18, 384);
  g.fillStyle = '#d6a648';
  for (let j = 0; j < 3; j++) g.fillRect(250, j * 128 + 24, 12, 80);
  return tex(c);
}

/** Floor tiles for the walkways and the ground floor (2 m tiles, 8 per texture: repeat it every 16 m). */
function floorTexture(base: [number, number, number], seed: number): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const rnd = rand(seed);
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const k = (rnd() - 0.5) * 14 + ((i + j) % 2 ? 6 : 0);
      g.fillStyle = `rgb(${base[0] + k},${base[1] + k},${base[2] + k})`;
      g.fillRect(i * 32, j * 32, 32, 32);
    }
  }
  g.fillStyle = 'rgba(90,80,70,0.35)';
  for (let i = 0; i <= 8; i++) {
    g.fillRect(i * 32 - 0.5, 0, 1, 256);
    g.fillRect(0, i * 32 - 0.5, 256, 1);
  }
  return tex(c);
}

/** Asphalt with painted parking-bay lines (one bay = 3 m; the texture is 12 m square). */
function lotTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const rnd = rand(5);
  g.fillStyle = '#5b5e63';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1600; i++) {
    const k = 70 + Math.floor(rnd() * 40);
    g.fillStyle = `rgba(${k},${k},${k + 4},0.5)`;
    g.fillRect(rnd() * 256, rnd() * 256, 2, 2);
  }
  g.fillStyle = 'rgba(245,245,240,0.85)';
  for (let i = 0; i < 4; i++) g.fillRect(i * 64 + 30, 0, 4, 110);
  for (let i = 0; i < 4; i++) g.fillRect(i * 64 + 30, 146, 4, 110);
  return tex(c);
}

/** Original, made-up store names for the sign boards (no real brands). */
const STORE_NAMES = ['Sunny Sips', 'Pixel Pals', 'Kiwi & Co.', 'Moonbeam Books', 'Zippy Shoes', 'Coco Cones', 'Bloom Room', 'Gadget Grove', 'Tidal Tees', 'Puffin Pops', 'Velvet Boutique', 'Maple Mugs', 'Comet Toys', 'Lemon Loft', 'Breeze Bikes', 'Honey Hats'];
const SIGN_COLORS = ['#ff6b6b', '#4ecdc4', '#ffbe0b', '#8338ec', '#3a86ff', '#fb5607', '#06d6a0', '#ef476f'];

/** Sign atlas: 2 columns x 8 rows of 256 x 64 boards. Returns the texture and the UV rectangle of board i. */
function signAtlas(): { map: THREE.CanvasTexture; uv: (i: number) => [number, number, number, number] } {
  const [c, g] = canvas(512, 512);
  STORE_NAMES.forEach((name, i) => {
    const x = (i % 2) * 256;
    const y = Math.floor(i / 2) * 64;
    const col = SIGN_COLORS[i % SIGN_COLORS.length];
    g.fillStyle = '#fbfaf7';
    g.fillRect(x, y, 256, 64);
    g.fillStyle = col;
    g.fillRect(x + 4, y + 4, 248, 56);
    // A little made-up logo: a circle with a star or a leaf.
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x + 32, y + 32, 20, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = col;
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 7 : 15;
      const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
      g.lineTo(x + 32 + Math.cos(a) * r, y + 32 + Math.sin(a) * r);
    }
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = 'bold 30px sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(name, x + 60, y + 34, 188);
  });
  const map = tex(c, false);
  return { map, uv: (i) => [((i % 2) * 256) / 512, 1 - (Math.floor(i / 2) * 64 + 64) / 512, 256 / 512, 64 / 512] };
}

/**
 * Poster atlas: 3 x 2 original "ads" (256 x 256 each): bright gradients, simple shapes and made-up mascots (a smiling
 * sun with sunglasses, a jelly blob, a happy cloud, a cheerful cactus, a rocket ice cream, a sparkly gift box).
 */
function posterAtlas(): { map: THREE.CanvasTexture; uv: (i: number) => [number, number, number, number] } {
  const [c, g] = canvas(768, 512);
  const bgs = [['#ffd166', '#ef476f'], ['#06d6a0', '#118ab2'], ['#a0c4ff', '#bdb2ff'], ['#ffadad', '#ffd6a5'], ['#caffbf', '#9bf6ff'], ['#ffc6ff', '#fdffb6']];
  const words = ['SUMMER SALE', 'NEW FLAVOURS', 'FLOAT ON', 'STAY SHARP', 'COOL TREATS', 'GIFT IDEAS'];
  const face = (x: number, y: number, r: number) => {
    g.fillStyle = '#222';
    g.beginPath();
    g.arc(x - r * 0.35, y - r * 0.15, r * 0.1, 0, Math.PI * 2);
    g.arc(x + r * 0.35, y - r * 0.15, r * 0.1, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#222';
    g.lineWidth = r * 0.08;
    g.beginPath();
    g.arc(x, y + r * 0.1, r * 0.4, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();
  };
  for (let i = 0; i < 6; i++) {
    const x = (i % 3) * 256;
    const y = Math.floor(i / 3) * 256;
    const grd = g.createLinearGradient(x, y, x + 256, y + 256);
    grd.addColorStop(0, bgs[i][0]);
    grd.addColorStop(1, bgs[i][1]);
    g.fillStyle = grd;
    g.fillRect(x, y, 256, 256);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    for (let k = 0; k < 6; k++) {
      g.beginPath();
      g.arc(x + 30 + k * 40, y + 40 + (k % 2) * 30, 14 + k * 2, 0, Math.PI * 2);
      g.fill();
    }
    const cx = x + 128;
    const cy = y + 110;
    if (i === 0) {
      // Sun with sunglasses.
      g.fillStyle = '#ffdd33';
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        g.fillRect(cx + Math.cos(a) * 62 - 6, cy + Math.sin(a) * 62 - 6, 12, 12);
      }
      g.beginPath();
      g.arc(cx, cy, 50, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#222';
      g.fillRect(cx - 38, cy - 18, 32, 16);
      g.fillRect(cx + 6, cy - 18, 32, 16);
      g.fillRect(cx - 8, cy - 14, 16, 4);
      g.strokeStyle = '#222';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(cx, cy + 8, 20, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
    } else if (i === 1) {
      // Jelly blob.
      g.fillStyle = '#ff5fa2';
      g.beginPath();
      g.ellipse(cx, cy + 10, 60, 52, 0, 0, Math.PI * 2);
      g.fill();
      face(cx, cy + 10, 50);
    } else if (i === 2) {
      // Happy cloud.
      g.fillStyle = '#ffffff';
      for (const [dx, dy, r] of [[-40, 10, 34], [0, -10, 44], [42, 10, 32], [0, 25, 38]]) {
        g.beginPath();
        g.arc(cx + dx, cy + dy, r, 0, Math.PI * 2);
        g.fill();
      }
      face(cx, cy + 10, 44);
    } else if (i === 3) {
      // Cheerful cactus.
      g.fillStyle = '#2a9d8f';
      g.fillRect(cx - 22, cy - 60, 44, 130);
      g.fillRect(cx - 62, cy - 10, 30, 20);
      g.fillRect(cx - 62, cy - 40, 20, 40);
      g.fillRect(cx + 32, cy, 30, 20);
      g.fillRect(cx + 42, cy - 30, 20, 40);
      face(cx, cy - 20, 30);
    } else if (i === 4) {
      // Rocket ice cream.
      g.fillStyle = '#e9c46a';
      g.beginPath();
      g.moveTo(cx - 34, cy);
      g.lineTo(cx + 34, cy);
      g.lineTo(cx, cy + 90);
      g.fill();
      g.fillStyle = '#f4a261';
      g.beginPath();
      g.arc(cx, cy - 8, 40, Math.PI, 0);
      g.fill();
      g.fillStyle = '#e76f51';
      g.beginPath();
      g.arc(cx, cy - 40, 26, Math.PI, 0);
      g.fill();
      face(cx, cy - 18, 30);
    } else {
      // Gift box.
      g.fillStyle = '#e63946';
      g.fillRect(cx - 52, cy - 30, 104, 90);
      g.fillStyle = '#ffd166';
      g.fillRect(cx - 8, cy - 30, 16, 90);
      g.fillRect(cx - 52, cy - 2, 104, 14);
      g.beginPath();
      g.ellipse(cx - 18, cy - 42, 18, 12, -0.4, 0, Math.PI * 2);
      g.ellipse(cx + 18, cy - 42, 18, 12, 0.4, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 6;
    g.font = 'bold 34px sans-serif';
    g.textAlign = 'center';
    g.strokeText(words[i], cx, y + 222, 236);
    g.fillText(words[i], cx, y + 222, 236);
  }
  const map = tex(c, false);
  return { map, uv: (i) => [((i % 3) * 256) / 768, 1 - (Math.floor(i / 3) * 256 + 256) / 512, 256 / 768, 256 / 512] };
}

// ---------------------------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------------------------

/**
 * A simple, original hatchback (about 4.3 x 1.9 m, facing +z): body, cabin with dark glass, wheels, lights. The body is
 * painted WHITE so an InstancedMesh's per-instance colour tints it (the glass and tyres stay dark).
 */
export function carGeometry(): THREE.BufferGeometry {
  const white = new THREE.Color('#f4f4f4');
  const glass = new THREE.Color('#26303c');
  const tyre = new THREE.Color('#1c1c1e');
  const parts = [
    boxPart(0, 0.62, 0, 1.9, 0.62, 4.3, white, 0, 0.8),
    boxPart(0, 1.16, -0.25, 1.66, 0.5, 2.3, glass, 0, 0.95),
    boxPart(0, 1.43, -0.25, 1.5, 0.06, 2.1, white, 0, 1),
  ];
  for (const sx of [-1, 1]) {
    for (const sz of [-1.35, 1.35]) {
      const w = paint(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10).deleteAttribute('uv').rotateZ(Math.PI / 2).translate(sx * 0.86, 0.36, sz), () => tyre);
      parts.push(w);
    }
    parts.push(boxPart(sx * 0.62, 0.72, 2.16, 0.36, 0.16, 0.04, new THREE.Color(1.8, 1.7, 1.2), 0, 1));
    parts.push(boxPart(sx * 0.62, 0.72, -2.16, 0.36, 0.16, 0.04, new THREE.Color(1.4, 0.2, 0.15), 0, 1));
  }
  return merge(parts);
}

/** Car paint colours (InstancedMesh instance colours). */
export const CAR_COLORS = ['#e63946', '#1d6fd1', '#f4d35e', '#ffffff', '#2a9d8f', '#3d3d45', '#ff8fab', '#7b2cbf'];

/** A palm in a round white planter (planter radius ~1.3 m, palm ~7 m tall), facing any way. */
function palmGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(latheGeo([[0, 0], [1.3, 0], [1.35, 0.9], [1.2, 0.95], [1.0, 0.85], [0, 0.85]], 14), (p) => (p.y > 0.8 && Math.hypot(p.x, p.z) < 1.15 ? _c.set('#6b4a2f') : _c.set('#f1ede4'))));
  // Trunk: a gently curved tube with ring bands.
  const path = [new THREE.Vector3(0, 0.8, 0), new THREE.Vector3(0.15, 2.6, 0.05), new THREE.Vector3(0.45, 4.6, 0.1), new THREE.Vector3(0.8, 6.4, 0.15)];
  parts.push(paint(tubeGeo(path, [0.3, 0.26, 0.22, 0.2], 7), (p) => _c.set('#8a6a46').multiplyScalar(0.8 + 0.25 * (Math.sin(p.y * 9) > 0 ? 1 : 0))));
  const top = path[path.length - 1];
  // Fronds: long drooping leaves (thin flattened tubes) radiating from the top.
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 5; i++) {
      const u = i / 5;
      pts.push(top.clone().addScaledVector(dir, u * 3.6).add(new THREE.Vector3(0, 0.7 * u - 2.1 * u * u, 0)));
    }
    // A double-sided leaf ribbon, spread across the frond's direction.
    const leaf = ribbonGeo(pts, [0.1, 0.8, 0.95, 0.8, 0.5, 0.06], new THREE.Vector3(-dir.z, 0, dir.x));
    parts.push(paint(leaf, (p) => _c.set(k % 2 ? '#2f8f3a' : '#3fa94a').multiplyScalar(0.8 + 0.3 * Math.min(1, (p.y - top.y + 2) / 2.5))));
  }
  // Coconuts.
  for (let k = 0; k < 3; k++) parts.push(paint(blobGeo(1, k + 2, 0.05, 1, noise3).applyMatrix4(matrix(top.x + Math.cos(k * 2.1) * 0.3, top.y - 0.25, top.z + Math.sin(k * 2.1) * 0.3, 0.2)), () => _c.set('#5a4022')));
  return merge(parts);
}

// ---------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------

type Edge = { d: number; h: number };

export class MallView {
  readonly group = new THREE.Group();
  private readonly water: THREE.Texture;
  private readonly jets: THREE.Mesh;

  constructor(
    readonly track: Track,
    tools: RibbonTools,
  ) {
    const def = track.def;
    const mall = def.scenery.mall!;
    const plan = planScenery(track);
    const mp: MallPlan = plan.mall!;
    const hw = def.width / 2;
    const outer = hw + def.offroadWidth;
    const S = track.samples;
    const roofY = mall.upper + ROOF_ABOVE_UPPER;
    const inRange = (s: number, from: number, to: number) => track.deltaS(track.sAt(from), s) >= 0 && track.deltaS(s, track.sAt(to)) >= 0;
    const onUpper = (p: TrackSample) => mall.upperFloor.some((r) => inRange(p.s, r.from, r.to));
    const inLot = (p: TrackSample) => track.deltaS(track.sAt(mall.lot.from) - 30, p.s) >= 0 && track.deltaS(p.s, track.sAt(mall.lot.to) + 160) >= 0;
    const inGarden = (p: TrackSample) => inRange(p.s, mall.garden.from, mall.garden.to);
    const escRanges = (def.hazards ?? []).filter((h) => h.kind === 'escalator').map((h) => [track.sAt(h.from) - 50, track.sAt(h.to) + 50]);
    const nearEsc = (s: number) => escRanges.some(([a, b]) => track.deltaS(a, s) >= 0 && track.deltaS(s, b) >= 0);
    /** Distance to the nearest road sample (main or branch) at about the same level as y. */
    const roadDist = (x: number, z: number, y: number) => {
      let best = Infinity;
      for (let i = 0; i < S.length; i += 2) if (Math.abs(S[i].y - y) < 5) best = Math.min(best, Math.hypot(S[i].x - x, S[i].z - z));
      for (const b of track.branches) for (let i = 0; i < b.samples.length; i += 2) if (Math.abs(b.samples[i].y - y) < 5) best = Math.min(best, Math.hypot(b.samples[i].x - x, b.samples[i].z - z));
      return best;
    };
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow = false) => {
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      m.castShadow = shadow;
      this.group.add(m);
      return m;
    };

    // ---- Floors -------------------------------------------------------------------------------
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of S) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const M = 90;
    const groundTex = floorTexture([182, 172, 156], 3);
    groundTex.repeat.set((maxX - minX + 2 * M) / 16, (maxZ - minZ + 2 * M) / 16);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX + 2 * M, maxZ - minZ + 2 * M).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.55 }));
    ground.position.set((minX + maxX) / 2, -0.04, (minZ + maxZ) / 2);
    ground.receiveShadow = true;
    this.group.add(ground);

    // Upper-floor slabs (walkway, shops and columns stand on them), the store floor, the parking-deck ramp.
    const slabTex = floorTexture([196, 188, 174], 8);
    slabTex.repeat.set(4, 1);
    const slabMat = new THREE.MeshStandardMaterial({ map: slabTex, roughness: 0.5 });
    const sideMat = new THREE.MeshStandardMaterial({ color: '#d9d3c8', roughness: 0.7 });
    const SLAB_W = 30;
    const slab = (run: TrackSample[], half: number, drop: (p: TrackSample) => number, lift = -0.03) => {
      add(tools.ribbon(run, false, () => [{ d: -half, h: lift }, { d: half, h: lift }], 16), slabMat);
      for (const side of [-1, 1]) {
        add(tools.ribbon(run, false, (p) => (side < 0 ? [{ d: -half, h: -drop(p) }, { d: -half, h: lift }] : [{ d: half, h: lift }, { d: half, h: -drop(p) }]), 8), sideMat);
      }
    };
    for (const run of tools.runs(S, (p) => onUpper(p) && !nearEsc(p.s - 30))) slab(run, SLAB_W, () => 0.9);
    // The parking-deck ramp (concrete, walls down to the ground).
    const rampRuns = tools.runs(S, (p) => p.y > 0.4 && !onUpper(p) && !nearEsc(p.s));
    for (const run of rampRuns) slab(run, outer + 0.6, (p) => p.y, -0.03);
    // The store floor (its aisle is a deck branch at the upper floor's height).
    const storeIdx = mall.storeBranch;
    const store = storeIdx !== undefined ? track.branches[storeIdx] : null;
    if (store) slab(store.samples, 16, () => 0.9, -0.05);

    // The deck lanes' road ribbons and kerbs (the main road is drawn by trackView with the same material).
    const roadMat = new THREE.MeshStandardMaterial({ map: mallRoadTexture(), roughness: 0.35, metalness: 0.05 });
    const kerbMat = new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.5 });
    for (const b of track.branches) {
      const bw = b.samples[0].width / 2;
      add(tools.ribbon(b.samples, false, () => [{ d: -bw, h: 0.025 }, { d: bw, h: 0.025 }], 12), roadMat);
      for (const side of [-1, 1]) add(tools.ribbon(b.samples, false, () => (side < 0 ? [{ d: -bw - CURB_WIDTH, h: 0.03 }, { d: -bw, h: 0.03 }] : [{ d: bw, h: 0.03 }, { d: bw + CURB_WIDTH, h: 0.03 }]), 3), kerbMat);
      // Glass rails where the branch has walls (same look as the main road's, see trackView).
      const off = bw + def.offroadWidth;
      for (const side of [-1, 1]) {
        for (const run of tools.runs(b.samples, (p) => (side < 0 ? p.wallLeft : p.wallRight))) {
          if (run.length < 2) continue;
          add(tools.ribbon(run, false, (): Edge[] => [{ d: side * off, h: 0 }, { d: side * off, h: 1.15 }], 6), mallGlassMaterial());
          add(tools.ribbon(run, false, (): Edge[] => [{ d: side * off - 0.06, h: 1.15 }, { d: side * off + 0.06, h: 1.15 }], 6), railMetal());
        }
      }
    }

    // ---- Parking lot: asphalt with bays, parked cars, lamps, garage gates -------------------------
    const lotMat = new THREE.MeshStandardMaterial({ map: lotTexture(), roughness: 0.9 });
    for (const run of tools.runs(S, (p) => inLot(p))) add(tools.ribbon(run, false, () => [{ d: -44, h: 0.0 }, { d: 44, h: 0.0 }], 12), lotMat);
    const carGeo = carGeometry();
    const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.3 });
    if (mp.parkedCars.length) {
      const cars = new THREE.InstancedMesh(carGeo, carMat, mp.parkedCars.length);
      mp.parkedCars.forEach((c, i) => {
        cars.setMatrixAt(i, matrix(c.x, c.y, c.z, 1, 1, 1, c.rotationY));
        cars.setColorAt(i, _c.set(CAR_COLORS[c.color % CAR_COLORS.length]));
      });
      cars.castShadow = true;
      cars.receiveShadow = true;
      this.group.add(cars);
    }
    if (mp.lamps.length) {
      const lampGeo = merge([paint(new THREE.CylinderGeometry(0.12, 0.16, 7, 6).deleteAttribute('uv').translate(0, 3.5, 0), () => _c.set('#7d8590')), boxPart(0, 7.05, 0.6, 0.5, 0.18, 1.5, new THREE.Color('#7d8590')), boxPart(0, 6.94, 0.9, 0.4, 0.04, 0.7, new THREE.Color(3, 2.9, 2.4), 0, 1)]);
      const lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 }), mp.lamps.length);
      mp.lamps.forEach((l, i) => lamps.setMatrixAt(i, matrix(l.x, l.y, l.z, 1, 1, 1, l.rotationY + Math.PI / 2)));
      this.group.add(lamps);
    }
    if (mp.garages.length) {
      const parts: THREE.BufferGeometry[] = [];
      for (const gar of mp.garages) {
        const m = matrix(gar.x, gar.y, gar.z, 1, 1, 1, gar.rotationY);
        // local x = along the car lane (away from / toward the road), local z = along the road
        const g = merge([
          boxPart(0, gar.h / 2, 0, gar.d, gar.h, gar.w, new THREE.Color('#d9d4c7')),
          boxPart(0, gar.h + 0.25, 0, gar.d + 0.6, 0.5, gar.w + 0.6, new THREE.Color('#2a9d8f')),
          // The dark opening on both lane ends (the cars drive in and out here).
          boxPart(0, 1.3, 0, gar.d + 0.04, 2.6, 3.2, new THREE.Color('#15181c'), 0, 1),
        ]);
        parts.push(g.applyMatrix4(m));
      }
      add(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), true);
    }

    // ---- Shops, columns, posters (indoors: the upper floor and the garden) ---------------------------
    const signs = signAtlas();
    const posters = posterAtlas();
    const shopParts: THREE.BufferGeometry[] = [];
    const windows: THREE.BufferGeometry[] = [];
    const signQuads: THREE.BufferGeometry[] = [];
    const posterQuads: THREE.BufferGeometry[] = [];
    const quad = (w: number, h: number, m: THREE.Matrix4, uvRect?: [number, number, number, number]) => {
      const q = new THREE.PlaneGeometry(w, h);
      if (uvRect) {
        const uv = q.getAttribute('uv') as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uvRect[0] + uv.getX(i) * uvRect[2], uvRect[1] + uv.getY(i) * uvRect[3]);
      }
      return q.applyMatrix4(m);
    };
    const rnd = rand(mall.seed ?? 5);
    const SHOP_FRONT = 21; // distance of the shop fronts from the road centre (beyond the palms)
    const SHOP_W = 13;
    const SHOP_D = 9;
    let shopIndex = 0;
    const step = Math.round(15 / track.spacing);
    const placedShops: [number, number][] = [];
    for (let i = 0; i < S.length; i += step) {
      const p = S[i];
      const indoor = (onUpper(p) || inGarden(p)) && !nearEsc(p.s);
      if (!indoor) continue;
      for (const side of [-1, 1]) {
        const d = side * (SHOP_FRONT + SHOP_D / 2);
        const x = p.x + p.rx * d;
        const z = p.z + p.rz * d;
        if (roadDist(x, z, p.y) < SHOP_FRONT + SHOP_D / 2 - 1.5) continue;
        if (placedShops.some(([px, pz]) => Math.hypot(px - x, pz - z) < SHOP_W)) continue;
        placedShops.push([x, z]);
        // Facing the road: local +z points at it.
        const rot = Math.atan2(-side * p.rx, -side * p.rz);
        const m = matrix(x, p.y, z, 1, 1, 1, rot);
        const h = 7 + Math.floor(rnd() * 2);
        _c.set(SIGN_COLORS[shopIndex % SIGN_COLORS.length]).lerp(new THREE.Color('#ffffff'), 0.75);
        shopParts.push(boxPart(0, h / 2, 0, SHOP_W, h, SHOP_D, _c.clone()).applyMatrix4(m));
        shopParts.push(boxPart(0, h - 1.2, SHOP_D / 2 + 0.15, SHOP_W + 0.2, 1.6, 0.3, new THREE.Color('#f8f8f8')).applyMatrix4(m));
        // Mullions between the window panes.
        for (const mx of [-SHOP_W / 2 + 0.3, -2.2, 2.2, SHOP_W / 2 - 0.3]) shopParts.push(boxPart(mx, 2.6, SHOP_D / 2 + 0.06, 0.18, 4.6, 0.14, new THREE.Color('#c8ccd2')).applyMatrix4(m));
        windows.push(quad(SHOP_W - 0.6, 4.4, m.clone().multiply(matrix(0, 2.6, SHOP_D / 2 + 0.02))));
        signQuads.push(quad(SHOP_W - 1.6, (SHOP_W - 1.6) / 4, m.clone().multiply(matrix(0, h - 1.2, SHOP_D / 2 + 0.32)), signs.uv(shopIndex % STORE_NAMES.length)));
        shopIndex++;
      }
    }
    if (shopParts.length) add(merge(shopParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), true);
    if (windows.length) add(mergeGeometries(windows)!, new THREE.MeshStandardMaterial({ color: '#cfe8ff', emissive: new THREE.Color('#ffe8b8'), emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.2 }));

    // Columns: along the outer edges of the upper-floor slabs, up to the roof (posters on the side facing the road).
    const colPos: [number, number, number, number][] = [];
    for (let i = 0; i < S.length; i += Math.round(26 / track.spacing)) {
      const p = S[i];
      if (!onUpper(p) || nearEsc(p.s)) continue;
      for (const side of [-1, 1]) {
        const d = side * (outer + 4.2);
        const x = p.x + p.rx * d;
        const z = p.z + p.rz * d;
        if (roadDist(x, z, p.y) < outer + 4) continue;
        colPos.push([x, z, p.y, Math.atan2(-side * p.rx, -side * p.rz)]);
      }
    }
    if (colPos.length) {
      const colGeo = merge([paint(new THREE.CylinderGeometry(0.45, 0.5, 1, 12).deleteAttribute('uv').translate(0, 0.5, 0), (p) => _c.set('#f5f3ee').multiplyScalar(p.y > 0.98 ? 0.9 : 1))]);
      const cols = new THREE.InstancedMesh(colGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }), colPos.length);
      colPos.forEach(([x, z, y], i) => cols.setMatrixAt(i, matrix(x, y, z, 1, roofY - y, 1)));
      cols.castShadow = true;
      this.group.add(cols);
      colPos.forEach(([x, z, y, rot], i) => {
        posterQuads.push(quad(1.6, 2.2, matrix(x, y + 3.4, z, 1, 1, 1, rot).multiply(matrix(0, 0, 0.52)), posters.uv(i % 6)));
      });
    }
    if (posterQuads.length) add(mergeGeometries(posterQuads)!, new THREE.MeshBasicMaterial({ map: posters.map, color: new THREE.Color(1.1, 1.1, 1.1) }));

    // ---- Skylight roof: a steel lattice with glass over the indoor part (not over the parking lot or the entrance plaza) ----
    {
      const indoorPts = S.filter((p) => onUpper(p) || inGarden(p) || nearEsc(p.s));
      const CELL = 12;
      const cells = new Set<string>();
      for (const p of indoorPts) {
        for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) cells.add(`${Math.floor(p.x / CELL) + dx},${Math.floor(p.z / CELL) + dz}`);
      }
      const beams: THREE.Matrix4[] = [];
      const panes: THREE.BufferGeometry[] = [];
      for (const key of cells) {
        const [cx, cz] = key.split(',').map(Number);
        const x = (cx + 0.5) * CELL;
        const z = (cz + 0.5) * CELL;
        beams.push(matrix(x - CELL / 2, roofY, z, 0.3, 0.45, CELL));
        beams.push(matrix(x, roofY, z - CELL / 2, CELL, 0.45, 0.3));
        panes.push(new THREE.PlaneGeometry(CELL, CELL).rotateX(Math.PI / 2).translate(x, roofY + 0.25, z));
      }
      const beamMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#e8ecf0', roughness: 0.4, metalness: 0.5 }), beams.length);
      beams.forEach((m, i) => beamMesh.setMatrixAt(i, m));
      this.group.add(beamMesh);
      if (panes.length) this.group.add(new THREE.Mesh(mergeGeometries(panes)!, new THREE.MeshBasicMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide })));
    }

    // ---- The Boutique: the store the shortcut runs through (walls with shop windows, a sign over each door) ----------
    if (store) {
      const bw = store.samples[0].width / 2 + def.offroadWidth + 0.3;
      const wallMat = new THREE.MeshStandardMaterial({ color: '#f6d7e3', roughness: 0.6, side: THREE.DoubleSide });
      const winMat = new THREE.MeshStandardMaterial({ color: '#ffe9f2', emissive: new THREE.Color('#ffd0e4'), emissiveIntensity: 0.7, roughness: 0.2, side: THREE.DoubleSide });
      const walled = store.samples.filter((p) => p.wallLeft || p.wallRight);
      if (walled.length > 2) {
        for (const side of [-1, 1]) {
          add(tools.ribbon(walled, false, (): Edge[] => [{ d: side * bw, h: 0 }, { d: side * bw, h: 6 }], 8), wallMat);
          add(tools.ribbon(walled, false, (): Edge[] => [{ d: side * (bw - 0.05), h: 1.2 }, { d: side * (bw - 0.05), h: 4.2 }], 8), winMat);
        }
        // Door frames with the store's sign at both ends.
        const frame: THREE.BufferGeometry[] = [];
        for (const p of [walled[0], walled[walled.length - 1]]) {
          const rot = Math.atan2(p.tx, p.tz);
          for (const side of [-1, 1]) frame.push(boxPart(p.x + p.rx * side * bw, p.y + 3.4, p.z + p.rz * side * bw, 0.8, 6.8, 0.8, new THREE.Color('#e04f8a'), rot));
          frame.push(boxPart(p.x, p.y + 6.6, p.z, 2 * bw + 0.8, 1.2, 0.8, new THREE.Color('#e04f8a'), rot));
          signQuads.push(quad(2 * bw - 2, (2 * bw - 2) / 4, matrix(p.x, p.y + 6.6, p.z, 1, 1, 1, rot + Math.PI).multiply(matrix(0, 0, 0.42)), signs.uv(10)));
          signQuads.push(quad(2 * bw - 2, (2 * bw - 2) / 4, matrix(p.x, p.y + 6.6, p.z, 1, 1, 1, rot).multiply(matrix(0, 0, 0.42)), signs.uv(10)));
        }
        add(merge(frame), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), true);
      }
    }
    if (signQuads.length) add(mergeGeometries(signQuads)!, new THREE.MeshBasicMaterial({ map: signs.map, color: new THREE.Color(1.25, 1.25, 1.25) }));

    // ---- Palms in planters (solid: from the scenery plan) -------------------------------------------
    if (mp.palms.length) {
      const palms = new THREE.InstancedMesh(palmGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }), mp.palms.length);
      mp.palms.forEach((pl, i) => palms.setMatrixAt(i, matrix(pl.x, pl.y, pl.z, pl.scale, pl.scale, pl.scale, pl.rotationY)));
      palms.castShadow = true;
      this.group.add(palms);
    }

    // ---- Festive string lights across the road (indoors) ----------------------------------------------
    {
      const bulbs: [THREE.Matrix4, THREE.Color][] = [];
      const hues = [new THREE.Color(3, 0.6, 0.5), new THREE.Color(3, 2.4, 0.6), new THREE.Color(0.6, 2.6, 1.2), new THREE.Color(0.7, 1.4, 3.2), new THREE.Color(2.6, 0.8, 2.8)];
      for (let i = 0; i < S.length; i += Math.round(30 / track.spacing)) {
        const p = S[i];
        if (!(onUpper(p) || inGarden(p)) || nearEsc(p.s)) continue;
        const span = outer + 1.5;
        for (let k = 0; k <= 16; k++) {
          const u = k / 16;
          const d = -span + 2 * span * u;
          const y = p.y + 8.5 - 2.2 * (1 - (2 * u - 1) ** 2);
          bulbs.push([matrix(p.x + p.rx * d, y, p.z + p.rz * d, 0.16), hues[(k + i) % hues.length]]);
        }
      }
      if (bulbs.length) {
        const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffffff' }), bulbs.length);
        bulbs.forEach(([m, c], i) => {
          mesh.setMatrixAt(i, m);
          mesh.setColorAt(i, c);
        });
        this.group.add(mesh);
      }
    }

    // ---- Garden: lawns beside the road, grass patches on it, the fountain -----------------------------
    const grass = grassMaps('#5fae4a');
    for (const t of [grass.map, grass.normalMap, grass.roughnessMap]) t.repeat.set(1, 1);
    const lawnMat = new THREE.MeshStandardMaterial({ ...grass, roughness: 1 });
    for (const run of tools.runs(S, (p) => inGarden(p))) {
      for (const side of [-1, 1]) add(tools.ribbon(run, false, () => (side < 0 ? [{ d: -15, h: 0.0 }, { d: -outer - 0.3, h: 0.0 }] : [{ d: outer + 0.3, h: 0.0 }, { d: 15, h: 0.0 }]), 8), lawnMat);
    }
    const patchMat = new THREE.MeshStandardMaterial({ ...grass, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const g of track.grassPatches) {
      const ss = between(track, g.s0, g.s1);
      add(tools.ribbon(ss, false, () => [{ d: g.d0, h: 0.06 }, { d: g.d1, h: 0.06 }], 6), patchMat);
    }
    // The fountain: a pool over the road after the rim's kicker, a round rim either side of the road, and two jets.
    this.water = waterTexture();
    const fs = track.sAt(mall.fountain.at);
    const ramp = track.ramps.find((r) => Math.abs(track.deltaS(r.s0, fs)) < 1);
    const poolS0 = ramp ? ramp.s1 : fs + 10;
    const poolS1 = poolS0 + mall.fountain.length;
    const pool = between(track, poolS0, poolS1);
    add(tools.ribbon(pool, false, () => [{ d: -hw - 3, h: 0.07 }, { d: hw + 3, h: 0.07 }], 8), new THREE.MeshStandardMaterial({ map: this.water, color: '#7fd3ff', transparent: true, opacity: 0.78, roughness: 0.05, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    const mid = track.pointAt((poolS0 + poolS1) / 2);
    const R = Math.max(mall.fountain.length / 2 + 2, hw + 4);
    const rimParts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      const x = mid.x + Math.cos(a) * R;
      const z = mid.z + Math.sin(a) * R;
      const pr = track.project(x, z, mid.index);
      if (Math.abs(pr.d) < outer + 0.5) continue; // the road passes through the rim
      rimParts.push(boxPart(x, mid.y + 0.35, z, 1.2, 0.7, (2 * Math.PI * R) / 48 + 0.15, new THREE.Color('#f2efe8'), -a));
    }
    if (rimParts.length) add(merge(rimParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), true);
    const jetGeo = new THREE.CylinderGeometry(0.25, 0.7, 1, 10, 1, true).translate(0, 0.5, 0);
    const jetMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.8, 2.2), transparent: true, opacity: 0.55, depthWrite: false });
    this.jets = new THREE.Mesh(new THREE.BufferGeometry(), jetMat);
    const jetParts: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const p = track.pointAt((poolS0 + poolS1) / 2, side * (outer + 3.2));
      jetParts.push(jetGeo.clone().applyMatrix4(matrix(p.x, mid.y, p.z, 1, 6, 1)));
      jetParts.push(jetGeo.clone().applyMatrix4(matrix(p.x, mid.y, p.z, 2.2, 1.2, 2.2)));
    }
    this.jets.geometry = mergeGeometries(jetParts)!;
    this.group.add(this.jets);
  }

  /** Animate the fountain (scrolling ripples, pulsing jets). */
  update(time: number): void {
    ENV_TIME.value = time;
    this.water.offset.set(time * 0.03, time * 0.05);
    this.jets.scale.y = 1 + 0.08 * Math.sin(time * 6);
  }
}

/** Samples covering [s0, s1] (with wrap). */
function between(track: Track, s0: number, s1: number): TrackSample[] {
  const out: TrackSample[] = [];
  const n = track.samples.length;
  const i0 = Math.floor(s0 / track.spacing);
  const steps = Math.ceil((s1 - s0) / track.spacing);
  for (let k = 0; k <= steps; k++) out.push(track.samples[(((i0 + k) % n) + n) % n]);
  return out;
}

/** Soft ripples for the fountain pool. */
function waterTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#6cc7f0';
  g.fillRect(0, 0, 128, 128);
  const rnd = rand(21);
  g.strokeStyle = 'rgba(255,255,255,0.45)';
  g.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    g.beginPath();
    g.arc(rnd() * 128, rnd() * 128, 6 + rnd() * 18, 0, Math.PI * (0.6 + rnd()));
    g.stroke();
  }
  return tex(c);
}

let glassMat: THREE.MeshStandardMaterial | null = null;
/** The glass railing panels (shared by the main road's walls in trackView and the deck lanes here). */
export function mallGlassMaterial(): THREE.MeshStandardMaterial {
  if (!glassMat) glassMat = new THREE.MeshStandardMaterial({ color: '#cfefff', transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
  return glassMat;
}

let railMat: THREE.MeshStandardMaterial | null = null;
/** Brushed steel hand rail. */
export function railMetal(): THREE.MeshStandardMaterial {
  if (!railMat) railMat = new THREE.MeshStandardMaterial({ color: '#d7dde3', roughness: 0.3, metalness: 0.8 });
  return railMat;
}

void scratch;
