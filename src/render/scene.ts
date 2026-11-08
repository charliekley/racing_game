/**
 * Renderer + scene basics: lights, gradient sky, fog.
 *
 * Three.js concepts: a Scene holds objects (Meshes = Geometry + Material).
 * A Camera looks at the scene; the WebGLRenderer draws it into a <canvas>.
 * Lambert materials are cheap per-pixel lighting, good for a 4-viewport game.
 */
import * as THREE from 'three';

export interface QualitySettings {
  /** Multiplier on the device pixel ratio (lower = faster, blurrier). */
  renderScale: number;
  shadows: boolean;
}

export const DEFAULT_QUALITY: QualitySettings = { renderScale: 1, shadows: true };

export function createRenderer(parent: HTMLElement, q: QualitySettings = DEFAULT_QUALITY): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * q.renderScale);
  renderer.setSize(parent.clientWidth, parent.clientHeight);
  renderer.shadowMap.enabled = q.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  parent.appendChild(renderer.domElement);
  return renderer;
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

/** Keep the shadow-casting area centered on the action. */
export function followWithSun(sun: THREE.DirectionalLight, x: number, z: number): void {
  sun.target.position.set(x, 0, z);
  sun.position.set(x + 80, 140, z + 50);
}
