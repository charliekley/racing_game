/**
 * Draws Palm Plaza's parking-lot cars (the rules live in sim/hazards/car.ts): every car of every lane is one instance of one of
 * three body shapes (hatchback, saloon, SUV; env/mall.ts `carGeometry`), facing the way it drives, tinted its own colour, and
 * shrunk to nothing while it is "in the garage" (between crossings). The four wheels of every car are instances of one wheel
 * model that rolls with the car's speed, and glowing head and tail lights (HDR, they bloom) are one more instanced mesh.
 * Draw calls: 3 bodies + wheels + lights = 5 for all the cars.
 */
import * as THREE from 'three';
import type { Car } from '../../sim/hazards/car';
import type { Hazard } from '../../sim/hazards/types';
import { CAR_COLORS, CAR_SHAPES, WHEEL_R, WHEEL_SPOTS, carGeometry, carLightGeometry, carWheelGeometry } from '../env/mall';
import { matrix } from '../env/geo';
import type { QualitySettings } from '../scene';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4();
const _w = new THREE.Matrix4();

export class CarView {
  private readonly bodies: THREE.InstancedMesh[] = [];
  /** For every car (in lane order): which body mesh and which instance slot it uses. */
  private readonly slots: { shape: number; index: number }[] = [];
  private readonly wheels: THREE.InstancedMesh;
  private readonly lights: THREE.InstancedMesh;
  private readonly cars: Car[];

  constructor(
    private readonly scene: THREE.Scene,
    hazards: Hazard[],
    _quality: QualitySettings,
  ) {
    this.cars = hazards as Car[];
    const counts = new Array<number>(CAR_SHAPES).fill(0);
    let total = 0;
    for (const c of this.cars) {
      for (let k = 0; k < c.count; k++) {
        const shape = (c.id + k * 2) % CAR_SHAPES;
        this.slots.push({ shape, index: counts[shape]++ });
        total++;
      }
    }
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.35 });
    for (let shape = 0; shape < CAR_SHAPES; shape++) {
      const mesh = new THREE.InstancedMesh(carGeometry(shape, false), bodyMat, Math.max(1, counts[shape]));
      mesh.count = counts[shape];
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      this.bodies.push(mesh);
      scene.add(mesh);
    }
    let i = 0;
    for (const c of this.cars) {
      for (let k = 0; k < c.count; k++) {
        const slot = this.slots[i++];
        this.bodies[slot.shape].setColorAt(slot.index, new THREE.Color(CAR_COLORS[(c.id * 3 + k) % CAR_COLORS.length]));
      }
    }
    this.wheels = new THREE.InstancedMesh(carWheelGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }), total * 4);
    this.wheels.frustumCulled = false;
    this.lights = new THREE.InstancedMesh(carLightGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true }), total);
    this.lights.frustumCulled = false;
    scene.add(this.wheels, this.lights);
  }

  update(time: number): void {
    let i = 0;
    for (const c of this.cars) {
      const roll = (c.speed * time) / WHEEL_R; // how far the wheels have turned
      for (const car of c.cars(time)) {
        const slot = this.slots[i];
        if (car.visible) {
          // A gentle bounce on the suspension while driving.
          _m.copy(matrix(car.x, car.y + 0.03 * Math.sin(time * 9 + i), car.z, 1, 1, 1, Math.atan2(car.fx, car.fz)));
          this.bodies[slot.shape].setMatrixAt(slot.index, _m);
          this.lights.setMatrixAt(i, _m);
          WHEEL_SPOTS.forEach(([wx, wz], k) => this.wheels.setMatrixAt(i * 4 + k, _w.copy(_m).multiply(matrix(wx, WHEEL_R, wz, 1, 1, 1, 0, roll))));
        } else {
          this.bodies[slot.shape].setMatrixAt(slot.index, HIDDEN);
          this.lights.setMatrixAt(i, HIDDEN);
          for (let k = 0; k < 4; k++) this.wheels.setMatrixAt(i * 4 + k, HIDDEN);
        }
        i++;
      }
    }
    for (const b of this.bodies) b.instanceMatrix.needsUpdate = true;
    this.wheels.instanceMatrix.needsUpdate = true;
    this.lights.instanceMatrix.needsUpdate = true;
  }

  setQuality(_q: QualitySettings): void {}

  dispose(): void {
    for (const m of [...this.bodies, this.wheels, this.lights]) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
  }
}
