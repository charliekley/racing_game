/**
 * Water, lava, ice and the cloud sea: animated surfaces drawn with one small custom shader.
 *
 * Shader concepts, briefly:
 *  - A fragment shader runs once per pixel. We invent a surface normal from moving sine
 *    waves (cheaper than real geometry waves) so light glints and ripples appear.
 *  - "Fresnel": looking at water along a grazing angle it acts like a mirror, looking
 *    straight down you see through it. We blend deep colour and reflected sky by
 *    (1 - cos(angle))^3.
 *  - "Foam": each vertex stores `edge` = metres to the nearest shore; near zero we paint
 *    white wobbling bands.
 *  - Lava is a glowing crack pattern (ridged noise) scrolling slowly, colours well above
 *    1.0 so a later bloom pass makes it shine.
 */
import * as THREE from 'three';
import { ENV_TIME, GLSL_NOISE } from './materials';

export type FluidKind = 'water' | 'lava' | 'ice' | 'cloud';

export interface FluidColors {
  /** Sky colour overhead and at the horizon (for reflections). */
  sky: THREE.Color;
  horizon: THREE.Color;
  deep?: THREE.Color;
  shallow?: THREE.Color;
}

const SUN_DIR = new THREE.Vector3(80, 140, 50).normalize();

const VERT = /* glsl */ `
uniform float uTime;
uniform float uWave;
attribute float edge;
varying vec3 vWorld;
varying float vEdge;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.y += uWave * (sin(wp.x * 0.35 + uTime * 1.3) + sin(wp.z * 0.29 - uTime * 1.1) + 0.5 * sin((wp.x + wp.z) * 0.7 + uTime * 2.1));
  vWorld = wp.xyz;
  vEdge = edge;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const COMMON_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSunDir;
varying vec3 vWorld;
varying float vEdge;
#include <fog_pars_fragment>
${GLSL_NOISE}
vec3 skyAt(vec3 dir) {
  return mix(uHorizon, uSky, smoothstep(0.0, 0.7, dir.y));
}
`;

const WATER_FRAG = /* glsl */ `
${COMMON_FRAG}
float waveH(vec2 p) {
  return sin(p.x * 1.7 + uTime * 1.5) * 0.5 + sin(p.y * 2.3 - uTime * 1.2) * 0.4 + sin((p.x + p.y) * 3.1 + uTime * 2.3) * 0.25 + (envNoise(p * 1.9 + uTime * 0.35) - 0.5) * 0.9;
}
void main() {
  vec2 p = vWorld.xz;
  float e = 0.12;
  float h0 = waveH(p);
  float hx = waveH(p + vec2(e, 0.0));
  float hz = waveH(p + vec2(0.0, e));
  vec3 n = normalize(vec3((h0 - hx) * 0.32, e, (h0 - hz) * 0.32));
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  vec3 R = reflect(-V, n);
  vec3 base = mix(uShallow, uDeep, smoothstep(0.0, 5.0, vEdge));
  vec3 col = mix(base, skyAt(R), clamp(0.16 + 0.8 * fres, 0.0, 1.0));
  // sun glint
  float s = pow(max(dot(R, uSunDir), 0.0), 140.0);
  col += vec3(1.0, 0.92, 0.75) * s * 1.6;
  // foam along shores and where waves crest
  float wob = envNoise(p * 1.3 + uTime * 0.25);
  float shore = 1.0 - smoothstep(0.0, 1.5 + wob * 0.6, vEdge);
  float stripes = 0.55 + 0.45 * sin(vEdge * 5.0 - uTime * 1.6 + wob * 4.0);
  float foam = clamp(shore * stripes + (1.0 - smoothstep(0.0, 0.3, vEdge)) * 0.8, 0.0, 1.0) * (0.55 + 0.45 * envNoise(p * 4.0 + uTime * 0.2));
  col = mix(col, vec3(0.95, 0.98, 1.0), foam * 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const LAVA_FRAG = /* glsl */ `
${COMMON_FRAG}
void main() {
  vec2 p = vWorld.xz * 0.05;
  vec2 flow = vec2(uTime * 0.015, uTime * 0.009);
  float warp = envFbm(p * 1.6 + flow * 2.0);
  float n = envFbm(p * 2.2 + warp * 1.8 + flow);
  float ridge = 1.0 - abs(n * 2.0 - 1.0);
  float crack = smoothstep(0.72, 0.97, ridge);
  float pulse = 0.85 + 0.15 * sin(uTime * 1.4 + n * 9.0);
  vec3 crust = vec3(0.05, 0.02, 0.015) + vec3(0.04, 0.012, 0.0) * envFbm(p * 9.0);
  vec3 molten = mix(vec3(1.7, 0.32, 0.03), vec3(4.0, 1.5, 0.25), crack) * pulse;
  float molt = smoothstep(0.35, 0.8, ridge);
  vec3 col = mix(crust, molten, molt * (0.35 + 0.65 * crack) + crack * 0.4);
  // glowing rim where the lava meets rock
  col += vec3(3.0, 0.9, 0.15) * (1.0 - smoothstep(0.0, 2.5, vEdge)) * 0.9;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const ICE_FRAG = /* glsl */ `
${COMMON_FRAG}
void main() {
  vec2 p = vWorld.xz;
  vec3 V = normalize(cameraPosition - vWorld);
  // Frozen surface: tiny bumps + long crack lines.
  float b = envNoise(p * 2.0) + envNoise(p * 7.0) * 0.5;
  float cr = 1.0 - abs(envFbm(p * 0.35 + 7.0) * 2.0 - 1.0);
  float crack = smoothstep(0.93, 0.995, cr);
  vec3 n = normalize(vec3((envNoise(p * 3.0 + 1.0) - 0.5) * 0.12, 1.0, (envNoise(p * 3.0 + 9.0) - 0.5) * 0.12));
  float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
  vec3 R = reflect(-V, n);
  vec3 base = mix(uShallow, uDeep, 0.35 + 0.35 * envFbm(p * 0.18));
  base = mix(base, vec3(0.93, 0.97, 1.0), crack * 0.6 + 0.1 * b);
  vec3 col = mix(base, skyAt(R), 0.1 + 0.8 * fres);
  col += vec3(1.0, 0.95, 0.85) * pow(max(dot(R, uSunDir), 0.0), 60.0) * 0.9; // sheen
  col = mix(col, vec3(0.95, 0.98, 1.0), (1.0 - smoothstep(0.0, 1.2, vEdge)) * 0.6);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const CLOUD_FRAG = /* glsl */ `
${COMMON_FRAG}
void main() {
  vec2 p = vWorld.xz * 0.012;
  vec2 drift = vec2(uTime * 0.004, uTime * 0.002);
  float c = envFbm(p + drift) * 0.7 + envFbm(p * 3.1 - drift * 2.0) * 0.3;
  float puff = smoothstep(0.32, 0.72, c);
  // light from the sun side: brighten where the noise gradient faces the sun
  float c2 = envFbm(p + drift + uSunDir.xz * 0.012);
  float lit = clamp(0.62 + (c - c2) * 7.0, 0.0, 1.0);
  vec3 shade = mix(uDeep, uShallow, lit);
  vec3 col = mix(uDeep * 0.9, shade, puff);
  col = mix(col, vec3(1.0), puff * puff * 0.35);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function fluidMaterial(kind: FluidKind, c: FluidColors, wave = 0): THREE.ShaderMaterial {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: ENV_TIME,
      uWave: { value: wave },
      uSky: { value: c.sky },
      uHorizon: { value: c.horizon },
      uDeep: { value: c.deep ?? new THREE.Color('#0d4a86') },
      uShallow: { value: c.shallow ?? new THREE.Color('#2fa4c8') },
      uSunDir: { value: SUN_DIR },
    },
  ]);
  // merge() clones uniform values: re-point the shared clock so one update drives every fluid.
  uniforms.uTime = ENV_TIME;
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: kind === 'water' ? WATER_FRAG : kind === 'lava' ? LAVA_FRAG : kind === 'ice' ? ICE_FRAG : CLOUD_FRAG,
    fog: true,
    toneMapped: true,
  });
}

/**
 * A flat grid from (x0, z0) to (x1, z1) at height y. `edge` per vertex = metres to the nearest
 * border of the rectangle (for foam / rim glow); `edgeFn` can override with a custom distance.
 */
export function gridPlane(x0: number, z0: number, x1: number, z1: number, y: number, cell: number, edgeFn?: (x: number, z: number) => number): THREE.BufferGeometry {
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell));
  const nz = Math.max(1, Math.ceil((z1 - z0) / cell));
  const pos: number[] = [];
  const edge: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx;
      const z = z0 + ((z1 - z0) * j) / nz;
      pos.push(x, y, z);
      edge.push(edgeFn ? edgeFn(x, z) : Math.min(x - x0, x1 - x, z - z0, z1 - z));
    }
  }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  return g;
}

/** A round disc (lake, lava pool) of `radius` at height y; edge = distance to the rim. */
export function discGeo(cx: number, cz: number, radius: number, y: number, segs = 48): THREE.BufferGeometry {
  const rings = 8;
  const pos: number[] = [cx, y, cz];
  const edge: number[] = [radius];
  const idx: number[] = [];
  for (let r = 1; r <= rings; r++) {
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos.push(cx + Math.cos(a) * radius * (r / rings), y, cz + Math.sin(a) * radius * (r / rings));
      edge.push(radius * (1 - r / rings));
    }
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let r = 1; r < rings; r++) {
    for (let j = 0; j < segs; j++) {
      const a = 1 + (r - 1) * segs + j;
      const b = 1 + (r - 1) * segs + ((j + 1) % segs);
      const c = 1 + r * segs + j;
      const d = 1 + r * segs + ((j + 1) % segs);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  return g;
}
