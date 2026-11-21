/**
 * Balance sweep harness: every character x kart body on every track, driven by the same full bot.
 * Used by balance.test.ts (small sample, fast) and by the full sweep (BALANCE_SWEEP=1, see balance.test.ts).
 * Pure sim, no DOM.
 */
import { CHARACTERS, KART_BODIES, type Loadout } from '../shared/characters';
import { TRACKS } from '../track';
import { BotPack, type Difficulty } from './bots';
import { Track } from './track';
import { World } from './world';

/** One lone bot drives `laps` laps; returns the race time in seconds (Infinity = did not finish in 300 s). */
export function botRaceTime(track: Track, laps: number, loadout: Loadout, slot = 0, difficulty: Difficulty = 'normal'): number {
  const world = new World(track, track);
  world.startRace([slot], laps, new Map([[slot, loadout]]));
  const pack = new BotPack(difficulty);
  let ticks = 0;
  while (!world.race!.racers.get(slot)!.finished && ticks < 60 * 300) {
    world.tick((s) => pack.input(world, s));
    ticks++;
  }
  return world.race!.racers.get(slot)!.finishTime ?? Infinity;
}

export interface SweepResult {
  tracks: string[];
  /** times[track][character][kart] in seconds (mean over the slots used). */
  times: number[][][];
}

/** Run the sweep. `slots` are bot slot numbers: each slot has its own seeded bot personality noise, so more slots = more "seeds". */
export function sweep(laps: number, slots: number[], trackNames?: string[]): SweepResult {
  const defs = TRACKS.filter((t) => !trackNames || trackNames.includes(t.name));
  const times = defs.map((def) => {
    const track = new Track(def);
    return CHARACTERS.map((_, c) =>
      KART_BODIES.map((_, k) => slots.reduce((a, s) => a + botRaceTime(track, laps, { character: c, kart: k }, s), 0) / slots.length));
  });
  return { tracks: defs.map((d) => d.name), times };
}

/** Per-track tables (% vs track mean) and the per-combo average over tracks, as text. */
export function report(r: SweepResult): string {
  const out: string[] = [];
  const nk = KART_BODIES.length;
  const combos = CHARACTERS.length * nk;
  const rel: number[] = new Array(combos).fill(0);
  const near: number[] = new Array(combos).fill(0);
  r.tracks.forEach((name, ti) => {
    const flat = r.times[ti].flat();
    const mean = flat.reduce((a, b) => a + b, 0) / combos;
    const best = Math.min(...flat);
    out.push(`${name}: mean ${mean.toFixed(1)} s, best ${(best / mean * 100 - 100).toFixed(2)}%, worst ${(Math.max(...flat) / mean * 100 - 100).toFixed(2)}%   (cols: ${KART_BODIES.map((b) => b.name).join(' ')})`);
    CHARACTERS.forEach((ch, c) => {
      out.push(`  ${ch.name.padEnd(6)}${KART_BODIES.map((_, k) => (r.times[ti][c][k] / mean * 100 - 100).toFixed(2).padStart(8)).join('')}`);
      KART_BODIES.forEach((_, k) => { rel[c * nk + k] += r.times[ti][c][k] / mean - 1; });
    });
    flat.forEach((t, i) => { if (t <= best * 1.003) near[i]++; });
    const top = flat.map((t, i) => ({ t, n: `${CHARACTERS[Math.floor(i / nk)].name}+${KART_BODIES[i % nk].name}` })).sort((a, b) => a.t - b.t).slice(0, 3);
    out.push(`  best 3: ${top.map((x) => `${x.n} ${x.t.toFixed(1)}s`).join(', ')}`);
  });
  out.push('Average over tracks, % vs mean (+ = slower) / number of tracks within 0.3% of the best:');
  CHARACTERS.forEach((ch, c) => out.push(`  ${ch.name.padEnd(6)}${KART_BODIES.map((_, k) => `${(rel[c * nk + k] / r.tracks.length * 100).toFixed(2).padStart(7)}/${near[c * nk + k]}`).join('')}`));
  out.push(`mean |deviation| ${(rel.reduce((a, b) => a + Math.abs(b / r.tracks.length), 0) / combos * 100).toFixed(2)}%`);
  return out.join('\n');
}
