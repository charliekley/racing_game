import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CHARACTERS, paletteFor } from '../shared/characters';
import { KART_STYLES, buildKartModel, kartTriangleCount } from './kartModel';
import { TARGET_COUNT } from './kart/expression';

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

  it('lean shadows (3-4 viewports) cast fewer parts than full detail, and switching back restores them', () => {
    const m = buildKartModel('#e63946', 0);
    const casters = () => {
      let n = 0;
      m.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.visible && mesh.castShadow) n++;
      });
      return n;
    };
    const full = casters(); // tier 0, every part
    m.setLod(0, true);
    const lean = casters();
    expect(lean).toBeLessThan(full);
    expect(lean).toBeGreaterThan(0);
    m.setLod(0, false);
    expect(casters()).toBe(full);
  });

  it('wraps out-of-range style indices', () => {
    expect(buildKartModel('#fff', KART_STYLES.length).style).toBe(0);
    expect(buildKartModel('#fff', -1).style).toBe(KART_STYLES.length - 1);
  });
});

describe('driver faces', () => {
  const visibleMeshes = (m: ReturnType<typeof buildKartModel>) => {
    let n = 0;
    m.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.visible && mesh.geometry.getAttribute('position')?.count) n++;
    });
    return n;
  };

  it('every driver has a chunky head and one morph target per face pose (and no extra draw calls)', () => {
    for (let c = 0; c < CHARACTERS.length; c++) {
      const m = buildKartModel('#3a86ff', 0, c);
      expect(m.head.scale.x).toBeGreaterThan(1.15); // noticeably bigger than the plain model
      expect(m.faceInfluences).toHaveLength(TARGET_COUNT);
      const head = m.head.children[0] as THREE.Mesh;
      expect(head.geometry.morphAttributes.position).toHaveLength(TARGET_COUNT);
      expect(head.geometry.morphAttributes.position![0].count).toBe(head.geometry.getAttribute('position').count);
      expect(countMeshes(m.root)).toBeLessThanOrEqual(13); // same budget as before the faces
    }
  });

  it('keeps morph targets on the reduced tier and the same visible mesh counts per tier', () => {
    const m = buildKartModel('#3a86ff', 0, 1);
    m.bakeFarModel();
    const head = m.head.children[0] as THREE.Mesh;
    m.setLod(1);
    expect(head.geometry.morphAttributes.position).toHaveLength(TARGET_COUNT);
    const mid = visibleMeshes(m);
    m.setLod(0);
    const full = visibleMeshes(m);
    m.setLod(2);
    const far = visibleMeshes(m);
    expect(full).toBeLessThanOrEqual(13);
    expect(mid).toBeLessThanOrEqual(13);
    // Far tier: paint + accent + ONE merged mesh holding wheels, driver, head (frozen neutral face).
    expect(far).toBeLessThanOrEqual(4);
    expect(far).toBeLessThan(mid);
  });

  it('the far tier of all 32 character x body combos still merges to 3 draw calls (paint, accent, one merged detail mesh)', () => {
    for (let style = 0; style < KART_STYLES.length; style++) {
      for (let c = 0; c < CHARACTERS.length; c++) {
        const m = buildKartModel('#3a86ff', style, c, 'mid', paletteFor(c));
        m.bakeFarModel();
        m.setLod(2);
        expect(visibleMeshes(m), `${KART_STYLES[style].id} / ${CHARACTERS[c].name}`).toBeLessThanOrEqual(3);
        // The merged mesh really holds the driver: a bigger head or tail must not drop out of it.
        const far = m.body.children.find((o) => o.name === 'kart-far') as THREE.Mesh;
        expect(far, `${KART_STYLES[style].id} / ${CHARACTERS[c].name} has a merged far mesh`).toBeTruthy();
        expect(far.visible).toBe(true);
        expect(far.geometry.getAttribute('position').count).toBeGreaterThan(1000);
      }
    }
  });

  it('the face poses all keep the vertex count (a mismatch would throw while building)', () => {
    for (let c = 0; c < CHARACTERS.length; c++) {
      for (const d of ['high', 'mid', 'low', 'far'] as const) expect(() => buildKartModel('#fff', 0, c, d)).not.toThrow();
    }
  });
});
