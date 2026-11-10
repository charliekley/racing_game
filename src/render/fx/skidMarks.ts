/**
 * Skid marks: dark ribbons the tyres leave on the road while drifting.
 *
 * One mesh holds a fixed pool of quads (a ring buffer). Each quad is one short
 * piece of a tyre track. Every vertex remembers the time it was laid down, and
 * the shader fades the mark out from that age, so the CPU never has to touch
 * old marks again (cheap: one draw call, no per-frame work except new quads).
 */
import * as THREE from 'three';

const LIFE = 7; // seconds until a mark has fully faded
const HALF_WIDTH = 0.13; // half the tyre width (m)

const VERT = /* glsl */ `
  attribute float aBirth;
  uniform float uNow;
  varying float vAlpha;
  void main() {
    float age = uNow - aBirth;
    vAlpha = clamp(1.0 - age / ${LIFE.toFixed(1)}, 0.0, 1.0) * step(0.0, age);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAG = /* glsl */ `
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(0.03, 0.03, 0.04, 0.55 * vAlpha);
    #include <colorspace_fragment>
  }
`;

export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly cap: number;
  private active: number;
  private readonly pos: Float32Array;
  private readonly birth: Float32Array;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private next = 0;

  /** @param capacity how many quads (track pieces) the pool holds */
  constructor(scene: THREE.Scene, capacity: number) {
    this.cap = capacity;
    this.active = capacity;
    this.pos = new Float32Array(capacity * 4 * 3);
    this.birth = new Float32Array(capacity * 4).fill(-1e6); // "born long ago" = invisible
    const index = new Uint16Array(capacity * 6);
    for (let q = 0; q < capacity; q++) {
      const v = q * 4;
      index.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], q * 6);
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aBirth', new THREE.BufferAttribute(this.birth, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(index, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uNow: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      // Pull the ribbon slightly toward the camera so it never z-fights with the road.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  /** Use only the first `n` quads (lower quality = shorter-lived marks). */
  setCapacity(n: number): void {
    this.active = Math.max(8, Math.min(this.cap, n));
    this.next %= this.active;
  }

  /**
   * Lay one piece of track from (x0,y0,z0) to (x1,y1,z1) at time `now`.
   * Four corners are written straight into the pool arrays.
   */
  addSegment(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, now: number): void {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    const px = (-dz / len) * HALF_WIDTH; // sideways, perpendicular to the direction of travel
    const pz = (dx / len) * HALF_WIDTH;
    const q = this.next;
    this.next = (this.next + 1) % this.active;
    const k = q * 12;
    const p = this.pos;
    p[k] = x0 + px; p[k + 1] = y0; p[k + 2] = z0 + pz;
    p[k + 3] = x0 - px; p[k + 4] = y0; p[k + 5] = z0 - pz;
    p[k + 6] = x1 + px; p[k + 7] = y1; p[k + 8] = z1 + pz;
    p[k + 9] = x1 - px; p[k + 10] = y1; p[k + 11] = z1 - pz;
    const b = q * 4;
    this.birth[b] = this.birth[b + 1] = this.birth[b + 2] = this.birth[b + 3] = now;
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aBirth') as THREE.BufferAttribute).needsUpdate = true;
  }

  update(now: number): void {
    this.mat.uniforms.uNow.value = now;
  }

  clear(): void {
    this.birth.fill(-1e6);
    (this.geo.getAttribute('aBirth') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}
