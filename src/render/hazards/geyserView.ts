/**
 * Draws the lava geysers of Ember Peaks (the rules live in sim/hazards/geyser.ts).
 *
 * A geyser is always in one of three phases, and the picture tells you which without any text:
 *   idle    a dark scorch mark with a faint ember glow in the road (you learn where geysers are),
 *   warn    the crack glows brighter and flickers faster and faster, sparks jump out of it and
 *           steam rises (about 1.5 s: time to pick another lane),
 *   active  a bright lava column shoots up (about 1.2 s), with embers and smoke.
 *
 * 3D concepts used here:
 *  - INSTANCING: an `InstancedMesh` draws many copies of one shape in ONE draw call; each copy has
 *    its own transform matrix (and colour). All geysers of a track share 3-4 draw calls in total.
 *  - HDR GLOW: the post-processing bloom only picks up pixels brighter than about 1.0. Basic
 *    materials normally top out at 1.0, so the per-instance colour is a brightness MULTIPLIER (e.g. 3.5)
 *    on the orange vertex colours: that is how the lava "blooms".
 *  - Everything animates as a pure function of the (interpolated) race time, like the simulation.
 *    Particles are cosmetic only, so Math.random is fine for them.
 *
 * Cost: scorch + crack + halo + column (+ outer glow on High/Medium) = 4-5 draw calls for all geysers,
 * and a few particles per second only for geysers close to a camera.
 */
import * as THREE from 'three';
import type { Hazard } from '../../sim/hazards/types';
import { fxScaleFor } from '../fx/gameFx';
import { fxHub } from '../fx/hub';
import type { QualitySettings } from '../scene';

// ---------------------------------------------------------------------------------
// The look as a pure function (easy to test: no Three.js involved)
// ---------------------------------------------------------------------------------

/** Height of a full lava column (m). */
export const COLUMN_HEIGHT = 9;

export interface GeyserLook {
  /** Brightness multiplier of the crack on the road (1 = plain colour, above 1 = blooms). */
  crack: number;
  /** Column height (m, 0 = no column) and width factor (1 = the geyser radius). */
  columnHeight: number;
  columnWidth: number;
  /** Particles per second (before the quality scale). */
  sparkRate: number;
  steamRate: number;
  emberRate: number;
}

const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/**
 * How a geyser looks at one moment. `phase`/`t` come from `Hazard.pose(time)`; `time` (s) only drives flicker.
 */
export function geyserLook(phase: 'idle' | 'warn' | 'active', t: number, time: number): GeyserLook {
  switch (phase) {
    case 'idle':
      return { crack: 0.45 + 0.1 * Math.sin(time * 1.7), columnHeight: 0, columnWidth: 0, sparkRate: 0, steamRate: 2, emberRate: 0 };
    case 'warn': {
      // Flicker that speeds up as the eruption gets closer (frequency rises from ~3 Hz to ~9 Hz).
      const flicker = 0.5 + 0.5 * Math.sin(2 * Math.PI * (3 * t + 3 * t * t) * 1.5);
      const glow = (1.0 + 3.0 * t) * (0.55 + 0.45 * flicker);
      return { crack: glow, columnHeight: 0, columnWidth: 0, sparkRate: 8 + 50 * t, steamRate: 14 + 30 * t, emberRate: 0 };
    }
    default: {
      // Shoots up in the first 12 % of the eruption, stays, then collapses over the last 30 %.
      const rise = 1 - Math.pow(1 - Math.min(1, t / 0.12), 3);
      const fall = 1 - smooth(0.7, 1, t);
      const wobble = 1 + 0.08 * Math.sin(time * 40);
      return {
        crack: 4.5 * (0.4 + 0.6 * fall),
        columnHeight: COLUMN_HEIGHT * rise * fall * wobble,
        columnWidth: (0.55 + 0.45 * fall) * wobble,
        sparkRate: 30,
        steamRate: 12,
        emberRate: 90 * fall,
      };
    }
  }
}

// ---------------------------------------------------------------------------------
// Shared geometry (built once per view)
// ---------------------------------------------------------------------------------

/** Tiny deterministic hash -> 0..1, so every geyser's crack pattern is the same on every run. */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * A flat, jagged "starburst" in the XZ plane (a crack in the ground): a small hot disc in the middle
 * and pointed spikes of different lengths. Radius 1 = the geyser radius. Vertex colours run from
 * yellow-white in the middle to deep orange at the tips.
 */
function crackGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const hot = [1, 0.85, 0.35];
  const cool = [1, 0.3, 0.04];
  const tri = (a: number[], b: number[], c: number[], ca: number[], cb: number[], cc: number[]) => {
    // Wind counter-clockwise when seen from above (+Y) so the face points up (x right, z toward the viewer).
    pos.push(...a, ...b, ...c);
    col.push(...ca, ...cb, ...cc);
  };
  // Centre disc.
  const SEG = 10;
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2;
    const a1 = ((i + 1) / SEG) * Math.PI * 2;
    tri([0, 0, 0], [Math.sin(a1) * 0.28, 0, Math.cos(a1) * 0.28], [Math.sin(a0) * 0.28, 0, Math.cos(a0) * 0.28], hot, hot, hot);
  }
  // Spikes.
  const SPIKES = 9;
  for (let i = 0; i < SPIKES; i++) {
    const a = ((i + hash(i) * 0.6) / SPIKES) * Math.PI * 2;
    const len = 0.7 + 0.5 * hash(i + 20);
    const kink = (hash(i + 40) - 0.5) * 0.35; // the tip leans to one side: a crooked crack
    const w = 0.13 + 0.06 * hash(i + 60);
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const px = dz; // perpendicular
    const pz = -dx;
    const bx = dx * 0.2;
    const bz = dz * 0.2;
    const tip = [dx * len + px * kink, 0, dz * len + pz * kink];
    const mid = [dx * len * 0.55 + px * kink * 0.3, 0, dz * len * 0.55 + pz * kink * 0.3];
    const l = [bx + px * w, 0, bz + pz * w];
    const r = [bx - px * w, 0, bz - pz * w];
    const lm = [mid[0] + px * w * 0.45, 0, mid[2] + pz * w * 0.45];
    const rm = [mid[0] - px * w * 0.45, 0, mid[2] - pz * w * 0.45];
    tri(r, l, lm, hot, hot, cool);
    tri(r, lm, rm, hot, cool, cool);
    tri(rm, lm, tip, cool, cool, cool);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** A flat dark disc (the scorched ground around the crack). */
function scorchGeometry(): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(1.3, 20);
  g.rotateX(-Math.PI / 2); // CircleGeometry stands upright; lay it flat
  return g;
}

/**
 * A flat glow patch: a disc that is orange in the middle and black at the rim. With ADDITIVE blending black adds
 * nothing, so it fades out smoothly: a pool of light on the road (and on the lava, bloom turns it into a halo).
 */
function glowGeometry(): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(1, 28);
  g.rotateX(-Math.PI / 2);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  colors.set([1, 0.45, 0.08], 0); // vertex 0 is the centre of the fan; every other vertex stays black
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/**
 * An open, slightly tapered tube standing on the origin (height 1, bottom radius 1). Vertex colours:
 * yellow-orange at the base, orange in the middle and deep red at the top, so the column looks hottest at the root.
 */
function columnGeometry(topRadius: number, bottomRadius: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(topRadius, bottomRadius, 1, 14, 3, true);
  g.translate(0, 0.5, 0);
  const p = g.getAttribute('position');
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i); // 0 at the base .. 1 at the top
    colors[i * 3] = 1;
    colors[i * 3 + 1] = 0.62 - 0.46 * y;
    colors[i * 3 + 2] = 0.16 - 0.14 * y;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

// ---------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------

/** Geysers farther than this (m) from every camera skip their particles. */
const PARTICLE_RANGE = 120;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface GeyserSlot {
  hazard: Hazard;
  x: number;
  y: number;
  z: number;
  radius: number;
  /** Leftover fraction of a particle for each emitter, so low rates still average out. */
  accSpark: number;
  accSteam: number;
  accEmber: number;
}

export class GeyserView {
  private readonly slots: GeyserSlot[];
  private readonly scorch: THREE.InstancedMesh;
  private readonly crack: THREE.InstancedMesh;
  /** Additive pool of light around the crack: pulses during the warning so it is visible from afar. */
  private readonly halo: THREE.InstancedMesh;
  private readonly core: THREE.InstancedMesh;
  /** Soft outer glow around the column (not on Low). */
  private readonly sheath: THREE.InstancedMesh;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private scale: number;
  private lastTime = Number.NaN;
  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scl = new THREE.Vector3();
  private readonly tint = new THREE.Color();

  constructor(
    private readonly scene: THREE.Scene,
    hazards: Hazard[],
    quality: QualitySettings,
  ) {
    this.scale = fxScaleFor(quality);
    this.slots = hazards.map((hazard) => {
      const pose = hazard.pose(0);
      return {
        hazard,
        x: Number(pose.x),
        y: Number(pose.y),
        z: Number(pose.z),
        radius: Number(pose.radius ?? 3),
        accSpark: 0,
        accSteam: 0,
        accEmber: 0,
      };
    });
    const n = this.slots.length;

    const flat = (color: number, opacity: number, order: number) => {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      mat.fog = true;
      this.mats.push(mat);
      return { mat, order };
    };

    // Scorch mark: static dark disc under the crack.
    const scorchGeo = scorchGeometry();
    const scorchMat = flat(0x140806, 0.6, 1).mat;
    this.scorch = new THREE.InstancedMesh(scorchGeo, scorchMat, n);
    // Crack: orange starburst whose brightness is animated per instance.
    const crackGeo = crackGeometry();
    const crackMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mats.push(crackMat);
    this.crack = new THREE.InstancedMesh(crackGeo, crackMat, n);
    const haloGeo = glowGeometry();
    const haloMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.mats.push(haloMat);
    this.halo = new THREE.InstancedMesh(haloGeo, haloMat, n);
    // Column core + soft sheath.
    const coreGeo = columnGeometry(0.62, 0.9);
    const coreMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.mats.push(coreMat);
    this.core = new THREE.InstancedMesh(coreGeo, coreMat, n);
    const sheathGeo = columnGeometry(0.95, 1.35);
    const sheathMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mats.push(sheathMat);
    this.sheath = new THREE.InstancedMesh(sheathGeo, sheathMat, n);
    this.geos.push(scorchGeo, crackGeo, haloGeo, coreGeo, sheathGeo);

    for (const mesh of [this.scorch, this.crack, this.halo, this.core, this.sheath]) {
      mesh.frustumCulled = false; // the instances are spread along the whole track: skip the (useless) bounding test
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
    }
    this.scorch.renderOrder = 1;
    this.crack.renderOrder = 2;
    this.halo.renderOrder = 3;
    this.sheath.renderOrder = 10;
    this.setQuality(quality);

    // Static scorch marks; the other meshes are filled in every frame.
    this.slots.forEach((s, i) => {
      this.pos.set(s.x, s.y + 0.06, s.z);
      this.scl.set(s.radius / 3 + 0.35, 1, s.radius / 3 + 0.35);
      this.scorch.setMatrixAt(i, this.m.compose(this.pos, this.quat.identity(), this.scl));
    });
    this.scorch.instanceMatrix.needsUpdate = true;
    this.update(0, 0, undefined);
  }

  /** Low quality: no outer glow column. */
  setQuality(q: QualitySettings): void {
    this.scale = fxScaleFor(q);
    this.sheath.visible = q.name !== 'Low';
  }

  /**
   * Pose every geyser at race time `time` (s). `focus` = world positions of the cameras' karts;
   * geysers far from all of them skip their particles.
   */
  update(time: number, dt: number, focus: readonly { x: number; z: number }[] | undefined): void {
    // Real elapsed time between calls (fall back to the given dt); ignore jumps (new race, tab switch).
    const step = Number.isFinite(this.lastTime) ? time - this.lastTime : dt;
    this.lastTime = time;
    const emitDt = step > 0 && step < 0.25 ? step : 0;
    const fx = fxHub.current;

    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const pose = s.hazard.pose(time);
      const look = geyserLook(pose.phase, pose.t, time);

      // Crack on the road: brightness multiplier as the per-instance colour.
      this.pos.set(s.x, s.y + 0.1, s.z);
      const cs = s.radius * 0.92;
      this.scl.set(cs, 1, cs);
      this.crack.setMatrixAt(i, this.m.compose(this.pos, this.quat.identity(), this.scl));
      this.tint.setRGB(look.crack, look.crack, look.crack, THREE.LinearSRGBColorSpace);
      this.crack.setColorAt(i, this.tint);

      // Pool of light: wider than the crack, brighter as the crack glows.
      this.pos.set(s.x, s.y + 0.12, s.z);
      const hs = s.radius * (1.2 + 0.25 * Math.min(1, look.crack / 4));
      this.scl.set(hs, 1, hs);
      this.halo.setMatrixAt(i, this.m.compose(this.pos, this.quat.identity(), this.scl));
      const hb = look.crack * 0.28;
      this.tint.setRGB(hb, hb, hb, THREE.LinearSRGBColorSpace);
      this.halo.setColorAt(i, this.tint);

      // Lava column (zero scale hides it).
      const h = look.columnHeight;
      const w = s.radius * look.columnWidth * (h > 0 ? 1 : 0);
      this.pos.set(s.x, s.y, s.z);
      this.scl.set(w, Math.max(0.0001, h), w);
      this.m.compose(this.pos, this.quat.identity(), this.scl);
      this.core.setMatrixAt(i, this.m);
      this.sheath.setMatrixAt(i, this.m);
      this.tint.setRGB(2.6, 2.6, 2.6, THREE.LinearSRGBColorSpace); // HDR: far above 1, so the bloom picks it up
      this.core.setColorAt(i, this.tint);
      this.tint.setRGB(1.5, 1.5, 1.5, THREE.LinearSRGBColorSpace);
      this.sheath.setColorAt(i, this.tint);

      // Particles: only near a camera, and never when time is not advancing.
      if (!fx || emitDt <= 0) continue;
      if (focus && !focus.some((f) => Math.hypot(f.x - s.x, f.z - s.z) < PARTICLE_RANGE)) continue;
      s.accSpark += look.sparkRate * this.scale * emitDt;
      s.accSteam += look.steamRate * this.scale * emitDt;
      s.accEmber += look.emberRate * this.scale * emitDt;
      for (; s.accSpark >= 1; s.accSpark--) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * s.radius * 0.7;
        fx.glow.emit(s.x + Math.cos(a) * r, s.y + 0.2, s.z + Math.sin(a) * r, rand(-1.5, 1.5), rand(3, 8), rand(-1.5, 1.5), rand(0.5, 1), 0.42, 0.06, Math.random() < 0.5 ? 0xff8a1a : 0xffc23a, 1, 0.4, 9);
      }
      for (; s.accSteam >= 1; s.accSteam--) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * s.radius * 0.8;
        fx.smoke.emit(s.x + Math.cos(a) * r, s.y + 0.3, s.z + Math.sin(a) * r, rand(-0.5, 0.5), rand(1.5, 3), rand(-0.5, 0.5), rand(1.4, 2.4), 0.8, 3, 0xd9d3cd, 0.32, 0.4, -0.2);
      }
      for (; s.accEmber >= 1; s.accEmber--) {
        // Embers thrown out of the top of the column, falling back down.
        const a = Math.random() * Math.PI * 2;
        const sp = rand(1, 4);
        fx.glow.emit(s.x, s.y + h * rand(0.5, 1), s.z, Math.cos(a) * sp, rand(2, 8), Math.sin(a) * sp, rand(0.6, 1.2), 0.4, 0.05, Math.random() < 0.5 ? 0xff7a1a : 0xffd23a, 1, 0.3, 12);
      }
    }
    this.crack.instanceMatrix.needsUpdate = true;
    if (this.crack.instanceColor) this.crack.instanceColor.needsUpdate = true;
    this.halo.instanceMatrix.needsUpdate = true;
    if (this.halo.instanceColor) this.halo.instanceColor.needsUpdate = true;
    this.core.instanceMatrix.needsUpdate = true;
    if (this.core.instanceColor) this.core.instanceColor.needsUpdate = true;
    this.sheath.instanceMatrix.needsUpdate = true;
    if (this.sheath.instanceColor) this.sheath.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.scorch, this.crack, this.halo, this.core, this.sheath]) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
