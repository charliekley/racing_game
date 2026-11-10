/**
 * Style-specific set dressing that is not part of the scenery plan. It has no colliders, so it
 * is only ever placed well away from the road (cranes, vents and cabins at least 30-60 m off):
 *
 *   harbour : portal cranes with warning lights
 *   volcanic: smoking lava vents (glowing mound + rising smoke puffs) and glowing boulders
 *   alpine  : log cabins with snowy roofs and lit windows, a ski-lift line (pylons, cable, chairs),
 *             snow drifts
 *   sky     : striped hot-air balloons
 *   meadow  : a few balloons high in the sky
 */
import * as THREE from 'three';
import type { Track } from '../../sim/track';
import type { SceneryPlan, Site } from '../../track/sceneryPlan';
import type { TrackDef } from '../../track/types';
import { blobGeo, latheGeo, matrix, merge, paint, scratch, tubeGeo } from './geo';
import { ENV_TIME } from './materials';
import { noise3 } from './noise';
import { boxPart, gableEave, gableRoof, polePart } from './parts';
import type { Style } from './props';
import type { Batches } from './structures';

export interface ExtrasContext {
  style: Style;
  track: Track;
  plan: SceneryPlan;
  site: Site;
  rnd: () => number;
  batches: Batches;
  theme: TrackDef['theme'];
}

const WHITE = new THREE.Color('#ffffff');

/** Random spot at least `clear` metres from the road and from buildings (null after many tries). */
function spot(ctx: ExtrasContext, clear: number, r: number, maxDist = 220): [number, number] | null {
  for (let i = 0; i < 60; i++) {
    const [x, z] = ctx.site.randomPoint(ctx.rnd);
    const d = ctx.site.distToTrack(x, z);
    if (d < ctx.site.outer + clear || d > maxDist || !ctx.site.isFree(x, z, r)) continue;
    return [x, z];
  }
  return null;
}

export function addExtras(ctx: ExtrasContext): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  switch (ctx.style) {
    case 'harbour':
      cranes(ctx);
      balloons(ctx, 3);
      break;
    case 'volcanic':
      out.push(...vents(ctx));
      break;
    case 'alpine':
      cabins(ctx);
      skiLift(ctx);
      drifts(ctx);
      balloons(ctx, 2);
      break;
    case 'sky':
      balloons(ctx, 6);
      break;
    default:
      balloons(ctx, 3);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Harbour cranes
// ---------------------------------------------------------------------------

function craneGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const red = new THREE.Color('#c0392b');
  const grey = new THREE.Color('#aeb4bd');
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const H = 34;
  // Four legs of an A-frame portal, sea side and land side.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(paint(tubeGeo([v(sx * 7, 0, sz * 5), v(sx * 4.2, H, sz * 3)], [0.55, 0.45], 8), () => scratch.copy(grey)));
  // Cross braces and portal beams.
  for (const y of [8, 18, 28]) for (const sx of [-1, 1]) parts.push(paint(tubeGeo([v(sx * (7 - y * 0.1), y, -5 + y * 0.06), v(sx * (7 - y * 0.1), y, 5 - y * 0.06)], [0.25, 0.25], 6), () => scratch.copy(grey)));
  parts.push(boxPart(0, H + 0.8, 0, 11, 1.6, 8, red));
  // Boom reaching out over the water (+z) and back-reach behind, both tapered trusses.
  parts.push(paint(tubeGeo([v(0, H + 2, -14), v(0, H + 2.4, 0), v(0, H + 1.4, 38)], [0.8, 1.0, 0.5], 8), () => scratch.copy(red)));
  parts.push(boxPart(0, H + 3.2, -4, 5, 4, 7, new THREE.Color('#f2f2f2')));
  parts.push(boxPart(0, H + 3.3, 10, 2.4, 2.4, 3, new THREE.Color('#d9a21a'))); // trolley
  parts.push(paint(tubeGeo([v(0, H + 1.4, 10), v(0, H - 10, 10)], [0.06, 0.06], 4), () => scratch.set('#222')));
  parts.push(boxPart(0, H - 11, 10, 1.4, 0.5, 2.6, new THREE.Color('#d9a21a')));
  return merge(parts);
}

function cranes(ctx: ExtrasContext): void {
  const geo = craneGeo();
  const lamp = boxPart(0, 0, 0, 0.7, 0.7, 0.7, new THREE.Color(6, 0.5, 0.4), 0, 1);
  let placed = 0;
  for (let i = 0; i < 40 && placed < 4; i++) {
    const p = spot(ctx, 55, 18, 260);
    if (!p) break;
    const y = ctx.plan.heightAt(p[0], p[1]);
    const ry = ctx.rnd() * Math.PI * 2;
    ctx.site.reserve(p[0], p[1], 14);
    ctx.batches.solid.add(geo, matrix(p[0], y, p[1], 1, 1, 1, ry), WHITE);
    const m = matrix(0, 0, 0, 1, 1, 1, ry);
    const top = new THREE.Vector3(0, 40.5, 38).applyMatrix4(m);
    ctx.batches.glow.add(lamp, matrix(p[0] + top.x, y + top.y, p[1] + top.z), WHITE);
    const back = new THREE.Vector3(0, 38, -14).applyMatrix4(m);
    ctx.batches.glow.add(lamp, matrix(p[0] + back.x, y + back.y, p[1] + back.z), WHITE);
    placed++;
  }
}

// ---------------------------------------------------------------------------
// Volcano: smoking vents and glowing boulders
// ---------------------------------------------------------------------------

function vents(ctx: ExtrasContext): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const moundGeo = (() => {
    const g = blobGeo(3, 4, 0.2, 1.4, noise3);
    g.applyMatrix4(matrix(0, 0, 0, 1, 0.55, 1));
    return paint(g, (p, n) => {
      const rim = THREE.MathUtils.smoothstep(p.y, 0.25, 0.5);
      scratch.set('#3a2c2a').lerp(new THREE.Color('#6a4a3a'), noise3(p.x * 3, p.y * 3, p.z * 3, 2));
      scratch.multiplyScalar(0.7 + 0.3 * n.y);
      return scratch.lerp(new THREE.Color('#201816'), rim * 0.4);
    });
  })();
  const glowDisc = (() => {
    const g = new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2);
    g.deleteAttribute('uv');
    return paint(g, () => scratch.set(4.5, 1.2, 0.2));
  })();
  const sites: THREE.Vector3[] = [];
  for (let i = 0; i < 8; i++) {
    const p = spot(ctx, 28, 12, 200);
    if (!p) break;
    const y = ctx.plan.heightAt(p[0], p[1]);
    ctx.site.reserve(p[0], p[1], 8);
    const s = 2.5 + ctx.rnd() * 2.2;
    ctx.batches.solid.add(moundGeo, matrix(p[0], y - 0.3, p[1], s, s, s, ctx.rnd() * 6), WHITE);
    ctx.batches.glow.add(glowDisc, matrix(p[0], y + s * 0.5 * 0.55 * 0.9, p[1], s * 0.5, 1, s * 0.5), WHITE);
    sites.push(new THREE.Vector3(p[0], y + s * 0.5, p[1]));
  }
  // Glowing lava boulders scattered around.
  const rockGeo = blobGeo(2, 9, 0.3, 1.5, noise3);
  rockGeo.applyMatrix4(matrix(0, 0, 0, 1, 0.7, 1));
  paint(rockGeo, (p, n) => scratch.set('#2a201f').lerp(new THREE.Color(4.0, 0.9, 0.12), THREE.MathUtils.smoothstep(noise3(p.x * 3, p.y * 3, p.z * 3, 7), 0.62, 0.8) * (1 - Math.max(0, n.y) * 0.4)));
  for (let i = 0; i < 26; i++) {
    const p = spot(ctx, 14, 3, 200);
    if (!p) break;
    const s = 0.7 + ctx.rnd() * 1.6;
    ctx.batches.glow.add(rockGeo, matrix(p[0], ctx.plan.heightAt(p[0], p[1]) + s * 0.2, p[1], s, s, s, ctx.rnd() * 6), WHITE);
  }
  if (!sites.length) return out;

  // Smoke: many soft puffs per vent, animated entirely in the vertex shader (one draw call).
  const per = 12;
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), smokeMaterial(), sites.length * per);
  const phase = new Float32Array(sites.length * per);
  const m = new THREE.Matrix4();
  sites.forEach((s, i) => {
    for (let k = 0; k < per; k++) {
      m.makeTranslation(s.x, s.y, s.z);
      mesh.setMatrixAt(i * per + k, m);
      phase[i * per + k] = k / per + ctx.rnd() * 0.05;
    }
  });
  mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  out.push(mesh);
  return out;
}

function smokeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: ENV_TIME }]),
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float aPhase;
      varying float vAge;
      varying vec3 vN;
      #include <fog_pars_vertex>
      void main() {
        float t = fract(uTime * 0.07 + aPhase);
        vAge = t;
        vec3 origin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float sz = 1.6 + t * 9.0;
        vec3 drift = vec3(t * t * 14.0, t * 30.0, t * t * 6.0);
        vec3 wp = origin + drift + position * sz;
        vN = normal;
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying float vAge;
      varying vec3 vN;
      #include <fog_pars_fragment>
      void main() {
        float a = (1.0 - vAge) * smoothstep(0.0, 0.08, vAge) * 0.55;
        vec3 ash = mix(vec3(0.16, 0.13, 0.13), vec3(0.42, 0.36, 0.34), vAge);
        ash += vec3(1.6, 0.4, 0.05) * pow(1.0 - vAge, 6.0); // glowing at the vent
        ash *= 0.75 + 0.25 * vN.y;
        gl_FragColor = vec4(ash, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

// ---------------------------------------------------------------------------
// Alpine: cabins, ski lift, drifts
// ---------------------------------------------------------------------------

function cabins(ctx: ExtrasContext): void {
  const dusk = false;
  for (let i = 0; i < 6; i++) {
    const p = spot(ctx, 45, 9, 220);
    if (!p) break;
    const y = ctx.plan.heightAt(p[0], p[1]);
    const w = 6 + ctx.rnd() * 2;
    const d = 5 + ctx.rnd();
    const h = 3.2;
    const ry = ctx.rnd() * 6.28;
    ctx.site.reserve(p[0], p[1], 7);
    const wood = new THREE.Color(['#9a5f34', '#8a5430', '#a8703c'][i % 3]);
    const parts = [
      boxPart(0, h / 2, 0, w, h, d, wood, 0, 0.6),
      boxPart(0, 0.25, 0, w + 0.3, 0.5, d + 0.3, new THREE.Color('#77716a')),
      boxPart(0, 1.1, d / 2 + 0.03, 1.1, 2.2, 0.12, new THREE.Color('#5a3418')),
      boxPart(w * 0.28, h + 2.4, -d * 0.15, 0.7, 2.6, 0.7, new THREE.Color('#8a8078')),
    ];
    // Log courses: thin darker bands.
    for (let k = 1; k < 7; k++) parts.push(boxPart(0, (h * k) / 7, 0, w + 0.06, 0.07, d + 0.06, wood.clone().multiplyScalar(0.7), 0, 1));
    const rise = 2.2;
    const roof = gableRoof(w, d, rise, 0.6, new THREE.Color('#f4f8ff'), wood);
    roof.applyMatrix4(matrix(0, h - gableEave(w, rise, 0.6), 0));
    parts.push(roof);
    ctx.batches.solid.add(merge(parts), matrix(p[0], y, p[1], 1, 1, 1, ry), WHITE);
    const win = boxPart(0, 0, 0, 1.0, 0.9, 0.05, dusk ? new THREE.Color(3, 2.2, 1) : new THREE.Color(2.4, 1.8, 0.9), 0, 1);
    const f = matrix(p[0], y, p[1], 1, 1, 1, ry);
    ctx.batches.glow.add(win, matrix(-w * 0.28, 1.8, d / 2 + 0.1).premultiply(f), WHITE);
    ctx.batches.glow.add(win, matrix(w * 0.28, 1.8, d / 2 + 0.1).premultiply(f), WHITE);
  }
}

function skiLift(ctx: ExtrasContext): void {
  const { site, plan } = ctx;
  for (let attempt = 0; attempt < 80; attempt++) {
    const [x0, z0] = site.randomPoint(ctx.rnd);
    const a = ctx.rnd() * Math.PI * 2;
    const n = 7;
    const gap = 38;
    const pts: [number, number, number][] = [];
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const x = x0 + Math.cos(a) * gap * i;
      const z = z0 + Math.sin(a) * gap * i;
      if (site.distToTrack(x, z) < site.outer + 30 || !site.isFree(x, z, 3)) ok = false;
      pts.push([x, plan.heightAt(x, z), z]);
    }
    if (!ok) continue;
    const steel = new THREE.Color('#8f98a4');
    const arm = 2.4;
    const top = pts.map(([x, y, z]) => new THREE.Vector3(x, y + 9.5, z));
    const dirX = Math.cos(a);
    const dirZ = Math.sin(a);
    const perpX = -dirZ;
    const perpZ = dirX;
    for (const [x, y, z] of pts) {
      const parts = [polePart(0, 0, 9.5, 0.28, steel, 8), boxPart(0, 9.4, 0, 0.5, 0.35, arm * 2 + 0.6, steel, 0)];
      ctx.batches.solid.add(merge(parts), matrix(x, y, z, 1, 1, 1, Math.atan2(perpX, perpZ) + Math.PI / 2), WHITE);
    }
    // Two cables with a gentle sag between pylons, and chairs hanging from them.
    const cables: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const path: THREE.Vector3[] = [];
      for (let i = 0; i < n - 1; i++) {
        for (let k = 0; k < 8; k++) {
          const t = k / 8;
          const p = top[i].clone().lerp(top[i + 1], t);
          p.y -= Math.sin(t * Math.PI) * 1.6;
          path.push(p.addScaledVector(new THREE.Vector3(perpX, 0, perpZ), side * arm));
        }
      }
      path.push(top[n - 1].clone().addScaledVector(new THREE.Vector3(perpX, 0, perpZ), side * arm));
      cables.push(paint(tubeGeo(path, path.map(() => 0.04), 4), () => scratch.set('#2a2d33')));
      const chairColors = ['#e03a3a', '#2f7be0', '#f2c230'];
      for (let i = 0; i < path.length; i += 6) {
        const c = path[i];
        ctx.batches.solid.add(boxPart(0, 0, 0, 0.9, 0.12, 0.7, new THREE.Color(chairColors[(i / 6) % 3 | 0]), Math.atan2(dirX, dirZ), 1), matrix(c.x, c.y - 2.1, c.z), WHITE);
        ctx.batches.solid.add(paint(tubeGeo([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1.9, 0)], [0.03, 0.03], 4), () => scratch.set('#333')), matrix(c.x, c.y, c.z), WHITE);
      }
    }
    ctx.batches.solid.add(merge(cables), matrix(0, 0, 0), WHITE);
    for (const [x, , z] of pts) site.reserve(x, z, 3);
    return;
  }
}

function drifts(ctx: ExtrasContext): void {
  const geo = blobGeo(2, 5, 0.12, 1.3, noise3);
  geo.applyMatrix4(matrix(0, 0, 0, 1, 0.34, 1.35));
  paint(geo, (_p, n) => scratch.set('#fbfdff').lerp(new THREE.Color('#bcd2ea'), THREE.MathUtils.clamp(0.45 - n.y * 0.5, 0, 0.6)));
  for (let i = 0; i < 70; i++) {
    const p = ctx.site.S[Math.floor(ctx.rnd() * ctx.site.S.length)];
    const side = ctx.rnd() < 0.5 ? -1 : 1;
    const [x, z] = ctx.site.beside(p, side * (ctx.site.outer + 4 + ctx.rnd() * 30));
    if (ctx.site.distToTrack(x, z) < ctx.site.outer + 3.5 || !ctx.site.isFree(x, z)) continue;
    const s = 1.4 + ctx.rnd() * 2.6;
    ctx.batches.solid.add(geo, matrix(x, ctx.plan.heightAt(x, z) - 0.1, z, s, s, s, ctx.rnd() * 6), WHITE);
  }
}

// ---------------------------------------------------------------------------
// Hot-air balloons
// ---------------------------------------------------------------------------

function balloonGeo(c1: string, c2: string): THREE.BufferGeometry {
  const prof: [number, number][] = [];
  const steps = 12;
  prof.push([0.01, 0]);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const a = t * Math.PI;
    prof.push([Math.sin(a) * 4.6 * (1 - 0.35 * Math.max(0, 1 - t * 2.2)), 4.5 - Math.cos(a) * 6.2 + 0]);
  }
  const env = latheGeo(prof.map(([r, y]) => [r, y + 3] as [number, number]), 20);
  const a = new THREE.Color(c1);
  const b = new THREE.Color(c2);
  paint(env, (p, n) => {
    const stripe = Math.floor(((Math.atan2(p.z, p.x) + Math.PI) / (Math.PI * 2)) * 10) % 2;
    return scratch.copy(stripe ? a : b).multiplyScalar(0.7 + 0.3 * THREE.MathUtils.clamp(n.y * 0.5 + 0.6, 0, 1));
  });
  const basket = boxPart(0, 0.4, 0, 1.6, 1.0, 1.6, new THREE.Color('#8a5a2e'));
  const ropes = [-0.7, 0.7].flatMap((x) => [-0.7, 0.7].map((z) => paint(tubeGeo([new THREE.Vector3(x, 0.9, z), new THREE.Vector3(x * 3.2, 4.4, z * 3.2)], [0.03, 0.03], 3), () => scratch.set('#444'))));
  return merge([env, paint(basket, (p, n) => scratch.set('#8a5a2e').multiplyScalar(0.7 + 0.3 * n.y + 0 * p.x)), ...ropes]);
}

function balloons(ctx: ExtrasContext, count: number): void {
  const palette = [
    ['#e03a3a', '#ffd23a'],
    ['#2f7be0', '#ffffff'],
    ['#33b54a', '#ffd23a'],
    ['#ff7eb6', '#ffffff'],
  ];
  for (let i = 0; i < count; i++) {
    const [c1, c2] = palette[i % palette.length];
    const a = ctx.rnd() * Math.PI * 2;
    const dist = 140 + ctx.rnd() * 340;
    const s = 2.2 + ctx.rnd() * 1.6;
    ctx.batches.solid.add(balloonGeo(c1, c2), matrix(ctx.site.cx + Math.cos(a) * dist, 70 + ctx.rnd() * 90, ctx.site.cz + Math.sin(a) * dist, s, s, s, ctx.rnd() * 6), WHITE);
  }
}
