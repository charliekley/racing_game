/** Kart colors players can choose. The index into this array is what goes over the network. */
export const KART_COLORS = [
  { name: 'Red', hex: '#e63946' },
  { name: 'Blue', hex: '#3a86ff' },
  { name: 'Green', hex: '#2bb673' },
  { name: 'Yellow', hex: '#ffbe0b' },
  { name: 'Purple', hex: '#8338ec' },
  { name: 'Orange', hex: '#fb5607' },
  { name: 'Pink', hex: '#ff4fa3' },
  { name: 'Teal', hex: '#14b8b8' },
] as const;

export function colorHex(index: number): string {
  const n = KART_COLORS.length;
  return KART_COLORS[((index % n) + n) % n].hex;
}

export function clampColorIndex(index: unknown): number {
  const n = typeof index === 'number' && Number.isInteger(index) ? index : 0;
  return Math.max(0, Math.min(KART_COLORS.length - 1, n));
}

// ---------------------------------------------------------------------------
// Colours for up to 12 karts. People (and lobby bots) choose from KART_COLORS above; the computer drivers
// that fill the field up to the RACERS count (slots 4..11, see host/raceSettings.ts) get colours nobody else
// in the race has: the four extra ones below first, then whichever of the eight are not taken.
// ---------------------------------------------------------------------------

/** Slots from here up belong to fill-in bots (the RACERS setting); people and lobby bots use 0..3. Equal to MAX_PLAYERS (tested). */
export const FIRST_FILL_BOT_SLOT = 4;

/** Four more colours, used by fill-in bots only (people cannot pick them). */
export const EXTRA_BOT_COLORS = [
  { name: 'Lime', hex: '#a6e22e' },
  { name: 'Silver', hex: '#d9dde3' },
  { name: 'Brown', hex: '#8d5a2b' },
  { name: 'Sky', hex: '#67d7ff' },
] as const;

/** All twelve colours: the player ones, then the extras. */
export const ALL_KART_HEX: readonly string[] = [...KART_COLORS.map((c) => c.hex), ...EXTRA_BOT_COLORS.map((c) => c.hex)];

/**
 * Colours for the fill-in bots. `takenHex` = what the people (and lobby bots) already use; each bot slot gets
 * its own colour out of the rest (extras first, so the bots do not look like the players).
 * A pure function of its inputs, so the TV and the phones' maps (which only know the people's colours) agree.
 */
export function botColorsFor(takenHex: readonly string[], botSlots: readonly number[]): Map<number, string> {
  const taken = new Set(takenHex.map((h) => h.toLowerCase()));
  const pool = [...EXTRA_BOT_COLORS.map((c) => c.hex), ...KART_COLORS.map((c) => c.hex)].filter((h) => !taken.has(h.toLowerCase()));
  const out = new Map<number, string>();
  [...botSlots].sort((a, b) => a - b).forEach((slot, i) => out.set(slot, pool[i % pool.length] ?? ALL_KART_HEX[i % ALL_KART_HEX.length]));
  return out;
}
