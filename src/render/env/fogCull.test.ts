import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ChunkLod } from './batch';
import { FogCuller } from './fogCull';

/** A static chunk mesh (like ChunkBatch.meshFor makes) with a 10 m radius, centred at (x, 0, z). */
function chunk(x: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(10, 4, 3), new THREE.MeshBasicMaterial());
  m.position.set(x, 0, z);
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

describe('FogCuller', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000); // at the origin, looking down -Z by default
  camera.lookAt(0, 0, 1000); // look along +Z

  it('hides chunks completely beyond the fog and keeps the others', () => {
    const root = new THREE.Group();
    const near = chunk(0, 300);
    const edge = chunk(0, 705); // its nearest point (695) is still inside the fog distance
    const far = chunk(0, 900);
    const behind = chunk(0, -900); // behind the camera: negative depth, never "beyond the fog"
    root.add(near, edge, far, behind);
    const culler = new FogCuller(root);
    culler.cull(camera, 700);
    expect(near.visible).toBe(true);
    expect(edge.visible).toBe(true);
    expect(far.visible).toBe(false);
    expect(behind.visible).toBe(true);
    culler.showAll();
    expect(far.visible).toBe(true);
  });

  it('uses the depth along the view direction, not the straight-line distance', () => {
    const root = new THREE.Group();
    // 750 m away in a straight line, but mostly to the side: only about 400 m deep, so the fog is not complete there.
    const side = chunk(630, 400);
    root.add(side);
    new FogCuller(root).cull(camera, 700);
    expect(side.visible).toBe(true);
  });

  it('switches chunk level-of-detail objects as a whole and leaves animated objects alone', () => {
    const root = new THREE.Group();
    const nearMesh = new THREE.Mesh(new THREE.SphereGeometry(10, 4, 3), new THREE.MeshBasicMaterial());
    const lod = new ChunkLod(nearMesh, null, 90);
    lod.position.set(0, 0, 1200);
    lod.updateMatrix();
    lod.matrixAutoUpdate = false;
    const animated = new THREE.Mesh(new THREE.SphereGeometry(10, 4, 3), new THREE.MeshBasicMaterial());
    animated.position.set(0, 0, 1500); // matrixAutoUpdate stays true: not ours to hide
    root.add(lod, animated);
    new FogCuller(root).cull(camera, 700);
    expect(lod.visible).toBe(false);
    expect(animated.visible).toBe(true);
  });
});
