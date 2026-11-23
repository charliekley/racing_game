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
 *   ricochet   3   (ball + ring + trail)
 *   seeker     4   (body + nose + fins + exhaust)
 *   nova aura  3   (two shells + one Points object for sparkles)
 *   rocket     ~8  (capsule + glow + bands + nose + fins + flame; shown only on a kart that is a Rocket)
 *   storm      8   (cloud puffs + bolt; shown over a kart for about a second after the strike)
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
// Rocket shell: the glowing capsule a kart is wrapped in while it is a Rocket
// ---------------------------------------------------------------------------

/** Shared (module-level) geometry and materials: every kart's shell uses the same ones, so a shell costs no memory beyond its Group. */
const shellParts = (() => {
  // Capsule along +Z (the direction of travel): radius 1.08 m, 2.3 m straight part, rounded ends = 4.5 m long in total.
  const glass = new THREE.CapsuleGeometry(1.08, 2.3, 6, 18).rotateX(Math.PI / 2);
  const glow = new THREE.CapsuleGeometry(1.2, 2.4, 6, 18).rotateX(Math.PI / 2);
  // Two white bands round the barrel.
  const band = new THREE.TorusGeometry(1.09, 0.07, 6, 28);
  // A silver nose tip.
  const nose = new THREE.SphereGeometry(0.4, 12, 8).scale(1, 1, 2).translate(0, 0, 0.2); // an egg: pointed along the flight direction
  // Four swept fins at the tail in an X (so none sticks straight up in the chase camera's view): a flat shape extruded thin, spun round the axis.
  // In the shape, x runs along the capsule (negative = toward the tail) and y points away from the axis.
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(0, 0.7);
  finShape.lineTo(-0.8, 1.2);
  finShape.lineTo(-0.9, 0.4);
  finShape.lineTo(-0.6, 0);
  finShape.closePath();
  const fin = new THREE.ExtrudeGeometry(finShape, { depth: 0.1, bevelEnabled: false }).translate(0, 0, -0.05);
  const fins: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const g = fin.clone();
    g.rotateY(Math.PI / 2); // x -> -Z (the tail), y stays outward
    g.rotateZ(Math.PI / 4 + (i * Math.PI) / 2);
    fins.push(g);
  }
  const finGeo = mergeGeometries(fins)!;
  // Flame: cones pointing backwards (tip toward -Z), additive.
  const flameOuter = new THREE.ConeGeometry(0.4, 1.1, 14, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -2.75);
  const flameInner = new THREE.ConeGeometry(0.22, 0.7, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -2.6);
  return { glass, glow, band, nose, finGeo, flameOuter, flameInner };
})();
const shellMats = {
  glass: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff5fc8').multiplyScalar(1.2), transparent: true, opacity: 0.2, depthWrite: false }),
  glow: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7ad9').multiplyScalar(2), transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }),
  trim: new THREE.MeshStandardMaterial({ color: '#f4f6fb', roughness: 0.35, metalness: 0.2, emissive: '#444a66' }),
  fin: new THREE.MeshStandardMaterial({ color: '#6a3df0', roughness: 0.45, metalness: 0.1, emissive: '#2a1480' }),
  flameOuter: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a1a').multiplyScalar(2.2), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  flameInner: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe98a').multiplyScalar(2.6), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
};

export interface RocketShell {
  /** Add as a child of the kart's root group. Hidden while inactive. */
  object: THREE.Object3D;
  /**
   * `on` = the kart is a rocket now. The shell grows round the kart when it turns on and pops away when it ends
   * (a short ease), so it is visible for a moment longer than `on`. `timeLeft` makes the flame sputter at the very end.
   */
  update(dt: number, timeSeconds: number, on: boolean, timeLeft: number): void;
}

/** The glowing capsule with fins and a flame trail that wraps the kart while it is a Rocket (about 4.5 m long, 2.2 m wide). */
export function buildRocketShell(): RocketShell {
  const root = new THREE.Group();
  root.visible = false;
  const body = new THREE.Group(); // centred round the kart's body and scaled for the grow/pop animation
  body.position.set(0, 0.55, 0.15);
  root.add(body);
  const p = shellParts;
  body.add(new THREE.Mesh(p.glass, shellMats.glass), new THREE.Mesh(p.glow, shellMats.glow));
  for (const z of [0.6, -0.9]) {
    const b = new THREE.Mesh(p.band, shellMats.trim);
    b.position.z = z;
    body.add(b);
  }
  const nose = new THREE.Mesh(p.nose, shellMats.trim);
  nose.position.z = 2.15;
  body.add(nose);
  const fins = new THREE.Mesh(p.finGeo, shellMats.fin);
  fins.position.z = -1.45;
  body.add(fins);
  const flame = new THREE.Group();
  flame.add(new THREE.Mesh(p.flameOuter, shellMats.flameOuter), new THREE.Mesh(p.flameInner, shellMats.flameInner));
  body.add(flame);
  // The glass is see-through on purpose: the kart and driver are visible inside. Never cast shadows from the shell.
  body.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
    o.frustumCulled = false;
  });
  let k = 0; // 0 = not shown, 1 = fully on
  return {
    object: root,
    update(dt, t, on, timeLeft) {
      k += ((on ? 1 : 0) - k) * (1 - Math.exp(-dt / (on ? 0.09 : 0.06)));
      if (!on && k < 0.02) k = 0;
      root.visible = k > 0.01;
      if (!root.visible) return;
      // Pop in with a slight overshoot, shrink away when it ends.
      const s = k * (1 + 0.12 * Math.sin(Math.min(1, k) * Math.PI));
      body.scale.set(s, s, s);
      // The flame flickers (and sputters in the last half second).
      const sputter = timeLeft < 0.5 && on ? 0.5 + 0.5 * Math.sin(t * 60) : 1;
      const f = (0.85 + Math.sin(t * 47) * 0.12 + Math.sin(t * 31) * 0.08) * sputter;
      flame.scale.set(1 + Math.sin(t * 53) * 0.06, 1 + Math.sin(t * 61) * 0.06, f);
      shellMats.glow.opacity = 0.14 + Math.sin(t * 9) * 0.04;
    },
  };
}

// ---------------------------------------------------------------------------
// Storm cloud: the dark cloud and lightning bolt over a kart that was just struck
// ---------------------------------------------------------------------------

// Each puff is shaded by height in its own vertex colours (dark belly, lighter top), and drawn unlit: scene lighting and
// fog would wash a dark cloud out to the pale sky colour. During the strike the whole cloud flashes brighter.
const cloudPuffGeo = (() => {
  const g = new THREE.SphereGeometry(1, 14, 10);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const dark = new THREE.Color('#1a1c34');
  const light = new THREE.Color('#4b4f7c');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(dark).lerp(light, Math.max(0, Math.min(1, (pos.getY(i) + 1) / 2)));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
})();
const cloudMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.97, fog: false });
const boltMat = new THREE.MeshBasicMaterial({
  color: new THREE.Color('#fff7b0').multiplyScalar(3), // above 1.0: blooms
  transparent: true,
  opacity: 1,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
  fog: false,
});
/** Height of the cloud above the kart (m), and the number of zig-zag segments of the bolt. */
export const CLOUD_HEIGHT = 5.2;
const BOLT_SEGMENTS = 9;

export interface StormCloud {
  /** Add to the SCENE (not to the kart: it must not shrink with the kart). Hidden while inactive. */
  object: THREE.Object3D;
  /** Place over (x, y, z) (the kart). `zap` = seconds left of the strike (0 = no cloud), `zapTotal` = its full length. */
  update(dt: number, x: number, y: number, z: number, zap: number, zapTotal: number): void;
  dispose(): void;
}

export function buildStormCloud(): StormCloud {
  const root = new THREE.Group();
  root.visible = false;
  // A fluffy flat-bottomed cloud from squashed spheres.
  const cloud = new THREE.Group();
  for (const [x, y, z, r] of [[0, 0, 0, 1.5], [-1.5, -0.15, 0.2, 1.1], [1.5, -0.1, -0.1, 1.15], [0.6, 0.55, 0.3, 1.0], [-0.7, 0.45, -0.3, 0.95], [0.1, -0.2, -0.9, 1.0], [0.1, -0.15, 0.95, 0.95]]) {
    const m = new THREE.Mesh(cloudPuffGeo, cloudMat);
    m.position.set(x, y, z);
    m.scale.set(r, r * 0.66, r);
    m.castShadow = false;
    cloud.add(m);
  }
  cloud.position.y = CLOUD_HEIGHT;
  root.add(cloud);
  // Two crossed ribbons make the bolt visible from every side. Positions are rewritten a few times per second.
  const boltGeo = new THREE.BufferGeometry();
  const verts = new Float32Array(2 * BOLT_SEGMENTS * 2 * 3);
  boltGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  const idx: number[] = [];
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < BOLT_SEGMENTS - 1; i++) {
      const a = (s * BOLT_SEGMENTS + i) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  boltGeo.setIndex(idx);
  const bolt = new THREE.Mesh(boltGeo, boltMat);
  bolt.frustumCulled = false;
  root.add(bolt);
  let boltClock = 0;
  const rebuildBolt = () => {
    const pos = boltGeo.getAttribute('position') as THREE.BufferAttribute;
    let jx = 0;
    let jz = 0;
    for (let i = 0; i < BOLT_SEGMENTS; i++) {
      const u = i / (BOLT_SEGMENTS - 1);
      const y = CLOUD_HEIGHT - 0.6 - u * (CLOUD_HEIGHT - 0.6 - 0.4);
      jx = i === BOLT_SEGMENTS - 1 ? 0 : jx * 0.5 + (Math.random() - 0.5) * 1.3 * (1 - u * 0.4);
      jz = i === BOLT_SEGMENTS - 1 ? 0 : jz * 0.5 + (Math.random() - 0.5) * 1.3 * (1 - u * 0.4);
      const w = 0.2 * (1 - u * 0.5);
      // Ribbon 0 spreads along x, ribbon 1 along z.
      pos.setXYZ(i * 2, jx - w, y, jz);
      pos.setXYZ(i * 2 + 1, jx + w, y, jz);
      pos.setXYZ((BOLT_SEGMENTS + i) * 2, jx, y, jz - w);
      pos.setXYZ((BOLT_SEGMENTS + i) * 2 + 1, jx, y, jz + w);
    }
    pos.needsUpdate = true;
  };
  rebuildBolt();
  return {
    object: root,
    update(dt, x, y, z, zap, zapTotal) {
      root.visible = zap > 0;
      if (!root.visible) return;
      root.position.set(x, y, z);
      const age = zapTotal - zap;
      // The cloud swells in (0.2 s) and shrinks away over the last 0.3 s; it drifts and rumbles a little.
      const grow = Math.min(1, age / 0.2) * Math.min(1, zap / 0.3);
      const e = grow * grow * (3 - 2 * grow);
      cloud.scale.setScalar(Math.max(0.001, e));
      cloud.position.y = CLOUD_HEIGHT + (1 - e) * 1.5 + Math.sin(age * 9) * 0.06;
      cloud.rotation.y = age * 0.6;
      // The bolt strikes at 0.12 s and flickers for about 0.5 s (a new jagged shape every ~50 ms).
      const striking = age > 0.12 && age < 0.65;
      bolt.visible = striking;
      if (striking) {
        boltClock += dt;
        if (boltClock > 0.05) {
          boltClock = 0;
          rebuildBolt();
        }
        boltMat.opacity = 0.55 + 0.45 * Math.abs(Math.sin(age * 70));
      }
      // The cloud lights up while the bolt flashes.
      cloudMat.color.setScalar(striking ? 1.9 : 1);
    },
    dispose() {
      boltGeo.dispose();
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
