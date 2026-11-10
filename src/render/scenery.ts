/**
 * Everything around the track that you can't drive into: trees, bushes, rocks, flowers
 * and grass, fences and hay bales, houses, grandstands full of spectators, banners and
 * flags, containers and warehouses, the distant mountains and clouds, and the
 * start/finish gantry.
 *
 * All of it is procedural (no model or image files) and placed from the scenery PLAN
 * (`planScenery`), so what you see is exactly what the colliders describe. The shapes
 * themselves live in `render/env/` (props, structures, backdrop, extras); this file
 * decides WHICH shape goes WHERE and merges everything into a handful of meshes.
 *
 * Performance: the world is cut into square cells (see env/batch.ts). Every cell holds a
 * detailed and a cheap version of its contents and only visible cells are drawn, so the
 * draw-call count follows what is on screen, not how big the track is.
 *
 *   batch          material            shadows  notes
 *   nature (LOD)   standard, wind sway cast     trees, bushes, rocks
 *   man-made (LOD) standard            cast     crowd, containers
 *   solid          standard            cast     grandstands, warehouses, fences...
 *   detail (LOD)   standard, wind sway -        grass tufts / flowers; thinned on lower quality
 *   cloth          standard, waving    -        flags and pennants
 *   glow           basic (self-lit)    -        window lights, warning lamps
 *   banners        standard + texture  -        TILT KART banners
 *   backdrop       basic, baked light  -        mountains, hills, skyline (per angular sector)
 *   clouds         basic, baked light  -        hidden on Low
 */
import * as THREE from 'three';
import type { Track, TrackSample } from '../sim/track';
import type { TrackDef } from '../track/types';
import { biomeFor as planBiomeFor, hexToHsl, planScenery, Site, type Biome, type SceneryPlan } from '../track/sceneryPlan';
import { BANNER_LOGO, bannerTexture, checkerTexture, seededRandom } from './textures';
import { ChunkBatch, LodBatch } from './env/batch';
import { ENV_TIME, bannerMaterial, clothMaterial, glowMaterial, propMaterial, watchQuality } from './env/materials';
import { buildPropSet, disposePropSet, type Style, VARIANTS } from './env/props';
import { addBlock, addGrandstand, addHouse, frameM, makeTrackside, type Batches, type StructureLook } from './env/structures';
import { backdropMaterial, cloudGeo, hillGeo, mountainGeo, skylineGeo, type BackdropKind } from './env/backdrop';
import { matrix, merge, paint, scratch } from './env/geo';
import { boxPart, flagGeo, polePart } from './env/parts';
import { addExtras } from './env/extras';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Guess the biome from the theme's grass color (shared with the plan). */
export const biomeFor = planBiomeFor;

export { ENV_TIME };

/** Which visual style a track gets (the plan's biome plus the track's own features). */
export function styleFor(def: TrackDef, biome: Biome): Style {
  if (def.scenery.openSky) return 'sky';
  if ((def.scenery.blocks?.length ?? 0) > 0) return 'harbour';
  if (biome === 'snow' || hexToHsl(def.theme.grass).l > 0.85) return 'alpine';
  if (biome === 'autumn' && hexToHsl(def.theme.grass).l < 0.3) return 'volcanic';
  if (biome === 'desert') return 'desert';
  if (biome === 'autumn') return 'autumn';
  return 'meadow';
}

/** Is it evening or dusk (windows glow)? Dark sky, or a strongly orange horizon. */
export function isDusk(theme: TrackDef['theme']): boolean {
  const sky = hexToHsl(theme.sky);
  const hor = hexToHsl(theme.horizon);
  return sky.l < 0.4 || (hor.s > 0.7 && (hor.h < 0.12 || hor.h > 0.95));
}

const hsl = (h: number, s: number, l: number): THREE.Color => new THREE.Color().setHSL(((h % 1) + 1) % 1, THREE.MathUtils.clamp(s, 0, 1), THREE.MathUtils.clamp(l, 0, 1), THREE.SRGBColorSpace);

function structureLook(style: Style, theme: TrackDef['theme']): StructureLook {
  const pastel = ['#f2e3c6', '#e9c9a4', '#d7e4ef', '#f6d6d6', '#e4efd2'];
  const dusk = isDusk(theme);
  switch (style) {
    case 'alpine':
      return { walls: ['#a8683a', '#8e5a32', '#b07a48'], roof: () => hsl(0.6, 0.1, 0.95), fence: hsl(0.07, 0.35, 0.3), fencePost: hsl(0.07, 0.3, 0.22), snowy: true, dusk, flatRoofs: false };
    case 'volcanic':
      return { walls: ['#6a5a52', '#7a4a3a'], roof: () => hsl(0.02, 0.3, 0.2), fence: hsl(0.03, 0.3, 0.22), fencePost: hsl(0.03, 0.2, 0.15), snowy: false, dusk, flatRoofs: false };
    case 'harbour':
      return { walls: ['#c9ccd2', '#d8cdb8', '#b8c4d0'], roof: () => hsl(0.6, 0.08, 0.4), fence: new THREE.Color('#d8dde4'), fencePost: new THREE.Color('#9aa3b0'), snowy: false, dusk, flatRoofs: true };
    case 'desert':
      return { walls: ['#e6c49a', '#d9ab7a', '#efd8b8', '#c98d62'], roof: (r) => hsl(0.07, 0.35, 0.55 + r() * 0.1), fence: hsl(0.07, 0.35, 0.36), fencePost: hsl(0.07, 0.3, 0.28), snowy: false, dusk, flatRoofs: true };
    case 'autumn':
      return { walls: pastel, roof: (r) => hsl(0.02 + r() * 0.05, 0.5, 0.33), fence: hsl(0.07, 0.35, 0.32), fencePost: hsl(0.07, 0.3, 0.25), snowy: false, dusk, flatRoofs: false };
    default:
      return { walls: pastel, roof: (r) => hsl(0.02 + r() * 0.05, 0.55, 0.38), fence: new THREE.Color('#f2f2ee'), fencePost: new THREE.Color('#e4e4de'), snowy: false, dusk, flatRoofs: false };
  }
}

/** Tint variation so look-alike props are never identical. */
function jitter(rnd: () => number, amount = 0.14): THREE.Color {
  const k = 1 - amount + rnd() * amount * 2;
  return new THREE.Color(k * (0.96 + rnd() * 0.08), k, k * (0.96 + rnd() * 0.08));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build all scenery for a track from its plan (`planScenery`). Add the returned
 * group to the scene once. The plan is shared with the simulation's colliders.
 */
export function buildScenery(track: Track, plan: SceneryPlan = planScenery(track)): THREE.Group {
  const def = track.def;
  const style = styleFor(def, plan.biome);
  // Cosmetics and far-away decoration use their own random stream, so they can
  // never disturb where things stand (that is the plan's job).
  const rnd = seededRandom((def.scenery.seed ^ 0x5bd1e995) >>> 0);
  const site = new Site(track, plan.reserved.slice());
  const look = structureLook(style, def.theme);

  const nature = new LodBatch(80);
  const batches: Batches = {
    solid: new ChunkBatch(90),
    lod: new LodBatch(80),
    glow: new ChunkBatch(90),
    cloth: new ChunkBatch(90),
    banners: new ChunkBatch(90, true),
  };

  // ---- nature props -------------------------------------------------------
  const near = buildPropSet(style, 1);
  const far = buildPropSet(style, 0);
  for (const t of plan.trees) {
    const r = seededRandom(t.seed);
    const v = t.seed % VARIANTS;
    const s = t.scale;
    nature.add(near.trees[t.variant][v], far.trees[t.variant][v], matrix(t.x, t.y, t.z, s, s, s, t.rotationY), jitter(r, 0.13));
  }
  for (const b of plan.bushes) {
    const r = seededRandom(b.seed);
    const v = b.seed % VARIANTS;
    nature.add(near.bushes[v], far.bushes[v], matrix(b.x, b.y, b.z, b.scale, b.scale, b.scale, b.rotationY), jitter(r, 0.16));
  }
  for (const rk of plan.rocks) {
    const r = seededRandom(rk.seed);
    const v = rk.seed % VARIANTS;
    const tint = jitter(r, 0.12);
    nature.add(near.rocks[v], far.rocks[v], matrix(rk.x, rk.y + rk.sy * 0.32, rk.z, rk.sx, rk.sy, rk.sz, rk.rotationY, rk.tilt * 0.6), tint);
    if (rk.twin) {
      const s = rk.scale;
      nature.add(near.rocks[(v + 1) % VARIANTS], far.rocks[(v + 1) % VARIANTS], matrix(rk.x + s * 1.1, plan.heightAt(rk.x + s * 1.1, rk.z + s * 0.3) + s * 0.16, rk.z + s * 0.3, s * 0.5, s * 0.4, s * 0.5, r() * 6.28), tint);
    }
  }

  // ---- ground detail (grass, flowers), thinned on lower quality -------------
  const detail = new LodBatch(80);
  addGroundDetail(site, plan, near, detail, style, rnd, def.scenery.trees);

  // ---- structures ---------------------------------------------------------
  const trackside = makeTrackside(look);
  for (const gs of plan.grandstands) addGrandstand(gs, batches, look);
  for (const hs of plan.houses) addHouse(hs, batches, look);
  for (const bl of plan.blocks) addBlock(bl, batches);
  for (const fe of plan.fences) trackside.fence(fe, batches);
  for (const hb of plan.hayBales) trackside.hay(hb, batches);
  for (const bb of plan.bannerBoards) trackside.banner(bb, batches);

  const group = new THREE.Group();
  group.name = 'scenery';

  // Style-specific extras (cranes, vents, cabins, pylons, balloons...) join the same batches.
  const extraObjects = addExtras({ style, track, plan, site, rnd, batches, theme: def.theme });
  for (const o of extraObjects) group.add(o);

  const natureMat = propMaterial();
  const natureGroup = nature.build(natureMat, 95, true);
  group.add(natureGroup);
  const manGroup = batches.lod.build(natureMat, 85, true);
  group.add(manGroup);
  group.add(batches.solid.build(natureMat, true));

  if (!detail.isEmpty) {
    const dg = detail.build(natureMat, 80, false, 80);
    // Quality hook (scene.ts applySceneQuality): each chunk's near mesh may draw only a fraction of its triangles.
    dg.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const geo = (o as THREE.Mesh).geometry;
        if (geo.getIndex()) o.userData.detailIndexCount = geo.getIndex()!.count;
      }
    });
    group.add(dg);
  }
  if (!batches.cloth.isEmpty) group.add(batches.cloth.build(clothMaterial(), false));
  if (!batches.glow.isEmpty) group.add(batches.glow.build(glowMaterial(), false, false));
  if (!batches.banners.isEmpty) group.add(batches.banners.build(bannerMaterial(bannerTexture()), false));

  group.add(buildBackdrop(site, style, def, rnd));
  // The sky dome now draws its own clouds; only sky-island tracks add low cloud banks under the islands.
  if (style === 'sky') group.add(buildClouds(site, style, def.theme, rnd));

  watchQuality(natureGroup.children[0] ?? group);
  disposePropSet(near);
  disposePropSet(far);
  return group;
}

// ---------------------------------------------------------------------------
// Ground detail
// ---------------------------------------------------------------------------

function addGroundDetail(site: Site, plan: SceneryPlan, set: ReturnType<typeof buildPropSet>, out: LodBatch, style: Style, rnd: () => number, treeCount: number): void {
  const flowerColors: Record<Style, string[]> = {
    meadow: ['#ffffff', '#ffe14d', '#ff7eb6', '#b48cff', '#ff5a4d'],
    sky: ['#ffffff', '#ffe14d', '#ff7eb6', '#b48cff'],
    harbour: ['#ffe14d', '#ffffff'],
    autumn: ['#ffb02e', '#ffe14d', '#e2572b'],
    desert: ['#ff6fa8', '#ffd84a'],
    alpine: [],
    volcanic: [],
  };
  const flowers = flowerColors[style];
  const clusters = Math.round(treeCount * 0.35) + (style === 'sky' ? 30 : 0);
  const items: { geo: THREE.BufferGeometry; m: THREE.Matrix4; c: THREE.Color }[] = [];
  for (let c = 0; c < clusters; c++) {
    const p = site.S[Math.floor(rnd() * site.S.length)];
    const side = rnd() < 0.5 ? -1 : 1;
    const [cx, cz] = site.beside(p, side * (site.outer + 2 + rnd() * 30));
    const radius = 2.5 + rnd() * 4;
    const flowery = flowers.length > 0 && rnd() < 0.5;
    const flowerColor = flowery ? new THREE.Color(flowers[Math.floor(rnd() * flowers.length)]) : new THREE.Color('#ffffff');
    const n = 10 + Math.floor(rnd() * 16);
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * radius;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (site.distToTrack(x, z) < site.outer + 1 || !site.isFree(x, z)) continue;
      const y = plan.heightAt(x, z);
      if (flowery && rnd() < 0.55) {
        const s = 0.9 + rnd() * 0.5;
        items.push({ geo: set.flower, m: matrix(x, y, z, s, s, s, rnd() * 6.28), c: flowerColor });
      } else {
        const s = 0.7 + rnd() * 0.7;
        items.push({ geo: set.tuft, m: matrix(x, y, z, s, s, s, rnd() * 6.28), c: jitter(rnd, 0.18) });
      }
    }
  }
  // Shuffled so that drawing only the first N% of a chunk thins it evenly.
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  for (const it of items) out.add(it.geo, null, it.m, it.c);
}

// ---------------------------------------------------------------------------
// Backdrop and clouds
// ---------------------------------------------------------------------------

function buildBackdrop(site: Site, style: Style, def: TrackDef, rnd: () => number): THREE.Object3D {
  const out = new THREE.Group();
  out.name = 'backdrop';
  if (def.scenery.openSky) return out;
  const horizon = new THREE.Color(def.theme.horizon);
  const kind: BackdropKind = style === 'alpine' ? 'alpine' : style === 'volcanic' ? 'volcanic' : style === 'desert' ? 'desert' : style === 'autumn' ? 'autumn' : style === 'harbour' ? 'harbour' : 'meadow';
  const SECTORS = 8;
  const buckets: THREE.BufferGeometry[][] = Array.from({ length: SECTORS }, () => []);
  const put = (x: number, z: number, g: THREE.BufferGeometry) => {
    const a = (Math.atan2(z - site.cz, x - site.cx) + Math.PI * 2) % (Math.PI * 2);
    buckets[Math.floor((a / (Math.PI * 2)) * SECTORS) % SECTORS].push(g);
  };
  const hill = (base: string, top: string) => ({ base: new THREE.Color(base), top: new THREE.Color(top) });
  const hillCol = {
    alpine: hill('#cfdbe8', '#f4f8fd'),
    volcanic: hill('#2c211f', '#4a3a36'),
    meadow: hill('#3f8a3a', '#7fc050'),
    harbour: hill('#4a6a7a', '#7e9aa8'),
    autumn: hill('#8a5a2a', '#c98a3a'),
    desert: hill('#a8754a', '#d9a672'),
    none: hill('#444', '#888'),
  }[kind];

  // Near ring of soft hills.
  const N = 24;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + rnd() * 0.25;
    const dist = site.radius + 170 + rnd() * 70;
    const s = 55 + rnd() * 60;
    const g = hillGeo(s * 1.5, s * 0.5, i * 3 + 1, hillCol.base, hillCol.top, horizon, 0.22);
    g.applyMatrix4(matrix(site.cx + Math.cos(a) * dist, -1, site.cz + Math.sin(a) * dist, 1, 1, 1, rnd() * 6.28));
    put(site.cx + Math.cos(a) * dist, site.cz + Math.sin(a) * dist, g);
  }

  const rock = {
    alpine: ['#8a98ac', '#4d5a6e'],
    volcanic: ['#6a4a46', '#2a1f20'],
    meadow: ['#7d8a94', '#4a5a63'],
    harbour: ['#7a8ea2', '#56687a'],
    autumn: ['#8a7a78', '#5a4a4a'],
    desert: ['#c98d62', '#8a5a3a'],
    none: ['#888', '#444'],
  }[kind];
  for (const [ring, haze, count] of [
    [0, 0.3, 14],
    [1, 0.5, 18],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const a = ((i + rnd() * 0.6) / count) * Math.PI * 2;
      const dist = site.radius + 380 + ring * 170 + rnd() * 90;
      const x = site.cx + Math.cos(a) * dist;
      const z = site.cz + Math.sin(a) * dist;
      const radius = 110 + rnd() * 100;
      const volcano = kind === 'volcanic' && ring === 0 && i % 4 === 1;
      const height = (ring ? 130 : 85) * (kind === 'harbour' ? 0.6 : 1) + rnd() * 90 + (volcano ? 70 : 0);
      const g = mountainGeo(
        { kind: volcano ? 'volcanic' : kind === 'volcanic' ? 'alpine' : kind, radius, height, seed: i * 7 + ring * 101, haze, horizon, rock: new THREE.Color(rock[0]), rockDark: new THREE.Color(rock[1]) },
        14,
        36,
      );
      if (kind === 'volcanic' && !volcano) {
        // dark ridges: no snow
        const col = g.getAttribute('color') as THREE.BufferAttribute;
        for (let k = 0; k < col.count; k++) {
          scratch.fromBufferAttribute(col, k);
          const l = (scratch.r + scratch.g + scratch.b) / 3;
          scratch.set(l * 0.5 + 0.02, l * 0.4 + 0.02, l * 0.45 + 0.03).lerp(horizon, haze * 0.7);
          col.setXYZ(k, scratch.r, scratch.g, scratch.b);
        }
      }
      g.applyMatrix4(matrix(x, 0, z, 1, 1, 1, rnd() * 6.28));
      put(x, z, g);
    }
  }
  if (kind === 'harbour') {
    const dusk = isDusk(def.theme);
    for (let s = 0; s < 2; s++) {
      const a = (s === 0 ? 0.6 : 3.9) + rnd() * 0.4;
      const dist = site.radius + 330;
      const g = skylineGeo(rnd, 26, 360, horizon, dusk);
      g.applyMatrix4(matrix(site.cx + Math.cos(a) * dist, 0, site.cz + Math.sin(a) * dist, 1, 1, 1, -a + Math.PI / 2));
      put(site.cx + Math.cos(a) * dist, site.cz + Math.sin(a) * dist, g);
    }
  }
  const mat = backdropMaterial(false);
  for (const list of buckets) {
    if (!list.length) continue;
    const mesh = new THREE.Mesh(merge(list), mat);
    mesh.frustumCulled = true;
    out.add(mesh);
  }
  return out;
}

/** Fluffy clouds drifting slowly around the track (hidden on Low). */
function buildClouds(site: Site, style: Style, theme: TrackDef['theme'], rnd: () => number): THREE.Mesh {
  const horizon = new THREE.Color(theme.horizon);
  const sky = new THREE.Color(theme.sky);
  const belly = sky.clone().lerp(horizon, 0.55).lerp(new THREE.Color('#9aa4b8'), 0.25);
  const tint = new THREE.Color('#ffffff').lerp(horizon, style === 'volcanic' ? 0.55 : 0.18);
  const count = 34;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const dist = 250 + rnd() * 650;
    const size = 11 + rnd() * 14;
    const g = cloudGeo(rnd, size, belly, tint);
    // Sky tracks also get low clouds hugging the islands' undersides.
    const low = rnd() < 0.75;
    const y = low ? -40 + rnd() * 25 : 80 + rnd() * 110;
    g.applyMatrix4(matrix(site.cx + Math.cos(a) * dist, y, site.cz + Math.sin(a) * dist, 1, 1, 1, rnd() * 6.28));
    parts.push(g);
  }
  const mesh = new THREE.Mesh(merge(parts), backdropMaterial(false));
  mesh.userData.cloudLayer = true;
  mesh.frustumCulled = false;
  const pivot = new THREE.Vector3(site.cx, 0, site.cz);
  mesh.position.copy(pivot);
  mesh.geometry.translate(-pivot.x, 0, -pivot.z);
  mesh.onBeforeRender = () => {
    mesh.rotation.y = (performance.now() / 1000) * 0.004;
    mesh.updateMatrixWorld();
  };
  return mesh;
}

// ---------------------------------------------------------------------------
// Start / finish gantry
// ---------------------------------------------------------------------------

/**
 * Start/finish gantry across the road at sample `s`: two tapered posts on footings, a
 * checkered beam with "TILT KART" logos on both faces, a lamp row and a waving flag on each post.
 */
export function buildGantry(s: TrackSample, halfSpan: number): THREE.Group {
  const g = new THREE.Group();
  const f = frameM({ x: s.x, y: 0, z: s.z, rotationY: s.heading }); // local x = across the road, z = along it
  const y0 = s.y;
  f.elements[13] = y0;
  const posts = new ChunkBatch(1000);
  const cloth = new ChunkBatch(1000);
  const glow = new ChunkBatch(1000);
  const white = new THREE.Color('#ffffff');
  const metal = new THREE.Color('#dfe3ea');
  const foot = new THREE.Color('#9aa3b0');
  for (const side of [-1, 1]) {
    const x = side * halfSpan;
    const parts = [
      polePart(0, 0, 6.8, 0.27, metal, 10),
      boxPart(0, 0.15, 0, 1.2, 0.3, 1.2, foot),
      boxPart(0, 0.45, 0, 0.8, 0.3, 0.8, foot),
      polePart(0, 0, 9.2, 0.04, white, 4), // flag pole
    ];
    posts.add(merge(parts), f.clone().multiply(matrix(x, 0, 0)), white);
    cloth.add(flagGeo(1.7, 1.0, new THREE.Color(side < 0 ? '#ffd23a' : '#2f7be0'), true), f.clone().multiply(matrix(x, 8.6, 0, 1, 1, 1, side < 0 ? Math.PI : 0)), white);
  }
  // Lamp row under the beam.
  for (let x = -halfSpan + 1.5; x <= halfSpan - 1.4; x += 1.5) glow.add(boxPart(0, 0, 0, 0.35, 0.12, 0.18, new THREE.Color(4, 3.7, 3), 0, 1), f.clone().multiply(matrix(x, 5.42, 0)), white);

  const mat = propMaterial();
  const postMesh = posts.build(mat, true);
  g.add(postMesh);
  g.add(cloth.build(clothMaterial(), false));
  g.add(glow.build(glowMaterial(), false, false));

  const beamTex = checkerTexture();
  beamTex.repeat.set(halfSpan, 1);
  const beam = new THREE.Mesh(new RoundedBoxGeometry(halfSpan * 2 + 0.5, 1.4, 0.4, 2, 0.12), new THREE.MeshStandardMaterial({ map: beamTex, roughness: 0.6 }));
  beam.applyMatrix4(f.clone().multiply(matrix(0, 6.2, 0)));
  beam.castShadow = true;
  g.add(beam);

  // Logo panels on both faces of the beam (karts approach from -z).
  const logos = new ChunkBatch(1000, true);
  const plane = new THREE.PlaneGeometry(1, 1);
  logos.add(plane, f.clone().multiply(matrix(0, 6.2, -0.21, 5.2, 1.3, 1, Math.PI)), white, BANNER_LOGO);
  logos.add(plane, f.clone().multiply(matrix(0, 6.2, 0.21, 5.2, 1.3, 1, 0)), white, BANNER_LOGO);
  g.add(logos.build(bannerMaterial(bannerTexture()), false));
  return g;
}

export { paint };
