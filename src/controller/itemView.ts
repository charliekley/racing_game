/**
 * Draws the held item in the middle of the phone screen on a <canvas>.
 *
 * Web concept: <canvas> is a bitmap you draw on with a 2D API (paths, fills),
 * much like a plotting library. We redraw it every animation frame while the
 * roulette spins.
 *
 * Milestone 1 has placeholder art; the real item icons are registered in
 * Milestone 6 via `registerItemIcon`.
 */
import type { ItemDisplay } from '../shared/protocol';

export type IconPainter = (ctx: CanvasRenderingContext2D, size: number, t: number) => void;

const icons = new Map<string, IconPainter>();

export function registerItemIcon(id: string, painter: IconPainter): void {
  icons.set(id, painter);
}

/** Placeholder used for unknown ids (and for the M1 "Test item" button). */
const placeholder: IconPainter = (ctx, s) => {
  ctx.fillStyle = '#ffbe0b';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? s * 0.38 : s * 0.17;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(s / 2 + r * Math.cos(a), s / 2 + r * Math.sin(a));
  }
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = s * 0.03;
  ctx.strokeStyle = '#7a4b00';
  ctx.stroke();
};

/** Shapes flashed during the roulette (until real icons exist). */
const rouletteColors = ['#3a86ff', '#ff4fa3', '#2bb673', '#ffbe0b', '#8338ec'];

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

    const d = this.display;
    if (d.kind === 'roulette') {
      const i = Math.floor(t / 70) % rouletteColors.length;
      ctx.fillStyle = rouletteColors[i];
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * (0.22 + 0.06 * Math.sin(t / 50)), 0, Math.PI * 2);
      ctx.fill();
      this.raf = requestAnimationFrame(this.draw);
    } else if (d.kind === 'item') {
      (icons.get(d.id) ?? placeholder)(ctx, s, t);
      if (d.count > 1) {
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.round(s * 0.2)}px system-ui, sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(`×${d.count}`, s * 0.9, s * 0.9);
      }
    }
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
