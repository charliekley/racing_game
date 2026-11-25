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
  buildRocketShell,
  buildStormCloud,
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
    for (const k of ['slick', 'ricochet', 'seeker', 'hunter', 'decoy'] as const) {
      expect(meshCount(buildEntityMesh(k))).toBeGreaterThan(0);
      if (k !== 'decoy') expect(buildHeldItemMesh(k)).not.toBeNull(); // (a dragged decoy is a world entity, like the peel)
    }
    expect(buildHeldItemMesh('dash')).toBeNull();
    expect(buildHeldItemMesh('nova')).toBeNull();
  });

  it('the rocket shell is hidden until the kart is a rocket, grows in, and pops away again after it ends', () => {
    const shell = buildRocketShell();
    shell.update(1 / 60, 0, false, 0);
    expect(shell.object.visible).toBe(false);
    for (let i = 0; i < 30; i++) shell.update(1 / 60, i / 60, true, 5);
    expect(shell.object.visible).toBe(true);
    expect(meshCount(shell.object)).toBeLessThanOrEqual(12);
    for (let i = 0; i < 60; i++) shell.update(1 / 60, 1 + i / 60, false, 0);
    expect(shell.object.visible).toBe(false);
  });

  it('the storm cloud shows only while the strike lasts, with the bolt in the middle of it', () => {
    const cloud = buildStormCloud();
    cloud.update(1 / 60, 1, 2, 3, 0, 1.1);
    expect(cloud.object.visible).toBe(false);
    cloud.update(1 / 60, 1, 2, 3, 1.1 - 0.3, 1.1); // 0.3 s after the strike
    expect(cloud.object.visible).toBe(true);
    expect(cloud.object.position.toArray()).toEqual([1, 2, 3]); // over the kart, in world coordinates
    expect(meshCount(cloud.object)).toBeLessThanOrEqual(9);
    cloud.update(1 / 60, 1, 2, 3, 0.05, 1.1); // fading away at the end
    expect(cloud.object.visible).toBe(true);
    cloud.update(1 / 60, 1, 2, 3, 0, 1.1);
    expect(cloud.object.visible).toBe(false);
    cloud.dispose();
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
