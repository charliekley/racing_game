/**
 * Mushroom Valley set pieces: the giant mushrooms, the mist in the gorges and the glowing cave.
 * Only tracks with `def.scenery.mushroom` use this file (see `isMushroom`).
 *
 *  - GIANT CAPS (`MushroomView`): every cap of `track.def.caps` (the SAME list the physics reads, through
 *    `Bouncers`) gets a cap and a thick stalk that disappears down into the mist. Green caps and all stalks are merged
 *    into ONE static mesh. The orange caps are one INSTANCED mesh (the same cap drawn many times, each copy with its own
 *    matrix), so each can squash and stretch on its own when a kart bounces on it: still one draw call.
 *  - MIST (`buildMist`): layers of soft cloud (a canvas texture made at start-up) stacked in every gorge and under the
 *    cave. One merged mesh, one draw call.
 *  - THE CAVE (`buildCave`): a rock vault over the cave's stretch of road (lumpy vertex-coloured rock, stalactites) and
 *    bioluminescent little mushrooms stuck to it (one instanced mesh with glowing HDR colours, so the bloom picks them up).
 *
 * Web/3D concepts used here:
 *  - A "lathe" turns a profile curve (radius, height) into a surface of revolution: a vase, a stalk, a mushroom cap.
 *  - "Vertex colours" bake the colour of every corner into the geometry, so one material draws cream spots, orange
 *    caps and rock without any image file.
 *  - An "instanced" mesh draws one geometry many times with a different matrix each time. Changing a matrix = moving,
 *    scaling or rotating one copy. Squash-and-stretch is just a non-uniform scale on the matrix.
 */
import * as THREE from 'three';
import { Bouncers, CAP_DROOP, type Cap } from '../../sim/bouncers';
import { Track } from '../../sim/track';
import { seededRandom } from '../textures';
import { fromArrays, latheGeo, matrix, merge, paint, placed, tubeGeo, type ColorFn } from './geo';
import { ENV_TIME } from './materials';
import { fbm3, noise3, smoothstep } from './noise';

/** True if the track uses the mushroom look. */
export function isMushroom(track: Track): boolean {
  return track.def.scenery.mushroom !== undefined;
}

// ---------------------------------------------------------------------------
// The trail (this track's own road surface)
// ---------------------------------------------------------------------------

/**
 * The road surface of Mushroom Valley: a packed-earth mountain trail instead of asphalt. Drawn once on a canvas: warm
 * tan earth with soft blotches, two darker wheel ruts, small stones and a few cracks. No lane markings. The texture
 * tiles along the road (the blotch noise is blended with itself shifted by one tile, so there is no seam).
 */
export function trailTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const base = new THREE.Color('#a98f68');
  const dark = new THREE.Color('#7d6648');
  const light = new THREE.Color('#c4aa80');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      // Seamless along v: blend the noise with itself one tile further on.
      const n0 = fbm3(u * 6, v * 12, 0.5, 5, 4);
      const n1 = fbm3(u * 6, (v - 1) * 12, 0.5, 5, 4);
      const n = n0 * (1 - v) + n1 * v;
      const fine = noise3(u * 90, v * 180, 0.2, 7) - 0.5;
      _c.copy(dark).lerp(base, smoothstep(0.25, 0.6, n)).lerp(light, smoothstep(0.55, 0.8, n) * 0.6);
      _c.offsetHSL(0, 0, fine * 0.1);
      // Two wheel ruts (darker, a touch smoother) and a packed, lighter crown in the middle.
      const rut = Math.exp(-Math.pow((u - 0.3) / 0.07, 2)) + Math.exp(-Math.pow((u - 0.7) / 0.07, 2));
      _c.multiplyScalar(1 - 0.18 * rut);
      _c.lerp(light, 0.1 * Math.exp(-Math.pow((u - 0.5) / 0.08, 2)));
      // The verge is darker and grittier.
      _c.multiplyScalar(1 - 0.22 * smoothstep(0.86, 1, Math.abs(u - 0.5) * 2));
      const k = (y * w + x) * 4;
      img.data[k] = Math.round(_c.r * 255);
      img.data[k + 1] = Math.round(_c.g * 255);
      img.data[k + 2] = Math.round(_c.b * 255);
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Stones: small grey-brown ovals with a lighter top edge (drawn with wrap-around along the road).
  const rnd = seededRandom(5);
  for (let i = 0; i < 200; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 0.8 + rnd() * rnd() * 3;
    const tone = 75 + rnd() * 55;
    for (const oy of [-h, 0, h]) {
      if (y + oy + r < 0 || y + oy - r > h) continue;
      ctx.fillStyle = `rgba(${tone * 0.55},${tone * 0.5},${tone * 0.45},0.55)`;
      ctx.beginPath();
      ctx.ellipse(x + 0.8, y + oy + 0.8, r, r * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgb(${tone},${tone * 0.93},${tone * 0.82})`;
      ctx.beginPath();
      ctx.ellipse(x, y + oy, r, r * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

// Cap paints: a lighter, slightly sunlit crown (`*_TOP`), the body colour and a deep rim, so the domes read as round.
const ORANGE_TOP = new THREE.Color('#f07a1c');
const ORANGE = new THREE.Color('#d9570f');
const ORANGE_RIM = new THREE.Color('#8f2a08');
const GREEN_TOP = new THREE.Color('#3f9a4a');
const GREEN = new THREE.Color('#2a7a3a');
const GREEN_RIM = new THREE.Color('#123f26');
const CREAM = new THREE.Color('#f6e8c4');
const GILL = new THREE.Color('#f3d9a6');
const STALK = new THREE.Color('#f1e4c4');
const STALK_SHADE = new THREE.Color('#c9b58c');
const GILL_DARK = new THREE.Color('#b99a68');
const MIST = new THREE.Color('#c4d5ea');
const _c = new THREE.Color();

// ---------------------------------------------------------------------------
// A cap
// ---------------------------------------------------------------------------

/** Height of the dome's top surface at radius r (unit cap): the same formula the physics uses (`CAP_DROOP`). */
const domeY = (r: number): number => -CAP_DROOP * r * r;

/**
 * A cap of radius 1 with its crest at y = 0, standing for the physics surface: a gently domed top (it sinks by
 * CAP_DROOP at the rim, like the ground you drive on), a thick rolled rim, then the underside bowl with its gills.
 * Painted with cream spots on top and radial gill stripes underneath.
 */
function capGeo(kind: 'orange' | 'green', seed: number): THREE.BufferGeometry {
  const profile: [number, number][] = [
    [0.1, -0.58], // under the stalk
    [0.3, -0.54],
    [0.55, -0.45],
    [0.78, -0.34],
    [0.93, -0.24],
    [1.03, -0.18], // the rim rolls over
    [1.09, -0.12],
    [1.08, -0.07],
    [1.02, domeY(1) - 0.012],
  ];
  // Many rings on the top, so the spots have crisp edges and the dome is smooth.
  for (let r = 0.94; r > 0.001; r -= 0.12) profile.push([r, domeY(r)]);
  profile.push([0, 0]);
  const geo = latheGeo(profile, 40);
  // Cream spots on the top: a few big, a few small, from the seed (the same cap always looks the same).
  const rnd = seededRandom(seed);
  const spots: { x: number; z: number; r: number }[] = [];
  // Many small spots (a few medium ones among them), kept apart from each other so they never merge into big blobs.
  for (let tries = 0; spots.length < 44 && tries < 500; tries++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * 0.84;
    const r = 0.022 + rnd() * rnd() * 0.05;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (spots.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 0.04)) continue;
    spots.push({ x, z, r });
  }
  const base = kind === 'orange' ? ORANGE : GREEN;
  const top = kind === 'orange' ? ORANGE_TOP : GREEN_TOP;
  const rim = kind === 'orange' ? ORANGE_RIM : GREEN_RIM;
  // Each spot: a small fan of triangles whose corners sit exactly on the dome (height = domeY) plus a hair.
  const disc: THREE.BufferGeometry[] = spots.map((sp) => {
    const pos: number[] = [sp.x, domeY(Math.hypot(sp.x, sp.z)) + 0.012, sp.z];
    const idx: number[] = [];
    const N = 12;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const x = sp.x + Math.cos(a) * sp.r;
      const z = sp.z + Math.sin(a) * sp.r;
      pos.push(x, domeY(Math.hypot(x, z)) + 0.012, z);
      idx.push(0, 1 + ((k + 1) % N), 1 + k);
    }
    return paint(fromArrays(pos, idx), () => _c.copy(CREAM).multiplyScalar(0.96 + 0.08 * ((sp.x * 7.3 + sp.z * 3.1) % 1)));
  });
  const color: ColorFn = (p, n) => {
    const r = Math.hypot(p.x, p.z);
    if (n.y < -0.1 || p.y < -0.2) {
      // Underside: pale gills in radial stripes, darker toward the stalk and under the rim.
      const stripe = 0.5 + 0.5 * Math.sin(Math.atan2(p.z, p.x) * 56);
      _c.copy(GILL).lerp(GILL_DARK, 0.2 + 0.5 * stripe * smoothstep(0.1, 0.9, r));
      return _c.multiplyScalar(0.55 + 0.45 * smoothstep(0.1, 0.95, r));
    }
    // Top and rolled rim: a lighter crown fading through the body colour to a dark rim, with a soft sheen off-centre
    // (a pale highlight toward the upper left, like sun on a glossy dome) and the rolled rim shaded by its normal.
    _c.copy(top).lerp(base, smoothstep(0.1, 0.65, r)).lerp(rim, smoothstep(0.62, 1.08, r));
    const sheen = Math.exp(-(Math.pow(p.x + 0.28, 2) + Math.pow(p.z + 0.2, 2)) / 0.05);
    _c.lerp(CREAM, sheen * 0.16);
    const blotch = noise3(p.x * 3, 0, p.z * 3, seed) * 0.1 - 0.05;
    _c.offsetHSL(0, 0, blotch);
    return _c.multiplyScalar(0.62 + 0.38 * smoothstep(0.35, 0.95, n.y));
  };
  return merge([paint(geo, color), ...disc]);
}

/** The glowing rim of an orange cap: a bright ring on the top edge (drawn with HDR colours, so it blooms). */
function rimGlowGeo(): THREE.BufferGeometry {
  const profile: [number, number][] = [];
  for (let r = 0.78; r <= 1.0001; r += 0.055) profile.push([r, domeY(r) + 0.022]);
  return latheGeo(profile, 48);
}

/**
 * A thick stalk from just under the cap down into the mist (world units): a neck with a ruffled SKIRT RING just under
 * the cap, swelling toward the bottom into a wide flare. Its colour fades to mist colour with depth.
 */
function stalkGeo(cap: Cap, mistY: number): THREE.BufferGeometry {
  const R = cap.radius;
  const top = cap.y - R * 0.5;
  const bottom = mistY - 36;
  const rTop = R * 0.26;
  const skirtY = top - R * 0.2; // where the ring hangs
  const steps = 10;
  const profile: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps; // 0 = bottom, 1 = top
    const y = bottom + (skirtY - R * 0.5 - bottom) * t;
    // A neck that swells slowly toward the bottom, then a wide flare at the very bottom.
    const r = rTop * (1 + 1.3 * Math.pow(1 - t, 1.5) + (t < 0.15 ? (0.15 - t) * 8 : 0));
    profile.push([r, y]);
  }
  // The skirt ring: flares out and tucks back in.
  profile.push([rTop * 1.05, skirtY - R * 0.3]);
  profile.push([rTop * 1.9, skirtY - R * 0.2]);
  profile.push([rTop * 2.25, skirtY - R * 0.1]);
  profile.push([rTop * 1.9, skirtY + R * 0.02]);
  profile.push([rTop * 1.2, skirtY + R * 0.12]);
  profile.push([rTop, skirtY + R * 0.2]);
  profile.push([rTop * 0.9, top]);
  const geo = latheGeo(profile, 12, (a, t) => 1 + 0.05 * Math.sin(a * 3 + t * 9)); // a little lumpy
  const color: ColorFn = (p) => {
    const ring = 0.5 + 0.5 * Math.sin(p.y * 0.9);
    const inSkirt = smoothstep(skirtY - R * 0.35, skirtY - R * 0.2, p.y) * (1 - smoothstep(skirtY + R * 0.02, skirtY + R * 0.2, p.y));
    _c.copy(STALK).lerp(STALK_SHADE, 0.25 * ring + 0.4 * (1 - smoothstep(top - 25, top, p.y)));
    _c.lerp(CREAM, inSkirt * 0.6);
    return _c.lerp(MIST, smoothstep(mistY + 12, mistY - 18, p.y));
  };
  return paint(placed(geo, matrix(cap.x, 0, cap.z, 1, 1, 1)), color);
}

// ---------------------------------------------------------------------------
// Mist
// ---------------------------------------------------------------------------

/**
 * A soft cloud texture: fuzzy white blobs drawn on a canvas. It TILES (every blob near an edge is drawn again on the
 * opposite side), so the mist can scroll forever without a seam.
 */
function mistTexture(tile = 2.5): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rnd = seededRandom(31);
  for (let i = 0; i < 46; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 22 + rnd() * rnd() * 70;
    const a = 0.16 + rnd() * 0.34;
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const cx = x + ox;
        const cy = y + oy;
        if (cx + r < 0 || cx - r > size || cy + r < 0 || cy - r > size) continue;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(0.55, `rgba(255,255,255,${a * 0.45})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(tile, tile);
  return tex;
}

/** A horizontal square of mist: centre, size, rotation (rad) and height, as geometry in world space. */
function mistQuad(cx: number, y: number, cz: number, w: number, d: number, rot: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.rotateY(rot);
  g.translate(cx, y, cz);
  return g;
}

/** Options of `buildMist`: number of layers, spacing, per-layer opacity, darkening of the deepest layer, texture tiling. */
interface MistOptions {
  layers?: number;
  gap?: number;
  alphas?: number[];
  dark?: number;
  tile?: number;
}

/**
 * Every gorge and the cave pit get a stack of soft cloud layers well below the road, so the chasms look bottomless and
 * cloudy. The terrain hides the parts that lie under solid ground; only what is inside a chasm shows.
 *
 * The clouds move. Each layer has a `drift` attribute (uv units per second) and a few lines of GLSL, spliced into the
 * built-in material with `onBeforeCompile`, add `drift x time` to the texture coordinates: the texture slides across
 * the quad (it tiles, so it never runs out). A second varying fades the quad's own edges, so the sliding clouds never
 * show the edge of the plane.
 */
function buildMist(areas: { x: number; z: number; w: number; d: number; rot: number; y: number }[], opt: MistOptions = {}): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const rnd = seededRandom(404);
  const LAYERS = opt.layers ?? 5;
  const gap = opt.gap ?? 15;
  for (const a of areas) {
    // Bottom layers first (they are drawn first): the deepest is the thickest, the top one wispy.
    for (let layer = 0; layer < LAYERS; layer++) {
      const y = a.y - 8 - layer * gap;
      const grow = 1 + 0.14 * layer;
      const g = mistQuad(a.x + (rnd() - 0.5) * 8, y, a.z + (rnd() - 0.5) * 8, a.w * grow, a.d * grow, a.rot + (rnd() - 0.5) * 0.4);
      const pos = g.getAttribute('position');
      // Per-layer opacity in the vertex alpha: the bottom layer is nearly solid, the top one thin.
      const col = new Float32Array(pos.count * 4);
      const k = opt.alphas ? opt.alphas[layer] : [0.4, 0.55, 0.75, 0.9, 1.0][layer];
      // Depth gradient: the top layer is bright cloud, each one below is darker and bluer (an abyss, not a white floor).
      const depth = (opt.dark ?? 1) * (layer / Math.max(1, LAYERS - 1));
      const shade = [1 - 0.62 * depth, 1 - 0.55 * depth, 1 - 0.3 * depth];
      // Each layer drifts its own way (a slow one, a faster one, a crossing one).
      const ang = rnd() * Math.PI * 2;
      const speed = 0.005 + 0.004 * (LAYERS - layer) + rnd() * 0.004;
      const drift = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        col.set([shade[0], shade[1], shade[2], k], i * 4);
        drift.set([Math.cos(ang) * speed, Math.sin(ang) * speed], i * 2);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 4));
      g.setAttribute('drift', new THREE.BufferAttribute(drift, 2));
      parts.push(g);
    }
  }
  const geo = merge(parts);
  const mat = new THREE.MeshBasicMaterial({ map: mistTexture(opt.tile), color: MIST, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.95 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = ENV_TIME;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 drift;\nuniform float uTime;\nvarying vec2 vFade;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv += drift * uTime;\n#endif\n  vFade = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFade;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.a *= smoothstep(0.0, 0.2, vFade.x) * smoothstep(0.0, 0.2, 1.0 - vFade.x) * smoothstep(0.0, 0.2, vFade.y) * smoothstep(0.0, 0.2, 1.0 - vFade.y);');
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// The backdrop: a ring of far snowy ranges
// ---------------------------------------------------------------------------

const PEAK_ROCK = new THREE.Color('#6d7b93');
const PEAK_SNOW = new THREE.Color('#f4f8ff');

/**
 * Two rings of faraway mountains round the course (one merged mesh, a few hundred triangles). Each peak is a lumpy cone
 * with a snowy top whose colours are BAKED: lit faces vs shaded faces from the normal, and a haze that grows toward the
 * base and with distance (blending into the sky's horizon colour), so they read as distant ranges. The material ignores
 * the scene fog (its start/end are far closer than these mountains) and uses its own baked haze instead.
 */
function buildFarPeaks(cx: number, cz: number, horizon: THREE.Color): THREE.Mesh {
  const rnd = seededRandom(515);
  const parts: THREE.BufferGeometry[] = [];
  const sun = new THREE.Vector3(0.5, 0.6, 0.35).normalize();
  const ring = (count: number, radius: number, height: number, haze: number, phase: number) => {
    for (let i = 0; i < count; i++) {
      const a = phase + ((i + (rnd() - 0.5) * 0.5) / count) * Math.PI * 2;
      const h = height * (0.55 + 0.7 * rnd());
      const w = h * (0.9 + 0.5 * rnd());
      // A cone-ish lathe with lumpy flanks: rings from the base up to the summit.
      const profile: [number, number][] = [];
      for (let k = 0; k <= 7; k++) {
        const t = k / 7;
        profile.push([w * Math.pow(1 - t, 0.85) * (1 + 0.12 * Math.sin(k * 2.3 + i)), -60 + (h + 60) * t]);
      }
      profile[7][0] = 0.5;
      const g = latheGeo(profile, 9, (ang, t) => 1 + 0.28 * (noise3(Math.cos(ang) * 2 + i, t * 3, Math.sin(ang) * 2, 5 + i) - 0.5));
      const placedGeo = placed(g, matrix(cx + Math.cos(a) * radius, 0, cz + Math.sin(a) * radius, 1, 1, 1, rnd() * 6.28));
      parts.push(
        paint(placedGeo, (p, n) => {
          const t = (p.y + 60) / (h + 60);
          const snow = smoothstep(0.5, 0.66, t + (noise3(p.x * 0.02, p.y * 0.03, p.z * 0.02, 8) - 0.5) * 0.25);
          _c.copy(PEAK_ROCK).lerp(PEAK_SNOW, snow);
          // Baked sun: faces toward the light are bright, the others a cool shade.
          _c.multiplyScalar(0.62 + 0.55 * Math.max(0, n.dot(sun)) + 0.12 * snow);
          // Atmospheric perspective: hazier lower down and for the outer ring.
          return _c.lerp(horizon, Math.min(0.92, haze + (1 - t) * 0.4));
        }),
      );
    }
  };
  ring(11, 1100, 330, 0.38, 0.2);
  ring(13, 1500, 520, 0.58, 0.55);
  const mesh = new THREE.Mesh(merge(parts), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// The cave
// ---------------------------------------------------------------------------

/** The cave's frame: for each position along its axis, the world centre line and the sideways direction. */
interface Section {
  x: number;
  z: number;
  y: number;
  rx: number;
  rz: number;
  /** 0..1 across the length of the cave (for the portals). */
  u: number;
}

const ROCK = new THREE.Color('#7b7168');
const ROCK_DARK = new THREE.Color('#34303a');
const ROCK_WARM = new THREE.Color('#7d6b58');
const GRASS = new THREE.Color('#5f8f3e');

/** Where the vault stands: sections along the cave's stretch of main road (a little longer at both ends). */
function caveSections(track: Track): { sections: Section[]; centreOffset: number } {
  const m = track.def.scenery.mushroom!.cave;
  const s0 = track.sAt(m.from) - 26;
  const s1 = track.sAt(m.to) + 26;
  const len = (((s1 - s0) % track.length) + track.length) % track.length;
  const n = Math.max(6, Math.round(len / 9));
  const sections: Section[] = [];
  for (let i = 0; i <= n; i++) {
    const s = (s0 + (len * i) / n) % track.length;
    const p = track.pointAt(s);
    const q = track.samples[p.index];
    sections.push({ x: p.x, z: p.z, y: p.y, rx: q.rx, rz: q.rz, u: i / n });
  }
  // The vault is centred between the main road and the second route (the def says how far to the right of the road).
  return { sections, centreOffset: m.offset ?? -m.halfWidth * 0.26 };
}

/**
 * Is the ground point (x, z) inside the cave's footprint (under the rock vault)? Used by the terrain and the road
 * shoulders to turn the sunlit grass into dark rock under the roof. Cheap rejection first (a bounding circle).
 */
export function caveFootprint(track: Track): (x: number, z: number) => boolean {
  const m = track.def.scenery.mushroom!.cave;
  const { sections, centreOffset } = caveSections(track);
  const mid = sections[Math.floor(sections.length / 2)];
  const reach = (sections.length * 9) / 2 + m.halfWidth + 20;
  const s0 = track.sAt(m.from) - 22;
  const s1 = track.sAt(m.to) + 22;
  return (x, z) => {
    if (Math.hypot(x - mid.x, z - mid.z) > reach) return false;
    const p = track.project(x, z);
    if (track.deltaS(s0, p.s) < 0 || track.deltaS(p.s, s1) < 0) return false;
    return Math.abs(p.d - centreOffset) < m.halfWidth * 0.9;
  };
}

/** The rock shell: an arch swept along the cave, with lumpy rock, portals at both ends and stalactites. */
function buildCave(track: Track): { shell: THREE.Mesh; points: { x: number; y: number; z: number; nx: number; ny: number; nz: number }[] } {
  const m = track.def.scenery.mushroom!.cave;
  const { sections, centreOffset } = caveSections(track);
  const N = sections.length;
  const M = 22; // vertices across the arch itself
  const K = M + 2; // ...plus one more at each foot, far below: the hill's flanks run down into the abyss (no floating shell)
  const pos: number[] = [];
  const idx: number[] = [];
  const surface: { x: number; y: number; z: number; nx: number; ny: number; nz: number }[] = [];
  const rnd = seededRandom(77);
  /** The arch of one section (index into `sections`), as world points: the sunken foot, the arch itself, the other foot. */
  const archPoint = (sec: Section, i: number, j: number, half: number, roof: number) => {
    const jj = Math.min(Math.max(j, 0), M - 1);
    const th = (jj / (M - 1)) * Math.PI; // 0 = left foot, PI = right foot
    const lat = centreOffset - Math.cos(th) * half;
    // A flattened arch: steep at the feet, broad at the top.
    const up = Math.pow(Math.sin(th), 0.7) * roof;
    const bump = 1 + 0.13 * (fbm3(i * 0.35, jj * 0.45, 2.7, 9, 3) - 0.5) * 2;
    // The two extra columns drop straight down from the feet, with a lumpy outward lean so the flank is not a plain wall.
    const sink = j < 0 || j >= M ? 80 + 14 * fbm3(i * 0.3, j, 5.1, 3, 2) : 0;
    const lean = sink ? (j < 0 ? -1 : 1) * 0.1 * sink : 0;
    return new THREE.Vector3(sec.x + sec.rx * (lat * bump + lean), sec.y - 14 + (up + 14 * Math.sin(th)) * bump - sink, sec.z + sec.rz * (lat * bump + lean));
  };
  const ends: THREE.Vector3[][] = [[], []];
  sections.forEach((sec, i) => {
    // Portals: the vault is lower and narrower at both ends, like a cave mouth.
    const mouth = smoothstep(0, 0.16, Math.min(sec.u, 1 - sec.u));
    const half = m.halfWidth * (0.62 + 0.38 * mouth);
    const roof = m.roof * (0.45 + 0.55 * mouth);
    for (let j = -1; j <= M; j++) {
      const v = archPoint(sec, i, j, half, roof);
      pos.push(v.x, v.y, v.z);
      if (j >= 0 && j < M && (i === 0 || i === sections.length - 1)) ends[i === 0 ? 0 : 1].push(v);
    }
  });
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < K - 1; j++) {
      const a = i * K + j;
      idx.push(a, a + K, a + 1, a + 1, a + K, a + K + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Two skins: the INSIDE of the vault is dark mottled rock with strata (what you see while driving through it); the
  // OUTSIDE (a hair larger) is a rocky hillside: banded cliff rock with only a little scrubby moss. One shell can only
  // have one colour per vertex, hence two meshes. Which side faces out depends on the triangle winding, so test one top vertex.
  const nor = g.getAttribute('normal');
  const p = g.getAttribute('position');
  const topVertex = Math.floor(N / 2) * K + Math.floor(K / 2);
  const outward = nor.getY(topVertex) > 0 ? 1 : -1;
  const base = (k: number) => {
    const n = fbm3(p.getX(k) * 0.07, p.getY(k) * 0.07, p.getZ(k) * 0.07, 3, 3);
    const strata = 0.5 + 0.5 * Math.sin(p.getY(k) * 0.45 + n * 4);
    return { n, c: _c.copy(ROCK_DARK).lerp(ROCK, 0.3 + 0.5 * n + 0.2 * strata) };
  };
  const inside: number[] = [];
  const outside: number[] = [];
  const outPos: number[] = [];
  const foot = Math.min(...sections.map((q) => q.y)) - 14;
  for (let k = 0; k < p.count; k++) {
    const { n, c } = base(k);
    inside.push(c.r * 0.38, c.g * 0.38, c.b * 0.48);
    // Outside: warm grey-brown cliff with broad horizontal strata, paler in the sun-facing tops, darker and cooler toward
    // the depths (the abyss), a thin moss tint only on the flattest top.
    const y = p.getY(k);
    const band = 0.5 + 0.5 * Math.sin(y * 0.22 + n * 5);
    c.copy(ROCK_DARK).lerp(ROCK_WARM, 0.15 + 0.7 * n + 0.45 * band * band);
    c.multiplyScalar(0.5 + 0.45 * smoothstep(foot - 70, foot + 10, y));
    const topness = smoothstep(0.55, 0.9, nor.getY(k) * outward) * smoothstep(0, 20, y - foot);
    c.lerp(GRASS.clone().multiplyScalar(0.7 + 0.4 * n), topness * 0.35 * smoothstep(0.45, 0.65, n));
    outside.push(c.r, c.g, c.b);
    outPos.push(p.getX(k) + nor.getX(k) * outward * 0.7, p.getY(k) + nor.getY(k) * outward * 0.7, p.getZ(k) + nor.getZ(k) * outward * 0.7);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(inside, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: outward > 0 ? THREE.BackSide : THREE.FrontSide });
  const shell = new THREE.Mesh(g, mat);
  shell.castShadow = true;
  shell.frustumCulled = false;
  const g2 = g.clone();
  g2.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
  g2.setAttribute('color', new THREE.Float32BufferAttribute(outside, 3));
  g2.computeVertexNormals();
  const skin = new THREE.Mesh(g2, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: outward > 0 ? THREE.FrontSide : THREE.BackSide }));
  skin.castShadow = true;
  skin.receiveShadow = true;
  skin.frustumCulled = false;
  shell.add(skin);
  // The cave mouths: a thick, lumpy rock arch framing each end of the vault (a tube along the end section's arch, a
  // little proud of the hillside), so the entry and exit read as openings in a cliff, not as a hole in a blob.
  const arches: THREE.BufferGeometry[] = [];
  ends.forEach((ring, e) => {
    const axis = new THREE.Vector3(sections[e ? N - 1 : 0].x - sections[e ? N - 2 : 1].x, 0, sections[e ? N - 1 : 0].z - sections[e ? N - 2 : 1].z).normalize();
    const path = ring.map((v) => v.clone().addScaledVector(axis, 1.5));
    const radii = ring.map((_, j) => 3.4 + 2.2 * Math.sin((j / (M - 1)) * Math.PI) + 1.6 * (fbm3(j * 0.5, e * 7.3, 1.9, 4, 2) - 0.5));
    arches.push(paint(tubeGeo(path, radii, 9), (q, nn) => {
      const n = fbm3(q.x * 0.12, q.y * 0.12, q.z * 0.12, 6, 3);
      return _c.copy(ROCK_DARK).lerp(ROCK_WARM, 0.45 + 0.5 * n + 0.15 * nn.y);
    }));
  });
  const arch = new THREE.Mesh(merge(arches), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  arch.castShadow = true;
  arch.receiveShadow = true;
  arch.frustumCulled = false;
  shell.add(arch);
  // Surface points (for the glowing mushrooms): random spots on the inside of the vault.
  for (let k = 0; k < 1100; k++) {
    const i = 1 + Math.floor(rnd() * (N - 3));
    const j = 2 + Math.floor(rnd() * (M - 3)); // (column 0 is the sunken foot; the arch itself is columns 1..M)
    const a = i * K + j;
    const nx = nor.getX(a);
    const ny = nor.getY(a);
    const nz = nor.getZ(a);
    // Normals point out of the cave on one side; flip so they point into the cave (toward the axis).
    const sec = sections[i];
    const toCentre = (sec.x - p.getX(a)) * nx + (sec.y + 10 - p.getY(a)) * ny + (sec.z - p.getZ(a)) * nz;
    const f = toCentre < 0 ? -1 : 1;
    surface.push({ x: p.getX(a), y: p.getY(a), z: p.getZ(a), nx: nx * f, ny: ny * f, nz: nz * f });
  }
  return { shell, points: surface };
}

/** A small glowing mushroom (stalk + dome), radius ~1, standing on y = 0: vertex colours are white (instance colour tints it). */
function glowMushroomGeo(): THREE.BufferGeometry {
  const profile: [number, number][] = [
    [0.1, 0],
    [0.12, 0.35],
    [0.1, 0.6],
    [0.55, 0.62],
    [0.85, 0.78],
    [0.95, 0.98],
    [0.7, 1.22],
    [0.35, 1.38],
    [0, 1.42],
  ];
  // Saturated body, a dim stalk and a small, much brighter core on the dome (HDR, so only the core blooms white).
  return paint(latheGeo(profile, 8), (p) => _c.setScalar(0.22 + 0.55 * smoothstep(0.55, 1.0, p.y) + 1.6 * smoothstep(1.28, 1.42, p.y)));
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/** What `updateKarts` needs of a kart. */
export interface WobbleKart {
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  grounded: boolean;
}

/** Squash-and-stretch of one orange cap after a bounce, as the vertical scale at time `t` seconds after the bounce. */
export function wobbleScale(t: number): number {
  if (t < 0) return 1;
  // Starts squashed (the trampoline is pushed down), springs past 1, then rings down.
  return 1 - 0.34 * Math.exp(-3.4 * t) * Math.cos(2 * Math.PI * 2.7 * t);
}

/** Everything Mushroom Valley adds to a TrackView: caps, mist, the cave and its glowing mushrooms. */
export class MushroomView {
  readonly group = new THREE.Group();
  private readonly orange: Cap[];
  private readonly instanced: THREE.InstancedMesh | null = null;
  /** Time (s, view clock) of each orange cap's last bounce; -1000 = never. */
  private readonly hitAt: number[];
  private clock = 0;
  private readonly m = new THREE.Matrix4();
  private readonly glow: THREE.InstancedMesh | null = null;
  /** The glowing rims of the orange caps (instanced like the caps themselves) and their material (pulsed in `update`). */
  private rims: THREE.InstancedMesh | null = null;
  private rimMat: THREE.MeshBasicMaterial | null = null;
  /** Soft coloured light pools on the cave floor (material pulsed in `update`). */
  private poolMat: THREE.MeshBasicMaterial | null = null;

  constructor(track: Track) {
    const caps = new Bouncers(track).caps;
    const def = track.def.scenery.mushroom!;
    // ---- caps and stalks -------------------------------------------------------------------------------
    const orangeGeo = capGeo('orange', 11);
    const greenGeos = [capGeo('green', 21), capGeo('green', 22), capGeo('green', 23)];
    // One static mesh per stretch of road (about 150 m), so the caps far away are culled with their mesh.
    const capAreas = new Map<number, THREE.BufferGeometry[]>();
    const capMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
    caps.forEach((c, i) => {
      const key = Math.floor(track.project(c.x, c.z).s / 150);
      if (!capAreas.has(key)) capAreas.set(key, []);
      const list = capAreas.get(key)!;
      // The mist level under this cap: a fixed depth below it.
      list.push(stalkGeo(c, c.y - 14));
      if (c.kind === 'green') list.push(placed(greenGeos[i % 3], matrix(c.x, c.y, c.z, c.radius, c.radius, c.radius, (i * 1.7) % 6.28)));
    });
    for (const list of capAreas.values()) {
      const mesh = new THREE.Mesh(merge(list), capMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.orange = caps.filter((c) => c.kind === 'orange');
    this.hitAt = this.orange.map(() => -1000);
    if (this.orange.length) {
      const inst = new THREE.InstancedMesh(orangeGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: new THREE.Color('#ff5a00'), emissiveIntensity: 0.1 }), this.orange.length);
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      this.instanced = inst;
      // The glowing rim: the same matrices as the caps, so it squashes with them.
      this.rimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.0, 0.12), side: THREE.DoubleSide, fog: true });
      this.rims = new THREE.InstancedMesh(rimGlowGeo(), this.rimMat, this.orange.length);
      this.rims.frustumCulled = false;
      this.orange.forEach((_, i) => this.setCapMatrix(i, 1));
      this.group.add(inst, this.rims);
    }

    // ---- mist ------------------------------------------------------------------------------------------
    const areas: { x: number; z: number; w: number; d: number; rot: number; y: number }[] = [];
    for (const g of def.gorges) {
      const s0 = track.sAt(g.from);
      const s1 = track.sAt(g.to);
      const mid = track.pointAt((s0 + track.deltaS(s0, s1) / 2 + track.length) % track.length);
      const len = track.deltaS(s0, s1);
      areas.push({ x: mid.x, z: mid.z, w: 150, d: len + 90, rot: mid.heading, y: mid.y - 4 });
    }
    {
      // The cave pit: one big layer stack over the bounding box of the cave's section.
      const { sections, centreOffset } = caveSections(track);
      const mid = sections[Math.floor(sections.length / 2)];
      // Centred on the vault (it lies to one side of the main road) and turned along the road.
      areas.push({ x: mid.x + mid.rx * centreOffset, z: mid.z + mid.rz * centreOffset, w: 170, d: sections.length * 9 + 80, rot: Math.atan2(-mid.rz, mid.rx), y: mid.y - 16 });
    }
    this.group.add(buildMist(areas, { gap: 12, alphas: [0.35, 0.55, 0.75, 0.9, 1.0] }));

    // ---- backdrop: a sea of cloud far below the massif (valleys hidden) and a ring of distant snowy ranges -------
    const ctr = track.samples.reduce((a, q) => ({ x: a.x + q.x / track.samples.length, z: a.z + q.z / track.samples.length }), { x: 0, z: 0 });
    this.group.add(buildMist([{ x: ctr.x, z: ctr.z, w: 3600, d: 3600, rot: 0.3, y: 24 }], { layers: 2, gap: 15, alphas: [0.78, 0.95], dark: 0.5, tile: 16 }));
    this.group.add(buildFarPeaks(ctr.x, ctr.z, new THREE.Color(track.def.theme.horizon)));

    // ---- cave --------------------------------------------------------------------------------------------
    const cave = buildCave(track);
    this.group.add(cave.shell);
    const count = def.glow ?? 90;
    const rnd = seededRandom(909);
    const glow = new THREE.InstancedMesh(glowMushroomGeo(), new THREE.MeshBasicMaterial({ vertexColors: true }), count);
    const palette = [new THREE.Color(0.0, 1.5, 1.05), new THREE.Color(0.55, 0.08, 2.2), new THREE.Color(1.9, 0.03, 0.85), new THREE.Color(0.12, 1.9, 0.1)];
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const sp = cave.points[Math.floor(rnd() * cave.points.length)];
      const s = 0.5 + rnd() * rnd() * 2.0;
      const dir = new THREE.Vector3(sp.nx, sp.ny, sp.nz).normalize();
      q.setFromUnitVectors(up, dir);
      this.m.compose(new THREE.Vector3(sp.x + sp.nx * 0.2, sp.y + sp.ny * 0.2, sp.z + sp.nz * 0.2), q, new THREE.Vector3(s, s, s));
      glow.setMatrixAt(i, this.m);
      glow.setColorAt(i, palette[Math.floor(rnd() * palette.length)]);
    }
    glow.frustumCulled = false;
    this.glow = glow;
    this.group.add(glow);

    // ---- stalactites, floor mushrooms and coloured light pools in the cave -----------------------------------
    const roof = cave.points.filter((p) => p.ny < -0.55);
    if (roof.length) {
      const sg = new THREE.ConeGeometry(1, 1, 6, 1, true);
      sg.rotateX(Math.PI); // point down
      sg.translate(0, -0.5, 0); // hang from y = 0
      const count2 = 110;
      const sm = new THREE.InstancedMesh(sg, new THREE.MeshStandardMaterial({ color: '#5b5260', roughness: 1, flatShading: true }), count2);
      for (let i = 0; i < count2; i++) {
        const sp = roof[Math.floor(rnd() * roof.length)];
        const r = 0.5 + rnd() * rnd() * 1.6;
        const len = 2 + rnd() * 6 + r * 2;
        this.m.compose(new THREE.Vector3(sp.x, sp.y + 0.15, sp.z), new THREE.Quaternion().setFromAxisAngle(up, rnd() * 6.28), new THREE.Vector3(r, len, r));
        sm.setMatrixAt(i, this.m);
      }
      sm.frustumCulled = false;
      this.group.add(sm);
    }
    {
      // Glowing mushrooms standing on the floor beside the road (the left shoulder), and a light pool under some of them.
      const { sections } = caveSections(track);
      const floor = new THREE.InstancedMesh(glowMushroomGeo(), new THREE.MeshBasicMaterial({ vertexColors: true }), 56);
      const pools: { x: number; y: number; z: number; c: THREE.Color; r: number }[] = [];
      for (let i = 0; i < 56; i++) {
        const sec = sections[1 + Math.floor(rnd() * (sections.length - 2))];
        const lat = -(8.5 + rnd() * 4);
        const x = sec.x + sec.rx * lat;
        const z = sec.z + sec.rz * lat;
        const s = 0.5 + rnd() * rnd() * 1.4;
        const col = palette[Math.floor(rnd() * palette.length)];
        this.m.compose(new THREE.Vector3(x, sec.y + 0.05, z), new THREE.Quaternion().setFromAxisAngle(up, rnd() * 6.28), new THREE.Vector3(s, s, s));
        floor.setMatrixAt(i, this.m);
        floor.setColorAt(i, col);
        if (i % 3 === 0) pools.push({ x, y: sec.y + 0.14, z, c: col, r: 5 + s * 3 });
      }
      floor.frustumCulled = false;
      this.group.add(floor);
      // Light pools: additive soft discs (a radial gradient on a canvas): cheap "coloured light" without real lights.
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const cx = cv.getContext('2d')!;
      const gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0.28)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      cx.fillStyle = gr;
      cx.fillRect(0, 0, 64, 64);
      const poolTex = new THREE.CanvasTexture(cv);
      this.poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: new THREE.Color(0.55, 0.55, 0.55), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
      const pg = new THREE.PlaneGeometry(2, 2);
      pg.rotateX(-Math.PI / 2);
      const poolMesh = new THREE.InstancedMesh(pg, this.poolMat, pools.length);
      pools.forEach((p, i) => {
        this.m.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion(), new THREE.Vector3(p.r, 1, p.r));
        poolMesh.setMatrixAt(i, this.m);
        poolMesh.setColorAt(i, p.c);
      });
      poolMesh.frustumCulled = false;
      poolMesh.renderOrder = 3;
      this.group.add(poolMesh);
    }
  }

  private setCapMatrix(i: number, sy: number): void {
    const c = this.orange[i];
    const sxz = c.radius / Math.sqrt(sy);
    this.m.compose(new THREE.Vector3(c.x, c.y, c.z), new THREE.Quaternion(), new THREE.Vector3(sxz, c.radius * sy, sxz));
    this.instanced!.setMatrixAt(i, this.m);
    this.rims?.setMatrixAt(i, this.m);
  }

  /** Advance the wobbles and the glow. `time` is the shared environment clock (s). */
  update(time: number): void {
    ENV_TIME.value = time;
    this.clock = time;
    if (this.instanced) {
      let dirty = false;
      for (let i = 0; i < this.orange.length; i++) {
        const t = time - this.hitAt[i];
        if (t < 2.2) {
          this.setCapMatrix(i, wobbleScale(t));
          dirty = true;
        } else if (t < 2.3) {
          this.setCapMatrix(i, 1);
          dirty = true;
        }
      }
      if (dirty) {
        this.instanced.instanceMatrix.needsUpdate = true;
        if (this.rims) this.rims.instanceMatrix.needsUpdate = true;
      }
    }
    // The orange rims breathe (brighter than the paint, so they bloom): bouncy caps stand out from the green ones.
    if (this.rimMat) {
      const k = 1 + 0.25 * Math.sin(time * 3.1);
      this.rimMat.color.setRGB(2.4 * k, 1.0 * k, 0.12 * k);
    }
    if (this.poolMat) this.poolMat.color.setScalar(0.5 + 0.12 * Math.sin(time * 0.9));
    if (this.glow) (this.glow.material as THREE.MeshBasicMaterial).color.setScalar(0.85 + 0.15 * Math.sin(time * 1.3));
  }

  /** Start a wobble on any orange cap a kart has just been thrown off (it is on the cap and moving up fast). */
  updateKarts(karts: Iterable<WobbleKart>): void {
    if (!this.instanced) return;
    for (const k of karts) {
      if (k.vel.y < 6) continue;
      for (let i = 0; i < this.orange.length; i++) {
        const c = this.orange[i];
        const dx = k.pos.x - c.x;
        const dz = k.pos.z - c.z;
        if (dx * dx + dz * dz > c.radius * c.radius || k.pos.y - c.y > 2.5 || k.pos.y - c.y < -0.7) continue;
        if (this.clock - this.hitAt[i] > 0.5) this.hitAt[i] = this.clock;
      }
    }
  }
}
