/**
 * Draws one kart: interpolates between the previous and current sim state
 * and adds purely cosmetic motion (body lean, wheel spin and steer).
 */
import * as THREE from 'three';
import type { KartState } from '../sim/kart';
import type { Ground } from '../sim/ground';
import { KART } from '../sim/config';
import { WHEEL_RADIUS, buildKartModel, type KartModel } from './kartModel';
import { CarrierDrone, SparkEmitter, buildFlame } from './effects';
import { CARRIER_HEIGHT } from '../sim/world';
import type { ItemId } from '../sim/items/types';
import { buildHeldItemMesh, buildNovaAura, type NovaAura } from './itemMeshes';


/** Shortest-path angle interpolation (handles wrap-around at ±π). */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export interface InterpolatedKart {
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  yawRate: number;
}

export class KartView {
  readonly model: KartModel;
  private lean = 0;
  private pitch = 0;
  private roll = 0;
  private wheelSpin = 0;
  private driftYaw = 0;
  private sparks: SparkEmitter;
  private flames: THREE.Group[] = [];
  private drone: CarrierDrone;
  private aura: NovaAura;
  private heldMeshes = new Map<ItemId, THREE.Object3D>();
  private shownHeld: THREE.Object3D | null = null;
  /** Set by the game each frame: the item currently dragged behind this kart (shots only; a dragged Slick is a world entity). */
  trailingItem: ItemId | null = null;
  private tmp = new THREE.Vector3();
  private back = new THREE.Vector3();
  /** Interpolated pose from the last `update` (the camera reads this). */
  readonly pose: InterpolatedKart = { x: 0, y: 0, z: 0, heading: 0, speed: 0, yawRate: 0 };

  constructor(scene: THREE.Scene, colorHex: string) {
    this.model = buildKartModel(colorHex);
    this.model.root.rotation.order = 'YXZ'; // yaw first, then pitch/roll in the kart's own frame
    scene.add(this.model.root);
    this.sparks = new SparkEmitter(scene);
    // Each body style marks where its exhausts end; the flame shoots along the marker's -Z.
    for (const marker of this.model.exhausts) {
      const f = buildFlame();
      marker.add(f);
      this.flames.push(f);
    }
    this.drone = new CarrierDrone(scene);
    this.aura = buildNovaAura();
    this.model.root.add(this.aura.object);
  }

  update(prev: KartState, cur: KartState, alpha: number, dt: number, ground?: Ground): void {
    const p = this.pose;
    p.x = prev.pos.x + (cur.pos.x - prev.pos.x) * alpha;
    p.y = prev.pos.y + (cur.pos.y - prev.pos.y) * alpha;
    p.z = prev.pos.z + (cur.pos.z - prev.pos.z) * alpha;
    p.heading = lerpAngle(prev.heading, cur.heading, alpha);
    p.speed = prev.speed + (cur.speed - prev.speed) * alpha;
    p.yawRate = cur.yawRate;

    const m = this.model;
    m.root.position.set(p.x, p.y, p.z);
    // While drifting, the body swings a bit further into the corner than the
    // heading (purely visual exaggeration of the slide).
    const targetDriftYaw = cur.driftDir === 0 ? 0 : -cur.driftDir * 0.22;
    this.driftYaw += (targetDriftYaw - this.driftYaw) * (1 - Math.exp(-dt / 0.1));
    // Spin-out after a hit: two full turns while control is lost.
    const spinYaw = cur.spinTime > 0 ? (1 - cur.spinTime / KART.spinTime) * Math.PI * 4 : 0;
    m.root.rotation.y = p.heading + this.driftYaw + spinYaw;

    // Tilt with the ground (slopes, banking, ramp) or nose up/down in the air.
    let targetPitch = 0;
    let targetRoll = 0;
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    if (cur.grounded && ground) {
      const h = (dx: number, dz: number) => ground.sample(p.x + dx, p.z + dz, cur.trackIndex)?.height ?? p.y;
      const hf = h(fx * 0.9, fz * 0.9);
      const hb = h(-fx * 0.9, -fz * 0.9);
      const hl = h(fz * 0.7, -fx * 0.7); // left = +x when facing +z
      const hr = h(-fz * 0.7, fx * 0.7);
      targetPitch = -Math.atan2(hf - hb, 1.8);
      targetRoll = Math.atan2(hl - hr, 1.4);
    } else if (!cur.grounded) {
      targetPitch = -Math.atan2(cur.vel.y, Math.max(5, Math.abs(cur.speed))) * 0.6;
    }
    // Inside a launch cannon: nose up the barrel while loading; in the air see below.
    const fl = cur.flight;
    if (fl?.phase === 'load') targetPitch = -0.52;
    const k = 1 - Math.exp(-dt / 0.06);
    this.pitch += (targetPitch - this.pitch) * k;
    this.roll += (targetRoll - this.roll) * k;
    m.root.rotation.x = this.pitch;
    // Cannon flight: one slow, smooth barrel roll over the whole flight (ends level on landing).
    const flightU = fl?.phase === 'air' && fl.duration > 0 ? Math.min(1, fl.t / fl.duration) : 0;
    m.root.rotation.z = this.roll + Math.PI * 2 * flightU * flightU * (3 - 2 * flightU);
    // The kart shrinks as it is swallowed by the barrel and pops back to full size just after the shot.
    let scale = 1;
    if (fl?.phase === 'load') scale = 1 - 0.45 * Math.min(1, fl.t / 0.5);
    else if (fl?.phase === 'air') scale = 0.55 + 0.45 * Math.min(1, fl.t / 0.2);
    m.root.scale.setScalar(scale);

    // Lean outward in turns (roll around forward axis), proportional to lateral acceleration.
    const lateralAccel = p.yawRate * p.speed;
    const targetLean = THREE.MathUtils.clamp(-lateralAccel * 0.006, -0.14, 0.14);
    this.lean += (targetLean - this.lean) * (1 - Math.exp(-dt / 0.08));
    m.body.rotation.z = this.lean;
    // Slight nose-up under acceleration feel at low speed.
    m.body.rotation.x = -0.03 * Math.min(1, Math.abs(p.speed) / KART.maxSpeed);

    this.wheelSpin += (p.speed / WHEEL_RADIUS) * dt;
    for (const w of m.wheels) w.rotation.x = this.wheelSpin;
    for (const pivot of m.frontPivots) pivot.rotation.y = -cur.steer * 0.45;

    // Drift sparks from the rear wheels (dust while charging, then blue/orange).
    m.root.updateMatrixWorld();
    if (cur.driftDir !== 0 && cur.grounded) {
      this.sparks.setTier(cur.driftTier);
      this.back.set(-fx, 0, -fz);
      for (const c of m.rearWheelContacts) {
        this.tmp.copy(c);
        m.root.localToWorld(this.tmp);
        this.sparks.emit(this.tmp, this.back, cur.driftTier === 0 ? 1 : 2);
      }
    }
    // Sparkling trail while flying out of a cannon.
    if (fl?.phase === 'air') {
      this.sparks.setTier(1);
      this.back.set(-fx, 0, -fz);
      this.tmp.set(p.x, p.y + 0.4, p.z);
      this.sparks.emit(this.tmp, this.back, 3);
    }
    this.sparks.update(dt);

    // Boost flames flicker out of the exhausts.
    const boosting = cur.boostTime > 0;
    for (const f of this.flames) {
      f.visible = boosting;
      if (boosting) {
        const s = 0.8 + Math.random() * 0.5 + Math.min(1, cur.boostTime) * 0.4;
        f.scale.set(1, 1, s);
      }
    }

    // Nova glow, and a shot being dragged behind the kart.
    this.aura.update(performance.now() / 1000, cur.starTime > 0);
    this.showTrailing(this.trailingItem);

    // Respawn carrier: hovers above and lowers the kart back onto the track.
    this.tmp.set(p.x, p.y, p.z);
    const lowering = cur.respawnTime > 0;
    this.drone.update(this.tmp, p.heading, lowering ? 2.4 + CARRIER_HEIGHT * 0.15 : 0, dt, lowering);
  }

  /** Show the small item mesh dragged behind the kart (or hide it). */
  private showTrailing(id: ItemId | null): void {
    let mesh: THREE.Object3D | null = null;
    if (id) {
      if (!this.heldMeshes.has(id)) {
        const built = buildHeldItemMesh(id);
        if (built) {
          built.position.set(0, 0.35, -2.6);
          this.model.root.add(built);
          this.heldMeshes.set(id, built);
        }
      }
      mesh = this.heldMeshes.get(id) ?? null;
    }
    if (mesh !== this.shownHeld) {
      if (this.shownHeld) this.shownHeld.visible = false;
      if (mesh) mesh.visible = true;
      this.shownHeld = mesh;
    }
  }

  dispose(scene: THREE.Scene): void {
    this.aura.dispose();
    scene.remove(this.model.root);
    this.sparks.dispose(scene);
    this.drone.dispose(scene);
  }
}
