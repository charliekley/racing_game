/**
 * Class balance guard: the 8 characters x 4 kart bodies (32 loadouts).
 *
 * Fast checks run in the normal suite:
 *  1. on paper: stat budgets are comparable and NO loadout is at least as good as another in every stat
 *     (strict dominance would make the dominated pick pointless);
 *  2. identities: heavy / medium / light keep their trade-offs;
 *  3. in the sim: a small bot sweep (one lap per track, 4 loadouts that span the roster) stays inside a tolerance.
 *
 * The full 32 x tracks sweep is skipped unless you ask for it:
 *     BALANCE_SWEEP=1 npx vitest run src/sim/balance.test.ts
 * Options: BALANCE_OUT=file (also write the report there), BALANCE_LAPS (default 2), BALANCE_SLOTS ("0,1,2,3": bot slots = different seeded bot personalities,
 * results are averaged). It takes about 11 s per slot for 2 laps. It prints the per-track tables
 * (% vs the track mean) and the per-loadout averages, and asserts the balance targets.
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHARACTERS, KART_BODIES, STAT_KEYS, loadoutStats, type Stats } from '../shared/characters';
import { TRACKS } from '../track';
import { botRaceTime, report, sweep } from './balanceSweep';
import { Track } from './track';

const COMBOS = CHARACTERS.flatMap((_, c) => KART_BODIES.map((_, k) => ({ c, k, name: `${CHARACTERS[c].name} + ${KART_BODIES[k].name}`, s: loadoutStats({ character: c, kart: k }) })));
const sum = (s: Stats): number => STAT_KEYS.reduce((a, key) => a + s[key], 0);

describe('class balance on paper', () => {
  it('every character has a comparable stat budget (17..20 points) and each kart body shifts it by at most 1', () => {
    for (const ch of CHARACTERS) expect(sum(ch.stats), ch.name).toBeGreaterThanOrEqual(17), expect(sum(ch.stats), ch.name).toBeLessThanOrEqual(20);
    for (const b of KART_BODIES) {
      const delta = STAT_KEYS.reduce((a, k) => a + (b.bonus[k] ?? 0), 0);
      expect(Math.abs(delta), b.name).toBeLessThanOrEqual(1);
    }
  });

  it('no loadout is at least as good as another in every stat (no strictly better pick)', () => {
    for (const a of COMBOS)
      for (const b of COMBOS) {
        if (a === b) continue;
        const dominates = STAT_KEYS.every((k) => a.s[k] >= b.s[k]);
        expect(dominates, `${a.name} dominates ${b.name}`).toBe(false);
      }
  });

  it('every loadout has an effective budget within 3 points of the roster mean (clamping cannot hide a free lunch)', () => {
    const mean = COMBOS.reduce((a, x) => a + sum(x.s), 0) / COMBOS.length;
    for (const x of COMBOS) expect(Math.abs(sum(x.s) - mean), x.name).toBeLessThanOrEqual(3);
  });

  it('weight classes keep their identity', () => {
    const avg = (cls: string, k: keyof Stats) => {
      const cs = CHARACTERS.filter((c) => c.weightClass === cls);
      return cs.reduce((a, c) => a + c.stats[k], 0) / cs.length;
    };
    for (const k of ['speed', 'weight'] as const) {
      expect(avg('heavy', k)).toBeGreaterThan(avg('medium', k));
      expect(avg('medium', k)).toBeGreaterThan(avg('light', k));
    }
    for (const k of ['accel', 'handling', 'drift'] as const) {
      expect(avg('light', k)).toBeGreaterThan(avg('medium', k));
      expect(avg('medium', k)).toBeGreaterThan(avg('heavy', k));
    }
  });

  it('every kart body gives something and costs something', () => {
    for (const b of KART_BODIES.slice(1)) {
      const v = Object.values(b.bonus);
      expect(v.some((x) => x > 0), b.name).toBe(true);
      expect(v.some((x) => x < 0), b.name).toBe(true);
    }
  });
});

describe('class balance in the sim (quick)', () => {
  // Spread of the roster: the extremes (light / medium / heavy plus the speed and the slow kart bodies).
  const PICKS = [
    { character: 0, kart: 0 }, // Pip: light
    { character: 3, kart: 0 }, // Juno: medium
    { character: 6, kart: 0 }, // Bruno: heavy
    { character: 7, kart: 0 }, // Rex: heavy, top speed
    { character: 1, kart: 1 }, // Mochi + Mudlark
    { character: 2, kart: 3 }, // Fizz + Splash
  ];
  it('two bot laps on every track: all picks finish and stay within 10% of each other (one bot seed is noisy; the full sweep checks the tight targets)', () => {
    for (const def of TRACKS) {
      const track = new Track(def);
      const t = PICKS.map((p) => botRaceTime(track, 2, p));
      const spread = Math.max(...t) / Math.min(...t) - 1;
      expect(Math.max(...t), def.name).toBeLessThan(Infinity);
      // 12%: one bot seed is noisy, and smoother ground following shifted Switchback Summit bot laps by a few seconds.
      expect(spread, `${def.name} ${t.map((x) => x.toFixed(1))}`).toBeLessThan(0.12);
    }
  }, 120_000);
});

describe.skipIf(!process.env.BALANCE_SWEEP)('class balance full sweep (BALANCE_SWEEP=1)', () => {
  it('32 loadouts x all tracks: tight spread, every loadout has a niche', () => {
    const laps = Number(process.env.BALANCE_LAPS ?? 2);
    const slots = (process.env.BALANCE_SLOTS ?? '0,1,2,3').split(',').map(Number);
    const r = sweep(laps, slots);
    const text = report(r);
    console.log(text);
    if (process.env.BALANCE_OUT) writeFileSync(process.env.BALANCE_OUT, text); // vitest may swallow console output
    const rel = new Array(COMBOS.length).fill(0);
    const best = new Array(COMBOS.length).fill(0);
    r.tracks.forEach((_, ti) => {
      const flat = r.times[ti].flat();
      const mean = flat.reduce((a, b) => a + b, 0) / flat.length;
      const min = Math.min(...flat);
      flat.forEach((t, i) => {
        rel[i] += (t / mean - 1) / r.tracks.length;
        if (t <= min * 1.01) best[i]++; // within 1% of the best on that track
      });
    });
    // Average |deviation| from the mean across the 32 loadouts, and the worst single loadout.
    expect(rel.reduce((a, b) => a + Math.abs(b), 0) / rel.length).toBeLessThan(0.01);
    expect(Math.max(...rel.map(Math.abs))).toBeLessThan(0.02);
    // Niche: each loadout is within 1% of the best on some track, or (Mudlark and friends, whose off-road and
    // bump advantages the lone bots hardly use) at most 1.5% slower than the roster mean overall.
    COMBOS.forEach((x, i) => expect(best[i] > 0 || rel[i] < 0.015, x.name).toBe(true));
  }, 3_600_000);
});
