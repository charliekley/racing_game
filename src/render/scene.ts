/**
 * Renderer + scene basics: lights, gradient sky, fog.
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
}

export const QUALITY_PRESETS: QualitySettings[] = [
  { name: 'High', maxPixelRatio: 2, renderScale: 1, shadows: true, shadowMapSize: 2048 },
  { name: 'Medium', maxPixelRatio: 1, renderScale: 1, shadows: true, shadowMapSize: 1024 },
  { name: 'Low', maxPixelRatio: 1, renderScale: 0.75, shadows: false, shadowMapSize: 512 },
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

/** Apply quality to the sun light (shadow resolution). Materials recompile on shadow on/off. */
export function applySceneQuality(scene: THREE.Scene, sun: THREE.DirectionalLight, q: QualitySettings): void {
  sun.castShadow = q.shadows;
  if (sun.shadow.mapSize.x !== q.shadowMapSize) {
    sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    sun.shadow.map?.dispose();
    sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
  }
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
    else if (m) m.needsUpdate = true;
  });
}

const SKY_TOP = new THREE.Color('#3f8fe0');
const SKY_HORIZON = new THREE.Color('#bfe6ff');
const FOG = new THREE.Color('#cfeaff');

export interface SceneParts {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
}

export function createScene(): SceneParts {
  const scene = new THREE.Scene();
  scene.background = FOG;
  scene.fog = new THREE.Fog(FOG, 160, 650);

  scene.add(new THREE.HemisphereLight('#e4f2ff', '#5d7f3a', 1.6));
  const sun = new THREE.DirectionalLight('#fff3dc', 2.4);
  sun.position.set(80, 140, 50);
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
  scene.add(sun, sun.target);

  scene.add(createSkyDome());
  return { scene, sun };
}

/** Big inverted sphere with a vertical color gradient. One draw call, no textures. */
function createSkyDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1200, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON } },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() {
        vY = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      varying float vY;
      void main() {
        float t = clamp(vY * 2.2, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizon, top, pow(t, 0.7)), 1.0);
      }`,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  return dome;
}

/**
 * Keep the shadow-casting area centered on the action and big enough to
 * cover every kart (split-screen: all players need shadows).
 */
export function followWithSun(sun: THREE.DirectionalLight, x: number, z: number, radius = 60): void {
  sun.target.position.set(x, 0, z);
  sun.position.set(x + 80, 140, z + 50);
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
