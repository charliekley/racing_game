/**
 * One pooled, GPU-friendly particle system.
 *
 * Web/3D concepts:
 *  - A "particle" here is a single point (THREE.Points). The GPU draws every
 *    point as a small screen-aligned square ("point sprite"); our fragment
 *    shader paints a soft round (or star/hard-edged) blob into that square.
 *    Thousands of particles therefore cost ONE draw call.
 *  - The pool is a set of typed arrays of fixed size. Emitting a particle just
 *    overwrites the oldest slot (a ring buffer), so nothing is allocated while
 *    the game runs (no garbage-collector hiccups).
 *  - The simulation (move, fade, grow) runs on the CPU in `update`, then we
 *    upload the small result arrays to the GPU each frame.
 *  - Additive blending adds the particle's colour to what is behind it, which
 *    makes sparks and flames glow (and bloom, once post-processing is on).
 *    Normal blending is for opaque-ish things like smoke and confetti.
 *
 * Particles are cosmetic only (never touch the simulation), so Math.random is fine.
 */
import * as THREE from 'three';

export type SpriteShape = 'soft' | 'hard' | 'star';

/** Draw a small sprite texture on a canvas (no image files). Null when there is no DOM (tests). */
function makeSprite(shape: SpriteShape): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const n = 64;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const h = n / 2;
  if (shape === 'soft') {
    // White centre fading to transparent: a soft glow ball.
    const g = ctx.createRadialGradient(h, h, 0, h, h, h);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, n, n);
  } else if (shape === 'hard') {
    // A crisp disc with a 2px soft edge (confetti, debris).
    const g = ctx.createRadialGradient(h, h, h * 0.8, h, h, h * 0.97);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, n, n);
  } else {
    // Four-pointed star: a bright core with thin rays (sparkles, bump stars).
    ctx.translate(h, h);
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 === 0 ? h * 0.98 : h * 0.16;
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, h * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-h, -h, n, n);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  uniform float uScale;   // pixels per metre at distance 1 (set per viewport)
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // Perspective: a sprite of aSize metres covers aSize*scale/distance pixels.
    gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0.0, 220.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uGain; // HDR gain: the bloom pass only picks up brightness above ~1
  varying vec4 vColor;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor.rgb * uGain, vColor.a * t.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly cap: number;
  // Per-particle simulation state.
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly rgb: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly drag: Float32Array;
  private readonly grav: Float32Array;
  // Per-particle GPU attributes (rebuilt from the state above each update).
  private readonly aColor: Float32Array;
  private readonly aSize: Float32Array;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private readonly tex: THREE.CanvasTexture | null;
  private next = 0;
  private live = 0;
  private readonly col = new THREE.Color();
  /** Cap on how many particles may be emitted per second-ish: set by quality (0..1 scales emit counts elsewhere). */

  constructor(
    scene: THREE.Scene,
    capacity: number,
    readonly additive: boolean,
    shape: SpriteShape = 'soft',
  ) {
    this.cap = capacity;
    const n = capacity;
    this.pos = new Float32Array(n * 3).fill(-9999);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n); // 0 = slot is free
    this.size0 = new Float32Array(n);
    this.size1 = new Float32Array(n);
    this.rgb = new Float32Array(n * 3);
    this.alpha0 = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.aColor = new Float32Array(n * 4);
    this.aSize = new Float32Array(n);

    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.aColor, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.tex = makeSprite(shape);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: this.tex }, uScale: { value: 600 }, uGain: { value: additive ? 3 : 1 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false; // particles move freely; skip the bounding-box test
    this.points.renderOrder = additive ? 12 : 11;
    scene.add(this.points);
  }

  /** How many particles are alive (for tests and debug). */
  get alive(): number {
    return this.live;
  }

  /** Call before rendering each viewport: converts metres to pixels for this camera. */
  setView(camera: THREE.PerspectiveCamera, pixelHeight: number): void {
    this.mat.uniforms.uScale.value = pixelHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  /**
   * Spawn one particle. Plain numeric arguments (not an options object) so the
   * hot path allocates nothing.
   * @param size0 start size (m), @param size1 end size (m) - the sprite grows/shrinks over its life
   * @param drag  velocity lost per second (0 = none, 3 = stops fast)
   * @param grav  downward acceleration (m/s^2); negative floats up (smoke)
   */
  emit(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, size0: number, size1: number,
    color: number, alpha: number, drag = 0, grav = 0,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.col.setHex(color); // hex -> linear working colour
    this.rgb[k] = this.col.r; this.rgb[k + 1] = this.col.g; this.rgb[k + 2] = this.col.b;
    this.alpha0[i] = alpha;
    this.drag[i] = drag;
    this.grav[i] = grav;
  }

  update(dt: number): void {
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      const life = this.life[i];
      if (life <= 0) continue;
      const k = i * 3;
      const a = (this.age[i] += dt);
      if (a >= life) {
        this.life[i] = 0;
        this.aSize[i] = 0;
        this.aColor[i * 4 + 3] = 0;
        this.pos[k + 1] = -9999;
        continue;
      }
      live++;
      const u = a / life; // 0..1 over the particle's life
      const damp = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= damp;
      this.vel[k + 1] = this.vel[k + 1] * damp - this.grav[i] * dt;
      this.vel[k + 2] *= damp;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.aSize[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * u;
      // Quick fade-in (first 8%) then a smooth fade-out.
      const fade = Math.min(1, u / 0.08) * (1 - u) * (1 - u * 0.3);
      const c = i * 4;
      this.aColor[c] = this.rgb[k];
      this.aColor[c + 1] = this.rgb[k + 1];
      this.aColor[c + 2] = this.rgb[k + 2];
      this.aColor[c + 3] = this.alpha0[i] * fade;
    }
    this.live = live;
    if (live > 0 || this.points.visible) {
      (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    }
    this.points.visible = live > 0;
  }

  clear(): void {
    this.life.fill(0);
    this.aSize.fill(0);
    this.pos.fill(-9999);
    this.points.visible = false;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.points);
    this.geo.dispose();
    this.mat.dispose();
    this.tex?.dispose();
  }
}
