/**
 * Draws Palm Plaza's parking-lot cars (the rules live in sim/hazards/car.ts): every car of every lane is one instance
 * of the shared hatchback model (env/mall.ts `carGeometry`), facing the way it drives, tinted its own colour, and
 * shrunk to nothing while it is "in the garage" (between crossings). Headlights are part of the model (they bloom).
 * One draw call for all the cars.
 */
import * as THREE from 'three';
import type { Car } from '../../sim/hazards/car';
import type { Hazard } from '../../sim/hazards/types';
import { CAR_COLORS, carGeometry } from '../env/mall';
import { matrix } from '../env/geo';
import type { QualitySettings } from '../scene';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class CarView {
  private readonly mesh: THREE.InstancedMesh;
  private readonly cars: Car[];

  constructor(
    private readonly scene: THREE.Scene,
    hazards: Hazard[],
    _quality: QualitySettings,
  ) {
    this.cars = hazards as Car[];
    const count = this.cars.reduce((a, c) => a + c.count, 0);
    this.mesh = new THREE.InstancedMesh(carGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.35 }), count);
    let i = 0;
    for (const c of this.cars) for (let k = 0; k < c.count; k++) this.mesh.setColorAt(i++, new THREE.Color(CAR_COLORS[(c.id * 3 + k) % CAR_COLORS.length]));
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(time: number): void {
    let i = 0;
    for (const c of this.cars) {
      for (const car of c.cars(time)) {
        // A gentle bounce on the suspension while driving.
        this.mesh.setMatrixAt(i++, car.visible ? matrix(car.x, car.y + 0.03 * Math.sin(time * 9 + i), car.z, 1, 1, 1, Math.atan2(car.fx, car.fz)) : HIDDEN);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setQuality(_q: QualitySettings): void {}

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}
