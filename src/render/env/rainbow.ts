/**
 * Rainbow Route's look (gated by `scenery.rainbow`, see TrackDef): a narrow, translucent, pastel-rainbow ribbon road floating
 * in space high above a planet. Everything here is procedural (shaders, canvas texture, primitives): no asset files.
 *
 *   - the RIBBON: one shader material (soft rainbow gradient, a scrolling shimmer, glitter, dashed centre line and glowing edge
 *     lines), drawn translucent (depthWrite off) FIRST among the transparent objects, so item boxes and effects still sort over it;
 *     a wider additive halo under it makes it glow in the bloom. The fork's high line is a second ribbon of the same material.
 *   - RAILS: a few glassy rails (a faint additive wall and a bright top bar) only where the track def has walls.
 *   - boost-pad ARCHES: a glowing half ring with a row of stars over every pad with `arch: true`.
 *   - the STAR TUNNEL: a translucent tube of rings and orbiting sparkles along the mandatory cannon's flight path.
 *   - the SPACE backdrop (`buildSpace`): the planet (continents, oceans, cloud bands from a canvas texture, an atmosphere rim), a
 *     star field, drifting dust, and a sun flare. The sky dome's aurora (mood 'space') sits behind them.
 *
 * Cost: ribbon + halo + rails + arches + tunnel + backdrop = about a dozen draw calls, whatever the track length.
 */
import * as THREE from 'three';
import { flightPoint, type ResolvedCannon } from '../../sim/cannon';
import { Track, type TrackSample } from '../../sim/track';
import { lookFor } from '../scene';
import { merge, paint, placed, scratch, tubeGeo } from './geo';

/** Does this track use the ribbon-in-space look? */
export const isRainbow = (track: Track): boolean => track.def.scenery.rainbow !== undefined;

type Edge = { d: number; h: number };
/** trackView's ribbon builder and run splitter, passed in so the two files do not import each other. */
export interface RibbonTools {
  ribbon: (samples: TrackSample[], closed: boolean, edges: (p: TrackSample) => Edge[], vRepeat: number) => THREE.BufferGeometry;
  runs: (samples: TrackSample[], pred: (p: TrackSample) => boolean) => TrackSample[][];
}

/** Metres of road per texture repeat along the ribbon (the shader's `along` = uv.y * this). */
const V_REPEAT = 12;

// ---------------------------------------------------------------------------------------------
// The ribbon material
// ---------------------------------------------------------------------------------------------

const ROAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const ROAD_FRAG = /* glsl */ `
  uniform float time;
  uniform float roadW;
  uniform float alpha;
  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    float across = (vUv.x - 0.5) * roadW;            // metres from the centre line (+ = right)
    float along = vUv.y * ${V_REPEAT.toFixed(1)};    // metres along the road
    float edgeD = roadW * 0.5 - abs(across);         // metres to the nearest edge

    // A pastel rainbow across the road, drifting slowly along it.
    float hue = fract(vUv.x * 0.85 + along * 0.0035 - time * 0.03);
    vec3 col = hsv2rgb(vec3(hue, 0.7, 0.78));
    col *= 0.7 + 0.3 * smoothstep(roadW * 0.5, 0.0, abs(across));

    // Shimmer: soft bright bands sliding forward along the ribbon (a sense of speed), plus glitter.
    float band = pow(0.5 + 0.5 * sin((along - time * 16.0) * 0.45 + across * 0.3), 8.0);
    col += vec3(0.4, 0.36, 0.5) * band * 0.5;
    vec2 cell = floor(vec2(across * 2.5, along * 2.5));
    float g = hash(cell);
    col += vec3(1.0) * step(0.988, g) * (0.5 + 0.5 * sin(time * 7.0 + g * 60.0));

    // Dashed centre line.
    float dash = step(fract(along / 9.0), 0.5) * smoothstep(0.26, 0.14, abs(across));
    col = mix(col, vec3(1.2), dash * 0.85);

    // Glowing edge lines (HDR: they bloom) with a soft falloff inwards.
    float pulse = 0.88 + 0.12 * sin(time * 3.0 + along * 0.15);
    float line = smoothstep(0.75, 0.55, edgeD) * smoothstep(-0.05, 0.12, edgeD);
    float glow = smoothstep(2.2, 0.0, edgeD) * 0.45;
    col = mix(col, vec3(0.9, 1.5, 2.0) * pulse, clamp(line + glow * 0.5, 0.0, 1.0));

    float a = mix(alpha, 1.0, max(line, dash * 0.9));
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** The translucent ribbon material for a road `width` metres wide. `time` is shared by every ribbon material. */
function roadMaterial(width: number, time: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { time, roadW: { value: width }, alpha: { value: 0.64 } },
    vertexShader: ROAD_VERT,
    fragmentShader: ROAD_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** A soft additive glow under the road (a wider ribbon, bright in the middle, fading to nothing at the sides). */
function haloMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: ROAD_VERT,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        float a = pow(max(0.0, 1.0 - abs(vUv.x - 0.5) * 2.0), 1.6);
        gl_FragColor = vec4(vec3(0.5, 0.65, 1.2) * a * 0.4, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------

export class RainbowView {
  readonly group = new THREE.Group();
  private readonly time = { value: 0 };
  private readonly archMat: THREE.MeshBasicMaterial;
  private readonly tunnels: StarTunnel[] = [];
  private readonly space: THREE.Group;

  constructor(
    track: Track,
    tools: RibbonTools,
  ) {
    const def = track.def;
    const hw = def.width / 2;
    const lift = (p: TrackSample, d: number) => Track.bankLift(p.bank, hw, d);

    // ---- The ribbon: main road (in runs: the jump gaps and the tunnel's sky gap are left out) ----
    const solid = tools.runs(track.samples, (p) => !track.inGap(p.s));
    const road = roadMaterial(def.width, this.time);
    const halo = haloMaterial();
    const edges = (p: TrackSample) => [{ d: -hw, h: lift(p, -hw) + 0.02 }, { d: 0, h: lift(p, 0) + 0.02 }, { d: hw, h: lift(p, hw) + 0.02 }];
    const haloEdges = (p: TrackSample) => [{ d: -hw - 3.2, h: lift(p, -hw) - 0.5 }, { d: 0, h: lift(p, 0) - 0.5 }, { d: hw + 3.2, h: lift(p, hw) - 0.5 }];
    const roadGeos = solid.map((run) => tools.ribbon(run, false, edges, V_REPEAT));
    const haloGeos = solid.map((run) => tools.ribbon(run, false, haloEdges, V_REPEAT));
    this.addMesh(merge(roadGeos), road, -10);
    this.addMesh(merge(haloGeos), halo, -11);

    // ---- The fork's high line(s): a second ribbon, flat across ----
    for (const b of track.branches) {
      if (!b.def.deck) continue;
      const bw = b.samples[0].width / 2;
      const m = roadMaterial(bw * 2, this.time);
      const e = () => [{ d: -bw, h: 0.02 }, { d: 0, h: 0.02 }, { d: bw, h: 0.02 }];
      const eh = () => [{ d: -bw - 3, h: -0.5 }, { d: 0, h: -0.5 }, { d: bw + 3, h: -0.5 }];
      this.addMesh(tools.ribbon(b.samples, false, e, V_REPEAT), m, -10);
      this.addMesh(tools.ribbon(b.samples, false, eh, V_REPEAT), halo, -11);
    }

    // ---- Rails (only where the def has walls): glass wall + bright top bar ----
    const outer = hw + def.offroadWidth;
    const railGlass: THREE.BufferGeometry[] = [];
    const railBars: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const has = (p: TrackSample) => (side < 0 ? p.wallLeft : p.wallRight);
      for (const run of tools.runs(track.samples, has)) {
        const wallD = (p: TrackSample) => side * Math.min(outer, track.cliffEdgeAt(p.s, side));
        railGlass.push(tools.ribbon(run, false, (p) => [{ d: wallD(p), h: lift(p, wallD(p)) }, { d: wallD(p), h: lift(p, wallD(p)) + 1.15 }], 6));
        const pts = run.filter((_, i) => i % 2 === 0 || i === run.length - 1).map((p) => new THREE.Vector3(p.x + p.rx * wallD(p), p.y + lift(p, wallD(p)) + 1.15, p.z + p.rz * wallD(p)));
        if (pts.length > 1) railBars.push(paint(tubeGeo(pts, pts.map(() => 0.1), 6), () => scratch.set('#ffffff')));
      }
    }
    if (railGlass.length) {
      const glass = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.9, 1.3), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      this.addMesh(merge(railGlass), glass, -9);
    }
    if (railBars.length) this.addMesh(merge(railBars), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 2.4, 3.2), vertexColors: true }), 0);

    // ---- Boost-pad arches ----
    this.archMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2, 2, 2) });
    const arches: THREE.BufferGeometry[] = [];
    def.boostPads.forEach((def2, i) => {
      const b = track.boostPads[i];
      if (!def2.arch || !b) return;
      arches.push(archGeometry(track, (b.s0 + b.s1) / 2, i));
    });
    if (arches.length) this.addMesh(merge(arches), this.archMat, 0);

    // ---- Star tunnels (mandatory cannons) ----
    for (const c of track.cannons) {
      if (!c.mandatory) continue;
      const t = new StarTunnel(c, hw);
      this.tunnels.push(t);
      this.group.add(t.group);
    }

    // ---- Space: planet, stars, dust, sun flare ----
    this.space = buildSpace(track);
    this.group.add(this.space);
  }

  private addMesh(geo: THREE.BufferGeometry, mat: THREE.Material, renderOrder: number): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = renderOrder;
    m.frustumCulled = false; // (one big ribbon: always near the camera)
    this.group.add(m);
    return m;
  }

  /** Animate (shimmer, arches, tunnel sparkles, planet clouds). `time` in seconds. */
  update(time: number): void {
    this.time.value = time;
    const k = 1.8 + 0.5 * Math.sin(time * 2.4);
    this.archMat.color.setRGB(k, k, k);
    for (const t of this.tunnels) t.update(time);
    this.space.userData.update?.(time);
  }
}

// ---------------------------------------------------------------------------------------------
// Boost-pad arches
// ---------------------------------------------------------------------------------------------

/** HSV-ish pastel colour for ring/star number `i` (rainbow order). */
function rainbowColor(i: number, n = 7, l = 0.62): THREE.Color {
  return new THREE.Color().setHSL((i / n) % 1, 1, l);
}

/** One 5-point star lying in the XY plane, facing +Z, `r` metres big, `depth` thick. */
function starGeometry(r: number, depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + Math.PI / 2;
    const rr = k % 2 === 0 ? r : r * 0.45;
    if (k === 0) shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Vertex-colour a whole geometry one colour (HDR-capable through the material colour). */
function tinted(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g; // (the parts of an arch / tunnel are merged: all non-indexed)
}

/** A half-ring arch with seven rainbow stars across the road at distance `s` (placed in the road's own frame, banked with it). */
function archGeometry(track: Track, s: number, seed: number): THREE.BufferGeometry {
  const hw = track.def.width / 2;
  const p = track.pointAt(s);
  const smp = track.samples[p.index];
  const slope = (Track.bankLift(smp.bank, hw, hw) - Track.bankLift(smp.bank, hw, -hw)) / (2 * hw);
  const right = new THREE.Vector3(smp.rx, slope, smp.rz).normalize();
  const fwd = new THREE.Vector3(smp.tx, 0, smp.tz).normalize();
  const up = new THREE.Vector3().crossVectors(fwd, right).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, up, fwd);
  basis.setPosition(smp.x, smp.y + Track.bankLift(smp.bank, hw, 0) + 0.02, smp.z);
  const R = hw + 0.4;
  const parts: THREE.BufferGeometry[] = [];
  // The ring: a half torus (a semicircle from the left edge over the top to the right edge), in the local XY plane.
  const ring = new THREE.TorusGeometry(R, 0.3, 8, 36, Math.PI);
  parts.push(tinted(ring, new THREE.Color('#ffffff')));
  // A thinner second ring a little inside it.
  parts.push(tinted(new THREE.TorusGeometry(R - 0.9, 0.12, 6, 36, Math.PI), new THREE.Color('#bfe9ff')));
  // Stars along the arch, one per hue.
  const star = starGeometry(0.85, 0.2);
  for (let k = 0; k < 7; k++) {
    const a = Math.PI * (0.08 + (k / 6) * 0.84);
    const g = placed(star, new THREE.Matrix4().makeRotationZ(0.35 * Math.sin(seed + k)).setPosition(Math.cos(a) * (R - 0.05), Math.sin(a) * (R - 0.05), 0));
    parts.push(tinted(g, rainbowColor(k + seed)));
  }
  const merged = merge(parts);
  merged.applyMatrix4(basis);
  return merged;
}

// ---------------------------------------------------------------------------------------------
// The star tunnel
// ---------------------------------------------------------------------------------------------

/** A glowing tube of rings and orbiting sparkles along a mandatory cannon's flight, from the road before the mouth to the landing. */
class StarTunnel {
  readonly group = new THREE.Group();
  private readonly curve: THREE.CatmullRomCurve3;
  private readonly sparkles: THREE.Points;
  private readonly seeds: Float32Array;
  private readonly tubeMat: THREE.ShaderMaterial;
  private readonly radius: number;

  constructor(c: ResolvedCannon, halfWidth: number) {
    this.radius = halfWidth * 0.8;
    const fx = Math.sin(c.mouth.heading);
    const fz = Math.cos(c.mouth.heading);
    const lx = Math.sin(c.landing.heading);
    const lz = Math.cos(c.landing.heading);
    const pts: THREE.Vector3[] = [];
    // The road before the mouth (the kart drives into the tube), the barrel's arc, then the landing and a little road after it.
    for (const back of [26, 16, 8]) pts.push(new THREE.Vector3(c.mouth.x - fx * back, c.mouth.y + 1.7, c.mouth.z - fz * back));
    pts.push(new THREE.Vector3(c.mouth.x, c.mouth.y + 2.0, c.mouth.z));
    for (let k = 0; k <= 16; k++) {
      const u = k / 16;
      const q = flightPoint(c, u);
      pts.push(new THREE.Vector3(q.x, q.y + 1.2, q.z));
    }
    for (const ahead of [8, 18]) pts.push(new THREE.Vector3(c.landing.x + lx * ahead, c.landing.y + 1.7, c.landing.z + lz * ahead));
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const length = this.curve.getLength();

    // The tube: translucent, with swirling light stripes that run along it.
    this.tubeMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float time;
        varying vec2 vUv;
        void main() {
          float swirl = vUv.x * 6.2832 * 3.0 + vUv.y * 40.0 - time * 5.0;
          float stripe = pow(0.5 + 0.5 * sin(swirl), 6.0);
          float ends = smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
          vec3 col = mix(vec3(0.4, 0.7, 1.4), vec3(1.5, 0.7, 1.4), 0.5 + 0.5 * sin(vUv.y * 18.0 - time * 2.0));
          float a = (0.07 + 0.55 * stripe) * ends;
          gl_FragColor = vec4(col * (0.6 + 1.6 * stripe), a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(this.curve, 64, this.radius, 20, false), this.tubeMat);
    tube.renderOrder = -8;
    tube.frustumCulled = false;
    this.group.add(tube);

    // Rings every ~6 m, each its own hue.
    const rings: THREE.BufferGeometry[] = [];
    const count = Math.max(4, Math.round(length / 6));
    const ringGeo = new THREE.TorusGeometry(this.radius + 0.15, 0.2, 6, 28);
    for (let k = 0; k <= count; k++) {
      const u = k / count;
      const p = this.curve.getPointAt(u);
      const t = this.curve.getTangentAt(u);
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), t, new THREE.Vector3(0, 1, 0)); // +z -> tangent
      m.setPosition(p);
      rings.push(tinted(placed(ringGeo, m), rainbowColor(k, 9, 0.66)));
    }
    ringGeo.dispose();
    this.group.add(new THREE.Mesh(merge(rings), new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.2, 2.2, 2.2) })));

    // Sparkles: stars orbiting inside the tube, flowing along it (positions are rewritten every frame).
    const n = 140;
    this.seeds = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.seeds[i * 3] = Math.random();
      this.seeds[i * 3 + 1] = Math.random() * Math.PI * 2;
      this.seeds[i * 3 + 2] = 0.3 + Math.random() * 0.7;
      rainbowColor(i, 12, 0.75).toArray(colors, i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.sparkles = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.3, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(2.2, 2.2, 2.2) }));
    this.sparkles.frustumCulled = false;
    this.group.add(this.sparkles);
    this.update(0);
  }

  private readonly p = new THREE.Vector3();
  private readonly t = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  update(time: number): void {
    this.tubeMat.uniforms.time.value = time;
    const pos = this.sparkles.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const u = (this.seeds[i * 3] + time * (0.08 + 0.05 * this.seeds[i * 3 + 2])) % 1;
      this.curve.getPointAt(u, this.p);
      this.curve.getTangentAt(u, this.t);
      this.a.set(0, 1, 0).cross(this.t).normalize();
      this.b.crossVectors(this.t, this.a);
      const ang = this.seeds[i * 3 + 1] + time * 2.2 * this.seeds[i * 3 + 2];
      const r = this.radius * (0.35 + 0.6 * this.seeds[i * 3 + 2]);
      pos.setXYZ(i, this.p.x + (this.a.x * Math.cos(ang) + this.b.x * Math.sin(ang)) * r, this.p.y + (this.a.y * Math.cos(ang) + this.b.y * Math.sin(ang)) * r, this.p.z + (this.a.z * Math.cos(ang) + this.b.z * Math.sin(ang)) * r);
    }
    pos.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------------------------
// Space: planet, stars, dust, sun flare
// ---------------------------------------------------------------------------------------------

const hash3 = (x: number, y: number, z: number, seed: number): number => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
/** Smooth 3D value noise, 0..1. */
function noise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  let v = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) v += hash3(ix + dx, iy + dy, iz + dz, seed) * (dx ? sx : 1 - sx) * (dy ? sy : 1 - sy) * (dz ? sz : 1 - sz);
  return v;
}
function fbm3(x: number, y: number, z: number, seed: number, octaves: number): number {
  let v = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    v += a * noise3(x * f, y * f, z * f, seed + i * 7);
    f *= 2.03;
    a *= 0.5;
  }
  return v;
}

/** The planet's colour map (equirectangular canvas): deep oceans, shallows, green and tan continents, ice caps and cloud bands. */
function planetTexture(seed: number, w = 1024, h = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * Math.max(0, Math.min(1, t)));
  const deep = [10, 28, 92];
  const shallow = [34, 128, 190];
  const sand = [214, 196, 128];
  const grass = [66, 150, 76];
  const forest = [34, 98, 62];
  const rock = [126, 112, 98];
  const snow = [244, 248, 255];
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * Math.PI * 2;
      const nx = Math.cos(lat) * Math.cos(lon);
      const ny = Math.sin(lat);
      const nz = Math.cos(lat) * Math.sin(lon);
      const land = fbm3(nx * 2.4 + 5, ny * 2.4, nz * 2.4, seed, 6);
      const sea = 0.5;
      let c: number[];
      if (land < sea) c = mix(deep, shallow, (land - (sea - 0.12)) / 0.12);
      else {
        const e = (land - sea) / 0.25;
        const wet = fbm3(nx * 3 + 40, ny * 3, nz * 3, seed + 3, 3);
        c = e < 0.06 ? sand : mix(mix(grass, forest, wet * 1.6 - 0.4), rock, (e - 0.55) * 2.2);
      }
      // Ice caps.
      c = mix(c, snow, (Math.abs(lat) - 1.12 + (land - 0.5) * 0.4) * 9);
      // Cloud bands: streaks stretched along the latitude lines.
      const cl = fbm3(nx * 2.2 + 80, ny * 7, nz * 2.2, seed + 11, 5);
      const cloud = Math.max(0, Math.min(1, (cl - 0.58) * 3.4)) * 0.8;
      c = mix(c, [255, 255, 255], cloud);
      const o = (y * w + x) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** A field of tiny stars: `count` points at `radius` from `center` (a sphere shell), or inside a box when `box` is given. */
function pointField(count: number, seed: number, place: (rnd: () => number, out: THREE.Vector3) => void, size: [number, number]): THREE.Points {
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const sz = new Float32Array(count);
  const ph = new Float32Array(count);
  const v = new THREE.Vector3();
  const tints = [new THREE.Color('#ffffff'), new THREE.Color('#bcd4ff'), new THREE.Color('#ffd9f0'), new THREE.Color('#fff2c4')];
  for (let i = 0; i < count; i++) {
    place(rnd, v);
    v.toArray(pos, i * 3);
    tints[Math.floor(rnd() * tints.length)].toArray(col, i * 3);
    sz[i] = size[0] + (size[1] - size[0]) * Math.pow(rnd(), 3);
    ph[i] = rnd() * 6.28;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(sz, 1));
  g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 color; attribute float size; attribute float phase;
      uniform float time;
      varying vec3 vCol; varying float vTw;
      void main() {
        vCol = color;
        vTw = 0.65 + 0.35 * sin(time * 2.0 + phase * 5.0);
        gl_PointSize = size * (0.8 + 0.4 * vTw);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol; varying float vTw;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d);
        gl_FragColor = vec4(vCol * (1.0 + 1.5 * a) * vTw, a * a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

/**
 * The backdrop: a big planet far below the lap, an atmosphere glow, a star field that follows the camera, drifting
 * dust around the course (it gives speed against the void) and a sun flare in the sun's direction.
 * `group.userData.update(time)` animates the twinkle and the clouds.
 */
function buildSpace(track: Track): THREE.Group {
  const group = new THREE.Group();
  const cfg = track.def.scenery.rainbow!;
  const seed = cfg.seed ?? 7;
  const S = track.samples;
  const minY = Math.min(...S.map((p) => p.y));
  const maxY = Math.max(...S.map((p) => p.y));
  const cx = S.reduce((a, p) => a + p.x, 0) / S.length;
  const cz = S.reduce((a, p) => a + p.z, 0) / S.length;
  const minX = Math.min(...S.map((p) => p.x));
  const maxX = Math.max(...S.map((p) => p.x));
  const minZ = Math.min(...S.map((p) => p.z));
  const maxZ = Math.max(...S.map((p) => p.z));
  const planet = cfg.planet ?? { x: cx + 120, y: minY - 190 - 1000, z: cz - 60, radius: 1000 };
  const look = lookFor(track.def.theme);
  const az = THREE.MathUtils.degToRad(look.sunAzimuth);
  const el = THREE.MathUtils.degToRad(13); // (the disc the sky dome draws)
  const sunDir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
  const lightDir = new THREE.Vector3(Math.cos(az) * Math.cos(THREE.MathUtils.degToRad(look.sunElevation)), Math.sin(THREE.MathUtils.degToRad(look.sunElevation)), Math.sin(az) * Math.cos(THREE.MathUtils.degToRad(look.sunElevation))).normalize();

  // Planet.
  const map = planetTexture(seed);
  const planetMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, sunDir: { value: lightDir }, time: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform vec3 sunDir; uniform float time;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vec3 base = texture2D(map, vUv + vec2(time * 0.0006, 0.0)).rgb;
        base = pow(base, vec3(2.2)); // sRGB -> linear
        vec3 n = normalize(vN);
        float lit = clamp(dot(n, normalize(sunDir)) * 0.9 + 0.35, 0.0, 1.0);
        float rim = pow(1.0 - max(dot(n, normalize(vV)), 0.0), 3.0);
        vec3 col = base * (0.05 + 0.75 * lit) + vec3(0.2, 0.4, 0.95) * rim * (0.25 + 0.7 * lit);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(planet.radius, 96, 48), planetMat);
  sphere.position.set(planet.x, planet.y, planet.z);
  sphere.rotation.set(1.15, 1.2, 0.35); // (tilted: the camera looks down on oceans and continents, not the polar cap)
  sphere.frustumCulled = false;
  group.add(sphere);
  // Atmosphere: a slightly bigger additive shell, bright at the limb.
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(planet.radius * 1.045, 64, 32),
    new THREE.ShaderMaterial({
      uniforms: { sunDir: { value: lightDir } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV;
        void main() {
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 w = modelMatrix * vec4(position, 1.0);
          vV = normalize(cameraPosition - w.xyz);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 sunDir;
        varying vec3 vN; varying vec3 vV;
        void main() {
          float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 4.5);
          float lit = clamp(dot(normalize(vN), normalize(sunDir)) * 0.8 + 0.5, 0.0, 1.0);
          gl_FragColor = vec4(vec3(0.3, 0.55, 1.2) * f * (0.4 + lit) * 1.6, f);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    }),
  );
  atmo.position.copy(sphere.position);
  atmo.frustumCulled = false;
  atmo.renderOrder = -20;
  group.add(atmo);

  // Stars: a shell round the camera (re-centred on it before each draw, like the sky dome).
  const stars = pointField(2600, seed * 31 + 5, (rnd, out) => {
    const z = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    out.set(Math.cos(a) * r, z, Math.sin(a) * r).multiplyScalar(1100);
  }, [1.4, 4.2]);
  stars.renderOrder = -30;
  stars.onBeforeRender = (_r, _s, camera) => {
    stars.position.copy(camera.position);
    stars.updateMatrixWorld();
  };
  group.add(stars);

  // Dust: glittering motes drifting around the whole course (static; they twinkle).
  const pad = 70;
  const dust = pointField(700, seed * 17 + 3, (rnd, out) => out.set(minX - pad + rnd() * (maxX - minX + 2 * pad), minY - 40 + rnd() * (maxY - minY + 110), minZ - pad + rnd() * (maxZ - minZ + 2 * pad)), [2.2, 5]);
  group.add(dust);

  // Sun flare: a camera-facing glow with soft streaks, at the sun's place in the sky.
  const flare = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vec2 p = vUv - 0.5;
          float r = length(p) * 2.0;
          float core = exp(-r * r * 18.0);
          float halo = exp(-r * 3.2) * 0.35;
          float ring = smoothstep(0.04, 0.0, abs(r - 0.62)) * 0.25;
          float streak = exp(-abs(p.y) * 60.0) * exp(-abs(p.x) * 4.0) * 0.55 + exp(-abs(p.x) * 60.0) * exp(-abs(p.y) * 4.0) * 0.25;
          float a = (core * 2.0 + halo + ring + streak) * smoothstep(1.0, 0.7, r);
          gl_FragColor = vec4(vec3(1.0, 0.86, 0.95) * a * 1.6, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  flare.renderOrder = 9998;
  flare.frustumCulled = false;
  flare.onBeforeRender = (_r, _s, camera) => {
    flare.position.copy(camera.position).addScaledVector(sunDir, 1000);
    flare.quaternion.copy(camera.quaternion);
    flare.scale.setScalar(360);
    flare.updateMatrixWorld();
  };
  group.add(flare);

  group.userData.update = (time: number) => {
    planetMat.uniforms.time.value = time;
    (stars.material as THREE.ShaderMaterial).uniforms.time.value = time;
    (dust.material as THREE.ShaderMaterial).uniforms.time.value = time;
  };
  return group;
}
