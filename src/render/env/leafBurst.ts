/**
 * Leaf bursts (Autumn Speedway): when a kart drives through a leaf pile, leaves are kicked up, flutter
 * through the air and settle on the ground again, where they fade away a moment later.
 *
 * Render-only (the pile has no collider and no gameplay effect). The piles themselves are drawn by
 * `buildLeafPiles` (env/treetop.ts); this file only adds the flying leaves on top.
 *
 * How it works, in short:
 *  - A fixed POOL of leaves (a few hundred) is drawn with ONE InstancedMesh (one draw call). Unused leaves
 *    are squashed to zero size, so they cost nothing to look at.
 *  - Every frame `update(dt, karts)` checks each kart against each pile (a handful of piles: trivial).
 *    A fast kart inside a pile "emits" leaves at a rate that grows with its speed.
 *  - Each leaf is a tiny physics particle: gravity (weak, leaves float), air drag, a little sideways
 *    flutter, and when it touches the ground it stops and shrinks away over its last second of life.
 *    A ring buffer re-uses the oldest leaf when the pool is full.
 */
import * as THREE from 'three';
import type { Track } from '../../sim/track';
import { seededRandom } from '../textures';

/** Where a pile sits (world coordinates) and its size (m). Shared by the pile mesh and the burst view. */
export interface LeafPileSite {
  x: number;
  y: number;
  z: number;
  size: number;
}

/** The minimum a kart must provide: where it is and how fast it moves. */
export interface BurstKart {
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  grounded: boolean;
}

const POOL = 220;
/** Gravity on a leaf (m/s^2): much weaker than a stone, a leaf floats. */
const GRAVITY = 6;
/** Horizontal air drag (1/s). */
const DRAG = 1.6;
/** A kart slower than this (m/s) does not kick up leaves. */
const MIN_SPEED = 3;
/** Leaves emitted per second at 20 m/s. */
const RATE = 70;

const LEAF_COLORS = ['#c8602a', '#d8822a', '#e0a03a', '#a8481a', '#b87a2a'].map((h) => new THREE.Color(h));

export class LeafBurstView {
  readonly mesh: THREE.InstancedMesh;
  private readonly sites: LeafPileSite[];
  private readonly rnd = seededRandom(31337);
  // Particle state, structure-of-arrays (fast and allocation free).
  private readonly px = new Float32Array(POOL);
  private readonly py = new Float32Array(POOL);
  private readonly pz = new Float32Array(POOL);
  private readonly vx = new Float32Array(POOL);
  private readonly vy = new Float32Array(POOL);
  private readonly vz = new Float32Array(POOL);
  private readonly age = new Float32Array(POOL).fill(1e9);
  private readonly life = new Float32Array(POOL);
  private readonly spin = new Float32Array(POOL);
  private readonly ground = new Float32Array(POOL);
  private readonly landed = new Uint8Array(POOL);
  private readonly accum: number[];
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();

  constructor(sites: LeafPileSite[]) {
    this.sites = sites;
    this.accum = sites.map(() => 0);
    // One leaf: a small bent diamond (same idea as the falling leaves), a little bigger since it is seen close up.
    const L = 0.3;
    const W = 0.2;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, L, W, 0.04, 0, 0, 0, -L, -W, 0.04, 0, 0, 0.03, 0], 3));
    g.setIndex([0, 1, 4, 4, 1, 2, 2, 3, 4, 4, 3, 0]);
    g.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(g, mat, POOL);
    this.mesh.frustumCulled = false; // the pool is spread over the whole course
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < POOL; i++) {
      this.mesh.setColorAt(i, LEAF_COLORS[i % LEAF_COLORS.length]);
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  /** Throw one leaf from (x, y, z) with a starting velocity. */
  private emit(x: number, y: number, z: number, kx: number, kz: number, ground: number): void {
    const i = this.next;
    this.next = (this.next + 1) % POOL;
    const r = this.rnd;
    this.px[i] = x + (r() - 0.5) * 1.6;
    this.py[i] = y + 0.2;
    this.pz[i] = z + (r() - 0.5) * 1.6;
    // Thrown mostly up and a bit sideways, carried partly along with the kart.
    const a = r() * Math.PI * 2;
    const out = 1 + r() * 3;
    this.vx[i] = kx * 0.35 + Math.cos(a) * out;
    this.vz[i] = kz * 0.35 + Math.sin(a) * out;
    this.vy[i] = 3.5 + r() * 4.5;
    this.age[i] = 0;
    this.life[i] = 2.6 + r() * 1.6; // seconds until it has faded away
    this.spin[i] = r() * 10;
    this.ground[i] = ground;
    this.landed[i] = 0;
  }

  /** Advance the particles by `dt` seconds and kick up new leaves where karts drive through piles. */
  update(dt: number, karts: Iterable<BurstKart>): void {
    if (dt <= 0) return;
    for (const k of karts) {
      if (!k.grounded) continue;
      const speed = Math.hypot(k.vel.x, k.vel.z);
      if (speed < MIN_SPEED) continue;
      for (let s = 0; s < this.sites.length; s++) {
        const site = this.sites[s];
        const reach = site.size * 1.3 + 0.8;
        const dx = k.pos.x - site.x;
        const dz = k.pos.z - site.z;
        if (dx * dx + dz * dz > reach * reach || Math.abs(k.pos.y - site.y) > 2.5) continue;
        this.accum[s] += (RATE * speed * dt) / 20;
        while (this.accum[s] >= 1) {
          this.accum[s] -= 1;
          this.emit(k.pos.x, k.pos.y, k.pos.z, k.vel.x, k.vel.z, site.y);
        }
      }
    }

    let dirty = false;
    for (let i = 0; i < POOL; i++) {
      if (this.age[i] >= this.life[i]) {
        if (this.age[i] < 1e8) {
          this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0)); // just finished: hide it once
          this.age[i] = 1e9;
          dirty = true;
        }
        continue;
      }
      dirty = true;
      this.age[i] += dt;
      if (!this.landed[i]) {
        this.vy[i] -= GRAVITY * dt;
        const drag = Math.exp(-DRAG * dt);
        this.vx[i] *= drag;
        this.vz[i] *= drag;
        // Flutter: a leaf wobbles from side to side as it falls.
        const t = this.age[i] * 7 + this.spin[i];
        this.vx[i] += Math.sin(t) * 2.2 * dt;
        this.vz[i] += Math.cos(t * 1.3) * 2.2 * dt;
        this.vy[i] = Math.max(this.vy[i], -3); // terminal speed: a leaf never plunges
        this.px[i] += this.vx[i] * dt;
        this.py[i] += this.vy[i] * dt;
        this.pz[i] += this.vz[i] * dt;
        if (this.py[i] <= this.ground[i] + 0.18 && this.vy[i] < 0) {
          this.py[i] = this.ground[i] + 0.18;
          this.landed[i] = 1;
        }
      }
      // Shape: flat when landed, tumbling in the air; shrinks away over the last second of its life.
      const left = this.life[i] - this.age[i];
      const size = 1.2 * Math.min(1, left);
      const tumble = this.landed[i] ? 0 : this.age[i] * 6 + this.spin[i];
      this.e.set(Math.sin(tumble) * 0.9, this.spin[i] + (this.landed[i] ? 0 : tumble * 0.3), Math.cos(tumble * 0.8) * 0.9);
      this.q.setFromEuler(this.e);
      this.pos.set(this.px[i], this.py[i], this.pz[i]);
      this.scl.setScalar(size);
      this.mesh.setMatrixAt(i, this.m.compose(this.pos, this.q, this.scl));
    }
    // Upload only when something moved or vanished this frame.
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** The piles of a track: world position, ground height and size. Same placement as the pile meshes. */
export function leafPileSites(track: Track): LeafPileSite[] {
  const piles = track.def.scenery.treetop?.leafPiles ?? [];
  return piles.map((pile) => {
    const p = track.pointAt(track.sAt(pile.at), (pile.offset * track.def.width) / 2);
    return { x: p.x, z: p.z, y: track.sample(p.x, p.z, p.index)?.height ?? p.y, size: pile.size ?? 2.2 };
  });
}
