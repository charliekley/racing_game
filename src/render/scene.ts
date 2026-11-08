/**
 * Renderer + scene basics: lights, gradient sky with a sun, fog, and the
 * High/Medium/Low quality presets.
 *
 * Three.js concepts: a Scene holds objects (Meshes = Geometry + Material).
 * A Camera looks at the scene; the WebGLRenderer draws it into a <canvas>.
 * Lambert materials are cheap per-pixel lighting, good for a 4-viewport game.
 */
import * as THREE from 'three';

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
}

export const QUALITY_PRESETS: QualitySettings[] = [
  { name: 'High', maxPixelRatio: 2, renderScale: 1, shadows: true, shadowMapSize: 2048, clouds: true, sceneryDetail: 1 },
  { name: 'Medium', maxPixelRatio: 1, renderScale: 1, shadows: true, shadowMapSize: 1024, clouds: true, sceneryDetail: 0.7 },
  { name: 'Low', maxPixelRatio: 1, renderScale: 0.75, shadows: false, shadowMapSize: 512, clouds: false, sceneryDetail: 0.35 },
];
export const DEFAULT_QUALITY = QUALITY_PRESETS[1];

export function createRenderer(parent: HTMLElement, q: QualitySettings = DEFAULT_QUALITY): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(parent.clientWidth, parent.clientHeight);
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // With split-screen we render the scene several times per frame; draw the
  // shadow map only once per frame ourselves (see Game.frame).
  renderer.shadowMap.autoUpdate = false;
  parent.appendChild(renderer.domElement);
  applyRendererQuality(renderer, q);
  return renderer;
}

export function applyRendererQuality(renderer: THREE.WebGLRenderer, q: QualitySettings): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.maxPixelRatio) * q.renderScale);
  renderer.shadowMap.enabled = q.shadows;
  renderer.shadowMap.needsUpdate = true;
}

/**
 * Apply quality to the scene: sun shadow resolution, and scenery level of
 * detail. Scenery meshes opt in through `userData` (see scenery.ts):
 *   userData.detailIndexCount: full index count; we draw only a fraction of it
 *   userData.cloudLayer: hidden when the preset has clouds off
 * Materials recompile on shadow on/off.
 */
export function applySceneQuality(scene: THREE.Scene, sun: THREE.DirectionalLight, q: QualitySettings): void {
  sun.castShadow = q.shadows;
  if (sun.shadow.mapSize.x !== q.shadowMapSize) {
    sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    sun.shadow.map?.dispose();
    sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
  }
  scene.traverse((o) => {
    const full = o.userData.detailIndexCount as number | undefined;
    if (full !== undefined) (o as THREE.Mesh).geometry.setDrawRange(0, Math.floor((full * q.sceneryDetail) / 3) * 3);
    if (o.userData.cloudLayer) o.visible = q.clouds;
    const m = (o as THREE.Mesh).material;
    if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
    else if (m) m.needsUpdate = true;
  });
}

/** The part of a track's theme that the sky and lights use. */
export interface SkyTheme {
  sky: string;
  horizon: string;
  grass: string;
}

/**
 * Where the sun sits, as an offset from the point it shines at. The light is
 * fairly high (short, readable shadows); the sun disc drawn in the sky uses the
 * same compass direction but sits low, so you actually get to see it.
 */
const SUN_OFFSET = new THREE.Vector3(80, 140, 50);
const SUN_DISC_ELEVATION = THREE.MathUtils.degToRad(13);

export interface SceneParts {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
}

export function createScene(theme: SkyTheme): SceneParts {
  const horizon = new THREE.Color(theme.horizon);
  const top = new THREE.Color(theme.sky);
  const scene = new THREE.Scene();
  // Fog fades distant things into the horizon color, which is exactly the sky
  // color at the horizon line, so the ground melts into the sky with no seam.
  scene.background = horizon;
  scene.fog = new THREE.Fog(horizon, 150, 720);

  // Hemisphere light = soft "sky above, ground below" ambient light. A slightly
  // whitened sky color on top and a dark grass tone below keeps shaded sides
  // tinted like the world around them instead of flat grey.
  const hemiSky = top.clone().lerp(new THREE.Color('#ffffff'), 0.55);
  const hemiGround = new THREE.Color(theme.grass).multiplyScalar(0.55);
  scene.add(new THREE.HemisphereLight(hemiSky, hemiGround, 1.5));

  // Warm late-afternoon sun.
  const sun = new THREE.DirectionalLight('#ffeccc', 2.6);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -60;
  s.right = 60;
  s.top = 60;
  s.bottom = -60;
  s.near = 10;
  s.far = 400;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  scene.add(createSkyDome(top, horizon));
  return { scene, sun };
}

/**
 * Big inverted sphere with a vertical color gradient plus a sun disc and glow,
 * all computed in the shader: one draw call, no textures. The dome is moved to
 * each camera right before it is drawn, so it never gets "closer" on one side.
 */
function createSkyDome(top: THREE.Color, horizon: THREE.Color): THREE.Mesh {
  const flat = new THREE.Vector3(SUN_OFFSET.x, 0, SUN_OFFSET.z).normalize();
  const sunDir = flat.multiplyScalar(Math.cos(SUN_DISC_ELEVATION)).setY(Math.sin(SUN_DISC_ELEVATION));
  const geo = new THREE.SphereGeometry(1200, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: top },
      horizon: { value: horizon },
      sunDir: { value: sunDir },
      sunColor: { value: new THREE.Color('#fff2cf') },
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
      uniform vec3 sunDir;
      uniform vec3 sunColor;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        // Gradient: horizon color at and below the horizon, sky color overhead.
        float t = clamp(dir.y * 2.2, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(t, 0.7));
        // Sun: wide warm haze + tighter glow + crisp disc.
        float d = max(dot(dir, sunDir), 0.0);
        float above = smoothstep(-0.05, 0.05, dir.y); // keep the glow off the ground-fog band
        col += sunColor * (pow(d, 6.0) * 0.18 + pow(d, 60.0) * 0.35) * above;
        col = mix(col, sunColor * 1.15, smoothstep(0.9990, 0.9994, d));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  // Called once per camera (split-screen): recenter the dome on that camera.
  dome.onBeforeRender = (_r, _s, camera) => {
    dome.position.copy(camera.position);
    dome.updateMatrixWorld();
  };
  return dome;
}

/**
 * Keep the shadow-casting area centered on the action and big enough to
 * cover every kart (split-screen: all players need shadows).
 */
export function followWithSun(sun: THREE.DirectionalLight, x: number, z: number, radius = 60): void {
  sun.target.position.set(x, 0, z);
  sun.position.set(x + SUN_OFFSET.x, SUN_OFFSET.y, z + SUN_OFFSET.z);
  const r = Math.max(40, radius);
  const cam = sun.shadow.camera;
  if (cam.right !== r) {
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.updateProjectionMatrix();
  }
}
