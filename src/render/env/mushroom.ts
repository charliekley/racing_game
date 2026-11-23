/**
 * Mushroom Valley set pieces: the giant mushrooms, the mist in the gorges and the glowing cave.
 * Only tracks with `def.scenery.mushroom` use this file (see `isMushroom`).
 *
 *  - GIANT CAPS (`MushroomView`): every cap of `track.def.caps` (the SAME list the physics reads, through
 *    `Bouncers`) gets a cap and a thick stalk that disappears down into the mist. Green caps and all stalks are merged
 *    into ONE static mesh. The orange caps are one INSTANCED mesh (the same cap drawn many times, each copy with its own
 *    matrix), so each can squash and stretch on its own when a kart bounces on it: still one draw call.
 *  - MIST (`buildMist`): layers of soft cloud (a canvas texture made at start-up) stacked in every gorge and under the
 *    cave. One merged mesh, one draw call.
 *  - THE CAVE (`buildCave`): a rock vault over the cave's stretch of road (lumpy vertex-coloured rock, stalactites) and
 *    bioluminescent little mushrooms stuck to it (one instanced mesh with glowing HDR colours, so the bloom picks them up).
 *
 * Web/3D concepts used here:
 *  - A "lathe" turns a profile curve (radius, height) into a surface of revolution: a vase, a stalk, a mushroom cap.
 *  - "Vertex colours" bake the colour of every corner into the geometry, so one material draws cream spots, orange
 *    caps and rock without any image file.
 *  - An "instanced" mesh draws one geometry many times with a different matrix each time. Changing a matrix = moving,
 *    scaling or rotating one copy. Squash-and-stretch is just a non-uniform scale on the matrix.
 */
import * as THREE from 'three';
import { Bouncers, type Cap } from '../../sim/bouncers';
import { Track } from '../../sim/track';
import { seededRandom } from '../textures';
import { latheGeo, matrix, merge, paint, placed, type ColorFn } from './geo';
import { ENV_TIME } from './materials';
import { fbm3, noise3, smoothstep } from './noise';

/** True if the track uses the mushroom look. */
export function isMushroom(track: Track): boolean {
  return track.def.scenery.mushroom !== undefined;
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const ORANGE = new THREE.Color('#ff7a1a');
const ORANGE_RIM = new THREE.Color('#d9480f');
const GREEN = new THREE.Color('#3fb54a');
const GREEN_RIM = new THREE.Color('#1f7a3a');
const CREAM = new THREE.Color('#fff3d2');
const GILL = new THREE.Color('#f3d9a6');
const STALK = new THREE.Color('#f1e4c4');
const STALK_SHADE = new THREE.Color('#c9b58c');
const MIST = new THREE.Color('#c4d5ea');
const _c = new THREE.Color();

// ---------------------------------------------------------------------------
// A cap
// ---------------------------------------------------------------------------

/**
 * A cap of radius 1 with its flat top at y = 0: a flat top (the physics surface) with a rounded shoulder, then the
 * rim, then the gills underneath. Painted with a few cream spots on top.
 */
function capGeo(kind: 'orange' | 'green', seed: number): THREE.BufferGeometry {
  const profile: [number, number][] = [
    [0.1, -0.36], // under the stalk
    [0.4, -0.33],
    [0.7, -0.26],
    [0.93, -0.2],
    [1.0, -0.13],
    [0.99, -0.06], // the rim
    [0.94, -0.02],
    [0.86, 0], // top surface starts (flat)
  ];
  for (let r = 0.82; r > 0.001; r -= 0.04) profile.push([r, 0]); // many rings on the flat top, so the spots have crisp edges
  profile.push([0, 0]);
  const geo = latheGeo(profile, 56);
  // Cream spots on the top: a few big, a few small, from the seed (the same cap always looks the same).
  const rnd = seededRandom(seed);
  const spots: { x: number; z: number; r: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * 0.76;
    spots.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: 0.05 + rnd() * rnd() * 0.15 });
  }
  const base = kind === 'orange' ? ORANGE : GREEN;
  const rim = kind === 'orange' ? ORANGE_RIM : GREEN_RIM;
  const color: ColorFn = (p, n) => {
    if (n.y < -0.25 || p.y < -0.18) {
      // Underside: pale gills, darker toward the stalk.
      return _c.copy(GILL).multiplyScalar(0.62 + 0.38 * smoothstep(0.1, 0.9, Math.hypot(p.x, p.z)));
    }
    // Top and shoulder: bright in the middle, deeper toward the rim.
    const r = Math.hypot(p.x, p.z);
    _c.copy(base).lerp(rim, smoothstep(0.55, 1.0, r) * 0.85);
    const blotch = noise3(p.x * 3, 0, p.z * 3, seed) * 0.14 - 0.07;
    _c.offsetHSL(0, 0, blotch);
    if (p.y > -0.05) {
      let s = 0;
      for (const sp of spots) s = Math.max(s, 1 - smoothstep(sp.r * 0.9, sp.r, Math.hypot(p.x - sp.x, p.z - sp.z)));
      _c.lerp(CREAM, s);
    }
    return _c;
  };
  return paint(geo, color);
}

/** A stalk from just under the cap down into the mist (world units). Colour fades to mist colour with depth. */
function stalkGeo(cap: Cap, mistY: number): THREE.BufferGeometry {
  const top = cap.y - cap.radius * 0.3;
  const bottom = mistY - 36;
  const rTop = cap.radius * 0.2;
  const steps = 9;
  const profile: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps; // 0 = bottom, 1 = top
    const y = bottom + (top - bottom) * t;
    // Thin neck under the cap, slowly swelling, then a wide flare at the very bottom.
    const r = rTop * (1 + 1.4 * Math.pow(1 - t, 1.5) + (t < 0.15 ? (0.15 - t) * 8 : 0));
    profile.push([r, y]);
  }
  const geo = latheGeo(profile, 12, (a, t) => 1 + 0.06 * Math.sin(a * 3 + t * 9)); // a little lumpy
  const color: ColorFn = (p) => {
    const ring = 0.5 + 0.5 * Math.sin(p.y * 0.9);
    _c.copy(STALK).lerp(STALK_SHADE, 0.25 * ring + 0.4 * (1 - smoothstep(top - 25, top, p.y)));
    return _c.lerp(MIST, smoothstep(mistY + 12, mistY - 18, p.y));
  };
  return paint(placed(geo, matrix(cap.x, 0, cap.z, 1, 1, 1)), color);
}

// ---------------------------------------------------------------------------
// Mist
// ---------------------------------------------------------------------------

/** A soft cloud texture (white blobs with a fuzzy edge) drawn on a canvas. Not tiled: its edge fades to nothing. */
function mistTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const edge = smoothstep(0.5, 0.15, Math.hypot(u - 0.5, v - 0.5)); // fades to nothing at the border
      const n = fbm3(u * 6, v * 6, 0.3, 5, 4);
      const a = Math.min(1, edge * smoothstep(0.25, 0.8, n) * 1.25);
      const k = (y * size + x) * 4;
      img.data[k] = 255;
      img.data[k + 1] = 255;
      img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A horizontal square of mist: centre, size, rotation (rad) and height, as geometry in world space. */
function mistQuad(cx: number, y: number, cz: number, w: number, d: number, rot: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.rotateY(rot);
  g.translate(cx, y, cz);
  return g;
}

/**
 * Every gorge and the cave pit get a stack of soft cloud layers well below the road, so the chasms look bottomless and
 * cloudy. The terrain hides the parts that lie under solid ground; only what is inside a chasm shows.
 */
function buildMist(track: Track, areas: { x: number; z: number; w: number; d: number; rot: number; y: number }[]): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const rnd = seededRandom(404);
  for (const a of areas) {
    // Bottom layers first (they are drawn first): the deepest is the thickest, the top one wispy.
    for (let layer = 0; layer < 3; layer++) {
      const y = a.y - 8 - layer * 12;
      const grow = 1 + 0.14 * layer;
      const g = mistQuad(a.x + (rnd() - 0.5) * 8, y, a.z + (rnd() - 0.5) * 8, a.w * grow, a.d * grow, a.rot + (rnd() - 0.5) * 0.4);
      const pos = g.getAttribute('position');
      // Per-layer opacity in the vertex alpha: the bottom layer is nearly solid, the top one thin.
      const col = new Float32Array(pos.count * 4);
      const k = layer === 2 ? 1.0 : layer === 1 ? 0.75 : 0.5;
      for (let i = 0; i < pos.count; i++) col.set([1, 1, 1, k], i * 4);
      g.setAttribute('color', new THREE.BufferAttribute(col, 4));
      parts.push(g);
    }
  }
  const geo = merge(parts);
  const mat = new THREE.MeshBasicMaterial({ map: mistTexture(), color: MIST, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.92 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  void track;
  return mesh;
}

// ---------------------------------------------------------------------------
// The cave
// ---------------------------------------------------------------------------

/** The cave's frame: for each position along its axis, the world centre line and the sideways direction. */
interface Section {
  x: number;
  z: number;
  y: number;
  rx: number;
  rz: number;
  /** 0..1 across the length of the cave (for the portals). */
  u: number;
}

const ROCK = new THREE.Color('#7b7168');
const ROCK_DARK = new THREE.Color('#34303a');
const GRASS = new THREE.Color('#5f8f3e');

/** Where the vault stands: sections along the cave's stretch of main road (a little longer at both ends). */
function caveSections(track: Track): { sections: Section[]; centreOffset: number } {
  const m = track.def.scenery.mushroom!.cave;
  const s0 = track.sAt(m.from) - 26;
  const s1 = track.sAt(m.to) + 26;
  const len = (((s1 - s0) % track.length) + track.length) % track.length;
  const n = Math.max(6, Math.round(len / 9));
  const sections: Section[] = [];
  for (let i = 0; i <= n; i++) {
    const s = (s0 + (len * i) / n) % track.length;
    const p = track.pointAt(s);
    const q = track.samples[p.index];
    sections.push({ x: p.x, z: p.z, y: p.y, rx: q.rx, rz: q.rz, u: i / n });
  }
  // The vault is centred between the main road and the second route (to the left of the road, about 16 m).
  return { sections, centreOffset: -m.halfWidth * 0.26 };
}

/** The rock shell: an arch swept along the cave, with lumpy rock, portals at both ends and stalactites. */
function buildCave(track: Track): { shell: THREE.Mesh; points: { x: number; y: number; z: number; nx: number; ny: number; nz: number }[] } {
  const m = track.def.scenery.mushroom!.cave;
  const { sections, centreOffset } = caveSections(track);
  const N = sections.length;
  const M = 22; // vertices across the arch
  const pos: number[] = [];
  const idx: number[] = [];
  const surface: { x: number; y: number; z: number; nx: number; ny: number; nz: number }[] = [];
  const rnd = seededRandom(77);
  sections.forEach((sec, i) => {
    // Portals: the vault is lower and narrower at both ends, like a cave mouth.
    const mouth = smoothstep(0, 0.16, Math.min(sec.u, 1 - sec.u));
    const half = m.halfWidth * (0.62 + 0.38 * mouth);
    const roof = m.roof * (0.45 + 0.55 * mouth);
    for (let j = 0; j < M; j++) {
      const th = (j / (M - 1)) * Math.PI; // 0 = left foot, PI = right foot
      const lat = centreOffset - Math.cos(th) * half;
      // A flattened arch: steep at the feet, broad at the top.
      const up = Math.pow(Math.sin(th), 0.7) * roof;
      const bump = 1 + 0.13 * (fbm3(i * 0.35, j * 0.45, 2.7, 9, 3) - 0.5) * 2;
      const x = sec.x + sec.rx * lat * bump;
      const z = sec.z + sec.rz * lat * bump;
      const y = sec.y - 14 + (up + 14 * Math.sin(th)) * bump;
      pos.push(x, y, z);
    }
  });
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < M - 1; j++) {
      const a = i * M + j;
      idx.push(a, a + M, a + 1, a + 1, a + M, a + M + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Two skins: the INSIDE of the vault is dark mottled rock with strata (what you see while driving through it); the
  // OUTSIDE (a hair larger) is a grassy hill on top, rock lower down. One shell can only have one colour per
  // vertex, hence two meshes. Which side faces out depends on the triangle winding, so test one top vertex.
  const nor = g.getAttribute('normal');
  const p = g.getAttribute('position');
  const topVertex = Math.floor(N / 2) * M + Math.floor(M / 2);
  const outward = nor.getY(topVertex) > 0 ? 1 : -1;
  const base = (k: number) => {
    const n = fbm3(p.getX(k) * 0.07, p.getY(k) * 0.07, p.getZ(k) * 0.07, 3, 3);
    const strata = 0.5 + 0.5 * Math.sin(p.getY(k) * 0.45 + n * 4);
    return { n, c: _c.copy(ROCK_DARK).lerp(ROCK, 0.3 + 0.5 * n + 0.2 * strata) };
  };
  const inside: number[] = [];
  const outside: number[] = [];
  const outPos: number[] = [];
  const foot = Math.min(...sections.map((q) => q.y)) - 14;
  for (let k = 0; k < p.count; k++) {
    const { n, c } = base(k);
    inside.push(c.r * 0.55, c.g * 0.55, c.b * 0.6);
    const topness = smoothstep(0.3, 0.8, Math.abs(nor.getY(k))) * smoothstep(0, 20, p.getY(k) - foot);
    c.lerp(GRASS.clone().multiplyScalar(0.8 + 0.4 * n), topness * (0.45 + 0.55 * smoothstep(0.3, 0.6, n)));
    outside.push(c.r, c.g, c.b);
    outPos.push(p.getX(k) + nor.getX(k) * outward * 0.7, p.getY(k) + nor.getY(k) * outward * 0.7, p.getZ(k) + nor.getZ(k) * outward * 0.7);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(inside, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: outward > 0 ? THREE.BackSide : THREE.FrontSide });
  const shell = new THREE.Mesh(g, mat);
  shell.castShadow = true;
  shell.frustumCulled = false;
  const g2 = g.clone();
  g2.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
  g2.setAttribute('color', new THREE.Float32BufferAttribute(outside, 3));
  g2.computeVertexNormals();
  const skin = new THREE.Mesh(g2, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: outward > 0 ? THREE.FrontSide : THREE.BackSide }));
  skin.castShadow = true;
  skin.receiveShadow = true;
  skin.frustumCulled = false;
  shell.add(skin);
  // Surface points (for the glowing mushrooms): random spots on the inside of the vault.
  for (let k = 0; k < 600; k++) {
    const i = 1 + Math.floor(rnd() * (N - 3));
    const j = 1 + Math.floor(rnd() * (M - 3));
    const a = i * M + j;
    const nx = nor.getX(a);
    const ny = nor.getY(a);
    const nz = nor.getZ(a);
    // Normals point out of the cave on one side; flip so they point into the cave (toward the axis).
    const sec = sections[i];
    const toCentre = (sec.x - p.getX(a)) * nx + (sec.y + 10 - p.getY(a)) * ny + (sec.z - p.getZ(a)) * nz;
    const f = toCentre < 0 ? -1 : 1;
    surface.push({ x: p.getX(a), y: p.getY(a), z: p.getZ(a), nx: nx * f, ny: ny * f, nz: nz * f });
  }
  return { shell, points: surface };
}

/** A small glowing mushroom (stalk + dome), radius ~1, standing on y = 0: vertex colours are white (instance colour tints it). */
function glowMushroomGeo(): THREE.BufferGeometry {
  const profile: [number, number][] = [
    [0.1, 0],
    [0.12, 0.35],
    [0.1, 0.6],
    [0.55, 0.62],
    [0.85, 0.78],
    [0.95, 0.98],
    [0.7, 1.22],
    [0.35, 1.38],
    [0, 1.42],
  ];
  return paint(latheGeo(profile, 8), (p) => _c.setScalar(0.4 + 0.6 * smoothstep(0.55, 1.1, p.y)));
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/** What `updateKarts` needs of a kart. */
export interface WobbleKart {
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  grounded: boolean;
}

/** Squash-and-stretch of one orange cap after a bounce, as the vertical scale at time `t` seconds after the bounce. */
export function wobbleScale(t: number): number {
  if (t < 0) return 1;
  // Starts squashed (the trampoline is pushed down), springs past 1, then rings down.
  return 1 - 0.34 * Math.exp(-3.4 * t) * Math.cos(2 * Math.PI * 2.7 * t);
}

/** Everything Mushroom Valley adds to a TrackView: caps, mist, the cave and its glowing mushrooms. */
export class MushroomView {
  readonly group = new THREE.Group();
  private readonly orange: Cap[];
  private readonly instanced: THREE.InstancedMesh | null = null;
  /** Time (s, view clock) of each orange cap's last bounce; -1000 = never. */
  private readonly hitAt: number[];
  private clock = 0;
  private readonly m = new THREE.Matrix4();
  private readonly glow: THREE.InstancedMesh | null = null;

  constructor(track: Track) {
    const caps = new Bouncers(track).caps;
    const def = track.def.scenery.mushroom!;
    // ---- caps and stalks -------------------------------------------------------------------------------
    const statics: THREE.BufferGeometry[] = [];
    const orangeGeo = capGeo('orange', 11);
    const greenGeos = [capGeo('green', 21), capGeo('green', 22), capGeo('green', 23)];
    caps.forEach((c, i) => {
      // The mist level under this cap: a fixed depth below it.
      statics.push(stalkGeo(c, c.y - 14));
      if (c.kind === 'green') statics.push(placed(greenGeos[i % 3], matrix(c.x, c.y, c.z, c.radius, c.radius, c.radius, (i * 1.7) % 6.28)));
    });
    if (statics.length) {
      const mesh = new THREE.Mesh(merge(statics), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.orange = caps.filter((c) => c.kind === 'orange');
    this.hitAt = this.orange.map(() => -1000);
    if (this.orange.length) {
      const inst = new THREE.InstancedMesh(orangeGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, emissive: new THREE.Color('#ff5a00'), emissiveIntensity: 0.12 }), this.orange.length);
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      this.instanced = inst;
      this.orange.forEach((_, i) => this.setCapMatrix(i, 1));
      this.group.add(inst);
    }

    // ---- mist ------------------------------------------------------------------------------------------
    const areas: { x: number; z: number; w: number; d: number; rot: number; y: number }[] = [];
    for (const g of def.gorges) {
      const s0 = track.sAt(g.from);
      const s1 = track.sAt(g.to);
      const mid = track.pointAt((s0 + track.deltaS(s0, s1) / 2 + track.length) % track.length);
      const len = track.deltaS(s0, s1);
      areas.push({ x: mid.x, z: mid.z, w: 150, d: len + 90, rot: mid.heading, y: mid.y - 16 });
    }
    {
      // The cave pit: one big layer stack over the bounding box of the cave's section.
      const { sections } = caveSections(track);
      const mid = sections[Math.floor(sections.length / 2)];
      areas.push({ x: mid.x - 12, z: mid.z, w: 190, d: sections.length * 9 + 60, rot: 0, y: mid.y - 16 });
    }
    this.group.add(buildMist(track, areas));

    // ---- cave --------------------------------------------------------------------------------------------
    const cave = buildCave(track);
    this.group.add(cave.shell);
    const count = def.glow ?? 90;
    const rnd = seededRandom(909);
    const glow = new THREE.InstancedMesh(glowMushroomGeo(), new THREE.MeshBasicMaterial({ vertexColors: true }), count);
    const palette = [new THREE.Color(0.25, 1.5, 1.2), new THREE.Color(0.6, 0.5, 2.0), new THREE.Color(1.6, 0.4, 1.2), new THREE.Color(0.5, 1.8, 0.6)];
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const sp = cave.points[Math.floor(rnd() * cave.points.length)];
      const s = 0.5 + rnd() * rnd() * 2.0;
      const dir = new THREE.Vector3(sp.nx, sp.ny, sp.nz).normalize();
      q.setFromUnitVectors(up, dir);
      this.m.compose(new THREE.Vector3(sp.x + sp.nx * 0.2, sp.y + sp.ny * 0.2, sp.z + sp.nz * 0.2), q, new THREE.Vector3(s, s, s));
      glow.setMatrixAt(i, this.m);
      glow.setColorAt(i, palette[Math.floor(rnd() * palette.length)]);
    }
    glow.frustumCulled = false;
    this.glow = glow;
    this.group.add(glow);
  }

  private setCapMatrix(i: number, sy: number): void {
    const c = this.orange[i];
    const sxz = c.radius / Math.sqrt(sy);
    this.m.compose(new THREE.Vector3(c.x, c.y, c.z), new THREE.Quaternion(), new THREE.Vector3(sxz, c.radius * sy, sxz));
    this.instanced!.setMatrixAt(i, this.m);
  }

  /** Advance the wobbles and the glow. `time` is the shared environment clock (s). */
  update(time: number): void {
    ENV_TIME.value = time;
    this.clock = time;
    if (this.instanced) {
      let dirty = false;
      for (let i = 0; i < this.orange.length; i++) {
        const t = time - this.hitAt[i];
        if (t < 2.2) {
          this.setCapMatrix(i, wobbleScale(t));
          dirty = true;
        } else if (t < 2.3) {
          this.setCapMatrix(i, 1);
          dirty = true;
        }
      }
      if (dirty) this.instanced.instanceMatrix.needsUpdate = true;
    }
    if (this.glow) (this.glow.material as THREE.MeshBasicMaterial).color.setScalar(0.85 + 0.15 * Math.sin(time * 1.3));
  }

  /** Start a wobble on any orange cap a kart has just been thrown off (it is on the cap and moving up fast). */
  updateKarts(karts: Iterable<WobbleKart>): void {
    if (!this.instanced) return;
    for (const k of karts) {
      if (k.vel.y < 6) continue;
      for (let i = 0; i < this.orange.length; i++) {
        const c = this.orange[i];
        const dx = k.pos.x - c.x;
        const dz = k.pos.z - c.z;
        if (dx * dx + dz * dz > c.radius * c.radius || k.pos.y - c.y > 2.5 || k.pos.y - c.y < -0.7) continue;
        if (this.clock - this.hitAt[i] > 0.5) this.hitAt[i] = this.clock;
      }
    }
  }
}
