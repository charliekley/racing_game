/**
 * Palm Plaza's look (gated by `scenery.mall`, see TrackDef): a bright, colourful, modern two-storey shopping mall. Everything is
 * procedural (canvas textures and primitives, no asset files) and ORIGINAL: the store names, signs, posters and their
 * mascots are made up for this game.
 *
 *   - the BUILDING SHELL (mallShell.ts): walls along the building's footprint (with gates where the roads pass through, see
 *     track/mallPlan.ts), a glass skylight roof with sunbeams.
 *   - FLOORS: a polished terracotta/cream tile floor for the ground floor and the garden, the upper-floor slab (as far as the
 *     plan lets it reach: never over a road on another level), the spiral's helical slab round its sculpture column, the lower
 *     route's raised start and ledge, the deck ramp, and the parking deck (asphalt with bays). (The terrain mesh is not drawn
 *     on this track: these floors replace it.)
 *   - the DECK LANES (the second escalator lanes and the lower route: `deck` branches): tiled road ribbons with glass rails.
 *   - SHOPFRONTS: coloured bodies, three display windows each (a canvas atlas of 8 made-up shop scenes), striped awnings,
 *     neon-style sign boards (a canvas atlas of made-up names), product crates; POSTERS (abstract ads with made-up mascots)
 *     on the columns and the walls.
 *   - PALMS in round planters (pinnate fronds; from the scenery plan, solid), FLOWER PLANTERS, festive STRING LIGHTS on wires.
 *   - the GARDEN: lawns with stone edging and hedges, flower beds, grass patches on the road, the FOUNTAIN (a round water
 *     surface in a rim, two tiered stone fountains with jets and a spray of droplets).
 *   - the PARKING DECK: bays, parapets, hedges, lamp posts, garage gates with roll-up doors and "P" signs, parked cars of three
 *     body shapes, the city behind.
 *
 * Cost: about 40 draw calls (instancing for palms, columns, cars, lamps, bulbs, planters; static ribbons merged per material).
 * The escalators and the guide robot are drawn by render/hazards/escalatorView.ts, the moving cars by carView.ts.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { planScenery } from '../../track/sceneryPlan';
import { allRoadSamples, insidePolygon, segDist, type MallPlan, type SlabSpan } from '../../track/mallPlan';
import { CURB_WIDTH, type Track, type TrackSample } from '../../sim/track';
import { grassMaps } from '../textures';
import { ENV_TIME } from './materials';
import { blobGeo, fromArrays, latheGeo, matrix, merge, paint, ribbonGeo, tubeGeo } from './geo';
import { boxPart } from './parts';
import { noise3 } from './noise';
import type { RibbonTools } from './rainbow';
import { buildShell, SHOP_ZONE } from './mallShell';
import { awningAtlas, canvas, displayAtlas, hedgeTexture, PALETTE, rand, tex, waterTexture } from './mallStyle';

/** Does this track use the shopping-mall look? */
export const isMall = (track: Track): boolean => track.def.scenery.mall !== undefined;


const _c = new THREE.Color();

// ---------------------------------------------------------------------------------------------
// Textures (canvas)
// ---------------------------------------------------------------------------------------------

/**
 * The mall's road: large polished sandstone tiles (4 across the road, 3 per 12 m) with a soft sheen on each, dark grout, a
 * teal band with a white line along each edge and a dashed gold inlay down the middle (the "lane line" of an indoor floor).
 */
export function mallRoadTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 384);
  const rnd = rand(11);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      const k = 218 + Math.floor(rnd() * 14);
      const grd = g.createLinearGradient(i * 128, j * 128, i * 128 + 128, j * 128 + 128);
      grd.addColorStop(0, `rgb(${k + 14},${k - 14},${k - 62})`);
      grd.addColorStop(1, `rgb(${k - 6},${k - 38},${k - 92})`);
      g.fillStyle = grd;
      g.fillRect(i * 128, j * 128, 128, 128);
      // marble veins
      g.strokeStyle = 'rgba(150,110,80,0.2)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(i * 128 + rnd() * 128, j * 128);
      g.bezierCurveTo(i * 128 + rnd() * 128, j * 128 + 40, i * 128 + rnd() * 128, j * 128 + 90, i * 128 + rnd() * 128, j * 128 + 128);
      g.stroke();
    }
  }
  g.fillStyle = 'rgba(92,64,44,0.75)';
  for (let i = 0; i <= 4; i++) g.fillRect(i * 128 - 1.5, 0, 3, 384);
  for (let j = 0; j <= 3; j++) g.fillRect(0, j * 128 - 1.5, 512, 3);
  // Edge bands (deep teal stone with a white line) and the gold centre inlay.
  for (const x of [0, 490]) {
    g.fillStyle = '#157f86';
    g.fillRect(x, 0, 22, 384);
    g.fillStyle = '#f4f7f2';
    g.fillRect(x + (x ? 4 : 16), 0, 3, 384);
  }
  g.fillStyle = '#e0a02c';
  for (let j = 0; j < 3; j++) g.fillRect(249, j * 128 + 22, 14, 84);
  return tex(c);
}

/** Floor tiles for the walkways and the ground floor (2 m tiles, 8 per texture: repeat it every 16 m): a two-tone checker with sheen. */
function floorTexture(base: [number, number, number], seed: number): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const rnd = rand(seed);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const f = (i + j) % 2 ? 0.86 : 1;
      const k = (rnd() - 0.5) * 12;
      const x = i * 32;
      const y = j * 32;
      const grd = g.createLinearGradient(x, y, x + 32, y + 32);
      grd.addColorStop(0, `rgb(${ch((base[0] + k) * f * 1.06)},${ch((base[1] + k) * f * 1.06)},${ch((base[2] + k) * f * 1.06)})`);
      grd.addColorStop(1, `rgb(${ch((base[0] + k) * f * 0.92)},${ch((base[1] + k) * f * 0.9)},${ch((base[2] + k) * f * 0.88)})`);
      g.fillStyle = grd;
      g.fillRect(x, y, 32, 32);
    }
  }
  g.fillStyle = 'rgba(70,46,32,0.8)';
  for (let i = 0; i <= 8; i++) {
    g.fillRect(i * 32 - 1, 0, 2, 256);
    g.fillRect(0, i * 32 - 1, 256, 2);
  }
  return tex(c);
}

/** Asphalt with painted parking-bay lines (one bay = 3 m; the texture is 12 m square), a yellow aisle line and an arrow. */
function lotTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const rnd = rand(5);
  g.fillStyle = '#51545a';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1600; i++) {
    const k = 62 + Math.floor(rnd() * 40);
    g.fillStyle = `rgba(${k},${k},${k + 4},0.5)`;
    g.fillRect(rnd() * 256, rnd() * 256, 2, 2);
  }
  g.fillStyle = 'rgba(255,255,250,0.95)';
  for (let i = 0; i < 4; i++) g.fillRect(i * 64 + 30, 0, 5, 112);
  for (let i = 0; i < 4; i++) g.fillRect(i * 64 + 30, 144, 5, 112);
  g.fillStyle = '#f2c230';
  g.fillRect(0, 126, 256, 4); // aisle line
  g.fillStyle = 'rgba(255,255,250,0.9)'; // a small arrow in the aisle
  g.beginPath();
  g.moveTo(40, 122);
  g.lineTo(76, 128);
  g.lineTo(40, 134);
  g.fill();
  return tex(c);
}

/** Original, made-up store names for the sign boards (no real brands). The last board is the mall's own name for its gates. */
const STORE_NAMES = ['Sunny Sips', 'Pixel Pals', 'Kiwi & Co.', 'Moonbeam Books', 'Zippy Shoes', 'Cloud Cones', 'Bloom Room', 'Gadget Grove', 'Tidal Tees', 'Puffin Pops', 'Velvet Boutique', 'Maple Mugs', 'Comet Toys', 'Lemon Loft', 'Breeze Bikes', 'Honey Hats', 'PALM PLAZA'];
const SIGN_COLORS = PALETTE;
const GATE_SIGN = 16;

/**
 * Sign atlas: 2 columns x 9 rows of 256 x 64 boards. Every third board is a dark NEON board (glowing coloured letters in a
 * tube frame); the others are bright panels with a made-up logo. Returns the texture and the UV rectangle of board i.
 */
function signAtlas(): { map: THREE.CanvasTexture; uv: (i: number) => [number, number, number, number] } {
  const [c, g] = canvas(512, 576);
  STORE_NAMES.forEach((name, i) => {
    const x = (i % 2) * 256;
    const y = Math.floor(i / 2) * 64;
    const col = SIGN_COLORS[i % SIGN_COLORS.length];
    const neon = i % 3 === 1 || i === GATE_SIGN;
    g.fillStyle = neon ? '#17112b' : '#fbfaf7';
    g.fillRect(x, y, 256, 64);
    if (neon) {
      g.strokeStyle = col;
      g.lineWidth = 4;
      g.shadowColor = col;
      g.shadowBlur = 10;
      g.strokeRect(x + 5, y + 5, 246, 54);
      g.fillStyle = '#ffffff';
      g.font = 'bold 30px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(name, x + 128, y + 34, 226);
      g.shadowBlur = 0;
      return;
    }
    g.fillStyle = col;
    g.fillRect(x + 4, y + 4, 248, 56);
    // A little made-up logo: a circle with a star.
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
  return { map, uv: (i) => [((i % 2) * 256) / 512, 1 - (Math.floor(i / 2) * 64 + 64) / 576, 256 / 512, 64 / 576] };
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

/** Number of car body shapes: 0 hatchback, 1 saloon, 2 SUV. */
export const CAR_SHAPES = 3;
/** Wheel radius (m) and the wheels' places on a car (x, z), for the moving cars' turning wheels (see carView.ts). */
export const WHEEL_R = 0.36;
export const WHEEL_SPOTS: [number, number][] = [[-0.86, 1.35], [0.86, 1.35], [-0.86, -1.35], [0.86, -1.35]];

/** One tyre with a bright rim (axis along x, centred on the origin). */
export function carWheelGeometry(simple = false): THREE.BufferGeometry {
  const tyre = new THREE.Color('#1c1c1e');
  const rim = new THREE.Color('#cfd5dc');
  // (The parked cars only get a plain 8-sided tyre: they are many and their wheels do not turn.)
  if (simple) return paint(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.3, 8).deleteAttribute('uv').rotateZ(Math.PI / 2), () => tyre);
  return merge([
    paint(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.3, 10).deleteAttribute('uv').rotateZ(Math.PI / 2), () => tyre),
    paint(new THREE.CylinderGeometry(0.2, 0.2, 0.34, 6).deleteAttribute('uv').rotateZ(Math.PI / 2), () => rim),
    // spokes (a cross) so the turning shows
    boxPart(0, 0, 0, 0.36, 0.06, 0.34, rim, 0, 1),
    boxPart(0, 0, 0, 0.36, 0.34, 0.06, rim, 0, 1),
  ]);
}

/** The head and tail lights of a moving car (HDR colours: they glow and bloom). Drawn with a MeshBasicMaterial. */
export function carLightGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    parts.push(boxPart(sx * 0.62, 0.74, 2.21, 0.4, 0.16, 0.05, new THREE.Color(3.2, 3, 2.2), 0, 1));
    parts.push(boxPart(sx * 0.62, 0.74, -2.21, 0.4, 0.14, 0.05, new THREE.Color(2.8, 0.25, 0.2), 0, 1));
  }
  return merge(parts);
}

/**
 * A simple, original car (about 4.4 x 1.9 m, facing +z). `shape`: 0 hatchback, 1 saloon, 2 SUV. The body is painted WHITE so an
 * InstancedMesh's per-instance colour tints it (glass, bumpers and tyres stay dark). `wheels` = false leaves the wheels out
 * (the moving cars draw their own turning wheels, see carWheelGeometry).
 */
export function carGeometry(shape = 0, wheels = true): THREE.BufferGeometry {
  const white = new THREE.Color('#f4f4f4');
  const glass = new THREE.Color('#26303c');
  const dark = new THREE.Color('#2a2c31');
  const parts: THREE.BufferGeometry[] = [];
  if (shape === 0) {
    // Hatchback: a short cabin and a sloping rear window.
    parts.push(boxPart(0, 0.62, 0, 1.9, 0.62, 4.4, white, 0, 0.8));
    parts.push(boxPart(0, 1.16, -0.35, 1.66, 0.5, 2.3, glass, 0, 0.95));
    parts.push(boxPart(0, 1.43, -0.35, 1.5, 0.06, 2.0, white, 0, 1));
  } else if (shape === 1) {
    // Saloon: a lower cabin with a separate boot.
    parts.push(boxPart(0, 0.58, 0, 1.9, 0.56, 4.4, white, 0, 0.8));
    parts.push(boxPart(0, 1.08, -0.1, 1.64, 0.44, 2.1, glass, 0, 0.95));
    parts.push(boxPart(0, 1.32, -0.1, 1.48, 0.06, 1.7, white, 0, 1));
    parts.push(boxPart(0, 0.9, -1.75, 1.8, 0.1, 0.8, white, 0, 1)); // boot lid
  } else {
    // SUV: tall and boxy with a roof rack.
    parts.push(boxPart(0, 0.8, 0, 1.96, 0.9, 4.4, white, 0, 0.8));
    parts.push(boxPart(0, 1.5, -0.3, 1.8, 0.58, 2.9, glass, 0, 0.95));
    parts.push(boxPart(0, 1.82, -0.3, 1.7, 0.06, 2.7, white, 0, 1));
    for (const sx of [-1, 1]) parts.push(boxPart(sx * 0.7, 1.9, -0.3, 0.06, 0.06, 2.4, dark, 0, 1));
  }
  // Bumpers, grille (the moving cars add glowing lamps, see carLightGeometry; there are many parked cars, so no more detail).
  parts.push(boxPart(0, 0.34, 2.2, 1.86, 0.2, 0.12, dark, 0, 1));
  parts.push(boxPart(0, 0.34, -2.2, 1.86, 0.2, 0.12, dark, 0, 1));
  parts.push(boxPart(0, 0.66, 2.2, 0.9, 0.18, 0.05, dark, 0, 1));
  if (wheels) {
    const w = carWheelGeometry(true);
    for (const [x, z] of WHEEL_SPOTS) parts.push(w.clone().translate(x, WHEEL_R, z));
    w.dispose();
  }
  return merge(parts);
}

/** Car paint colours (InstancedMesh instance colours). */
export const CAR_COLORS = ['#e63946', '#1d6fd1', '#f4d35e', '#ffffff', '#2a9d8f', '#3d3d45', '#ff8fab', '#7b2cbf'];

/**
 * A palm in a round white planter (planter radius ~1.3 m, palm ~7 m tall), facing any way. Pinnate fronds: a curved midrib with
 * a pair of narrow leaflets at each station, drooping towards the tip (single triangles, drawn double-sided).
 */
function palmGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(latheGeo([[0, 0], [1.3, 0], [1.35, 0.9], [1.2, 0.95], [1.0, 0.85], [0, 0.85]], 10), (p) => (p.y > 0.8 && Math.hypot(p.x, p.z) < 1.15 ? _c.set('#6b4a2f') : _c.set('#f1ede4'))));
  // Trunk: a gently curved tube with ring bands.
  const path = [new THREE.Vector3(0, 0.8, 0), new THREE.Vector3(0.15, 2.6, 0.05), new THREE.Vector3(0.45, 4.6, 0.1), new THREE.Vector3(0.8, 6.4, 0.15)];
  parts.push(paint(tubeGeo(path, [0.3, 0.26, 0.22, 0.2], 7), (p) => _c.set('#8a6a46').multiplyScalar(0.8 + 0.25 * (Math.sin(p.y * 9) > 0 ? 1 : 0))));
  const top = path[path.length - 1];
  const STATIONS = 5;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + (k % 2) * 0.2;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    const len = k % 2 ? 3.4 : 4.0;
    const droop = k % 2 ? 2.7 : 2.2;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= STATIONS; i++) {
      const u = i / STATIONS;
      pts.push(top.clone().addScaledVector(dir, u * len).add(new THREE.Vector3(0, (k % 2 ? 0.2 : 0.8) * u - droop * u * u, 0)));
    }
    const green = k % 2 ? '#2f8f3a' : '#43b04c';
    // The midrib.
    parts.push(paint(ribbonGeo(pts, [0.07, 0.1, 0.1, 0.08, 0.05, 0.02], perp), () => _c.set('#7c8a3c')));
    // Leaflets: a pair per station, longest in the middle of the frond.
    for (let i = 1; i <= STATIONS; i++) {
      const u = i / STATIONS;
      const L = 0.5 + 0.95 * Math.sin(Math.PI * Math.min(1, u * 0.92)) ** 0.7;
      const base = pts[i];
      for (const side of [-1, 1]) {
        const tip = base.clone().addScaledVector(perp, side * L).addScaledVector(dir, 0.55 * L).add(new THREE.Vector3(0, -0.55 * L, 0));
        const b0 = base.clone().addScaledVector(dir, -0.2);
        const b1 = base.clone().addScaledVector(dir, 0.2);
        const tri = fromArrays([b0.x, b0.y, b0.z, b1.x, b1.y, b1.z, tip.x, tip.y, tip.z], [0, 1, 2]);
        parts.push(paint(tri, (p) => _c.set(green).multiplyScalar(0.75 + 0.35 * Math.min(1, Math.max(0, (p.y - top.y + 2.6) / 2.6)))));
      }
    }
  }
  // Coconuts.
  for (let k = 0; k < 2; k++) parts.push(paint(blobGeo(0, k + 2, 0.05, 1, noise3).applyMatrix4(matrix(top.x + Math.cos(k * 2.1) * 0.3, top.y - 0.3, top.z + Math.sin(k * 2.1) * 0.3, 0.2)), () => _c.set('#5a4022')));
  return merge(parts);
}

/** A low stone planter box full of bright flowers (1.8 x 0.8 m, facing any way); the flower colours are baked in. */
function planterGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [boxPart(0, 0.35, 0, 1.8, 0.7, 0.8, new THREE.Color('#f1ece2')), boxPart(0, 0.72, 0, 1.6, 0.08, 0.6, new THREE.Color('#5a3d28'))];
  const rnd = rand(4);
  const bloom = (x: number, y: number, z: number, r: number, color: string) => parts.push(paint(new THREE.SphereGeometry(1, 4, 2).deleteAttribute('uv').scale(r, r, r).translate(x, y, z), () => _c.set(color)));
  for (let k = 0; k < 5; k++) bloom((rnd() - 0.5) * 1.5, 0.82, (rnd() - 0.5) * 0.5, 0.22, '#2f9a47');
  for (let k = 0; k < 9; k++) bloom((rnd() - 0.5) * 1.5, 0.98 + rnd() * 0.22, (rnd() - 0.5) * 0.5, 0.13 + rnd() * 0.07, PALETTE[Math.floor(rnd() * PALETTE.length)]);
  return merge(parts);
}

/** A round flower bed for the lawns (about 2.4 m across): green mound with many bright blooms. */
function bedGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [paint(new THREE.SphereGeometry(1, 7, 2, 0, Math.PI * 2, 0, Math.PI / 2).deleteAttribute('uv').scale(1.25, 0.45, 1.25), () => _c.set('#2e8f43'))];
  const rnd = rand(8);
  const main = PALETTE[Math.floor(rnd() * PALETTE.length)];
  for (let k = 0; k < 14; k++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * 1.05;
    const y = 0.45 * Math.sqrt(Math.max(0, 1 - (r / 1.25) ** 2)) + 0.05;
    const color = rnd() < 0.6 ? main : PALETTE[Math.floor(rnd() * PALETTE.length)];
    parts.push(paint(new THREE.SphereGeometry(1, 4, 2).deleteAttribute('uv').scale(0.2, 0.2, 0.2).translate(Math.cos(a) * r, y, Math.sin(a) * r), () => _c.set(color)));
  }
  return merge(parts);
}

/** A three-tier stone fountain (about 5 m tall, base radius 2.3 m) with water in each bowl and a gold finial. */
function fountainGeometry(): { geo: THREE.BufferGeometry; top: number } {
  const stone = new THREE.Color('#efe7d6');
  const water = new THREE.Color('#58c3ee');
  const gold = new THREE.Color('#f2b632');
  const bowl = (profile: [number, number][], level: number, rWater: number) =>
    paint(latheGeo(profile, 20), (p) => (Math.abs(p.y - level) < 0.001 && Math.hypot(p.x, p.z) < rWater ? water : stone));
  const parts = [
    bowl([[0, 0], [2.3, 0], [2.4, 0.15], [2.4, 0.95], [2.2, 1.0], [2.1, 0.75], [0, 0.75]], 0.75, 2.15),
    paint(new THREE.CylinderGeometry(0.5, 0.62, 1.7, 12).deleteAttribute('uv').translate(0, 1.6, 0), () => stone),
    bowl([[0, 2.35], [1.6, 2.5], [1.72, 2.85], [1.5, 2.9], [1.42, 2.7], [0, 2.7]], 2.7, 1.4),
    paint(new THREE.CylinderGeometry(0.3, 0.4, 1.3, 10).deleteAttribute('uv').translate(0, 3.35, 0), () => stone),
    bowl([[0, 3.85], [0.95, 4.0], [1.05, 4.3], [0.88, 4.34], [0.8, 4.15], [0, 4.15]], 4.15, 0.78),
    paint(new THREE.CylinderGeometry(0.07, 0.1, 0.9, 6).deleteAttribute('uv').translate(0, 4.6, 0), () => gold),
    paint(new THREE.SphereGeometry(0.17, 8, 6).deleteAttribute('uv').translate(0, 5.1, 0), () => gold),
  ];
  return { geo: merge(parts), top: 5.1 };
}

// ---------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------

type Edge = { d: number; h: number };

/** Droplets per fountain in the spray. */
const SPRAY = 90;
/** Seconds a droplet is in the air, and its launch speeds (m/s). */
const SPRAY_T = 1.5;

export class MallView {
  readonly group = new THREE.Group();
  private readonly water: THREE.Texture;
  /** The translucent jet columns (static: their tops are kept in userData for the spray). */
  private readonly jets: THREE.Mesh;
  /** The spray's droplets: where each fountain's top is, and each droplet's launch (angle, radial speed, vertical speed, phase). */
  private readonly spray: THREE.Points;
  private readonly sprayTops: THREE.Vector3[] = [];
  private readonly sprayLaunch: [number, number, number, number][] = [];

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
    const shellPlan = mp.shell;
    const roofY = shellPlan.roofY;
    const inRange = (s: number, from: number, to: number) => track.deltaS(track.sAt(from), s) >= 0 && track.deltaS(s, track.sAt(to)) >= 0;
    const onUpper = (p: TrackSample) => mall.upperFloor.some((r) => inRange(p.s, r.from, r.to)) && p.y > mall.upper - 0.6;
    const onDeck = (p: TrackSample) => inRange(p.s, mall.deck.from, mall.deck.to);
    const inGarden = (p: TrackSample) => inRange(p.s, mall.garden.from, mall.garden.to);
    const inSpiral = (p: TrackSample) => !!mall.spiral && track.deltaS(track.sAt(mall.spiral.from) - 4, p.s) >= 0 && track.deltaS(p.s, track.sAt(mall.spiral.to) + 4) >= 0;
    const indoors = (x: number, z: number, margin = 0) => insidePolygon(mall.building, x, z) && shellPlan.walls.every((w) => segDist(w, x, z) > margin);
    const escRanges = (def.hazards ?? []).filter((h) => h.kind === 'escalator').map((h) => [track.sAt(h.from) - 50, track.sAt(h.to) + 50]);
    const nearEsc = (s: number) => escRanges.some(([a, b]) => track.deltaS(a, s) >= 0 && track.deltaS(s, b) >= 0);
    const roads = allRoadSamples(track);
    /** Distance to the nearest road sample (main or branch) at about the same level as y. */
    const roadDist = (x: number, z: number, y: number) => {
      let best = Infinity;
      for (let i = 0; i < roads.length; i += 2) if (Math.abs(roads[i].y - y) < 5) best = Math.min(best, Math.hypot(roads[i].x - x, roads[i].z - z));
      return best;
    };
    /** Is anything of another level (a road below or above) within `r` (+ its half width) of (x, z) between heights y0 and y1? */
    const blocked = (x: number, z: number, r: number, y0: number, y1: number) => roads.some((q) => q.y >= y0 && q.y <= y1 && Math.hypot(q.x - x, q.z - z) < r + q.width / 2 + def.offroadWidth);
    /** The slab span (upper floor or deck) at main sample p, if any. */
    const spans = new Map<TrackSample, SlabSpan>();
    for (const sp of [...shellPlan.upper, ...shellPlan.deck]) spans.set(S[sp.i], sp);
    const onSlab = (p: TrackSample, d: number) => {
      const sp = spans.get(p);
      return !!sp && (d < 0 ? -d < sp.left : d < sp.right);
    };
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow = false) => {
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      m.castShadow = shadow;
      this.group.add(m);
      return m;
    };
    /** Instance `geo` at the given matrices (and colours) as one draw call. */
    const instances = (geo: THREE.BufferGeometry, mat: THREE.Material, list: [THREE.Matrix4, THREE.Color?][], shadow = false) => {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([m, c], i) => {
        mesh.setMatrixAt(i, m);
        if (c) mesh.setColorAt(i, c);
      });
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    const glowParts: THREE.BufferGeometry[] = []; // HDR vertex colours, drawn unlit (they bloom)
    /** Static ribbons and faces, merged into one mesh per material at the end (draw calls). */
    const batch = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const addB = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      if (geo.index) geo = geo.toNonIndexed();
      if (!geo.getAttribute('normal')) geo.computeVertexNormals();
      for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
      if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((geo.getAttribute('position').count) * 2), 2));
      const list = batch.get(mat) ?? [];
      list.push(geo);
      batch.set(mat, list);
    };
    const glassM = mallGlassMaterial();
    const metalM = railMetal();

    // ---- Floors -------------------------------------------------------------------------------
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of S) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const M = 90;
    // The city beyond the paving: a huge dull ground (the sky dome and fog do the rest).
    const city = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#8d877d', roughness: 1 }));
    city.position.set((minX + maxX) / 2, -0.7, (minZ + maxZ) / 2);
    this.group.add(city);
    const groundTex = floorTexture([214, 158, 116], 3);
    groundTex.repeat.set((maxX - minX + 2 * M) / 16, (maxZ - minZ + 2 * M) / 16);
    // Polished: a low roughness so the sun and the sky glint off the tiles.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX + 2 * M, maxZ - minZ + 2 * M).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.28, metalness: 0.05 }));
    ground.position.set((minX + maxX) / 2, -0.04, (minZ + maxZ) / 2);
    ground.receiveShadow = true;
    this.group.add(ground);

    // Upper-floor slabs (walkway, shops and columns stand on them; they reach as far as the plan lets them: never over a
    // road on another level), the parking deck, the ramps, the spiral and the lower route's raised start.
    const slabTex = floorTexture([226, 176, 128], 8);
    slabTex.repeat.set(4, 1);
    const slabMat = new THREE.MeshStandardMaterial({ map: slabTex, roughness: 0.3, metalness: 0.05 });
    const sideMat = new THREE.MeshStandardMaterial({ color: '#e3d6c2', roughness: 0.7 });
    /** A slab under `run`: top at the road (+ lift), `left`/`right` m wide, with faces down `drop(p)` m on both sides. */
    const slab = (run: TrackSample[], left: (p: TrackSample) => number, right: (p: TrackSample) => number, drop: (p: TrackSample) => number, mat: THREE.Material = slabMat, lift = -0.03, sides: THREE.Material = sideMat) => {
      addB(tools.ribbon(run, false, (p) => [{ d: -left(p), h: lift }, { d: right(p), h: lift }], 16), mat);
      addB(tools.ribbon(run, false, (p) => [{ d: -left(p), h: -drop(p) }, { d: -left(p), h: lift }], 8), sides);
      addB(tools.ribbon(run, false, (p) => [{ d: right(p), h: lift }, { d: right(p), h: -drop(p) }], 8), sides);
    };
    const spanL = (p: TrackSample) => spans.get(p)?.left ?? outer;
    const spanR = (p: TrackSample) => spans.get(p)?.right ?? outer;
    for (const run of tools.runs(S, (p) => onUpper(p) && spans.has(p))) slab(run, spanL, spanR, () => 0.9);
    // The ramps outside (and anything else between the floors that is not an escalator or the spiral): walls to the ground.
    for (const run of tools.runs(S, (p) => p.y > 0.4 && !onUpper(p) && !onDeck(p) && !nearEsc(p.s) && !inSpiral(p))) slab(run, () => outer + 0.6, () => outer + 0.6, (p) => p.y);
    // The spiral and the deck road still inside the building: a slab with a deep fascia (no walls to the ground: the road
    // passes over its own entry there).
    const spiralRuns = tools.runs(S, (p) => inSpiral(p));
    for (const run of tools.runs(S, (p) => inSpiral(p) || (onDeck(p) && !spans.has(p) && p.y > 0.4))) slab(run, () => outer + 0.6, () => outer + 0.6, (p) => Math.min(1.4, p.y));
    // The lower route's raised start: on the upper floor up to the kicker, then the ledge (a face down to the ground floor).
    const lowB = mall.low !== undefined ? track.branches[mall.low] : null;
    if (lowB) {
      const raised = lowB.samples.filter((p) => p.y > 1);
      const lw = lowB.samples[0].width / 2 + def.offroadWidth + 0.6;
      if (raised.length > 2) {
        // Dress the raised run like the rest of the mall instead of a plain block: colourful tiled sides (ledgeTexture)
        // and glass rails along both top edges, so it reads as a gallery walkway that ends in a jump.
        const ledgeMap = ledgeTexture();
        ledgeMap.repeat.set(3, 1); // (big tiles: the ribbon UVs span the whole run)
        const ledgeMat = new THREE.MeshStandardMaterial({ map: ledgeMap, roughness: 0.45, metalness: 0.05 });
        slab(raised, () => lw, () => lw, (p) => p.y, slabMat, -0.03, ledgeMat);
        for (const side of [-1, 1]) {
          addB(tools.ribbon(raised, false, (): Edge[] => [{ d: side * lw, h: 0 }, { d: side * lw, h: 1.05 }], 6), glassM);
          addB(tools.ribbon(raised, false, (): Edge[] => [{ d: side * lw - 0.06, h: 1.05 }, { d: side * lw + 0.06, h: 1.05 }], 6), metalM);
        }
        // The ledge's face: across the end of the raised part, from the ground to the lip (a stripe of hazard paint on top).
        const lip = raised[raised.length - 1];
        const face = new THREE.PlaneGeometry(2 * lw, lip.y).translate(0, lip.y / 2, 0).applyMatrix4(matrix(lip.x + lip.tx * 0.3, 0, lip.z + lip.tz * 0.3, 1, 1, 1, Math.atan2(lip.tx, lip.tz)));
        const faceMap = ledgeTexture();
        faceMap.repeat.set(Math.max(1, Math.round((2 * lw) / 4)), Math.max(1, Math.round(lip.y / 4)));
        addB(face, new THREE.MeshStandardMaterial({ map: faceMap, roughness: 0.45, metalness: 0.05 }));
        addB(new THREE.BoxGeometry(2 * lw, 0.2, 0.5).applyMatrix4(matrix(lip.x, lip.y - 0.05, lip.z, 1, 1, 1, Math.atan2(lip.tx, lip.tz))), new THREE.MeshStandardMaterial({ color: '#f5c518', roughness: 0.5 }));
      }
    }

    // The deck lanes' road ribbons and kerbs (the main road is drawn by trackView with the same material).
    const roadMat = new THREE.MeshStandardMaterial({ map: mallRoadTexture(), roughness: 0.3, metalness: 0.05 });
    const kerbMat = new THREE.MeshStandardMaterial({ color: '#8d99a6', roughness: 0.5 });
    for (const b of track.branches) {
      const bw = b.samples[0].width / 2;
      addB(tools.ribbon(b.samples, false, () => [{ d: -bw, h: 0.025 }, { d: bw, h: 0.025 }], 12), roadMat);
      for (const side of [-1, 1]) addB(tools.ribbon(b.samples, false, () => (side < 0 ? [{ d: -bw - CURB_WIDTH, h: 0.03 }, { d: -bw, h: 0.03 }] : [{ d: bw, h: 0.03 }, { d: bw + CURB_WIDTH, h: 0.03 }]), 3), kerbMat);
      // Glass rails where the branch has walls (same look as the main road's, see trackView).
      const off = bw + def.offroadWidth;
      for (const side of [-1, 1]) {
        for (const run of tools.runs(b.samples, (p) => (side < 0 ? p.wallLeft : p.wallRight))) {
          if (run.length < 2) continue;
          addB(tools.ribbon(run, false, (): Edge[] => [{ d: side * off, h: 0 }, { d: side * off, h: 1.15 }], 6), glassM);
          addB(tools.ribbon(run, false, (): Edge[] => [{ d: side * off - 0.06, h: 1.15 }, { d: side * off + 0.06, h: 1.15 }], 6), metalM);
        }
      }
    }

    // ---- The building shell: walls along the footprint (with gates), glass roof, sunbeams -------------------------
    const shell = buildShell({ track, group: this.group, plan: shellPlan, upper: mall.upper });

    const spiralPalms: [THREE.Matrix4][] = [];
    // ---- The spiral's sculpture column: a tall tiled column in the middle of the helix, ringed by planters -------------
    if (mall.spiral && spiralRuns.length) {
      const pts = spiralRuns.flat();
      let cx = 0;
      let cz = 0;
      for (const p of pts) {
        // Centre of curvature of each sample (the helix is a circle arc): r = 1 / curvature, towards the inside.
        const r = 1 / (p.curvature || 1e-6);
        cx += p.x + p.rx * r;
        cz += p.z + p.rz * r;
      }
      cx /= pts.length;
      cz /= pts.length;
      const colMat = new THREE.MeshStandardMaterial({ color: '#1fb6a6', roughness: 0.25, metalness: 0.35 });
      add(new THREE.CylinderGeometry(3.2, 3.6, roofY, 24, 1).translate(cx, roofY / 2, cz), colMat, true);
      // Gold rings up the column and a round planter of palms at its foot.
      const rings: THREE.BufferGeometry[] = [];
      for (let y = 3; y < roofY; y += 5.5) rings.push(new THREE.TorusGeometry(3.45, 0.18, 6, 32).rotateX(Math.PI / 2).translate(cx, y, cz));
      add(mergeGeometries(rings)!, new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.3, metalness: 0.8 }));
      add(new THREE.CylinderGeometry(9, 9.4, 0.9, 32, 1).translate(cx, 0.45, cz), new THREE.MeshStandardMaterial({ color: '#f4efe4', roughness: 0.5 }), true);
      const list: [THREE.Matrix4][] = [];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        list.push([matrix(cx + Math.cos(a) * 6.5, 0.9, cz + Math.sin(a) * 6.5, 1.1, 1.1, 1.1, a)]);
      }
      spiralPalms.push(...list);
      // Slim pillars under the helix's outer edge, where nothing passes below.
      const pillars: THREE.BufferGeometry[] = [];
      pts.forEach((p, i) => {
        if (i % 12 !== 6 || p.y < 3) return;
        for (const side of [-1, 1]) {
          const x = p.x + p.rx * side * (outer - 0.5);
          const z = p.z + p.rz * side * (outer - 0.5);
          if (blocked(x, z, 0.8, -1, p.y - 2)) continue;
          pillars.push(new THREE.CylinderGeometry(0.45, 0.5, p.y - 1.2, 10, 1).translate(x, (p.y - 1.2) / 2, z));
        }
      });
      if (pillars.length) add(mergeGeometries(pillars)!, new THREE.MeshStandardMaterial({ color: '#f5f3ee', roughness: 0.4 }), true);
    }

    // ---- Parking deck: asphalt with bays on a slab (walls to the ground), parked cars, lamps, garage gates -------------
    const lotMat = new THREE.MeshStandardMaterial({ map: lotTexture(), roughness: 0.9 });
    const hedgeMat = new THREE.MeshStandardMaterial({ map: hedgeTexture(), roughness: 1, side: THREE.DoubleSide });
    const curbMat = new THREE.MeshStandardMaterial({ color: '#d8d4ca', roughness: 0.6 });
    const palmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
    const palmGeo = palmGeometry();
    for (const run of tools.runs(S, (p) => onDeck(p) && spans.has(p))) {
      slab(run, spanL, spanR, (p) => p.y, lotMat, 0.0);
      // A parapet along both edges of the deck (a finished edge, and the city beyond).
      for (const side of [-1, 1]) {
        const e = (p: TrackSample) => (side < 0 ? -spanL(p) : spanR(p));
        addB(tools.ribbon(run, false, (p) => [{ d: e(p), h: 0 }, { d: e(p), h: 1.1 }, { d: e(p) - side * 0.4, h: 1.1 }, { d: e(p) - side * 0.4, h: 0 }], 6), curbMat);
        addB(tools.ribbon(run, false, (p) => [{ d: e(p) - side * 0.5, h: 0 }, { d: e(p) - side * 0.5, h: 1.3 }, { d: e(p) - side * 1.6, h: 1.3 }, { d: e(p) - side * 1.6, h: 0 }], 6), hedgeMat);
      }
    }
    const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.35 });
    for (let shape = 0; shape < CAR_SHAPES; shape++) {
      const list: [THREE.Matrix4, THREE.Color][] = mp.parkedCars.filter((c) => c.seed % CAR_SHAPES === shape).map((c) => [matrix(c.x, c.y, c.z, 1, 1, 1, c.rotationY), new THREE.Color(CAR_COLORS[c.color % CAR_COLORS.length])]);
      if (list.length) instances(carGeometry(shape), carMat, list, true);
    }
    if (mp.lamps.length) {
      const lampGeo = merge([paint(new THREE.CylinderGeometry(0.12, 0.16, 7, 6).deleteAttribute('uv').translate(0, 3.5, 0), () => _c.set('#7d8590')), boxPart(0, 7.05, 0.6, 0.5, 0.18, 1.5, new THREE.Color('#7d8590')), boxPart(0, 6.94, 0.9, 0.4, 0.04, 0.7, new THREE.Color(3, 2.9, 2.4), 0, 1)]);
      instances(lampGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 }), mp.lamps.map((l) => [matrix(l.x, l.y, l.z, 1, 1, 1, l.rotationY + Math.PI / 2)]));
    }
    if (mp.garages.length) {
      const parts: THREE.BufferGeometry[] = [];
      const hazard = [new THREE.Color('#f2c230'), new THREE.Color('#25262b')];
      for (const gar of mp.garages) {
        const m = matrix(gar.x, gar.y, gar.z, 1, 1, 1, gar.rotationY);
        const gp: THREE.BufferGeometry[] = [
          // local x = along the car lane (away from / toward the road), local z = along the road
          boxPart(0, gar.h / 2, 0, gar.d, gar.h, gar.w, new THREE.Color('#e6dfcf')),
          boxPart(0, gar.h + 0.25, 0, gar.d + 0.6, 0.5, gar.w + 0.6, new THREE.Color('#1fb6a6')),
          // The dark opening on both lane ends (the cars drive in and out here).
          boxPart(0, 1.3, 0, gar.d + 0.04, 2.6, 3.2, new THREE.Color('#15181c'), 0, 1),
        ];
        for (const fx of [-1, 1]) {
          const x = fx * (gar.d / 2 + 0.05);
          // A roll-up shutter pulled up at the top of the opening (ribbed), a frame, hazard stripes on both sides.
          gp.push(boxPart(x, 2.4, 0, 0.12, 0.45, 3.3, new THREE.Color('#9aa3ad'), 0, 1));
          for (let k = 0; k < 3; k++) gp.push(boxPart(x + fx * 0.02, 2.56 - k * 0.15, 0, 0.06, 0.05, 3.3, new THREE.Color('#6f7882'), 0, 1));
          for (const sz of [-1, 1]) {
            gp.push(boxPart(x, 1.3, sz * 1.72, 0.14, 2.7, 0.16, new THREE.Color('#d9d4c7'), 0, 1));
            for (let k = 0; k < 6; k++) gp.push(boxPart(x + fx * 0.03, 0.2 + k * 0.45, sz * 1.9, 0.1, 0.45, 0.3, hazard[k % 2], 0, 1));
          }
          // The glowing "P" sign above the opening.
          glowParts.push(boxPart(x + fx * 0.12, gar.h - 0.5, 0, 0.1, 1.3, 1.3, new THREE.Color(0.15, 0.45, 2.6), 0, 1).applyMatrix4(m));
          glowParts.push(boxPart(x + fx * 0.2, gar.h - 0.5, -0.1, 0.06, 0.9, 0.18, new THREE.Color(2.5, 2.5, 2.5), 0, 1).applyMatrix4(m));
          glowParts.push(boxPart(x + fx * 0.2, gar.h - 0.2, 0.1, 0.06, 0.2, 0.55, new THREE.Color(2.5, 2.5, 2.5), 0, 1).applyMatrix4(m));
          glowParts.push(boxPart(x + fx * 0.2, gar.h - 0.62, 0.1, 0.06, 0.2, 0.55, new THREE.Color(2.5, 2.5, 2.5), 0, 1).applyMatrix4(m));
        }
        parts.push(merge(gp).applyMatrix4(m));
      }
      add(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), true);
    }

    // ---- Shops, columns, posters (indoors: the upper floor and the garden) ---------------------------
    const signs = signAtlas();
    const posters = posterAtlas();
    const displays = displayAtlas();
    const awnings = awningAtlas();
    const shopParts: THREE.BufferGeometry[] = [];
    const windows: THREE.BufferGeometry[] = [];
    const awningQuads: THREE.BufferGeometry[] = [];
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
      const indoor = (onUpper(p) || inGarden(p)) && !nearEsc(p.s) && !inSpiral(p);
      if (!indoor) continue;
      for (const side of [-1, 1]) {
        const d = side * (SHOP_FRONT + SHOP_D / 2);
        const x = p.x + p.rx * d;
        const z = p.z + p.rz * d;
        if (roadDist(x, z, p.y) < SHOP_FRONT + SHOP_D / 2 - 1.5) continue;
        // On a floor (the upper floor's slab reaches that far), inside the building, nothing of another level in the way.
        if ((onUpper(p) && !onSlab(p, side * (SHOP_FRONT + SHOP_D + 0.5))) || !indoors(x, z, SHOP_W / 2 + 1) || blocked(x, z, SHOP_W / 2 + 1, p.y - 30, p.y - 1.5) || blocked(x, z, SHOP_W / 2 + 1, p.y + 1.5, p.y + 11)) continue;
        if (placedShops.some(([px, pz]) => Math.hypot(px - x, pz - z) < SHOP_W)) continue;
        placedShops.push([x, z]);
        // Facing the road: local +z points at it.
        const rot = Math.atan2(-side * p.rx, -side * p.rz);
        const m = matrix(x, p.y, z, 1, 1, 1, rot);
        const h = SHOP_ZONE - 0.4;
        _c.set(SIGN_COLORS[shopIndex % SIGN_COLORS.length]).lerp(new THREE.Color('#ffffff'), 0.5);
        shopParts.push(boxPart(0, h / 2, 0, SHOP_W, h, SHOP_D, _c.clone()).applyMatrix4(m));
        shopParts.push(boxPart(0, h - 1.2, SHOP_D / 2 + 0.15, SHOP_W + 0.2, 1.6, 0.3, new THREE.Color('#fbf8f2')).applyMatrix4(m));
        // Mullions between the display windows.
        for (const mx of [-2.2, 2.2]) shopParts.push(boxPart(mx, 2.7, SHOP_D / 2 + 0.06, 0.18, 4.4, 0.14, new THREE.Color('#d7dce2')).applyMatrix4(m));
        // Three display windows (each a different made-up shop scene), a striped awning, a few product crates in front.
        [[-4.15, 3.9], [0, 4.2], [4.15, 3.9]].forEach(([wx, ww], k) => windows.push(quad(ww, 4.2, m.clone().multiply(matrix(wx, 2.8, SHOP_D / 2 + 0.02)), displays.uv((shopIndex * 3 + k + side + 1) % 8))));
        const awn = new THREE.PlaneGeometry(SHOP_W, 1.9).rotateX(-Math.PI / 2 + 0.38);
        const au = awn.getAttribute('uv') as THREE.BufferAttribute;
        const aRect = awnings.uv(shopIndex % 8);
        for (let q = 0; q < au.count; q++) au.setXY(q, aRect[0] + au.getX(q) * aRect[2], aRect[1] + au.getY(q) * aRect[3]);
        awningQuads.push(awn.applyMatrix4(m.clone().multiply(matrix(0, 5.3, SHOP_D / 2 + 1.0))));
        for (let k = 0; k < 2; k++) {
          const bx = (rnd() - 0.5) * (SHOP_W - 3);
          shopParts.push(boxPart(bx, 0.45, SHOP_D / 2 + 1.1 + rnd() * 0.5, 0.9, 0.9, 0.9, new THREE.Color(PALETTE[Math.floor(rnd() * 8)]), rnd() * 1.5).applyMatrix4(m));
        }
        signQuads.push(quad(SHOP_W - 1.2, (SHOP_W - 1.2) / 4, m.clone().multiply(matrix(0, h - 1.2, SHOP_D / 2 + 0.32)), signs.uv(shopIndex % (STORE_NAMES.length - 1))));
        shopIndex++;
      }
    }
    if (shopParts.length) add(merge(shopParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), true);
    if (windows.length) add(mergeGeometries(windows)!, new THREE.MeshBasicMaterial({ map: displays.map, color: new THREE.Color(1.08, 1.04, 0.98) }));
    if (awningQuads.length) add(mergeGeometries(awningQuads)!, new THREE.MeshStandardMaterial({ map: awnings.map, roughness: 0.8, side: THREE.DoubleSide }), true);

    // Columns: along the outer edges of the upper-floor slabs, up to the roof (posters on the side facing the road).
    const colPos: [number, number, number, number][] = [];
    for (let i = 0; i < S.length; i += Math.round(26 / track.spacing)) {
      const p = S[i];
      if (!onUpper(p) || nearEsc(p.s)) continue;
      for (const side of [-1, 1]) {
        const d = side * (outer + 4.2);
        const x = p.x + p.rx * d;
        const z = p.z + p.rz * d;
        if (roadDist(x, z, p.y) < outer + 4 || !onSlab(p, side * (outer + 5)) || blocked(x, z, 1, -1, p.y - 1.5)) continue;
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
    // Big posters on the glass clerestory above the shops, every ~28 m along both walls.
    shell.walls.forEach((pts, wi) => {
      let next = 14 + wi * 9;
      pts.forEach((w, i) => {
        if (w.u < next) return;
        next = w.u + 28;
        posterQuads.push(quad(5.2, 5.2, matrix(w.x + w.nx * 0.08, w.y + SHOP_ZONE + 4.2, w.z + w.nz * 0.08, 1, 1, 1, Math.atan2(w.nx, w.nz)), posters.uv((i + wi) % 6)));
      });
    });
    if (posterQuads.length) add(mergeGeometries(posterQuads)!, new THREE.MeshBasicMaterial({ map: posters.map, color: new THREE.Color(1.1, 1.1, 1.1) }));
    // The mall's name over both gates (each seen from outside the gate and from inside it).
    for (const g of shell.gates) {
      for (const flip of [0, Math.PI]) signQuads.push(quad(Math.min(18, g.w - 2), Math.min(18, g.w - 2) / 4, matrix(g.x, g.y + 2.4, g.z, 1, 1, 1, g.rotY + flip).multiply(matrix(0, 0, 0.1)), signs.uv(GATE_SIGN)));
    }

    if (signQuads.length) add(mergeGeometries(signQuads)!, new THREE.MeshBasicMaterial({ map: signs.map, color: new THREE.Color(1.3, 1.3, 1.3) }));

    // ---- Palms in planters (solid: from the scenery plan) and flower planters between them -------------------------------
    const palmList: [THREE.Matrix4][] = [...mp.palms.map((pl): [THREE.Matrix4] => [matrix(pl.x, pl.y, pl.z, pl.scale, pl.scale, pl.scale, pl.rotationY)]), ...spiralPalms];
    if (palmList.length) instances(palmGeo, palmMat, palmList, true);
    {
      const list: [THREE.Matrix4][] = [];
      const pstep = Math.max(1, Math.round(34 / track.spacing));
      for (let i = Math.round(pstep / 2); i < S.length; i += pstep) {
        const p = S[i];
        if (!(onUpper(p) || inGarden(p)) || nearEsc(p.s) || inSpiral(p)) continue;
        for (const side of [-1, 1]) {
          const x = p.x + p.rx * side * (outer + 2.4);
          const z = p.z + p.rz * side * (outer + 2.4);
          if (roadDist(x, z, p.y) < outer + 1.5 || (onUpper(p) && !onSlab(p, side * (outer + 3.5))) || blocked(x, z, 1, p.y - 30, p.y - 1.5)) continue;
          list.push([matrix(x, p.y, z, 1, 1, 1, Math.atan2(p.tx, p.tz))]);
        }
      }
      if (list.length) instances(planterGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), list, true);
    }

    // ---- Festive string lights on wires across the road (indoors) ------------------------------------------------------------
    {
      const bulbs: [THREE.Matrix4, THREE.Color][] = [];
      const wire: number[] = [];
      const hues = [new THREE.Color(3, 0.6, 0.5), new THREE.Color(3, 2.4, 0.6), new THREE.Color(0.6, 2.6, 1.2), new THREE.Color(0.7, 1.4, 3.2), new THREE.Color(2.6, 0.8, 2.8)];
      for (let i = 0; i < S.length; i += Math.round(30 / track.spacing)) {
        const p = S[i];
        if (!(onUpper(p) || inGarden(p)) || nearEsc(p.s)) continue;
        const span = outer + 1.5;
        let prev: [number, number, number] | null = null;
        for (let k = 0; k <= 16; k++) {
          const u = k / 16;
          const d = -span + 2 * span * u;
          const y = p.y + 8.5 - 2.2 * (1 - (2 * u - 1) ** 2);
          const cur: [number, number, number] = [p.x + p.rx * d, y, p.z + p.rz * d];
          bulbs.push([matrix(cur[0], cur[1], cur[2], 0.16), hues[(k + i) % hues.length]]);
          if (prev) wire.push(...prev, ...cur);
          prev = cur;
        }
      }
      if (bulbs.length) {
        const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 4, 2), new THREE.MeshBasicMaterial({ color: '#ffffff' }), bulbs.length);
        bulbs.forEach(([m, c], i) => {
          mesh.setMatrixAt(i, m);
          mesh.setColorAt(i, c);
        });
        this.group.add(mesh);
        const wg = new THREE.BufferGeometry();
        wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
        this.group.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: '#35343c' })));
      }
    }

    // ---- Garden: lawns with edging and hedges, flower beds, grass patches on the road, the fountain ----------------------------
    const grass = grassMaps('#58b043');
    for (const t of [grass.map, grass.normalMap, grass.roughnessMap]) t.repeat.set(1, 1);
    const lawnMat = new THREE.MeshStandardMaterial({ ...grass, roughness: 1 });
    const LAWN = 17.5;
    for (const run of tools.runs(S, (p) => inGarden(p))) {
      for (const side of [-1, 1]) {
        addB(tools.ribbon(run, false, () => (side < 0 ? [{ d: -LAWN, h: 0.0 }, { d: -outer - 0.3, h: 0.0 }] : [{ d: outer + 0.3, h: 0.0 }, { d: LAWN, h: 0.0 }]), 8), lawnMat);
        // Stone edging next to the road, a clipped hedge at the lawn's outer edge.
        addB(tools.ribbon(run, false, () => [{ d: side * (outer + 0.3), h: 0 }, { d: side * (outer + 0.3), h: 0.3 }, { d: side * (outer + 0.95), h: 0.3 }, { d: side * (outer + 0.95), h: 0 }], 4), curbMat);
        addB(tools.ribbon(run, false, () => [{ d: side * LAWN, h: 0 }, { d: side * LAWN, h: 1.3 }, { d: side * (LAWN + 1.2), h: 1.3 }, { d: side * (LAWN + 1.2), h: 0 }], 6), hedgeMat);
      }
    }
    const patchMat = new THREE.MeshStandardMaterial({ ...grass, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const g of track.grassPatches) {
      const ss = between(track, g.s0, g.s1);
      addB(tools.ribbon(ss, false, () => [{ d: g.d0, h: 0.06 }, { d: g.d1, h: 0.06 }], 6), patchMat);
    }
    // The fountain: a round water surface where the road gaps (after the rim's kicker), a stone rim round it, two tiered fountains.
    this.water = waterTexture();
    const fs = track.sAt(mall.fountain.at);
    const ramp = track.ramps.find((r) => Math.abs(track.deltaS(r.s0, fs)) < 1);
    const poolS0 = ramp ? ramp.s1 : fs + 10;
    const poolS1 = poolS0 + mall.fountain.length;
    const mid = track.pointAt((poolS0 + poolS1) / 2);
    const poolR = mall.fountain.length / 2;
    const R = Math.max(poolR + 2, hw + 4);
    const poolMat = new THREE.MeshStandardMaterial({ map: this.water, color: '#8fdcff', transparent: true, opacity: 0.85, roughness: 0.05, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const water = new THREE.Mesh(new THREE.CircleGeometry(poolR, 40).rotateX(-Math.PI / 2), poolMat);
    water.position.set(mid.x, mid.y + 0.07, mid.z);
    water.receiveShadow = true;
    // The ripples tile every 4 m.
    const wuv = water.geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < wuv.count; k++) wuv.setXY(k, (wuv.getX(k) - 0.5) * (2 * poolR) / 4, (wuv.getY(k) - 0.5) * (2 * poolR) / 4);
    this.group.add(water);
    // A paved ring and a stone rim (the road passes through both).
    const rimParts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 56; k++) {
      const a = (k / 56) * Math.PI * 2;
      const x = mid.x + Math.cos(a) * R;
      const z = mid.z + Math.sin(a) * R;
      const pr = track.project(x, z, mid.index);
      if (Math.abs(pr.d) < outer + 0.5) continue; // the road passes through the rim
      const seg = (2 * Math.PI * R) / 56 + 0.2;
      rimParts.push(boxPart(x, mid.y + 0.45, z, 1.7, 0.9, seg, new THREE.Color('#f4efe4'), -a));
      rimParts.push(boxPart(x, mid.y + 0.95, z, 2.0, 0.12, seg + 0.1, new THREE.Color('#d9d1c0'), -a, 1));
    }
    if (rimParts.length) add(merge(rimParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }), true);
    // Two tiered fountains flank the road at the pool, each with a jet column and a spray of droplets.
    const fount = fountainGeometry();
    const jetGeo = new THREE.CylinderGeometry(0.1, 0.3, 1, 8, 1, true).translate(0, 0.5, 0);
    const jetParts: THREE.BufferGeometry[] = [];
    const fountParts: THREE.BufferGeometry[] = [];
    const spraySeed = rand(13);
    for (const side of [-1, 1]) {
      const p = track.pointAt((poolS0 + poolS1) / 2, side * (outer + 2.6));
      fountParts.push(fount.geo.clone().translate(p.x, mid.y, p.z));
      jetParts.push(jetGeo.clone().applyMatrix4(matrix(p.x, mid.y + fount.top, p.z, 1, 2.4, 1)));
      this.sprayTops.push(new THREE.Vector3(p.x, mid.y + fount.top, p.z));
      for (let k = 0; k < SPRAY; k++) this.sprayLaunch.push([spraySeed() * Math.PI * 2, 0.6 + spraySeed() * 1.8, 5.5 + spraySeed() * 2.2, k / SPRAY]);
    }
    add(merge(fountParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 }), true);
    this.jets = new THREE.Mesh(mergeGeometries(jetParts)!, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.8, 2.2), transparent: true, opacity: 0.5, depthWrite: false }));
    this.jets.userData.tops = this.sprayTops;
    this.group.add(this.jets);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.sprayLaunch.length * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.spray = new THREE.Points(sg, new THREE.PointsMaterial({ color: new THREE.Color(1.5, 1.9, 2.3), size: 0.32, transparent: true, opacity: 0.85, depthWrite: false }));
    this.spray.frustumCulled = false;
    this.group.add(this.spray);
    this.update(0);

    // Flower beds on the lawns, away from the palms and the fountain.
    {
      const list: [THREE.Matrix4, THREE.Color][] = [];
      const bstep = Math.max(1, Math.round(11 / track.spacing));
      S.forEach((p, i) => {
        if (i % bstep !== 0 || !inGarden(p)) return;
        for (const side of [-1, 1]) {
          const lat = outer + 2.6 + ((i * 7) % 3) * 1.6;
          const x = p.x + p.rx * side * lat;
          const z = p.z + p.rz * side * lat;
          if (Math.hypot(x - mid.x, z - mid.z) < R + 3) continue;
          if (mp.palms.some((pl) => Math.hypot(pl.x - x, pl.z - z) < 3.6)) continue;
          const k = 0.8 + ((i * 3) % 4) * 0.1;
          list.push([matrix(x, p.y, z, 1, 1, 1, i), new THREE.Color(k, k, k)]);
        }
      });
      if (list.length) instances(bedGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), list);
    }

    // The batched ribbons and faces: one mesh per material.
    for (const [mat, list] of batch) {
      const m = new THREE.Mesh(mergeGeometries(list)!, mat);
      m.receiveShadow = true;
      this.group.add(m);
    }

    // Everything that glows (HDR vertex colours, unlit): the garages' "P" signs.
    if (glowParts.length) add(merge(glowParts), new THREE.MeshBasicMaterial({ vertexColors: true }));
  }

  /** Animate the fountain: scrolling ripples and the spray (droplets thrown up from the tiers and falling back). */
  update(time: number): void {
    ENV_TIME.value = time;
    this.water.offset.set(time * 0.03, time * 0.05);
    const tops: THREE.Vector3[] = this.jets.userData.tops;
    const pos = this.spray.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.sprayLaunch.forEach(([a, vr, vy, phase], i) => {
      const top = tops[Math.floor(i / SPRAY)];
      const tau = ((time / SPRAY_T + phase) % 1) * SPRAY_T;
      pos.setXYZ(i, top.x + Math.cos(a) * vr * tau, top.y + vy * tau - 4.5 * tau * tau - 0.3, top.z + Math.sin(a) * vr * tau);
    });
    pos.needsUpdate = true;
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

/**
 * Tiles for the lower route's raised walkway and its ledge face: squares in the mall palette with white grout, so the
 * jump-off point looks like a decorated gallery wall instead of a plain block. Square tiles look right whichever way the
 * ribbon's UVs run.
 */
function ledgeTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#fffaf0'; // grout
  g.fillRect(0, 0, 256, 256);
  const r = rand(7);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      g.fillStyle = PALETTE[Math.floor(r() * PALETTE.length)];
      g.fillRect(i * 64 + 4, j * 64 + 4, 56, 56);
      g.fillStyle = 'rgba(255,255,255,0.18)'; // a soft highlight in the corner of each tile
      g.fillRect(i * 64 + 8, j * 64 + 8, 20, 8);
    }
  }
  return tex(c);
}
