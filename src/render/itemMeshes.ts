/**
 * 3D visuals for the items (Milestone 6), built only from primitives and a
 * canvas texture: no model or image files.
 *
 * The TV renders the whole scene once per player per frame, so everything here
 * is deliberately cheap: geometries and materials are created once at module
 * level and shared by every instance, and each object uses only a few meshes
 * ("draw calls"):
 *
 *   item box   2   (cube + glow shell)
 *   slick      2   (puddle + shine)
 *   ricochet   3   (ball + ring + trail)
 *   seeker     4   (body + nose + fins + exhaust)
 *   nova aura  3   (two shells + one Points object for sparkles)
 *
 * Because geometry/materials are shared, removing an entity needs no disposal;
 * only the nova aura owns per-instance materials (it has its own dispose()).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ItemEntity, ItemEntityKind, ItemId } from '../sim/items/types';

// ---------------------------------------------------------------------------
// Item box
// ---------------------------------------------------------------------------

/** How high the box hovers above its origin (the ground), in metres. */
const BOX_HOVER = 1.0;

/** Paint a rainbow color per vertex (hue follows the vertex position). */
function addRainbowColors(geo: THREE.BufferGeometry, hueScale: number): void {
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = (pos.getX(i) + pos.getY(i) * 0.8 + pos.getZ(i) * 0.6) * hueScale;
    c.setHSL(((h % 1) + 1) % 1, 0.9, 0.62);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// Cube is 1.0 m with rounded corners, the glow shell wraps it up to ~1.4 m.
const boxCubeGeo = new RoundedBoxGeometry(1.0, 1.0, 1.0, 3, 0.16);
addRainbowColors(boxCubeGeo, 0.9);
const boxShellGeo = new RoundedBoxGeometry(1.4, 1.4, 1.4, 2, 0.3);
addRainbowColors(boxShellGeo, 0.6);

/** Bold "?" drawn once and shared by all boxes. Null where there is no DOM (tests). */
let questionTex: THREE.CanvasTexture | null | undefined;
function getQuestionTexture(): THREE.CanvasTexture | null {
  if (questionTex !== undefined) return questionTex;
  if (typeof document === 'undefined') return (questionTex = null);
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  // Near-white face so the rainbow vertex colors still show through.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, n, n);
  ctx.font = 'bold 104px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText('?', n / 2, n / 2 + 6);
  ctx.fillStyle = '#2b1b6e';
  ctx.fillText('?', n / 2, n / 2 + 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return (questionTex = tex);
}

// A bright core inside the crate: the "glowing mark". Additive, so it blooms once post-processing is on.
const boxCoreGeo = new THREE.IcosahedronGeometry(0.3, 1);
const boxCoreMat = new THREE.MeshBasicMaterial({
  color: new THREE.Color('#fff6c8').multiplyScalar(3), // above 1.0 so it blooms
  transparent: true,
  opacity: 0.85,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

let boxCubeMat: THREE.MeshBasicMaterial | undefined;
const boxShellMat = new THREE.MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.28,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.BackSide,
});

/**
 * A floating, rainbow-colored translucent cube with a "?" on every face and a
 * soft glow shell. Place it with `position` (y = ground height); the cube
 * itself hovers ~1 m above that. Drive it with `animateItemBox`.
 */
export function buildItemBox(): THREE.Object3D {
  boxCubeMat ??= new THREE.MeshBasicMaterial({
    vertexColors: true,
    map: getQuestionTexture(),
    transparent: true,
    opacity: 0.72, // a see-through crate: you can spot the glowing core inside
  });
  const root = new THREE.Group();
  const pivot = new THREE.Group(); // spins and bobs
  pivot.position.y = BOX_HOVER;
  const cube = new THREE.Mesh(boxCubeGeo, boxCubeMat);
  const shell = new THREE.Mesh(boxShellGeo, boxShellMat);
  shell.name = 'shell';
  const core = new THREE.Mesh(boxCoreGeo, boxCoreMat);
  core.name = 'core';
  pivot.add(cube, shell, core);
  pivot.name = 'pivot';
  root.add(pivot);
  return root;
}

/** Spin and bob an item box. `phase` (radians) offsets boxes so they don't move in lockstep. */
export function animateItemBox(obj: THREE.Object3D, timeSeconds: number, phase = 0): void {
  const pivot = obj.getObjectByName('pivot');
  if (!pivot) return;
  pivot.rotation.y = timeSeconds * 1.6 + phase;
  pivot.rotation.x = Math.sin(timeSeconds * 1.1 + phase) * 0.18;
  pivot.position.y = BOX_HOVER + Math.sin(timeSeconds * 2.2 + phase) * 0.16;
  const shell = pivot.getObjectByName('shell');
  if (shell) shell.scale.setScalar(1 + Math.sin(timeSeconds * 4 + phase) * 0.05); // gentle glow pulse
  const core = pivot.getObjectByName('core');
  if (core) core.scale.setScalar(1 + Math.sin(timeSeconds * 6 + phase) * 0.25); // the core throbs
}

// ---------------------------------------------------------------------------
// Slick (oil puddle)
// ---------------------------------------------------------------------------

/** Irregular blob outline: a circle whose radius wobbles with a few sine waves. */
function blobGeometry(radius: number, squash: number): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  const steps = 28;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r = radius * (1 + 0.12 * Math.sin(3 * a + 1) + 0.08 * Math.sin(5 * a + 2) + 0.05 * Math.sin(7 * a));
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * squash;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  // ShapeGeometry lies in XY facing +Z; rotate so it lies flat facing up.
  return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
}

const slickGeo = blobGeometry(1.05, 0.9); // about 2.2 m wide
const slickShineGeo = blobGeometry(0.28, 0.5).translate(-0.4, 0, -0.35);
const slickMat = new THREE.MeshLambertMaterial({
  color: '#1a0f2b',
  emissive: '#2a1148',
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});
const slickShineMat = new THREE.MeshBasicMaterial({
  color: '#b9a4ff',
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
});

const SLICK_HEIGHT = 0.04; // just above the road to avoid z-fighting
const PROJECTILE_HEIGHT = 0.6;

function buildSlick(): THREE.Object3D {
  const g = new THREE.Group();
  const puddle = new THREE.Mesh(slickGeo, slickMat);
  const shine = new THREE.Mesh(slickShineGeo, slickShineMat);
  shine.position.y = 0.012;
  g.add(puddle, shine);
  g.userData.puddle = g; // the whole group wobbles
  return g;
}

// ---------------------------------------------------------------------------
// Ricochet (bright orb with ring band and trailing streak)
// ---------------------------------------------------------------------------

const ricoBallGeo = new THREE.SphereGeometry(0.35, 16, 12);
const ricoRingGeo = new THREE.TorusGeometry(0.42, 0.06, 6, 20);
// Streak is a cone behind the ball (toward -Z), tip pointing away from the direction of travel.
const ricoTrailGeo = new THREE.ConeGeometry(0.3, 1.3, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.95);
const ricoBallMat = new THREE.MeshLambertMaterial({ color: '#ffd23a', emissive: '#ff8a00', emissiveIntensity: 3 });
const ricoRingMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#35e0ff').multiplyScalar(3) });
const ricoTrailMat = new THREE.MeshBasicMaterial({
  color: '#ffb84a',
  transparent: true,
  opacity: 0.45,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});

function buildRicochet(): THREE.Object3D {
  const g = new THREE.Group();
  const spin = new THREE.Group(); // rolls about its X axis
  spin.name = 'spin';
  spin.add(new THREE.Mesh(ricoBallGeo, ricoBallMat));
  const ring = new THREE.Mesh(ricoRingGeo, ricoRingMat);
  ring.rotation.y = Math.PI / 2; // ring band around the rolling axis
  spin.add(ring);
  g.add(spin, new THREE.Mesh(ricoTrailGeo, ricoTrailMat));
  return g;
}

// ---------------------------------------------------------------------------
// Seeker (small missile, nose along +Z)
// ---------------------------------------------------------------------------

const seekBodyGeo = new THREE.CapsuleGeometry(0.17, 0.4, 4, 12).rotateX(Math.PI / 2).translate(0, 0, -0.05);
const seekNoseGeo = new THREE.ConeGeometry(0.17, 0.3, 12).rotateX(Math.PI / 2).translate(0, 0, 0.45);
// Four swept fins merged into one geometry (one draw call).
const seekFinsGeo = (() => {
  const fin = new THREE.BufferGeometry();
  // A flat triangle in the local XZ plane (x = outwards, z = along the missile), double sided via material.
  fin.setAttribute('position', new THREE.Float32BufferAttribute([0.1, 0, 0.0, 0.4, 0, -0.3, 0.1, 0, -0.3], 3));
  fin.computeVertexNormals();
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) parts.push(fin.clone().rotateZ((i * Math.PI) / 2).translate(0, 0, -0.1));
  return mergeGeometries(parts)!;
})();
const seekFlameGeo = new THREE.ConeGeometry(0.12, 0.6, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.75);
const seekBodyMat = new THREE.MeshLambertMaterial({ color: '#d7dce6', emissive: '#2c3a55' });
const seekNoseMat = new THREE.MeshLambertMaterial({ color: '#ff3d6e', emissive: '#6a0a28' });
const seekFinMat = new THREE.MeshLambertMaterial({ color: '#ff3d6e', side: THREE.DoubleSide });
const seekFlameMat = new THREE.MeshBasicMaterial({
  color: new THREE.Color('#ffb347').multiplyScalar(3),
  transparent: true,
  opacity: 0.85,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

function buildSeeker(): THREE.Object3D {
  const g = new THREE.Group();
  const flame = new THREE.Mesh(seekFlameGeo, seekFlameMat);
  flame.name = 'flame';
  g.add(
    new THREE.Mesh(seekBodyGeo, seekBodyMat),
    new THREE.Mesh(seekNoseGeo, seekNoseMat),
    new THREE.Mesh(seekFinsGeo, seekFinMat),
    flame,
  );
  return g;
}

// ---------------------------------------------------------------------------
// Entity API
// ---------------------------------------------------------------------------

/**
 * Build the mesh for a world item. Origin is on the ground below the object;
 * projectiles are lifted 0.6 m inside an inner group so `position.y` stays the ground height.
 */
export function buildEntityMesh(kind: ItemEntityKind): THREE.Object3D {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  if (kind === 'slick') {
    body.position.y = SLICK_HEIGHT;
    body.add(buildSlick());
  } else {
    body.position.y = PROJECTILE_HEIGHT;
    body.add(kind === 'ricochet' ? buildRicochet() : buildSeeker());
  }
  root.add(body);
  root.userData.kind = kind;
  return root;
}

/** Apply an entity's position/heading and animate it (spin, wobble, drag bounce). */
export function updateEntityMesh(obj: THREE.Object3D, entity: ItemEntity, timeSeconds: number): void {
  obj.position.set(entity.x, entity.y, entity.z);
  obj.rotation.y = entity.heading;
  const body = obj.getObjectByName('body');
  if (!body) return;
  const t = timeSeconds + entity.uid * 0.7; // offset so neighbours don't pulse together
  switch (entity.kind) {
    case 'slick': {
      // Oil sheen: the shine layer slowly cycles through purple/teal/pink and pulses (shared material).
      slickShineMat.color.setHSL(0.72 + Math.sin(timeSeconds * 0.9) * 0.14, 0.7, 0.68);
      slickShineMat.opacity = 0.45 + Math.sin(timeSeconds * 2.6) * 0.12;
      // Gentle breathing wobble of the puddle's outline.
      body.scale.set(1 + Math.sin(t * 2.3) * 0.03, 1, 1 + Math.cos(t * 1.9) * 0.03);
      // While dragged, it hops slightly above the road as if scraping along.
      body.position.y = entity.trailing ? SLICK_HEIGHT + 0.12 + Math.abs(Math.sin(t * 9)) * 0.1 : SLICK_HEIGHT;
      break;
    }
    case 'ricochet': {
      const spin = body.getObjectByName('spin');
      if (spin) spin.rotation.x = timeSeconds * 14 + entity.uid;
      body.position.y = PROJECTILE_HEIGHT + Math.sin(t * 8) * 0.04;
      break;
    }
    case 'seeker': {
      const flame = body.getObjectByName('flame');
      if (flame) flame.scale.set(1, 1, 0.8 + 0.4 * Math.abs(Math.sin(t * 40)));
      body.rotation.z = Math.sin(t * 6) * 0.08; // slight roll so it feels alive
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Nova aura (invincibility shell around a kart)
// ---------------------------------------------------------------------------

const auraGeo = new THREE.SphereGeometry(1, 20, 14);
const SPARKLES = 12;

export interface NovaAura {
  /** Add as a child of the kart's root group. Hidden while inactive. */
  object: THREE.Object3D;
  update(timeSeconds: number, active: boolean): void;
  /** Free the per-instance materials/geometry (call when the kart is removed). */
  dispose(): void;
}

/** Two color-cycling additive shells (slightly bigger than a ~1.9 m kart) plus orbiting sparkles. */
export function buildNovaAura(): NovaAura {
  const makeMat = (opacity: number, side: THREE.Side) =>
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side });
  const innerMat = makeMat(0.28, THREE.FrontSide);
  const outerMat = makeMat(0.18, THREE.BackSide);

  const group = new THREE.Group();
  group.visible = false;
  group.position.y = 0.45; // center roughly on the kart body
  const inner = new THREE.Mesh(auraGeo, innerMat);
  inner.scale.set(0.9, 0.7, 1.25);
  const outer = new THREE.Mesh(auraGeo, outerMat);
  outer.scale.set(1.1, 0.9, 1.5);
  group.add(inner, outer);

  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKLES * 3), 3));
  const sparkMat = new THREE.PointsMaterial({ size: 0.28, color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  group.add(sparks);

  const color = new THREE.Color();
  return {
    object: group,
    update(t, active) {
      group.visible = active;
      if (!active) return;
      // Cycle the hue over time; the two shells are a third of a turn apart.
      innerMat.color.copy(color.setHSL((t * 0.6) % 1, 0.95, 0.6));
      outerMat.color.copy(color.setHSL((t * 0.6 + 0.33) % 1, 0.95, 0.6));
      sparkMat.color.copy(color.setHSL((t * 0.6 + 0.66) % 1, 0.9, 0.75));
      const s = 1 + Math.sin(t * 7) * 0.04;
      inner.scale.set(0.9 * s, 0.7 * s, 1.25 * s);
      const so = 1 + Math.sin(t * 5 + 1) * 0.07;
      outer.scale.set(1.1 * so, 0.9 * so, 1.5 * so);
      outerMat.opacity = 0.2 + Math.sin(t * 9) * 0.06; // flickering corona
      const pos = sparkGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < SPARKLES; i++) {
        const a = t * 3 + (i / SPARKLES) * Math.PI * 2;
        pos.setXYZ(i, Math.cos(a) * 1.05, Math.sin(t * 2 + i * 1.7) * 0.5, Math.sin(a) * 1.45);
      }
      pos.needsUpdate = true;
    },
    dispose() {
      innerMat.dispose();
      outerMat.dispose();
      sparkMat.dispose();
      sparkGeo.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Held item (shown trailing behind the kart while dragged)
// ---------------------------------------------------------------------------

/** A small (~0.5 m) version of the item, or null for items that are not dragged. */
export function buildHeldItemMesh(id: ItemId): THREE.Object3D | null {
  const wrap = new THREE.Group();
  switch (id) {
    case 'slick': {
      const m = buildSlick();
      m.scale.setScalar(0.25);
      wrap.add(m);
      break;
    }
    case 'ricochet': {
      const m = buildRicochet();
      m.scale.setScalar(0.7);
      wrap.add(m);
      break;
    }
    case 'seeker': {
      const m = buildSeeker();
      m.scale.setScalar(0.6);
      wrap.add(m);
      break;
    }
    default:
      return null;
  }
  return wrap;
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

/**
 * Keeps live meshes in sync with the simulation's list of item entities:
 * creates a mesh when a uid first appears, updates it every frame, removes it
 * when the uid disappears. Call `update()` once per frame.
 */
export class ItemMeshPool {
  private meshes = new Map<number, THREE.Object3D>();
  private readonly seen = new Set<number>(); // reused every frame (no allocation in the hot path)

  constructor(private readonly parent: THREE.Object3D) {}

  update(entities: readonly ItemEntity[], timeSeconds: number): void {
    const seen = this.seen;
    seen.clear();
    for (const e of entities) {
      seen.add(e.uid);
      let mesh = this.meshes.get(e.uid);
      if (!mesh) {
        mesh = buildEntityMesh(e.kind);
        this.meshes.set(e.uid, mesh);
        this.parent.add(mesh);
      }
      updateEntityMesh(mesh, e, timeSeconds);
    }
    for (const [uid, mesh] of this.meshes) {
      if (!seen.has(uid)) {
        this.parent.remove(mesh); // geometry/materials are shared, so nothing to dispose
        this.meshes.delete(uid);
      }
    }
  }

  /** Number of live meshes (handy for tests). */
  get size(): number {
    return this.meshes.size;
  }

  /** The mesh currently representing `uid`, if any. */
  get(uid: number): THREE.Object3D | undefined {
    return this.meshes.get(uid);
  }

  clear(): void {
    for (const mesh of this.meshes.values()) this.parent.remove(mesh);
    this.meshes.clear();
  }
}
