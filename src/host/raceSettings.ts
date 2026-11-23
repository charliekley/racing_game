/**
 * The RACERS lobby setting: how many karts are on the grid (4, 8 or 12). Everybody who is not a person
 * is filled in with computer drivers (bots). Pure logic, no DOM.
 *
 * Slots: people keep slots 0..3 (see playerSlots.ts, MAX_PLAYERS). The fill-in bots use slot
 * numbers from 4 up (4..11 when 4 people race; with fewer people the numbers simply continue, e.g. 4..13 for
 * 2 people + 10 bots: a slot number is just an id), so they never clash with a player, and `isFillBot(slot)` tells them apart.
 * Fill-in bots have no screen of their own: they are just karts (and far from every camera they use the cheap model).
 */
import { CHARACTERS, type Loadout } from '../shared/characters';
import { FIRST_FILL_BOT_SLOT, botColorsFor, colorHex } from '../shared/colors';
import { botLoadoutFor } from '../sim/classes';

/** The choices of the RACERS chip, in the order the R key cycles through them. */
export const RACER_COUNTS = [4, 8, 12] as const;
export type RacerCount = (typeof RACER_COUNTS)[number];
/** One player races three bots by default. */
export const DEFAULT_RACERS: RacerCount = 4;
/** The most karts that can race. */
export const MAX_RACERS = 12;
/** First slot used by fill-in bots (people and lobby bots use 0..MAX_PLAYERS-1; the constant lives in shared/colors.ts so the phones can use it too). */
export const FILL_BOT_BASE = FIRST_FILL_BOT_SLOT;

/** Anything stored or typed -> a valid count (the default for anything else). */
export function sanitizeRacers(value: unknown): RacerCount {
  const n = typeof value === 'string' ? Number(value) : value;
  return (RACER_COUNTS as readonly unknown[]).includes(n) ? (n as RacerCount) : DEFAULT_RACERS;
}

/** The next choice (4 -> 8 -> 12 -> 4). */
export function nextRacers(current: RacerCount): RacerCount {
  return RACER_COUNTS[(RACER_COUNTS.indexOf(current) + 1) % RACER_COUNTS.length];
}

/** True for the slots of fill-in bots (their karts have no player entry). */
export function isFillBot(slot: number): boolean {
  return slot >= FILL_BOT_BASE;
}

/**
 * Slots of the fill-in bots for a race. `entrants` = how many people / lobby bots are racing, `racers` = the
 * RACERS setting. Never fewer than the entrants (4 people with RACERS 4 get no bots), never more than 12 karts in all.
 */
export function fillBotSlots(entrants: number, racers: number): number[] {
  const total = Math.min(MAX_RACERS, Math.max(entrants, racers));
  const count = Math.max(0, total - entrants);
  return Array.from({ length: count }, (_, i) => FILL_BOT_BASE + i);
}

/** A fill-in bot's name and look for one race. */
export interface BotEntry {
  name: string;
  loadout: Loadout;
}

/**
 * Who the fill-in bots are: each bot is a CHARACTER and carries that character's name ("Pip", "Rex").
 *  - Characters no person picked come first, so bots look different from the people (and from each other).
 *  - With more bots than characters left, the list starts over; a repeat gets a number ("Pip 2", "Pip 3"),
 *    the first one keeps the plain name.
 * The same input always gives the same roster. `botSlots` = fillBotSlots(...), `humanCharacters` = the
 * characters the people picked (indices into CHARACTERS). The karts keep their usual varied bodies (botLoadoutFor).
 */
export function buildBotRoster(botSlots: readonly number[], humanCharacters: readonly number[]): Map<number, BotEntry> {
  const n = CHARACTERS.length;
  // A fixed, scrambled order of all characters, so the bots are not always the first ones in the list.
  const scrambled = Array.from({ length: n }, (_, i) => i).sort((a, b) => ((a * 3 + 1) % n) - ((b * 3 + 1) % n) || a - b);
  const free = scrambled.filter((c) => !humanCharacters.includes(c));
  const order = [...free, ...scrambled]; // free characters first, then everybody again for the repeats
  const used = new Map<number, number>(); // character -> how many bots have it so far
  const roster = new Map<number, BotEntry>();
  botSlots.forEach((slot, i) => {
    const character = order[i % order.length];
    const count = (used.get(character) ?? 0) + 1;
    used.set(character, count);
    const base = CHARACTERS[character].name;
    roster.set(slot, { name: count === 1 ? base : `${base} ${count}`, loadout: { character, kart: botLoadoutFor(slot).kart } });
  });
  return roster;
}

/** Colour of every fill-in bot in a race, given the colours (hex) of the people / lobby bots racing. */
export function fillBotColors(peopleHex: readonly string[], botSlots: readonly number[]): Map<number, string> {
  return botColorsFor(peopleHex, botSlots);
}

/** Colour of `slot`: the player's colour index when it has one, else the fill-in colour. */
export function slotColor(slot: number, playerColor: number | undefined, fill: ReadonlyMap<number, string>): string {
  return fill.get(slot) ?? colorHex(playerColor ?? slot);
}

/**
 * The toast text a hit earns the ATTACKER ("HIT NAME!"), or null when there is none:
 * bots do not get one, so it only says something when the victim is a person. Pure so it can be tested.
 */
export function attackToast(victimName: string, victimIsHuman: boolean): string | null {
  return victimIsHuman ? `HIT ${victimName}!` : null;
}
