/**
 * Draws one kart: interpolates between the previous and current sim state
 * and adds purely cosmetic motion:
 *  - body lean (cornering), pitch (acceleration / braking), a spring-damper
 *    suspension bob and a little squash and stretch on hops and landings;
 *  - wheels that spin at their own radius and steer;
 *  - the driver (see kart/driverRig.ts): hands on the turning steering wheel,
 *    leaning, looking into the turn, boost lean-back, trick spin, dizzy wobble.
 */
import * as THREE from 'three';
import type { KartState } from '../sim/kart';
import type { Ground } from '../sim/ground';
import { ITEMS, KART } from '../sim/config';
import { DEFAULT_LOADOUT, paletteFor, type Loadout } from '../shared/characters';
import { buildKartModel, type KartModel } from './kartModel';
import { CarrierDrone, SparkEmitter, buildFlame } from './effects';
import { CARRIER_HEIGHT } from '../sim/world';
import type { ItemId } from '../sim/items/types';
import { buildHeldItemMesh, buildNovaAura, buildRocketShell, buildStormCloud, type NovaAura, type RocketShell, type StormCloud } from './itemMeshes';
import { DriverRig, type DriverInput } from './kart/driverRig';
import { DriverFace, type FaceConditions } from './kart/expression';


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

/** Seconds a car-hit flip (one barrel roll) takes; about the kart's hop in the air. */
const FLIP_TIME = 0.75;

export class KartView {
  readonly model: KartModel;
  private lean = 0;
  private pitch = 0;
  private roll = 0;
  /** Flip after being hit by a car (Palm Plaza): seconds into the roll, or -1 when not flipping. Render only. */
  private flipT = -1;
  private wheelSpin = 0; // distance rolled (m); divided by each wheel's radius for its angle
  private driftYaw = 0;
  /** Cosmetic driver animation (hands on the wheel, leaning, trick spin...). */
  readonly rig: DriverRig;
  /**
   * The driver's face: game events call `face.react(...)` (see `reactionsForEvent` in kart/expression.ts),
   * `update` turns the result into morph-target weights on the head and a head turn for the rig.
   */
  readonly face = new DriverFace();
  /** Set true when the race is over for this kart: the driver cheers. */
  finished = false;
  // Suspension: a damped spring on the body's height, kicked by hops and landings.
  private bob = 0;
  private bobVel = 0;
  private lastSpeed = 0;
  private accel = 0;
  private lastVy = 0;
  private wasGrounded = true;
  private wasHopping = false;
  private trickT = -1;
  private readonly riderInput: DriverInput = {
    steer: 0, bodyRoll: 0, accel: 0, speed01: 0, drift: 0, boosting: false, airborne: false, trick: -1, spun: false, celebrate: false, look: 0, lookSide: 1,
  };
  private readonly faceConditions: FaceConditions = { gritted: false };
  private sparks: SparkEmitter;
  private flames: THREE.Group[] = [];
  private drone: CarrierDrone;
  private aura: NovaAura;
  /** The glowing capsule while the kart is a Rocket, and the dark cloud + bolt over a kart struck by a Storm. */
  private shell: RocketShell;
  private cloud: StormCloud;
  /** 0 = normal, 1 = squashed flat (eased, so the pancake squashes fast and pops back slowly). */
  private squash = 0;
  private heldMeshes = new Map<ItemId, THREE.Object3D>();
  private shownHeld: THREE.Object3D | null = null;
  /** Set by the game each frame: the item currently dragged behind this kart (shots only; a dragged Slick is a world entity). */
  trailingItem: ItemId | null = null;
  /**
   * Set by the game each frame: the triple pack this kart carries. Ricochet x3 = that many green orbs orbiting
   * the kart (they block hits); Peel x3 = that many small peels in a line behind it (null while the real peels are dragged).
   */
  pack: { id: 'ricochet' | 'slick'; count: number } | null = null;
  private packGroup: THREE.Group | null = null;
  private orbs: THREE.Object3D[] = [];
  private peels: THREE.Object3D[] = [];
  private tmp = new THREE.Vector3();
  private back = new THREE.Vector3();
  /** Interpolated pose from the last `update` (the camera reads this). */
  readonly pose: InterpolatedKart = { x: 0, y: 0, z: 0, heading: 0, speed: 0, yawRate: 0 };

  /** Switch to a cheaper model (0 = full, 1 = reduced, 2 = far): see KartModel.setLod. */
  setLod(tier: 0 | 1 | 2, lean = false): void {
    this.model.setLod(tier, lean);
  }

  /**
   * With a `loadout` the kart is painted from the CHARACTER's own palette (shared/characters.ts), so every
   * driver has a recognisable kart; `colorHex` (the player's slot colour) is then only used for HUD badges
   * and the minimap, elsewhere. Without a loadout (tests, dev pages) the body is painted `colorHex`.
   */
  constructor(scene: THREE.Scene, colorHex: string, loadout?: Loadout) {
    const l = loadout ?? DEFAULT_LOADOUT;
    this.model = buildKartModel(colorHex, l.kart, l.character, undefined, loadout ? paletteFor(l.character) : undefined);
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
    this.shell = buildRocketShell();
    this.model.root.add(this.shell.object);
    this.cloud = buildStormCloud();
    scene.add(this.cloud.object);
    this.rig = new DriverRig(this.model);
    // Put the driver in the neutral pose (hands on the wheel) and freeze that into the merged far model.
    this.rig.update(0, this.riderInput);
    this.model.bakeFarModel();
  }

  /** Start the flip animation (a parking-lot car hit this kart: see sim/hazards/car.ts). */
  startFlip(): void {
    this.flipT = 0;
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
    // Flipped by a car: one full barrel roll over FLIP_TIME (eased), ending level.
    let flip = 0;
    if (this.flipT >= 0) {
      this.flipT += dt;
      const u = Math.min(1, this.flipT / FLIP_TIME);
      flip = Math.PI * 2 * u * u * (3 - 2 * u);
      if (u >= 1) this.flipT = -1;
    }
    m.root.rotation.z = this.roll + Math.PI * 2 * flightU * flightU * (3 - 2 * flightU) + flip;
    // The kart shrinks as it is swallowed by the barrel and pops back to full size just after the shot.
    let scale = 1;
    if (fl?.phase === 'load') scale = 1 - 0.45 * Math.min(1, fl.t / 0.5);
    else if (fl?.phase === 'air') scale = 0.55 + 0.45 * Math.min(1, fl.t / 0.2);
    // Storm: the kart is shrunk (smoothly, the sim already eases `size`); a squashed kart is flat and wide like a pancake.
    const size = prev.size + (cur.size - prev.size) * alpha;
    const squashTarget = cur.squashTime > 0 ? 1 : 0;
    this.squash += (squashTarget - this.squash) * (1 - Math.exp(-dt / (squashTarget ? 0.04 : 0.3)));
    const s = scale * size;
    m.root.scale.set(s * (1 + 0.4 * this.squash), s * (1 - 0.86 * this.squash), s * (1 + 0.4 * this.squash));

    // Lean outward in turns (roll around forward axis), proportional to lateral acceleration.
    const lateralAccel = p.yawRate * p.speed;
    const targetLean = THREE.MathUtils.clamp(-lateralAccel * 0.006, -0.14, 0.14);
    this.lean += (targetLean - this.lean) * (1 - Math.exp(-dt / 0.08));
    m.body.rotation.z = this.lean;

    // Longitudinal acceleration (smoothed): the nose lifts when speeding up and dips when braking.
    if (dt > 0) {
      const a = (p.speed - this.lastSpeed) / dt;
      this.accel += (THREE.MathUtils.clamp(a / 14, -1, 1) - this.accel) * (1 - Math.exp(-dt / 0.15));
    }
    this.lastSpeed = p.speed;
    m.body.rotation.x = -0.035 * Math.min(1, Math.abs(p.speed) / KART.maxSpeed) - this.accel * 0.05;

    // Suspension bob: a spring-damper on the body height. Landing compresses it, a hop kicks it up.
    if (cur.grounded && !this.wasGrounded) this.bobVel -= Math.min(6, Math.max(0, -this.lastVy)) * 0.7 + 0.8;
    if (cur.hopping && !this.wasHopping) {
      this.bobVel += 1.6;
      this.rig.bump(0.6);
    }
    this.wasGrounded = cur.grounded;
    this.wasHopping = cur.hopping;
    this.lastVy = cur.vel.y;
    if (dt > 0) {
      const sub = Math.min(dt, 1 / 30);
      this.bobVel += (-260 * this.bob - 14 * this.bobVel) * sub;
      this.bob += this.bobVel * sub;
    }
    const bob = THREE.MathUtils.clamp(this.bob, -0.07, 0.08);
    m.body.position.y = bob;
    // Squash and stretch (volume-preserving): taller when the body is stretching up, wider when compressed.
    const sq = bob * 1.1;
    m.body.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);

    // Wheels spin by their own radius and the front pair steers; they droop a little while airborne.
    this.wheelSpin += dt * p.speed;
    for (let i = 0; i < m.wheels.length; i++) m.wheels[i].rotation.x = this.wheelSpin / m.wheelRadii[i];
    for (const pivot of m.frontPivots) pivot.rotation.y = -cur.steer * 0.45;

    // Driver animation.
    const inp = this.riderInput;
    if (cur.trickDone && !cur.grounded) this.trickT = this.trickT < 0 ? 0 : Math.min(1, this.trickT + dt / 0.7);
    else this.trickT = -1;
    inp.steer = cur.steer;
    inp.bodyRoll = this.lean;
    inp.accel = this.accel;
    inp.speed01 = Math.min(1, Math.abs(p.speed) / KART.maxSpeed);
    inp.drift = cur.driftDir;
    inp.boosting = cur.boostTime > 0 || cur.rocketTime > 0;
    inp.airborne = !cur.grounded;
    inp.trick = this.trickT;
    inp.spun = cur.spinTime > 0;
    inp.celebrate = this.finished;
    // Face: expression weights go to the head's morph targets; the head turn goes to the rig.
    // Spinning out is an event the face hears about too, but the sim state is the reliable source.
    const face = this.face;
    face.look.sideHint = cur.steer > 0.15 ? 1 : cur.steer < -0.15 ? -1 : face.look.sideHint; // look over the outside shoulder
    this.faceConditions.gritted = cur.driftDir !== 0 && cur.grounded; // teeth gritted while drifting / charging
    face.update(dt, this.faceConditions);
    const fi = m.faceInfluences;
    for (let i = 0; i < fi.length; i++) fi[i] = face.weights[i];
    inp.look = face.look.amount;
    inp.lookSide = face.look.side;
    this.rig.update(dt, inp);

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

    // Nova glow, the Rocket capsule, the Storm cloud, and a shot being dragged behind the kart.
    const now = performance.now() / 1000;
    this.aura.update(now, cur.starTime > 0);
    this.shell.update(dt, now, cur.rocketTime > 0, cur.rocketTime);
    this.cloud.update(dt, p.x, p.y, p.z, cur.zapTime, ITEMS.stormZapSeconds);
    this.showTrailing(this.trailingItem);
    this.showPack(now);

    // Respawn carrier: hovers above and lowers the kart back onto the track.
    this.tmp.set(p.x, p.y, p.z);
    const lowering = cur.respawnTime > 0;
    this.drone.update(this.tmp, p.heading, lowering ? 2.4 + CARRIER_HEIGHT * 0.15 : 0, dt, lowering);
  }

  /** Ricochet x3 orbiting the kart, Peel x3 lined up behind it (up to `count` of each; the rest are hidden). */
  private showPack(t: number): void {
    if (!this.packGroup) {
      if (!this.pack) return; // nothing to show, nothing built
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const orb = buildHeldItemMesh('ricochet')!;
        const peel = buildHeldItemMesh('slick')!;
        orb.visible = peel.visible = false;
        g.add(orb, peel);
        this.orbs.push(orb);
        this.peels.push(peel);
      }
      this.model.root.add(g);
      this.packGroup = g;
    }
    const rico = this.pack?.id === 'ricochet' ? this.pack.count : 0;
    const peel = this.pack?.id === 'slick' ? this.pack.count : 0;
    for (let i = 0; i < 3; i++) {
      const orb = this.orbs[i];
      orb.visible = i < rico;
      if (orb.visible) {
        // Evenly spaced round the kart, one lap every ~2 s; each orb faces along its path.
        const a = t * 3.2 + (i * Math.PI * 2) / Math.max(1, rico);
        orb.position.set(Math.sin(a) * 1.55, 0.6 + Math.sin(t * 5 + i) * 0.05, Math.cos(a) * 1.55);
        orb.rotation.y = a + Math.PI / 2;
      }
      const pl = this.peels[i];
      pl.visible = i < peel;
      if (pl.visible) pl.position.set(0, 0.05, -ITEMS.trailDistance - i * ITEMS.tripleTrailGap);
    }
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
    scene.remove(this.cloud.object);
    this.cloud.dispose();
    this.sparks.dispose(scene);
    this.drone.dispose(scene);
  }
}
