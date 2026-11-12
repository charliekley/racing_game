/**
 * Draws the drawbridge of Dockside Loop (the rules live in sim/hazards/drawbridge.ts).
 *
 * What you see, in the order it happens:
 *   down      two flat leaves that look like the road (same asphalt texture); red warning lamps dark;
 *   warn      bell (audio) and AMBER lamps flashing alternately for about 2 s;
 *   rising    the leaves tilt up (RED lamps flash), the opening between the tips appears over the water;
 *   up        two ramps with yellow/black hazard stripes on the tips, red lamps still flashing;
 *   lowering  the leaves come back down.
 * Two gantries stand over the road at the hinges, held by four towers with a counterweight each: the
 * counterweights slide down while the leaves go up.
 *
 * 3D concepts used here:
 *  - A leaf is a flat slab whose TOP surface is exactly the ground the kart drives on (a plane through the
 *    hinge and the tip). A matrix built from three axis vectors (`makeBasis`) tilts it; the slab is longer than
 *    the leaf and its back end slides below the road beside the hinge (like a rolling-lift bridge).
 *  - INSTANCING: the towers, gantry beams, counterweights and lamps are `InstancedMesh`es (one draw call each).
 *  - HDR GLOW: lamp colours are brightness multipliers above 1.0; the bloom post-process picks them up.
 * Everything is a pure function of the (interpolated) race time. Cost: 2 leaves x 3 meshes + 4 instanced meshes.
 */
import * as THREE from 'three';
import { Drawbridge } from '../../sim/hazards/drawbridge';
import type { Hazard } from '../../sim/hazards/types';
import { rampTexture, roadTexture } from '../textures';
import type { QualitySettings } from '../scene';

// ---------------------------------------------------------------------------------
// The look as a pure function (no Three.js: easy to test)
// ---------------------------------------------------------------------------------

export type LampColor = 'off' | 'amber' | 'red';
export interface BridgeLook {
  /** Which colour the lamp group A (left/near side) and B show, and with what brightness multiplier (HDR: above 1 blooms). */
  lampA: { color: LampColor; glow: number };
  lampB: { color: LampColor; glow: number };
  /** 0..1: how far the counterweights have gone down (follows the lift). */
  counterweight: number;
}

/** Flash rate of the warning lamps (Hz): each side is on for half of every cycle, the two sides alternate. */
export const LAMP_HZ = 2.5;

/** Lamp state from the pose: `phase` idle/warn/active, `lift` 0..1 and the race time `time` (s). */
export function bridgeLook(phase: string, lift: number, time: number): BridgeLook {
  const half = Math.floor(time * LAMP_HZ * 2) % 2 === 0; // which side is lit right now
  if (phase === 'idle') return { lampA: { color: 'red', glow: 0.25 }, lampB: { color: 'red', glow: 0.25 }, counterweight: 0 };
  const color: LampColor = phase === 'warn' ? 'amber' : 'red';
  return {
    lampA: { color, glow: half ? 5 : 0.25 },
    lampB: { color, glow: half ? 0.25 : 5 },
    counterweight: lift,
  };
}

const LAMP_RGB: Record<LampColor, [number, number, number]> = {
  off: [0, 0, 0],
  amber: [1, 0.55, 0.05],
  red: [1, 0.07, 0.05],
};

// ---------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------

/** Tower height above the road (m): clear of the highest karts (a kart flying off the leaf reaches about 6 m). */
const TOWER_HEIGHT = 10;
/** Tower distance from the centre line (m): just outside the parapet. */
const TOWER_OFFSET = 9.6;
/** Thickness of a leaf slab (m), and how much longer than the half span it is (m). */
const SLAB_THICK = 0.7;
const SLAB_EXTRA = 2;

const UP = new THREE.Vector3(0, 1, 0);

/** The top face of a leaf: x along the slab from -length to 0 (the tip), z across; UVs run like the road ribbon (u across, v along). */
function leafTopGeometry(length: number, width: number, hw: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // Across: left kerb strip, road, right kerb strip (the road texture's edge pixels carry on over the kerb strips).
  const zs = [-width / 2, -hw, hw, width / 2];
  const us = [0, 0, 1, 1];
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const x of [-length, 0]) {
    zs.forEach((z, j) => {
      pos.push(x, 0, z);
      uv.push(us[j], x / 12);
    });
  }
  const m = zs.length;
  for (let j = 0; j < m - 1; j++) idx.push(j, j + m, j + 1, j + 1, j + m, j + m + 1);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // The winding above faces +Y; make sure (a flipped plane would be invisible from above).
  if (g.getAttribute('normal').getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

/** A flat hazard-striped plate at the tip of a leaf (x from -1.6 to 0). */
function stripeGeometry(width: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1.6, width);
  g.rotateX(-Math.PI / 2);
  g.translate(-0.8, 0, 0);
  // Stripes run across the plate: u along x, v across.
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 6, uv.getX(i));
  return g;
}

interface Bridge {
  hazard: Drawbridge;
  /** One group per leaf: [A, B]. Their matrices are set every frame. */
  leaves: [THREE.Group, THREE.Group];
  /** Index of this bridge's first lamp / counterweight in the instanced meshes. */
  lampBase: number;
  weightBase: number;
}

export class DrawbridgeView {
  private readonly bridges: Bridge[] = [];
  private readonly group = new THREE.Group();
  private readonly towers: THREE.InstancedMesh;
  private readonly beams: THREE.InstancedMesh;
  private readonly weights: THREE.InstancedMesh;
  private readonly lamps: THREE.InstancedMesh;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  /** Rest positions of the counterweights (high) and the lamp positions. */
  private readonly weightPos: THREE.Vector3[] = [];
  private readonly weightQuat: THREE.Quaternion[] = [];
  private readonly lampPos: THREE.Vector3[] = [];
  private readonly lampSide: (0 | 1)[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scl = new THREE.Vector3(1, 1, 1);
  private readonly tint = new THREE.Color();

  constructor(
    private readonly scene: THREE.Scene,
    hazards: Hazard[],
    _quality: QualitySettings,
  ) {
    const list = hazards.filter((h): h is Drawbridge => h instanceof Drawbridge);
    const n = list.length;

    // --- Materials -------------------------------------------------------------------------------
    const steel = new THREE.MeshStandardMaterial({ color: '#7d8794', roughness: 0.55, metalness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: '#4d535c', roughness: 0.8, metalness: 0.3 });
    const orange = new THREE.MeshStandardMaterial({ color: '#d9722b', roughness: 0.6, metalness: 0.3 });
    const roadTex = roadTexture();
    const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.86, metalness: 0 });
    const stripeTex = rampTexture();
    stripeTex.wrapS = stripeTex.wrapT = THREE.RepeatWrapping;
    const stripeMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.7, metalness: 0, emissive: '#3a2a00' });
    this.mats.push(steel, dark, orange, roadMat, stripeMat);
    this.textures.push(roadTex, stripeTex);

    // --- Static + animated instanced parts ---------------------------------------------------------
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const lampGeo = new THREE.SphereGeometry(0.42, 10, 8);
    this.geos.push(unitBox, lampGeo);
    this.towers = new THREE.InstancedMesh(unitBox, steel, n * 4);
    this.beams = new THREE.InstancedMesh(unitBox, dark, n * 2);
    this.weights = new THREE.InstancedMesh(unitBox, orange, n * 4);
    const lampMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    this.mats.push(lampMat);
    this.lamps = new THREE.InstancedMesh(lampGeo, lampMat, n * 8);
    for (const mesh of [this.towers, this.beams, this.weights, this.lamps]) {
      mesh.frustumCulled = false; // spread over the whole track: skip the (useless) bounding test
      mesh.castShadow = mesh !== this.lamps;
      this.group.add(mesh);
    }
    this.weights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    let ti = 0;
    let bi = 0;
    let wi = 0;
    let li = 0;
    for (const hazard of list) {
      const f = hazard.frame;
      const yaw = Math.atan2(f.tx, f.tz);
      const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
      const bridge: Bridge = { hazard, leaves: [new THREE.Group(), new THREE.Group()], lampBase: li, weightBase: wi };

      // Leaves: slab body + road-textured top + hazard stripes at the tip.
      const length = hazard.reachDown + SLAB_EXTRA;
      const width = f.halfWidth * 2;
      const hw = f.halfWidth - 1.2; // the asphalt itself (the kerb strips are the outer 1.2 m)
      const bodyGeo = new THREE.BoxGeometry(length, SLAB_THICK, width);
      bodyGeo.translate(-length / 2, -SLAB_THICK / 2 - 0.02, 0);
      const topGeo = leafTopGeometry(length, width, hw);
      topGeo.translate(0, 0.03, 0);
      const tipGeo = stripeGeometry(width);
      tipGeo.translate(0, 0.045, 0);
      this.geos.push(bodyGeo, topGeo, tipGeo);
      for (const leaf of bridge.leaves) {
        const body = new THREE.Mesh(bodyGeo, steel);
        const top = new THREE.Mesh(topGeo, roadMat);
        const tip = new THREE.Mesh(tipGeo, stripeMat);
        body.castShadow = true;
        top.receiveShadow = true;
        leaf.add(body, top, tip);
        leaf.matrixAutoUpdate = false;
        leaf.frustumCulled = false;
        this.group.add(leaf);
      }

      // Towers (4), gantry beams (2), counterweights (4), lamps (8).
      for (const [hinge, ex, ez, ey] of [
        ['A', f.ax, f.az, f.ay],
        ['B', f.bx, f.bz, f.by],
      ] as const) {
        const baseY = ey; // road height at the hinge (the beam hangs above this)
        for (const side of [-1, 1] as const) {
          const cx = ex + f.rx * TOWER_OFFSET * side;
          const cz = ez + f.rz * TOWER_OFFSET * side;
          // Tower: reaches 3 m below the road (hidden in the viaduct) up to TOWER_HEIGHT above it.
          this.pos.set(cx, baseY + (TOWER_HEIGHT - 3) / 2, cz);
          this.scl.set(1.3, TOWER_HEIGHT + 3, 1.3);
          this.towers.setMatrixAt(ti++, this.m.compose(this.pos, q, this.scl));
          // Counterweight on the outer face of the tower; its rest height is the top.
          const wx = cx + f.rx * 1.35 * side;
          const wz = cz + f.rz * 1.35 * side;
          this.weightPos.push(new THREE.Vector3(wx, baseY + TOWER_HEIGHT - 2.4, wz));
          this.weightQuat.push(q);
          wi++;
          // Lamp on top of the tower, on the road side.
          this.lampPos.push(new THREE.Vector3(cx - f.rx * 0.2 * side, baseY + TOWER_HEIGHT + 0.7, cz - f.rz * 0.2 * side));
          this.lampSide.push(side < 0 ? 0 : 1);
          li++;
        }
        // Gantry beam across the road between the towers, with two lamps hanging under it.
        this.pos.set(ex, baseY + TOWER_HEIGHT - 0.6, ez);
        this.scl.set(TOWER_OFFSET * 2, 1.0, 1.1);
        this.beams.setMatrixAt(bi++, this.m.compose(this.pos, q, this.scl));
        for (const side of [-1, 1] as const) {
          this.lampPos.push(new THREE.Vector3(ex + f.rx * 3.2 * side, baseY + TOWER_HEIGHT - 1.6, ez + f.rz * 3.2 * side));
          this.lampSide.push(side < 0 ? 0 : 1);
          li++;
        }
        void hinge;
      }
      this.bridges.push(bridge);
    }
    this.towers.instanceMatrix.needsUpdate = true;
    this.beams.instanceMatrix.needsUpdate = true;
    scene.add(this.group);
    this.update(0);
  }

  /** The bridge needs nothing from the quality setting (a handful of meshes); kept for the common view interface. */
  setQuality(_q: QualitySettings): void {}

  /** Pose every bridge at race time `time` (s). */
  update(time: number): void {
    const X = new THREE.Vector3();
    const N = new THREE.Vector3();
    const Z = new THREE.Vector3();
    const tt = new THREE.Vector3();
    for (const b of this.bridges) {
      const h = b.hazard;
      const f = h.frame;
      const pose = h.pose(time);
      const lift = pose.lift as number;
      const { reach, tipHeight } = h.leafAt(lift);
      const theta = Math.atan2(tipHeight, reach);
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      // Leaf A: tip at `reach` from hinge A, slab running back toward A. Leaf B: the mirror image.
      for (const [i, sign, uTip] of [
        [0, 1, reach],
        [1, -1, f.span - reach],
      ] as const) {
        tt.set(f.tx * sign, 0, f.tz * sign);
        X.copy(tt).multiplyScalar(c).addScaledVector(UP, s); // along the slab, toward the tip
        N.copy(tt).multiplyScalar(-s).addScaledVector(UP, c); // the slab's normal (up and a bit toward the opening)
        Z.crossVectors(X, N);
        const y = h.roadHeight(uTip) + tipHeight;
        this.m.makeBasis(X, N, Z).setPosition(f.ax + f.tx * uTip, y, f.az + f.tz * uTip);
        b.leaves[i].matrix.copy(this.m);
        b.leaves[i].matrixWorldNeedsUpdate = true;
      }
      // Lamps.
      const look = bridgeLook(String(pose.phase), lift, time);
      for (let k = 0; k < 8; k++) {
        const idx = b.lampBase + k;
        const side = this.lampSide[idx];
        const state = side === 0 ? look.lampA : look.lampB;
        this.pos.copy(this.lampPos[idx]);
        this.m.compose(this.pos, this.quat.identity(), this.scl.set(1, 1, 1));
        this.lamps.setMatrixAt(idx, this.m);
        const rgb = LAMP_RGB[state.color];
        this.tint.setRGB(rgb[0] * state.glow, rgb[1] * state.glow, rgb[2] * state.glow, THREE.LinearSRGBColorSpace);
        this.lamps.setColorAt(idx, this.tint);
      }
      // Counterweights slide down 3.4 m as the leaves rise.
      for (let k = 0; k < 4; k++) {
        const idx = b.weightBase + k;
        this.pos.copy(this.weightPos[idx]);
        this.pos.y -= 3.4 * look.counterweight;
        this.weights.setMatrixAt(idx, this.m.compose(this.pos, this.weightQuat[idx], this.scl.set(1.2, 2.4, 2.4)));
      }
    }
    this.lamps.instanceMatrix.needsUpdate = true;
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
    this.weights.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const mesh of [this.towers, this.beams, this.weights, this.lamps]) mesh.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
