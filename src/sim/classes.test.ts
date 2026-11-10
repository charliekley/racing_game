import { describe, expect, it } from 'vitest';
import { CHARACTERS, DEFAULT_LOADOUT, KART_BODIES, STAT_KEYS, loadoutStats, type Loadout } from '../shared/characters';
import { TRACKS } from '../track';
import { autopilot, botStyleFor } from './autopilot';
import { botLoadoutFor, kartConfigFor } from './classes';
import { KART } from './config';
import { collideKarts } from './collision';
import { createKart, type KartState } from './kart';
import { Track } from './track';
import { World } from './world';

describe('kartConfigFor', () => {
  it('the default loadout (3 points everywhere) is exactly the plain KART config', () => {
    expect(loadoutStats(DEFAULT_LOADOUT)).toEqual({ speed: 3, accel: 3, handling: 3, weight: 3, drift: 3, offroad: 3 });
    expect(kartConfigFor(DEFAULT_LOADOUT)).toEqual(KART);
  });

  it('caches one object per loadout', () => {
    expect(kartConfigFor({ character: 0, kart: 1 })).toBe(kartConfigFor({ character: 0, kart: 1 }));
  });

  it('more stat points means a better number, within the documented ranges', () => {
    // Pip (speed 1) vs Bruno (speed 5): -2.5% .. +2.5% around 28 m/s.
    const slow = kartConfigFor({ character: 0, kart: 0 });
    const fast = kartConfigFor({ character: 6, kart: 0 });
    expect(slow.maxSpeed).toBeCloseTo(KART.maxSpeed * 0.975, 6);
    expect(fast.maxSpeed).toBeCloseTo(KART.maxSpeed * 1.025, 6);
    expect(slow.accel).toBeGreaterThan(fast.accel);
    expect(slow.mass).toBeLessThan(fast.mass);
    expect(slow.mass).toBeCloseTo(0.6, 6);
    expect(fast.mass).toBeCloseTo(1.4, 6);
    expect(fast.offroadSpeedFactor).toBeLessThan(KART.offroadSpeedFactor); // Bruno: offroad 2
    expect(kartConfigFor({ character: 2, kart: 0 }).offroadSpeedFactor).toBeCloseTo(0.85, 6); // Fizz: offroad 5
  });

  it('every loadout stays inside sane bounds', () => {
    for (let c = 0; c < CHARACTERS.length; c++)
      for (let k = 0; k < KART_BODIES.length; k++) {
        const cfg = kartConfigFor({ character: c, kart: k });
        expect(cfg.maxSpeed).toBeGreaterThanOrEqual(KART.maxSpeed * 0.975 - 1e-9);
        expect(cfg.maxSpeed).toBeLessThanOrEqual(KART.maxSpeed * 1.025 + 1e-9);
        expect(cfg.offroadSpeedFactor).toBeGreaterThanOrEqual(0.62 - 1e-9);
        expect(cfg.offroadSpeedFactor).toBeLessThanOrEqual(0.85 + 1e-9);
        expect(cfg.mass).toBeGreaterThan(0.5);
        expect(cfg.spinSpeedFactor).toBeGreaterThan(0.1);
        expect(cfg.spinSpeedFactor).toBeLessThan(0.5);
      }
    expect(STAT_KEYS.length).toBe(6);
  });

  it('bot loadouts are valid and vary between slots', () => {
    const set = new Set<string>();
    for (let slot = 0; slot < 4; slot++) {
      const l = botLoadoutFor(slot);
      expect(CHARACTERS[l.character]).toBeDefined();
      expect(KART_BODIES[l.kart]).toBeDefined();
      set.add(`${l.character}:${l.kart}`);
    }
    expect(set.size).toBe(4);
  });
});

describe('kart-vs-kart bumps use mass', () => {
  const head = (x: number): KartState => {
    const k = createKart(x, 0, 0);
    return k;
  };
  it('a heavy kart shoves a light one harder than the other way round', () => {
    const a = head(0); // light, faces +Z
    const b = head(1.2); // heavy, side by side, overlapping
    a.vel.x = 3; // a moves toward b
    b.vel.x = -3; // and b toward a: a head-on bump along x
    const mass: Record<number, number> = { 0: 0.6, 1: 1.4 };
    collideKarts(new Map([[0, a], [1, b]]), KART, (s) => mass[s]);
    // Momentum is conserved: m_a*v_a + m_b*v_b stays 0.6*3 - 1.4*3 = -2.4.
    expect(0.6 * a.vel.x + 1.4 * b.vel.x).toBeCloseTo(-2.4, 6);
    // The light kart's velocity changes much more than the heavy one's.
    expect(Math.abs(a.vel.x - 3)).toBeGreaterThan(Math.abs(b.vel.x + 3) * 2);
  });

  it('equal masses behave like before (symmetric)', () => {
    const a = head(0);
    const b = head(1.2);
    a.vel.x = 3;
    b.vel.x = -3;
    collideKarts(new Map([[0, a], [1, b]]));
    expect(a.vel.x).toBeCloseTo(-b.vel.x, 9);
  });
});

// ---------------------------------------------------------------------------
// Balance: every loadout finishes a lap, and no class is clearly better.
// ---------------------------------------------------------------------------

/** One lone bot drives one lap with this loadout; returns the lap time in seconds (Infinity = did not finish). */
function lapTime(track: Track, laps: number, loadout: Loadout): number {
  const world = new World(track, track);
  world.startRace([0], laps, new Map([[0, loadout]]));
  const cfg = world.configOf(0);
  const style = { ...botStyleFor(0), shortcutBias: 0 }; // everybody on the main road: same route for everyone
  let ticks = 0;
  while (world.race!.phase !== 'done' && ticks < 60 * 300) {
    world.tick((slot) => autopilot(world.karts.get(slot)!, track, style, cfg));
    ticks++;
  }
  const r = world.race!.racers.get(0)!;
  return r.finished ? r.finishTime! + 0 : Infinity;
}

// Light = Pip/Mochi/Fizz, medium = Juno/Bolt/Sable, heavy = Bruno/Rex (default Sprinter body).
const CLASS_REPS: Record<'light' | 'medium' | 'heavy', number[]> = { light: [0, 1, 2], medium: [3, 4, 5], heavy: [6, 7] };

describe.each(TRACKS.map((t) => [t.name, t] as const))('class balance on %s', (_name, def) => {
  const track = new Track(def);
  const results = new Map<string, number>(); // "c:k" -> time

  it('all 8 characters x 4 kart bodies finish a lap', () => {
    for (let c = 0; c < CHARACTERS.length; c++)
      for (let k = 0; k < KART_BODIES.length; k++) {
        const t = lapTime(track, 1, { character: c, kart: k });
        results.set(`${c}:${k}`, t);
        expect(t, `${CHARACTERS[c].name} + ${KART_BODIES[k].name}`).toBeLessThan(Infinity);
      }
    if (process.env.PRINT_LAPS) {
      const rows = CHARACTERS.map((ch, c) => `${ch.name.padEnd(6)} ${KART_BODIES.map((_, k) => results.get(`${c}:${k}`)!.toFixed(1).padStart(6)).join('')}`);
      console.log(`${def.name}\n${rows.join('\n')}`);
    }
  }, 120_000);

  it('light, medium and heavy lap times are within 4% of each other', () => {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const byClass = {} as Record<string, number>;
    for (const [cls, chars] of Object.entries(CLASS_REPS)) byClass[cls] = mean(chars.map((c) => lapTime(track, 1, { character: c, kart: 0 })));
    const times = Object.values(byClass);
    const spread = (Math.max(...times) - Math.min(...times)) / Math.min(...times);
    if (process.env.PRINT_LAPS) console.log(def.name, byClass, `spread ${(spread * 100).toFixed(2)}%`);
    expect(spread).toBeLessThan(0.04);
  }, 120_000);
});
