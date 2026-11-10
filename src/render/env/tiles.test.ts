import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { tileMesh } from './tiles';

describe('tileMesh', () => {
  it('splits an indexed grid into tiles that keep every triangle and have tight bounds', () => {
    const geo = new THREE.PlaneGeometry(400, 400, 40, 40).rotateX(-Math.PI / 2);
    const total = geo.getIndex()!.count / 3;
    const tiles = tileMesh(geo, new THREE.MeshBasicMaterial(), 100);
    expect(tiles.length).toBeGreaterThanOrEqual(16);
    expect(tiles.reduce((n, m) => n + m.geometry.getIndex()!.count / 3, 0)).toBe(total);
    for (const m of tiles) {
      // Each tile's bounding sphere covers about its own 100 m square, not the whole mesh.
      expect(m.geometry.boundingSphere!.radius).toBeLessThan(150);
      // Tiles share the original vertex buffer instead of copying it.
      expect(m.geometry.getAttribute('position')).toBe(geo.getAttribute('position'));
    }
  });
});
