/**
 * Draws the launch cannons of a track (see sim/cannon.ts for how they work).
 *
 * Each cannon is built from simple primitives, in an original design:
 *   - a chunky charcoal barrel tilted ~30 deg up on a swivel base with side cheeks,
 *   - colored bands around the barrel and a lip at the muzzle,
 *   - a glowing funnel at the low end: the "mouth" the kart drives into,
 *   - a strip of warning chevrons on the road before the mouth,
 *   - at the landing point: a bold painted ring with arrows and a faint light beam,
 *   - a muzzle flash + smoke puffs + sparks when it fires.
 *
 * Cost: 6 draw calls per cannon (body, funnel, flash, chevrons, pad, beam). Geometry and
 * materials are shared by all cannons (built once, lazily); only the chevron strip is unique
 * because it follows the road height.
 *
 * Local cannon frame (before it is rotated to the road heading): mouth at the origin,
 * +Z along the road, +Y up. The barrel axis runs from E = (0, 1.9, 0) to the muzzle
 * M = (0, 4.6, 4.8): the same numbers as CANNON.muzzleForward / muzzleUp in the sim.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CANNON, type ResolvedCannon } from '../sim/cannon';
import { forwardOf, rightOf } from '../sim/kart';
import type { Track } from '../sim/track';
import { SparkEmitter } from './effects';

const TILT = THREE.MathUtils.degToRad(30);
/** Unit vector along the barrel axis (pointing up and forward). */
const AXIS = new THREE.Vector3(0, Math.sin(TILT), Math.cos(TILT));
/** Where the barrel axis starts (the low end, behind the funnel). */
const ENTRY = new THREE.Vector3(0, 1.9, 0);
const BARREL_LEN = Math.hypot(CANNON.muzzleForward, CANNON.muzzleUp - ENTRY.y);

const BAND_ORANGE = '#ff7a1a';
const BAND_WHITE = '#f1ece2';
const STEEL = '#3b4350';
const DARK = '#262b33';
const GLOW = '#3df2ff';
const PAD = '#7dff7a';

// ---------------------------------------------------------------------------------
// Shared geometry and materials (built once)
// ---------------------------------------------------------------------------------

/** Paint every vertex of a geometry one color (for merging parts into one vertex-colored mesh). */
function tint(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Point along the barrel axis, `t` metres from the entry. */
const alongAxis = (t: number) => ENTRY.clone().addScaledVector(AXIS, t);

/** A cylinder whose axis is the barrel axis, centered at barrel position `t`. */
function barrelCylinder(rTop: number, rBottom: number, length: number, t: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, length, 20, 1, true);
  g.rotateX(Math.PI / 2 - TILT); // cylinder axis +Y -> barrel axis
  const p = alongAxis(t);
  return g.translate(p.x, p.y, p.z);
}

/** A ring around the barrel at barrel position `t`. */
function barrelRing(radius: number, tube: number, t: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(radius, tube, 8, 24);
  g.rotateX(-TILT); // torus axis +Z -> barrel axis
  const p = alongAxis(t);
  return g.translate(p.x, p.y, p.z);
}

/** Flat parallelogram chevron pieces (a "V" pointing +Z) lying in the XZ plane. Returns triangle vertices. */
function chevronTriangles(halfWidth: number, length: number, thickness: number, zCenter: number): number[][] {
  const tris: number[][] = [];
  for (const side of [-1, 1]) {
    const p0 = [side * halfWidth, zCenter - length / 2];
    const p1 = [side * halfWidth, zCenter - length / 2 + thickness];
    const p2 = [0, zCenter + length / 2];
    const p3 = [0, zCenter + length / 2 - thickness];
    tris.push([...p0, ...p1, ...p2], [...p0, ...p2, ...p3]);
  }
  return tris;
}

/** Turn [x0,z0, x1,z1, x2,z2] triangles into a flat geometry at height y (normals up). */
function flatGeometry(tris: number[][], y = 0): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const t of tris) for (let i = 0; i < 3; i++) pos.push(t[i * 2], y, t[i * 2 + 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

interface Shared {
  body: THREE.BufferGeometry;
  funnel: THREE.BufferGeometry;
  flash: THREE.BufferGeometry;
  pad: THREE.BufferGeometry;
  beam: THREE.BufferGeometry;
  puff: THREE.BufferGeometry;
  bodyMat: THREE.Material;
  funnelMat: THREE.MeshBasicMaterial;
  flashMat: THREE.MeshBasicMaterial;
  chevronMat: THREE.Material;
  padMat: THREE.Material;
  beamMat: THREE.MeshBasicMaterial;
}
let shared: Shared | null = null;

function getShared(): Shared {
  if (shared) return shared;

  // Body: barrel, bands, lip, swivel base and cheeks, merged with vertex colors.
  const parts: THREE.BufferGeometry[] = [
    tint(barrelCylinder(1.9, 2.05, BARREL_LEN + 0.4, BARREL_LEN / 2), STEEL),
    tint(barrelRing(2.0, 0.2, BARREL_LEN * 0.22), BAND_ORANGE),
    tint(barrelRing(2.0, 0.2, BARREL_LEN * 0.4), BAND_WHITE),
    tint(barrelRing(2.0, 0.2, BARREL_LEN * 0.58), BAND_ORANGE),
    tint(barrelRing(2.05, 0.32, BARREL_LEN), BAND_ORANGE), // muzzle lip
    tint(new THREE.CylinderGeometry(2.9, 3.2, 0.9, 20).translate(0, 0.45, 2.4), DARK), // swivel base
    tint(new THREE.CylinderGeometry(1.6, 1.9, 0.5, 16).translate(0, 1.15, 2.4), STEEL),
    tint(new THREE.BoxGeometry(0.7, 3.2, 2.4).translate(2.35, 2.0, 2.4), STEEL), // cheeks
    tint(new THREE.BoxGeometry(0.7, 3.2, 2.4).translate(-2.35, 2.0, 2.4), STEEL),
  ];
  const body = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());

  // Funnel (the glowing mouth): a wide-open cone plus a bright lip ring, merged.
  const funnelCone = new THREE.CylinderGeometry(1.95, 2.7, 1.7, 24, 1, true); // top (+Y = barrel direction) narrow
  funnelCone.rotateX(Math.PI / 2 - TILT);
  const fc = alongAxis(-0.85);
  funnelCone.translate(fc.x, fc.y, fc.z);
  const lip = new THREE.TorusGeometry(2.7, 0.2, 8, 28);
  lip.rotateX(-TILT);
  const lc = alongAxis(-1.7);
  lip.translate(lc.x, lc.y, lc.z);
  const funnel = mergeGeometries([funnelCone, lip])!;
  funnelCone.dispose();
  lip.dispose();

  // Muzzle flash: a cone shooting out of the barrel end.
  const flash = new THREE.ConeGeometry(1.7, 5, 14, 1, true);
  flash.rotateX(Math.PI / 2 - TILT); // cone tip (+Y) -> along the barrel
  const fm = alongAxis(BARREL_LEN + 2.4);
  flash.translate(fm.x, fm.y, fm.z);

  // Landing pad: a bold ring plus three arrows along the landing direction.
  const ring = new THREE.RingGeometry(3.7, 5.2, 40).rotateX(-Math.PI / 2);
  ring.deleteAttribute('uv'); // must have the same attributes as the arrows to merge
  const arrows = flatGeometry([-1.9, 0, 1.9].flatMap((z) => chevronTriangles(1.6, 1.6, 0.6, z)));
  const pad = mergeGeometries([ring.toNonIndexed(), arrows])!;
  ring.dispose();
  arrows.dispose();

  const beam = new THREE.CylinderGeometry(4.6, 4.6, 16, 24, 1, true).translate(0, 8, 0);

  shared = {
    body,
    funnel,
    flash,
    pad,
    beam,
    puff: new THREE.IcosahedronGeometry(1, 1),
    bodyMat: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    funnelMat: new THREE.MeshBasicMaterial({
      color: GLOW,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    flashMat: new THREE.MeshBasicMaterial({
      color: '#fff1b0',
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    chevronMat: new THREE.MeshBasicMaterial({
      color: '#ffcf1f',
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
    padMat: new THREE.MeshBasicMaterial({
      color: PAD,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
    beamMat: new THREE.MeshBasicMaterial({
      color: PAD,
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  };
  return shared;
}

// ---------------------------------------------------------------------------------
// Smoke puffs: a small shared pool of translucent balls that grow and fade
// ---------------------------------------------------------------------------------
interface Puff {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size: number;
}

class SmokePool {
  private readonly puffs: Puff[] = [];
  private next = 0;
  constructor(scene: THREE.Scene, geo: THREE.BufferGeometry, count = 20) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: '#d9d3c8', transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.puffs.push({ mesh, vel: new THREE.Vector3(), age: 1, life: 1, size: 1 });
    }
  }

  emit(at: THREE.Vector3, vel: THREE.Vector3, size: number, life: number): void {
    const p = this.puffs[this.next];
    this.next = (this.next + 1) % this.puffs.length;
    p.mesh.position.copy(at);
    p.vel.copy(vel);
    p.age = 0;
    p.life = life;
    p.size = size;
    p.mesh.visible = true;
  }

  update(dt: number): void {
    for (const p of this.puffs) {
      if (!p.mesh.visible) continue;
      p.age += dt;
      const f = p.age / p.life;
      if (f >= 1) {
        p.mesh.visible = false;
        continue;
      }
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-1.8 * dt)); // air drag
      p.vel.y += 1.2 * dt; // smoke drifts up
      p.mesh.scale.setScalar(p.size * (0.4 + 1.8 * f));
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - f) * (1 - f);
    }
  }

  dispose(scene: THREE.Scene): void {
    for (const p of this.puffs) {
      scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
  }
}

// ---------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------
interface CannonParts {
  group: THREE.Group;
  flash: THREE.Mesh;
  flashTime: number;
  ownGeometry: THREE.BufferGeometry[];
}

export class CannonView {
  readonly group = new THREE.Group();
  private readonly parts: CannonParts[] = [];
  private readonly smoke: SmokePool;
  private readonly sparks: SparkEmitter;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpVel = new THREE.Vector3();

  /**
   * @param cannons  the track's resolved cannons (`track.cannons`)
   * @param track    optional: lets the chevrons and landing pad follow the road height
   */
  constructor(
    scene: THREE.Scene,
    private readonly cannons: readonly ResolvedCannon[],
    track?: Track,
  ) {
    const sh = getShared();
    this.smoke = new SmokePool(scene, sh.puff);
    this.sparks = new SparkEmitter(scene);
    this.sparks.setTier(2); // orange
    scene.add(this.group);

    for (const c of cannons) {
      const group = new THREE.Group();
      const ownGeometry: THREE.BufferGeometry[] = [];

      // Cannon: placed at the mouth, turned to the road heading (rotation.y = heading, like the karts).
      const cannon = new THREE.Group();
      cannon.position.set(c.mouth.x, c.mouth.y, c.mouth.z);
      cannon.rotation.y = c.mouth.heading;
      const body = new THREE.Mesh(sh.body, sh.bodyMat);
      body.castShadow = true;
      cannon.add(body, new THREE.Mesh(sh.funnel, sh.funnelMat));
      const flash = new THREE.Mesh(sh.flash, sh.flashMat);
      flash.visible = false;
      cannon.add(flash);
      group.add(cannon);

      // Warning chevrons on the road before the mouth (in world space so they follow the road height).
      const chev = this.buildChevrons(c, track);
      ownGeometry.push(chev);
      group.add(new THREE.Mesh(chev, sh.chevronMat));

      // Landing pad + light beam.
      const landingGround = track?.sample(c.landing.x, c.landing.z)?.height ?? c.landing.y;
      const pad = new THREE.Mesh(sh.pad, sh.padMat);
      pad.position.set(c.landing.x, landingGround + 0.12, c.landing.z);
      pad.rotation.y = c.landing.heading;
      const beam = new THREE.Mesh(sh.beam, sh.beamMat);
      beam.position.set(c.landing.x, landingGround, c.landing.z);
      group.add(pad, beam);

      this.group.add(group);
      this.parts.push({ group, flash, flashTime: 0, ownGeometry });
    }
  }

  /** A strip of 5 yellow chevrons leading up to the mouth, hugging the road surface. */
  private buildChevrons(c: ResolvedCannon, track?: Track): THREE.BufferGeometry {
    const f = forwardOf(c.mouth.heading);
    const r = rightOf(c.mouth.heading);
    const pos: number[] = [];
    const tris = [0, 1, 2, 3, 4].flatMap((i) => chevronTriangles(2.8, 1.8, 0.65, -(4.5 + i * 2.6)));
    for (const t of tris) {
      for (let i = 0; i < 3; i++) {
        const lx = t[i * 2];
        const lz = t[i * 2 + 1];
        const x = c.mouth.x + r.x * lx + f.x * lz;
        const z = c.mouth.z + r.z * lx + f.z * lz;
        const y = (track?.sample(x, z)?.height ?? c.mouth.y) + 0.09;
        pos.push(x, y, z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }

  /** A kart was just fired from cannon `index`: flash, smoke and sparks. */
  fire(index: number): void {
    const c = this.cannons[index];
    const part = this.parts[index];
    if (!c || !part) return;
    part.flashTime = 0.22;
    part.flash.visible = true;

    // Direction of the barrel in world space.
    const f = forwardOf(c.mouth.heading);
    const d = this.tmpVel.set(f.x * Math.cos(TILT), Math.sin(TILT), f.z * Math.cos(TILT));
    const at = this.tmp.set(c.muzzle.x, c.muzzle.y, c.muzzle.z);
    for (let i = 0; i < 12; i++) {
      const spread = new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.3) * 4, (Math.random() - 0.5) * 6);
      const vel = spread.addScaledVector(d, 7 + Math.random() * 7);
      this.smoke.emit(at, vel, 0.9 + Math.random() * 0.9, 1.1 + Math.random() * 0.7);
    }
    // A few puffs also blow out of the funnel (back-blast) along the road.
    const back = new THREE.Vector3(c.mouth.x - f.x * 2, c.mouth.y + 1.2, c.mouth.z - f.z * 2);
    for (let i = 0; i < 4; i++) {
      const v = new THREE.Vector3(-f.x * 4 + (Math.random() - 0.5) * 5, 1 + Math.random() * 2, -f.z * 4 + (Math.random() - 0.5) * 5);
      this.smoke.emit(back, v, 0.8 + Math.random() * 0.5, 0.8);
    }
    this.sparks.emit(at, new THREE.Vector3(d.x * 3, 0, d.z * 3), 40);
  }

  /** Animate glows, flashes and particles. `time` = seconds since start, `dt` = frame time. */
  update(time: number, dt: number): void {
    const sh = getShared();
    // The mouth pulses so it reads as "drive in here".
    sh.funnelMat.opacity = 0.45 + 0.25 * Math.sin(time * 5);
    sh.beamMat.opacity = 0.11 + 0.05 * Math.sin(time * 2.5);
    for (const part of this.parts) {
      if (part.flashTime > 0) {
        part.flashTime -= dt;
        const k = Math.max(0, part.flashTime / 0.22);
        part.flash.visible = part.flashTime > 0;
        part.flash.scale.setScalar(0.5 + 1.1 * (1 - k));
      }
    }
    this.smoke.update(dt);
    this.sparks.update(dt);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    for (const p of this.parts) for (const g of p.ownGeometry) g.dispose();
    this.smoke.dispose(scene);
    this.sparks.dispose(scene);
  }
}
