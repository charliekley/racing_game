/**
 * Third-person chase camera with game feel.
 *
 * Base behaviour: follow behind the kart, look a bit ahead and into turns.
 * On top of that (all tuned in `CAMERA`, src/sim/config.ts):
 *  - FOV kick + pull-back under boost and at high speed,
 *  - camera heading lags behind the kart in corners (you see the kart's side),
 *    and rolls slightly into the turn,
 *  - a wider, further view while airborne off big jumps,
 *  - a dramatic pulled-back, wide shot during cannon flight,
 *  - camera shake ("trauma"): hits and landings call `addTrauma`, which decays,
 *  - a smooth orbit around the kart after it finishes.
 *
 * Web/3D concept: a PerspectiveCamera is placed with `position` and aimed with
 * `lookAt`. FOV (field of view) is the vertical angle it sees: widening it
 * makes things at the edges stretch away, which reads as speed.
 */
import * as THREE from 'three';
import { CAMERA, KART } from '../sim/config';
import { lerpAngle, type InterpolatedKart } from './kartView';

/** The camera never goes lower than this above the ground (m), so hills can't swallow it. */
const CAMERA_GROUND_CLEARANCE = 1.2;

/** What the camera needs to know about the kart besides its pose. Reused every frame (no allocation). */
export interface CameraState {
  boosting: boolean;
  grounded: boolean;
  /** 'load' | 'air' while inside a launch cannon, else null. */
  flightPhase: 'load' | 'air' | null;
  /** The kart has finished: orbit around it. */
  finished: boolean;
  /** -1, 0, 1: drift direction (adds a bit of extra lag). */
  driftDir: number;
}

export function newCameraState(): CameraState {
  return { boosting: false, grounded: true, flightPhase: null, finished: false, driftDir: 0 };
}

export class ChaseCamera {
  readonly camera = new THREE.PerspectiveCamera(CAMERA.fovBase, 16 / 9, 0.1, 2000);
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private fov: number = CAMERA.fovBase;
  private initialized = false;
  private tmp = new THREE.Vector3();
  private camHeading = 0;
  private roll = 0;
  private boostBlend = 0; // 0..1 smoothed "boosting"
  private airBlend = 0;
  private cannonBlend = 0;
  private trauma = 0;
  private shakeTime = 0;
  private orbitAngle = 0;
  private orbiting = false;
  /** Lets other effects (speed lines) read how strongly the camera is "pushing". 0..1 */
  speedFx = 0;

  /** Jump straight to the target next update (e.g. after a respawn). */
  snap(): void {
    this.initialized = false;
    this.boostBlend = this.airBlend = this.cannonBlend = 0;
    this.orbiting = false;
  }

  setAspect(aspect: number): void {
    if (Math.abs(this.camera.aspect - aspect) < 1e-4) return;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Shake the camera. amount 0..1 (0.3 = a bump, 0.7 = a big hit). Stacks, capped at 1. */
  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /**
   * @param state  extra kart info (boost, air, cannon, finished)
   * @param groundAt optional ground height lookup (null = no ground). On hills the
   *   smoothed camera can lag below a rising road; with this it is kept above the ground.
   */
  update(
    k: InterpolatedKart,
    dt: number,
    state: CameraState,
    groundAt?: (x: number, z: number) => number | null,
  ): void {
    const speedFrac = Math.min(1, Math.abs(k.speed) / KART.maxSpeed);
    const ease = (target: number, now: number, tc: number) => now + (target - now) * (1 - Math.exp(-dt / tc));

    // Is the kart high above the ground (a real jump, not a bunny hop)?
    let heightAbove = 0;
    if (!state.grounded && groundAt) {
      const g = groundAt(k.x, k.z);
      heightAbove = g === null ? 99 : k.y - g; // no ground below = over a chasm: counts as high
    }
    this.boostBlend = ease(state.boosting ? 1 : 0, this.boostBlend, state.boosting ? 0.12 : 0.35);
    this.airBlend = ease(!state.grounded && heightAbove > CAMERA.airMinHeight && !state.flightPhase ? 1 : 0, this.airBlend, 0.25);
    this.cannonBlend = ease(state.flightPhase ? 1 : 0, this.cannonBlend, state.flightPhase === 'air' ? 0.2 : 0.35);

    // Camera heading lags behind the kart's heading (more while drifting).
    if (!this.initialized) this.camHeading = k.heading;
    else {
      const lag = state.driftDir !== 0 ? CAMERA.headingLagDrift : CAMERA.headingLag;
      this.camHeading = lerpAngle(this.camHeading, k.heading, 1 - Math.exp(-dt / lag));
    }
    const fx = Math.sin(this.camHeading);
    const fz = Math.cos(this.camHeading);
    const kfx = Math.sin(k.heading);
    const kfz = Math.cos(k.heading);

    let desired: THREE.Vector3;
    let lookX: number;
    let lookY: number;
    let lookZ: number;
    if (state.finished) {
      // Orbit: circle slowly around the kart.
      if (!this.orbiting) {
        this.orbiting = true;
        this.orbitAngle = k.heading + Math.PI; // start behind the kart
      }
      this.orbitAngle += CAMERA.orbitSpeed * dt;
      desired = this.tmp.set(
        k.x + Math.sin(this.orbitAngle) * CAMERA.orbitDistance,
        k.y + CAMERA.orbitHeight,
        k.z + Math.cos(this.orbitAngle) * CAMERA.orbitDistance,
      );
      lookX = k.x;
      lookY = k.y + 0.9;
      lookZ = k.z;
    } else {
      this.orbiting = false;
      // Pull back at speed, in boosts, in the air and (a lot) during cannon flight.
      const dist =
        CAMERA.distance * (1 + 0.15 * speedFrac) +
        CAMERA.boostPull * this.boostBlend +
        CAMERA.airPull * this.airBlend +
        CAMERA.cannonPull * this.cannonBlend;
      const height = CAMERA.height + 0.9 * this.cannonBlend + 0.4 * this.airBlend;
      desired = this.tmp.set(k.x - fx * dist, k.y + height, k.z - fz * dist);
      // Look ahead, and into the turn (yawRate < 0 = turning right). Uses the kart's own heading.
      const side = -k.yawRate * CAMERA.turnLookAhead;
      const ahead = CAMERA.lookAhead + 2 * this.cannonBlend;
      lookX = k.x + kfx * ahead - kfz * side;
      lookZ = k.z + kfz * ahead + kfx * side;
      lookY = k.y + 1.0;
    }

    if (!this.initialized) {
      this.pos.copy(desired);
      this.look.set(lookX, lookY, lookZ);
      this.initialized = true;
    } else {
      // Orbit and cannon shots follow loosely; normal driving stays tight.
      const posLag = state.finished ? 0.35 : CAMERA.followLag * (1 + this.cannonBlend);
      this.pos.lerp(desired, 1 - Math.exp(-dt / posLag));
      this.look.lerp(this.tmp.set(lookX, lookY, lookZ), 1 - Math.exp(-dt / (state.finished ? 0.2 : 0.06)));
    }
    if (groundAt) {
      const ground = groundAt(this.pos.x, this.pos.z);
      if (ground !== null) this.pos.y = Math.max(this.pos.y, ground + CAMERA_GROUND_CLEARANCE);
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);

    // Roll into corners: tilt the horizon toward the turn (yawRate > 0 = turning left).
    const rollTarget = THREE.MathUtils.clamp(k.yawRate * speedFrac * 0.05, -1, 1) * CAMERA.rollMax * (state.finished ? 0 : 1);
    this.roll = ease(rollTarget, this.roll, 0.15);

    // Shake: trauma squared gives a gentle start and a strong peak. Sum of sines = cheap noise.
    this.shakeTime += dt;
    this.trauma = Math.max(0, this.trauma - CAMERA.shakeDecay * dt);
    let rollShake = 0;
    if (this.trauma > 0) {
      const amp = this.trauma * this.trauma * CAMERA.shakeMax;
      const t = this.shakeTime;
      this.camera.translateX(Math.sin(t * 61) * amp + Math.sin(t * 37 + 1) * amp * 0.5);
      this.camera.translateY(Math.sin(t * 53 + 2) * amp + Math.sin(t * 29) * amp * 0.5);
      rollShake = Math.sin(t * 47 + 4) * amp * 0.08;
    }
    this.camera.rotateZ(-this.roll + rollShake);

    // Field of view: speed bonus, boost kick, jump and cannon widening.
    const targetFov =
      CAMERA.fovBase +
      CAMERA.fovSpeedBonus * speedFrac +
      CAMERA.fovBoost * this.boostBlend +
      CAMERA.fovAir * this.airBlend +
      CAMERA.cannonFov * this.cannonBlend;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt / 0.2));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.speedFx = Math.min(1, Math.max(0, (speedFrac - 0.6) / 0.4) * 0.5 + this.boostBlend * 0.8 + this.cannonBlend * 0.6);
  }
}
