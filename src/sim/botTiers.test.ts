/**
 * Persistent bot skill tiers: every fill-in bot of a series has a fixed rating, so in a Grand Prix the strong bots
 * finish near the front race after race and the weak ones near the back (with some variation from items and traffic).
 */
import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../shared/characters';
import { buildBotRoster } from '../host/raceSettings';
import { FIRST_FILL_BOT_SLOT } from '../shared/colors';
import { TRACKS } from '../track';
import { BotPack, DIFFICULTIES, SKILLS, skillAt, tierLevel, type Difficulty } from './bots';
import { botLoadoutFor } from './classes';
import { BOTS } from './config';
import { Track } from './track';
import { World } from './world';

describe('skillAt', () => {
  it('rating 0.5 is the plain table of the difficulty', () => {
    for (const d of DIFFICULTIES) expect(skillAt(d, 0.5)).toEqual(SKILLS[d]);
  });

  it('on Normal the best bot is close to Hard and the weakest close to Easy', () => {
    const top = skillAt('normal', 1);
    const low = skillAt('normal', 0);
    expect(tierLevel('normal', 1)).toBeCloseTo(1 + BOTS.tier.spread);
    expect(tierLevel('normal', 0)).toBeCloseTo(1 - BOTS.tier.spread);
    expect(top.pace).toBeGreaterThan(SKILLS.normal.pace + 0.8 * (SKILLS.hard.pace - SKILLS.normal.pace));
    expect(low.pace).toBeLessThan(SKILLS.normal.pace - 0.8 * (SKILLS.normal.pace - SKILLS.easy.pace));
  });

  it('every number gets monotonically better with the rating', () => {
    for (const d of DIFFICULTIES) {
      let prev = skillAt(d, 0);
      for (let r = 0.1; r <= 1.0001; r += 0.1) {
        const s = skillAt(d, r);
        expect(s.pace).toBeGreaterThanOrEqual(prev.pace - 1e-9);
        expect(s.itemDelay).toBeLessThanOrEqual(prev.itemDelay + 1e-9);
        expect(s.steerGain).toBeGreaterThanOrEqual(prev.steerGain - 1e-9);
        expect(s.cornerBonus).toBeGreaterThanOrEqual(prev.cornerBonus - 1e-9);
        expect(s.stallChance).toBeLessThanOrEqual(prev.stallChance + 1e-9);
        // Mistakes: "0 = never" is the best value; otherwise a longer gap is better.
        const gap = (e: number) => (e === 0 ? Infinity : e);
        expect(gap(s.mistakeEvery)).toBeGreaterThanOrEqual(gap(prev.mistakeEvery) - 1e-9);
        prev = s;
      }
    }
  });
});

describe('the roster carries the tiers', () => {
  it('spreads ratings from 1 (first bot) to 0 (last), for any number of characters', () => {
    const slots = Array.from({ length: 11 }, (_, i) => FIRST_FILL_BOT_SLOT + i);
    const roster = buildBotRoster(slots, [0]);
    const ratings = slots.map((s) => roster.get(s)!.rating);
    expect(ratings[0]).toBe(1);
    expect(ratings[10]).toBe(0);
    for (let i = 1; i < ratings.length; i++) expect(ratings[i]).toBeLessThan(ratings[i - 1]);
    expect(buildBotRoster([FIRST_FILL_BOT_SLOT], []).get(FIRST_FILL_BOT_SLOT)!.rating).toBe(0.5);
    expect(CHARACTERS.length).toBeGreaterThan(0);
  });
});

/** Race `tracks` in a row with the same 12-bot roster; returns each slot's finishing place per race. */
function grandPrix(difficulty: Difficulty, trackDefs: typeof TRACKS, laps: number, humanProxy = false): { slots: number[]; places: Map<number, number[]> } {
  // humanProxy: slot 0 is a "good person" (a Hard bot driving at its plain table, flagged as human for the rubber band) plus 11 fill-in bots.
  const botSlots = Array.from({ length: humanProxy ? 11 : 12 }, (_, i) => FIRST_FILL_BOT_SLOT + i);
  const slots = humanProxy ? [0, ...botSlots] : botSlots;
  const roster = buildBotRoster(botSlots, []); // built ONCE, reused for every race
  const ratings = new Map(botSlots.map((s) => [s, roster.get(s)!.rating] as const));
  const places = new Map<number, number[]>(slots.map((s) => [s, []]));
  for (const def of trackDefs) {
    const track = new Track(def);
    const world = new World(track, track);
    world.startRace(slots, laps, new Map(slots.map((s) => [s, roster.get(s)?.loadout ?? botLoadoutFor(s)])));
    const pack = new BotPack(difficulty, (slot) => slot === 0 && humanProxy, ratings);
    const hard = new BotPack('hard');
    let ticks = 0;
    while (world.race!.phase !== 'done' && ticks < 60 * 420) {
      world.tick((slot) => (slot === 0 && humanProxy ? hard.input(world, slot) : pack.input(world, slot)));
      ticks++;
    }
    for (const r of world.race!.racers.values()) places.get(r.slot)!.push(r.place ?? 12);
  }
  return { slots, places };
}

describe('Grand Prix with persistent tiers (12 bots, 4 races)', () => {
  it('strong bots finish near the front every race, weak bots near the back', () => {
    const gp = grandPrix('normal', TRACKS.slice(0, 4), 2);
    const rows = gp.slots.map((s, i) => ({ tier: i + 1, places: gp.places.get(s)!, avg: gp.places.get(s)!.reduce((a, b) => a + b, 0) / 4 }));
    console.log('tier  places per race   avg\n' + rows.map((r) => `${String(r.tier).padStart(2)}    ${r.places.map((p) => String(p).padStart(2)).join(' ')}      ${r.avg.toFixed(2)}`).join('\n'));
    const top = rows.slice(0, 3);
    const bottom = rows.slice(-3);
    // Top-3 tier bots average in the front half, bottom-3 in the back half; and every top bot beats every bottom bot on average.
    for (const r of top) expect(r.avg).toBeLessThanOrEqual(6);
    for (const r of bottom) expect(r.avg).toBeGreaterThanOrEqual(7);
    expect(Math.max(...top.map((r) => r.avg))).toBeLessThan(Math.min(...bottom.map((r) => r.avg)));
    // Rank correlation of tier and average place is strong (a perfectly kept order would be 1).
    const mean = 6.5;
    const cov = rows.reduce((a, r) => a + (r.tier - mean) * (r.avg - mean), 0);
    const varT = rows.reduce((a, r) => a + (r.tier - mean) ** 2, 0);
    const varA = rows.reduce((a, r) => a + (r.avg - mean) ** 2, 0);
    expect(cov / Math.sqrt(varT * varA)).toBeGreaterThan(0.8);
  }, 600_000);
});

describe('a good person against the tiers (Hard-bot stand-in + 11 tiered Normal bots)', () => {
  it('fights the top two bots for the lead, ahead of the back of the field', () => {
    const gp = grandPrix('normal', TRACKS.slice(0, 4), 2, true);
    const avg = (s: number) => gp.places.get(s)!.reduce((a, b) => a + b, 0) / 4;
    console.log('person: ' + gp.places.get(0)!.join(' ') + '\n' + gp.slots.slice(1).map((s, i) => `tier ${i + 1}: ${gp.places.get(s)!.join(' ')}`).join('\n'));
    expect(avg(0)).toBeLessThanOrEqual(6); // the person is in the front half...
    const top2 = (avg(FIRST_FILL_BOT_SLOT) + avg(FIRST_FILL_BOT_SLOT + 1)) / 2;
    expect(top2).toBeLessThan(6); // ...and the two best bots are in the same group
    expect(avg(FIRST_FILL_BOT_SLOT + 10)).toBeGreaterThan(avg(FIRST_FILL_BOT_SLOT));
  }, 600_000);
});
