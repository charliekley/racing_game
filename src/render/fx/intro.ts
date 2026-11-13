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

  start(): void {
    this.t = 0;
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
    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;
    const z = a.z + (b.z - a.z) * f;
    // Sideways offset (the road's right vector rx/rz) and height depend on the variant.
    const side = (variant % 2 === 0 ? 1 : -1) * (7 + 3 * (variant >> 1));
    const height = 10 + 3 * Math.sin(u * 3 + variant) + (variant >> 1) * 4 - 5 * smooth((u - 0.7) / 0.3);
    this.pos.set(x + a.rx * side, y + height, z + a.rz * side);
    const ahead = S[(i0 + 14) % n];
    this.look.set(ahead.x, ahead.y + 1, ahead.z);

    // Remember the chase pose, build the flyover pose, blend over the last 0.9 s.
    this.chasePos.copy(camera.position);
    this.chaseQuat.copy(camera.quaternion);
    camera.position.copy(this.pos);
    camera.lookAt(this.look);
    this.flyQuat.copy(camera.quaternion);
    const w = blend ? smooth((this.t - (T - 0.9)) / 0.9) : 0;
    camera.position.lerp(this.chasePos, w);
    camera.quaternion.copy(this.flyQuat).slerp(this.chaseQuat, w);
    camera.updateMatrixWorld();
  }
}
