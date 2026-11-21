/**
 * Pure planning for the 3D podium (no Three.js, no DOM, so it can be unit tested):
 *  - WHEN each racer is revealed (`revealSchedule`): 3rd, then 2nd, then 1st;
 *  - WHERE the steps stand and how tall they are (`stepX`, `STEP_HEIGHT`), and how the camera frames them
 *    (`frameFor`, `cameraDistance`).
 * The scene itself (podiumScene.ts) and the DOM wrapper (host/podiumView.ts) only read these numbers.
 *
 * Units: metres of podium space. The camera looks along -Z, +X is to the right, +Y up.
 */
import { fitDistance } from '../kart/pickAnim';

export type Place = 1 | 2 | 3;

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** How long a step takes to rise out of the floor (s). */
export const STEP_RISE = 0.45;
/** After the step starts rising, the racer pops in on top of it (s). */
export const MODEL_DELAY = 0.3;
/** After the step starts rising, the racer plays the pick animation (s). */
export const PICK_DELAY = 0.6;
/** After the step starts rising, the name label fades in (s). */
export const LABEL_DELAY = 0.45;

export interface RevealSlot {
  place: Place;
  /** Seconds (from show) when this step starts rising. */
  start: number;
  /** When the racer's pop-in starts. */
  model: number;
  /** When the racer's pick animation starts. */
  pick: number;
  /** When the name label starts fading in. */
  label: number;
}

export interface RevealSchedule {
  /** In the order they happen: 3rd, 2nd, 1st (only the places that exist). */
  slots: RevealSlot[];
  /** Seconds from show until the reveal is over (the promise resolves). */
  total: number;
  /** When the big finish (confetti, spotlight, camera push) starts: with 1st place's pick animation. */
  finale: number;
}

/**
 * The reveal order for a podium with `count` racers (1 to 3). The places that exist are the best `count`
 * ones, shown worst first; each one gets about 2.4 s.
 * `reduced` (prefers-reduced-motion): no waiting for the pick animations, just a short beat per place.
 */
export function revealSchedule(count: number, reduced = false, pickDuration = 1.5): RevealSchedule {
  const n = Math.max(0, Math.min(3, Math.floor(count)));
  const slots: RevealSlot[] = [];
  const gap = reduced ? 0.5 : PICK_DELAY + pickDuration + 0.3;
  let t = 0.4;
  for (let place = n; place >= 1; place--) {
    slots.push({ place: place as Place, start: t, model: t + MODEL_DELAY, pick: t + PICK_DELAY, label: t + LABEL_DELAY });
    t += gap;
  }
  const last = slots[slots.length - 1];
  if (!last) return { slots, total: 0, finale: 0 };
  // The winner's moment lasts until the pick animation is over, plus a short hold so the finale is seen.
  const total = reduced ? last.start + 0.9 : last.pick + pickDuration + 0.9;
  return { slots, total, finale: last.pick };
}

/** 0 before `start`, 1 after `start + dur`, a straight line between (for animations driven by a clock). */
export function phase(t: number, start: number, dur: number): number {
  return t <= start ? 0 : t >= start + dur ? 1 : (t - start) / dur;
}

// ---------------------------------------------------------------------------
// Steps and framing
// ---------------------------------------------------------------------------

export const STEP_WIDTH = 2.05;
export const STEP_DEPTH = 1.9;
export const STEP_GAP = 0.14;
/** Height of each step (m): the winner stands highest. */
export const STEP_HEIGHT: Record<Place, number> = { 1: 1.25, 2: 0.85, 3: 0.5 };
/** Room a racer needs above their step (kart + driver, the tall roll-cage kart included). */
export const HEADROOM = 2.1;

/** Where a step's centre stands (x) for each place: 2nd left of the winner, 3rd right (like a real podium). */
export function stepX(place: Place): number {
  const pitch = STEP_WIDTH + STEP_GAP;
  return place === 1 ? 0 : place === 2 ? -pitch : pitch;
}

export interface Framing {
  /** Centre of what is shown (x), so a podium with only 1st and 2nd is still centred. */
  centerX: number;
  /** Half-width of the shown steps (m). */
  halfWidth: number;
  /** Highest step top (m). */
  maxHeight: number;
}

/** What the camera has to frame for the places that exist. */
export function frameFor(places: readonly Place[]): Framing {
  if (places.length === 0) return { centerX: 0, halfWidth: STEP_WIDTH / 2, maxHeight: 0 };
  let lo = Infinity;
  let hi = -Infinity;
  let maxHeight = 0;
  for (const p of places) {
    lo = Math.min(lo, stepX(p) - STEP_WIDTH / 2);
    hi = Math.max(hi, stepX(p) + STEP_WIDTH / 2);
    maxHeight = Math.max(maxHeight, STEP_HEIGHT[p]);
  }
  return { centerX: (lo + hi) / 2, halfWidth: (hi - lo) / 2, maxHeight };
}

/**
 * Camera distance that fits the framing in a view of the given aspect ratio (width / height): the shown box is
 * `2 * halfWidth` wide and as tall as the highest step plus a racer, plus room below for the name labels.
 */
export function cameraDistance(f: Framing, aspect: number, fovDeg: number): number {
  const halfW = f.halfWidth + 0.55;
  const halfH = (f.maxHeight + HEADROOM + 0.9) / 2;
  // fitDistance(radius, ...) fits a circle; used per axis (a huge aspect removes the width limit, and the reverse).
  return Math.max(fitDistance(halfW, fovDeg, aspect), fitDistance(halfH, fovDeg, 1e6));
}
