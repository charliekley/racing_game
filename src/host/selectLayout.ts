/**
 * Pure helpers for the TV selection screen (no DOM, no Three.js, so they can be unit tested):
 * how the player quadrants are arranged, and what the stat bars show.
 */
import { CHARACTERS, KART_BODIES, STAT_KEYS, loadoutStats, type StatKey } from '../shared/characters';

/** How many player quadrants fit on the screen (the game has up to 4 human players). */
export const MAX_QUADRANTS = 4;

export interface QuadrantLayout {
  /** Grid columns and rows (CSS grid). */
  cols: number;
  rows: number;
  /** Cell (0-based column, row) of each player's quadrant, in player order. */
  cells: { col: number; row: number }[];
  /** Free cells left over (the screen shows a "join" hint in the first one). */
  spare: number;
}

/**
 * Quadrants for `players` humans: 1 = the whole screen, 2 = side by side, 3-4 = a 2x2 grid (with 3 players
 * the fourth cell stays free). 0 is treated like 1 (an empty "waiting for players" cell).
 */
export function quadrantLayout(players: number): QuadrantLayout {
  const n = Math.max(1, Math.min(MAX_QUADRANTS, Math.floor(players) || 1));
  const cols = n === 1 ? 1 : 2;
  const rows = n <= 2 ? 1 : 2;
  const cells = Array.from({ length: n }, (_, i) => ({ col: i % cols, row: Math.floor(i / cols) }));
  return { cols, rows, cells, spare: cols * rows - n };
}

/** Short labels for the six stats (three letters, like the dials on an arcade cabinet). */
export const STAT_LABELS: Record<StatKey, string> = {
  speed: 'SPD', accel: 'ACC', handling: 'HND', weight: 'WGT', drift: 'DFT', offroad: 'OFF',
};

export interface StatBar {
  key: StatKey;
  label: string;
  /** Total points (1..5) with the kart body's bonus applied. */
  total: number;
  /** Points the character has on their own. */
  base: number;
  /** How many points the kart body adds (shown in a different colour), and how many it takes away. */
  bonus: number;
  lost: number;
}

/**
 * The six stat bars for a character in a kart body. `kart` = -1 shows the character alone (character stage):
 * then bonus and lost are 0. While choosing a kart, the green/red segments show what the body changes.
 */
export function statBars(character: number, kart: number): StatBar[] {
  const base = CHARACTERS[character].stats;
  const total = loadoutStats({ character, kart: kart < 0 ? 0 : kart });
  const none = kart < 0;
  return STAT_KEYS.map((key) => {
    const t = none ? base[key] : total[key];
    return {
      key,
      label: STAT_LABELS[key],
      total: t,
      base: base[key],
      bonus: Math.max(0, t - base[key]),
      lost: Math.max(0, base[key] - t),
    };
  });
}

/** Words for a weight class on the character card. */
export const CLASS_LABEL = { light: 'LIGHT', medium: 'MEDIUM', heavy: 'HEAVY' } as const;

/** Name of the body, for the kart card (kept here so the view does not need to know the list). */
export const kartName = (kart: number): string => KART_BODIES[kart]?.name ?? '';
