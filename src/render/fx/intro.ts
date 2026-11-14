/**
 * Race intro: a slow camera flyover of the track before the countdown, shown FULL SCREEN
 * (one camera for everybody); the game switches to split screen when it ends.
 *
 * While it plays, the game does not advance the simulation (karts sit on the
 * grid anyway), so the 3-2-1 countdown starts only after the flyover. The
 * camera glides along the road centreline, high and slightly to one side,
 * looking down the track ahead, and ends near the start line. In the last
 * moments `apply` blends smoothly into the normal chase camera.
 *
 * It is skipped when the dev URL has `?drive` (unless `?intro=1`).
 */
import * as THREE from 'three';
import { CAMERA } from '../../sim/config';
import type { Track } from '../../sim/track';

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Should the intro play? `?drive` skips it unless `?intro=1` (quick dev testing). */
export function introWanted(search: string): boolean {
  const q = new URLSearchParams(search);
  if (q.get('intro') === '1') return true;
  return !q.has('drive');
}

export class Flyover {
  /** Seconds since the intro began; null when not playing. */
  private t: number | null = null;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly chasePos = new THREE.Vector3();
  private readonly chaseQuat = new THREE.Quaternion();
  private readonly flyQuat = new THREE.Quaternion();
  /** Smoothed camera position and look target (a low-pass filter removes any sample-to-sample wobble). */
  private readonly smoothPos = new THREE.Vector3();
  private readonly smoothLook = new THREE.Vector3();
  /** Intro time at the last `apply` (to know how much time passed), or null on the first frame. */
  private lastT: number | null = null;

  start(): void {
    this.t = 0;
    this.lastT = null;
  }

  skip(): void {
    this.t = null;
  }

  get active(): boolean {
    return this.t !== null;
  }

  /** 0..1 progress through the intro (for fading the title). */
  get progress(): number {
    return this.t === null ? 1 : Math.min(1, this.t / CAMERA.introSeconds);
  }

  /** Advance time. Returns true the moment the intro finishes. */
  tick(dt: number): boolean {
    if (this.t === null) return false;
    this.t += dt;
    if (this.t >= CAMERA.introSeconds) {
      this.t = null;
      return true;
    }
    return false;
  }

  /**
   * Replace the camera's pose (already set by the chase camera) with the
   * flyover pose, blending back to the chase pose at the end.
   * @param variant 0..3: a slightly different shot (side and height)
   * @param blend   true: ease into the chase camera's pose at the end (single player keeps the same view);
   *                false: keep the flyover pose to the end (the host cuts to split screen afterwards)
   */
  apply(camera: THREE.PerspectiveCamera, track: Track, variant: number, blend = true): void {
    if (this.t === null) return;
    const T = CAMERA.introSeconds;
    const u = this.t / T;
    const S = track.samples;
    const n = S.length;
    // Glide over the last ~22% of the lap up to the start line (index n == index 0): slow enough to take it in.
    const fi = n * (0.78 + 0.22 * smooth(u * 0.9 + 0.1 * u));
    const i0 = Math.floor(fi) % n;
    const i1 = (i0 + 1) % n;
    const f = fi - Math.floor(fi);
    const a = S[i0];
    const b = S[i1];
    const lerp = (p: number, q: number) => p + (q - p) * f;
    // Everything is interpolated between two samples (position AND sideways direction), so the path is smooth.
    const x = lerp(a.x, b.x);
    const y = lerp(a.y, b.y);
    const z = lerp(a.z, b.z);
    const rx = lerp(a.rx, b.rx);
    const rz = lerp(a.rz, b.rz);
    // Sideways offset and height depend on the variant.
    const side = (variant % 2 === 0 ? 1 : -1) * (7 + 3 * (variant >> 1));
    const height = 10 + 2 * Math.sin(u * 2 + variant) + (variant >> 1) * 4 - 5 * smooth((u - 0.7) / 0.3);
    this.pos.set(x + rx * side, y + height, z + rz * side);
    // Look ~30 m down the road, also interpolated (jumping from sample to sample made the view shake).
    const ahead = (k: number) => S[(i0 + 15 + k) % n];
    const p0 = ahead(0);
    const p1 = ahead(1);
    this.look.set(lerp(p0.x, p1.x), lerp(p0.y, p1.y) + 1, lerp(p0.z, p1.z));

    // Low-pass filter (exponential smoothing, time constant 0.35 s): the camera glides like it is on a crane.
    const dt = this.lastT === null ? 0 : Math.max(0, this.t - this.lastT);
    this.lastT = this.t;
    if (dt === 0) {
      this.smoothPos.copy(this.pos);
      this.smoothLook.copy(this.look);
    } else {
      const k = 1 - Math.exp(-dt / 0.35);
      this.smoothPos.lerp(this.pos, k);
      this.smoothLook.lerp(this.look, k);
    }

    // Remember the chase pose, build the flyover pose, blend over the last 0.9 s.
    this.chasePos.copy(camera.position);
    this.chaseQuat.copy(camera.quaternion);
    camera.position.copy(this.smoothPos);
    camera.lookAt(this.smoothLook);
    this.flyQuat.copy(camera.quaternion);
    const w = blend ? smooth((this.t - (T - 0.9)) / 0.9) : 0;
    camera.position.lerp(this.chasePos, w);
    camera.quaternion.copy(this.flyQuat).slerp(this.chaseQuat, w);
    camera.updateMatrixWorld();
  }
}
