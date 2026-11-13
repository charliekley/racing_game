/**
 * The race "series" state machine: which mode we are in, which track is next,
 * who has how many points, and who gets to choose. Pure logic (no DOM, no
 * network) so it can be unit tested; main.ts does the wiring.
 *
 * Three modes (picked on the first player's phone, or with the arrow keys on the host):
 *   single - one race on a chosen track, then back to the menu.
 *   gp     - Grand Prix: all tracks in order, points by finishing place, final podium.
 *   loser  - after each race the last-place HUMAN picks the next track; the menu
 *            owner (P1) ends the series with STOP. Points are kept like in a GP.
 */
import { sanitizeMode, sanitizeTrackIndex, SERIES_MODES, type SeriesMode } from '../shared/protocol';

export { sanitizeMode, sanitizeTrackIndex, SERIES_MODES };
export type { SeriesMode };
export const DEFAULT_MODE: SeriesMode = 'single';

export const MODE_NAMES: Record<SeriesMode, string> = {
  single: 'Single race',
  gp: 'Grand Prix',
  loser: 'Loser picks',
};

/**
 * Points per finishing place (index 0 = 1st). There are at most 4 racers (humans + bots),
 * so four entries cover everybody. Change the numbers here and everything follows.
 */
export const GP_POINTS: readonly number[] = [10, 7, 5, 3];

export function pointsForPlace(place: number): number {
  return GP_POINTS[place - 1] ?? 0;
}

export function nextMode(m: SeriesMode, step = 1): SeriesMode {
  const i = SERIES_MODES.indexOf(m);
  return SERIES_MODES[(i + step + SERIES_MODES.length) % SERIES_MODES.length];
}

/** One racer's result in a finished race. `place` is 1-based and unique. */
export interface Placing {
  slot: number;
  place: number;
  /** True for people (phone / keyboard / gamepad), false for bots: only humans may pick the next track. */
  human: boolean;
}

export interface StandingRow {
  slot: number;
  points: number;
  /** 1-based rank; always unique (ties are broken, see `standings`). */
  rank: number;
}

/** 'between' = results are showing, waiting for the next race; 'over' = series finished (podium). */
export type SeriesStage = 'racing' | 'between' | 'over';

export class Series {
  /** Track index of the current race (or the next one while 'between'). */
  trackIndex: number;
  /** How many races are finished. */
  racesDone = 0;
  stage: SeriesStage = 'racing';
  /** Places of the most recent race, best first. */
  lastPlacings: Placing[] = [];

  private readonly points = new Map<number, number>();
  /** slot -> how often they finished 1st, 2nd, 3rd... (the tie-break after points). */
  private readonly placeCounts = new Map<number, number[]>();
  private readonly lastPlace = new Map<number, number>();

  constructor(
    readonly mode: SeriesMode,
    readonly trackCount: number,
    firstTrack = 0,
  ) {
    // A Grand Prix always starts at the first track; the others start where the menu owner chose.
    this.trackIndex = mode === 'gp' ? 0 : Math.max(0, Math.min(trackCount - 1, Math.floor(firstTrack) || 0));
  }

  /** Total races in a Grand Prix; null when the series has no fixed length. */
  get raceTotal(): number | null {
    return this.mode === 'gp' ? this.trackCount : null;
  }

  /** Points are kept in Grand Prix and Loser-picks (a single race has no standings). */
  get scoring(): boolean {
    return this.mode !== 'single';
  }

  /** Points a slot earned in the last race. */
  gainOf(slot: number): number {
    const p = this.lastPlacings.find((x) => x.slot === slot);
    return this.scoring && p ? pointsForPlace(p.place) : 0;
  }

  /** Record a finished race: award points, then decide what comes next. */
  recordRace(placings: Placing[]): void {
    this.lastPlacings = [...placings].sort((a, b) => a.place - b.place);
    for (const p of this.lastPlacings) {
      this.lastPlace.set(p.slot, p.place);
      if (!this.scoring) continue;
      this.points.set(p.slot, (this.points.get(p.slot) ?? 0) + pointsForPlace(p.place));
      const counts = this.placeCounts.get(p.slot) ?? [];
      while (counts.length < p.place) counts.push(0);
      counts[p.place - 1]++;
      this.placeCounts.set(p.slot, counts);
    }
    this.racesDone++;
    this.stage = 'between';
    if (this.mode === 'gp') {
      if (this.racesDone >= this.trackCount) this.stage = 'over';
      else this.trackIndex = this.racesDone; // tracks in list order
    }
  }

  /**
   * Loser mode: who should pick right now. Normally the last-place human; if that player
   * has left (`isPresent` false), the next-worst human who is still here; if nobody from the
   * last race is here, the first present slot of `fallbackOrder`. null = nobody can pick.
   */
  currentPicker(isPresent: (slot: number) => boolean, fallbackOrder: number[] = []): number | null {
    if (this.mode !== 'loser' || this.stage !== 'between') return null;
    const byWorst = this.lastPlacings.filter((p) => p.human).reverse();
    for (const p of byWorst) if (isPresent(p.slot)) return p.slot;
    return fallbackOrder.find(isPresent) ?? null;
  }

  /** Loser mode: the picker chose the next track. Returns false (and changes nothing) for anyone else or a bad track. */
  pick(slot: number, track: unknown, isPresent: (slot: number) => boolean, fallbackOrder: number[] = []): boolean {
    const t = sanitizeTrackIndex(track, this.trackCount);
    if (t === null || this.stage !== 'between') return false;
    if (slot !== this.currentPicker(isPresent, fallbackOrder)) return false;
    this.trackIndex = t;
    this.stage = 'racing';
    return true;
  }

  /** Move on to the next race of a Grand Prix, or repeat the track in single mode. (Loser mode uses `pick`.) */
  advance(): boolean {
    if (this.stage !== 'between' || this.mode === 'loser') return false;
    this.stage = 'racing';
    return true;
  }

  /** End the series now (Loser picks: the menu owner chose STOP; also used to jump to the podium). */
  stop(): void {
    this.stage = 'over';
  }

  /** A player left for good: forget their points and results. */
  dropSlot(slot: number): void {
    this.points.delete(slot);
    this.placeCounts.delete(slot);
    this.lastPlace.delete(slot);
    this.lastPlacings = this.lastPlacings.filter((p) => p.slot !== slot);
  }

  /**
   * Ranking of `slots` (the players still in the game): most points first. Ties are broken by
   * more 1st places, then more 2nd places, ... then the better result in the last race,
   * then the lower slot number, so the order is always unique and repeatable.
   */
  standings(slots: number[]): StandingRow[] {
    const counts = (s: number) => this.placeCounts.get(s) ?? [];
    const sorted = [...slots].sort((a, b) => {
      const dp = (this.points.get(b) ?? 0) - (this.points.get(a) ?? 0);
      if (dp) return dp;
      const ca = counts(a);
      const cb = counts(b);
      for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
        const d = (cb[i] ?? 0) - (ca[i] ?? 0);
        if (d) return d;
      }
      const dl = (this.lastPlace.get(a) ?? 99) - (this.lastPlace.get(b) ?? 99);
      return dl || a - b;
    });
    return sorted.map((slot, i) => ({ slot, points: this.points.get(slot) ?? 0, rank: i + 1 }));
  }
}

/**
 * Who owns the menu: the first connected human in slot order (P1, or the next player if P1 left).
 * `candidates` must be in slot order; bots never own it.
 */
export function menuOwner(candidates: { slot: number; human: boolean; connected: boolean }[]): number | null {
  return candidates.find((c) => c.human && c.connected)?.slot ?? null;
}

/**
 * "Has the menu owner made this round's choice yet?" The owner's phone shows a forced pop-up while this
 * is pending (see shared/forcedChoice.ts). It starts pending, becomes done when the owner finishes the
 * pop-up OR when the host keyboard / TV picks a mode or track, and is pending again every time we return
 * to the menu. It belongs to the round, not to a player: if the owner leaves, the next owner inherits it.
 */
export class MenuChoice {
  private _pending = true;
  get pending(): boolean {
    return this._pending;
  }
  /** Returns true if the value changed. */
  complete(): boolean {
    const was = this._pending;
    this._pending = false;
    return was;
  }
  reset(): boolean {
    const was = this._pending;
    this._pending = true;
    return !was;
  }
  /** Phones' READY flags must not start a race while someone is still choosing (the keyboard still can). */
  blocksAutoStart(ownerPresent: boolean): boolean {
    return this._pending && ownerPresent;
  }
}
