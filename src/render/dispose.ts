/**
 * Free the GPU memory (vertex buffers, materials, textures) of everything in
 * a Three.js object tree. WebGL resources aren't garbage-collected like normal
 * JS objects, so meshes we throw away must be disposed explicitly.
 */
import * as THREE from 'three';

export function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
}
