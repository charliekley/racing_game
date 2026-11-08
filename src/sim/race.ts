/**
 * Race rules: countdown, checkpoints, laps, positions, finish.
 *
 * Checkpoints: the lap is cut into N equal pieces along the track. A kart
 * must enter them strictly in order (0, 1, 2, …); entering one out of order
 * (e.g. by cutting across the infield) simply doesn't count, so shortcuts
 * gain nothing. Crossing into checkpoint 0 = crossing the start/finish line.
 *
 * Pure logic: give it each kart's distance along the track every tick.
 */
import { Buttons, type ControlInput } from '../shared/protocol';

export const COUNTDOWN_SECONDS = 3;
/** After the first finisher, the others get this long before the race ends. */
export const FINISH_GRACE_SECONDS = 20;
/** Rocket start: gas pressed no more than this long before GO -> boost. */
export const START_BOOST_WINDOW = 0.8;
/** Gas held longer than this before GO -> engine floods. */
export const START_STALL_AFTER = 2.0;

export type RacePhase = 'countdown' | 'racing' | 'done';

export interface Racer {
  slot: number;
  /** Laps started: 0 = still behind the start line, 1 = on lap 1, … */
  lap: number;
  /** Index of the next checkpoint this kart must enter. */
  next: number;
  /** Total distance raced (m) – used for ranking. */
  progress: number;
  lapStartTime: number;
  lapTimes: number[];
  finished: boolean;
  finishTime: number | null;
  /** 1-based final place once finished (or when the race ends). */
  place: number | null;
  /** When gas was pressed during the countdown (race clock), for the rocket start. */
  gasSince: number | null;
}

export type RaceEvent =
  | { kind: 'go' }
  | { kind: 'startBoost'; slot: number }
  | { kind: 'stall'; slot: number }
  | { kind: 'lap'; slot: number; lap: number; lapTime: number }
  | { kind: 'finish'; slot: number; place: number; time: number }
  | { kind: 'done' };

export interface TrackInfo {
  length: number;
  /** Start s of each checkpoint; [0] must be 0 (the start line). */
  checkpoints: number[];
}

export class Race {
  /** Race clock in seconds; negative during the countdown, 0 = GO. */
  time = -COUNTDOWN_SECONDS;
  phase: RacePhase = 'countdown';
  readonly racers = new Map<number, Racer>();
  finishOrder: number[] = [];
  private firstFinishAt: number | null = null;

  constructor(
    readonly track: TrackInfo,
    readonly totalLaps: number,
    slots: number[],
  ) {
    for (const slot of slots) {
      this.racers.set(slot, {
        slot,
        lap: 0,
        next: 0,
        progress: 0,
        lapStartTime: 0,
        lapTimes: [],
        finished: false,
        finishTime: null,
        place: null,
        gasSince: null,
      });
    }
  }

  /** Which checkpoint segment a distance s falls in. */
  segmentOf(s: number): number {
    const cps = this.track.checkpoints;
    const L = this.track.length;
    const x = ((s % L) + L) % L;
    let i = cps.length - 1;
    while (i > 0 && cps[i] > x) i--;
    return i;
  }

  /**
   * Advance the race by dt.
   * @param positions  each kart's distance along the track (0..length)
   */
  tick(dt: number, positions: Map<number, number>, inputs: Map<number, ControlInput>): RaceEvent[] {
    const events: RaceEvent[] = [];
    const prevTime = this.time;
    this.time += dt;

    if (this.phase === 'countdown') {
      for (const r of this.racers.values()) {
        const gas = ((inputs.get(r.slot)?.buttons ?? 0) & Buttons.GAS) !== 0;
        if (gas && r.gasSince === null) r.gasSince = prevTime;
        if (!gas) r.gasSince = null;
      }
      if (this.time >= 0) {
        this.phase = 'racing';
        events.push({ kind: 'go' });
        for (const r of this.racers.values()) {
          if (r.gasSince === null) continue;
          const held = -r.gasSince;
          if (held <= START_BOOST_WINDOW) events.push({ kind: 'startBoost', slot: r.slot });
          else if (held > START_STALL_AFTER) events.push({ kind: 'stall', slot: r.slot });
        }
      }
    }

    const L = this.track.length;
    const cps = this.track.checkpoints;
    const K = cps.length;
    for (const r of this.racers.values()) {
      const s = positions.get(r.slot);
      if (s === undefined) continue;
      if (this.phase === 'racing' && !r.finished) {
        const seg = this.segmentOf(s);
        if (seg === r.next) {
          r.next = (r.next + 1) % K;
          if (seg === 0) {
            // Crossed the start/finish line with every checkpoint done.
            if (r.lap >= 1) {
              const lapTime = this.time - r.lapStartTime;
              r.lapTimes.push(lapTime);
              events.push({ kind: 'lap', slot: r.slot, lap: r.lap, lapTime });
            }
            r.lap++;
            r.lapStartTime = this.time;
            if (r.lap > this.totalLaps) {
              r.finished = true;
              r.finishTime = this.time;
              this.finishOrder.push(r.slot);
              r.place = this.finishOrder.length;
              this.firstFinishAt ??= this.time;
              events.push({ kind: 'finish', slot: r.slot, place: r.place, time: this.time });
            }
          }
        }
      }
      // Progress = completed laps + distance into the current checkpoint segment.
      const cur = (r.next - 1 + K) % K;
      const segLen = (cur + 1 < K ? cps[cur + 1] : L) - cps[cur];
      let into = (((s - cps[cur]) % L) + L) % L;
      if (into > segLen + L / 2) into = 0; // went backwards past the checkpoint
      into = Math.min(into, segLen);
      // On lap n, progress = (n-1)·L + distance into the lap. (Lap 0 = on the grid → slightly negative.)
      if (!r.finished) r.progress = (r.lap - 1) * L + cps[cur] + into;
    }

    if (this.phase === 'racing') {
      const allDone = [...this.racers.values()].every((r) => r.finished);
      const graceOver = this.firstFinishAt !== null && this.time - this.firstFinishAt > FINISH_GRACE_SECONDS;
      if (allDone || graceOver) {
        this.phase = 'done';
        // Anyone still racing is placed by progress.
        for (const slot of this.standings()) {
          const r = this.racers.get(slot)!;
          if (r.place === null) {
            this.finishOrder.push(slot);
            r.place = this.finishOrder.length;
          }
        }
        events.push({ kind: 'done' });
      }
    }
    return events;
  }

  /** Slots ordered 1st..last: finishers by finish order, then by distance raced. */
  standings(): number[] {
    const finished = this.finishOrder.filter((s) => this.racers.get(s)?.finished);
    const rest = [...this.racers.values()]
      .filter((r) => !r.finished && !finished.includes(r.slot))
      .sort((a, b) => b.progress - a.progress)
      .map((r) => r.slot);
    return [...finished, ...rest];
  }

  positionOf(slot: number): number {
    return this.standings().indexOf(slot) + 1;
  }
}
