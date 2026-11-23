/**
 * Treetop set pieces (Autumn Speedway): everything that makes the course look like it runs through
 * the crowns of a giant autumn forest. Only tracks with `def.scenery.treetop` use this file.
 *
 *  - GIANT TREES (`buildGiantTrees`): huge bark trunks with flared roots, spreading limbs and crowns
 *    made of big lumpy leaf clusters in red, orange and gold. They come from the scenery plan
 *    (`plan.giantTrees`), which also gives each trunk its solid collider ("what you see is what you hit").
 *  - BRANCH LOGS (`buildBranchLogs`): a thick bark log under every plank branch road, so the road reads
 *    as built on a branch rather than floating on stilts. Rope-bridge spans get ropes instead
 *    (`buildRopeBridges`: sagging hand ropes, posts, hangers).
 *  - FALLING LEAVES (`buildFallingLeaves`): a few thousand leaves drifting down around the road. All the
 *    motion is done on the GPU (a vertex shader driven by the shared clock ENV_TIME), so it costs one draw
 *    call and no per-frame JavaScript.
 *  - LEAF PILES (`buildLeafPiles`): soft heaps of leaves on the floor sections (decoration: no collider).
 *  - PLANK ROAD texture (`plankTexture`): drawn on a canvas at startup, no image files.
 *  - FOREST BACKDROP (`forestBackdropGeo`): hazy silhouettes of more giant trees on the horizon.
 *
 * Web/3D concepts used here:
 *  - "Merging" many small shapes into one geometry means the GPU draws them with ONE draw call.
 *  - "Vertex colours" bake the colour of every corner of every triangle into the geometry, so one material
 *    can draw bark, moss and leaves in many colours.
 *  - An "instanced" geometry draws the same small shape (a leaf) thousands of times, each copy with its own
 *    per-instance data (position, colour, timing), again in one draw call.
 */
import * as THREE from 'three';
import { BRIDGE_DECK } from '../../sim/bridgePillars';
import { CURB_WIDTH, Track, type TrackSample } from '../../sim/track';
import type { GiantTreeItem, SceneryPlan } from '../../track/sceneryPlan';
import { seededRandom } from '../textures';
import { blobGeo, latheGeo, matrix, merge, paint, tubeGeo, type ColorFn } from './geo';
import { ENV_TIME, propMaterial, watchQuality } from './materials';
import { fbm3, noise3, smoothstep } from './noise';

/** True if the track uses the treetop look. */
export function isTreetop(track: Track): boolean {
  return track.def.scenery.treetop !== undefined;
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const BARK = new THREE.Color('#5c4636');
const BARK_DARK = new THREE.Color('#2c2018');
const MOSS = new THREE.Color('#6f7a32');
/** Crown palettes (shadow colour, sunlit colour): red maple, orange, gold, and a few still a little green. */
const CROWNS: [THREE.Color, THREE.Color][] = [
  [new THREE.Color('#8e1f12'), new THREE.Color('#f0522a')], // red
  [new THREE.Color('#a8400f'), new THREE.Color('#ffa12e')], // orange
  [new THREE.Color('#a86d10'), new THREE.Color('#ffd24a')], // gold
  [new THREE.Color('#9a3a14'), new THREE.Color('#f78a32')], // copper
  [new THREE.Color('#6a6a1c'), new THREE.Color('#d8c046')], // yellow-green (late turners)
];

const _c = new THREE.Color();

/** Bark colouring: vertical grooves, darker low down and in the grooves, moss creeping up the foot. */
function barkColor(footY: number, seed: number): ColorFn {
  return (p, n) => {
    const groove = noise3(p.x * 0.35, p.y * 0.04, p.z * 0.35, seed);
    const fine = noise3(p.x * 1.8, p.y * 0.6, p.z * 1.8, seed + 1);
    _c.copy(BARK).lerp(BARK_DARK, THREE.MathUtils.clamp(0.55 - groove * 0.9 + (fine - 0.5) * 0.3, 0, 0.85));
    // Moss on the upward-facing and lowest parts of the trunk.
    const moss = smoothstep(14, 2, p.y - footY) * 0.6 + Math.max(0, n.y) * 0.35;
    _c.lerp(MOSS, THREE.MathUtils.clamp(moss * (0.5 + fine * 0.6), 0, 0.7));
    return _c;
  };
}

/** Leaf colouring for one crown: darker deep inside and underneath, bright on top, noisy patches of colour. */
function leafColor(cx: number, cy: number, cz: number, rad: number, palette: [THREE.Color, THREE.Color], seed: number): ColorFn {
  return (p, n) => {
    const up = THREE.MathUtils.clamp((p.y - cy) / rad * 0.6 + 0.5, 0, 1);
    const out = THREE.MathUtils.clamp(Math.hypot(p.x - cx, p.z - cz) / rad, 0, 1);
    const patch = fbm3(p.x * 0.09, p.y * 0.09, p.z * 0.09, seed);
    _c.copy(palette[0]).lerp(palette[1], THREE.MathUtils.clamp(up * 0.6 + out * 0.25 + (patch - 0.5) * 1.4 + Math.max(0, n.y) * 0.2, 0, 1));
    _c.multiplyScalar(0.62 + 0.45 * up);
    return _c;
  };
}

// ---------------------------------------------------------------------------
// Keeping branches and leaves out of the road
// ---------------------------------------------------------------------------

/**
 * Answers "would a shape here poke into the space karts drive through?". The space is a box over every road
 * sample: the road half width plus the kerbs and a margin sideways, and from 2 m below the road to 9 m above
 * it (kart, flying karts and the chase camera). Limbs and leaf clusters that fail are moved or dropped.
 */
class RoadSpace {
  private readonly pts: { x: number; y: number; z: number }[] = [];
  private readonly half: number;
  constructor(track: Track) {
    for (let i = 0; i < track.samples.length; i += 2) this.pts.push(track.samples[i]);
    for (const b of track.branches) for (let i = 0; i < b.samples.length; i += 2) this.pts.push(b.samples[i]);
    this.half = track.def.width / 2 + CURB_WIDTH + 2.5;
  }
  /** True if a sphere-ish shape at (x, z), horizontal radius r, spanning heights y0..y1, overlaps the road space. */
  hits(x: number, z: number, r: number, y0: number, y1: number): boolean {
    const reach = (r + this.half) * (r + this.half);
    for (const p of this.pts) {
      if ((p.x - x) ** 2 + (p.z - z) ** 2 > reach) continue;
      if (y1 > p.y - 2 && y0 < p.y + 9) return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Giant trees
// ---------------------------------------------------------------------------

/**
 * One giant tree as a single geometry (trunk + roots + limbs + crown), in world space.
 * `detail` 1 = close to the road (more segments), 0 = background tree.
 */
function giantTreeGeo(t: GiantTreeItem, detail: 0 | 1, road: RoadSpace): THREE.BufferGeometry {
  const rnd = seededRandom(t.seed);
  const parts: THREE.BufferGeometry[] = [];
  const foot = t.y;
  const top = t.y + t.height;
  const r = t.radius;
  const seg = detail ? 18 : 10;

  // Trunk: a surface of revolution. Wide root flare at the foot, then almost straight (never wider than the
  // collider radius above the flare), tapering into the crown. Bark ridges come from the angle modifier.
  const prof: [number, number][] = [];
  const rings = detail ? 14 : 8;
  for (let i = 0; i <= rings; i++) {
    const f = i / rings;
    const y = foot - 2 + (top - foot + 2) * f;
    const flare = 1 + 0.9 * Math.pow(Math.max(0, 1 - (y - foot) / 14), 2.2); // roots spread out at the bottom
    const taper = f < 0.62 ? 1 - 0.1 * f : 0.94 - (f - 0.62) * 1.6; // narrows into the crown
    prof.push([Math.max(0.3, r * flare * taper), y]);
  }
  const ridgePhase = rnd() * 10;
  const trunk = latheGeo(prof, seg, (a, f) => 1 + 0.045 * Math.sin(a * 11 + ridgePhase + f * 3) + 0.03 * Math.sin(a * 5 + f * 9));
  trunk.translate(t.x, 0, t.z);
  parts.push(paint(trunk, barkColor(foot, t.seed % 97)));

  // Roots: a few big snaking roots running out over the floor.
  const roots = detail ? 6 : 3;
  for (let k = 0; k < roots; k++) {
    const a = (k / roots) * Math.PI * 2 + rnd() * 0.5;
    const len = r * (1.6 + rnd() * 0.9);
    const path: THREE.Vector3[] = [];
    for (let s = 0; s <= 4; s++) {
      const f = s / 4;
      const d = r * 0.9 + len * f;
      const wob = (rnd() - 0.5) * 0.25;
      path.push(new THREE.Vector3(t.x + Math.cos(a + wob * f) * d, foot + 3.5 * (1 - f) * (1 - f) - 0.6 * f, t.z + Math.sin(a + wob * f) * d));
    }
    const g = tubeGeo(path, [r * 0.42, r * 0.3, r * 0.2, r * 0.12, r * 0.04], detail ? 8 : 5);
    parts.push(paint(g, barkColor(foot, t.seed % 97)));
  }

  // Limbs: big branches leaving the upper trunk, reaching out and up into the crown.
  const crownY = top;
  const limbs = detail ? 6 : 4;
  const limbEnds: THREE.Vector3[] = [];
  for (let k = 0; k < limbs; k++) {
    // Try a few directions: a limb must never reach into the space above a road (see RoadSpace).
    let path: THREE.Vector3[] | null = null;
    for (let tryNo = 0; tryNo < 10 && !path; tryNo++) {
      const a = (k / limbs) * Math.PI * 2 + rnd() * 0.8 + tryNo * 0.6;
      const y0 = foot + t.height * (0.6 + rnd() * 0.15);
      const reach = t.crown * (0.55 + rnd() * 0.3);
      const p0 = new THREE.Vector3(t.x + Math.cos(a) * r * 0.5, y0, t.z + Math.sin(a) * r * 0.5);
      const p1 = new THREE.Vector3(t.x + Math.cos(a) * reach * 0.45, y0 + t.height * 0.1, t.z + Math.sin(a) * reach * 0.45);
      const p2 = new THREE.Vector3(t.x + Math.cos(a + 0.15) * reach, crownY - t.crown * 0.1 + rnd() * t.crown * 0.2, t.z + Math.sin(a + 0.15) * reach);
      const mid = p1.clone().lerp(p2, 0.5);
      if ([p1, mid, p2].some((q) => road.hits(q.x, q.z, r * 0.3, q.y - r * 0.3, q.y + r * 0.3))) continue;
      path = [p0, p1, p2];
    }
    if (!path) continue;
    const p2 = path[2];
    const g = tubeGeo(path, [r * 0.38, r * 0.24, r * 0.08], detail ? 9 : 5);
    parts.push(paint(g, barkColor(foot, t.seed % 97)));
    limbEnds.push(p2);
  }

  // Crown: a big central mass plus clusters at the limb ends and a ring of smaller puffs. Flattened a little.
  const palette = CROWNS[t.seed % CROWNS.length];
  const color = leafColor(t.x, crownY, t.z, t.crown, palette, t.seed % 53);
  const blobDetail = detail ? 2 : 1;
  const sway = (p: THREE.Vector3) => THREE.MathUtils.clamp((p.y - crownY + t.crown) / t.crown, 0, 1) * 2.5;
  const blob = (x: number, y: number, z: number, rad: number, sy: number, dd = blobDetail) => {
    // Shrink a leaf cluster that would hang into a road, or leave it out.
    while (rad > t.crown * 0.12 && road.hits(x, z, rad * 1.1, y - rad * sy * 1.1, y + rad * sy * 1.1)) rad *= 0.75;
    if (road.hits(x, z, rad * 1.1, y - rad * sy * 1.1, y + rad * sy * 1.1)) return;
    const g = blobGeo(dd, Math.floor(rnd() * 1000), 0.22, 1.6, noise3);
    g.applyMatrix4(matrix(x, y, z, rad, rad * sy, rad, rnd() * 6.28));
    parts.push(paint(g, color, sway));
  };
  blob(t.x, crownY + t.crown * 0.15, t.z, t.crown * 0.62, 0.62);
  for (const e of limbEnds) blob(e.x, e.y + t.crown * 0.08, e.z, t.crown * (0.36 + rnd() * 0.12), 0.7);
  // (The smaller puffs round the edge are always the cheap model: they are small on screen.)
  const puffs = detail ? 6 : 3;
  for (let k = 0; k < puffs; k++) {
    const a = rnd() * Math.PI * 2;
    const d = t.crown * (0.5 + rnd() * 0.45);
    blob(t.x + Math.cos(a) * d, crownY + (rnd() - 0.3) * t.crown * 0.5, t.z + Math.sin(a) * d, t.crown * (0.22 + rnd() * 0.14), 0.75, 1);
  }
  return merge(parts);
}

/**
 * All giant trees, merged into a few meshes by area (so the camera can skip the ones behind it).
 * Trees within 40 m of the road get the detailed model.
 */
export function buildGiantTrees(track: Track, plan: SceneryPlan): THREE.Object3D[] {
  if (plan.giantTrees.length === 0) return [];
  const cell = 220; // metres: one merged mesh per cell of this size
  // Trees close to the road get the detailed model and cast shadows on it; the rest of the forest is a cheaper
  // model that casts none (its shadow would fall far from the road anyway). Separate meshes for the two kinds.
  const groups = new Map<string, { near: boolean; geos: THREE.BufferGeometry[] }>();
  const road = new RoadSpace(track);
  for (const t of plan.giantTrees) {
    let near = Infinity;
    for (let i = 0; i < track.samples.length; i += 4) near = Math.min(near, Math.hypot(track.samples[i].x - t.x, track.samples[i].z - t.z));
    const close = near - t.radius < 30;
    const key = `${Math.floor(t.x / cell)},${Math.floor(t.z / cell)},${close}`;
    if (!groups.has(key)) groups.set(key, { near: close, geos: [] });
    groups.get(key)!.geos.push(giantTreeGeo(t, close ? 1 : 0, road));
  }
  const material = propMaterial(0.9);
  const out: THREE.Object3D[] = [];
  for (const { near, geos } of groups.values()) {
    const mesh = new THREE.Mesh(merge(geos), material);
    mesh.castShadow = near;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; // static: lets the fog culler pick it up (env/fogCull.ts)
    mesh.updateMatrix();
    watchQuality(mesh);
    out.push(mesh);
  }
  return out;
}

/**
 * Lanterns (trees with `lanterns`): a ring of warm paper lanterns hanging on short cords from pegs round the
 * trunk. The lantern bodies use a self-lit material with a colour above 1, so the bloom makes them glow.
 * Returns [the pegs and cords (lit wood), the glowing lanterns].
 */
export function buildLanterns(plan: SceneryPlan): THREE.Object3D[] {
  const wood: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const cord: ColorFn = () => _c.set('#3a2618');
  for (const t of plan.giantTrees) {
    if (t.lanterns === undefined) continue;
    const n = 12;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.2;
      const y = t.y + t.lanterns + (k % 2) * 2.2;
      const out = t.radius * 0.95 + 2.2;
      const peg0 = new THREE.Vector3(t.x + Math.cos(a) * t.radius * 0.9, y + 1.2, t.z + Math.sin(a) * t.radius * 0.9);
      const peg1 = new THREE.Vector3(t.x + Math.cos(a) * out, y + 1.4, t.z + Math.sin(a) * out);
      wood.push(paint(tubeGeo([peg0, peg1], [0.12, 0.09], 5), cord));
      wood.push(paint(tubeGeo([peg1, new THREE.Vector3(peg1.x, y + 0.5, peg1.z)], [0.03, 0.03], 3), cord));
      const warm = k % 3 === 0 ? new THREE.Color(3.2, 1.4, 0.45) : new THREE.Color(3.0, 1.9, 0.6);
      const g = blobGeo(1, k, 0.05, 1, noise3).applyMatrix4(matrix(peg1.x, y, peg1.z, 0.45, 0.6, 0.45));
      glow.push(paint(g, () => warm));
    }
  }
  if (glow.length === 0) return [];
  const pegs = new THREE.Mesh(merge(wood), propMaterial(0.9));
  const lamps = new THREE.Mesh(merge(glow), new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
  return [pegs, lamps];
}

// ---------------------------------------------------------------------------
// Branch logs under the plank roads, rope bridges
// ---------------------------------------------------------------------------

/** Contiguous runs of main-road samples on bridges of the given look ('rope' or plank = undefined). */
function bridgeRuns(track: Track, rope: boolean): TrackSample[][] {
  const runs: TrackSample[][] = [];
  const defs = track.def.bridges ?? [];
  track.bridges.forEach((b, i) => {
    if ((defs[i]?.look === 'rope') !== rope) return;
    const len = (((b.s1 - b.s0) % track.length) + track.length) % track.length;
    const n = track.samples.length;
    const i0 = Math.floor(b.s0 / track.spacing);
    const run: TrackSample[] = [];
    for (let k = 0; k <= Math.ceil(len / track.spacing); k++) {
      const p = track.samples[(i0 + k) % n];
      if (!track.inGap(p.s)) run.push(p);
      else if (run.length > 1) {
        runs.push(run.splice(0));
      } else run.length = 0;
    }
    if (run.length > 1) runs.push(run);
  });
  return runs;
}

/**
 * A thick bark log under every plank road on a bridge: the "branch" the road is built on. Its top touches
 * the underside of the deck. Thicker where the road is high above the floor. One merged mesh.
 */
export function buildBranchLogs(track: Track): THREE.Object3D[] {
  const parts: THREE.BufferGeometry[] = [];
  const hw = track.def.width / 2;
  for (const run of bridgeRuns(track, false)) {
    const step = 3; // every 3rd sample (~6 m) is plenty for a smooth log
    const path: THREE.Vector3[] = [];
    const radii: number[] = [];
    for (let i = 0; i < run.length; i += step) {
      const p = run[i];
      const ground = track.terrain.height(p.x, p.z);
      const above = p.y - ground;
      const R = THREE.MathUtils.clamp(1.4 + above * 0.03, 1.4, 3.2) * Math.min(1, above / 6);
      const lift = Track.bankLift(p.bank, hw, 0);
      path.push(new THREE.Vector3(p.x, p.y + lift - BRIDGE_DECK - R * 0.55, p.z));
      radii.push(Math.max(0.2, R));
    }
    if (path.length < 2) continue;
    // Taper the ends so the log grows out of / back into the ground or a trunk.
    radii[0] *= 0.6;
    radii[radii.length - 1] *= 0.6;
    const g = tubeGeo(path, radii, 10);
    parts.push(paint(g, barkColor(-100, 11)));
  }
  if (parts.length === 0) return [];
  const mesh = new THREE.Mesh(merge(parts), propMaterial(0.92));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return [mesh];
}

/**
 * Brackets where a plank road passes close to a giant trunk (the spiral round the Great Trunk, the hairpin
 * round the Lantern Oak...): every ~12 m a beam runs from the trunk to under the middle of the deck, with a
 * diagonal strut below it down to the trunk. The road then visibly hangs on the tree.
 */
export function buildTrunkBrackets(track: Track, plan: SceneryPlan): THREE.Object3D[] {
  const parts: THREE.BufferGeometry[] = [];
  const hw = track.def.width / 2;
  const wood: ColorFn = (p) => _c.set('#4a3020').multiplyScalar(0.8 + 0.4 * noise3(p.x * 0.8, p.y * 0.8, p.z * 0.8, 4));
  for (const run of bridgeRuns(track, false)) {
    for (let i = 0; i < run.length; i += 6) {
      const p = run[i];
      for (const t of plan.giantTrees) {
        const dx = p.x - t.x;
        const dz = p.z - t.z;
        const d = Math.hypot(dx, dz);
        if (d > t.radius + hw + 16 || p.y < t.y + 6) continue; // only roads hugging a trunk, well above the floor
        const ux = dx / d;
        const uz = dz / d;
        const under = p.y + Track.bankLift(p.bank, hw, 0) - BRIDGE_DECK - 0.2;
        const atTrunk = (y: number) => new THREE.Vector3(t.x + ux * t.radius * 0.95, y, t.z + uz * t.radius * 0.95);
        const mid = new THREE.Vector3(p.x, under, p.z);
        parts.push(paint(tubeGeo([atTrunk(under), mid], [0.75, 0.55], 7), wood)); // the beam
        parts.push(paint(tubeGeo([atTrunk(under - 9), new THREE.Vector3(t.x + ux * (d - hw * 0.4), under - 0.3, t.z + uz * (d - hw * 0.4))], [0.6, 0.45], 6), wood)); // the strut
      }
    }
  }
  if (parts.length === 0) return [];
  const mesh = new THREE.Mesh(merge(parts), propMaterial(0.9));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return [mesh];
}

/**
 * Rope bridges: wooden posts at both edges every few metres, two hand ropes sagging between the posts,
 * thin hangers down to the deck and a rope along the deck edge. Decoration only (the bridge has no walls).
 */
export function buildRopeBridges(track: Track): THREE.Object3D[] {
  const parts: THREE.BufferGeometry[] = [];
  const half = track.def.width / 2 + CURB_WIDTH + 0.1;
  const rope = new THREE.Color('#c9a46a');
  const post = new THREE.Color('#6a4428');
  const ropeColor: ColorFn = (p) => _c.copy(rope).multiplyScalar(0.8 + 0.25 * noise3(p.x * 2, p.y * 2, p.z * 2, 3));
  const postColor: ColorFn = (p) => _c.copy(post).multiplyScalar(0.75 + 0.35 * noise3(p.x * 3, p.y, p.z * 3, 5));
  const hw = track.def.width / 2;
  const deckY = (p: TrackSample, d: number) => p.y + Track.bankLift(p.bank, hw, d) + track.rampHeight(p.s);
  for (const run of bridgeRuns(track, true)) {
    const every = 4; // a post every 4 samples (~8 m)
    for (const side of [-1, 1]) {
      const at = (p: TrackSample, h: number) => new THREE.Vector3(p.x + p.rx * side * half, deckY(p, side * half) + h, p.z + p.rz * side * half);
      // Posts.
      for (let i = 0; i < run.length; i += every) parts.push(paint(tubeGeo([at(run[i], -0.6), at(run[i], 1.6)], [0.16, 0.13], 6), postColor));
      // Hand ropes (two heights) and the edge rope, sagging between posts.
      for (const h of [0.05, 0.75, 1.35]) {
        const path: THREE.Vector3[] = [];
        for (let i = 0; i < run.length; i++) {
          const k = i % every;
          const sag = h > 0.1 ? Math.sin((k / every) * Math.PI) * 0.28 : 0;
          path.push(at(run[i], h - sag));
        }
        parts.push(paint(tubeGeo(path, path.map(() => (h > 0.1 ? 0.06 : 0.09)), 5), ropeColor));
      }
      // Hangers between the upper rope and the deck edge (every sample: reads as netting from a distance).
      for (let i = 1; i < run.length; i++) {
        if (i % every === 0) continue;
        const k = i % every;
        const sag = Math.sin((k / every) * Math.PI) * 0.28;
        parts.push(paint(tubeGeo([at(run[i], 0.05), at(run[i], 1.35 - sag)], [0.025, 0.025], 3), ropeColor));
      }
    }
  }
  if (parts.length === 0) return [];
  const mesh = new THREE.Mesh(merge(parts), propMaterial(0.95));
  mesh.castShadow = true;
  return [mesh];
}

/**
 * Shortcut paths (the root-ridge shortcut): two bark roots run along both edges of the narrow dirt path, so
 * it reads as driving along the top of a giant root, and the edge you must not cross is easy to see.
 * Looks only (the drop beside the path is the real danger: fall and you respawn).
 */
export function buildShortcutRoots(track: Track): THREE.Object3D[] {
  const parts: THREE.BufferGeometry[] = [];
  for (const b of track.branches) {
    const S = b.samples;
    // Leave the first and last 18 m alone: there the path joins the main road.
    const skip = Math.ceil(18 / b.spacing);
    for (const side of [-1, 1]) {
      const path: THREE.Vector3[] = [];
      const radii: number[] = [];
      for (let i = skip; i < S.length - skip; i += 2) {
        const p = S[i];
        const d = side * (p.width / 2 + 0.9);
        const x = p.x + p.rx * d;
        const z = p.z + p.rz * d;
        const ground = track.terrain.height(x, z);
        const r = 0.9 + 0.35 * Math.sin(i * 0.37 + side); // knobbly: the thickness wanders
        path.push(new THREE.Vector3(x, Math.max(ground, track.terrain.height(p.x, p.z) - 0.4) + r * 0.35, z));
        radii.push(r);
      }
      if (path.length < 2) continue;
      radii[0] = radii[radii.length - 1] = 0.2;
      parts.push(paint(tubeGeo(path, radii, 7), barkColor(-100, 23)));
    }
  }
  if (parts.length === 0) return [];
  const mesh = new THREE.Mesh(merge(parts), propMaterial(0.92));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return [mesh];
}

// ---------------------------------------------------------------------------
// Falling leaves
// ---------------------------------------------------------------------------

/** How far (m) a leaf falls before it starts again at the top of its column. */
const LEAF_DROP = 34;

/**
 * Leaves drifting down around the road. One instanced draw call; the vertex shader moves every leaf:
 * it falls at its own speed, swings from side to side and tumbles, and wraps back to the top of its
 * column (a pure function of the clock ENV_TIME, so nothing is updated in JavaScript).
 * `count` is the number of leaves (fewer on Low quality).
 */
export function buildFallingLeaves(track: Track, count = 2600): THREE.Mesh {
  const rnd = seededRandom(4242);
  // One leaf: a small diamond with a bent middle (4 triangles), 0.35 m long.
  const base = new THREE.BufferGeometry();
  const L = 0.2;
  const W = 0.13;
  base.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, L, W, 0.03, 0, 0, 0, -L, -W, 0.03, 0, 0, 0.02, 0], 3));
  base.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  base.setIndex([0, 1, 4, 4, 1, 2, 2, 3, 4, 4, 3, 0]);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.getAttribute('position'));
  g.setAttribute('normal', base.getAttribute('normal'));
  const spot = new Float32Array(count * 4); // x, top y, z, phase
  const colors = new Float32Array(count * 3);
  const S = track.samples;
  const leafCols = ['#e8461e', '#f07a22', '#ffb02e', '#ffd34a', '#c0301a', '#d8902a'].map((h) => new THREE.Color(h));
  for (let i = 0; i < count; i++) {
    const p = S[Math.floor(rnd() * S.length)];
    const lat = (rnd() * 2 - 1) * 34; // around and over the road
    spot[i * 4] = p.x + p.rx * lat + (rnd() - 0.5) * 6;
    spot[i * 4 + 1] = p.y + 6 + rnd() * 26; // the top of this leaf's fall
    spot[i * 4 + 2] = p.z + p.rz * lat + (rnd() - 0.5) * 6;
    spot[i * 4 + 3] = rnd() * 1000;
    const c = leafCols[Math.floor(rnd() * leafCols.length)];
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('aSpot', new THREE.InstancedBufferAttribute(spot, 4));
  g.setAttribute('color', new THREE.InstancedBufferAttribute(colors, 3));
  g.instanceCount = count;

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = ENV_TIME;
    shader.vertexShader =
      `attribute vec4 aSpot;\nuniform float uTime;\n
      // Tumble: rotate a vector around a tilted axis by angle a (Rodrigues' rotation formula).
      vec3 leafSpin(vec3 v, vec3 k, float a) { return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a)); }\n` +
      shader.vertexShader
        .replace(
          '#include <beginnormal_vertex>',
          /* glsl */ `#include <beginnormal_vertex>
          float lph = aSpot.w;
          vec3 laxis = normalize(vec3(sin(lph * 1.3), 0.6, cos(lph * 2.1)));
          float lang = uTime * (1.5 + fract(lph * 0.37) * 2.0) + lph;
          objectNormal = leafSpin(objectNormal, laxis, lang);`,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          {
            float speed = 1.6 + fract(lph * 0.71) * 1.4;                 // m/s downwards
            float fall = mod(uTime * speed + lph * 7.0, ${LEAF_DROP.toFixed(1)});
            float swing = sin(uTime * 1.3 + lph) * 1.4;                   // drifting from side to side
            transformed = leafSpin(transformed, laxis, lang) * 1.4;
            transformed += vec3(aSpot.x + swing, aSpot.y - fall, aSpot.z + cos(uTime * 1.1 + lph * 3.0) * 1.2);
          }`,
        );
  };
  mat.customProgramCacheKey = () => 'treetop-leaves';
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; // the leaves are spread over the whole course; the GPU clips them cheaply
  // Low quality (no shadows) draws only a third of the leaves. onBeforeRender runs just before the draw call.
  mesh.onBeforeRender = (renderer) => {
    g.instanceCount = renderer.shadowMap.enabled ? count : Math.floor(count / 3);
  };
  return mesh;
}

// ---------------------------------------------------------------------------
// Leaf piles
// ---------------------------------------------------------------------------

/** Soft heaps of leaves (from `treetop.leafPiles`), merged into one mesh. No collider: you drive through them. */
export function buildLeafPiles(track: Track): THREE.Object3D[] {
  const piles = track.def.scenery.treetop?.leafPiles ?? [];
  if (piles.length === 0) return [];
  const rnd = seededRandom(777);
  const parts: THREE.BufferGeometry[] = [];
  for (const pile of piles) {
    const s = track.sAt(pile.at);
    const p = track.pointAt(s, (pile.offset * track.def.width) / 2);
    const ground = track.sample(p.x, p.z, p.index)?.height ?? p.y;
    const size = pile.size ?? 2.2;
    // Fallen leaves: browner and duller than the leaves still on the trees, with the odd bright patch.
    const palette: [THREE.Color, THREE.Color] = [new THREE.Color('#6a3414'), new THREE.Color(['#d8822a', '#e0a03a', '#c8602a'][Math.floor(rnd() * 3)])];
    for (let k = 0; k < 4; k++) {
      const g = blobGeo(2, Math.floor(rnd() * 1000), 0.3, 2.2, noise3);
      const r = size * (k === 0 ? 1 : 0.5 + rnd() * 0.3);
      const a = rnd() * 6.28;
      const d = k === 0 ? 0 : size * 0.8;
      g.applyMatrix4(matrix(p.x + Math.cos(a) * d, ground - r * 0.1, p.z + Math.sin(a) * d, r, r * 0.42, r, rnd() * 6.28));
      parts.push(paint(g, leafColor(p.x, ground, p.z, size, palette, k)));
    }
  }
  const mesh = new THREE.Mesh(merge(parts), propMaterial(0.95));
  mesh.receiveShadow = true;
  return [mesh];
}

// ---------------------------------------------------------------------------
// Plank road textures
// ---------------------------------------------------------------------------

/**
 * Plank deck for the road: boards running ACROSS the road (the texture's V axis runs along the road,
 * 12 m per repeat, see trackView.ts), each board with its own tone and grain, dark gaps, nail heads,
 * and two long edge beams. Drawn once on a canvas.
 */
let plankCache: THREE.CanvasTexture | null = null;
export function plankTexture(): THREE.CanvasTexture {
  // Drawn once; every caller gets its own Texture object (own repeat/rotation) sharing the one image.
  if (plankCache) return plankCache.clone();
  const n = 512;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const rnd = seededRandom(91);
  const boards = 20; // 12 m / 20 = 0.6 m per board
  const bh = n / boards;
  for (let b = 0; b < boards; b++) {
    const y = b * bh;
    // Board base tone: warm browns with variety, a few greyer weathered ones.
    const weathered = rnd() < 0.15;
    const h = 24 + rnd() * 10;
    const s = weathered ? 14 : 28 + rnd() * 14;
    const l = 27 + rnd() * 11;
    ctx.fillStyle = `hsl(${h},${s}%,${l}%)`;
    ctx.fillRect(0, y, n, bh);
    // Grain: long thin streaks along the board.
    for (let k = 0; k < 26; k++) {
      ctx.fillStyle = `rgba(${rnd() < 0.5 ? '40,22,10' : '255,220,170'},${0.05 + rnd() * 0.08})`;
      ctx.fillRect(rnd() * n, y + rnd() * bh, 60 + rnd() * 260, 1 + rnd() * 1.5);
    }
    // Board joints (boards are shorter than the road is wide): a dark line across, staggered.
    const joint = n * (0.25 + rnd() * 0.5);
    ctx.fillStyle = 'rgba(20,10,5,0.55)';
    ctx.fillRect(joint, y, 2, bh);
    // Nail heads near the joints and the ends.
    ctx.fillStyle = 'rgba(30,25,22,0.8)';
    for (const x of [n * 0.07, joint - 6, joint + 8, n * 0.93]) {
      ctx.fillRect(x, y + bh * 0.25, 3, 3);
      ctx.fillRect(x, y + bh * 0.7, 3, 3);
    }
    // The gap between boards.
    ctx.fillStyle = 'rgba(15,8,4,0.85)';
    ctx.fillRect(0, y, n, 2);
  }
  // Long edge beams on both sides (the outer 4 %), and a worn lighter racing line down the middle.
  for (const x0 of [0, n * 0.96]) {
    ctx.fillStyle = '#4a2e1a';
    ctx.fillRect(x0, 0, n * 0.04, n);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x0 === 0 ? n * 0.04 : x0 - 2, 0, 2, n);
  }
  const wear = ctx.createLinearGradient(0, 0, n, 0);
  wear.addColorStop(0.2, 'rgba(255,230,190,0)');
  wear.addColorStop(0.5, 'rgba(255,230,190,0.08)');
  wear.addColorStop(0.8, 'rgba(255,230,190,0)');
  ctx.fillStyle = wear;
  ctx.fillRect(0, 0, n, n);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  plankCache = tex;
  return tex.clone();
}

// ---------------------------------------------------------------------------
// Forest backdrop
// ---------------------------------------------------------------------------

/**
 * Far-away giant trees for the horizon (instead of mountains): a trunk and a few crown blobs each, low poly,
 * with BAKED shading (lit side / shade side) and haze toward the horizon colour baked into the vertex colours,
 * for the self-lit backdrop material (see env/backdrop.ts). `haze` 0..1: the farther the ring, the hazier.
 */
export function forestBackdropGeo(rnd: () => number, x: number, z: number, scale: number, horizon: THREE.Color, haze: number): THREE.BufferGeometry {
  const sun = new THREE.Vector3(-0.6, 0.55, -0.3).normalize();
  const parts: THREE.BufferGeometry[] = [];
  const shade = (base: THREE.Color): ColorFn => (_p, n) => _c.copy(base).multiplyScalar(0.5 + 0.6 * Math.max(0, n.dot(sun))).lerp(horizon, haze);
  const h = 90 * scale;
  const r = 7 * scale;
  parts.push(paint(latheGeo([[r * 1.8, -2], [r * 1.1, h * 0.1], [r, h * 0.5], [r * 0.6, h * 0.85]], 7), shade(BARK)));
  const palette = CROWNS[Math.floor(rnd() * CROWNS.length)];
  for (let k = 0; k < 3; k++) {
    const g = blobGeo(haze < 0.4 ? 1 : 0, Math.floor(rnd() * 1000), 0.25, 1.4, noise3);
    const cr = h * (0.22 + rnd() * 0.12);
    const a = rnd() * 6.28;
    const d = k === 0 ? 0 : h * 0.22;
    g.applyMatrix4(matrix(Math.cos(a) * d, h * (0.85 + rnd() * 0.15), Math.sin(a) * d, cr, cr * 0.7, cr));
    parts.push(paint(g, shade(palette[1].clone().lerp(palette[0], 0.35))));
  }
  const geo = merge(parts);
  geo.translate(x, 0, z);
  return geo;
}
