/**
 * Fog culling: skip static scenery that is completely hidden by the fog.
 *
 * Past the fog's far distance the fog is 100% opaque: a tree or a rock chunk there would only paint the
 * fog colour (the same colour as the sky at the horizon). Three.js still draws it if it is inside the
 * camera's view frustum (the far plane is 2000 m), which costs draw calls and triangles for nothing.
 *
 * Before each viewport is drawn, `cull(camera, fogFar)` hides the chunks that lie entirely beyond the fog.
 * Three.js fog uses the DEPTH along the view direction (not the straight-line distance), so we use the
 * same depth: a chunk far to the side is not skipped unless it is outside the picture anyway.
 *
 * Only objects that never move are handled: chunk level-of-detail switches (`ChunkLod`) and meshes that
 * opted out of matrix updates (the chunk meshes). Anything animated is left alone.
 */
import * as THREE from 'three';
import { ChunkLod } from './batch';

interface Entry {
  object: THREE.Object3D;
  cx: number;
  cy: number;
  cz: number;
  r: number;
}

export class FogCuller {
  private entries: Entry[] | null = null;
  private readonly fwd = new THREE.Vector3();
  private readonly sphere = new THREE.Sphere();

  constructor(private readonly root: THREE.Object3D) {}

  /** Find the cullable objects (first use only: world matrices must be up to date by then). */
  private collect(): Entry[] {
    const out: Entry[] = [];
    this.root.updateWorldMatrix(true, true);
    const add = (object: THREE.Object3D, mesh: THREE.Mesh) => {
      const geo = mesh.geometry;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      this.sphere.copy(geo.boundingSphere!).applyMatrix4(object.matrixWorld);
      out.push({ object, cx: this.sphere.center.x, cy: this.sphere.center.y, cz: this.sphere.center.z, r: this.sphere.radius });
    };
    this.root.traverse((o) => {
      if (o instanceof ChunkLod) {
        const near = o.levels[0].object as THREE.Mesh;
        if (near.isMesh) add(o, near);
      } else if ((o as THREE.Mesh).isMesh && !o.matrixAutoUpdate && !(o.parent instanceof ChunkLod)) {
        add(o, o as THREE.Mesh);
      }
    });
    return out;
  }

  /** Hide every collected object that lies completely beyond `fogFar` (metres of view depth) for `camera`. */
  cull(camera: THREE.Camera, fogFar: number): void {
    this.entries ??= this.collect();
    const f = camera.getWorldDirection(this.fwd);
    const p = camera.position;
    for (const e of this.entries) {
      const depth = (e.cx - p.x) * f.x + (e.cy - p.y) * f.y + (e.cz - p.z) * f.z;
      e.object.visible = depth - e.r < fogFar;
    }
  }

  showAll(): void {
    if (this.entries) for (const e of this.entries) e.object.visible = true;
  }
}
