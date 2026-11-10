/**
 * The distant world: mountains, volcano, rolling hills, a harbour skyline and fluffy clouds.
 *
 * Distant things are never lit by the real lights. Instead their shading is BAKED into vertex
 * colours with a fixed "sun" direction (faces toward the sun are bright, faces away are darker),
 * and they are drawn with a self-lit material. That is cheaper, immune to light changes, and
 * lets us paint glowing lava veins (colours above 1.0 are simply "brighter than white").
 * Atmospheric perspective (distant things fade toward the horizon colour) is baked too:
 * the farther the ring, the more haze.
 */
import * as THREE from 'three';
import { fromArrays, merge, paint, blobGeo, matrix, scratch } from './geo';
import { fbm3, noise3, ridged3, smoothstep } from './noise';
import { ChunkBatch } from './batch';

export type BackdropKind = 'alpine' | 'volcanic' | 'meadow' | 'harbour' | 'desert' | 'autumn' | 'none';

/** Fixed light direction for baked shading (matches the sun's compass direction in scene.ts). */
const SUN = new THREE.Vector3(80, 70, 50).normalize();
const SNOW = new THREE.Color('#f7fbff');
const LAVA = new THREE.Color(5.0, 1.5, 0.25);
const LAVA_DIM = new THREE.Color(2.2, 0.55, 0.12);

interface MountainOpts {
  kind: BackdropKind;
  radius: number; // base radius (m)
  height: number; // peak height (m)
  seed: number;
  /** 0..1 fog/haze amount toward the horizon colour. */
  haze: number;
  horizon: THREE.Color;
  /** Mountain-specific rock colour. */
  rock: THREE.Color;
  rockDark: THREE.Color;
}

/** Light from the baked sun with a soft ambient floor. */
const bakedLight = (n: THREE.Vector3): number => 0.42 + 0.7 * Math.max(0, n.dot(SUN)) + 0.12 * n.y;

/**
 * One mountain: a polar grid (rings x segments) whose radius wobbles with noise and whose
 * height follows a peaked profile with ridged-noise crags. Shared vertices -> smooth normals.
 */
export function mountainGeo(o: MountainOpts, rings = 16, segs = 40): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const volcano = o.kind === 'volcanic';
  const baseY = -8;
  const hAt = (rho: number, a: number): number => {
    // rho 0 = peak, 1 = base. Rock crags are stronger near the top for alpine peaks.
    const cx = Math.cos(a) * rho;
    const cz = Math.sin(a) * rho;
    const prof = Math.pow(1 - rho, o.kind === 'alpine' ? 1.15 : volcano ? 0.9 : 1.5);
    let h = o.height * prof;
    const crag = ridged3(cx * 3.1 + o.seed, cz * 3.1, rho * 2.3, o.seed, 3);
    if (o.kind === 'alpine') h *= 0.78 + 0.4 * crag;
    else if (volcano) h *= 0.9 + 0.18 * (crag - 0.5);
    else h *= 0.92 + 0.16 * fbm3(cx * 2, cz * 2, 0, o.seed, 3);
    if (volcano) {
      // flat-topped cone with a bowl: crater lip at rho ~ 0.14
      const lip = smoothstep(0.0, 0.16, rho);
      h = h * (0.65 + 0.35 * lip) - o.height * 0.12 * (1 - lip) * (1 - lip) * 3 * (1 - rho * 2 > 0 ? 1 : 0);
    }
    if (o.kind === 'desert') h = Math.min(h, o.height * 0.55) * (rho < 0.5 ? 1 : 1) + 0;
    return h + baseY;
  };
  for (let i = 0; i <= rings; i++) {
    const rho = i / rings;
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const wob = 1 + 0.22 * (fbm3(Math.cos(a) * 1.4 + o.seed, Math.sin(a) * 1.4, 0, o.seed, 2) - 0.5);
      const r = rho * o.radius * wob;
      pos.push(Math.cos(a) * r, hAt(rho, a), Math.sin(a) * r);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j;
      const b = i * segs + ((j + 1) % segs);
      const c = (i + 1) * segs + j;
      const d = (i + 1) * segs + ((j + 1) % segs);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = fromArrays(pos, idx);
  const horizon = o.horizon;
  paint(g, (p, n) => {
    const hN = THREE.MathUtils.clamp((p.y - baseY) / o.height, 0, 1);
    const grain = fbm3(p.x * 0.05, p.y * 0.05, p.z * 0.05, o.seed + 3, 3);
    const strat = noise3(p.x * 0.02, p.y * 0.35, p.z * 0.02, o.seed + 8);
    scratch.copy(o.rockDark).lerp(o.rock, THREE.MathUtils.clamp(0.35 + hN * 0.6 + (grain - 0.5) * 0.9 + (strat - 0.5) * 0.3, 0, 1));
    const flat = n.y;
    if (o.kind === 'alpine' || o.kind === 'meadow' || o.kind === 'autumn') {
      // Snow: high up and on gentle slopes, ragged edge from noise. Forest-green skirt low down.
      const edge = 0.52 + (grain - 0.5) * 0.35 - (1 - flat) * 0.25;
      const snow = smoothstep(edge, edge + 0.12, hN) * (o.kind === 'meadow' || o.kind === 'autumn' ? (o.height > 120 ? 1 : 0) : 1);
      scratch.lerp(SNOW, snow);
      if (hN < 0.3) scratch.lerp(new THREE.Color('#3d6b4a'), (1 - hN / 0.3) * 0.6 * (o.kind === 'alpine' ? 0.7 : 1));
    }
    scratch.multiplyScalar(bakedLight(n));
    if (volcano) {
      // Lava veins running down from the crater: bright where ridged noise creases.
      const ang = Math.atan2(p.z, p.x);
      const vein = smoothstep(0.78, 0.92, ridged3(Math.cos(ang) * 5 + p.y * 0.01, Math.sin(ang) * 5, p.y * 0.04, o.seed + 40, 3));
      const nearTop = smoothstep(0.35, 0.9, hN);
      const rim = smoothstep(0.82, 0.96, hN);
      scratch.lerp(LAVA_DIM, vein * nearTop * 0.9);
      scratch.lerp(LAVA, rim * (0.5 + 0.5 * vein));
    }
    // Atmospheric haze: the lower and farther, the more horizon colour.
    const fade = THREE.MathUtils.clamp(1 - hN * 1.1, 0, 1);
    scratch.lerp(horizon, THREE.MathUtils.clamp(o.haze + fade * fade * 0.55, 0, 0.97));
    return scratch;
  });
  return g;
}

/** Unlit self-shaded material for backdrop meshes (fog off: haze is baked into the colours). */
export function backdropMaterial(fog = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: true, fog });
}

/** Distant city skyline blocks for the harbour: dark towers with lit windows. */
export function skylineGeo(rnd: () => number, count: number, spread: number, horizon: THREE.Color, dusk: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.deleteAttribute('uv');
  for (let i = 0; i < count; i++) {
    const w = 14 + rnd() * 26;
    const h = 30 + rnd() * rnd() * 150;
    const d = 14 + rnd() * 26;
    const g = box.clone();
    const seed = rnd() * 100;
    paint(g, (p, n) => {
      const y01 = p.y + 0.5;
      scratch.set('#5b6b86').lerp(new THREE.Color('#8e9fbc'), rnd() * 0 + 0.3 * y01);
      scratch.multiplyScalar(0.55 + 0.4 * Math.max(0, n.dot(SUN)) + 0.12 * n.y);
      // window grid on the side faces, lit at dusk
      if (Math.abs(n.y) < 0.5) {
        const u = (Math.abs(n.x) > 0.5 ? p.z : p.x) * w * 0.5;
        const wx = Math.floor((u + 50) / 3.2);
        const wy = Math.floor(y01 * h / 4);
        const lit = noise3(wx * 3.1 + seed, wy * 2.3, seed, 3) > (dusk ? 0.42 : 0.9);
        const inWin = ((u + 50) % 3.2) < 1.7 && ((y01 * h) % 4) < 2.2 && y01 * h > 3;
        if (inWin && lit) scratch.set(dusk ? '#ffd48a' : '#9fc4ea').multiplyScalar(dusk ? 2.2 : 1);
      }
      scratch.lerp(horizon, 0.45);
      return scratch;
    });
    const a = rnd() * 0.9 - 0.45;
    g.applyMatrix4(matrix((rnd() - 0.5) * spread, h / 2 - 5, (rnd() - 0.5) * 60, w, h, d, a));
    parts.push(g);
  }
  box.dispose();
  return merge(parts);
}

/**
 * Fluffy cumulus: a flat-bottomed heap of overlapping smooth blobs. Baked shading: bright white
 * tops, soft blue-grey bellies. Positions inside the returned geometry are cloud-local.
 */
export function cloudGeo(rnd: () => number, size: number, belly: THREE.Color, tint: THREE.Color): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const puffs = 5 + Math.floor(rnd() * 4);
  for (let k = 0; k < puffs; k++) {
    const t = puffs > 1 ? k / (puffs - 1) - 0.5 : 0;
    const s = size * (1 - Math.abs(t) * 0.85) * (0.7 + rnd() * 0.45);
    const g = blobGeo(2, k + Math.floor(rnd() * 50), 0.14, 1.3, noise3);
    g.applyMatrix4(matrix(t * size * 2.8, s * 0.2 + rnd() * size * 0.15, (rnd() - 0.5) * size * 0.7, s * 1.15, s * 0.62, s * 0.95));
    parts.push(g);
  }
  const m = merge(parts.map((g) => paint(g, () => scratch.set('#ffffff'))));
  const pos = m.getAttribute('position');
  const nor = m.getAttribute('normal');
  const col = m.getAttribute('color') as THREE.BufferAttribute;
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nor, i);
    // Flatten the bottoms.
    if (pos.getY(i) < 0) pos.setY(i, pos.getY(i) * 0.35);
    const lit = THREE.MathUtils.clamp(0.5 + 0.5 * n.dot(SUN) + 0.2 * n.y, 0, 1);
    scratch.copy(belly).lerp(tint, lit);
    col.setXYZ(i, scratch.r, scratch.g, scratch.b);
  }
  m.computeVertexNormals();
  return m;
}

/** Rolling green/white hills for the near horizon ring (lit by the baked sun, fogged). */
export function hillGeo(radius: number, height: number, seed: number, base: THREE.Color, top: THREE.Color, horizon: THREE.Color, haze: number): THREE.BufferGeometry {
  const rings = 8;
  const segs = 24;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const rho = i / rings;
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const wob = 1 + 0.2 * (noise3(Math.cos(a) * 1.3 + seed, Math.sin(a) * 1.3, 0, seed) - 0.5);
      const h = height * Math.pow(0.5 + 0.5 * Math.cos(Math.PI * rho), 1.1) * (0.9 + 0.2 * fbm3(Math.cos(a) * rho * 2 + seed, Math.sin(a) * rho * 2, 0, seed));
      pos.push(Math.cos(a) * rho * radius * wob, h - 3, Math.sin(a) * rho * radius * wob);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j;
      const b = i * segs + ((j + 1) % segs);
      const c = (i + 1) * segs + j;
      const d = (i + 1) * segs + ((j + 1) % segs);
      idx.push(a, b, c, b, d, c);
    }
  const g = fromArrays(pos, idx);
  return paint(g, (p, n) => {
    const t = THREE.MathUtils.clamp(p.y / height, 0, 1);
    scratch.copy(base).lerp(top, t * 0.8 + (fbm3(p.x * 0.03, 0, p.z * 0.03, seed) - 0.5) * 0.5);
    scratch.multiplyScalar(bakedLight(n));
    scratch.lerp(horizon, haze);
    return scratch;
  });
}

/** Fill the far ring helper: places items on a ring around the track. */
export function ring<T>(count: number, cx: number, cz: number, dist: (i: number) => number, rnd: () => number, make: (x: number, z: number, i: number, a: number) => T): T[] {
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    const a = ((i + rnd() * 0.6) / count) * Math.PI * 2;
    const d = dist(i);
    out.push(make(cx + Math.cos(a) * d, cz + Math.sin(a) * d, i, a));
  }
  return out;
}

export { ChunkBatch };
