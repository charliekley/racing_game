/**
 * The drivers and kart bodies a player can pick. PURE DATA: no Three.js, no DOM,
 * so the phone, the host UI, the simulation and the renderer can all import it.
 *
 * A player's setup = one CHARACTER (who drives: decides the weight class and
 * the driver's look) + one KART BODY (what they drive: small stat tweaks).
 * The numbers here are "stat points" from 1 (worst) to 5 (best), like the bars
 * on a kart-select screen. `src/sim/classes.ts` turns the points into real
 * physics numbers (top speed in m/s and so on).
 *
 * Everything is original: the names and looks are ours.
 */

/** Stat points, each 1..5. */
export interface Stats {
  /** Top speed. */
  speed: number;
  /** Acceleration (how fast you get back up to speed after a hit). */
  accel: number;
  /** Turning and grip. */
  handling: number;
  /** Heavier karts shove lighter ones aside in a bump. */
  weight: number;
  /** How quickly the drift mini-turbo charges. */
  drift: number;
  /** How little grass and dirt slow you down. */
  offroad: number;
}

export const STAT_KEYS = ['speed', 'accel', 'handling', 'weight', 'drift', 'offroad'] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export type WeightClass = 'light' | 'medium' | 'heavy';

/** How the driver looks. The renderer (kartModel.ts) builds the model from this. */
export interface DriverLook {
  /** What kind of creature: decides the head shape, ears, snout and so on. */
  species: 'chick' | 'cat' | 'frog' | 'astronaut' | 'robot' | 'fox' | 'bear' | 'dino';
  /** Main body/fur/suit colour. */
  primary: string;
  /** Second colour (belly, visor, markings). */
  secondary: string;
  /** Overall size of the driver: light drivers are small, heavy ones big. */
  scale: number;
}

export interface CharacterDef {
  id: string;
  name: string;
  /** One short line for the picker. */
  blurb: string;
  weightClass: WeightClass;
  stats: Stats;
  look: DriverLook;
}

/** Base points per weight class; each character nudges them a little. */
const LIGHT: Stats = { speed: 2, accel: 5, handling: 4, weight: 1, drift: 4, offroad: 3 };
const MEDIUM: Stats = { speed: 3, accel: 3, handling: 3, weight: 3, drift: 3, offroad: 3 };
const HEAVY: Stats = { speed: 5, accel: 2, handling: 2, weight: 5, drift: 2, offroad: 2 };

/** The index in this list is what goes over the network and into saved settings. Only ever append. */
export const CHARACTERS: readonly CharacterDef[] = [
  { id: 'pip', name: 'Pip', blurb: 'Tiny chick, instant pickup', weightClass: 'light', stats: { ...LIGHT, accel: 5, handling: 5, speed: 1 }, look: { species: 'chick', primary: '#ffd84a', secondary: '#ff8a2a', scale: 0.82 } },
  { id: 'mochi', name: 'Mochi', blurb: 'Nimble cat, drift artist', weightClass: 'light', stats: { ...LIGHT, drift: 5, accel: 4 }, look: { species: 'cat', primary: '#f4f1ea', secondary: '#f2a7b8', scale: 0.86 } },
  { id: 'fizz', name: 'Fizz', blurb: 'Bouncy frog, loves the rough', weightClass: 'light', stats: { ...LIGHT, offroad: 5, handling: 3 }, look: { species: 'frog', primary: '#5fd068', secondary: '#f6f38a', scale: 0.88 } },
  { id: 'juno', name: 'Juno', blurb: 'Astronaut, good at everything', weightClass: 'medium', stats: { ...MEDIUM }, look: { species: 'astronaut', primary: '#f2f4f8', secondary: '#3aa0ff', scale: 1.0 } },
  { id: 'bolt', name: 'Bolt', blurb: 'Robot with a quick launch', weightClass: 'medium', stats: { ...MEDIUM, accel: 4, drift: 2 }, look: { species: 'robot', primary: '#b9c4d0', secondary: '#ffcf33', scale: 1.0 } },
  { id: 'sable', name: 'Sable', blurb: 'Sly fox, sharp in corners', weightClass: 'medium', stats: { ...MEDIUM, handling: 4, drift: 4, weight: 2 }, look: { species: 'fox', primary: '#e8742c', secondary: '#fff4e0', scale: 0.96 } },
  { id: 'bruno', name: 'Bruno', blurb: 'Big bear, big bumps', weightClass: 'heavy', stats: { ...HEAVY }, look: { species: 'bear', primary: '#8a5a3c', secondary: '#e6c9a0', scale: 1.16 } },
  { id: 'rex', name: 'Rex', blurb: 'Dino, flat-out top speed', weightClass: 'heavy', stats: { ...HEAVY, weight: 4, handling: 3, accel: 1 }, look: { species: 'dino', primary: '#3fae8f', secondary: '#f2e56b', scale: 1.12 } },
];

export interface KartBodyDef {
  /** Same ids, same order as KART_STYLES in src/render/kartModel.ts. */
  id: 'sprinter' | 'mudlark' | 'comet' | 'splash';
  name: string;
  blurb: string;
  /** Added to the character's points (the total is clamped to 1..5). */
  bonus: Partial<Stats>;
}

/** The index is the `style` that `buildKartModel` takes. Only ever append. */
export const KART_BODIES: readonly KartBodyDef[] = [
  { id: 'sprinter', name: 'Sprinter', blurb: 'Balanced open-wheel kart', bonus: {} },
  { id: 'mudlark', name: 'Mudlark', blurb: 'Buggy: great off-road, heavy', bonus: { offroad: 2, weight: 1, speed: -1, drift: -1 } },
  { id: 'comet', name: 'Comet', blurb: 'Bullet: fast, wide turns', bonus: { speed: 1, handling: -1, offroad: -1 } },
  { id: 'splash', name: 'Splash', blurb: 'Bathtub: quick and slidey', bonus: { accel: 1, drift: 1, speed: -1, weight: -1 } },
];

/** What a player picked. Both are indices into the lists above. */
export interface Loadout {
  character: number;
  kart: number;
}

export const DEFAULT_LOADOUT: Readonly<Loadout> = Object.freeze({ character: 3, kart: 0 });

const clampIndex = (v: unknown, n: number, fallback: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n ? v : fallback;

/** Make any value (for example from the network) into a valid loadout. */
export function sanitizeLoadout(v: unknown): Loadout {
  const o = (typeof v === 'object' && v !== null ? v : {}) as { character?: unknown; kart?: unknown };
  return {
    character: clampIndex(o.character, CHARACTERS.length, DEFAULT_LOADOUT.character),
    kart: clampIndex(o.kart, KART_BODIES.length, DEFAULT_LOADOUT.kart),
  };
}

/** Character points plus the kart body's bonus, each clamped to 1..5. */
export function loadoutStats(l: Loadout): Stats {
  const c = CHARACTERS[l.character].stats;
  const b = KART_BODIES[l.kart].bonus;
  const out = {} as Stats;
  for (const k of STAT_KEYS) out[k] = Math.max(1, Math.min(5, c[k] + (b[k] ?? 0)));
  return out;
}
