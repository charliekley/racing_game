/**
 * Race rules: countdown, checkpoints, laps, positions, finish.
 *
 * Checkpoints: the lap is cut into N equal pieces along the track. A kart
 * must enter them strictly in order (0, 1, 2, …). Crossing into checkpoint 0 =
 * crossing the start/finish line.
 *
 * Skipping checkpoints (cutting across the infield, between switchback legs…):
 *  - a SMALL forward jump in track distance (<= SKIP_CREDIT_DISTANCE, e.g. the
 *    nearest-road point hopping across a tight corner) is simply credited;
 *  - a BIG one makes the kart "off course": if it stays on the wrong section for
 *    OFF_COURSE_SECONDS the race emits `offCourse`, and the world carries the kart
 *    back to its last checkpoint. So a lap can never be lost silently and a kart
 *    can never get stuck uncounted.
 *
 * Pure logic: give it each kart's distance along the track every tick.
 */
import { Buttons, type ControlInput } from '../shared/protocol';
import { START } from './config';
import { Knockout } from './knockout';

export const COUNTDOWN_SECONDS = 3;
/** After the first finisher, the others get this long before the race ends. */
export const FINISH_GRACE_SECONDS = 20;
/** Rocket start: gas pressed no more than this long before GO -> boost. */
export const START_BOOST_WINDOW = 0.8;
/** Gas held longer than this before GO -> engine floods. */
export const START_STALL_AFTER = 2.0;
/** A forward jump in track distance up to this (m) that skips a checkpoint is credited, not punished. */
export const SKIP_CREDIT_DISTANCE = 30;
/** How long (s) a kart may sit on a section past a skipped checkpoint before `offCourse` fires. */
export const OFF_COURSE_SECONDS = 0.3;

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
  /** Track distance reported last tick (null before the first tick). */
  lastS: number | null;
  /** How long (s) the kart has been on a section past a skipped checkpoint. */
  offCourseTime: number;
  /** Knockout mode: knocked out (or left the game). Such a racer no longer races; `place` is its final place. */
  out: boolean;
  /** Knockout mode: the lap whose end knocked this racer out (0 = it left the game). */
  outLap: number | null;
}

export type RaceEvent =
  | { kind: 'go' }
  | { kind: 'startBoost'; slot: number; perfect: boolean }
  /** Gas was pressed within START.perfectWindow of GO: a PERFECT rocket start (comes together with `startBoost`). */
  | { kind: 'perfectStart'; slot: number }
  | { kind: 'stall'; slot: number }
  | { kind: 'lap'; slot: number; lap: number; lapTime: number }
  | { kind: 'finish'; slot: number; place: number; time: number }
  /** Two karts finished within START.photoFinishGap seconds of each other (the host may show slow motion). */
  | { kind: 'photoFinish'; slots: [number, number]; gap: number }
  /** The kart skipped checkpoints (cut across): the world should put it back at its last checkpoint. */
  | { kind: 'offCourse'; slot: number }
  /** Knockout mode: this kart is out (the world lifts it away). `place` is its final place, `lap` the lap that ended it (0 = left). */
  | { kind: 'knockout'; slot: number; place: number; lap: number }
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
  /** Knockout rules (null in a normal race). */
  readonly knockout: Knockout | null;
  /** Events produced between ticks (a player leaving); delivered with the next tick's events. */
  private queued: RaceEvent[] = [];
  /** Laps finished by `grantProgress` between ticks (cannon landings), for the knockout check. */
  private lapQueue: RaceEvent[] = [];

  constructor(
    readonly track: TrackInfo,
    readonly totalLaps: number,
    slots: number[],
    options: { knockout?: boolean } = {},
  ) {
    this.knockout = options.knockout ? new Knockout(slots) : null;
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
        lastS: null,
        offCourseTime: 0,
        out: false,
        outLap: null,
      });
    }
  }

  /**
   * The racer enters their next checkpoint (r.next). Crossing checkpoint 0 means
   * crossing the start/finish line with every checkpoint done: a lap.
   */
  private enterSegment(r: Racer, events: RaceEvent[]): void {
    const seg = r.next;
    r.next = (r.next + 1) % this.track.checkpoints.length;
    if (seg !== 0) return;
    if (r.lap >= 1) {
      const lapTime = this.time - r.lapStartTime;
      r.lapTimes.push(lapTime);
      events.push({ kind: 'lap', slot: r.slot, lap: r.lap, lapTime });
    }
    r.lap++;
    r.lapStartTime = this.time;
    if (r.lap > this.totalLaps) this.finishRacer(r, events);
  }

  /** The racer is done: record the finish (and a photo finish when it crossed right behind the previous finisher). */
  private finishRacer(r: Racer, events: RaceEvent[]): void {
    r.finished = true;
    r.finishTime = this.time;
    this.finishOrder.push(r.slot);
    r.place = this.finishOrder.length;
    this.firstFinishAt ??= this.time;
    events.push({ kind: 'finish', slot: r.slot, place: r.place, time: this.time });
    const before = this.finishOrder.length >= 2 ? this.racers.get(this.finishOrder[this.finishOrder.length - 2]) : undefined;
    if (before?.finishTime != null && this.time - before.finishTime <= START.photoFinishGap) {
      events.push({ kind: 'photoFinish', slots: [before.slot, r.slot], gap: this.time - before.finishTime });
    }
  }

  /**
   * Knockout: after this tick's laps were counted (so every kart's distance is up to date), the first
   * kart across the line on lap L knocks out whoever is last (the last few in a big field, see knockoutsPerLap). The survivor wins as soon as it is alone.
   */
  private runKnockout(lapEvents: RaceEvent[], events: RaceEvent[]): void {
    const ko = this.knockout;
    if (!ko) return;
    for (const e of lapEvents) {
      if (e.kind !== 'lap' || e.lap >= this.totalLaps) continue; // the last lap is the finish, not a knockout
      const contenders = [...this.racers.values()].filter((r) => !r.out && !r.finished);
      for (const el of ko.roundAll(e.lap, contenders)) events.push(this.markOut(el)); // a big field loses several karts per lap
    }
    this.crownWinner(events);
  }

  /** Mark a racer as out and make the `knockout` event for it. */
  private markOut(el: { slot: number; place: number; lap: number }): RaceEvent {
    const r = this.racers.get(el.slot)!;
    r.out = true;
    r.outLap = el.lap;
    r.place = el.place;
    return { kind: 'knockout', slot: el.slot, place: el.place, lap: el.lap };
  }

  /** Knockout: the last kart standing finishes first (like crossing the line). */
  private crownWinner(events: RaceEvent[]): void {
    const w = this.knockout?.winner();
    const r = w === null || w === undefined ? undefined : this.racers.get(w);
    if (r && !r.finished && !r.out) this.finishRacer(r, events);
  }

  /**
   * Knockout: a player left the game. Their kart is out right now (and the survivor wins if it is alone).
   * The events come out with the next `tick`. Does nothing in a normal race.
   */
  removeRacer(slot: number): void {
    const el = this.knockout?.drop(slot);
    if (!el || this.racers.get(slot)?.finished) return;
    this.queued.push(this.markOut(el));
    this.crownWinner(this.queued);
  }

  /**
   * Credit a racer with having legitimately covered the track up to distance
   * `toS` without driving through every checkpoint on the way (a cannon launch,
   * a shortcut). They are treated as having entered every checkpoint segment from
   * their next one up to and including the segment containing `toS`, so lap
   * counting and positions stay consistent. Only moves forward, and only by less
   * than half a lap (anything else is ignored: you can't use this to skip laps or
   * go backwards). Returns lap/finish events like a normal crossing.
   */
  grantProgress(slot: number, toS: number): RaceEvent[] {
    const events: RaceEvent[] = [];
    const r = this.racers.get(slot);
    if (!r || r.finished || this.phase !== 'racing') return events;
    const K = this.track.checkpoints.length;
    const target = this.segmentOf(toS);
    const ahead = (target - r.next + K) % K; // 0 = the next checkpoint itself
    if (ahead > K / 2 - 1 && ahead !== 0) return events;
    for (let i = 0; i <= ahead && !r.finished; i++) this.enterSegment(r, events);
    this.lapQueue.push(...events.filter((e) => e.kind === 'lap')); // (a cannon landing can finish a lap: Knockout sees it next tick)
    return events;
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
    const events: RaceEvent[] = this.queued;
    this.queued = [];
    const lapEvents: RaceEvent[] = this.lapQueue; // (knockout looks at them once every kart's distance is updated)
    this.lapQueue = [];
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
          if (held <= START_BOOST_WINDOW) {
            const perfect = held <= START.perfectWindow;
            events.push({ kind: 'startBoost', slot: r.slot, perfect });
            if (perfect) events.push({ kind: 'perfectStart', slot: r.slot });
          }
          else if (held > START_STALL_AFTER) events.push({ kind: 'stall', slot: r.slot });
        }
      }
    }

    const L = this.track.length;
    const cps = this.track.checkpoints;
    const K = cps.length;
    for (const r of this.racers.values()) {
      const s = positions.get(r.slot);
      if (s === undefined || r.out) continue; // a knocked-out kart stays frozen in the ranking
      if (this.phase === 'racing' && !r.finished) {
        const seg = this.segmentOf(s);
        // How many checkpoints ahead of the expected one is the kart? (0 = the expected one.)
        const ahead = (seg - r.next + K) % K;
        if (seg === r.next) {
          const before = events.length;
          this.enterSegment(r, events);
          for (const e of events.slice(before)) if (e.kind === 'lap') lapEvents.push(e);
          r.offCourseTime = 0;
        } else if (ahead > 0 && ahead < K / 2) {
          // Past a checkpoint it never entered. Small hop forward: credit it. Otherwise: off course.
          const jump = r.lastS === null ? Infinity : (((s - r.lastS) % L) + L) % L;
          if (jump <= SKIP_CREDIT_DISTANCE) {
            const granted = this.grantProgress(r.slot, s);
            events.push(...granted);
            lapEvents.push(...granted.filter((e) => e.kind === 'lap'));
            r.offCourseTime = 0;
          } else {
            r.offCourseTime += dt;
            if (r.offCourseTime >= OFF_COURSE_SECONDS) {
              r.offCourseTime = 0;
              events.push({ kind: 'offCourse', slot: r.slot });
            }
            continue; // keep lastS at the last legit spot, so the jump is measured from there
          }
        } else {
          r.offCourseTime = 0;
        }
      }
      r.lastS = s;
      // Progress = completed laps + distance into the current checkpoint segment.
      const cur = (r.next - 1 + K) % K;
      const segLen = (cur + 1 < K ? cps[cur + 1] : L) - cps[cur];
      let into = (((s - cps[cur]) % L) + L) % L;
      if (into > segLen + L / 2) into = 0; // went backwards past the checkpoint
      into = Math.min(into, segLen);
      // On lap n, progress = (n-1)·L + distance into the lap. (Lap 0 = on the grid → slightly negative.)
      if (!r.finished) r.progress = (r.lap - 1) * L + cps[cur] + into;
    }

    if (this.phase === 'racing') this.runKnockout(lapEvents, events);

    if (this.phase === 'racing') {
      const allDone = [...this.racers.values()].every((r) => r.finished || r.out);
      const graceOver = this.firstFinishAt !== null && this.time - this.firstFinishAt > FINISH_GRACE_SECONDS;
      if (allDone || graceOver) {
        this.phase = 'done';
        if (this.knockout) {
          // Knockout: finishers first, then whoever is still in (by distance), then the knocked-out karts, last one out first.
          this.standings().forEach((slot, i) => (this.racers.get(slot)!.place = i + 1));
        } else {
          // Anyone still racing is placed by progress.
          for (const slot of this.standings()) {
            const r = this.racers.get(slot)!;
            if (r.place === null) {
              this.finishOrder.push(slot);
              r.place = this.finishOrder.length;
            }
          }
        }
        events.push({ kind: 'done' });
      }
    }
    return events;
  }

  /**
   * Slots ordered 1st..last: finishers by finish order, then by distance raced; in Knockout the
   * knocked-out karts come last, the one that went out most recently first.
   */
  standings(): number[] {
    const finished = this.finishOrder.filter((s) => this.racers.get(s)?.finished);
    const rest = [...this.racers.values()]
      .filter((r) => !r.finished && !r.out && !finished.includes(r.slot))
      .sort((a, b) => b.progress - a.progress)
      .map((r) => r.slot);
    const out = (this.knockout?.eliminated ?? []).map((e) => e.slot).reverse();
    return [...finished, ...rest, ...out];
  }

  positionOf(slot: number): number {
    return this.standings().indexOf(slot) + 1;
  }
}
