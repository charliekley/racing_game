/**
 * Split-screen layout. Rects are fractions of the screen (0..1) with y
 * measured from the TOP (like CSS); `toViewport` converts for WebGL, whose
 * y axis starts at the bottom.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SplitLayout {
  /** One rect per player, in player order. */
  views: Rect[];
  /** Leftover quadrant used for the overview map (3 players), else null. */
  minimap: Rect | null;
}

export function splitLayout(players: number): SplitLayout {
  const q = (x: number, y: number): Rect => ({ x, y, w: 0.5, h: 0.5 });
  switch (Math.max(1, Math.min(4, players))) {
    case 1:
      return { views: [{ x: 0, y: 0, w: 1, h: 1 }], minimap: null };
    case 2:
      return { views: [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }], minimap: null };
    case 3:
      return { views: [q(0, 0), q(0.5, 0), q(0, 0.5)], minimap: q(0.5, 0.5) };
    default:
      return { views: [q(0, 0), q(0.5, 0), q(0, 0.5), q(0.5, 0.5)], minimap: null };
  }
}

/** Pixel viewport for WebGL (origin bottom-left), rounded to whole pixels. */
export function toViewport(r: Rect, width: number, height: number): { x: number; y: number; w: number; h: number } {
  const x = Math.round(r.x * width);
  const w = Math.round((r.x + r.w) * width) - x;
  const top = Math.round(r.y * height);
  const h = Math.round((r.y + r.h) * height) - top;
  return { x, y: height - top - h, w, h };
}
