import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { KART_STYLES, buildKartModel } from './kartModel';

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
      // Draw-call budget: at most 10 meshes per kart.
      expect(countMeshes(m.root)).toBeLessThanOrEqual(10);
      // Rough size check: about 1.9 m long, sits on the ground.
      const box = new THREE.Box3().setFromObject(m.root);
      expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
      expect(box.max.z - box.min.z).toBeGreaterThan(1.7);
      expect(box.max.z - box.min.z).toBeLessThan(2.6);
    });
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
