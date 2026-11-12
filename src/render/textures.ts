/**
 * Procedural textures drawn on a 2D canvas at startup (no image files).
 * Repeating textures give the ground visible detail, which is what makes
 * speed readable on screen.
 */
import * as THREE from 'three';

/** Small deterministic random generator so textures/scenery look the same every load. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Anisotropic filtering keeps textures sharp on roads seen at a shallow angle (clamped to what the GPU supports). */
const ANISOTROPY = 8;

/**
 * Canvas textures are drawn once and cached by `key`. Every call returns a fresh
 * Texture object (callers set their own repeat/offset on it) that SHARES the one
 * drawn image, so it is uploaded to the GPU only once. Mipmaps (smaller pre-blurred
 * copies used for far-away surfaces) are generated automatically for canvas textures.
 */
const canvasCache = new Map<string, THREE.CanvasTexture>();
function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void, key?: string): THREE.CanvasTexture {
  const cached = key ? canvasCache.get(key) : undefined;
  if (cached) return cached.clone();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = ANISOTROPY;
  if (key) {
    canvasCache.set(key, tex);
    return tex.clone();
  }
  return tex;
}

// ---------------------------------------------------------------------------
// Tileable noise + height-to-normal helpers (used by the surface textures)
// ---------------------------------------------------------------------------

/**
 * Smooth "value noise" that repeats seamlessly: random values on a grid of
 * `cx` x `cy` cells, blended smoothly in between; the grid wraps around so the
 * left edge matches the right edge. Returns n*n values in 0..1.
 */
function tileNoise(n: number, cx: number, cy: number, seed: number): Float32Array {
  const rnd = seededRandom(seed);
  const grid = new Float32Array(cx * cy);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    const fy = (y / n) * cy;
    const y0 = Math.floor(fy);
    let ty = fy - y0;
    ty = ty * ty * (3 - 2 * ty);
    const ya = (y0 % cy) * cx;
    const yb = ((y0 + 1) % cy) * cx;
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * cx;
      const x0 = Math.floor(fx);
      let tx = fx - x0;
      tx = tx * tx * (3 - 2 * tx);
      const xa = x0 % cx;
      const xb = (x0 + 1) % cx;
      const top = grid[ya + xa] + (grid[ya + xb] - grid[ya + xa]) * tx;
      const bot = grid[yb + xa] + (grid[yb + xb] - grid[yb + xa]) * tx;
      out[y * n + x] = top + (bot - top) * ty;
    }
  }
  return out;
}

/** Sum several noise layers ("octaves"): [cells, weight] pairs, optionally stretched along x or y. */
function fbmField(n: number, layers: Array<[number, number]>, seed: number, stretchX = 1, stretchY = 1): Float32Array {
  const out = new Float32Array(n * n);
  let total = 0;
  layers.forEach(([cells, w], i) => {
    const f = tileNoise(n, Math.max(1, Math.round(cells * stretchX)), Math.max(1, Math.round(cells * stretchY)), seed + i * 101);
    for (let k = 0; k < out.length; k++) out[k] += f[k] * w;
    total += w;
  });
  for (let k = 0; k < out.length; k++) out[k] /= total;
  return out;
}

/**
 * A height map turned into a tangent-space normal map: where the height rises to
 * the right the normal leans left, and so on. This is what makes a flat texture
 * catch light like a bumpy surface. Wraps at the edges so it tiles.
 */
function normalCanvasFromHeight(h: Float32Array, n: number, strength: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const l = h[y * n + ((x + n - 1) % n)];
      const r = h[y * n + ((x + 1) % n)];
      const u = h[((y + n - 1) % n) * n + x];
      const d = h[((y + 1) % n) * n + x];
      // Canvas y points down while texture v points up, hence the sign on ny.
      const nx = (l - r) * strength;
      const ny = (d - u) * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * n + x) * 4;
      img.data[i] = (nx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function dataTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace; // normal/roughness data is NOT colour: no sRGB conversion
  t.anisotropy = ANISOTROPY;
  return t;
}

/** A complete material texture set. Assign to a MeshStandardMaterial: { map, normalMap, roughnessMap }. */
export interface SurfaceMaps {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  /** Roughness lives in the green channel (what MeshStandardMaterial reads); keep material.roughness = 1. */
  roughnessMap: THREE.CanvasTexture;
}

interface SurfaceSpec {
  size?: number;
  /** [cells, weight] noise layers making the height/colour variation (few cells = coarse, many = fine). */
  layers: Array<[number, number]>;
  /** Colour at low / high points of the height map. */
  low: string;
  high: string;
  /** Roughness (0 = mirror, 1 = matte) at low/high points. */
  roughLow: number;
  roughHigh: number;
  /** Bump strength for the normal map. */
  bump: number;
  /** Stretch the noise grid (>1 = finer) along x / y; small x with large y gives streaks along x (brushed metal). */
  stretchX?: number;
  stretchY?: number;
  /** Scattered flecks (pebbles / sparkles / aggregate). */
  flecks?: { count: number; color: string; size: number; alpha: number };
  /** Number of thin dark cracks. */
  cracks?: number;
  /** Extra drawing on the colour canvas after the noise (panel seams, stripes...). */
  paint?: (ctx: CanvasRenderingContext2D, n: number) => void;
  seed: number;
}

const surfaceCache = new Map<string, SurfaceMaps>();

/** Draw something so it also appears on the opposite edge if it crosses one: keeps textures seamless. */
function wrapDraw(n: number, draw: (dx: number, dy: number) => void): void {
  for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) draw(dx, dy);
}

/** Build (once, then cache) a colour + normal + roughness texture set from a recipe. */
function buildSurface(key: string, spec: SurfaceSpec): SurfaceMaps {
  const hit = surfaceCache.get(key);
  if (hit) return { map: hit.map.clone(), normalMap: hit.normalMap.clone(), roughnessMap: hit.roughnessMap.clone() };
  const n = spec.size ?? 512;
  const h = fbmField(n, spec.layers, spec.seed, spec.stretchX ?? 1, spec.stretchY ?? 1);
  // Value noise clusters around 0.5: stretch it so the full colour range is used.
  for (let i = 0; i < h.length; i++) h[i] = Math.min(1, Math.max(0, (h[i] - 0.5) * 2.2 + 0.5));

  const low = new THREE.Color(spec.low);
  const high = new THREE.Color(spec.high);
  const tmp = new THREE.Color();
  const albedo = document.createElement('canvas');
  albedo.width = albedo.height = n;
  const actx = albedo.getContext('2d')!;
  const img = actx.createImageData(n, n);
  const rough = document.createElement('canvas');
  rough.width = rough.height = n;
  const rctx = rough.getContext('2d')!;
  const rimg = rctx.createImageData(n, n);
  for (let i = 0; i < h.length; i++) {
    tmp.copy(low).lerp(high, h[i]).convertLinearToSRGB(); // Color() holds linear values; canvas wants sRGB
    img.data[i * 4] = tmp.r * 255;
    img.data[i * 4 + 1] = tmp.g * 255;
    img.data[i * 4 + 2] = tmp.b * 255;
    img.data[i * 4 + 3] = 255;
    const r = (spec.roughLow + (spec.roughHigh - spec.roughLow) * h[i]) * 255;
    rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = r;
    rimg.data[i * 4 + 3] = 255;
  }
  actx.putImageData(img, 0, 0);
  rctx.putImageData(rimg, 0, 0);

  const rnd = seededRandom(spec.seed + 7);
  if (spec.flecks) {
    const f = spec.flecks;
    actx.fillStyle = f.color;
    actx.globalAlpha = f.alpha;
    for (let i = 0; i < f.count; i++) {
      const x = rnd() * n;
      const y = rnd() * n;
      const sz = f.size * (0.5 + rnd());
      wrapDraw(n, (dx, dy) => actx.fillRect(x + dx, y + dy, sz, sz));
    }
    actx.globalAlpha = 1;
  }
  if (spec.cracks) {
    actx.strokeStyle = 'rgba(15,15,18,0.55)';
    actx.lineCap = 'round';
    rctx.strokeStyle = 'rgba(255,255,255,0.5)'; // cracks are a bit rougher
    for (let k = 0; k < spec.cracks; k++) {
      // A crack is a wandering polyline.
      let x = rnd() * n;
      let y = rnd() * n;
      let a = rnd() * Math.PI * 2;
      const pts: Array<[number, number]> = [[x, y]];
      const len = 8 + Math.floor(rnd() * 14);
      for (let i = 0; i < len; i++) {
        a += (rnd() - 0.5) * 1.1;
        x += Math.cos(a) * (6 + rnd() * 8);
        y += Math.sin(a) * (6 + rnd() * 8);
        pts.push([x, y]);
      }
      for (const [ctx, lw] of [[actx, 1.4], [rctx, 2]] as const) {
        ctx.lineWidth = lw;
        wrapDraw(n, (dx, dy) => {
          ctx.beginPath();
          pts.forEach(([px, py], i) => (i ? ctx.lineTo(px + dx, py + dy) : ctx.moveTo(px + dx, py + dy)));
          ctx.stroke();
        });
      }
      // Cracks also dent the height map (shows up in the normal map).
      for (const [px, py] of pts) {
        const ix = ((Math.round(px) % n) + n) % n;
        const iy = ((Math.round(py) % n) + n) % n;
        h[iy * n + ix] = Math.max(0, h[iy * n + ix] - 0.5);
      }
    }
  }
  spec.paint?.(actx, n);

  const map = new THREE.CanvasTexture(albedo);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = ANISOTROPY;
  const set: SurfaceMaps = { map, normalMap: dataTexture(normalCanvasFromHeight(h, n, spec.bump)), roughnessMap: dataTexture(rough) };
  surfaceCache.set(key, set);
  return { map: map.clone(), normalMap: set.normalMap.clone(), roughnessMap: set.roughnessMap.clone() };
}

// ---------------------------------------------------------------------------
// Surface sets with normal + roughness maps. Use these on MeshStandardMaterial:
//   new THREE.MeshStandardMaterial({ ...asphaltMaps(), roughness: 1 })
// (`roughness: 1` because the roughness map already holds the value.)
// Set .repeat on each of the three maps (same value) to tile them.
// ---------------------------------------------------------------------------

/** Fine-grained asphalt with subtle cracks (no lane markings; roadTexture has those). */
export function asphaltMaps(): SurfaceMaps {
  return buildSurface('asphalt', {
    layers: [[8, 0.2], [32, 0.2], [96, 0.3], [200, 0.3]], low: '#34373e', high: '#575c66', roughLow: 0.82, roughHigh: 0.95, bump: 2.4,
    flecks: { count: 2600, color: '#9aa0aa', size: 1.6, alpha: 0.35 }, cracks: 5, seed: 31,
  });
}
/** Grass in any base colour: blades of lighter/darker green. */
export function grassMaps(base = '#5fae4a'): SurfaceMaps {
  const c = new THREE.Color(base);
  return buildSurface(`grass:${base}`, {
    layers: [[6, 0.2], [24, 0.25], [90, 0.3], [180, 0.25]], low: `#${c.clone().multiplyScalar(0.72).getHexString()}`,
    high: `#${c.clone().offsetHSL(0.01, 0.02, 0.1).getHexString()}`, roughLow: 0.85, roughHigh: 0.95, bump: 1.6,
    flecks: { count: 1800, color: `#${c.clone().offsetHSL(0.02, 0, 0.18).getHexString()}`, size: 2, alpha: 0.35 }, seed: 41,
  });
}
/** Packed dirt with pebbles. */
export function dirtMaps(): SurfaceMaps {
  return buildSurface('dirt', {
    layers: [[6, 0.25], [24, 0.25], [80, 0.25], [180, 0.25]], low: '#7b5c37', high: '#b08d5c', roughLow: 0.88, roughHigh: 1, bump: 3,
    flecks: { count: 900, color: '#d8c29a', size: 2.4, alpha: 0.5 }, seed: 51,
  });
}
/** Snow: almost white, slightly blue in the dips, with a few sparkles. */
export function snowMaps(): SurfaceMaps {
  return buildSurface('snow', {
    layers: [[5, 0.4], [18, 0.35], [70, 0.25]], low: '#cfdcec', high: '#ffffff', roughLow: 0.5, roughHigh: 0.7, bump: 1.2,
    flecks: { count: 500, color: '#ffffff', size: 1.4, alpha: 0.9 }, seed: 61,
  });
}
/** Rock: coarse chunky bumps with a grey-brown colour. */
export function rockMaps(): SurfaceMaps {
  return buildSurface('rock', {
    layers: [[3, 0.35], [8, 0.3], [24, 0.2], [64, 0.15]], low: '#4c4540', high: '#9a9086', roughLow: 0.8, roughHigh: 0.98, bump: 5,
    cracks: 10, seed: 71,
  });
}
/** Brushed metal: fine streaks along x, low roughness so it reflects the sky. */
export function metalMaps(): SurfaceMaps {
  return buildSurface('metal', {
    layers: [[2, 0.2], [20, 0.4], [60, 0.4]], low: '#8d939c', high: '#d6dbe2', roughLow: 0.25, roughHigh: 0.5, bump: 0.8, stretchX: 0.06, stretchY: 4, seed: 81,
  });
}
/** Concrete: pale grey, fine pores, panel seams every half tile. */
export function concreteMaps(): SurfaceMaps {
  return buildSurface('concrete', {
    layers: [[4, 0.3], [16, 0.25], [64, 0.25], [160, 0.2]], low: '#8e9092', high: '#b9bbbd', roughLow: 0.85, roughHigh: 1, bump: 2,
    flecks: { count: 1200, color: '#5d5f62', size: 1.2, alpha: 0.35 },
    paint: (ctx, n) => {
      ctx.fillStyle = 'rgba(40,42,45,0.5)';
      for (const p of [0, n / 2]) {
        ctx.fillRect(p - 1, 0, 3, n);
        ctx.fillRect(0, p - 1, n, 3);
      }
    },
    seed: 91,
  });
}
/** Kerb stones: red/white bands along V (like curbTexture) with stone grain. */
export function kerbMaps(): SurfaceMaps {
  return buildSurface('kerb', {
    size: 256, layers: [[8, 0.3], [32, 0.35], [100, 0.35]], low: '#a8a8a8', high: '#e8e8e8', roughLow: 0.55, roughHigh: 0.8, bump: 1.6,
    paint: (ctx, n) => {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = '#ff5050';
      ctx.fillRect(0, 0, n, n / 2);
      ctx.globalCompositeOperation = 'source-over';
    },
    seed: 101,
  });
}

/** Speckled ground texture in any base color (grass, sand, ...): soft patches plus fine blades. Cached per colour/seed. */
export function grassTexture(base = '#5fae4a', seed = 1): THREE.CanvasTexture {
  return canvasTexture(
    512,
    (ctx, n) => {
      const c = new THREE.Color(base);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, n, n);
      const rnd = seededRandom(seed);
      const tmp = new THREE.Color();
      // Large soft patches (tileable: drawn at the wrapped positions too).
      for (let i = 0; i < 70; i++) {
        tmp.copy(c).offsetHSL((rnd() - 0.5) * 0.03, (rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.1);
        const x = rnd() * n;
        const y = rnd() * n;
        const r = 30 + rnd() * 60;
        for (const dx of [-n, 0, n]) {
          for (const dy of [-n, 0, n]) {
            const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
            g.addColorStop(0, `rgba(${(tmp.r * 255) | 0},${(tmp.g * 255) | 0},${(tmp.b * 255) | 0},0.35)`);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
          }
        }
      }
      // Fine flecks and short blade strokes.
      for (let i = 0; i < 9000; i++) {
        tmp.copy(c).offsetHSL((rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.16);
        ctx.fillStyle = `#${tmp.getHexString()}`;
        ctx.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 2, 2 + rnd() * 3);
      }
    },
    `grass:${base}:${seed}`,
  );
}

/**
 * Road texture laid out with U across the road (0 = left edge, 1 = right edge)
 * and V along it. Fine asphalt grain, tyre-polished darker lanes, a few hairline
 * cracks, white edge lines and a dashed center line (slightly worn).
 */
export function roadTexture(): THREE.CanvasTexture {
  return canvasTexture(
    512,
    (ctx, n) => {
      ctx.fillStyle = '#464a53';
      ctx.fillRect(0, 0, n, n);
      const rnd = seededRandom(2);
      // Broad tonal variation.
      for (let i = 0; i < 40; i++) {
        const x = rnd() * n;
        const y = rnd() * n;
        const r = 40 + rnd() * 70;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const v = rnd() < 0.5 ? '0,0,0' : '255,255,255';
        g.addColorStop(0, `rgba(${v},0.05)`);
        g.addColorStop(1, `rgba(${v},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // Polished wheel tracks (slightly darker/smoother).
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(n * 0.22, 0, n * 0.12, n);
      ctx.fillRect(n * 0.66, 0, n * 0.12, n);
      // Fine aggregate grain.
      for (let i = 0; i < 16000; i++) {
        const v = 55 + Math.floor(rnd() * 60);
        ctx.fillStyle = `rgba(${v},${v + 2},${v + 8},0.7)`;
        ctx.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
      }
      // Hairline cracks.
      ctx.strokeStyle = 'rgba(15,15,20,0.45)';
      ctx.lineWidth = 1;
      for (let k = 0; k < 6; k++) {
        let x = n * (0.1 + rnd() * 0.8);
        let y = rnd() * n;
        let a = rnd() * Math.PI;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let i = 0; i < 12; i++) {
          a += (rnd() - 0.5) * 1.0;
          x += Math.cos(a) * 7;
          y += Math.sin(a) * 7;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Paint: edge lines and centre dash, with a bit of wear (speckled away).
      ctx.fillStyle = '#f3f3f1';
      ctx.fillRect(n * 0.03, 0, n * 0.025, n);
      ctx.fillRect(n * 0.945, 0, n * 0.025, n);
      ctx.fillRect(n * 0.49, 0, n * 0.02, n * 0.5);
      for (let i = 0; i < 1200; i++) {
        const v = 60 + Math.floor(rnd() * 50);
        ctx.fillStyle = `rgba(${v},${v},${v + 6},0.55)`;
        const px = rnd() < 0.5 ? n * (0.03 + rnd() * 0.025) : rnd() < 0.5 ? n * (0.945 + rnd() * 0.025) : n * (0.49 + rnd() * 0.02);
        ctx.fillRect(px, rnd() * n, 1.5, 1.5);
      }
    },
    'road',
  );
}

/** Red/white curb stripes along V, with stone grain and a darker edge line between the stripes. */
export function curbTexture(): THREE.CanvasTexture {
  return canvasTexture(
    128,
    (ctx, n) => {
      ctx.fillStyle = '#f4f4f4';
      ctx.fillRect(0, 0, n, n);
      ctx.fillStyle = '#e03a3a';
      ctx.fillRect(0, 0, n, n / 2);
      const rnd = seededRandom(5);
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.12)';
        ctx.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 2, 1 + rnd() * 2);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(0, n / 2 - 1, n, 2);
      ctx.fillRect(0, 0, n, 1);
    },
    'curb',
  );
}

export function checkerTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(64, (ctx, n) => {
    const c = n / 8;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#fafafa';
        ctx.fillRect(x * c, y * c, c, c);
      }
  });
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

/** Yellow/black chevrons for jump ramps (V along the ramp). */
export function rampTexture(base = '#f2c230', stripe = '#222'): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, n) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = stripe;
    for (let k = -1; k < 3; k++) {
      ctx.beginPath();
      const y = k * (n / 2);
      ctx.moveTo(0, y + n * 0.35);
      ctx.lineTo(n / 2, y);
      ctx.lineTo(n, y + n * 0.35);
      ctx.lineTo(n, y + n * 0.55);
      ctx.lineTo(n / 2, y + n * 0.2);
      ctx.lineTo(0, y + n * 0.55);
      ctx.fill();
    }
  });
}

/** Stacked tire barrier: alternating red/white blocks with dark tire bands. */
export function wallTexture(): THREE.CanvasTexture {
  return canvasTexture(64, (ctx, n) => {
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = '#d33';
    ctx.fillRect(0, 0, n, n / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 4; i++) ctx.fillRect(0, (i * n) / 4, n, 3);
  });
}

/** Glowing arrows for boost pads; scroll texture.offset.y to animate. */
export function boostTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, n) => {
    const g = ctx.createLinearGradient(0, 0, n, 0);
    g.addColorStop(0, '#ff6a00');
    g.addColorStop(0.5, '#ffd000');
    g.addColorStop(1, '#ff6a00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (let k = 0; k < 2; k++) {
      const y = k * (n / 2) + n * 0.1;
      ctx.beginPath();
      ctx.moveTo(n * 0.15, y + n * 0.3);
      ctx.lineTo(n / 2, y);
      ctx.lineTo(n * 0.85, y + n * 0.3);
      ctx.lineTo(n * 0.85, y + n * 0.42);
      ctx.lineTo(n / 2, y + n * 0.12);
      ctx.lineTo(n * 0.15, y + n * 0.42);
      ctx.fill();
    }
  });
}

/** Blue water with light ripple streaks (scroll offset to animate). */
export function waterTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, n) => {
    ctx.fillStyle = '#1f6fb8';
    ctx.fillRect(0, 0, n, n);
    const rnd = seededRandom(9);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(200, 235, 255, ${0.15 + rnd() * 0.3})`;
      ctx.fillRect(rnd() * n, rnd() * n, 10 + rnd() * 24, 2);
    }
  });
}

/**
 * Banner sheet for the made-up "TILT KART" brand, two designs stacked:
 *   top half    (v 0.5..1): "TILT KART" logo on blue
 *   bottom half (v 0..0.5): "FULL TILT!" on red
 * Use BANNER_LOGO / BANNER_SLOGAN as UV rectangles (see MeshBatch.add).
 */
export function bannerTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(512, (ctx, n) => {
    const row = n / 2;
    const drawRow = (y: number, bg0: string, bg1: string, text: string, fill: string) => {
      const g = ctx.createLinearGradient(0, y, n, y + row);
      g.addColorStop(0, bg0);
      g.addColorStop(1, bg1);
      ctx.fillStyle = g;
      ctx.fillRect(0, y, n, row);
      // Diagonal speed stripes in the background.
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      for (let k = -2; k < 10; k++) {
        ctx.beginPath();
        ctx.moveTo(k * 64, y + row);
        ctx.lineTo(k * 64 + 40, y);
        ctx.lineTo(k * 64 + 64, y);
        ctx.lineTo(k * 64 + 24, y + row);
        ctx.fill();
      }
      // Checkered ends.
      const c = row / 8;
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 2; i++) {
          ctx.fillStyle = (i + j) % 2 ? '#111' : '#fafafa';
          ctx.fillRect(i * c, y + j * c, c, c);
          ctx.fillRect(n - (i + 1) * c, y + j * c, c, c);
        }
      // Slanted logo text with a dark outline.
      ctx.save();
      ctx.translate(n / 2, y + row / 2);
      ctx.transform(1, 0, -0.18, 1, 0, 0);
      // Start big, then shrink the font until the text fits between the checkered ends.
      let size = Math.round(row * 0.62);
      const font = () => `900 ${size}px "Arial Black", Impact, sans-serif`;
      ctx.font = font();
      while (ctx.measureText(text).width > n - 4 * c - 40 && size > 10) {
        size -= 2;
        ctx.font = font();
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = row * 0.08;
      ctx.strokeStyle = '#1a1a2e';
      ctx.strokeText(text, 0, 4);
      ctx.fillStyle = fill;
      ctx.fillText(text, 0, 4);
      ctx.restore();
    };
    drawRow(0, '#1d3fa0', '#2f7be0', 'TILT KART', '#ffd23a');
    drawRow(row, '#c62828', '#ff7a1a', 'FULL TILT!', '#ffffff');
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
export const BANNER_LOGO = { u: 0, v: 0.5, w: 1, h: 0.5 };
export const BANNER_SLOGAN = { u: 0, v: 0, w: 1, h: 0.5 };

/** Packed dirt for dirt shortcuts: brown grain, pebbles and two darker wheel ruts (no edge lines). U across the road, V along it. */
export function dirtTexture(): THREE.CanvasTexture {
  return canvasTexture(
    512,
    (ctx, n) => {
      ctx.fillStyle = '#9b7a4c';
      ctx.fillRect(0, 0, n, n);
      const rnd = seededRandom(11);
      for (let i = 0; i < 30; i++) {
        const x = rnd() * n;
        const y = rnd() * n;
        const r = 30 + rnd() * 60;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const v = rnd() < 0.5 ? '60,35,10' : '230,200,150';
        g.addColorStop(0, `rgba(${v},0.12)`);
        g.addColorStop(1, `rgba(${v},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      for (let i = 0; i < 12000; i++) {
        const v = 110 + Math.floor(rnd() * 70);
        ctx.fillStyle = `rgb(${v + 30},${v},${v - 40})`;
        ctx.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 2, 1 + rnd());
      }
      for (let i = 0; i < 260; i++) {
        // pebbles: light with a dark shadow underneath
        const x = rnd() * n;
        const y = rnd() * n;
        const r = 1 + rnd() * 2.2;
        ctx.fillStyle = 'rgba(40,25,10,0.35)';
        ctx.beginPath();
        ctx.arc(x + 1, y + 1, r, 0, 7);
        ctx.fill();
        ctx.fillStyle = `rgb(${190 + rnd() * 40},${165 + rnd() * 30},${125 + rnd() * 30})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 7);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(70,45,20,0.28)'; // wheel ruts
      ctx.fillRect(n * 0.26, 0, n * 0.1, n);
      ctx.fillRect(n * 0.64, 0, n * 0.1, n);
    },
    'dirt',
  );
}

/**
 * Chevron board for a shortcut fork: black arrowheads on a yellow board, pointing RIGHT, no text
 * (like the turn-warning signs on real mountain roads). Mirror the mesh to point left.
 * Only the top half of the square canvas is used (the board is 2:1); repeat/offset show that strip.
 */
export function chevronSignTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(256, (ctx, n) => {
    const h = n / 2;
    ctx.fillStyle = '#f2b01e';
    ctx.fillRect(0, 0, n, h);
    ctx.strokeStyle = '#161616';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, n - 8, h - 8);
    // Three arrowheads ("chevrons") pointing right.
    ctx.fillStyle = '#161616';
    for (let k = 0; k < 3; k++) {
      const x = 52 + k * 52;
      ctx.beginPath();
      ctx.moveTo(x, 22);
      ctx.lineTo(x + 30, h / 2);
      ctx.lineTo(x, h - 22);
      ctx.lineTo(x + 16, h - 22);
      ctx.lineTo(x + 46, h / 2);
      ctx.lineTo(x + 16, 22);
      ctx.fill();
    }
  });
  tex.repeat.set(1, 0.5);
  tex.offset.set(0, 0.5);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
