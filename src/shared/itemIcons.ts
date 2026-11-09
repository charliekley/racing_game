/**
 * Item icons drawn with the canvas 2D API (no image files).
 * Shared by the phone (big icon in the middle of the screen) and the TV HUD
 * (small icon in each player's viewport).
 *
 * Every painter draws inside a `size` x `size` square whose origin is the
 * top-left corner of the current canvas transform. `t` is time in ms and is
 * only used for light animation (flicker, shimmer, pulse).
 *
 * Design rules so icons read at 64 px and look good at 220+ px:
 * bold shapes, thick dark outlines, flat bright colours, one white highlight.
 *
 * Painters are written in "unit space" (0..1 in both directions) and wrapped by
 * `unit()`, which scales the canvas so we never multiply by `size` by hand.
 */
import { ITEM_IDS, type ItemId } from '../sim/items/types';

export type IconPainter = (ctx: CanvasRenderingContext2D, size: number, t: number) => void;

const OUTLINE = '#1b1030';
const TAU = Math.PI * 2;
/** Outline thickness in unit space. */
const LW = 0.05;

/** Wrap a painter that works in 0..1 coordinates into one that works in pixels. */
function unit(draw: (ctx: CanvasRenderingContext2D, t: number) => void): IconPainter {
  return (ctx, size, t) => {
    ctx.save();
    ctx.scale(size, size);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    draw(ctx, t);
    ctx.restore();
  };
}

/** Fill the current path with `fill`, then stroke the dark outline. */
function fillOutline(ctx: CanvasRenderingContext2D, fill: string | CanvasGradient, lw = LW): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

/** Closed polygon from a flat list of [x, y] points. */
function polygon(ctx: CanvasRenderingContext2D, pts: number[][]): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

/** A small white highlight blob. */
function shine(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0): void {
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// dash: a flame with a lightning bolt on top (speed boost)
// ---------------------------------------------------------------------------
const dash = unit((ctx, t) => {
  // The flame tip flickers a little.
  const flick = Math.sin(t / 70) * 0.025 + Math.sin(t / 43) * 0.015;
  const tip = 0.07 + flick;

  // Outer orange flame
  ctx.beginPath();
  ctx.moveTo(0.5, 0.93);
  ctx.bezierCurveTo(0.12, 0.9, 0.12, 0.52, 0.34, 0.4);
  ctx.bezierCurveTo(0.34, 0.55, 0.4, 0.58, 0.44, 0.5);
  ctx.bezierCurveTo(0.44, 0.3, 0.5, 0.18, 0.5 + flick, tip);
  ctx.bezierCurveTo(0.62, 0.22, 0.7, 0.34, 0.72, 0.48);
  ctx.bezierCurveTo(0.76, 0.44, 0.78, 0.4, 0.78, 0.36);
  ctx.bezierCurveTo(0.95, 0.55, 0.88, 0.9, 0.5, 0.93);
  ctx.closePath();
  fillOutline(ctx, '#ff7a1a');

  // Inner yellow flame
  ctx.beginPath();
  ctx.moveTo(0.5, 0.86);
  ctx.bezierCurveTo(0.26, 0.84, 0.28, 0.58, 0.42, 0.52);
  ctx.bezierCurveTo(0.5, 0.45, 0.54, 0.35, 0.52, 0.28);
  ctx.bezierCurveTo(0.7, 0.42, 0.78, 0.6, 0.72, 0.74);
  ctx.bezierCurveTo(0.68, 0.84, 0.6, 0.86, 0.5, 0.86);
  ctx.closePath();
  ctx.fillStyle = '#ffd60a';
  ctx.fill();

  // Lightning bolt
  polygon(ctx, [
    [0.58, 0.2], [0.32, 0.56], [0.48, 0.56], [0.4, 0.86],
    [0.7, 0.46], [0.54, 0.46], [0.66, 0.2],
  ]);
  fillOutline(ctx, '#fff3a0');
  shine(ctx, 0.5, 0.33, 0.025, 0.07, 0.6);
});

// ---------------------------------------------------------------------------
// slick: glossy black-and-purple oil puddle with a falling drip
// ---------------------------------------------------------------------------
/** Wobbly blob outline: a circle whose radius varies with the angle. */
function puddlePath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, squash: number): void {
  ctx.beginPath();
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * TAU;
    const rr = r * (1 + 0.16 * Math.sin(3 * a + 0.5) + 0.07 * Math.sin(5 * a + 1.3));
    const x = cx + rr * Math.cos(a);
    const y = cy + rr * Math.sin(a) * squash;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

const slick = unit((ctx) => {
  // Main puddle
  puddlePath(ctx, 0.5, 0.7, 0.42, 0.5);
  fillOutline(ctx, '#2a1048');
  // Purple sheen ring
  puddlePath(ctx, 0.5, 0.69, 0.29, 0.42);
  ctx.fillStyle = '#7b2fd0';
  ctx.fill();
  // Rainbow-ish oil film streak
  ctx.lineWidth = 0.03;
  ctx.strokeStyle = '#2ec4b6';
  ctx.beginPath();
  ctx.arc(0.5, 0.7, 0.22, 0.15 * Math.PI, 0.55 * Math.PI);
  ctx.stroke();
  // Shine
  shine(ctx, 0.34, 0.62, 0.09, 0.035, -0.3);

  // Drip falling in (teardrop)
  ctx.beginPath();
  ctx.moveTo(0.5, 0.08);
  ctx.bezierCurveTo(0.6, 0.2, 0.66, 0.3, 0.5, 0.38);
  ctx.bezierCurveTo(0.34, 0.3, 0.4, 0.2, 0.5, 0.08);
  ctx.closePath();
  fillOutline(ctx, '#4b1d86');
  shine(ctx, 0.46, 0.27, 0.02, 0.045, 0.2);
});

// ---------------------------------------------------------------------------
// ricochet: glossy ball with a zig-zag bounce trail and motion lines
// ---------------------------------------------------------------------------
const ricochet = unit((ctx) => {
  const trail: number[][] = [[0.1, 0.88], [0.26, 0.44], [0.46, 0.78], [0.62, 0.4]];
  const path = () => {
    ctx.beginPath();
    trail.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  };
  // Trail: dark outline stroke, then bright stroke on top.
  path();
  ctx.lineWidth = 0.15;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  path();
  ctx.lineWidth = 0.085;
  ctx.strokeStyle = '#7fe7ff';
  ctx.stroke();

  // Motion lines behind the ball
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.04;
  for (const [x1, y1, x2, y2] of [[0.8, 0.62, 0.9, 0.7], [0.88, 0.4, 0.96, 0.44], [0.72, 0.72, 0.78, 0.84]]) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // Ball
  const bx = 0.7, by = 0.32, br = 0.22;
  const g = ctx.createRadialGradient(bx - 0.07, by - 0.08, 0.02, bx, by, br);
  g.addColorStop(0, '#9be7ff');
  g.addColorStop(1, '#1e7bff');
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, TAU);
  fillOutline(ctx, g);
  shine(ctx, bx - 0.08, by - 0.09, 0.05, 0.03, -0.7);
});

// ---------------------------------------------------------------------------
// seeker: missile inside a pulsing target ring with crosshair ticks
// ---------------------------------------------------------------------------
const seeker = unit((ctx, t) => {
  const pulse = 1 + 0.04 * Math.sin(t / 160);
  const R = 0.4 * pulse;

  // Target ring (dark outline, then red on top) + four crosshair ticks
  ctx.beginPath();
  ctx.arc(0.5, 0.5, R, 0, TAU);
  ctx.lineWidth = 0.1;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.lineWidth = 0.055;
  ctx.strokeStyle = '#ff3b5c';
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const c = Math.cos(a), s = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(0.5 + c * (R - 0.1), 0.5 + s * (R - 0.1));
    ctx.lineTo(0.5 + c * (R + 0.07), 0.5 + s * (R + 0.07));
    ctx.lineWidth = 0.1;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.lineWidth = 0.05;
    ctx.strokeStyle = '#ff3b5c';
    ctx.stroke();
  }

  // Missile, drawn pointing along +x, then rotated to point up-right.
  ctx.save();
  ctx.translate(0.5, 0.5);
  ctx.rotate(-Math.PI / 4);
  // Exhaust flame
  polygon(ctx, [[-0.2, -0.05], [-0.34, 0], [-0.2, 0.05]]);
  fillOutline(ctx, '#ffd60a', 0.03);
  // Fins
  polygon(ctx, [[-0.14, -0.08], [-0.24, -0.2], [-0.04, -0.08]]);
  fillOutline(ctx, '#ff3b5c', 0.035);
  polygon(ctx, [[-0.14, 0.08], [-0.24, 0.2], [-0.04, 0.08]]);
  fillOutline(ctx, '#ff3b5c', 0.035);
  // Body + nose cone
  ctx.beginPath();
  ctx.moveTo(-0.2, -0.085);
  ctx.lineTo(0.08, -0.085);
  ctx.quadraticCurveTo(0.26, -0.07, 0.3, 0);
  ctx.quadraticCurveTo(0.26, 0.07, 0.08, 0.085);
  ctx.lineTo(-0.2, 0.085);
  ctx.closePath();
  fillOutline(ctx, '#f1f5f9', 0.035);
  // Red nose band
  ctx.beginPath();
  ctx.moveTo(0.1, -0.085);
  ctx.quadraticCurveTo(0.26, -0.07, 0.3, 0);
  ctx.quadraticCurveTo(0.26, 0.07, 0.1, 0.085);
  ctx.closePath();
  ctx.fillStyle = '#ff3b5c';
  ctx.fill();
  ctx.lineWidth = 0.03;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  shine(ctx, -0.04, -0.045, 0.07, 0.014);
  ctx.restore();
});

// ---------------------------------------------------------------------------
// nova: radiant sun-burst with a glowing core; hue slowly shifts over time
// ---------------------------------------------------------------------------
const nova = unit((ctx, t) => {
  const hue = (t / 12) % 360;
  const spin = t / 2500;
  const spikes = 12;

  // Spiky burst
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const a = spin + (i * Math.PI) / spikes;
    const r = i % 2 === 0 ? 0.46 : 0.28;
    const x = 0.5 + r * Math.cos(a);
    const y = 0.5 + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  fillOutline(ctx, `hsl(${hue}, 100%, 58%)`);

  // Shimmering ring in a shifted hue
  ctx.beginPath();
  ctx.arc(0.5, 0.5, 0.2, 0, TAU);
  ctx.lineWidth = 0.05;
  ctx.strokeStyle = `hsl(${(hue + 120) % 360}, 100%, 62%)`;
  ctx.stroke();

  // Glowing core
  const g = ctx.createRadialGradient(0.5, 0.5, 0.02, 0.5, 0.5, 0.2);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.6, '#fff6b0');
  g.addColorStop(1, `hsl(${(hue + 60) % 360}, 100%, 70%)`);
  ctx.beginPath();
  ctx.arc(0.5, 0.5, 0.17, 0, TAU);
  fillOutline(ctx, g, 0.035);
  shine(ctx, 0.44, 0.43, 0.04, 0.025, -0.7);
});

// ---------------------------------------------------------------------------
// Fallback "?" icon for unknown ids
// ---------------------------------------------------------------------------
const unknown = unit((ctx) => {
  ctx.beginPath();
  ctx.arc(0.5, 0.5, 0.38, 0, TAU);
  fillOutline(ctx, '#8d99ae');
  ctx.font = 'bold 0.56px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 0.05;
  ctx.strokeStyle = OUTLINE;
  ctx.strokeText('?', 0.5, 0.54);
  ctx.fillStyle = '#fff';
  ctx.fillText('?', 0.5, 0.54);
});

// TODO(jumble): placeholder that reuses the slick art until the real icon is drawn.
export const ITEM_ICONS: Record<ItemId, IconPainter> = { dash, slick, ricochet, seeker, nova, jumble: slick };

/** Icons that move over time, so the host view must keep redrawing them. */
export function isIconAnimated(id: string): boolean {
  return id === 'dash' || id === 'nova' || id === 'seeker';
}

/** Draw `id` (any string; unknown ids get a "?"), plus a "×N" badge if count > 1. Clears nothing. */
export function paintItemIcon(ctx: CanvasRenderingContext2D, id: string, size: number, t: number, count = 1): void {
  const painter = (ITEM_ICONS as Record<string, IconPainter | undefined>)[id] ?? unknown;
  painter(ctx, size, t);
  if (count > 1) paintBadge(ctx, size, `×${count}`);
}

/** Bold pill-shaped badge in the bottom-right corner. */
function paintBadge(ctx: CanvasRenderingContext2D, size: number, text: string): void {
  const w = size * 0.4, h = size * 0.3;
  const x = size - w - size * 0.02, y = size - h - size * 0.02;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = size * 0.04;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.font = `900 ${Math.round(h * 0.78)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = OUTLINE;
  ctx.fillText(text, x + w / 2, y + h / 2 + h * 0.05);
  ctx.restore();
}

/** "Rolling the dice": flicker through all icons (one per ~90 ms) with a scale pulse. */
export function paintRoulette(ctx: CanvasRenderingContext2D, size: number, t: number): void {
  const step = Math.floor(t / 90);
  const id = ITEM_IDS[step % ITEM_IDS.length];
  const phase = (t % 90) / 90; // 0..1 within the current icon
  const scale = 0.88 + 0.14 * Math.sin(phase * Math.PI);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(scale, scale);
  ctx.translate(-size / 2, -size / 2);
  ITEM_ICONS[id](ctx, size, t);
  ctx.restore();
}
