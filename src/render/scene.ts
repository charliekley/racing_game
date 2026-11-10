/**
 * Renderer + scene basics: colour management and tone mapping, lights, the
 * procedural sky (and the environment map made from it), fog, sun shadows and
 * the High/Medium/Low quality presets.
 *
 * Three.js concepts in this file:
 *  - A Scene holds objects (Meshes = Geometry + Material); a Camera looks at it
 *    and the WebGLRenderer draws it into a <canvas>.
 *  - Lighting is computed in LINEAR colour (physically additive). The final
 *    picture must be converted to sRGB for the monitor ("colour space"), and
 *    very bright values (>1) have to be squeezed into the 0..1 range a screen
 *    can show: that squeeze is "tone mapping". Without it bright areas just clip
 *    to flat white. ACES is the film-industry curve: soft highlights, rich contrast.
 *  - Image based lighting: we render the sky into a cube map and convert it
 *    (PMREM = pre-filtered mipmapped radiance) so that every glossy standard
 *    material can reflect the sky and receive soft ambient light from it.
 *  - Shadows: the sun renders a depth picture of the scene from its point of
 *    view (the shadow map); a pixel is in shadow if something is closer to the sun.
 */
import * as THREE from 'three';
import { envQuality } from './env/batch';

export interface QualitySettings {
  name: 'High' | 'Medium' | 'Low';
  /** Cap on device pixel ratio (1 = one rendered pixel per CSS pixel). */
  maxPixelRatio: number;
  /** Multiplier on the pixel ratio (lower = faster, blurrier). */
  renderScale: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Draw the cloud layer. */
  clouds: boolean;
  /** Fraction (0..1) of the small ground detail (grass tufts, flowers) to draw. */
  sceneryDetail: number;
  /** HDR post-processing (bloom, colour grade, vignette). Off = draw straight to the screen. */
  post: boolean;
  /** Number of blur levels in the bloom (each is half the size of the previous; 0 = no bloom). */
  bloomLevels: number;
  /** The first (biggest) bloom level is 1/2^bloomShift of the screen size: 1 = half, 2 = quarter (cheaper). */
  bloomShift: number;
  /** MSAA samples of the HDR render target (hardware anti-aliasing; 0 = none). Costly on integrated GPUs. */
  msaa: number;
  /** FXAA: a cheap edge-smoothing pass on the finished picture. Used instead of MSAA on Medium/Low. */
  fxaa: boolean;
  /** Re-render the shadow map for every split-screen view when the karts are far apart. */
  shadowPerView: boolean;
  /** Half-width (m) of the shadow box around each view in split-screen (smaller = sharper but shorter shadows). */
  shadowRadius: number;
  /** Multiplier on the shadow map size when 3 or 4 viewports share the screen (each view is small, so a smaller map is enough). */
  shadowSplitScale: number;
  /** Multiplies the distances at which scenery switches to its cheap model (and, scaled again, when it is skipped). */
  lodScale: number;
  /** Edge length of the sky cube used for environment lighting. */
  envSize: number;
}

/**
 * The three presets. Rough cost on an integrated GPU (Intel Iris Plus, 4-way split):
 *  High    strong GPUs: 4x MSAA, big shadow map, full bloom, all scenery detail.
 *  Medium  integrated GPUs: FXAA instead of MSAA, 1024 shadow map with a tighter box, 3-level bloom,
 *          70% ground detail and shorter scenery LOD distances in split-screen.
 *  Low     fallback: no shadows or clouds, 75% render scale, FXAA, no bloom, little ground detail.
 */
export const QUALITY_PRESETS: QualitySettings[] = [
  { name: 'High', maxPixelRatio: 2, renderScale: 1, shadows: true, shadowMapSize: 2048, clouds: true, sceneryDetail: 1, post: true, bloomLevels: 6, bloomShift: 1, msaa: 4, fxaa: false, shadowPerView: true, shadowRadius: 55, shadowSplitScale: 1, lodScale: 1, envSize: 256 },
  { name: 'Medium', maxPixelRatio: 1, renderScale: 1, shadows: true, shadowMapSize: 1024, clouds: true, sceneryDetail: 0.7, post: true, bloomLevels: 3, bloomShift: 2, msaa: 0, fxaa: true, shadowPerView: true, shadowRadius: 38, shadowSplitScale: 0.625, lodScale: 0.7, envSize: 128 },
  { name: 'Low', maxPixelRatio: 1, renderScale: 0.75, shadows: false, shadowMapSize: 512, clouds: false, sceneryDetail: 0.35, post: true, bloomLevels: 0, bloomShift: 2, msaa: 0, fxaa: true, shadowPerView: false, shadowRadius: 35, shadowSplitScale: 1, lodScale: 0.55, envSize: 64 },
];
export const DEFAULT_QUALITY = QUALITY_PRESETS[1];

/** Which tone-mapping curve the whole game uses (the post pipeline applies the same one). */
export const TONE_MAPPING = THREE.ACESFilmicToneMapping;

export function createRenderer(parent: HTMLElement, q: QualitySettings = DEFAULT_QUALITY): THREE.WebGLRenderer {
  // `antialias: false`: the canvas itself is never multisampled (that would cost memory and a resolve every
  // frame for nothing); anti-aliasing happens in the post pipeline (MSAA target on High, FXAA otherwise).
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setSize(parent.clientWidth, parent.clientHeight);
  // Output as sRGB (the monitor's colour space) and tone map the HDR result.
  // (With post-processing on, scene rendering goes into a linear float target and the
  // composite pass applies exactly this tone mapping and output conversion instead.)
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = TONE_MAPPING;
  renderer.toneMappingExposure = 1;
  // PCFShadowMap is the soft, filtered shadow type in this Three.js version
  // (PCFSoftShadowMap was folded into it).
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // With split-screen we render the scene several times per frame; the shadow map
  // is re-drawn only when we ask for it (see Game.frame).
  renderer.shadowMap.autoUpdate = false;
  parent.appendChild(renderer.domElement);
  applyRendererQuality(renderer, q);
  return renderer;
}

/** `dynamicScale` (0.6..1) is the adaptive-quality multiplier on top of the preset's own render scale. */
export function applyRendererQuality(renderer: THREE.WebGLRenderer, q: QualitySettings, dynamicScale = 1): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.maxPixelRatio) * q.renderScale * dynamicScale);
  renderer.shadowMap.enabled = q.shadows;
  renderer.shadowMap.needsUpdate = true;
}

/** Shadow map resolution: smaller when the screen is split in 3-4 (each viewport only shows a quarter of the pixels). */
export function setShadowMapSize(sun: THREE.DirectionalLight, q: QualitySettings, viewCount: number): void {
  const size = Math.round((q.shadowMapSize * (viewCount >= 3 ? q.shadowSplitScale : 1)) / 32) * 32;
  if (sun.shadow.mapSize.x !== size) {
    sun.shadow.mapSize.set(size, size);
    sun.shadow.map?.dispose();
    sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
  }
}

/**
 * Apply quality to the scene: sun shadow resolution, and scenery level of
 * detail. Scenery meshes opt in through `userData` (see scenery.ts):
 *   userData.detailIndexCount: full index count; we draw only a fraction of it
 *   userData.cloudLayer: hidden when the preset has clouds off
 * Materials recompile on shadow on/off.
 */
export function applySceneQuality(scene: THREE.Scene, sun: THREE.DirectionalLight, q: QualitySettings, viewCount = 1): void {
  sun.castShadow = q.shadows;
  envQuality.cheap = q.name !== 'High'; // cheaper ground shaders (materials.ts); the needsUpdate below recompiles them
  setShadowMapSize(sun, q, viewCount);
  scene.traverse((o) => {
    const full = o.userData.detailIndexCount as number | undefined;
    if (full !== undefined) (o as THREE.Mesh).geometry.setDrawRange(0, Math.floor((full * q.sceneryDetail) / 3) * 3);
    if (o.userData.cloudLayer) o.visible = q.clouds;
    const m = (o as THREE.Mesh).material;
    // The sky shader has a cheaper cloud variant (fewer noise layers) for Medium and Low.
    if (m instanceof THREE.ShaderMaterial && m.uniforms.sunBoost) {
      if (q.name === 'High') delete m.defines.CHEAP_SKY;
      else m.defines.CHEAP_SKY = '';
    }
    if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
    else if (m) m.needsUpdate = true;
  });
}

// ---------------------------------------------------------------------------
// Looks: the mood of each track
// ---------------------------------------------------------------------------

export type Mood = 'day' | 'dusk' | 'evening' | 'bright' | 'snow' | 'night';

/** Everything that gives a track its lighting mood. All colours are CSS strings. */
export interface Look {
  sunColor: string;
  /** Strength of the directional sun light. */
  sunIntensity: number;
  /** Compass direction of the sun in degrees (0 = towards +x, 90 = towards +z). */
  sunAzimuth: number;
  /** How high the light sits, degrees above the horizon (low = long shadows). */
  sunElevation: number;
  /** Soft sky/ground ambient light. */
  hemiIntensity: number;
  /** How strongly the sky environment map lights and is reflected by standard materials. */
  envIntensity: number;
  /** Brightness before tone mapping. */
  exposure: number;
  fogNear: number;
  fogFar: number;
  /** Bloom strength and the brightness (linear, before tone mapping) above which things glow. */
  bloom: number;
  bloomThreshold: number;
  /** Colour grade: 1 = unchanged. */
  saturation: number;
  contrast: number;
  /** Linear colour multiplier (warm/cool cast). */
  tint: string;
  /** Darkening of the view corners, 0..1. */
  vignette: number;
  /** Stars (0..1) and aurora (0..1) in the sky. */
  stars: number;
  aurora: number;
  /** Cloud amount in the sky dome, 0..1. */
  cloudCover: number;
}

const LOOKS: Record<Mood, Look> = {
  // Plain bright afternoon (also the fallback).
  day: {
    sunColor: '#fff0d4', sunIntensity: 3.0, sunAzimuth: 32, sunElevation: 50, hemiIntensity: 0.9, envIntensity: 0.75,
    exposure: 1.05, fogNear: 160, fogFar: 760, bloom: 0.3, bloomThreshold: 1.0, saturation: 1.12, contrast: 1.04,
    tint: '#ffffff', vignette: 0.25, stars: 0, aurora: 0, cloudCover: 0.45,
  },
  // Volcano at dusk: low orange sun, deep violet sky, glowing horizon, first stars.
  dusk: {
    sunColor: '#ff9d55', sunIntensity: 3.4, sunAzimuth: 25, sunElevation: 32, hemiIntensity: 1.1, envIntensity: 1.0,
    exposure: 1.3, fogNear: 110, fogFar: 620, bloom: 0.55, bloomThreshold: 0.85, saturation: 1.18, contrast: 1.1,
    tint: '#fff0e4', vignette: 0.38, stars: 0.55, aurora: 0, cloudCover: 0.35,
  },
  // Harbour late in the day: warm, long shadows, hazy peach sky.
  evening: {
    sunColor: '#ffc99c', sunIntensity: 3.0, sunAzimuth: 15, sunElevation: 28, hemiIntensity: 0.8, envIntensity: 0.85,
    exposure: 1.12, fogNear: 130, fogFar: 700, bloom: 0.42, bloomThreshold: 0.95, saturation: 1.2, contrast: 1.1,
    tint: '#fff8f2', vignette: 0.32, stars: 0, aurora: 0, cloudCover: 0.5,
  },
  // Sky islands: clear and very bright, a high white sun.
  bright: {
    sunColor: '#fffaf0', sunIntensity: 3.1, sunAzimuth: 50, sunElevation: 58, hemiIntensity: 1.0, envIntensity: 0.9,
    exposure: 1.05, fogNear: 220, fogFar: 1000, bloom: 0.34, bloomThreshold: 1.0, saturation: 1.18, contrast: 1.03,
    tint: '#ffffff', vignette: 0.2, stars: 0, aurora: 0, cloudCover: 0.7,
  },
  // Crisp snow: neutral-cool light; exposure kept low so white snow stays white, not clipped.
  snow: {
    sunColor: '#fff6ea', sunIntensity: 2.3, sunAzimuth: 35, sunElevation: 40, hemiIntensity: 0.95, envIntensity: 0.8,
    exposure: 0.92, fogNear: 150, fogFar: 700, bloom: 0.22, bloomThreshold: 1.15, saturation: 1.1, contrast: 1.06,
    tint: '#f6faff', vignette: 0.22, stars: 0, aurora: 0, cloudCover: 0.4,
  },
  // Not used by the current tracks, but ready: stars, aurora and a cool moon-ish light.
  night: {
    sunColor: '#a9c4ff', sunIntensity: 1.4, sunAzimuth: 30, sunElevation: 35, hemiIntensity: 0.5, envIntensity: 0.7,
    exposure: 1.2, fogNear: 100, fogFar: 600, bloom: 0.7, bloomThreshold: 0.8, saturation: 1.1, contrast: 1.1,
    tint: '#e8eeff', vignette: 0.4, stars: 1, aurora: 0.8, cloudCover: 0.2,
  },
};

/** The part of a track's theme that the sky and lights use. */
export interface SkyTheme {
  sky: string;
  horizon: string;
  grass: string;
  /** Lighting mood preset (see LOOKS). Optional: defaults to 'day'. */
  mood?: Mood;
}

/** The full look for a theme. */
export function lookFor(theme: SkyTheme): Look {
  return LOOKS[theme.mood ?? 'day'] ?? LOOKS.day;
}

/** Unit vector pointing from the ground towards the light, for an azimuth/elevation in degrees. */
function directionOf(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
}

/** How far from its target the sun light sits (it is a parallel light, so this only affects the shadow depth range). */
const SUN_DISTANCE = 200;
/** The sun disc drawn in the sky sits lower than the light so you actually get to see it. */
const SUN_DISC_ELEVATION = 13;

export interface SceneParts {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
}

export function createScene(theme: SkyTheme): SceneParts {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#ffffff', 150, 720);

  const hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight('#ffffff', 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -60;
  s.right = 60;
  s.top = 60;
  s.bottom = -60;
  s.near = 1;
  s.far = SUN_DISTANCE * 2.5;
  // Shadow acne = a surface shadowing itself because of depth precision. `bias` pushes the
  // comparison a hair; `normalBias` moves the lookup point along the surface normal, which
  // removes acne without lifting the shadow off the ground ("peter-panning"). Both are
  // re-scaled to the shadow texel size in followWithSun().
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 2.5; // softness of the PCF edge
  scene.add(sun, sun.target);

  scene.add(createSkyDome(false));
  applyTheme(scene, theme);
  return { scene, sun };
}

/**
 * Re-color an existing scene for another track's theme (sky gradient, fog,
 * lights, environment map) without rebuilding it. Used when the host picks a
 * different track in the lobby. Pass the renderer to also regenerate the
 * environment map (needs the GPU); without it the old map stays.
 */
export function applyTheme(scene: THREE.Scene, theme: SkyTheme, renderer?: THREE.WebGLRenderer, envSize = 128): void {
  const look = lookFor(theme);
  const top = new THREE.Color(theme.sky);
  const horizon = new THREE.Color(theme.horizon);
  scene.background = horizon.clone();
  if (scene.fog) {
    scene.fog.color.copy(horizon);
    (scene.fog as THREE.Fog).near = look.fogNear;
    (scene.fog as THREE.Fog).far = look.fogFar;
  }
  const dir = directionOf(look.sunAzimuth, look.sunElevation);
  scene.userData.sunDir = dir;
  scene.userData.theme = theme;
  scene.environmentIntensity = look.envIntensity;

  scene.traverse((o) => {
    if (o instanceof THREE.HemisphereLight) {
      // Whitened sky colour above and a dark grass tone below keep shaded sides tinted like the world.
      o.color.copy(top).lerp(new THREE.Color('#ffffff'), 0.5);
      o.groundColor.set(theme.grass).multiplyScalar(0.55);
      o.intensity = look.hemiIntensity;
    }
    if (o instanceof THREE.DirectionalLight) {
      o.color.set(look.sunColor);
      o.intensity = look.sunIntensity;
      o.userData.dir = dir;
      o.position.copy(o.target.position).addScaledVector(dir, SUN_DISTANCE);
    }
    const mat = (o as THREE.Mesh).material;
    if (mat instanceof THREE.ShaderMaterial && mat.uniforms.top && mat.uniforms.horizon) setSkyUniforms(mat, theme, look);
  });
  if (renderer) buildEnvironment(renderer, scene, theme, envSize);
}

/**
 * Render the sky into a cube map once and use it as `scene.environment`: soft
 * sky-coloured ambient light plus reflections for glossy paint, metal and visors.
 * The environment sky also has a grass-coloured "ground" below the horizon and a
 * very bright sun so reflections get a proper highlight.
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, theme: SkyTheme, size = 128): void {
  const look = lookFor(theme);
  const envScene = new THREE.Scene();
  const dome = createSkyDome(true);
  setSkyUniforms(dome.material as THREE.ShaderMaterial, theme, look);
  envScene.add(dome);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(envScene, 0, 0.1, 2000, { size });
  pmrem.dispose();
  dome.geometry.dispose();
  (dome.material as THREE.Material).dispose();
  (scene.userData.envTarget as THREE.WebGLRenderTarget | undefined)?.dispose();
  scene.userData.envTarget = target;
  scene.environment = target.texture;
}

function setSkyUniforms(mat: THREE.ShaderMaterial, theme: SkyTheme, look: Look): void {
  const u = mat.uniforms;
  u.top.value = new THREE.Color(theme.sky);
  u.horizon.value = new THREE.Color(theme.horizon);
  u.ground.value = new THREE.Color(theme.grass).multiplyScalar(0.6);
  u.sunColor.value = new THREE.Color(look.sunColor);
  const flat = directionOf(look.sunAzimuth, 0);
  const disc = flat.multiplyScalar(Math.cos(THREE.MathUtils.degToRad(SUN_DISC_ELEVATION))).setY(Math.sin(THREE.MathUtils.degToRad(SUN_DISC_ELEVATION)));
  u.sunDir.value = disc;
  u.cloudCover.value = look.cloudCover;
  u.stars.value = look.stars;
  u.aurora.value = look.aurora;
}

/**
 * Big inverted sphere that paints the sky in its fragment shader: a smooth
 * gradient, a sun disc with glow, drifting soft clouds, and (for night-ish
 * moods) stars and an aurora. One draw call, no textures. The dome is moved to
 * each camera right before it is drawn, so it never gets "closer" on one side.
 *
 * It is drawn LAST among opaque objects: the depth test then rejects every
 * pixel already covered by terrain before the (fairly costly) cloud shader runs.
 */
function createSkyDome(forEnvironment: boolean): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1200, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      ground: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 0.2, 1) },
      sunColor: { value: new THREE.Color('#fff2cf') },
      time: { value: 0 },
      cloudCover: { value: 0.5 },
      stars: { value: 0 },
      aurora: { value: 0 },
      // 1 in the environment map: below the horizon show ground colour instead of fog colour.
      groundMix: { value: forEnvironment ? 1 : 0 },
      // Sun disc brightness: HDR (>1) so it blooms and reflects; stronger still inside the env map.
      sunBoost: { value: forEnvironment ? 12 : 6 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position; // dome is centered on the camera, so this is the view direction
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 ground;
      uniform vec3 sunDir;
      uniform vec3 sunColor;
      uniform float time;
      uniform float cloudCover;
      uniform float stars;
      uniform float aurora;
      uniform float groundMix;
      uniform float sunBoost;
      varying vec3 vDir;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      // Smooth value noise: random values on a grid, blended smoothly between grid points.
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      // Fractal noise: several noise layers, each twice as fine and half as strong.
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        #ifdef CHEAP_SKY
        for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
        v *= 1.14; // three layers cover less range than four: stretch back to about 0..1
        #else
        for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
        #endif
        return v;
      }

      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y;

        // Gradient: a smooth three-stop ramp horizon -> hazy mid sky -> deep sky colour.
        float t = clamp(h, 0.0, 1.0);
        vec3 mid = mix(horizon, top, 0.45);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, t));
        col = mix(col, top, smoothstep(0.05, 0.5, t));
        // Below the horizon: fog colour in the game (so ground melts into sky), ground colour in reflections.
        col = mix(col, mix(horizon, ground, smoothstep(0.0, -0.35, h)), groundMix * step(h, 0.0));

        float d = max(dot(dir, sunDir), 0.0);
        float above = smoothstep(-0.05, 0.08, h);

        // Stars: bright points on a grid, only in the upper sky.
        if (stars > 0.0 && h > 0.0) {
          vec2 sp = dir.xz / (h + 0.35) * 90.0;
          vec2 cell = floor(sp);
          float r = hash(cell);
          vec2 pos = fract(sp) - 0.5;
          float star = smoothstep(0.12, 0.0, length(pos)) * step(0.965, r);
          star *= 0.6 + 0.4 * sin(time * 2.0 + r * 60.0);
          col += vec3(1.0, 0.95, 0.85) * star * stars * smoothstep(0.05, 0.4, h) * 2.0;
        }

        // Aurora: slow green/teal curtains.
        if (aurora > 0.0 && h > 0.05) {
          float band = noise(vec2(dir.x * 3.0 + time * 0.05, dir.z * 3.0)) * 0.5 + fbm(vec2(dir.x, dir.z) * 5.0 + time * 0.03) * 0.8;
          float curtain = smoothstep(0.35, 0.8, band) * smoothstep(0.05, 0.3, h) * smoothstep(0.9, 0.4, h);
          col += mix(vec3(0.1, 1.0, 0.5), vec3(0.4, 0.3, 1.0), h) * curtain * aurora * 0.5;
        }

        // Clouds: noise on a flat layer overhead, projected so they shrink towards the horizon.
        // The layer drifts slowly with time; thresholds below make soft puffy edges.
        if (h > 0.0 && cloudCover > 0.0) {
          vec2 cp = dir.xz / (h + 0.22) * 1.3 + vec2(time * 0.012, time * 0.004);
          float base = fbm(cp);
          float n = base * 0.75 + fbm(cp * 2.7 + 9.0) * 0.25;
          float dens = smoothstep(1.0 - cloudCover * 0.6 - 0.18, 1.0 - cloudCover * 0.6 + 0.12, n);
          dens *= smoothstep(0.0, 0.14, h); // fade out into the haze at the horizon
          // Light: the side of a puff facing the sun is bright, the rest picks up the sky colour.
          #ifdef CHEAP_SKY
          // Cheaper: re-use the cloud noise and shift only its first (biggest) layer towards the sun.
          float lit = base + (noise(cp + sunDir.xz * 0.15) - noise(cp)) * 0.57;
          #else
          float lit = fbm(cp + sunDir.xz * 0.15);
          #endif
          float shade = clamp(0.55 + (n - lit) * 3.0, 0.0, 1.0);
          vec3 cloudCol = mix(top * 0.55 + horizon * 0.35, vec3(1.0), shade) * mix(vec3(1.0), sunColor, 0.25 + 0.5 * pow(d, 4.0));
          col = mix(col, cloudCol, dens * 0.9);
        }

        // Sun: wide warm haze + tighter glow + crisp (HDR) disc.
        col += sunColor * (pow(d, 6.0) * 0.2 + pow(d, 48.0) * 0.4) * above;
        col += sunColor * smoothstep(0.9988, 0.9995, d) * sunBoost * above;

        gl_FragColor = vec4(col, 1.0);
        // Same tone mapping + sRGB encoding as every other material, so the sky matches the fog colour.
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.frustumCulled = false;
  if (!forEnvironment) {
    dome.renderOrder = 9999; // last opaque object, see above
    mat.depthTest = true;
    // Called once per camera (split-screen): recenter the dome on that camera, and advance cloud drift.
    dome.onBeforeRender = (_r, _s, camera) => {
      dome.position.copy(camera.position);
      dome.updateMatrixWorld();
      mat.uniforms.time.value = performance.now() / 1000;
    };
  }
  return dome;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const SUN_RIGHT = new THREE.Vector3();
const SUN_UP = new THREE.Vector3();
const SUN_FOCUS = new THREE.Vector3();

/**
 * Point the sun's shadow box at a spot on the ground and make it `radius` wide.
 *
 * A bigger radius covers more of the track but spreads the same number of shadow
 * texels over more ground (blurrier). Two refinements:
 *  - the box is moved in whole-texel steps in light space, so shadow edges don't
 *    shimmer when the focus point creeps along;
 *  - bias values are scaled with the texel size, so acne and peter-panning stay
 *    controlled at every radius.
 */
export function followWithSun(sun: THREE.DirectionalLight, x: number, z: number, radius = 60): void {
  const dir = (sun.userData.dir as THREE.Vector3 | undefined) ?? directionOf(32, 50);
  const r = Math.max(30, radius);
  const texel = (2 * r) / sun.shadow.mapSize.x;

  // Light-space basis: snap the focus point to the texel grid on the two axes across the light.
  const right = SUN_RIGHT.crossVectors(WORLD_UP, dir).normalize(); // reused vectors: called up to 4x per frame
  const up = SUN_UP.crossVectors(dir, right).normalize();
  const focus = SUN_FOCUS.set(x, 0, z);
  const a = Math.round(focus.dot(right) / texel) * texel;
  const b = Math.round(focus.dot(up) / texel) * texel;
  focus.addScaledVector(right, a - focus.dot(right)).addScaledVector(up, b - focus.dot(up));

  sun.target.position.copy(focus);
  sun.position.copy(focus).addScaledVector(dir, SUN_DISTANCE);
  // Update both matrices right away: the game updates the scene's matrices only once per frame
  // (Game.frame), but the sun is re-aimed between the split-screen views.
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
  const cam = sun.shadow.camera;
  if (cam.right !== r) {
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.updateProjectionMatrix();
  }
  sun.shadow.normalBias = texel * 1.6;
  sun.shadow.bias = -0.00015;
}
