/**
 * Merge static meshes that share a material into one mesh (one draw call instead of many).
 *
 * The road is built as separate "ribbons" (one per stretch between water gaps or bridges, one per kerb
 * side, ...). They all use a handful of materials, and the big ones are always inside every camera's
 * view anyway, so culling them separately gains nothing while every extra mesh costs a draw call per
 * viewport and per shadow pass. Only meshes that are BIG (bounding radius above `minRadius`) are merged;
 * small ones keep their own bounds so they can still be skipped when far from the camera.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Which attributes a geometry has, as one string: only geometries with the same set can be merged. */
function layoutKey(g: THREE.BufferGeometry): string {
  return Object.keys(g.attributes).sort().join(',') + (g.index ? '|i' : '|n') + (g.groups.length ? '|g' : '');
}

/**
 * Merge the direct children of `parent` that are plain big meshes with the same material and flags.
 * Returns how many meshes were removed (merged away).
 */
export function mergeStaticMeshes(parent: THREE.Object3D, minRadius = 40): number {
  const buckets = new Map<string, THREE.Mesh[]>();
  for (const child of parent.children) {
    const m = child as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) continue;
    if (!m.matrix.equals(new THREE.Matrix4()) || m.children.length > 0) continue; // geometry must already be in parent space
    const geo = m.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    if (geo.boundingSphere!.radius < minRadius) continue;
    const key = [m.material.uuid, layoutKey(geo), m.castShadow, m.receiveShadow, m.renderOrder, m.visible, m.frustumCulled].join('/');
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(m);
  }
  let removed = 0;
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const merged = mergeGeometries(list.map((m) => m.geometry), false);
    if (!merged) continue;
    const first = list[0];
    const out = new THREE.Mesh(merged, first.material);
    out.name = first.name;
    out.castShadow = first.castShadow;
    out.receiveShadow = first.receiveShadow;
    out.renderOrder = first.renderOrder;
    parent.add(out);
    for (const m of list) {
      parent.remove(m);
      m.geometry.dispose();
    }
    removed += list.length - 1;
  }
  return removed;
}
