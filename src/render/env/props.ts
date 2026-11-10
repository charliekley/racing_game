/**
 * Nature props: trees (broadleaf, pine, palm, charred snags, cactus...), bushes, rocks,
 * grass tufts and flowers, each in a few random variants and two levels of detail.
 *
 * A "style" (meadow, harbour, volcanic, alpine, sky, desert, autumn) picks palettes and
 * which species stand in for the plan's generic tree kinds ('round', 'pine', 'poplar',
 * 'cactus'). Shapes are modelled once at scale 1 (trunk base on y = 0, base radius ~0.33 m
 * so the plan's trunk-sized colliders match) and then stamped many times by scenery.ts.
 *
 * Colours are baked per vertex: darker underneath and deep inside a crown (a cheap fake of
 * ambient occlusion, light that cannot reach), lighter on top, sun-bleached patches from
 * noise, and snow on every upward-facing surface for the alpine style.
 */
import * as THREE from 'three';
import type { TreeKind } from '../../track/sceneryPlan';
import { seededRandom } from '../textures';
import { blobGeo, col, latheGeo, matrix, merge, paint, placed, ribbonGeo, tubeGeo, type ColorFn } from './geo';
import { fbm3, noise3, ridged3, smoothstep } from './noise';

export type Style = 'meadow' | 'harbour' | 'volcanic' | 'alpine' | 'sky' | 'desert' | 'autumn';

/** Detail level: 1 = close-up model, 0 = cheap model for distant chunks. */
export type Detail = 0 | 1;

interface Palette {
  leaf: THREE.Color;
  leafLight: THREE.Color;
  pine: THREE.Color;
  trunk: THREE.Color;
  bush: THREE.Color;
  rock: THREE.Color;
  rockDark: THREE.Color;
  tuft: THREE.Color;
  tuftDark: THREE.Color;
  snow: number; // 0..1: how much snow clings to upward faces
  moss: number;
}

const P = (o: Palette) => o;
const PALETTES: Record<Style, Palette> = {
  meadow: P({ leaf: col('#4aa83a'), leafLight: col('#9bd94d'), pine: col('#2c7a45'), trunk: col('#7a5333'), bush: col('#3f9a3a'), rock: col('#a7a49a'), rockDark: col('#6f6c66'), tuft: col('#8fd24e'), tuftDark: col('#3f8a2c'), snow: 0, moss: 0.5 }),
  harbour: P({ leaf: col('#4aa05a'), leafLight: col('#93d070'), pine: col('#2a7a52'), trunk: col('#8a6440'), bush: col('#3e9658'), rock: col('#9aa0a8'), rockDark: col('#5f666f'), tuft: col('#9ac86a'), tuftDark: col('#4a8a50'), snow: 0, moss: 0.1 }),
  volcanic: P({ leaf: col('#a8431f'), leafLight: col('#e0852b'), pine: col('#3a2824'), trunk: col('#2a201e'), bush: col('#5a3326'), rock: col('#4a403f'), rockDark: col('#241c1c'), tuft: col('#8a6a48'), tuftDark: col('#3f2c24'), snow: 0, moss: 0 }),
  alpine: P({ leaf: col('#4f8f64'), leafLight: col('#8cc09a'), pine: col('#24654a'), trunk: col('#5e4330'), bush: col('#4f8863'), rock: col('#8e98a6'), rockDark: col('#566170'), tuft: col('#c9b77a'), tuftDark: col('#8a8460'), snow: 1, moss: 0 }),
  sky: P({ leaf: col('#58be44'), leafLight: col('#b6ec62'), pine: col('#33935a'), trunk: col('#8b5e3a'), bush: col('#4fb644'), rock: col('#d8c79a'), rockDark: col('#9a8660'), tuft: col('#a5e45c'), tuftDark: col('#4a9a36'), snow: 0, moss: 0.4 }),
  desert: P({ leaf: col('#8a9a4a'), leafLight: col('#c0c06a'), pine: col('#5f7a45'), trunk: col('#7a5a3a'), bush: col('#8a9a58'), rock: col('#c98d62'), rockDark: col('#8a5a3a'), tuft: col('#d0b878'), tuftDark: col('#8a7a48'), snow: 0, moss: 0 }),
  autumn: P({ leaf: col('#d0561e'), leafLight: col('#f0a030'), pine: col('#4a6a38'), trunk: col('#6a4228'), bush: col('#b0521e'), rock: col('#a09488'), rockDark: col('#6a5f56'), tuft: col('#c8a050'), tuftDark: col('#7a5a30'), snow: 0, moss: 0.2 }),
};

const _c = new THREE.Color();
const _c2 = new THREE.Color();
const SNOW = col('#f6faff');
const EMBER = col('#ff6a20');

/** Foliage shading shared by all crowns: AO from the crown centre, sunlit tops, noisy patches. */
function crownColor(pal: Palette, _cx: number, cy: number, _cz: number, rad: number, snowy = false): ColorFn {
  return (p, n) => {
    const up = THREE.MathUtils.clamp((p.y - cy) / rad * 0.5 + 0.5, 0, 1);
    const patch = fbm3(p.x * 1.6, p.y * 1.6, p.z * 1.6, 5);
    _c.copy(pal.leaf).lerp(pal.leafLight, THREE.MathUtils.clamp(up * 0.55 + (patch - 0.5) * 1.3 + Math.max(0, n.y) * 0.25, 0, 1));
    _c.multiplyScalar(0.55 + 0.5 * up + 0.08 * patch);
    if (snowy) _c.lerp(SNOW, smoothstep(0.35, 0.8, n.y + (patch - 0.5) * 0.5) * 0.9);
    return _c;
  };
}

const trunkColor = (pal: Palette, tint = 1): ColorFn => (p, n) => {
  const base = THREE.MathUtils.clamp(p.y / 2.5, 0, 1);
  const bark = noise3(p.x * 9, p.y * 3, p.z * 9, 3);
  _c.copy(pal.trunk).multiplyScalar((0.62 + 0.4 * base) * (0.86 + 0.28 * bark) * tint);
  void n;
  return _c;
};

// ---------------------------------------------------------------------------
// Broadleaf (clustered canopy blobs on a tapered, leaning trunk)
// ---------------------------------------------------------------------------

function broadleaf(v: number, d: Detail, pal: Palette, style: Style): THREE.BufferGeometry {
  const rnd = seededRandom(1000 + v * 37);
  const seg = d ? 9 : 5;
  const trunkH = 2.4 + rnd() * 0.7;
  const lean = (rnd() - 0.5) * 0.7;
  const trunk = tubeGeo(
    [new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(lean * 0.1, 0.5, 0), new THREE.Vector3(lean * 0.4, trunkH * 0.5, 0), new THREE.Vector3(lean * 0.8, trunkH * 0.8, 0), new THREE.Vector3(lean, trunkH + 0.5, 0)],
    [0.55, 0.34, 0.27, 0.22, 0.16],
    seg,
  );
  paint(trunk, trunkColor(pal), (p) => THREE.MathUtils.clamp((p.y - 3) * 0.2, 0, 0.4));
  const parts = [trunk];
  // Crown blobs: one big centre + satellites in a ring (the "cloud of leaves" look).
  const cy = trunkH + 1.0;
  const R = 1.55 + rnd() * 0.25;
  const blobDetail = d ? 3 : 1;
  const crown = crownColor(pal, lean, cy, 0, R * 1.5, style === 'autumn');
  const swayFn = (p: THREE.Vector3) => THREE.MathUtils.clamp((p.y - 2) * 0.16, 0, 1);
  const add = (x: number, y: number, z: number, r: number, sy: number, seed: number, dd = blobDetail) => {
    const g = blobGeo(dd, seed + v * 11, 0.16, 1.4, noise3);
    g.applyMatrix4(matrix(lean + x, cy + y, z, r, r * sy, r));
    paint(g, crown, swayFn);
    parts.push(g);
  };
  add(0, 0.2, 0, R, 0.85, 1);
  const n = d ? 6 : 3;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rnd() * 0.9;
    const dist = 0.95 + rnd() * 0.5;
    add(Math.cos(a) * dist, -0.25 + rnd() * 1.1, Math.sin(a) * dist, 0.8 + rnd() * 0.4, 0.85, 2 + k, d ? 2 : 1);
  }
  if (d) {
    // A couple of branches reaching into the crown.
    for (let k = 0; k < 3; k++) {
      const a = rnd() * Math.PI * 2;
      const g = tubeGeo([new THREE.Vector3(lean * 0.6, trunkH * 0.65, 0), new THREE.Vector3(lean * 0.6 + Math.cos(a) * 0.5, trunkH * 0.85, Math.sin(a) * 0.5), new THREE.Vector3(lean + Math.cos(a) * 1.0, trunkH + 0.6, Math.sin(a) * 1.0)], [0.14, 0.1, 0.05], 5);
      paint(g, trunkColor(pal, 0.9));
      parts.push(g);
    }
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------
// Pine / fir (stacked scalloped boughs on a lathe), optionally snow-laden
// ---------------------------------------------------------------------------

function pine(v: number, d: Detail, pal: Palette): THREE.BufferGeometry {
  const rnd = seededRandom(2000 + v * 53);
  const tiers = d ? 4 : 3;
  const height = 6.2 + rnd() * 0.8;
  const baseR = 1.75 + rnd() * 0.3;
  const seg = d ? 16 : 8;
  const rings = d ? 3 : 2;
  const parts: THREE.BufferGeometry[] = [];
  const trunk = tubeGeo([new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(0, 1.0, 0), new THREE.Vector3(0, height * 0.9, 0)], [0.46, 0.3, 0.1], d ? 8 : 5);
  paint(trunk, trunkColor(pal));
  parts.push(trunk);
  const phase = rnd() * 6;
  for (let k = 0; k < tiers; k++) {
    const t = k / tiers;
    const y0 = 1.0 + t * (height - 1.8) * (1 - 0.1 * t);
    const R = baseR * Math.pow(1 - t, 0.9) * (0.78 + 0.22 * (1 - t)) + 0.3;
    const H = (height - y0) * 0.5 + 0.4;
    const profile: [number, number][] = [[0.18, y0 + H * 0.16]];
    // underside up to the drooping rim, then the sloped top
    profile.push([R * 0.9, y0 - H * 0.02]);
    profile.push([R, y0 - H * 0.09]);
    for (let i = 1; i <= rings; i++) {
      const u = i / (rings + 0.3);
      profile.push([R * (1 - u * 0.98) * (1 + 0.06 * Math.sin(u * 4)), y0 - H * 0.09 + H * (u * 0.9 + 0.1 * u * u)]);
    }
    profile.push([0, y0 + H]);
    const geo = latheGeo(profile, seg, (a, tt) => 1 + (tt < 0.5 ? 0.14 : 0.07) * Math.sin(a * 7 + phase + k * 1.7) + 0.05 * Math.sin(a * 3 + k));
    paint(
      geo,
      (p, n) => {
        const h01 = THREE.MathUtils.clamp((p.y - y0) / H, 0, 1);
        const edge = THREE.MathUtils.clamp(Math.hypot(p.x, p.z) / R, 0, 1);
        const patch = fbm3(p.x * 2.2, p.y * 2.2, p.z * 2.2, 8);
        _c.copy(pal.pine).lerp(pal.leafLight, 0.12 + 0.3 * patch * edge);
        let shade = 0.5 + 0.45 * edge + 0.1 * h01;
        if (n.y < -0.25) shade *= 0.62; // dark underside of the bough
        _c.multiplyScalar(shade);
        if (pal.snow > 0) _c.lerp(SNOW, smoothstep(0.1, 0.65, n.y + (patch - 0.5) * 0.7) * pal.snow * (0.5 + 0.5 * edge));
        return _c;
      },
      (p) => THREE.MathUtils.clamp((p.y - 1.5) * 0.14, 0, 1),
    );
    parts.push(geo);
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------
// Poplar / cypress: a tall slender column of stacked lumps
// ---------------------------------------------------------------------------

function column(v: number, d: Detail, pal: Palette, style: Style): THREE.BufferGeometry {
  const rnd = seededRandom(3000 + v * 29);
  const trunk = tubeGeo([new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 2.2, 0)], [0.5, 0.3, 0.2], d ? 7 : 5);
  paint(trunk, trunkColor(pal));
  const parts = [trunk];
  const lumps = d ? 6 : 3;
  const H = 6.2 + rnd();
  const crown = crownColor(pal, 0, 4.0, 0, 3.4, style === 'autumn');
  for (let k = 0; k < lumps; k++) {
    const t = k / (lumps - 1);
    const r = (0.62 + 0.45 * Math.sin(Math.PI * (0.15 + 0.8 * t))) * (0.9 + rnd() * 0.2);
    const g = blobGeo(d ? 2 : 1, k + v * 5, 0.14, 1.6, noise3);
    g.applyMatrix4(matrix((rnd() - 0.5) * 0.25, 1.7 + t * (H - 2.2), (rnd() - 0.5) * 0.25, r, r * 1.35, r));
    paint(g, crown, (p) => THREE.MathUtils.clamp((p.y - 2) * 0.16, 0, 1));
    parts.push(g);
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------
// Palm
// ---------------------------------------------------------------------------

function palm(v: number, d: Detail, pal: Palette): THREE.BufferGeometry {
  const rnd = seededRandom(4000 + v * 41);
  const lean = 0.7 + rnd() * 0.8;
  const dir = rnd() * Math.PI * 2;
  const H = 5.4 + rnd() * 1.2;
  const bend = (t: number) => new THREE.Vector3(Math.cos(dir) * lean * t * t, t * H, Math.sin(dir) * lean * t * t);
  const path: THREE.Vector3[] = [];
  const radii: number[] = [];
  const steps = d ? 8 : 4;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push(bend(t));
    radii.push(0.4 - 0.2 * t + (i === 0 ? 0.12 : 0));
  }
  path[0].y = -0.3;
  const trunk = tubeGeo(path, radii, d ? 8 : 5);
  paint(trunk, (p) => {
    const ring = 0.85 + 0.15 * Math.sin(p.y * 10);
    _c.copy(pal.trunk).lerp(col('#b59a74'), 0.35).multiplyScalar((0.7 + 0.3 * THREE.MathUtils.clamp(p.y / 3, 0, 1)) * ring);
    return _c;
  });
  const parts = [trunk];
  const top = bend(1);
  const fronds = d ? 10 : 6;
  for (let k = 0; k < fronds; k++) {
    const a = (k / fronds) * Math.PI * 2 + rnd() * 0.4;
    const L = 2.3 + rnd() * 0.7;
    const up = 0.5 + rnd() * 0.7;
    const fp: THREE.Vector3[] = [];
    const n = d ? 6 : 3;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      // arcs up first, then droops under its own weight
      fp.push(new THREE.Vector3(top.x + Math.cos(a) * L * t, top.y + 0.15 + up * Math.sin(t * Math.PI * 0.62) * 1.5 - 1.55 * t * t * 0.9, top.z + Math.sin(a) * L * t));
    }
    const widths = fp.map((_, i) => 0.62 * Math.sin(Math.PI * Math.min(1, (i + 0.35) / (n + 0.35))) + 0.02);
    const g = ribbonGeo(fp, widths, new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), 0.6);
    paint(
      g,
      (p) => {
        const t = THREE.MathUtils.clamp(Math.hypot(p.x - top.x, p.z - top.z) / 2.8, 0, 1);
        _c.copy(pal.leaf).lerp(pal.leafLight, t * 0.7);
        return _c;
      },
      (p) => THREE.MathUtils.clamp(Math.hypot(p.x - top.x, p.z - top.z) * 0.4, 0, 1.2),
    );
    parts.push(g);
  }
  // Coconuts
  const nuts = d ? 3 : 0;
  for (let k = 0; k < nuts; k++) {
    const a = k * 2.1 + rnd();
    const g = blobGeo(1, k, 0.05, 1, noise3);
    g.applyMatrix4(matrix(top.x + Math.cos(a) * 0.22, top.y - 0.2, top.z + Math.sin(a) * 0.22, 0.17));
    paint(g, () => _c.set('#5a3d22'), (p) => THREE.MathUtils.clamp((p.y - 3) * 0.1, 0, 0.5));
    parts.push(g);
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------
// Charred volcanic trees: black trunks, bare forked branches, a few ember-lit scorched leaves
// ---------------------------------------------------------------------------

function charred(v: number, d: Detail, pal: Palette, kind: 'fork' | 'snag' | 'scorched'): THREE.BufferGeometry {
  const rnd = seededRandom(5000 + v * 71);
  const seg = d ? 7 : 4;
  const parts: THREE.BufferGeometry[] = [];
  const burnt = (p: THREE.Vector3, glow: number): THREE.Color => {
    const coal = noise3(p.x * 6, p.y * 2.5, p.z * 6, 9);
    _c.copy(pal.trunk).multiplyScalar(0.7 + 0.7 * coal);
    // Heat still glowing in cracks near the ground.
    const crack = smoothstep(0.62, 0.8, ridged3(p.x * 3, p.y * 1.2, p.z * 3, 4)) * smoothstep(3.2, 0.2, p.y) * glow;
    _c.lerp(EMBER, crack * 0.7);
    return _c;
  };
  const sway = (p: THREE.Vector3) => THREE.MathUtils.clamp((p.y - 3) * 0.08, 0, 0.3);
  const limb = (from: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number) => {
    const mid = from.clone().addScaledVector(dir, len * 0.5).add(new THREE.Vector3((rnd() - 0.5) * 0.3, 0.1, (rnd() - 0.5) * 0.3));
    const end = from.clone().addScaledVector(dir, len);
    const g = tubeGeo([from, mid, end], [r, r * 0.65, 0], d ? 5 : 3);
    paint(g, (p) => burnt(p, 0.2), sway);
    parts.push(g);
    if (depth > 0 && d) {
      for (let k = 0; k < 2; k++) {
        const nd = dir.clone().add(new THREE.Vector3((rnd() - 0.5) * 1.1, 0.35 + rnd() * 0.4, (rnd() - 0.5) * 1.1)).normalize();
        limb(mid.clone(), nd, len * 0.6, r * 0.55, depth - 1);
      }
    }
  };
  const height = kind === 'snag' ? 5.6 + rnd() * 1.4 : 3.0 + rnd() * 0.8;
  const trunkPts = [new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(0.1, 1, 0), new THREE.Vector3(-0.05, height * 0.6, 0.1), new THREE.Vector3(0.08, height, 0)];
  const trunk = tubeGeo(trunkPts, [0.56, 0.34, 0.24, kind === 'snag' ? 0.12 : 0.2], seg + 1);
  paint(trunk, (p) => burnt(p, 1), sway);
  parts.push(trunk);
  if (kind === 'snag') {
    // Broken top and short dead stubs.
    for (let k = 0; k < (d ? 5 : 2); k++) {
      const a = rnd() * 6.28;
      limb(new THREE.Vector3(0, 1.8 + rnd() * (height - 2.5), 0), new THREE.Vector3(Math.cos(a), 0.5 + rnd() * 0.4, Math.sin(a)).normalize(), 0.8 + rnd() * 0.9, 0.12, 0);
    }
  } else {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * 6.28 + rnd();
      limb(new THREE.Vector3(0.08, height - 0.2, 0), new THREE.Vector3(Math.cos(a), 0.7 + rnd() * 0.5, Math.sin(a)).normalize(), 1.6 + rnd() * 0.9, 0.2, 1);
    }
    if (kind === 'scorched') {
      // A few clumps of scorched, still-orange leaves.
      for (let k = 0; k < (d ? 4 : 2); k++) {
        const a = rnd() * 6.28;
        const g = blobGeo(d ? 2 : 1, k, 0.2, 1.5, noise3);
        g.applyMatrix4(matrix(Math.cos(a) * 1.2, height + 0.9 + rnd() * 0.5, Math.sin(a) * 1.2, 0.65 + rnd() * 0.3, 0.45, 0.65 + rnd() * 0.3));
        paint(
          g,
          (_p, n) => {
            const t = THREE.MathUtils.clamp(n.y * 0.5 + 0.5, 0, 1);
            _c.copy(pal.leaf).lerp(pal.leafLight, t * 0.5).multiplyScalar(0.55 + 0.45 * t);
            return _c;
          },
          () => 0.8,
        );
        parts.push(g);
      }
    }
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------
// Cactus
// ---------------------------------------------------------------------------

function cactus(v: number, d: Detail, pal: Palette): THREE.BufferGeometry {
  const rnd = seededRandom(6000 + v * 13);
  const seg = d ? 12 : 6;
  const H = 3.2 + rnd() * 0.8;
  const green = (p: THREE.Vector3): THREE.Color => {
    const ang = Math.atan2(p.z, p.x);
    const rib = 0.85 + 0.15 * Math.cos(ang * 10);
    return _c.set('#4f8f46').lerp(pal.leafLight, 0.15).multiplyScalar(rib * (0.7 + 0.3 * THREE.MathUtils.clamp(p.y / 3, 0, 1)));
  };
  const main = tubeGeo([new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, H * 0.5, 0), new THREE.Vector3(0, H * 0.9, 0), new THREE.Vector3(0, H, 0), new THREE.Vector3(0, H + 0.12, 0)], [0.42, 0.4, 0.34, 0.22, 0], seg);
  paint(main, green);
  const parts = [main];
  const arms = d ? 2 : 1;
  for (let k = 0; k < arms; k++) {
    const side = k ? -1 : 1;
    const y0 = H * (0.35 + 0.15 * k + rnd() * 0.1);
    const up = H * (0.35 + rnd() * 0.2);
    const g = tubeGeo([new THREE.Vector3(0, y0, 0), new THREE.Vector3(side * 0.6, y0 + 0.02, 0), new THREE.Vector3(side * 0.9, y0 + 0.35, 0), new THREE.Vector3(side * 0.9, y0 + up * 0.8, 0), new THREE.Vector3(side * 0.9, y0 + up + 0.1, 0)], [0.3, 0.27, 0.26, 0.24, 0], seg);
    paint(g, green);
    parts.push(g);
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------
// Bushes, rocks, grass
// ---------------------------------------------------------------------------

function bush(v: number, d: Detail, pal: Palette, style: Style): THREE.BufferGeometry {
  const rnd = seededRandom(7000 + v * 23);
  const parts: THREE.BufferGeometry[] = [];
  const n = d ? 4 : 2;
  const crown = crownColor({ ...pal, leaf: pal.bush, leafLight: pal.bush.clone().lerp(pal.leafLight, 0.55) }, 0, 0.5, 0, 1.2, style === 'alpine');
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 6.28 + rnd();
    const r = 0.5 + rnd() * 0.35;
    const dist = k === 0 ? 0 : 0.5 + rnd() * 0.3;
    const g = blobGeo(d ? 2 : 1, k + v * 9, 0.17, 1.8, noise3);
    g.applyMatrix4(matrix(Math.cos(a) * dist, r * 0.62, Math.sin(a) * dist, r * 1.1, r * 0.78, r * 1.1));
    paint(g, crown, (p) => THREE.MathUtils.clamp(p.y * 0.5, 0, 0.5));
    parts.push(g);
  }
  if (d && (style === 'meadow' || style === 'sky') && v % 2 === 0) {
    // Berries / blossoms dotted on top.
    const bloom = ['#ff7eb6', '#fff3a0', '#ffffff', '#ff6a5a'][v % 4];
    for (let k = 0; k < 7; k++) {
      const a = rnd() * 6.28;
      const rr = rnd() * 0.7;
      const g = blobGeo(0, k, 0, 1, noise3);
      g.applyMatrix4(matrix(Math.cos(a) * rr, 0.7 + (1 - rr) * 0.25, Math.sin(a) * rr, 0.09));
      paint(g, () => _c.set(bloom));
      parts.push(g);
    }
  }
  return merge(parts);
}

function rock(v: number, d: Detail, pal: Palette, style: Style): THREE.BufferGeometry {
  const g = blobGeo(d ? 3 : 1, 100 + v * 3, 0.34, 1.15, noise3);
  const pos = g.getAttribute('position');
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    // Chisel in some planar-ish facets with ridged noise and flatten the underside so it sits on the ground.
    const ridge = ridged3(p.x * 1.4 + v, p.y * 1.4, p.z * 1.4, 21 + v, 2);
    const s = 1 - 0.14 * ridge;
    p.multiplyScalar(s);
    p.y = Math.max(p.y, -0.55) * 0.82;
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  paint(g, (q, n) => {
    const strata = noise3(q.x * 0.8, q.y * 5.5, q.z * 0.8, 31);
    const patch = fbm3(q.x * 2.5, q.y * 2.5, q.z * 2.5, 6);
    _c.copy(pal.rockDark).lerp(pal.rock, THREE.MathUtils.clamp(0.4 + 0.5 * n.y + (patch - 0.5) * 0.8 + (strata - 0.5) * 0.4, 0, 1));
    if (style === 'volcanic') {
      const glow = smoothstep(0.7, 0.86, ridged3(q.x * 2.2, q.y * 2.2, q.z * 2.2, 77)) * smoothstep(0.1, -0.5, n.y + 0.2);
      _c.lerp(EMBER, glow * 0.55);
    }
    if (pal.snow > 0) _c.lerp(SNOW, smoothstep(0.3, 0.7, n.y + (patch - 0.5) * 0.4) * pal.snow);
    if (pal.moss > 0) _c.lerp(_c2.set('#5f9a3a'), smoothstep(0.55, 0.8, n.y + (patch - 0.5) * 0.7) * pal.moss * 0.6);
    return _c;
  });
  return g;
}

/** A tuft of 5 curved grass blades, 0.5-1 m tall; tinted per instance. */
function tuft(d: Detail, pal: Palette): THREE.BufferGeometry {
  const rnd = seededRandom(8000);
  const parts: THREE.BufferGeometry[] = [];
  const blades = d ? 5 : 3;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * 6.28 + rnd() * 0.5;
    const h = 0.5 + rnd() * 0.45;
    const lean = 0.25 + rnd() * 0.3;
    const dx = Math.cos(a) * lean;
    const dz = Math.sin(a) * lean;
    const path = [new THREE.Vector3(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04), new THREE.Vector3(dx * 0.45, h * 0.6, dz * 0.45), new THREE.Vector3(dx, h, dz)];
    const g = ribbonGeo(path, [0.1, 0.075, 0.0], new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), 1.5);
    paint(
      g,
      (p) => _c.copy(pal.tuftDark).lerp(pal.tuft, THREE.MathUtils.clamp(p.y / 0.7, 0, 1)),
      (p) => p.y * 0.9,
    );
    parts.push(g);
  }
  return merge(parts);
}

function flower(): THREE.BufferGeometry {
  const stem = ribbonGeo([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.03, 0.18, 0), new THREE.Vector3(0.05, 0.34, 0)], [0.035, 0.03, 0.02], new THREE.Vector3(0, 0, 1), 1);
  paint(stem, () => _c.set('#3f8a2c'), (p) => p.y * 0.8);
  const head = blobGeo(1, 1, 0.1, 1, noise3);
  head.applyMatrix4(matrix(0.05, 0.36, 0, 0.12, 0.07, 0.12));
  paint(head, (p) => (p.y > 0.37 && Math.hypot(p.x - 0.05, p.z) < 0.05 ? _c.set('#ffd23a') : _c.set('#ffffff')), (p) => p.y * 0.8);
  return merge([stem, head]);
}

// ---------------------------------------------------------------------------
// Public kit
// ---------------------------------------------------------------------------

export interface PropSet {
  trees: Record<TreeKind, THREE.BufferGeometry[]>;
  bushes: THREE.BufferGeometry[];
  rocks: THREE.BufferGeometry[];
  tuft: THREE.BufferGeometry;
  flower: THREE.BufferGeometry;
}

/** How many look-alike variants exist per kind. */
export const VARIANTS = 3;

/** Which species stands in for each of the plan's generic tree kinds, per style. */
function treeFor(style: Style, kind: TreeKind, v: number, d: Detail, pal: Palette): THREE.BufferGeometry {
  switch (style) {
    case 'volcanic':
      return charred(v, d, pal, kind === 'pine' ? 'snag' : kind === 'poplar' ? 'fork' : 'scorched');
    case 'harbour':
      if (kind === 'round') return palm(v, d, pal);
      if (kind === 'poplar') return column(v, d, pal, style);
      return kind === 'pine' ? pine(v, d, pal) : broadleaf(v, d, pal, style);
    case 'alpine':
      return pine(v, d, pal);
    default:
      if (kind === 'cactus') return cactus(v, d, pal);
      if (kind === 'pine') return pine(v, d, pal);
      if (kind === 'poplar') return column(v, d, pal, style);
      return broadleaf(v, d, pal, style);
  }
}

export function buildPropSet(style: Style, d: Detail): PropSet {
  const pal = PALETTES[style];
  const kinds: TreeKind[] = ['pine', 'round', 'poplar', 'cactus'];
  const trees = {} as Record<TreeKind, THREE.BufferGeometry[]>;
  for (const k of kinds) {
    trees[k] = [];
    for (let v = 0; v < VARIANTS; v++) trees[k].push(treeFor(style, k, v, d, pal));
  }
  const bushes = Array.from({ length: VARIANTS }, (_, v) => bush(v, d, pal, style));
  const rocks = Array.from({ length: VARIANTS }, (_, v) => rock(v, d, pal, style));
  return { trees, bushes, rocks, tuft: tuft(d, pal), flower: flower() };
}

export function disposePropSet(s: PropSet): void {
  for (const list of Object.values(s.trees)) for (const g of list) g.dispose();
  for (const g of [...s.bushes, ...s.rocks, s.tuft, s.flower]) g.dispose();
}

export { placed };
