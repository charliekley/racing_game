/**
 * Timing helpers for the scoreboard reveal (resultsView.ts, seriesView.ts).
 *
 * The pure functions (`rowTiming`, `countUpValue`) are unit tested. `startTicker` is the small bit that touches the
 * browser: it calls functions once per animation frame, the way a game loop would, until they are all done.
 *
 * Web concept: CSS animations are great for sliding and flipping, but they cannot change TEXT. To count a number
 * up (0, 1, 2 ... 7) we compute the number from the clock every frame and write it into the element.
 */
import { SCOREBOARD_REVEAL_SECONDS } from './postRace';

/** When the first row starts to flip (s). */
export const ROW_START = 0.35;
/** How long one row's flip takes (s). */
export const ROW_FLIP = 0.55;
/** How long a points number takes to count up (s). */
export const COUNT_TIME = 0.8;

export interface RowTiming {
  /** Seconds between one row starting and the next one starting. */
  step: number;
  /** When row number `r` (0 = the first row to appear = the LAST place) starts to flip. */
  startOf(r: number): number;
  /** When everything (the last row's flip and its count-up) is finished. */
  end: number;
}

/**
 * Rows flip in from last place to first. The gap between rows is chosen so the whole reveal, counting the last
 * row's points ticking up, finishes within `reveal` seconds, however many rows there are (4, 8 or 12).
 */
export function rowTiming(rows: number, reveal = SCOREBOARD_REVEAL_SECONDS): RowTiming {
  const n = Math.max(1, Math.floor(rows));
  const free = reveal - ROW_START - ROW_FLIP * 0.5 - COUNT_TIME;
  const step = n <= 1 ? 0.3 : Math.max(0.05, Math.min(0.4, free / (n - 1)));
  const startOf = (r: number) => ROW_START + r * step;
  return { step, startOf, end: startOf(n - 1) + ROW_FLIP * 0.5 + COUNT_TIME };
}

/** The whole number to show `t` seconds after the clock started, for a count from `from` to `to` that begins at `start` and takes `dur`. Ease-out (fast, then slowing). */
export function countUpValue(from: number, to: number, t: number, start: number, dur: number): number {
  if (t <= start) return from;
  if (t >= start + dur) return to;
  const u = (t - start) / dur;
  const eased = 1 - (1 - u) * (1 - u);
  return Math.round(from + (to - from) * eased);
}

/** True when the viewer asked their system for less motion (the reveal then shows the final numbers straight away). */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A job gets the seconds since the ticker started and returns true when it needs no more frames. */
export type TickJob = (t: number) => boolean;

/**
 * Run `jobs` once per animation frame until all of them are done, or `owner` has been removed from the page
 * (the screen was replaced), so a forgotten reveal never keeps running.
 */
export function startTicker(owner: HTMLElement, jobs: TickJob[]): void {
  if (jobs.length === 0) return;
  const t0 = performance.now();
  const frame = (): void => {
    if (!owner.isConnected && performance.now() - t0 > 100) return; // replaced by another screen
    const t = (performance.now() - t0) / 1000;
    let pending = false;
    for (const job of jobs) if (!job(t)) pending = true;
    if (pending) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** A job that counts the text of `el` from `from` to `to`, formatted by `fmt`. Writes only when the value changes. */
export function countUpJob(el: HTMLElement, from: number, to: number, start: number, dur: number, fmt: (n: number) => string): TickJob {
  let last = NaN;
  return (t) => {
    const v = countUpValue(from, to, t, start, dur);
    if (v !== last) {
      last = v;
      el.textContent = fmt(v);
    }
    return t >= start + dur;
  };
}
