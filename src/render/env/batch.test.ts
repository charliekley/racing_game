import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ChunkBatch, ChunkLod, LodBatch, envQuality, shuffleInstances, thinFraction } from './batch';

describe('thinFraction', () => {
  it('draws everything up close, thins smoothly, and never goes below the minimum', () => {
    expect(thinFraction(50)).toBe(1);
    expect(thinFraction(200)).toBe(1);
    const mid = thinFraction(310);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(0.4);
    expect(thinFraction(420)).toBeCloseTo(0.4, 9);
    expect(thinFraction(5000)).toBeCloseTo(0.4, 9);
    // monotonic
    let last = 1;
    for (let d = 0; d < 600; d += 10) {
      expect(thinFraction(d)).toBeLessThanOrEqual(last + 1e-12);
      last = thinFraction(d);
    }
  });
});

describe('shuffleInstances', () => {
  const idx = [0, 1, 2, 10, 11, 12, 20, 21, 22, 30, 31, 32];
  const ends = [3, 6, 9, 12];

  it('keeps every instance whole (a permutation of the triangle groups) and repeats for the same seed', () => {
    const a = shuffleInstances(idx, ends, 123);
    const b = shuffleInstances(idx, ends, 123);
    expect(a).toEqual(b);
    expect(a.idx.length).toBe(idx.length);
    expect([...a.idx].sort((x, y) => x - y)).toEqual([...idx].sort((x, y) => x - y));
    expect(a.ends).toEqual([3, 6, 9, 12]); // equal-sized instances: the ends stay on the same grid
    // each group of 3 is one of the original instances
    for (let i = 0; i < a.idx.length; i += 3) expect(Math.floor(a.idx[i] / 10)).toBe(Math.floor(a.idx[i + 2] / 10));
  });

  it('actually mixes the order for some seed', () => {
    const orders = new Set<string>();
    for (let seed = 1; seed < 20; seed++) orders.add(shuffleInstances(idx, ends, seed).idx.join(','));
    expect(orders.size).toBeGreaterThan(5);
  });
});

describe('ChunkLod far-chunk thinning', () => {
  /** Ten "trees" (one triangle each) in one cell. */
  function forest(): { lod: ChunkLod; far: THREE.Mesh } {
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    tri.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    const batch = new LodBatch(80);
    for (let i = 0; i < 10; i++) batch.add(tri, tri, new THREE.Matrix4().makeTranslation(i, 0, 5), new THREE.Color('#ffffff'));
    const group = batch.build(new THREE.MeshBasicMaterial(), 50, false);
    const lod = group.children[0] as ChunkLod;
    return { lod, far: lod.levels[1].object as THREE.Mesh };
  }
  const cam = (z: number) => {
    const c = new THREE.PerspectiveCamera();
    c.position.set(0, 0, z);
    c.updateMatrixWorld(true);
    return c;
  };

  it('draws fewer instances of a far chunk on Medium/Low, all of them on High', () => {
    const { lod, far } = forest();
    lod.updateMatrixWorld(true);
    const full = far.geometry.getIndex()!.count;
    const before = envQuality.cheap;
    try {
      envQuality.cheap = false;
      lod.update(cam(1000));
      expect(far.geometry.drawRange.count).toBe(full);
      envQuality.cheap = true;
      lod.update(cam(1000));
      expect(far.geometry.drawRange.count).toBe(12); // 40% of 10 instances = 4 triangles = 12 indices
      lod.update(cam(0));
      expect(far.geometry.drawRange.count).toBe(full); // near again: the range is restored
    } finally {
      envQuality.cheap = before;
    }
  });

  it('ChunkBatch records where each instance ends', () => {
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    tri.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    const b = new ChunkBatch(80);
    for (let i = 0; i < 3; i++) b.add(tri, new THREE.Matrix4(), new THREE.Color('#ffffff'));
    const ch = [...b.chunks.values()][0];
    expect(ch.ends).toEqual([3, 6, 9]);
  });
});
