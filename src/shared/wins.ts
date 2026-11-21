/**
 * Race wins for the session ("crowns"). PURE LOGIC, shared by the host and the phone.
 *
 * Every time someone finishes 1st in any race (any mode), their tally goes up by one. The tally lives as long
 * as the room: the host keeps one WinTally per room, so a new room starts everyone at zero again.
 *
 * Who is "someone"? A string key that stays the same across races (see winKey in src/host/postRace.ts):
 * a phone's clientId, a lobby bot's id, or a fill-in bot's name. Slot numbers alone are not enough,
 * because a player who leaves and a new player who joins can get the same slot.
 */

export class WinTally {
  private readonly wins = new Map<string, number>();

  /** One more race win for `key`. */
  record(key: string): void {
    this.wins.set(key, (this.wins.get(key) ?? 0) + 1);
  }

  /** Race wins so far (0 for anyone never seen). */
  get(key: string): number {
    return this.wins.get(key) ?? 0;
  }

  /** Forget everything (a new room). */
  clear(): void {
    this.wins.clear();
  }
}

/** The crown symbol drawn next to a name. One place to change it. */
export const CROWN = '\u{1F451}';

/**
 * The text shown next to a name: "" for nobody with zero wins (keeps the screen clean), else crown + count,
 * e.g. "👑3". Always set it with textContent.
 */
export function crownLabel(wins: number): string {
  const n = Math.max(0, Math.floor(Number.isFinite(wins) ? wins : 0));
  return n > 0 ? `${CROWN}${n}` : '';
}

/** Validate a win count that came over the network (from the host). Anything odd becomes 0. */
export function sanitizeWins(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(999, Math.floor(x)) : 0;
}
