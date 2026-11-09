/**
 * Third-person chase camera: smoothly follows behind the kart, looks a bit
 * ahead and into turns, and widens the field of view with speed.
 */
import * as THREE from 'three';
import { CAMERA, KART } from '../sim/config';
import type { InterpolatedKart } from './kartView';

/** The camera never goes lower than this above the ground (m), so hills can't swallow it. */
const CAMERA_GROUND_CLEARANCE = 1.2;

export class ChaseCamera {
  readonly camera = new THREE.PerspectiveCamera(CAMERA.fovBase, 16 / 9, 0.1, 2000);
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private fov: number = CAMERA.fovBase;
  private initialized = false;
  private tmp = new THREE.Vector3();

  /** Jump straight to the target next update (e.g. after a respawn). */
  snap(): void {
    this.initialized = false;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * @param groundAt optional ground height lookup (null = no ground). On hills the
   *   smoothed camera can lag below a rising road; with this it is kept above the ground.
   */
  update(k: InterpolatedKart, dt: number, extraFov = 0, groundAt?: (x: number, z: number) => number | null): void {
    const fx = Math.sin(k.heading);
    const fz = Math.cos(k.heading);
    const rx = -fz;
    const rz = fx;
    const speedFrac = Math.min(1, Math.abs(k.speed) / KART.maxSpeed);

    // Pull back slightly at speed.
    const dist = CAMERA.distance * (1 + 0.15 * speedFrac);
    const desired = this.tmp.set(k.x - fx * dist, k.y + CAMERA.height, k.z - fz * dist);

    // Look ahead, and into the turn (yawRate < 0 = turning right).
    const side = -k.yawRate * CAMERA.turnLookAhead;
    const lookX = k.x + fx * CAMERA.lookAhead + rx * side;
    const lookZ = k.z + fz * CAMERA.lookAhead + rz * side;
    const lookY = k.y + 1.0;

    if (!this.initialized) {
      this.pos.copy(desired);
      this.look.set(lookX, lookY, lookZ);
      this.initialized = true;
    } else {
      this.pos.lerp(desired, 1 - Math.exp(-dt / CAMERA.followLag));
      this.look.lerp(this.tmp.set(lookX, lookY, lookZ), 1 - Math.exp(-dt / 0.06));
    }
    if (groundAt) {
      const ground = groundAt(this.pos.x, this.pos.z);
      if (ground !== null) this.pos.y = Math.max(this.pos.y, ground + CAMERA_GROUND_CLEARANCE);
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);

    const targetFov = CAMERA.fovBase + CAMERA.fovSpeedBonus * speedFrac + extraFov;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt / 0.25));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
