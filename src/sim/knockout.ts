/**
 * Knockout rules (pure logic, no DOM, no clock): who is eliminated and in which order.
 *
 * One long race. When the first kart finishes a lap (from lap 2 on), the kart that is LAST at that
 * moment is knocked out. The last kart standing wins. Places are handed out in reverse knockout
 * order: the first kart out is last, the survivor is 1st.
 *
 * Everything is decided from race state (laps and distance raced), never from wall-clock time, so the
 * simulation stays deterministic. `Race` owns one `Knockout` and calls `round` / `drop`; the world
 * only reacts to the resulting `knockout` event (it lifts the kart away).
 */

/** Knockouts start after this lap (the first lap is a free warm-up). */
export const FIRST_KNOCKOUT_LAP = 2;
/** Never more than this many laps in a Knockout race. */
export const MAX_KNOCKOUT_LAPS = 6;
/** Tracks shorter than this (m) get at least `SHORT_TRACK_LAPS` laps. */
export const SHORT_TRACK_LENGTH = 650;
export const SHORT_TRACK_LAPS = 5;

/**
 * How many karts go out after each lap. Up to 6 racers: one (the classic rule). In a bigger field one kart per
 * lap would need as many laps as there are karts, so it is the smallest number that leaves two karts for the last lap
 * within MAX_KNOCKOUT_LAPS: 8 racers lose 2 per lap, 12 racers lose 3 per lap.
 */
export function knockoutsPerLap(racers: number): number {
  return Math.max(1, Math.ceil((racers - 2) / (MAX_KNOCKOUT_LAPS - 2)));
}

/**
 * How many laps a Knockout race has: the track's normal laps + 2, at least 5 on a short track,
 * never more than MAX_KNOCKOUT_LAPS and never fewer than the racers need (knockouts from lap 2 on,
 * `knockoutsPerLap` karts each, so that two karts are left for the last lap). 4 racers: 4 laps, 8: 5, 12: 6.
 */
export function knockoutLaps(trackLaps: number, trackLength: number, racers = 4): number {
  let laps = trackLaps + 2;
  if (trackLength < SHORT_TRACK_LENGTH) laps = Math.max(laps, SHORT_TRACK_LAPS);
  laps = Math.min(laps, MAX_KNOCKOUT_LAPS);
  const knockoutLapsNeeded = Math.ceil(Math.max(0, racers - 2) / knockoutsPerLap(racers));
  return Math.max(laps, FIRST_KNOCKOUT_LAP + knockoutLapsNeeded, 2);
}

/** What `round` needs to know about each kart that is still racing. */
export interface Contender {
  slot: number;
  /** Distance raced (m): bigger = further ahead. */
  progress: number;
  /** Race clock (s) when the kart started its current lap: later = it crossed the line later. */
  lapStartTime: number;
}

/** One finished elimination. */
export interface Elimination {
  slot: number;
  /** Final place (1-based): the number of karts that were still in when this one went out. */
  place: number;
  /** The lap whose end triggered it (0 = the kart left the game). */
  lap: number;
}

export class Knockout {
  private readonly inGame: number[];
  private readonly outList: Elimination[] = [];
  /** Laps that already had their knockout (each lap knocks out at most one kart). */
  private readonly doneLaps = new Set<number>();
  /** Only a race that started with 2+ karts has a "last one standing". */
  private readonly contested: boolean;

  constructor(
    slots: number[],
    /** Karts knocked out after each lap (see `knockoutsPerLap`). */
    private readonly perLap = knockoutsPerLap(slots.length),
  ) {
    this.inGame = [...slots];
    this.contested = slots.length >= 2;
  }

  /** Karts still in, in their original order. */
  get alive(): readonly number[] {
    return this.inGame;
  }

  /** Eliminations so far, first out first (so reverse this for the finishing order). */
  get eliminated(): readonly Elimination[] {
    return this.outList;
  }

  isOut(slot: number): boolean {
    return this.outList.some((e) => e.slot === slot);
  }

  /** The final place of a kart that is out (null while it is still in). */
  placeOf(slot: number): number | null {
    return this.outList.find((e) => e.slot === slot)?.place ?? null;
  }

  /** The last kart standing, or null while two or more are still in (or when the race never had a rival). */
  winner(): number | null {
    return this.contested && this.inGame.length === 1 ? this.inGame[0] : null;
  }

  /**
   * The first kart finished lap `lap`: knock out the last-placed `contenders` (karts still racing).
   * Returns the elimination, or null when nothing happens (first lap, this lap already had its knockout,
   * only one kart left). Ties in distance go to the kart that crossed the line later, then the higher slot.
   */
  round(lap: number, contenders: Contender[]): Elimination | null {
    return this.roundAll(lap, contenders)[0] ?? null;
  }

  /**
   * Like `round`, but a bigger field loses `perLap` karts: the last `perLap` karts, worst first (so the
   * worst one gets the lowest place). Never knocks out the last kart standing.
   */
  roundAll(lap: number, contenders: Contender[]): Elimination[] {
    if (lap < FIRST_KNOCKOUT_LAP || this.doneLaps.has(lap) || this.inGame.length < 2) return [];
    if (contenders.filter((c) => this.inGame.includes(c.slot)).length < 2) return [];
    this.doneLaps.add(lap);
    const out: Elimination[] = [];
    for (let n = 0; n < this.perLap && this.inGame.length >= 2; n++) {
      const pool = contenders.filter((c) => this.inGame.includes(c.slot));
      if (pool.length < 2) break;
      const victim = pool.reduce((worst, c) => (isBehind(c, worst) ? c : worst));
      out.push(this.remove(victim.slot, lap));
    }
    return out;
  }

  /** A player left: the kart is out right now (counted as knocked out, lap 0). Null if it was not in. */
  drop(slot: number): Elimination | null {
    if (!this.inGame.includes(slot)) return null;
    return this.remove(slot, 0);
  }

  private remove(slot: number, lap: number): Elimination {
    const e: Elimination = { slot, place: this.inGame.length, lap };
    this.inGame.splice(this.inGame.indexOf(slot), 1);
    this.outList.push(e);
    return e;
  }
}

/** Is `a` behind `b`? (less far; on an exact tie, crossed the line later; then the higher slot.) */
function isBehind(a: Contender, b: Contender): boolean {
  if (a.progress !== b.progress) return a.progress < b.progress;
  if (a.lapStartTime !== b.lapStartTime) return a.lapStartTime > b.lapStartTime;
  return a.slot > b.slot;
}
