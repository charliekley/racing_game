import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ItemEntity } from '../sim/items/types';
import {
  ItemMeshPool,
  animateItemBox,
  buildEntityMesh,
  buildHeldItemMesh,
  buildItemBox,
  buildNovaAura,
  updateEntityMesh,
} from './itemMeshes';

const meshCount = (o: THREE.Object3D) => {
  let n = 0;
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh || (c as THREE.Points).isPoints) n++;
  });
  return n;
};

const ent = (uid: number, over: Partial<ItemEntity> = {}): ItemEntity => ({
  uid,
  kind: 'ricochet',
  x: 1,
  y: 2,
  z: 3,
  heading: 0.5,
  owner: 0,
  trailing: false,
  ...over,
});

describe('item meshes', () => {
  it('builds the item box within the draw call budget and animates it', () => {
    const box = buildItemBox();
    expect(meshCount(box)).toBeLessThanOrEqual(3);
    animateItemBox(box, 0, 0);
    const y0 = box.getObjectByName('pivot')!.position.y;
    animateItemBox(box, 0.5, 2);
    expect(box.getObjectByName('pivot')!.position.y).not.toBe(y0);
  });

  it('builds every entity kind and held mesh', () => {
    for (const k of ['slick', 'ricochet', 'seeker'] as const) {
      expect(meshCount(buildEntityMesh(k))).toBeGreaterThan(0);
      expect(buildHeldItemMesh(k)).not.toBeNull();
    }
    expect(buildHeldItemMesh('dash')).toBeNull();
    expect(buildHeldItemMesh('nova')).toBeNull();
  });

  it('lifts a dragged slick off the road', () => {
    const m = buildEntityMesh('slick');
    updateEntityMesh(m, ent(1, { kind: 'slick' }), 1);
    const flat = m.getObjectByName('body')!.position.y;
    updateEntityMesh(m, ent(1, { kind: 'slick', trailing: true }), 1);
    expect(m.getObjectByName('body')!.position.y).toBeGreaterThan(flat);
  });

  it('pool adds, moves and removes meshes', () => {
    const scene = new THREE.Scene();
    const pool = new ItemMeshPool(scene);
    pool.update([ent(7)], 0);
    expect(scene.children.length).toBe(1);
    const mesh = scene.children[0];
    expect(mesh.position.toArray()).toEqual([1, 2, 3]);
    pool.update([ent(7, { x: 9 })], 0.1);
    expect(scene.children[0]).toBe(mesh);
    expect(mesh.position.x).toBe(9);
    pool.update([], 0.2);
    expect(scene.children.length).toBe(0);
    expect(pool.size).toBe(0);
  });

  it('nova aura toggles visibility', () => {
    const aura = buildNovaAura();
    aura.update(0, false);
    expect(aura.object.visible).toBe(false);
    aura.update(1, true);
    expect(aura.object.visible).toBe(true);
    aura.dispose();
  });
});
