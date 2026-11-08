/**
 * Cosmetic kart effects: drift sparks, boost flames and the respawn carrier
 * drone. Render-only (they never affect the simulation), so plain
 * Math.random is fine here.
 */
import * as THREE from 'three';

/** Spark colors by drift tier: 0 = charging (white-ish dust), 1 = blue, 2 = orange. */
export const SPARK_COLORS = ['#e8e8e8', '#45c8ff', '#ff8a1a'];

/**
 * A small pool of particles (THREE.Points = one draw call) living in world
 * space, so sparks trail behind the kart instead of moving with it.
 */
export class SparkEmitter {
  private readonly count = 64;
  private readonly positions = new Float32Array(this.count * 3);
  private readonly velocities = new Float32Array(this.count * 3);
  private readonly life = new Float32Array(this.count);
  private next = 0;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat = new THREE.PointsMaterial({
    size: 0.22,
    color: SPARK_COLORS[1],
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  readonly points: THREE.Points;

  constructor(scene: THREE.Scene) {
    this.positions.fill(-9999); // park unused particles far away
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setTier(tier: number): void {
    this.mat.color.set(SPARK_COLORS[tier] ?? SPARK_COLORS[0]);
    this.mat.size = tier === 0 ? 0.14 : tier === 1 ? 0.22 : 0.3;
  }

  /** Emit `n` sparks at a world position, flying back/up/outward. */
  emit(at: THREE.Vector3, back: THREE.Vector3, n: number): void {
    for (let i = 0; i < n; i++) {
      const j = this.next;
      this.next = (this.next + 1) % this.count;
      this.positions.set([at.x, at.y, at.z], j * 3);
      this.velocities.set(
        [back.x * 3 + (Math.random() - 0.5) * 4, 1.5 + Math.random() * 3, back.z * 3 + (Math.random() - 0.5) * 4],
        j * 3,
      );
      this.life[j] = 0.18 + Math.random() * 0.15;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) {
        this.positions[k + 1] = -9999;
        continue;
      }
      this.velocities[k + 1] -= 18 * dt; // gravity
      this.positions[k] += this.velocities[k] * dt;
      this.positions[k + 1] += this.velocities[k + 1] * dt;
      this.positions[k + 2] += this.velocities[k + 2] * dt;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.points);
    this.geo.dispose();
    this.mat.dispose();
  }
}

// --- Boost flame -----------------------------------------------------------------
const flameGeo = new THREE.ConeGeometry(0.11, 0.6, 8, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.3);
const flameOuterMat = new THREE.MeshBasicMaterial({ color: '#ff9a2e', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
const flameInnerMat = new THREE.MeshBasicMaterial({ color: '#fff3b0', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });

/** Two-layer flame pointing out of the back (-Z) of an exhaust. */
export function buildFlame(): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(flameGeo, flameOuterMat));
  const inner = new THREE.Mesh(flameGeo, flameInnerMat);
  inner.scale.set(0.55, 0.55, 0.7);
  g.add(inner);
  g.visible = false;
  return g;
}

// --- Respawn carrier drone (original design: a little yellow quad-rotor with a winch) ---
const droneBodyGeo = new THREE.SphereGeometry(0.5, 14, 10).scale(1.3, 0.55, 1.3);
const droneArmGeo = new THREE.BoxGeometry(2.4, 0.08, 0.14);
const droneRotorGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.03, 16);
const droneLampGeo = new THREE.SphereGeometry(0.12, 8, 6);
const cableGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 6).translate(0, -0.5, 0);
const droneMats = {
  body: new THREE.MeshLambertMaterial({ color: '#ffcf33' }),
  arm: new THREE.MeshLambertMaterial({ color: '#3a3f4a' }),
  rotor: new THREE.MeshBasicMaterial({ color: '#d9e2ec', transparent: true, opacity: 0.45 }),
  lamp: new THREE.MeshBasicMaterial({ color: '#4cff8a' }),
  cable: new THREE.MeshLambertMaterial({ color: '#222' }),
};

export class CarrierDrone {
  readonly group = new THREE.Group();
  private rotors: THREE.Mesh[] = [];
  private cable: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    const body = new THREE.Mesh(droneBodyGeo, droneMats.body);
    body.castShadow = true;
    this.group.add(body);
    for (const rot of [Math.PI / 4, -Math.PI / 4]) {
      const arm = new THREE.Mesh(droneArmGeo, droneMats.arm);
      arm.rotation.y = rot;
      this.group.add(arm);
    }
    for (const [x, z] of [
      [0.85, 0.85],
      [-0.85, 0.85],
      [0.85, -0.85],
      [-0.85, -0.85],
    ]) {
      const r = new THREE.Mesh(droneRotorGeo, droneMats.rotor);
      r.position.set(x, 0.12, z);
      this.rotors.push(r);
      this.group.add(r);
    }
    const lamp = new THREE.Mesh(droneLampGeo, droneMats.lamp);
    lamp.position.set(0, -0.15, 0.55);
    this.group.add(lamp);
    this.cable = new THREE.Mesh(cableGeo, droneMats.cable);
    this.group.add(this.cable);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Hover `height` m above the kart with the cable down to it. */
  update(kartPos: THREE.Vector3, heading: number, height: number, dt: number, visible: boolean): void {
    this.group.visible = visible;
    if (!visible) return;
    this.group.position.set(kartPos.x, kartPos.y + height, kartPos.z);
    this.group.rotation.y = heading;
    this.cable.scale.y = Math.max(0.1, height - 1.1);
    for (const r of this.rotors) r.rotation.y += dt * 40;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
  }
}
