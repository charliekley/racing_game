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
 *   peel       1   (one merged, vertex-coloured geometry: see peelModel.ts; internal id `slick`)
 *   magnet     3   (horseshoe + two field rings; plus 1 beam while it tows)
 *   bumper     2   (studded orb + glow shell)
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
import { buildPeelGeometry } from './peelModel';

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
// Peel (internal id `slick`): a 3-D fruit peel lying on the road
// ---------------------------------------------------------------------------

const peelGeo = buildPeelGeometry();
const peelMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: '#2b2200' });

/** The peel sits exactly on the ground: the sim's `y` already includes a 2 cm gap (see sim/items/groundPose.ts). */
const PEEL_HEIGHT = 0;
const PROJECTILE_HEIGHT = 0.6;

function buildSlick(): THREE.Object3D {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(peelGeo, peelMat));
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
// Magnet (red horseshoe with silver tips, floating above the kart, plus a beam to the kart it tows toward)
// ---------------------------------------------------------------------------

/** Horseshoe lying in the XZ plane with its open end toward +Z (the direction of travel). Vertex-coloured: one draw call. */
const magnetGeo = (() => {
  const red = new THREE.Color('#e8362e');
  const silver = new THREE.Color('#d6dbe6');
  const paintAll = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    return g.toNonIndexed();
  };
  // Half circle (the bend) of radius 0.36 around the origin, opening toward +Z.
  const bend = new THREE.TorusGeometry(0.36, 0.11, 10, 24, Math.PI).rotateX(-Math.PI / 2);
  const legs: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    legs.push(paintAll(new THREE.CylinderGeometry(0.11, 0.11, 0.4, 10).rotateX(Math.PI / 2).translate(sx * 0.36, 0, 0.2), red));
    legs.push(paintAll(new THREE.CylinderGeometry(0.115, 0.115, 0.16, 10).rotateX(Math.PI / 2).translate(sx * 0.36, 0, 0.48), silver));
  }
  return mergeGeometries([paintAll(bend, red), ...legs])!;
})();
const magnetMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#3a0a08' });
const magnetRingGeo = new THREE.TorusGeometry(0.5, 0.035, 6, 28); // axis along Z: a ring facing the direction of travel
const magnetRingMat = new THREE.MeshBasicMaterial({
  color: new THREE.Color('#7ad7ff').multiplyScalar(2),
  transparent: true,
  opacity: 0.6,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
// The beam is a thin cylinder along +Z of unit length; it is scaled/rotated to reach the towed kart.
const magnetBeamGeo = new THREE.CylinderGeometry(0.11, 0.11, 1, 8, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
const magnetBeamMat = new THREE.MeshBasicMaterial({
  color: new THREE.Color('#6fd0ff').multiplyScalar(2),
  transparent: true,
  opacity: 0.45,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

const MAGNET_HEIGHT = 1.75;

function buildMagnet(): THREE.Object3D {
  const g = new THREE.Group();
  const hover = new THREE.Group(); // bobs above the kart and points the way it faces
  hover.name = 'hover';
  hover.position.y = MAGNET_HEIGHT;
  hover.add(new THREE.Mesh(magnetGeo, magnetMat));
  for (let i = 0; i < 2; i++) {
    const ring = new THREE.Mesh(magnetRingGeo, magnetRingMat);
    ring.name = `ring${i}`;
    hover.add(ring);
  }
  const beam = new THREE.Mesh(magnetBeamGeo, magnetBeamMat);
  beam.name = 'beam';
  beam.visible = false;
  beam.frustumCulled = false;
  g.add(hover, beam);
  return g;
}

// ---------------------------------------------------------------------------
// Bumper (glossy orb with rubber studs that circles its owner)
// ---------------------------------------------------------------------------

const bumperGeo = (() => {
  const body = new THREE.SphereGeometry(0.4, 18, 12);
  const paintAll = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    return g.toNonIndexed();
  };
  const parts = [paintAll(body, new THREE.Color('#ff7a1a'))];
  // Six studs along the axes.
  const dirs = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
  const q = new THREE.Quaternion();
  for (const d of dirs) {
    const stud = new THREE.CylinderGeometry(0.13, 0.17, 0.22, 10);
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    stud.applyQuaternion(q);
    stud.translate(d.x * 0.42, d.y * 0.42, d.z * 0.42);
    parts.push(paintAll(stud, new THREE.Color('#2b2d3a')));
  }
  return mergeGeometries(parts)!;
})();
const bumperMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#2a1000' });
const bumperGlowGeo = new THREE.SphereGeometry(0.55, 14, 10);
const bumperGlowMat = new THREE.MeshBasicMaterial({
  color: new THREE.Color('#ffb04a'),
  transparent: true,
  opacity: 0.1,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

function buildBumper(): THREE.Object3D {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  spin.name = 'spin';
  spin.add(new THREE.Mesh(bumperGeo, bumperMat));
  g.add(spin, new THREE.Mesh(bumperGlowGeo, bumperGlowMat));
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
    body.position.y = PEEL_HEIGHT;
    body.add(buildSlick());
  } else if (kind === 'magnet') {
    body.add(buildMagnet());
  } else if (kind === 'bumper') {
    body.add(buildBumper());
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
  // Yaw first, then tilt in the object's own frame (same order as the kart bodies), so a Peel can lie on a slope.
  obj.rotation.order = 'YXZ';
  obj.rotation.set(entity.pitch ?? 0, entity.heading, entity.roll ?? 0);
  const body = obj.getObjectByName('body');
  if (!body) return;
  const t = timeSeconds + entity.uid * 0.7; // offset so neighbours don't pulse together
  switch (entity.kind) {
    case 'slick': {
      // Lying on the road: no animation at all (nothing to sink or float). While dragged it hangs behind the
      // kart: the front edge is lifted, it swings a little and bounces as it scrapes along.
      if (entity.trailing) {
        body.position.y = PEEL_HEIGHT + 0.14 + Math.abs(Math.sin(t * 9)) * 0.09;
        body.rotation.set(0.32 + Math.sin(t * 7) * 0.1, Math.sin(t * 4) * 0.12, Math.sin(t * 5.3) * 0.12);
      } else {
        body.position.y = PEEL_HEIGHT;
        body.rotation.set(0, 0, 0);
      }
      break;
    }
    case 'magnet': {
      // The magnet is not rotated with the kart's heading by the root: its own group turns and the beam is in world axes.
      obj.rotation.set(0, 0, 0);
      const hover = body.getObjectByName('hover');
      if (hover) {
        hover.rotation.y = entity.heading;
        hover.position.y = MAGNET_HEIGHT + Math.sin(t * 5) * 0.07;
        const life = entity.life ?? 1;
        hover.visible = life > 0.18 || Math.sin(t * 30) > 0; // blinks just before it runs out
        for (let i = 0; i < 2; i++) {
          // Field rings: expand ahead of the magnet while fading (a repeating pulse, the two a half-cycle apart).
          const ring = hover.getObjectByName(`ring${i}`);
          if (!ring) continue;
          const ph = (t * 1.6 + i * 0.5) % 1;
          ring.position.z = 0.4 + ph * 1.2;
          ring.scale.setScalar(0.5 + ph * 0.9);
        }
      }
      const beam = body.getObjectByName('beam');
      if (beam) {
        const link = entity.link;
        beam.visible = !!link;
        if (link) {
          // From the horseshoe to the roof of the towed kart, in world axes.
          const dx = link.x - entity.x;
          const dy = link.y + 1 - (entity.y + MAGNET_HEIGHT);
          const dz = link.z - entity.z;
          const len = Math.hypot(dx, dy, dz) || 1;
          beam.position.set(0, MAGNET_HEIGHT, 0);
          beam.quaternion.setFromUnitVectors(_zAxis, _v.set(dx / len, dy / len, dz / len));
          beam.scale.set(1 + Math.sin(t * 20) * 0.35, 1, len);
          magnetBeamMat.opacity = 0.35 + Math.sin(t * 12) * 0.12;
        }
      }
      break;
    }
    case 'bumper': {
      const spin = body.getObjectByName('spin');
      if (spin) spin.rotation.set(t * 3, t * 4.3, 0);
      const life = entity.life ?? 1;
      body.visible = life > 0.2 || Math.sin(t * 30) > 0; // blinks just before it pops
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

const _zAxis = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();

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
