/**
 * Draws the held item in the middle of the phone screen on a <canvas>.
 *
 * Web concept: <canvas> is a bitmap you draw on with a 2D API (paths, fills),
 * much like a plotting library. The icons themselves live in
 * `shared/itemIcons.ts` (the TV HUD uses the same ones). We only redraw every
 * animation frame while something moves (roulette, or an animated icon);
 * static icons are drawn once.
 */
import type { ItemDisplay } from '../shared/protocol';
import { isIconAnimated, paintItemIcon, paintRoulette } from '../shared/itemIcons';

export class ItemView {
  private ctx: CanvasRenderingContext2D;
  private display: ItemDisplay = { kind: 'none' };
  private raf = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  set(display: ItemDisplay): void {
    this.display = display;
    cancelAnimationFrame(this.raf);
    this.draw(performance.now());
  }

  /** Match the canvas bitmap to its on-screen size x devicePixelRatio for crisp drawing. */
  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = Math.max(64, Math.round(Math.min(rect.width, rect.height) * (window.devicePixelRatio || 1)));
    this.canvas.width = px;
    this.canvas.height = px;
    this.draw(performance.now());
  }

  private draw = (t: number): void => {
    cancelAnimationFrame(this.raf); // never run two loops at once
    const ctx = this.ctx;
    const s = this.canvas.width;
    ctx.clearRect(0, 0, s, s);

    // Item box frame
    ctx.lineWidth = s * 0.04;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(ctx, s * 0.06, s * 0.06, s * 0.88, s * 0.88, s * 0.16);
    ctx.fill();
    ctx.stroke();

    // The icon sits inside the frame with a small margin.
    const d = this.display;
    const inset = s * 0.14;
    ctx.save();
    ctx.translate(inset, inset);
    const iconSize = s - inset * 2;
    let animating = false;
    if (d.kind === 'roulette') {
      paintRoulette(ctx, iconSize, t);
      animating = true;
    } else if (d.kind === 'item') {
      paintItemIcon(ctx, d.id, iconSize, t, d.count);
      animating = isIconAnimated(d.id);
    }
    ctx.restore();
    if (animating) this.raf = requestAnimationFrame(this.draw);
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
