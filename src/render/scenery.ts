/**
 * Everything around the track that you can't drive into: trees, bushes,
 * rocks, flowers and grass tufts, fences and hay bales, houses, grandstands
 * full of spectators, "TILT KART" banners and flags, rolling hills, a ring of
 * distant mountains, clouds, and the start/finish gantry.
 *
 * All of it is procedural (no model or image files) and placed with a seeded
 * random generator, so a track looks the same on every load.
 *
 * Performance: the hundreds of objects are baked into a handful of merged,
 * vertex-colored meshes (see MeshBatch), so the whole landscape costs about
 * six draw calls per viewport, fewer than the old version.
 *
 *   batch      material                      draws  shadows  quality
 *   solid      Lambert, flat-shaded           1      cast     always
 *   detail     Lambert (tufts/flowers)        1      -        Medium 70%, Low 35%
 *   far        Lambert, no fog (mountains)    1      -        always
 *   banners    Lambert + banner texture       1      -        always
 *   clouds     Lambert, no fog                1      -        hidden on Low
 *
 * The look adapts to the track's theme colors: a "biome" (meadow, autumn,
 * desert, snow) is guessed from the grass color and picks tree types,
 * foliage, rock and mountain colors.
 */
import * as THREE from 'three';
import type { Track, TrackSample } from '../sim/track';
import type { TrackDef } from '../track/types';
import { MeshBatch } from './meshBatch';
import { BANNER_LOGO, BANNER_SLOGAN, bannerTexture, checkerTexture, seededRandom } from './textures';

// ---------------------------------------------------------------------------
// Biomes: theme colors → what grows here
// ---------------------------------------------------------------------------

export type Biome = 'meadow' | 'autumn' | 'desert' | 'snow';

const SRGB = THREE.SRGBColorSpace;

/** Guess the biome from the theme's grass color (hue/saturation/lightness). */
export function biomeFor(theme: TrackDef['theme']): Biome {
  const { h, s, l } = new THREE.Color(theme.grass).getHSL({ h: 0, s: 0, l: 0 }, SRGB);
  if (l > 0.72 && s < 0.4) return 'snow'; // pale, washed-out ground
  if (h >= 0.17 && h <= 0.5) return 'meadow'; // yellow-green … teal
  if (h < 0.17 || h > 0.92) return l > 0.5 ? 'desert' : 'autumn'; // sand vs. brown/orange
  return 'meadow';
}

/** Color from hue/saturation/lightness in 0..1, as you'd pick them in a paint program. */
function hsl(h: number, s: number, l: number): THREE.Color {
  return new THREE.Color().setHSL(((h % 1) + 1) % 1, THREE.MathUtils.clamp(s, 0, 1), THREE.MathUtils.clamp(l, 0, 1), SRGB);
}

/** Per-biome look. Functions take a random() so each object gets its own variation. */
interface BiomeLook {
  /** Relative weights of tree kinds. */
  trees: Partial<Record<'pine' | 'round' | 'poplar' | 'cactus', number>>;
  /** Multiplier on the track's tree count. */
  treeDensity: number;
  foliage: (r: () => number) => THREE.Color;
  trunk: THREE.Color;
  snowyPines: boolean;
  bush: (r: () => number) => THREE.Color;
  rock: (r: () => number) => THREE.Color;
  rockDensity: number;
  tuft: (r: () => number) => THREE.Color;
  flowers: string[];
  fence: THREE.Color;
  hayBales: boolean;
  walls: string[];
  roof: (r: () => number) => THREE.Color;
  flatRoofs: boolean;
  mountain: (r: () => number) => THREE.Color;
  mesas: boolean;
  snowCaps: boolean;
  hill: (r: () => number) => THREE.Color;
  cloudCount: number;
}

function biomeLook(biome: Biome, theme: TrackDef['theme']): BiomeLook {
  const g = new THREE.Color(theme.grass).getHSL({ h: 0, s: 0, l: 0 }, SRGB);
  const greenRock = (r: () => number) => hsl(0.1, 0.05 + r() * 0.05, 0.45 + r() * 0.15);
  const pastelWalls = ['#f2e3c6', '#e9c9a4', '#d7e4ef', '#f6d6d6', '#e4efd2'];
  switch (biome) {
    case 'autumn':
      return {
        trees: { round: 0.55, pine: 0.25, poplar: 0.2 },
        treeDensity: 1,
        foliage: (r) => {
          const hues = [0.01, 0.05, 0.08, 0.12, 0.3];
          const h = hues[Math.floor(r() * hues.length)];
          return h > 0.2 ? hsl(h, 0.4, 0.28) : hsl(h + r() * 0.02, 0.7, 0.38 + r() * 0.12);
        },
        trunk: hsl(0.07, 0.35, 0.25),
        snowyPines: false,
        bush: (r) => hsl(0.04 + r() * 0.08, 0.6, 0.32 + r() * 0.1),
        rock: greenRock,
        rockDensity: 0.35,
        tuft: (r) => hsl(0.1 + r() * 0.04, 0.5, 0.45 + r() * 0.1),
        flowers: ['#ffb02e', '#ffe14d', '#e2572b'],
        fence: hsl(0.07, 0.35, 0.32),
        hayBales: true,
        walls: pastelWalls,
        roof: (r) => hsl(0.02 + r() * 0.05, 0.5, 0.33),
        flatRoofs: false,
        mountain: (r) => hsl(0.85 + r() * 0.08, 0.12, 0.42 + r() * 0.08),
        mesas: false,
        snowCaps: true,
        hill: (r) => hsl(g.h + (r() - 0.5) * 0.05, g.s * 0.8, g.l * (0.75 + r() * 0.2)),
        cloudCount: 22,
      };
    case 'desert':
      return {
        trees: { cactus: 0.75, round: 0.25 },
        treeDensity: 0.4,
        foliage: (r) => hsl(0.2 + r() * 0.06, 0.3, 0.3 + r() * 0.08), // dusty olive
        trunk: hsl(0.08, 0.3, 0.3),
        snowyPines: false,
        bush: (r) => hsl(0.17 + r() * 0.08, 0.22, 0.42 + r() * 0.1), // sage scrub
        rock: (r) => hsl(0.04 + r() * 0.04, 0.45, 0.42 + r() * 0.15), // sandstone
        rockDensity: 0.9,
        tuft: (r) => hsl(0.12, 0.4, 0.6 + r() * 0.12),
        flowers: ['#ff6fa8', '#ffd84a'],
        fence: hsl(0.07, 0.35, 0.36),
        hayBales: false,
        walls: ['#e6c49a', '#d9ab7a', '#efd8b8', '#c98d62'],
        roof: (r) => hsl(0.07, 0.35, 0.55 + r() * 0.1),
        flatRoofs: true,
        mountain: (r) => hsl(0.03 + r() * 0.04, 0.5, 0.42 + r() * 0.1),
        mesas: true,
        snowCaps: false,
        hill: (r) => hsl(g.h + (r() - 0.5) * 0.02, g.s, g.l * (0.85 + r() * 0.15)),
        cloudCount: 10,
      };
    case 'snow':
      return {
        trees: { pine: 1 },
        treeDensity: 1,
        foliage: (r) => hsl(0.38 + r() * 0.04, 0.35, 0.18 + r() * 0.06),
        trunk: hsl(0.07, 0.3, 0.25),
        snowyPines: true,
        bush: (r) => hsl(0.4, 0.15, 0.55 + r() * 0.2),
        rock: (r) => hsl(0.6, 0.05, 0.4 + r() * 0.15),
        rockDensity: 0.4,
        tuft: (r) => hsl(0.3, 0.15, 0.6 + r() * 0.15),
        flowers: [],
        fence: hsl(0.07, 0.35, 0.3),
        hayBales: false,
        walls: ['#c94b3b', '#3b6fc9', '#e0b03b', '#f0eadf'],
        roof: () => hsl(0.6, 0.1, 0.95),
        flatRoofs: false,
        mountain: (r) => hsl(0.6, 0.1, 0.55 + r() * 0.1),
        mesas: false,
        snowCaps: true,
        hill: (r) => hsl(0.6, 0.08, 0.85 + r() * 0.08),
        cloudCount: 30,
      };
    default:
      return {
        trees: { round: 0.45, pine: 0.35, poplar: 0.2 },
        treeDensity: 1,
        foliage: (r) => hsl(g.h - 0.02 + r() * 0.07, 0.5 + r() * 0.1, 0.22 + r() * 0.12),
        trunk: hsl(0.08, 0.4, 0.28),
        snowyPines: false,
        bush: (r) => hsl(g.h + r() * 0.05, 0.5, 0.25 + r() * 0.1),
        rock: greenRock,
        rockDensity: 0.3,
        tuft: (r) => hsl(g.h - 0.03 + r() * 0.05, g.s * 0.9, g.l * (0.7 + r() * 0.25)),
        flowers: ['#ffffff', '#ffe14d', '#ff7eb6', '#b48cff', '#ff5a4d'],
        fence: hsl(0, 0, 0.92),
        hayBales: true,
        walls: pastelWalls,
        roof: (r) => hsl(0.02 + r() * 0.05, 0.55, 0.38),
        flatRoofs: false,
        mountain: (r) => hsl(0.45 + r() * 0.1, 0.18, 0.4 + r() * 0.08),
        mesas: false,
        snowCaps: true,
        hill: (r) => hsl(0.28 + r() * 0.05, 0.4, 0.3 + r() * 0.08),
        cloudCount: 26,
      };
  }
}

// ---------------------------------------------------------------------------
// Shared building blocks (unit-sized, standing on y = 0 unless noted)
// ---------------------------------------------------------------------------

function makeShapes() {
  const flag = new THREE.BufferGeometry();
  // A triangle pennant in the x/y plane, both windings so it's visible from both sides.
  flag.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, -0.3, 0, 0, -0.6, 0, 0, 0, 0, 0, -0.6, 0, 1, -0.3, 0], 3));
  flag.computeVertexNormals();
  return {
    box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    trunk: new THREE.CylinderGeometry(0.22, 0.32, 2.2, 5).translate(0, 1.1, 0),
    cone: new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0),
    roof: new THREE.ConeGeometry(0.75, 0.6, 4).rotateY(Math.PI / 4).translate(0, 0.3, 0),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 7).translate(0, 0.5, 0),
    mesa: new THREE.CylinderGeometry(0.72, 1, 1, 7).translate(0, 0.5, 0),
    bale: new THREE.CylinderGeometry(1, 1, 1, 10).rotateZ(Math.PI / 2), // axis along x, centered
    blob: new THREE.IcosahedronGeometry(1, 0), // centered
    puff: new THREE.IcosahedronGeometry(1, 1), // rounder, for clouds
    rock: new THREE.DodecahedronGeometry(1, 0), // centered
    flower: new THREE.OctahedronGeometry(1, 0), // centered
    blade: new THREE.ConeGeometry(1, 1, 3).translate(0, 0.5, 0),
    hill: new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    plane: new THREE.PlaneGeometry(1, 1), // centered, facing +z
    flag,
  };
}
type Shapes = ReturnType<typeof makeShapes>;

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();

/**
 * Matrix for a shape at (x, y, z), rotated (rx, ry, rz) radians and scaled
 * (sx, sy, sz). Rotation order: tilt (x, z) first, then turn (y), so a tilted
 * grass blade can lean in any compass direction. With `parent`, the
 * coordinates are in the parent's frame.
 */
function mat(parent: THREE.Matrix4 | null, x: number, y: number, z: number, sx = 1, sy = sx, sz = sx, ry = 0, rx = 0, rz = 0): THREE.Matrix4 {
  const m = new THREE.Matrix4().compose(_pos.set(x, y, z), _quat.setFromEuler(_euler.set(rx, ry, rz, 'YXZ')), _scale.set(sx, sy, sz));
  return parent ? m.premultiply(parent) : m;
}

/** A local frame at (x, z) on the ground, turned by `ry` (local +z = (sin ry, cos ry)). */
function frame(x: number, z: number, ry: number): THREE.Matrix4 {
  return mat(null, x, 0, z, 1, 1, 1, ry);
}

const WHITE = new THREE.Color('#ffffff');

let bannerMat: THREE.MeshLambertMaterial | null = null;
/** One shared banner material (texture is drawn once). */
function bannerMaterial(): THREE.MeshLambertMaterial {
  bannerMat ??= new THREE.MeshLambertMaterial({ map: bannerTexture() });
  return bannerMat;
}

// ---------------------------------------------------------------------------
// Placement helpers: where is there room?
// ---------------------------------------------------------------------------

class Site {
  readonly S: TrackSample[];
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly cx: number;
  readonly cz: number;
  /** Half the larger side of the scenery area. */
  readonly radius: number;
  /** Distance from the centerline to the outer edge of the off-road strip (where walls stand). */
  readonly outer: number;
  private reserved: { x: number; z: number; r: number }[] = [];

  constructor(readonly track: Track) {
    this.S = track.samples;
    const xs = this.S.map((p) => p.x);
    const zs = this.S.map((p) => p.z);
    this.minX = Math.min(...xs) - 120;
    this.maxX = Math.max(...xs) + 120;
    this.minZ = Math.min(...zs) - 120;
    this.maxZ = Math.max(...zs) + 120;
    this.cx = (this.minX + this.maxX) / 2;
    this.cz = (this.minZ + this.maxZ) / 2;
    this.radius = Math.max(this.maxX - this.minX, this.maxZ - this.minZ) / 2;
    this.outer = track.def.width / 2 + track.def.offroadWidth;
  }

  /** Distance from (x, z) to the nearest centerline sample (every 2nd sample is plenty). */
  distToTrack(x: number, z: number): number {
    let best = Infinity;
    for (let i = 0; i < this.S.length; i += 2) best = Math.min(best, (this.S[i].x - x) ** 2 + (this.S[i].z - z) ** 2);
    return Math.sqrt(best);
  }

  /** Mark a circle as taken (grandstands, houses) so trees don't grow through it. */
  reserve(x: number, z: number, r: number): void {
    this.reserved.push({ x, z, r });
  }

  isFree(x: number, z: number, r = 0): boolean {
    return this.reserved.every((c) => (c.x - x) ** 2 + (c.z - z) ** 2 > (c.r + r) ** 2);
  }

  /** Random point in the scenery rectangle. */
  randomPoint(rnd: () => number): [number, number] {
    return [this.minX + rnd() * (this.maxX - this.minX), this.minZ + rnd() * (this.maxZ - this.minZ)];
  }

  /** Point `d` metres to the side of sample p (d > 0 = along the sample's right vector). */
  beside(p: TrackSample, d: number): [number, number] {
    return [p.x + p.rx * d, p.z + p.rz * d];
  }

  /** Sample `ds` metres from sample index i (wraps around the loop). */
  sampleAt(i: number, ds: number): TrackSample {
    const n = this.S.length;
    return this.S[(((i + Math.round(ds / this.track.spacing)) % n) + n) % n];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Build all scenery for a track. Add the returned group to the scene once. */
export function buildScenery(track: Track): THREE.Group {
  const def = track.def;
  const rnd = seededRandom(def.scenery.seed);
  const look = biomeLook(biomeFor(def.theme), def.theme);
  const site = new Site(track);
  const shapes = makeShapes();

  const solid = new MeshBatch();
  const far = new MeshBatch();
  const banners = new MeshBatch(true);
  const detail: DetailItem[] = [];

  // Big man-made things first, so nature can grow around them.
  addGrandstands(site, shapes, solid, banners, rnd);
  addHouses(site, shapes, solid, look, rnd, def.scenery.buildings);
  addTrackside(site, shapes, solid, banners, look, rnd);
  addTrees(site, shapes, solid, look, rnd, Math.round(def.scenery.trees * look.treeDensity));
  addBushesAndRocks(site, shapes, solid, look, rnd, def.scenery.trees);
  addGroundDetail(site, shapes, detail, look, rnd, def.scenery.trees);
  addHills(site, shapes, solid, look, rnd);
  addMountains(site, shapes, far, look, rnd, new THREE.Color(def.theme.horizon));

  const group = new THREE.Group();
  group.name = 'scenery';

  const solidMesh = solid.build(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  solidMesh.castShadow = true;
  solidMesh.receiveShadow = true;
  group.add(solidMesh);

  // Ground detail: shuffled so that drawing only the first N% thins it evenly.
  if (detail.length) {
    shuffle(detail, rnd);
    const batch = new MeshBatch();
    for (const d of detail) batch.add(d.geo, d.matrix, d.color);
    const mesh = batch.build(new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.receiveShadow = true;
    mesh.userData.detailIndexCount = mesh.geometry.getIndex()!.count;
    group.add(mesh);
  }

  // Distant mountains: no fog (they'd vanish), their color is pre-mixed with the horizon instead.
  const farMesh = far.build(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false }));
  fadeBaseToHorizon(farMesh.geometry, new THREE.Color(def.theme.horizon), 90);
  group.add(farMesh);

  if (!banners.isEmpty) {
    const mesh = banners.build(bannerMaterial());
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  group.add(buildClouds(site, shapes, look, rnd, new THREE.Color(def.theme.horizon)));

  for (const g of Object.values(shapes)) g.dispose();
  return group;
}

/**
 * Start/finish gantry across the road at sample `s`: two posts, a checkered
 * beam with "TILT KART" logos on both faces, and a flag on each post.
 */
export function buildGantry(s: TrackSample, halfSpan: number): THREE.Group {
  const shapes = makeShapes();
  const g = new THREE.Group();
  const f = frame(s.x, s.z, s.heading); // local x = across the road, z = along it

  const posts = new MeshBatch();
  const postColor = new THREE.Color('#dfe3ea');
  for (const side of [-1, 1]) {
    const x = side * halfSpan;
    posts.add(shapes.box, mat(f, x, 0, 0, 0.5, 6.8, 0.5), postColor);
    posts.add(shapes.box, mat(f, x, 0, 0, 1.2, 0.3, 1.2), new THREE.Color('#9aa3b0')); // foot
    posts.add(shapes.cyl, mat(f, x, 6.8, 0, 0.05, 2.2, 0.05), postColor); // flag pole
    posts.add(shapes.flag, mat(f, x, 9, 0, 1.6, 1.6, 1.6, side < 0 ? Math.PI : 0), new THREE.Color(side < 0 ? '#ffd23a' : '#2f7be0'));
  }
  const postMesh = posts.build(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  postMesh.castShadow = true;
  g.add(postMesh);

  const beamTex = checkerTexture();
  beamTex.repeat.set(halfSpan, 1);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(halfSpan * 2 + 0.5, 1.4, 0.4), new THREE.MeshLambertMaterial({ map: beamTex }));
  beam.applyMatrix4(mat(f, 0, 6.2, 0));
  beam.castShadow = true;
  g.add(beam);

  // Logo panels on both faces of the beam (karts approach from -z).
  const logos = new MeshBatch(true);
  // Panel shape matches the texture row (4:1) and fits inside the 1.4 m beam.
  logos.add(shapes.plane, mat(f, 0, 6.2, -0.21, 5.2, 1.3, 1, Math.PI), WHITE, BANNER_LOGO);
  logos.add(shapes.plane, mat(f, 0, 6.2, 0.21, 5.2, 1.3, 1, 0), WHITE, BANNER_LOGO);
  g.add(logos.build(bannerMaterial()));

  for (const geo of Object.values(shapes)) geo.dispose();
  return g;
}

// ---------------------------------------------------------------------------
// Grandstands near the start/finish line
// ---------------------------------------------------------------------------

function addGrandstands(site: Site, shapes: Shapes, solid: MeshBatch, banners: MeshBatch, rnd: () => number): void {
  const LENGTH = 36;
  const ROWS = 5;
  const ROW_DEPTH = 1.4;
  const DEPTH = ROWS * ROW_DEPTH + 1;
  // Centered a little before the line, where the starting grid is.
  const center = site.sampleAt(0, -14);
  // Is the road straight here? (Every sample within half a stand length stays near the line.)
  for (let ds = -LENGTH / 2; ds <= LENGTH / 2; ds += 3) {
    const p = site.sampleAt(0, -14 + ds);
    const lateral = (p.x - center.x) * center.rx + (p.z - center.z) * center.rz;
    if (Math.abs(lateral) > 1.5) return; // too curvy for a straight grandstand
  }

  const concrete = new THREE.Color('#b9bcc4');
  const roofColors = ['#d23b3b', '#2f6fd6'];
  let made = 0;
  for (const side of [-1, 1]) {
    const front = site.outer + 4;
    // Check the whole footprint is clear of other parts of the track.
    let clear = true;
    for (let a = -LENGTH / 2; a <= LENGTH / 2 && clear; a += 4)
      for (let o = 0; o <= DEPTH + 2; o += 2) {
        const p = site.sampleAt(0, -14 + a);
        const [x, z] = site.beside(p, side * (front + o));
        if (site.distToTrack(x, z) < site.outer + 2) clear = false;
      }
    if (!clear) continue;

    // Local frame: origin at the front-center on the ground, +x pointing away
    // from the road, +z along the road.
    const [ox, oz] = site.beside(center, side * front);
    const out = new THREE.Vector3(center.rx * side, 0, center.rz * side);
    const along = new THREE.Vector3().crossVectors(out, new THREE.Vector3(0, 1, 0)); // right-handed basis
    const f = new THREE.Matrix4().makeBasis(out, new THREE.Vector3(0, 1, 0), along).setPosition(ox, 0, oz);
    site.reserve(ox + out.x * DEPTH / 2, oz + out.z * DEPTH / 2, LENGTH / 2 + 6);

    // Front wall with banners facing the road.
    solid.add(shapes.box, mat(f, -0.1, 0, 0, 0.3, 1.7, LENGTH), new THREE.Color('#2b2f3a'));
    for (let z = -LENGTH / 2 + 3.5; z <= LENGTH / 2 - 3; z += 6.5) {
      const rect = Math.round(z / 6.5) % 2 === 0 ? BANNER_LOGO : BANNER_SLOGAN;
      banners.add(shapes.plane, mat(f, -0.27, 0.85, z, 6, 1.5, 1, -Math.PI / 2), WHITE, rect);
    }
    // Stepped seating rows, each with a line of spectators.
    for (let r = 0; r < ROWS; r++) {
      const top = 1.0 + (r + 1) * 0.7;
      solid.add(shapes.box, mat(f, r * ROW_DEPTH + ROW_DEPTH / 2, 0, 0, ROW_DEPTH, top, LENGTH), concrete.clone().multiplyScalar(r % 2 ? 0.92 : 1));
      for (let z = -LENGTH / 2 + 0.6; z < LENGTH / 2 - 0.4; z += 0.75) {
        if (rnd() < 0.18) continue; // a few empty seats
        const x = r * ROW_DEPTH + 0.75 + (rnd() - 0.5) * 0.1;
        const shirt = hsl(rnd(), 0.65 + rnd() * 0.3, 0.45 + rnd() * 0.2);
        const skin = hsl(0.06 + rnd() * 0.03, 0.45, 0.3 + rnd() * 0.45);
        const tall = 0.9 + rnd() * 0.25;
        solid.add(shapes.box, mat(f, x, top, z, 0.36, 0.62 * tall, 0.46), shirt);
        solid.add(shapes.box, mat(f, x, top + 0.62 * tall, z, 0.28, 0.28, 0.28), skin);
        if (rnd() < 0.12) solid.add(shapes.box, mat(f, x - 0.05, top + 0.62 * tall + 0.18, z + 0.2, 0.06, 0.55, 0.06, 0, 0, -0.5), skin); // waving arm
      }
    }
    // Back wall, roof posts and a colored roof.
    const backX = ROWS * ROW_DEPTH;
    const roofY = 1.0 + ROWS * 0.7 + 3.2;
    solid.add(shapes.box, mat(f, backX + 0.15, 0, 0, 0.3, roofY, LENGTH), concrete.clone().multiplyScalar(0.8));
    for (let z = -LENGTH / 2; z <= LENGTH / 2; z += 9) solid.add(shapes.box, mat(f, 0.4, 0, z, 0.25, roofY, 0.25), new THREE.Color('#dfe3ea'));
    const roofColor = new THREE.Color(roofColors[made % roofColors.length]);
    solid.add(shapes.box, mat(f, backX / 2 + 0.1, roofY, 0, backX + 1.6, 0.3, LENGTH + 1, 0, 0, 0.08 * -1), roofColor);
    // Flags along the roof edge.
    const flagColors = ['#ffd23a', '#2f7be0', '#e03a3a', '#ffffff', '#33b54a'];
    for (let z = -LENGTH / 2; z <= LENGTH / 2; z += 6) {
      solid.add(shapes.cyl, mat(f, 0.1, roofY, z, 0.05, 2.6, 0.05), WHITE);
      solid.add(shapes.flag, mat(f, 0.1, roofY + 2.6, z, 1.3, 1.3, 1.3, rnd() * 0.6 + Math.PI / 2), new THREE.Color(flagColors[Math.floor(rnd() * flagColors.length)]));
    }
    made++;
  }
}

// ---------------------------------------------------------------------------
// Houses
// ---------------------------------------------------------------------------

function addHouses(site: Site, shapes: Shapes, solid: MeshBatch, look: BiomeLook, rnd: () => number, count: number): void {
  const clearance = site.outer + 17;
  let made = 0;
  for (let tries = 0; tries < count * 30 && made < count; tries++) {
    const [x, z] = site.randomPoint(rnd);
    const d = site.distToTrack(x, z);
    if (d < clearance || d > 140) continue;
    const w = 6 + rnd() * 6;
    const h = 4 + rnd() * 5;
    const depth = 6 + rnd() * 5;
    if (!site.isFree(x, z, Math.max(w, depth) * 0.75)) continue;
    site.reserve(x, z, Math.max(w, depth) * 0.75);
    const f = frame(x, z, rnd() * Math.PI * 2);
    solid.add(shapes.box, mat(f, 0, 0, 0, w, h, depth), new THREE.Color(look.walls[Math.floor(rnd() * look.walls.length)]));
    const dark = new THREE.Color('#3a3f4a');
    const glass = new THREE.Color('#9cc3e0');
    solid.add(shapes.box, mat(f, 0, 0, depth / 2, 1.1, 2.1, 0.12), dark); // door
    for (const wx of [-w / 4 - 0.3, w / 4 + 0.3]) solid.add(shapes.box, mat(f, wx, h * 0.55, depth / 2, 1.1, 1.0, 0.12), glass);
    if (look.flatRoofs) {
      solid.add(shapes.box, mat(f, 0, h, 0, w + 0.3, 0.35, depth + 0.3), look.roof(rnd));
    } else {
      solid.add(shapes.roof, mat(f, 0, h, 0, w * 1.05, Math.max(w, depth) * 0.6, depth * 1.05), look.roof(rnd));
      solid.add(shapes.box, mat(f, w * 0.25, h, -depth * 0.15, 0.7, Math.max(w, depth) * 0.45, 0.7), dark); // chimney
    }
    made++;
  }
}

// ---------------------------------------------------------------------------
// Along the track: fences, hay bales, banner boards, flag lines
// ---------------------------------------------------------------------------

function addTrackside(site: Site, shapes: Shapes, solid: MeshBatch, banners: MeshBatch, look: BiomeLook, rnd: () => number): void {
  const S = site.S;
  const n = S.length;
  const step = Math.max(1, Math.round(3 / site.track.spacing)); // ~3 m per fence panel
  const RUN = Math.round(60 / site.track.spacing); // decide what to build every ~60 m
  const START_ZONE = 50; // metres around the start line kept for grandstands/gantry
  const bale = new THREE.Color('#d9b45a');
  const baleEnd = new THREE.Color('#c79a3e');
  const post = new THREE.Color('#e6e6e6');
  const flagColors = ['#ffd23a', '#2f7be0', '#e03a3a', '#33b54a'];

  for (let i0 = 0; i0 < n; i0 += RUN) {
    if (S[i0].s < START_ZONE || S[i0].s > site.track.length - START_ZONE) continue;
    const kind = rnd();
    for (const side of [-1, 1]) {
      if (rnd() < 0.45) continue; // leave plenty of open views
      const wall = (p: TrackSample) => (side < 0 ? p.wallLeft : p.wallRight);
      const d = side * (site.outer + 3);
      // Is the spot free of walls, tight corners and other parts of the track?
      const ok = (p: TrackSample) => {
        if (wall(p)) return false;
        const [x, z] = site.beside(p, d);
        return site.distToTrack(x, z) > site.outer + 2.5 && site.isFree(x, z, 2);
      };
      if (kind < 0.55) {
        // Fence: post-and-rail panels following the road.
        const end = i0 + Math.round(RUN * (0.4 + rnd() * 0.5));
        for (let i = i0; i < end; i += step) {
          const a = S[i % n];
          const b = S[(i + step) % n];
          if (!ok(a) || !ok(b)) continue;
          const [ax, az] = site.beside(a, d);
          const [bx, bz] = site.beside(b, d);
          const len = Math.hypot(bx - ax, bz - az);
          const ry = Math.atan2(bx - ax, bz - az);
          solid.add(shapes.box, mat(null, ax, 0, az, 0.16, 1.2, 0.16, ry), look.fence);
          for (const y of [0.45, 0.9]) solid.add(shapes.box, mat(frame(ax, az, ry), 0, y, len / 2, 0.08, 0.12, len), look.fence);
        }
      } else if (kind < 0.75 && look.hayBales) {
        // A few hay bale stacks.
        for (let k = 0; k < 3; k++) {
          const p = S[(i0 + Math.round(rnd() * RUN)) % n];
          if (!ok(p)) continue;
          const [x, z] = site.beside(p, d + side * rnd() * 2);
          const f = frame(x, z, p.heading + (rnd() - 0.5) * 0.4);
          for (const [ox, oy] of [[-0.8, 0], [0.8, 0], [0, 1.2]]) {
            const m = mat(f, ox, 0.6 + oy, 0, 1.2, 0.6, 0.6);
            solid.add(shapes.bale, m, bale);
            solid.add(shapes.bale, mat(f, ox, 0.6 + oy, 0, 1.22, 0.45, 0.45), baleEnd);
          }
        }
      } else {
        // Banner boards on posts, facing the road, with a flag on each end.
        const p = S[(i0 + Math.round(RUN / 2)) % n];
        const q = S[(i0 + Math.round(RUN / 2) + 2) % n];
        if (!ok(p) || !ok(q)) continue;
        const [x, z] = site.beside(p, d);
        const faceRoad = Math.atan2(-p.rx * side, -p.rz * side);
        const f = frame(x, z, faceRoad); // local +z points at the road, x along it
        for (const bx of [-3.2, 3.2]) {
          solid.add(shapes.box, mat(f, bx, 0, -0.1, 0.18, 2.9, 0.18), post);
          solid.add(shapes.cyl, mat(f, bx, 2.9, -0.1, 0.04, 1.6, 0.04), post);
          solid.add(shapes.flag, mat(f, bx, 4.5, -0.1, 1.1, 1.1, 1.1, rnd() * Math.PI), new THREE.Color(flagColors[Math.floor(rnd() * flagColors.length)]));
        }
        solid.add(shapes.box, mat(f, 0, 1.1, -0.1, 6.8, 1.8, 0.12), new THREE.Color('#2b2f3a'));
        banners.add(shapes.plane, mat(f, 0, 2.0, -0.03, 6.4, 1.6), WHITE, rnd() < 0.5 ? BANNER_LOGO : BANNER_SLOGAN);
        banners.add(shapes.plane, mat(f, 0, 2.0, -0.17, 6.4, 1.6, 1, Math.PI), WHITE, rnd() < 0.5 ? BANNER_LOGO : BANNER_SLOGAN);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Trees, bushes, rocks
// ---------------------------------------------------------------------------

function pickWeighted<K extends string>(weights: Partial<Record<K, number>>, r: number): K {
  const entries = Object.entries(weights) as [K, number][];
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let x = r * total;
  for (const [k, w] of entries) {
    x -= w;
    if (x <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

function addTrees(site: Site, shapes: Shapes, solid: MeshBatch, look: BiomeLook, rnd: () => number, count: number): void {
  const clearance = site.outer + 5;
  const snow = new THREE.Color('#f4f8ff');
  // Forest clumps: half the trees gather around a few random centers, which
  // looks more natural than an even sprinkle.
  const clumps = Array.from({ length: 8 }, () => site.randomPoint(rnd));
  let made = 0;
  for (let tries = 0; tries < count * 8 && made < count; tries++) {
    let x: number;
    let z: number;
    if (rnd() < 0.5) {
      const c = clumps[Math.floor(rnd() * clumps.length)];
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 45;
      x = c[0] + Math.cos(a) * r;
      z = c[1] + Math.sin(a) * r;
    } else [x, z] = site.randomPoint(rnd);
    if (site.distToTrack(x, z) < clearance || !site.isFree(x, z, 2)) continue;
    const s = 0.7 + rnd() * 0.9;
    const f = mat(null, x, 0, z, s, s, s, rnd() * Math.PI * 2);
    const kind = pickWeighted(look.trees, rnd());
    const leaf = look.foliage(rnd);
    switch (kind) {
      case 'pine':
        solid.add(shapes.trunk, mat(f, 0, 0, 0, 1, 0.7, 1), look.trunk);
        solid.add(shapes.cone, mat(f, 0, 1.2, 0, 1.8, 2.6, 1.8), leaf);
        solid.add(shapes.cone, mat(f, 0, 2.6, 0, 1.4, 2.3, 1.4, 0.5), leaf.clone().multiplyScalar(1.08));
        solid.add(shapes.cone, mat(f, 0, 3.9, 0, 0.9, 2.0, 0.9, 1.0), look.snowyPines ? snow : leaf.clone().multiplyScalar(1.16));
        break;
      case 'poplar':
        solid.add(shapes.trunk, f, look.trunk);
        solid.add(shapes.blob, mat(f, 0, 4.4, 0, 1.1, 2.9, 1.1), leaf);
        break;
      case 'cactus': {
        const green = hsl(0.28 + rnd() * 0.05, 0.38, 0.36 + rnd() * 0.08);
        solid.add(shapes.cyl, mat(f, 0, 0, 0, 0.38, 3.4, 0.38), green);
        solid.add(shapes.cyl, mat(f, 0, 1.4, 0, 0.22, 0.75, 0.22, 0, 0, -Math.PI / 2), green); // arm out
        solid.add(shapes.cyl, mat(f, 0.75, 1.4, 0, 0.24, 1.3, 0.24), green); // arm up
        solid.add(shapes.cyl, mat(f, 0, 2.0, 0, 0.2, 0.6, 0.2, 0, 0, Math.PI / 2), green);
        solid.add(shapes.cyl, mat(f, -0.6, 2.0, 0, 0.2, 0.9, 0.2), green);
        break;
      }
      default: // round, leafy tree with a lumpy crown
        solid.add(shapes.trunk, f, look.trunk);
        solid.add(shapes.blob, mat(f, 0, 3.5, 0, 2.0, 1.7, 2.0), leaf);
        solid.add(shapes.blob, mat(f, 0.9, 4.3, 0.4, 1.3, 1.1, 1.3, 1), leaf.clone().multiplyScalar(1.15));
        solid.add(shapes.blob, mat(f, -0.8, 3.9, -0.6, 1.2, 1.0, 1.2, 2), leaf.clone().multiplyScalar(0.9));
    }
    made++;
  }
}

function addBushesAndRocks(site: Site, shapes: Shapes, solid: MeshBatch, look: BiomeLook, rnd: () => number, treeCount: number): void {
  // Most bushes and rocks sit in a band just beyond the off-road strip, where
  // they pass close to the camera and make the speed readable.
  const nearPoint = (): [number, number] => {
    const p = site.S[Math.floor(rnd() * site.S.length)];
    const side = rnd() < 0.5 ? -1 : 1;
    return site.beside(p, side * (site.outer + 4 + rnd() * 35));
  };
  const bushes = Math.round(treeCount * 0.6);
  for (let k = 0, tries = 0; k < bushes && tries < bushes * 6; tries++) {
    const [x, z] = rnd() < 0.7 ? nearPoint() : site.randomPoint(rnd);
    if (site.distToTrack(x, z) < site.outer + 3.5 || !site.isFree(x, z, 1)) continue;
    const s = 0.5 + rnd() * 0.8;
    const f = mat(null, x, 0, z, s, s, s, rnd() * 6.28);
    const c = look.bush(rnd);
    solid.add(shapes.blob, mat(f, 0, 0.45, 0, 1.2, 0.85, 1.2), c);
    solid.add(shapes.blob, mat(f, 0.9, 0.35, 0.3, 0.8, 0.65, 0.8, 1), c.clone().multiplyScalar(1.12));
    k++;
  }
  const rocks = Math.round(treeCount * look.rockDensity);
  for (let k = 0, tries = 0; k < rocks && tries < rocks * 6; tries++) {
    const [x, z] = rnd() < 0.6 ? nearPoint() : site.randomPoint(rnd);
    if (site.distToTrack(x, z) < site.outer + 3.5 || !site.isFree(x, z, 1)) continue;
    const s = 0.4 + rnd() ** 3 * 2.6; // mostly small, a few boulders
    const c = look.rock(rnd);
    solid.add(shapes.rock, mat(null, x, s * 0.25, z, s * (1 + rnd() * 0.6), s * (0.6 + rnd() * 0.4), s, rnd() * 6.28, rnd() * 0.5), c);
    if (rnd() < 0.4) solid.add(shapes.rock, mat(null, x + s * 1.1, s * 0.1, z + s * 0.3, s * 0.5, s * 0.4, s * 0.5, rnd() * 6.28), c.clone().multiplyScalar(0.9));
    k++;
  }
}

// ---------------------------------------------------------------------------
// Ground detail: grass tufts and flowers (thinned on lower quality)
// ---------------------------------------------------------------------------

interface DetailItem {
  geo: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  color: THREE.Color;
}

function addGroundDetail(site: Site, shapes: Shapes, out: DetailItem[], look: BiomeLook, rnd: () => number, treeCount: number): void {
  const clusters = Math.round(treeCount * 0.35);
  for (let c = 0; c < clusters; c++) {
    const p = site.S[Math.floor(rnd() * site.S.length)];
    const side = rnd() < 0.5 ? -1 : 1;
    const [cx, cz] = site.beside(p, side * (site.outer + 2 + rnd() * 30));
    const radius = 2.5 + rnd() * 4;
    const flowery = look.flowers.length > 0 && rnd() < 0.5;
    const flowerColor = flowery ? new THREE.Color(look.flowers[Math.floor(rnd() * look.flowers.length)]) : WHITE;
    const items = 10 + Math.floor(rnd() * 16);
    for (let k = 0; k < items; k++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * radius;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (site.distToTrack(x, z) < site.outer + 1 || !site.isFree(x, z)) continue;
      if (flowery && rnd() < 0.55) {
        const h = 0.25 + rnd() * 0.25;
        out.push({ geo: shapes.blade, matrix: mat(null, x, 0, z, 0.03, h, 0.03), color: look.tuft(rnd) });
        out.push({ geo: shapes.flower, matrix: mat(null, x, h, z, 0.13, 0.1, 0.13, rnd() * 3), color: flowerColor });
      } else {
        // A tuft: three thin blades leaning outwards.
        const c = look.tuft(rnd);
        const h = 0.5 + rnd() * 0.6;
        const ry = rnd() * Math.PI * 2;
        for (let b = 0; b < 3; b++) out.push({ geo: shapes.blade, matrix: mat(null, x, 0, z, 0.07, h * (0.8 + b * 0.15), 0.07, ry + b * 2.1, 0.35), color: c });
      }
    }
  }
}

function shuffle<T>(a: T[], rnd: () => number): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

// ---------------------------------------------------------------------------
// Far away: hills, mountains, clouds
// ---------------------------------------------------------------------------

function addHills(site: Site, shapes: Shapes, solid: MeshBatch, look: BiomeLook, rnd: () => number): void {
  const R = site.radius + 160;
  const N = 28;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + rnd() * 0.2;
    const r = R + rnd() * 60;
    const s = 50 + rnd() * 60;
    solid.add(shapes.hill, mat(null, site.cx + Math.cos(a) * r, -2, site.cz + Math.sin(a) * r, s * 1.6, s * 0.45, s, rnd() * 6.28), look.hill(rnd));
  }
}

function addMountains(site: Site, shapes: Shapes, far: MeshBatch, look: BiomeLook, rnd: () => number, horizon: THREE.Color): void {
  const snow = new THREE.Color('#f4f8ff');
  // Two rings: the farther one is mixed more with the horizon color (haze).
  for (const [ring, haze, count] of [[0, 0.35, 18], [1, 0.55, 24]] as const) {
    for (let i = 0; i < count; i++) {
      const a = ((i + rnd() * 0.6) / count) * Math.PI * 2;
      const dist = site.radius + 380 + ring * 170 + rnd() * 90;
      const x = site.cx + Math.cos(a) * dist;
      const z = site.cz + Math.sin(a) * dist;
      const r = 90 + rnd() * 90;
      const h = (ring ? 110 : 70) + rnd() * 90;
      const ry = rnd() * 6.28;
      const c = look.mountain(rnd).lerp(horizon, haze);
      if (look.mesas) {
        far.add(shapes.mesa, mat(null, x, -5, z, r, h * 0.45, r * 0.8, ry), c);
        far.add(shapes.mesa, mat(null, x, h * 0.45 - 5, z, r * 0.7, h * 0.08, r * 0.55, ry), c.clone().lerp(horizon, 0.1)); // cap layer
      } else {
        far.add(shapes.cone, mat(null, x, -5, z, r, h, r * 0.85, ry), c);
        if (look.snowCaps && h > 120) far.add(shapes.cone, mat(null, x, -5 + h * 0.68, z, r * 0.335, h * 0.32, r * 0.85 * 0.335, ry), snow.clone().lerp(horizon, haze * 0.6));
      }
    }
  }
}

/**
 * Mountains don't use fog, so their feet would stand out sharply against the
 * fogged-out ground. Blend each vertex toward the horizon color the lower it
 * is, so the mountains rise out of the haze.
 */
function fadeBaseToHorizon(geo: THREE.BufferGeometry, horizon: THREE.Color, height: number): void {
  const pos = geo.getAttribute('position');
  const col = geo.getAttribute('color');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(1 - pos.getY(i) / height, 0, 1);
    c.fromBufferAttribute(col as THREE.BufferAttribute, i).lerp(horizon, t * t * 0.9);
    col.setXYZ(i, c.r, c.g, c.b);
  }
}

function buildClouds(site: Site, shapes: Shapes, look: BiomeLook, rnd: () => number, horizon: THREE.Color): THREE.Mesh {
  const batch = new MeshBatch();
  for (let i = 0; i < look.cloudCount; i++) {
    const a = rnd() * Math.PI * 2;
    const dist = 250 + rnd() * 650;
    const f = mat(null, site.cx + Math.cos(a) * dist, 80 + rnd() * 110, site.cz + Math.sin(a) * dist, 1, 1, 1, rnd() * 6.28);
    const size = 12 + rnd() * 14;
    const puffs = 4 + Math.floor(rnd() * 4);
    for (let k = 0; k < puffs; k++) {
      const t = puffs > 1 ? k / (puffs - 1) - 0.5 : 0; // spread along local x
      const s = size * (1 - Math.abs(t) * 0.9) * (0.75 + rnd() * 0.4);
      batch.add(shapes.puff, mat(f, t * size * 3.2, rnd() * size * 0.3, (rnd() - 0.5) * size, s * 1.2, s * 0.65, s), WHITE);
    }
  }
  // Emissive horizon tint = soft, bright clouds that blend with the sky.
  const mesh = batch.build(new THREE.MeshLambertMaterial({ vertexColors: true, fog: false, emissive: horizon.clone().multiplyScalar(0.45) }));
  mesh.userData.cloudLayer = true;
  // Drift slowly around the track. onBeforeRender runs right before drawing,
  // so this needs no hook in the game loop.
  const pivot = new THREE.Vector3(site.cx, 0, site.cz);
  mesh.position.copy(pivot);
  mesh.geometry.translate(-pivot.x, 0, -pivot.z);
  mesh.onBeforeRender = () => {
    mesh.rotation.y = (performance.now() / 1000) * 0.004;
    mesh.updateMatrixWorld();
  };
  return mesh;
}
