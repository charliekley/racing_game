/**
 * Small PURE helpers for the picker pictures (no DOM, so they are easy to unit-test).
 */
import type { SelectStage } from '../shared/selectStage';

/** Where a drawing made in a `designW x designH` box lands inside a `w x h` canvas (uniform scale, centred). */
export interface Fit {
  scale: number;
  /** Offset (canvas px) of the design box's top-left corner. */
  x: number;
  y: number;
}

/** Fit a design box into a canvas without stretching it: the whole drawing is always visible. */
export function fitDesign(w: number, h: number, designW: number, designH: number): Fit {
  if (w <= 0 || h <= 0 || designW <= 0 || designH <= 0) return { scale: 0, x: 0, y: 0 };
  const scale = Math.min(w / designW, h / designH);
  return { scale, x: (w - designW * scale) / 2, y: (h - designH * scale) / 2 };
}

/**
 * Canvas pixel size for something shown `cssPx` wide on a screen with `dpr` pixels per CSS px. Capped at
 * 2x (3x phones would just waste memory) and rounded so the same size always gives the same cache key.
 */
export function bufferPx(cssPx: number, dpr: number): number {
  if (!(cssPx > 0)) return 0;
  const ratio = Math.max(1, Math.min(2, Number.isFinite(dpr) ? dpr : 1));
  return Math.max(1, Math.round(cssPx * ratio));
}

/** The title shown in the header of each step (short enough for the narrowest phone). */
export const STEP_TITLES: Record<SelectStage, string> = {
  name: 'Your name',
  character: 'Pick your driver',
  kart: 'Pick your kart',
  ready: 'Ready',
};
