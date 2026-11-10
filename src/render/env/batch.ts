/**
 * Chunked batching with levels of detail.
 *
 * Why chunks? Merging ALL trees into one mesh means one draw call, but the GPU then
 * processes every vertex of every tree each frame, even the ones behind you. We cut the
 * world into square cells (default 90 m) and merge per cell: each cell is its own small
 * mesh that Three.js can skip entirely when it is outside the camera view ("frustum
 * culling"). Draw calls stay low (only visible cells are drawn) and so do triangles.
 *
 * Why LOD? A tree 300 m away covers a handful of pixels, so it does not need 1500
 * triangles. Each cell holds a detailed mesh and a cheap mesh; `ChunkLod` shows the
 * detailed one only when the camera is close.
 *
 * Source geometries must have position, normal, color and sway attributes (see geo.ts).
 */
import * as THREE from 'three';

/**
 * Shared quality hints.
 *  low: set by env meshes from the renderer (shadows off = the Low preset).
 *  lod: multiplier on every scenery level-of-detail distance. The game sets it from the preset
 *       and the number of split-screen viewports (a quarter-size view needs less detail).
 */
export const envQuality = { low: false, lod: 1 };

interface Chunk {
  ix: number;
  iz: number;
  pos: number[];
  nor: number[];
  col: number[];
  sway: number[];
  uv: number[];
  idx: number[];
  count: number;
}

const _v = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _c = new THREE.Color();
const _cam = new THREE.Vector3();

export class ChunkBatch {
  readonly chunks = new Map<string, Chunk>();

  constructor(
    readonly cell = 90,
    private readonly withUv = false,
  ) {}

  get isEmpty(): boolean {
    return this.chunks.size === 0;
  }

  /** Total triangles queued (for stats). */
  get triangles(): number {
    let n = 0;
    for (const c of this.chunks.values()) n += c.idx.length / 3;
    return n;
  }

  private chunkFor(x: number, z: number): Chunk {
    const ix = Math.floor(x / this.cell);
    const iz = Math.floor(z / this.cell);
    const key = `${ix},${iz}`;
    let c = this.chunks.get(key);
    if (!c) {
      c = { ix, iz, pos: [], nor: [], col: [], sway: [], uv: [], idx: [], count: 0 };
      this.chunks.set(key, c);
    }
    return c;
  }

  /** Append `geo` transformed by `m`, colours multiplied by `tint`. The chunk is picked by the matrix position. */
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, tint: THREE.Color, uvRect?: { u: number; v: number; w: number; h: number }): void {
    const e = m.elements;
    const ch = this.chunkFor(e[12], e[14]);
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const colA = geo.getAttribute('color');
    const swayA = geo.getAttribute('sway');
    const uv = geo.getAttribute('uv');
    _nm.getNormalMatrix(m);
    const cx = (ch.ix + 0.5) * this.cell;
    const cz = (ch.iz + 0.5) * this.cell;
    const base = ch.count;
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(m);
      ch.pos.push(_v.x - cx, _v.y, _v.z - cz);
      _v.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize();
      ch.nor.push(_v.x, _v.y, _v.z);
      if (colA) _c.fromBufferAttribute(colA as THREE.BufferAttribute, i).multiply(tint);
      else _c.copy(tint);
      ch.col.push(_c.r, _c.g, _c.b);
      ch.sway.push(swayA ? swayA.getX(i) : 0);
      if (this.withUv) {
        const r = uvRect ?? { u: 0, v: 0, w: 1, h: 1 };
        ch.uv.push(r.u + (uv ? uv.getX(i) : 0) * r.w, r.v + (uv ? uv.getY(i) : 0) * r.h);
      }
    }
    const index = geo.getIndex();
    if (index) for (let i = 0; i < index.count; i++) ch.idx.push(base + index.getX(i));
    else for (let i = 0; i < pos.count; i++) ch.idx.push(base + i);
    ch.count += pos.count;
  }

  /** Make one mesh for a chunk (positioned at the cell centre). */
  meshFor(ch: Chunk, material: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(ch.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(ch.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(ch.col, 3));
    g.setAttribute('sway', new THREE.Float32BufferAttribute(ch.sway, 1));
    if (this.withUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(ch.uv, 2));
    g.setIndex(ch.idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.position.set((ch.ix + 0.5) * this.cell, 0, (ch.iz + 0.5) * this.cell);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }

  /** One mesh per chunk, in a group (no LOD). */
  build(material: THREE.Material, castShadow: boolean, receiveShadow = true): THREE.Group {
    const group = new THREE.Group();
    for (const ch of this.chunks.values()) {
      const m = this.meshFor(ch, material);
      m.castShadow = castShadow;
      m.receiveShadow = receiveShadow;
      group.add(m);
    }
    this.chunks.clear();
    return group;
  }
}

/**
 * A level-of-detail switch for one chunk: `near` is drawn within `distance` of the camera,
 * `far` (may be empty) beyond it. Works per camera, so each split-screen viewport picks
 * its own level.
 */
export class ChunkLod extends THREE.LOD {
  constructor(
    near: THREE.Object3D,
    far: THREE.Object3D | null,
    private readonly switchDistance: number,
    private readonly cullDistance = Infinity,
  ) {
    super();
    this.addLevel(near, 0);
    this.addLevel(far ?? new THREE.Object3D(), switchDistance);
    this.autoUpdate = true;
  }

  override update(camera: THREE.Camera): void {
    const scale = envQuality.lod;
    const d = _v.setFromMatrixPosition(this.matrixWorld).distanceTo(_cam.setFromMatrixPosition(camera.matrixWorld)) / ((camera as THREE.PerspectiveCamera).zoom || 1);
    const useNear = d < this.switchDistance * scale;
    const [near, far] = [this.levels[0].object, this.levels[1].object];
    near.visible = useNear;
    far.visible = !useNear && d < this.cullDistance;
  }
}

/** Two batches (detailed + cheap) placed together; `build` returns chunk LODs. */
export class LodBatch {
  readonly near: ChunkBatch;
  readonly far: ChunkBatch;

  constructor(cell = 90, withUv = false) {
    this.near = new ChunkBatch(cell, withUv);
    this.far = new ChunkBatch(cell, withUv);
  }

  add(nearGeo: THREE.BufferGeometry, farGeo: THREE.BufferGeometry | null, m: THREE.Matrix4, tint: THREE.Color): void {
    this.near.add(nearGeo, m, tint);
    if (farGeo) this.far.add(farGeo, m, tint);
  }

  get isEmpty(): boolean {
    return this.near.isEmpty;
  }

  get triangles(): number {
    return this.near.triangles;
  }

  build(material: THREE.Material, switchDistance: number, castShadow: boolean, cullDistance = Infinity): THREE.Group {
    const group = new THREE.Group();
    for (const [key, ch] of this.near.chunks) {
      const nearMesh = this.near.meshFor(ch, material);
      nearMesh.castShadow = castShadow;
      nearMesh.receiveShadow = true;
      const farCh = this.far.chunks.get(key);
      let farMesh: THREE.Mesh | null = null;
      if (farCh) {
        farMesh = this.far.meshFor(farCh, material);
        farMesh.castShadow = castShadow;
        farMesh.receiveShadow = true;
      }
      // The LOD object sits at the chunk centre; its children are positioned relative to the parent, so zero them.
      const lod = new ChunkLod(nearMesh, farMesh, switchDistance, cullDistance);
      lod.position.copy(nearMesh.position);
      nearMesh.position.set(0, 0, 0);
      nearMesh.updateMatrix();
      if (farMesh) {
        farMesh.position.set(0, 0, 0);
        farMesh.updateMatrix();
      }
      lod.updateMatrix();
      lod.matrixAutoUpdate = false;
      group.add(lod);
    }
    this.near.chunks.clear();
    this.far.chunks.clear();
    return group;
  }
}
