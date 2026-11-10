/**
 * From a player's loadout (character + kart body) to real physics numbers.
 *
 * `loadoutStats` (shared/characters.ts) gives six "stat points", 1..5. Here each
 * point becomes a number by scaling a copy of the default `KART` config. The rule
 * that holds everything together: **3 points in a stat = exactly today's KART value**,
 * so the default loadout (Juno + Sprinter, all 3s) drives exactly like before and
 * the old tests / bot tuning stay valid.
 *
 * Engineering shorthand: with `t = (points - 3) / 2` (so t = -1 .. 0 .. +1) each
 * stat is `base * (1 + range * t)`. The ranges are small on purpose, so no class is
 * simply better (see classes.test.ts: lap times stay within a few % of each other).
 *
 * | stat     | what changes                                    | 1 pt      | 3 pts   | 5 pts     |
 * |----------|-------------------------------------------------|-----------|---------|-----------|
 * | speed    | maxSpeed                                        | -2.5%     | 28 m/s  | +2.5%     |
 * | accel    | accel, and off-road accel factor               | -25%      | 18 m/s² | +25%      |
 * | handling | turnRateLow/High, grip, driftGrip               | -15%      | 1×      | +15%      |
 * | weight   | mass in kart bumps; spin-out knock-back         | 0.6       | 1.0     | 1.4       |
 * | drift    | mini-turbo charge time                          | +20% time | 1×      | -20% time |
 * | offroad  | offroadSpeedFactor                              | 0.62      | 0.72    | 0.85      |
 *
 * Pure functions on plain data: no DOM, no Three.js.
 */
import { CHARACTERS, KART_BODIES, loadoutStats, sanitizeLoadout, type Loadout } from '../shared/characters';
import { KART, type KartConfig } from './config';

/** Stat points (1..5) -> -1..+1, with 3 points = 0 (the default kart). */
const tOf = (points: number): number => (points - 3) / 2;

/** base * (1 + range * t): the same relative change in both directions. */
const scaled = (base: number, range: number, t: number): number => base * (1 + range * t);

/** Piecewise-linear through (-1, low), (0, mid), (+1, high): for stats whose limits are not symmetric. */
const through = (low: number, mid: number, high: number, t: number): number => (t < 0 ? mid + (mid - low) * t : mid + (high - mid) * t);

const cache = new Map<string, Readonly<KartConfig>>();

/**
 * The physics numbers for one loadout. Cached (and frozen) per loadout, so it is cheap
 * to call and every kart with the same setup shares one object.
 */
export function kartConfigFor(loadout: Loadout): Readonly<KartConfig> {
  const l = sanitizeLoadout(loadout);
  const key = `${l.character}:${l.kart}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const s = loadoutStats(l);
  const speed = tOf(s.speed);
  const accel = tOf(s.accel);
  const handling = tOf(s.handling);
  const weight = tOf(s.weight);
  const drift = tOf(s.drift);
  const offroad = tOf(s.offroad);

  const turn = 1 + 0.15 * handling;
  // Drift charge: ±20% in the TIME to charge, so the rate is 1 / (time factor).
  const chargeRate = 1 / (1 - 0.2 * drift);

  const cfg: KartConfig = {
    ...KART,
    maxSpeed: scaled(KART.maxSpeed, 0.025, speed),
    accel: scaled(KART.accel, 0.25, accel),
    turnRateLow: KART.turnRateLow * turn,
    turnRateHigh: KART.turnRateHigh * turn,
    grip: KART.grip * turn,
    driftGrip: KART.driftGrip * turn,
    driftChargeRate: KART.driftChargeRate * chargeRate,
    driftChargeSteerBonus: KART.driftChargeSteerBonus * chargeRate,
    offroadSpeedFactor: through(0.62, KART.offroadSpeedFactor, 0.85, offroad),
    offroadAccelFactor: through(0.7, KART.offroadAccelFactor, 0.9, offroad),
    mass: scaled(KART.mass, 0.4, weight),
    // Item hits: a light kart is knocked about more (keeps less speed through the spin-out).
    spinSpeedFactor: KART.spinSpeedFactor + 0.07 * weight,
  };
  cache.set(key, Object.freeze(cfg));
  return cfg;
}

/** Human-readable summary of a loadout's real numbers, handy for debugging and the README. */
export function describeConfig(loadout: Loadout): string {
  const c = kartConfigFor(loadout);
  return `${CHARACTERS[loadout.character].name} + ${KART_BODIES[loadout.kart].name}: top ${c.maxSpeed.toFixed(1)} m/s, accel ${c.accel.toFixed(1)}, mass ${c.mass.toFixed(2)}`;
}

/**
 * A varied but fixed loadout per bot slot, so computer drivers don't all look and drive alike
 * (and races stay deterministic).
 */
export function botLoadoutFor(slot: number): Loadout {
  const n = CHARACTERS.length;
  const k = KART_BODIES.length;
  // Different multipliers per slot walk through the character and kart lists at different speeds.
  return { character: (slot * 3 + 1) % n, kart: (slot * 5 + 1) % k };
}
