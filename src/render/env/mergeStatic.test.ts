import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mergeStaticMeshes } from './mergeStatic';

/** A flat strip `len` metres long (position, normal, uv, index), like a road ribbon. */
function strip(len: number, x = 0): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(4, len, 1, 1).rotateX(-Math.PI / 2).translate(x, 0, 0);
}

describe('mergeStaticMeshes', () => {
  it('merges big meshes that share a material into one', () => {
    const parent = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial();
    for (let i = 0; i < 3; i++) parent.add(new THREE.Mesh(strip(200, i * 10), mat));
    const removed = mergeStaticMeshes(parent, 40);
    expect(removed).toBe(2);
    expect(parent.children.length).toBe(1);
    const merged = parent.children[0] as THREE.Mesh;
    expect(merged.geometry.getIndex()!.count).toBe(3 * 6); // all triangles kept
  });

  it('keeps meshes with different materials or different shadow flags apart', () => {
    const parent = new THREE.Group();
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    parent.add(new THREE.Mesh(strip(200), a), new THREE.Mesh(strip(200, 10), b));
    const c = new THREE.Mesh(strip(200, 20), a);
    c.castShadow = true;
    parent.add(c);
    expect(mergeStaticMeshes(parent, 40)).toBe(0);
    expect(parent.children.length).toBe(3);
  });

  it('leaves small meshes alone (they stay cullable) and ignores groups', () => {
    const parent = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial();
    parent.add(new THREE.Mesh(strip(4), mat), new THREE.Mesh(strip(4, 50), mat), new THREE.Group());
    expect(mergeStaticMeshes(parent, 40)).toBe(0);
    expect(parent.children.length).toBe(3);
  });
});
