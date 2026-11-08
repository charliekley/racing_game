/**
 * MeshBatch: copies many small shapes into ONE big geometry.
 *
 * Why: every Mesh costs one "draw call" per viewport per frame, and with
 * 4-player split-screen the scene is drawn 4 times. Draw calls (CPU → GPU
 * commands) are usually the bottleneck in browser games, not triangles.
 * So instead of 600 tree meshes we bake all trees, rocks, bushes, houses…
 * into a single geometry with a per-vertex color, and draw it with one
 * material in one call.
 *
 * Usage:
 *   const batch = new MeshBatch();
 *   batch.add(coneGeometry, matrix, color);   // as many times as you like
 *   const mesh = batch.build(material);      // material needs vertexColors: true
 *
 * The source geometries are only read; dispose them yourself afterwards.
 * Avoid negative scales in `matrix` (a mirror flips triangle winding).
 */
import * as THREE from 'three';

/** Part of a texture to use for an added shape (UVs are scaled into this rectangle). */
export interface UvRect {
  u: number;
  v: number;
  w: number;
  h: number;
}

export class MeshBatch {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private uvs: number[] = [];
  private indices: number[] = [];
  private vertexCount = 0;
  private readonly normalMatrix = new THREE.Matrix3();
  private readonly v = new THREE.Vector3();

  /** @param withUv also copy texture coordinates (for textured batches like banners). */
  constructor(private readonly withUv = false) {}

  /** Number of index entries so far (3 per triangle). */
  get indexCount(): number {
    return this.indices.length;
  }

  get isEmpty(): boolean {
    return this.vertexCount === 0;
  }

  /** Append `geo`, transformed by `matrix` and painted `color`. */
  add(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.Color, uvRect?: UvRect): void {
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    this.normalMatrix.getNormalMatrix(matrix);
    const base = this.vertexCount;
    for (let i = 0; i < pos.count; i++) {
      this.v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      this.positions.push(this.v.x, this.v.y, this.v.z);
      if (nor) this.v.fromBufferAttribute(nor, i).applyMatrix3(this.normalMatrix).normalize();
      else this.v.set(0, 1, 0);
      this.normals.push(this.v.x, this.v.y, this.v.z);
      this.colors.push(color.r, color.g, color.b);
      if (this.withUv) {
        const r = uvRect ?? { u: 0, v: 0, w: 1, h: 1 };
        this.uvs.push(r.u + (uv ? uv.getX(i) : 0) * r.w, r.v + (uv ? uv.getY(i) : 0) * r.h);
      }
    }
    const index = geo.getIndex();
    if (index) for (let i = 0; i < index.count; i++) this.indices.push(base + index.getX(i));
    else for (let i = 0; i < pos.count; i++) this.indices.push(base + i);
    this.vertexCount += pos.count;
  }

  /** Create the final mesh. The arrays are released afterwards; the batch can't be reused. */
  build(material: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    if (this.withUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setIndex(this.indices); // picks 32-bit indices automatically when needed
    g.computeBoundingSphere();
    this.positions = this.normals = this.colors = this.uvs = this.indices = [];
    return new THREE.Mesh(g, material);
  }
}
