/**
 * Post-processing pipeline that works with split-screen.
 *
 * Idea ("render to texture"): instead of drawing the 3D scene straight onto the
 * canvas, the game draws every player's viewport into ONE off-screen picture
 * (a render target). Then a few full-screen passes run ONCE on that whole picture:
 *
 *   1. scene target   HDR (half-float) colour + depth, with MSAA anti-aliasing.
 *                     HDR means brightness is not capped at 1.0, so a boost flame
 *                     or the sun can be "10x brighter than white".
 *   2. bloom          keep only the very bright pixels, blur them at several
 *                     sizes (a pyramid of ever smaller pictures) and add them back:
 *                     that is the soft glow around lights.
 *   3. composite      scene + bloom -> colour grade -> tone mapping (HDR -> screen
 *                     range) -> vignette -> sRGB output, drawn onto the canvas.
 *
 * Usage per frame:   beginFrame();  renderView(...) once per viewport;  endFrame();
 * With post-processing off (Low quality) the same calls just draw to the canvas.
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { lookFor, type Look, type QualitySettings, type SkyTheme } from '../scene';

/** Pixel rectangle of one viewport; origin bottom-left (like gl_FragCoord and setViewport). */
export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Material for a full-screen pass: no depth, no tone mapping (we apply it ourselves where wanted). */
function passMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, opts: THREE.ShaderMaterialParameters = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    ...opts,
  });
}

// ---- Bloom shaders ---------------------------------------------------------

/**
 * Bright pass: shrink the scene to half size and keep only what is brighter than
 * the threshold. A soft "knee" makes the cut-off gradual instead of a hard edge.
 * Every sample is also clamped so one tiny super-bright pixel cannot flicker.
 */
const BRIGHT_FRAG = /* glsl */ `
  uniform sampler2D tSource;
  uniform vec2 texel;      // size of one SOURCE pixel in uv units
  uniform float threshold;
  varying vec2 vUv;
  vec3 prefilter(vec3 c) {
    c = min(c, vec3(24.0));
    float b = max(c.r, max(c.g, c.b));
    float knee = threshold * 0.5 + 0.0001;
    float soft = clamp(b - threshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee);
    float w = max(soft, b - threshold) / max(b, 0.0001);
    return c * w;
  }
  void main() {
    vec3 c = prefilter(texture2D(tSource, vUv + texel * vec2(-0.5, -0.5)).rgb)
           + prefilter(texture2D(tSource, vUv + texel * vec2( 0.5, -0.5)).rgb)
           + prefilter(texture2D(tSource, vUv + texel * vec2(-0.5,  0.5)).rgb)
           + prefilter(texture2D(tSource, vUv + texel * vec2( 0.5,  0.5)).rgb);
    gl_FragColor = vec4(c * 0.25, 1.0);
  }`;

/** Down-sample by 2 with a small blur (4 bilinear taps around the centre). */
const DOWN_FRAG = /* glsl */ `
  uniform sampler2D tSource;
  uniform vec2 texel;      // one SOURCE pixel in uv units
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSource, vUv).rgb * 4.0;
    c += texture2D(tSource, vUv + texel * vec2(-1.0, -1.0)).rgb;
    c += texture2D(tSource, vUv + texel * vec2( 1.0, -1.0)).rgb;
    c += texture2D(tSource, vUv + texel * vec2(-1.0,  1.0)).rgb;
    c += texture2D(tSource, vUv + texel * vec2( 1.0,  1.0)).rgb;
    gl_FragColor = vec4(c * 0.125, 1.0);
  }`;

/** Up-sample by 2 with a wider tent blur; drawn with additive blending onto the bigger level. */
const UP_FRAG = /* glsl */ `
  uniform sampler2D tSource;
  uniform vec2 texel;      // one SOURCE (smaller) pixel in uv units
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSource, vUv + texel * vec2(-1.0, 0.0)).rgb * 2.0
           + texture2D(tSource, vUv + texel * vec2( 1.0, 0.0)).rgb * 2.0
           + texture2D(tSource, vUv + texel * vec2( 0.0,-1.0)).rgb * 2.0
           + texture2D(tSource, vUv + texel * vec2( 0.0, 1.0)).rgb * 2.0
           + texture2D(tSource, vUv + texel * vec2(-1.0,-1.0)).rgb
           + texture2D(tSource, vUv + texel * vec2( 1.0,-1.0)).rgb
           + texture2D(tSource, vUv + texel * vec2(-1.0, 1.0)).rgb
           + texture2D(tSource, vUv + texel * vec2( 1.0, 1.0)).rgb;
    gl_FragColor = vec4(c * (1.0 / 12.0) * 0.8, 1.0);
  }`;

// ---- Composite shader ------------------------------------------------------

const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform float bloomStrength;
  uniform float saturation;
  uniform float contrast;
  uniform vec3 tint;
  uniform float vignette;
  uniform vec4 views[4];   // viewport rectangles in drawing-buffer pixels (x, y, w, h)
  uniform int viewCount;
  varying vec2 vUv;

  void main() {
    vec3 c = texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * bloomStrength;

    // Colour grade (in linear light, before tone mapping).
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, saturation);
    c *= tint;
    c = max((c - 0.18) * contrast + 0.18, 0.0); // contrast pivots around mid grey

    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>

    // Vignette: darken towards the corners of the viewport this pixel belongs to
    // (each split-screen view gets its own, not one big one over the whole window).
    vec2 p = gl_FragCoord.xy;
    for (int i = 0; i < 4; i++) {
      if (i >= viewCount) break;
      vec4 r = views[i];
      if (p.x >= r.x && p.x < r.x + r.z && p.y >= r.y && p.y < r.y + r.w) {
        vec2 q = (p - r.xy) / r.zw - 0.5;
        float v = dot(q, q * vec2(1.0, 1.25)); // 0 centre .. ~0.5 corner
        gl_FragColor.rgb *= 1.0 - vignette * smoothstep(0.12, 0.55, v);
      }
    }

    #include <colorspace_fragment>
    // Tiny noise (about one 8-bit step) hides colour banding in smooth sky gradients.
    float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    gl_FragColor.rgb += (n - 0.5) / 255.0;
  }`;

export class RenderPipeline {
  private q: QualitySettings;
  private look: Look;
  private readonly quad = new FullScreenQuad();
  private target: THREE.WebGLRenderTarget | null = null;
  private bloomDown: THREE.WebGLRenderTarget[] = [];
  private pxW = 1;
  private pxH = 1;
  private views: ViewRect[] = [];
  private supported: boolean;

  private readonly brightMat: THREE.ShaderMaterial;
  private readonly downMat: THREE.ShaderMaterial;
  private readonly upMat: THREE.ShaderMaterial;
  private readonly compositeMat: THREE.ShaderMaterial;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    quality: QualitySettings,
    theme: SkyTheme,
  ) {
    this.q = quality;
    this.look = lookFor(theme);
    // Rendering into a floating point texture needs this GPU feature (virtually all desktop GPUs have it).
    this.supported = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');

    this.brightMat = passMaterial(BRIGHT_FRAG, { tSource: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 1 } });
    this.downMat = passMaterial(DOWN_FRAG, { tSource: { value: null }, texel: { value: new THREE.Vector2() } });
    this.upMat = passMaterial(
      UP_FRAG,
      { tSource: { value: null }, texel: { value: new THREE.Vector2() } },
      { blending: THREE.AdditiveBlending }, // add onto the bigger level instead of replacing it
    );
    this.compositeMat = passMaterial(COMPOSITE_FRAG, {
      tScene: { value: null },
      tBloom: { value: null },
      bloomStrength: { value: 0 },
      saturation: { value: 1 },
      contrast: { value: 1 },
      tint: { value: new THREE.Color() },
      vignette: { value: 0 },
      views: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      viewCount: { value: 0 },
    }, { toneMapped: true });
    this.applyLook();
    this.resize();
  }

  /** True when frames go through the HDR target (post-processing on and supported). */
  get active(): boolean {
    return this.q.post && this.supported;
  }

  setQuality(q: QualitySettings): void {
    this.q = q;
    this.disposeTargets();
    this.resize();
  }

  setTheme(theme: SkyTheme): void {
    this.look = lookFor(theme);
    this.applyLook();
  }

  private applyLook(): void {
    const u = this.compositeMat.uniforms;
    const l = this.look;
    u.bloomStrength.value = l.bloom;
    u.saturation.value = l.saturation;
    u.contrast.value = l.contrast;
    u.tint.value.set(l.tint);
    u.vignette.value = l.vignette;
    this.brightMat.uniforms.threshold.value = l.bloomThreshold;
    this.renderer.toneMappingExposure = l.exposure;
  }

  /** Call after renderer.setSize() or a pixel-ratio change: (re)creates the off-screen pictures. */
  resize(): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.floor(size.x));
    const h = Math.max(1, Math.floor(size.y));
    if (w !== this.pxW || h !== this.pxH) {
      this.pxW = w;
      this.pxH = h;
      this.disposeTargets();
    }
    if (!this.active || this.target) return;

    this.target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: this.q.msaa,
      depthBuffer: true,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    // Bloom pyramid: level 0 is half the screen size, each next level half again.
    for (let i = 0, bw = w >> 1, bh = h >> 1; i < this.q.bloomLevels && bw >= 4 && bh >= 4; i++, bw >>= 1, bh >>= 1) {
      this.bloomDown.push(
        new THREE.WebGLRenderTarget(bw, bh, {
          type: THREE.HalfFloatType,
          depthBuffer: false,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
        }),
      );
    }
  }

  private disposeTargets(): void {
    this.target?.dispose();
    this.target = null;
    for (const t of this.bloomDown) t.dispose();
    this.bloomDown = [];
  }

  /** Start a frame: clear the target (or canvas) and forget last frame's viewports. */
  beginFrame(): void {
    this.views.length = 0;
    const r = this.renderer;
    r.setScissorTest(false);
    if (this.active && this.target) {
      r.setRenderTarget(this.target);
      this.target.scissorTest = false;
      this.target.viewport.set(0, 0, this.pxW, this.pxH);
      r.setClearColor(0x000000, 1);
      r.clear();
    } else {
      r.setRenderTarget(null);
    }
  }

  /** Draw the scene for one player into the given rectangle (CSS pixels, origin bottom-left, like setViewport). */
  renderView(scene: THREE.Scene, camera: THREE.Camera, x: number, y: number, w: number, h: number): void {
    const r = this.renderer;
    if (this.active && this.target) {
      // Render targets are measured in real (device) pixels, not CSS pixels.
      const k = r.getPixelRatio();
      const px = Math.round(x * k);
      const py = Math.round(y * k);
      const pw = Math.round(w * k);
      const ph = Math.round(h * k);
      this.target.viewport.set(px, py, pw, ph);
      this.target.scissor.set(px, py, pw, ph);
      this.target.scissorTest = true;
      r.setRenderTarget(this.target); // re-bind so Three.js picks up the new viewport/scissor
      if (this.views.length < 4) this.views.push({ x: px, y: py, w: pw, h: ph });
    } else {
      r.setScissorTest(true);
      r.setViewport(x, y, w, h);
      r.setScissor(x, y, w, h);
    }
    r.render(scene, camera);
  }

  /** Finish the frame: bloom + composite onto the canvas. */
  endFrame(): void {
    const r = this.renderer;
    if (!this.active || !this.target) {
      r.setScissorTest(false);
      return;
    }
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    this.target.scissorTest = false;

    // --- Bloom: bright pass to level 0, then down the pyramid, then back up adding. ---
    const levels = this.bloomDown;
    const bloomOn = levels.length > 0 && this.look.bloom > 0.001;
    if (bloomOn) {
      this.pass(this.brightMat, this.target.texture, this.target, levels[0]);
      for (let i = 1; i < levels.length; i++) this.pass(this.downMat, levels[i - 1].texture, levels[i - 1], levels[i]);
      for (let i = levels.length - 1; i > 0; i--) this.pass(this.upMat, levels[i].texture, levels[i], levels[i - 1]);
    }

    // --- Composite onto the canvas. ---
    const u = this.compositeMat.uniforms;
    u.tScene.value = this.target.texture;
    u.tBloom.value = bloomOn ? levels[0].texture : this.target.texture;
    u.bloomStrength.value = bloomOn ? this.look.bloom : 0;
    const vs = u.views.value as THREE.Vector4[];
    this.views.forEach((v, i) => vs[i].set(v.x, v.y, v.w, v.h));
    u.viewCount.value = this.views.length;
    r.setRenderTarget(null);
    r.setScissorTest(false);
    r.setViewport(0, 0, this.pxW / r.getPixelRatio(), this.pxH / r.getPixelRatio());
    this.quad.material = this.compositeMat;
    this.quad.render(r);
    r.autoClear = prevAutoClear;
  }

  /** Run one full-screen pass reading `src` (which has size of `from`) and writing into `to`. */
  private pass(mat: THREE.ShaderMaterial, src: THREE.Texture, from: THREE.WebGLRenderTarget, to: THREE.WebGLRenderTarget): void {
    mat.uniforms.tSource.value = src;
    mat.uniforms.texel.value.set(1 / from.width, 1 / from.height);
    this.renderer.setRenderTarget(to);
    this.quad.material = mat;
    this.quad.render(this.renderer);
  }

  dispose(): void {
    this.disposeTargets();
    this.quad.dispose();
    for (const m of [this.brightMat, this.downMat, this.upMat, this.compositeMat]) m.dispose();
  }
}
