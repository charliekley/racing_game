/**
 * Materials for the environment, all based on MeshStandardMaterial so they pick up the
 * scene's lights (and, when the render pipeline adds one, the environment map and tone
 * mapping) with no extra work.
 *
 * Three.js lets us splice our own GLSL into a built-in material with `onBeforeCompile`.
 * That keeps the lighting, fog and shadow code of the standard shader and just adds:
 *   - wind sway for foliage (vertices move by their baked `sway` weight),
 *   - waving cloth for flags,
 *   - world-space colour noise on terrain and rock so big surfaces are never flat.
 */
import * as THREE from 'three';
import { envQuality } from './batch';
import type { SurfaceMaps } from '../textures';

/** Shared animation clock (seconds). TrackView.update() advances it once per frame. */
export const ENV_TIME = { value: 0 };

/** GLSL value noise + fbm, shared by the ground/rock/lava/water shaders. */
export const GLSL_NOISE = /* glsl */ `
float envHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float envNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(envHash(i), envHash(i + vec2(1.0, 0.0)), f.x), mix(envHash(i + vec2(0.0, 1.0)), envHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float envFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * envNoise(p);
    p = p * 2.03 + 11.7;
    a *= 0.5;
  }
  return s;
}
`;

/** The noise texture spans this many noise cells (the `p` units of envNoise) before it repeats. */
const NOISE_CELLS = 64;
/** Texels per noise cell (bilinear filtering smooths between them). */
const NOISE_TEXELS = 4;
let noiseTex: THREE.DataTexture | null = null;

/**
 * The same kind of value noise as `envNoise` / `envFbm`, but computed ONCE on the CPU into a small
 * repeating texture: R = one noise layer, G = four layers (fbm). Reading a texture is one GPU
 * instruction; the GLSL version costs four hashes per layer for every pixel, which on an integrated
 * GPU adds up to milliseconds for the ground that fills half of every view. Mipmaps also blur the
 * fine speckle away in the distance instead of letting it shimmer. Used on Medium and Low.
 */
export function noiseTexture(): THREE.DataTexture {
  if (noiseTex) return noiseTex;
  const size = NOISE_CELLS * NOISE_TEXELS;
  // Random value per lattice point; the lattice wraps around so the texture tiles seamlessly.
  const lattice = (period: number, seed: number) => {
    const v = new Float32Array(period * period);
    let s = seed;
    for (let i = 0; i < v.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0; // tiny LCG random generator: same texture every run
      v[i] = s / 4294967296;
    }
    return v;
  };
  // Smooth value noise at (x, y) measured in lattice cells, wrapping at `period`.
  const noise = (v: Float32Array, period: number, x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let fx = x - ix;
    let fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number) => v[(((j % period) + period) % period) * period + (((i % period) + period) % period)];
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
    return a + (b - a) * fy;
  };
  // Octave k has 2^k times as many cells, so every layer still repeats exactly at the texture edge.
  const octaves = [0, 1, 2, 3].map((k) => lattice(NOISE_CELLS << k, 1234 + k * 977));
  const data = new Uint8Array(size * size * 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = (x + 0.5) / NOISE_TEXELS;
      const cy = (y + 0.5) / NOISE_TEXELS;
      const one = noise(octaves[0], NOISE_CELLS, cx, cy);
      let fbm = 0;
      for (let k = 0; k < 4; k++) fbm += 0.5 ** (k + 1) * noise(octaves[k], NOISE_CELLS << k, cx * 2 ** k, cy * 2 ** k);
      data[(y * size + x) * 2] = Math.round(one * 255);
      data[(y * size + x) * 2 + 1] = Math.round(fbm * 255);
    }
  }
  noiseTex = new THREE.DataTexture(data, size, size, THREE.RGFormat, THREE.UnsignedByteType);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

/** GLSL for the texture version: same names and scale as envNoise / envFbm with a `tex` prefix. */
const GLSL_TEX_NOISE = /* glsl */ `
uniform sampler2D uNoiseTex;
float texNoise(vec2 p) { return texture2D(uNoiseTex, p * ${(1 / NOISE_CELLS).toFixed(6)}).r; }
float texFbm(vec2 p) { return texture2D(uNoiseTex, p * ${(1 / NOISE_CELLS).toFixed(6)}).g; }
`;

/** Marks a mesh so it reports the active quality preset to the LOD code (shadows off = Low). */
export function watchQuality(mesh: THREE.Object3D): void {
  const prev = mesh.onBeforeRender;
  mesh.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
    envQuality.low = !renderer.shadowMap.enabled;
    prev.call(this, renderer, scene, camera, geometry, material, group);
  };
}

/** Trees, bushes, rocks, buildings: vertex-coloured, matte, with gentle wind sway. */
export function propMaterial(roughness = 0.88): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = ENV_TIME;
    shader.vertexShader =
      'attribute float sway;\nuniform float uTime;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
          float ph = uTime * 1.5 + wp.x * 0.13 + wp.z * 0.11;
          transformed.x += sin(ph) * 0.06 * sway;
          transformed.z += cos(ph * 0.9 + 1.3) * 0.05 * sway;
          transformed.y += sin(ph * 1.7) * 0.012 * sway;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'env-prop-sway';
  return mat;
}

/** Flags and pennants: vertices ripple along their normal, more the farther from the pole (`sway`). */
export function clothMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = ENV_TIME;
    shader.vertexShader =
      'attribute float sway;\nuniform float uTime;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
          float w = sin(uTime * 5.0 - sway * 7.0 + wp.x * 0.9 + wp.z * 0.7) * 0.5 + sin(uTime * 8.3 - sway * 11.0 + wp.z * 0.5) * 0.25;
          transformed += normal * w * sway * 0.35;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'env-cloth';
  return mat;
}

/** Lit textured banner sheet (rigid). */
export function bannerMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map, roughness: 0.7, metalness: 0 });
}

/** Self-lit vertex colours (window glow, lava rocks, embers). Colours > 1 are fine: they bloom. */
export function glowMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
}

export interface GroundOpts {
  /** Strength of the large-scale colour mottling (0..1). */
  mottle?: number;
  /** Fine speckle strength. */
  speckle?: number;
  /** Horizontal rock strata bands (cliff faces), 0 = none. */
  strata?: number;
  roughness?: number;
  side?: THREE.Side;
  polygonOffset?: number;
  /** Pipeline texture set (map + normal + roughness); the UVs decide the tiling. */
  maps?: SurfaceMaps;
}

/**
 * Terrain / rock material: vertex colours carry the biome (grass, rock, snow...); world-space
 * noise breaks up the large flat areas with soft mottling and fine speckle, and cliffs get
 * horizontal strata lines. No texture files, no UVs needed.
 */
export function groundMaterial(o: GroundOpts = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: o.roughness ?? 0.95, metalness: 0, side: o.side ?? THREE.FrontSide });
  if (o.maps) {
    mat.map = o.maps.map;
    mat.normalMap = o.maps.normalMap;
    mat.roughnessMap = o.maps.roughnessMap;
    mat.roughness = 1;
  }
  if (o.polygonOffset) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -o.polygonOffset;
    mat.polygonOffsetUnits = -o.polygonOffset;
  }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMottle = { value: o.mottle ?? 0.35 };
    shader.uniforms.uSpeckle = { value: o.speckle ?? 0.12 };
    shader.uniforms.uStrata = { value: o.strata ?? 0 };
    // Fixed at compile time (applySceneQuality recompiles when the preset changes). High computes the noise
    // in the shader; Medium/Low read the same kind of noise from a texture (see noiseTexture).
    const cheap = envQuality.cheap;
    const noise = cheap ? 'texNoise' : 'envNoise';
    if (cheap) shader.uniforms.uNoiseTex = { value: noiseTexture() };
    shader.vertexShader = 'varying vec3 vEnvWorld;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vEnvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader =
      'varying vec3 vEnvWorld;\nuniform float uMottle;\nuniform float uSpeckle;\nuniform float uStrata;\n' +
      (cheap ? GLSL_TEX_NOISE : GLSL_NOISE) +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          float big = ${cheap ? 'texFbm' : 'envFbm'}(vEnvWorld.xz * 0.045);
          float mid = ${cheap ? 'texFbm' : 'envFbm'}(vEnvWorld.xz * 0.35 + 3.0);
          float fine = ${noise}(vEnvWorld.xz * 3.2 + vEnvWorld.y * 0.7);
          float k = 1.0 + uMottle * (big - 0.5) * 1.4 + uMottle * 0.5 * (mid - 0.5) + uSpeckle * (fine - 0.5);
          if (uStrata > 0.0) {
            float band = sin(vEnvWorld.y * 1.9 + ${noise}(vEnvWorld.xz * 0.5 + vEnvWorld.y * 0.3) * 6.0) * 0.5 + 0.5;
            k *= 1.0 - uStrata * (0.35 * band * band + 0.25 * ${noise}(vec2(vEnvWorld.x + vEnvWorld.z, vEnvWorld.y * 2.5)));
          }
          diffuseColor.rgb *= k;
        }`,
      );
  };
  mat.customProgramCacheKey = () => `env-ground-${o.strata ?? 0}-${o.mottle ?? 0.35}-${envQuality.cheap ? 'cheap' : 'full'}`;
  return mat;
}
