/**
 * Cut one big indexed mesh into square tiles so the GPU can skip the tiles you cannot see.
 *
 * Why: a single huge terrain mesh always intersects the camera's view, so Three.js draws ALL
 * of its triangles every frame (for every split-screen viewport and every shadow pass), even the
 * ones miles behind you. Tiles are separate meshes with their own bounding spheres, so the
 * "frustum culling" step drops the ones outside the view, and `maxDistance` drops far ones.
 *
 * All tiles SHARE the original vertex buffers (position, normal, colour...). Only the index
 * list (which vertices form which triangle) is split, so this costs almost no extra memory.
 */
import * as THREE from 'three';

/**
 * Split `geometry` (must be indexed) into tiles of `tile` metres in the x/z plane, grouping every
 * triangle by its centre. Returns one Mesh per non-empty tile; they all use `material`.
 */
export function tileMesh(geometry: THREE.BufferGeometry, material: THREE.Material, tile: number): THREE.Mesh[] {
  const index = geometry.getIndex();
  const pos = geometry.getAttribute('position');
  if (!index) return [new THREE.Mesh(geometry, material)];

  const buckets = new Map<string, number[]>();
  for (let i = 0; i + 2 < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    const key = `${Math.floor(cx / tile)},${Math.floor(cz / tile)}`;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(a, b, c);
  }

  const meshes: THREE.Mesh[] = [];
  for (const list of buckets.values()) {
    const g = new THREE.BufferGeometry();
    for (const name of Object.keys(geometry.attributes)) g.setAttribute(name, geometry.attributes[name]); // shared buffers
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(list), 1));
    // computeBoundingSphere() would look at every vertex of the shared buffer; measure only the vertices this tile uses.
    const box = new THREE.Box3().makeEmpty();
    const v = new THREE.Vector3();
    for (let i = 0; i < list.length; i++) box.expandByPoint(v.fromBufferAttribute(pos, list[i]));
    g.boundingBox = box;
    g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    meshes.push(new THREE.Mesh(g, material));
  }
  return meshes;
}

/** Group of tiles (see `tileMesh`); `shadows` copies the cast/receive flags onto every tile. */
export function tiledGroup(geometry: THREE.BufferGeometry, material: THREE.Material, tile: number, cast: boolean, receive: boolean): THREE.Group {
  const group = new THREE.Group();
  for (const m of tileMesh(geometry, material, tile)) {
    m.castShadow = cast;
    m.receiveShadow = receive;
    group.add(m);
  }
  return group;
}
