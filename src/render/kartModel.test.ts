import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CHARACTERS } from '../shared/characters';
import { KART_STYLES, buildKartModel, kartTriangleCount } from './kartModel';

function countMeshes(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) n++;
  });
  return n;
}

describe('buildKartModel', () => {
  KART_STYLES.forEach((s, i) => {
    it(`builds style ${s.name} with the expected parts`, () => {
      const m = buildKartModel('#e63946', i);
      expect(m.style).toBe(i);
      expect(m.wheels).toHaveLength(4);
      expect(m.wheelRadii).toHaveLength(4);
      expect(m.frontPivots).toHaveLength(2);
      expect(m.rearWheelContacts).toHaveLength(2);
      expect(m.exhausts.length).toBeGreaterThan(0);
      for (const e of m.exhausts) expect(e.parent).toBe(m.body);
      // Draw-call budget: about 12 meshes per kart (3 body + 4 wheels + steering wheel + torso, head, 2 arms).
      expect(countMeshes(m.root)).toBeLessThanOrEqual(13);
      // Triangle budget: 15k to 25k is the target; stay under 40k even for the heaviest.
      expect(kartTriangleCount(i, 0, 'high')).toBeLessThan(40000);
      expect(kartTriangleCount(i, 0, 'low')).toBeLessThan(kartTriangleCount(i, 0, 'high'));
      // Rough size check: about 1.9 m long, sits on the ground.
      const box = new THREE.Box3().setFromObject(m.root);
      expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
      expect(box.max.z - box.min.z).toBeGreaterThan(1.7);
      expect(box.max.z - box.min.z).toBeLessThan(2.6);
    });
  });

  it('builds all eight drivers on every body, with a rig', () => {
    for (let s = 0; s < KART_STYLES.length; s++) {
      for (let c = 0; c < CHARACTERS.length; c++) {
        const m = buildKartModel('#3a86ff', s, c);
        expect(m.character).toBe(c);
        expect(m.arms).toHaveLength(2);
        expect(m.head.parent).toBe(m.torso);
        expect(m.driver.parent).toBe(m.body);
        expect(m.driver.scale.x).toBeCloseTo(CHARACTERS[c].look.scale);
        expect(countMeshes(m.root)).toBeLessThanOrEqual(13);
        // No NaN in any geometry.
        m.root.traverse((o) => {
          const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
          if (g) expect(Number.isFinite(g.boundingSphere?.radius ?? g.computeBoundingSphere() ?? 1)).toBe(true);
        });
      }
    }
  });

  it('shares geometry between karts of the same style', () => {
    const a = buildKartModel('#e63946', 1);
    const b = buildKartModel('#3a86ff', 1);
    expect(a.wheels[0].geometry).toBe(b.wheels[0].geometry);
    expect((a.body.children[0] as THREE.Mesh).geometry).toBe((b.body.children[0] as THREE.Mesh).geometry);
  });

  it('wraps out-of-range style indices', () => {
    expect(buildKartModel('#fff', KART_STYLES.length).style).toBe(0);
    expect(buildKartModel('#fff', -1).style).toBe(KART_STYLES.length - 1);
  });
});
