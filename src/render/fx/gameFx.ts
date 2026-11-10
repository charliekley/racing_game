/**
 * GameFx: all the "juice" particles of a race in one place.
 *
 * It owns four pooled particle systems (see particles.ts) and the skid-mark
 * ribbon, and offers two kinds of calls:
 *  - `kartTick`: continuous effects that depend on a kart's state each frame
 *    (smoke/dust, drift sparks, skid marks, boost flames, spin-out stars...).
 *  - one-shot bursts (`hit`, `landDust`, `shatterBox`, `muzzleBlast`...) that
 *    game.ts triggers from sim events.
 *
 * Quality: every emit count goes through `n()`, which scales by the preset
 * (High 1, Medium 0.55, Low 0.25), so lower presets simply spawn fewer particles.
 * Nothing here allocates while the game runs: scratch vectors are reused and
 * particles live in preallocated typed arrays.
 */
import * as THREE from 'three';
import type { KartState } from '../../sim/kart';
import type { QualitySettings } from '../scene';
import type { KartView } from '../kartView';
import { ParticleSystem } from './particles';
import { SkidMarks } from './skidMarks';
import { fxHub } from './hub';

/** Spark colours by drift tier: 0 = charging (white), 1 = blue, 2 = orange. */
export const TIER_HEX = [0xe8e8e8, 0x45c8ff, 0xff8a1a];
const RAINBOW = [0xff4d6d, 0xffbe0b, 0x3ddc84, 0x3a86ff, 0xc77dff, 0xff7a1a, 0x4cf0ff];

/** Quality preset -> how many particles to spawn (1 = all). */
export function fxScaleFor(q: QualitySettings): number {
  return q.name === 'High' ? 1 : q.name === 'Medium' ? 0.55 : 0.25;
}

/** Per-kart memory for the continuous effects (reused every frame, never reallocated). */
interface KartFx {
  skidValid: [boolean, boolean];
  skidX: [number, number];
  skidZ: [number, number];
  smokeAcc: number;
  flameAcc: number;
  starAcc: number;
  lastTier: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class GameFx {
  /** Additive soft glows: sparks, flames, flashes. */
  readonly glow: ParticleSystem;
  /** Normal-blended soft puffs: smoke and dust. */
  readonly smoke: ParticleSystem;
  /** Hard-edged specks: confetti, shards, water drops. */
  readonly bits: ParticleSystem;
  /** Additive four-point stars: sparkles and bump stars. */
  readonly stars: ParticleSystem;
  readonly skids: SkidMarks;
  private scale = 1;
  private perKart = new Map<number, KartFx>();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  /** Dust colour on off-road ground (from the track theme). */
  private dustHex = 0xb59a6a;
  private time = 0;

  constructor(
    private readonly scene: THREE.Scene,
    quality: QualitySettings,
  ) {
    this.glow = new ParticleSystem(scene, 1400, true, 'soft');
    this.smoke = new ParticleSystem(scene, 700, false, 'soft');
    this.bits = new ParticleSystem(scene, 700, false, 'hard');
    this.stars = new ParticleSystem(scene, 400, true, 'star');
    this.skids = new SkidMarks(scene, 480);
    this.setQuality(quality);
    fxHub.current = this;
  }

  setQuality(q: QualitySettings): void {
    this.scale = fxScaleFor(q);
    this.skids.setCapacity(Math.round(480 * (q.name === 'High' ? 1 : q.name === 'Medium' ? 0.6 : 0.25)));
  }

  /** Off-road dust takes the colour of the track's off-road surface. */
  setTheme(offroadCss: string): void {
    this.dustHex = new THREE.Color(offroadCss).getHex(THREE.SRGBColorSpace);
  }

  /** Stochastic rounding: 2.4 -> 2 most of the time, 3 sometimes, so low rates still average out. */
  private n(count: number): number {
    return Math.floor(count * this.scale + Math.random());
  }

  /** Forget per-kart memory (new race). */
  reset(): void {
    this.perKart.clear();
    this.glow.clear();
    this.smoke.clear();
    this.bits.clear();
    this.stars.clear();
    this.skids.clear();
  }

  /** Before rendering each viewport (particle pixel sizes depend on the camera and viewport height). */
  beginView(camera: THREE.PerspectiveCamera, pixelHeight: number): void {
    this.glow.setView(camera, pixelHeight);
    this.smoke.setView(camera, pixelHeight);
    this.bits.setView(camera, pixelHeight);
    this.stars.setView(camera, pixelHeight);
  }

  update(dt: number): void {
    this.time += dt;
    this.glow.update(dt);
    this.smoke.update(dt);
    this.bits.update(dt);
    this.stars.update(dt);
    this.skids.update(this.time);
  }

  // ---------------------------------------------------------------------------------
  // Continuous per-kart effects
  // ---------------------------------------------------------------------------------

  /**
   * Call once per frame per kart, after `KartView.update` (so the model's
   * world matrix is current). `cur` is the latest sim state.
   */
  kartTick(slot: number, view: KartView, cur: KartState, dt: number): void {
    let f = this.perKart.get(slot);
    if (!f) {
      f = { skidValid: [false, false], skidX: [0, 0], skidZ: [0, 0], smokeAcc: 0, flameAcc: 0, starAcc: 0, lastTier: 0 };
      this.perKart.set(slot, f);
    }
    const p = view.pose;
    const m = view.model;
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    const speed = Math.abs(p.speed);
    const inCannon = cur.flight !== null;
    m.root.updateMatrixWorld();

    // --- Tyre smoke / dust by surface, and skid marks, from the rear wheels ---------
    const drifting = cur.driftDir !== 0 && cur.grounded && !inCannon;
    const rolling = cur.grounded && !inCannon && speed > 6 && cur.respawnTime <= 0;
    const offroad = cur.surface === 'offroad';
    let smokeRate = 0; // puffs per second per wheel
    if (rolling && offroad) smokeRate = 6 + speed * 0.5;
    else if (drifting) smokeRate = 9 + cur.driftTier * 4;
    else if (cur.grounded && cur.stallTime > 0) smokeRate = 14; // flooded start: smoky burnout
    f.smokeAcc += smokeRate * dt;
    const puffs = Math.floor(f.smokeAcc);
    f.smokeAcc -= puffs;

    for (let w = 0; w < m.rearWheelContacts.length && w < 2; w++) {
      this.tmpA.copy(m.rearWheelContacts[w]);
      m.root.localToWorld(this.tmpA);
      const wx = this.tmpA.x;
      const wy = this.tmpA.y;
      const wz = this.tmpA.z;
      for (let i = this.n(puffs); i > 0; i--) {
        const up = offroad ? rand(0.8, 2.2) : rand(0.4, 1.2);
        if (offroad) {
          this.smoke.emit(wx, wy + 0.15, wz, -fx * speed * 0.15 + rand(-1, 1), up, -fz * speed * 0.15 + rand(-1, 1), rand(0.5, 0.9), 0.35, rand(1.0, 1.6), this.dustHex, 0.55, 1.5, -0.5);
        } else {
          this.smoke.emit(wx, wy + 0.1, wz, -fx * 1.5 + rand(-0.8, 0.8), up, -fz * 1.5 + rand(-0.8, 0.8), rand(0.5, 0.9), 0.3, rand(0.9, 1.5), 0xe9edf2, 0.38, 1.8, -0.6);
        }
      }
      // Skid marks: a ribbon from the last wheel position to this one (every ~0.45 m).
      if (drifting) {
        if (f.skidValid[w]) {
          const dx = wx - f.skidX[w];
          const dz = wz - f.skidZ[w];
          if (dx * dx + dz * dz > 0.2) {
            this.skids.addSegment(f.skidX[w], wy + 0.03, f.skidZ[w], wx, wy + 0.03, wz, this.time);
            f.skidX[w] = wx;
            f.skidZ[w] = wz;
          }
        } else {
          f.skidValid[w] = true;
          f.skidX[w] = wx;
          f.skidZ[w] = wz;
        }
      } else f.skidValid[w] = false;
    }

    // --- Tier change: a pop of sparks at both rear wheels --------------------------
    if (cur.driftDir !== 0 && cur.driftTier > f.lastTier) {
      for (let w = 0; w < m.rearWheelContacts.length; w++) {
        this.tmpA.copy(m.rearWheelContacts[w]);
        m.root.localToWorld(this.tmpA);
        this.sparkBurst(this.tmpA.x, this.tmpA.y + 0.2, this.tmpA.z, -fx, -fz, cur.driftTier, 10);
      }
    }
    f.lastTier = cur.driftDir !== 0 ? cur.driftTier : 0;

    // --- Boost flames + speed trail -------------------------------------------------
    if (cur.boostTime > 0 && !inCannon) {
      f.flameAcc += 70 * dt;
      const k = Math.floor(f.flameAcc);
      f.flameAcc -= k;
      for (const ex of m.exhausts) {
        ex.getWorldPosition(this.tmpB);
        for (let i = this.n(k / Math.max(1, m.exhausts.length) + 0.4); i > 0; i--) {
          const s = rand(0.18, 0.3);
          // Hot yellow core and orange outer flame blowing backwards.
          this.glow.emit(this.tmpB.x, this.tmpB.y, this.tmpB.z, -fx * rand(4, 8) + rand(-0.6, 0.6), rand(-0.2, 0.8), -fz * rand(4, 8) + rand(-0.6, 0.6), rand(0.16, 0.3), s, 0.04, Math.random() < 0.5 ? 0xffe27a : 0xff7a1a, 0.9, 1);
        }
      }
      // Soft streaks left in the air behind the kart (the "speed trail").
      for (let i = this.n(1.2); i > 0; i--) {
        this.glow.emit(p.x - fx * 1.2 + rand(-0.5, 0.5), p.y + rand(0.2, 0.9), p.z - fz * 1.2 + rand(-0.5, 0.5), -fx * 2, 0, -fz * 2, rand(0.3, 0.5), 0.22, 0.02, 0xffb347, 0.45, 2);
      }
    }

    // --- Cannon flight: fiery comet trail -------------------------------------------
    if (cur.flight?.phase === 'air') {
      for (let i = this.n(3); i > 0; i--) {
        this.glow.emit(p.x + rand(-0.2, 0.2), p.y + 0.4 + rand(-0.2, 0.2), p.z + rand(-0.2, 0.2), -fx * 2 + rand(-1, 1), rand(-1, 1), -fz * 2 + rand(-1, 1), rand(0.5, 0.9), rand(0.5, 0.9), 0.1, Math.random() < 0.5 ? 0xff9a2e : 0xfff0b0, 0.75, 1.5);
      }
      for (let i = this.n(1); i > 0; i--) {
        this.smoke.emit(p.x, p.y + 0.3, p.z, rand(-0.5, 0.5), rand(0, 0.5), rand(-0.5, 0.5), rand(0.8, 1.3), 0.5, 1.8, 0xd8dce4, 0.4, 1);
      }
    }

    // --- Spin-out: a ring of stars circling above the kart -------------------------
    if (cur.spinTime > 0) {
      f.starAcc += 22 * dt;
      const k = Math.floor(f.starAcc);
      f.starAcc -= k;
      for (let i = this.n(k); i > 0; i--) {
        const a = this.time * 9 + Math.random() * 6.28;
        this.stars.emit(p.x + Math.cos(a) * 0.9, p.y + 1.7, p.z + Math.sin(a) * 0.9, -Math.sin(a) * 2, 0.3, Math.cos(a) * 2, rand(0.4, 0.6), 0.5, 0.2, i % 2 ? 0xffe14a : 0xffffff, 0.95);
      }
    }

    // --- Nova: rainbow sparkles shed by the kart -------------------------------------
    if (cur.starTime > 0) {
      for (let i = this.n(0.9); i > 0; i--) {
        const a = Math.random() * 6.28;
        this.stars.emit(p.x + Math.cos(a) * 1.1, p.y + rand(0.2, 1.1), p.z + Math.sin(a) * 1.1, -fx * 1.5 + rand(-0.5, 0.5), rand(0.5, 1.5), -fz * 1.5 + rand(-0.5, 0.5), rand(0.4, 0.7), 0.45, 0.1, RAINBOW[Math.floor(Math.random() * RAINBOW.length)], 0.95, 0.5);
      }
    }
  }

  // ---------------------------------------------------------------------------------
  // One-shot bursts
  // ---------------------------------------------------------------------------------

  /** Coloured sparks flying backwards (drift tier changes, mini-turbo release). `back` = unit vector pointing behind the kart. */
  sparkBurst(x: number, y: number, z: number, backX: number, backZ: number, tier: number, count: number): void {
    const hex = TIER_HEX[tier] ?? TIER_HEX[0];
    for (let i = this.n(count); i > 0; i--) {
      this.glow.emit(x, y, z, backX * rand(1, 5) + rand(-3, 3), rand(1.5, 5), backZ * rand(1, 5) + rand(-3, 3), rand(0.25, 0.5), rand(0.14, 0.26), 0.03, hex, 1, 0.5, 16);
    }
    this.glow.emit(x, y, z, 0, 0, 0, 0.18, 0.3 + tier * 0.15, 0.9, hex, 0.8); // quick flash
  }

  /** Used by the old SparkEmitter wrapper (effects.ts): a few sparks at a position, thrown backwards. */
  legacySparks(x: number, y: number, z: number, backX: number, backZ: number, count: number, tier: number): void {
    const hex = TIER_HEX[tier] ?? TIER_HEX[0];
    for (let i = this.n(count); i > 0; i--) {
      this.glow.emit(x, y, z, backX * 3 + rand(-2, 2), rand(1.5, 4), backZ * 3 + rand(-2, 2), rand(0.18, 0.4), 0.1 + tier * 0.06, 0.02, hex, 1, 0.5, 18);
    }
  }

  /** Mini-turbo release: a big blast of tier-coloured sparks plus a flash behind the kart. */
  miniTurbo(x: number, y: number, z: number, heading: number, tier: number): void {
    const bx = -Math.sin(heading);
    const bz = -Math.cos(heading);
    this.sparkBurst(x + bx * 0.9, y + 0.4, z + bz * 0.9, bx, bz, tier, 26);
    this.glow.emit(x + bx, y + 0.5, z + bz, bx * 2, 0.2, bz * 2, 0.35, 0.8, 2.2, TIER_HEX[tier], 0.7, 2);
  }

  /**
   * Slipstream charging: thin pale streaks racing past the kart's sides (the air being pulled along by the
   * kart in front). Call every sim tick while charging; `progress` 0..1 makes it denser as the boost nears.
   */
  windStreaks(x: number, y: number, z: number, heading: number, progress: number): void {
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const rx = -fz; // unit vector to the kart's side (perpendicular to its heading)
    const rz = fx;
    for (let i = this.n(0.25 + progress * 0.9); i > 0; i--) {
      const side = (Math.random() < 0.5 ? -1 : 1) * rand(1.1, 2.2);
      const ahead = rand(0.5, 3.5);
      this.glow.emit(x + rx * side + fx * ahead, y + rand(0.2, 0.9), z + rz * side + fz * ahead, -fx * rand(10, 18), 0, -fz * rand(10, 18), rand(0.18, 0.3), 0.09, 0.02, 0xd8f0ff, 0.5 + progress * 0.4, 0.5);
    }
  }

  /** Slipstream slingshot: a cool-white burst behind the kart (unlike the orange boost pad). */
  slipBoost(x: number, y: number, z: number, heading: number): void {
    const bx = -Math.sin(heading);
    const bz = -Math.cos(heading);
    for (let i = this.n(18); i > 0; i--) {
      this.glow.emit(x + bx, y + rand(0.2, 0.8), z + bz, bx * rand(5, 12) + rand(-2, 2), rand(-0.3, 1), bz * rand(5, 12) + rand(-2, 2), rand(0.25, 0.45), rand(0.15, 0.3), 0.03, Math.random() < 0.5 ? 0xffffff : 0x9fdcff, 0.9, 2);
    }
  }

  /** Boost pad / dash: orange burst behind the kart. */
  boostBurst(x: number, y: number, z: number, heading: number): void {
    const bx = -Math.sin(heading);
    const bz = -Math.cos(heading);
    for (let i = this.n(16); i > 0; i--) {
      this.glow.emit(x + bx, y + rand(0.2, 0.8), z + bz, bx * rand(3, 9) + rand(-2, 2), rand(-0.3, 1.5), bz * rand(3, 9) + rand(-2, 2), rand(0.25, 0.5), rand(0.2, 0.4), 0.03, Math.random() < 0.4 ? 0xffe27a : 0xff7a1a, 0.9, 2);
    }
  }

  /** Item hit: fiery pop, smoke and stars. */
  hit(x: number, y: number, z: number): void {
    this.glow.emit(x, y + 0.7, z, 0, 0, 0, 0.3, 1.2, 4, 0xfff0b0, 0.9);
    for (let i = this.n(22); i > 0; i--) {
      const a = Math.random() * 6.28;
      const s = rand(2, 8);
      this.glow.emit(x, y + 0.7, z, Math.cos(a) * s, rand(1, 6), Math.sin(a) * s, rand(0.35, 0.7), rand(0.3, 0.6), 0.05, Math.random() < 0.5 ? 0xff9a2e : 0xffd23a, 1, 1.5, 9);
    }
    for (let i = this.n(8); i > 0; i--) {
      const a = Math.random() * 6.28;
      this.smoke.emit(x, y + 0.6, z, Math.cos(a) * 3, rand(0.5, 2.5), Math.sin(a) * 3, rand(0.7, 1.2), 0.7, 2.4, 0x3a3a42, 0.55, 1.5, -0.4);
    }
    for (let i = this.n(8); i > 0; i--) {
      const a = Math.random() * 6.28;
      this.stars.emit(x, y + 1.2, z, Math.cos(a) * rand(2, 4), rand(2, 5), Math.sin(a) * rand(2, 4), rand(0.5, 0.9), 0.55, 0.15, 0xffe14a, 1, 0.5, 8);
    }
  }

  /** Two karts bumped: a ring of little yellow stars at the contact. */
  bump(x: number, y: number, z: number): void {
    for (let i = this.n(7); i > 0; i--) {
      const a = (i / 7) * 6.28 + Math.random();
      this.stars.emit(x, y + 0.8, z, Math.cos(a) * 3.5, rand(2, 4), Math.sin(a) * 3.5, rand(0.35, 0.6), 0.5, 0.15, 0xffe14a, 1, 1, 10);
    }
  }

  /** Scraped a wall: a spray of hot orange sparks. */
  wallSparks(x: number, y: number, z: number, heading: number, impact: number): void {
    const f = Math.min(1.6, impact / 8);
    const bx = -Math.sin(heading);
    const bz = -Math.cos(heading);
    for (let i = this.n(14 * f); i > 0; i--) {
      this.glow.emit(x, y + rand(0.2, 0.7), z, bx * rand(2, 8) + rand(-3, 3), rand(1, 5), bz * rand(2, 8) + rand(-3, 3), rand(0.2, 0.45), rand(0.12, 0.22), 0.02, Math.random() < 0.5 ? 0xffd23a : 0xff8a1a, 1, 0.5, 16);
    }
  }

  /** Landing after a jump: a ring of dust expanding along the ground. */
  landDust(x: number, y: number, z: number, strength: number, offroad: boolean): void {
    const hex = offroad ? this.dustHex : 0xd9dde3;
    const count = 8 + Math.min(10, strength * 0.8);
    for (let i = this.n(count); i > 0; i--) {
      const a = Math.random() * 6.28;
      const s = rand(2, 4.5);
      this.smoke.emit(x + Math.cos(a) * 0.5, y + 0.15, z + Math.sin(a) * 0.5, Math.cos(a) * s, rand(0.3, 1.2), Math.sin(a) * s, rand(0.5, 0.9), 0.5, rand(1.4, 2.2), hex, 0.5, 2.2, -0.2);
    }
  }

  /** Splash when a kart drops into water: droplets and foam rings. */
  splash(x: number, y: number, z: number): void {
    for (let i = this.n(26); i > 0; i--) {
      const a = Math.random() * 6.28;
      const s = rand(1, 4);
      this.bits.emit(x, y, z, Math.cos(a) * s, rand(5, 11), Math.sin(a) * s, rand(0.8, 1.3), 0.22, 0.08, Math.random() < 0.5 ? 0xbfe6ff : 0xffffff, 0.95, 0.2, 18);
    }
    for (let i = this.n(10); i > 0; i--) {
      const a = Math.random() * 6.28;
      this.smoke.emit(x, y + 0.1, z, Math.cos(a) * 3, rand(1, 2.5), Math.sin(a) * 3, rand(0.7, 1.1), 0.6, 2.6, 0xeaf6ff, 0.6, 2, 0);
    }
  }

  /** A trick on a ramp: a ring of multi-coloured sparkles around the kart. */
  trickRing(x: number, y: number, z: number): void {
    const count = this.n(22);
    for (let i = 0; i < count; i++) {
      const a = (i / Math.max(1, count)) * 6.28;
      this.stars.emit(x + Math.cos(a) * 0.6, y + 0.7, z + Math.sin(a) * 0.6, Math.cos(a) * 5, 0.5, Math.sin(a) * 5, rand(0.5, 0.8), 0.6, 0.1, RAINBOW[i % RAINBOW.length], 1, 2.5);
    }
  }

  /** Item pick-up: sparkles rising from the kart. */
  pickup(x: number, y: number, z: number): void {
    for (let i = this.n(14); i > 0; i--) {
      const a = Math.random() * 6.28;
      this.stars.emit(x + Math.cos(a) * 0.6, y + rand(0.3, 1), z + Math.sin(a) * 0.6, Math.cos(a) * 1.2, rand(2.5, 5), Math.sin(a) * 1.2, rand(0.5, 0.9), 0.5, 0.1, RAINBOW[i % RAINBOW.length], 1, 1.2, 3);
    }
  }

  /** Item box smashed: rainbow confetti shards, stars and a flash. */
  shatterBox(x: number, y: number, z: number): void {
    this.glow.emit(x, y, z, 0, 0, 0, 0.3, 1, 3.4, 0xffffff, 0.8);
    for (let i = this.n(26); i > 0; i--) {
      const a = Math.random() * 6.28;
      const s = rand(2, 7);
      this.bits.emit(x, y, z, Math.cos(a) * s, rand(2, 7), Math.sin(a) * s, rand(0.7, 1.2), rand(0.16, 0.3), 0.08, RAINBOW[i % RAINBOW.length], 1, 0.8, 14);
    }
    for (let i = this.n(8); i > 0; i--) {
      const a = Math.random() * 6.28;
      this.stars.emit(x, y, z, Math.cos(a) * 3, rand(1, 4), Math.sin(a) * 3, rand(0.4, 0.7), 0.6, 0.1, 0xffffff, 1, 1, 6);
    }
  }

  /** Cannon fires: a hot blast out of the muzzle along (dirX, dirY, dirZ). */
  muzzleBlast(x: number, y: number, z: number, dirX: number, dirY: number, dirZ: number): void {
    this.glow.emit(x, y, z, dirX * 3, dirY * 3, dirZ * 3, 0.35, 2, 6, 0xfff1b0, 0.95, 2);
    for (let i = this.n(30); i > 0; i--) {
      const s = rand(6, 20);
      this.glow.emit(x, y, z, dirX * s + rand(-3, 3), dirY * s + rand(-3, 3), dirZ * s + rand(-3, 3), rand(0.3, 0.7), rand(0.3, 0.7), 0.05, Math.random() < 0.5 ? 0xff9a2e : 0xffd23a, 0.95, 1.5);
    }
    for (let i = this.n(16); i > 0; i--) {
      const s = rand(3, 12);
      this.smoke.emit(x, y, z, dirX * s + rand(-3, 3), dirY * s + rand(-2, 3), dirZ * s + rand(-3, 3), rand(1.2, 2.2), 1, 3.6, 0x70747d, 0.6, 1.2, -0.3);
    }
  }

  /** Finish-line celebration: confetti raining around a kart. */
  finishConfetti(x: number, y: number, z: number): void {
    for (let i = this.n(80); i > 0; i--) {
      this.bits.emit(x + rand(-3, 3), y + rand(3, 7), z + rand(-3, 3), rand(-2.5, 2.5), rand(1, 6), rand(-2.5, 2.5), rand(1.8, 3), rand(0.14, 0.26), 0.12, RAINBOW[i % RAINBOW.length], 1, 0.6, 3);
    }
    for (let i = this.n(12); i > 0; i--) {
      this.stars.emit(x + rand(-2, 2), y + rand(1, 4), z + rand(-2, 2), rand(-2, 2), rand(1, 4), rand(-2, 2), rand(0.7, 1.2), 0.8, 0.1, 0xffffff, 1, 1, 2);
    }
  }

  /** Burst of a Slick dropping / shot cancelling: little puff and sparks. */
  itemPop(x: number, y: number, z: number): void {
    for (let i = this.n(10); i > 0; i--) {
      const a = Math.random() * 6.28;
      this.glow.emit(x, y + 0.5, z, Math.cos(a) * 3, rand(1, 4), Math.sin(a) * 3, rand(0.25, 0.5), 0.25, 0.04, 0xffffff, 1, 1, 8);
    }
  }

  /** Trails for flying items (called every frame per shot). */
  itemTrail(kind: 'ricochet' | 'seeker', x: number, y: number, z: number, heading: number): void {
    const bx = -Math.sin(heading);
    const bz = -Math.cos(heading);
    if (kind === 'ricochet') {
      this.glow.emit(x, y + 0.6, z, bx * 1 + rand(-0.3, 0.3), rand(-0.2, 0.4), bz * 1 + rand(-0.3, 0.3), 0.35, 0.5, 0.05, Math.random() < 0.5 ? 0xffb84a : 0x35e0ff, 0.7, 2);
    } else {
      this.glow.emit(x + bx * 0.6, y + 0.6, z + bz * 0.6, bx * 2, rand(-0.2, 0.3), bz * 2, 0.3, 0.4, 0.05, 0xffb347, 0.85, 2);
      if (Math.random() < 0.5 * this.scale + 0.1) this.smoke.emit(x + bx * 0.9, y + 0.6, z + bz * 0.9, bx, 0.3, bz, rand(0.5, 0.9), 0.3, 1.1, 0xc8ccd6, 0.4, 1.5, -0.2);
    }
  }

  dispose(): void {
    if (fxHub.current === this) fxHub.current = null;
    this.glow.dispose(this.scene);
    this.smoke.dispose(this.scene);
    this.bits.dispose(this.scene);
    this.stars.dispose(this.scene);
    this.skids.dispose(this.scene);
  }
}
