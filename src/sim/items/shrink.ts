/**
 * What being small (Storm) or squashed does to a kart's physics.
 *
 * A shrunk kart is lighter and has less engine: lower top speed and acceleration ("the fractioned weight
 * affects the speed"), a small mass so every bump shoves it around, and livelier wall bounces so it
 * ricochets between barriers. Everything scales smoothly with the current size, so the grow-back is gradual.
 * A squashed kart (driven over by a full-size kart) is slowed hard for a moment.
 *
 * `effectiveConfig` returns a ready-made KartConfig for one kart and one tick. The results are cached per base
 * config and a coarse size step, so nothing is allocated in the hot loop after the first few ticks.
 */
import { ITEMS, type KartConfig } from '../config';
import type { KartState } from '../kart';

/** 0 = full size ... 1 = fully shrunk. */
export function shrinkFraction(size: number): number {
  return Math.max(0, Math.min(1, (1 - size) / (1 - ITEMS.stormSize)));
}

const STEPS = 12;
const cache = new WeakMap<KartConfig, Map<number, KartConfig>>();

/** The kart's own config adjusted for its current size and squash state (the same object when nothing applies). */
export function effectiveConfig(base: KartConfig, k: Pick<KartState, 'size' | 'squashTime'>): KartConfig {
  const f = shrinkFraction(k.size);
  const squashed = k.squashTime > 0;
  if (f <= 0 && !squashed) return base;
  const step = Math.round(f * STEPS);
  const key = step * 2 + (squashed ? 1 : 0);
  let perBase = cache.get(base);
  if (!perBase) cache.set(base, (perBase = new Map()));
  let c = perBase.get(key);
  if (!c) {
    const q = step / STEPS;
    const lerp = (a: number, b: number) => a + (b - a) * q;
    const sq = squashed ? ITEMS.squashSpeedFactor : 1;
    c = {
      ...base,
      maxSpeed: base.maxSpeed * lerp(1, ITEMS.stormSpeedFactor) * sq,
      accel: base.accel * lerp(1, ITEMS.stormAccelFactor),
      mass: base.mass * lerp(1, ITEMS.stormMassFactor),
      wallBounce: Math.min(0.95, base.wallBounce * lerp(1, ITEMS.stormWallBounce)),
      wallSpeedLoss: Math.min(0.8, base.wallSpeedLoss * lerp(1, ITEMS.stormWallLoss)),
      radius: base.radius * lerp(1, ITEMS.stormSize),
    };
    perBase.set(key, c);
  }
  return c;
}
