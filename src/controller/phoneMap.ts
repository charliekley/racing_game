/**
 * Track map for the middle of the phone screen.
 *
 * The host sends the track once per race ({t:'track'}: an outline, plus the full
 * `MapData` with heights, bridges, cliffs, cannons...) and every kart's position about
 * 8 times a second ({t:'map'}). We redraw only when a message arrives (not every
 * animation frame), which keeps the phone cool; the roads are cached in an offscreen
 * layer and only the dots are redrawn.
 *
 * The drawing code is shared with the TV minimap (shared/mapDraw.ts), so both look alike.
 */
import { isMapData, mapDataFromOutline, MapCache, type MapData, type MapDot } from '../shared/mapDraw';

export class PhoneMap {
  private ctx: CanvasRenderingContext2D;
  private cache = new MapCache(() => document.createElement('canvas'));
  private data: MapData | null = null;
  private dots: number[] = [];
  private colorOf: (slot: number) => string = () => '#ffffff';
  private me: number | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get hasTrack(): boolean {
    return this.data !== null && this.data.routes.some((r) => r.points.length >= 3);
  }

  /**
   * `pts` = flat [x, z, x, z, …] along the closed centerline; `width` = road width (m).
   * `map` = the rich map from newer hosts; without it (or if it is malformed) we draw the plain outline.
   */
  setTrack(pts: number[], width: number, map?: unknown): void {
    this.data = isMapData(map) ? map : mapDataFromOutline(pts, width);
    this.cache.invalidate();
    this.draw();
  }

  /** `d` = flat [slot, x, z, slot, x, z, …]. */
  setDots(d: number[], colorOf: (slot: number) => string, me: number | null): void {
    this.dots = d;
    this.colorOf = colorOf;
    this.me = me;
    this.draw();
  }

  clear(): void {
    this.data = null;
    this.dots = [];
    this.draw();
  }

  /** Match the canvas bitmap to its on-screen size x devicePixelRatio for crisp lines. */
  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = Math.max(64, Math.round(Math.min(rect.width, rect.height) * (window.devicePixelRatio || 1)));
    if (this.canvas.width !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    this.draw();
  }

  private draw(): void {
    const S = this.canvas.width;
    const size = { w: S, h: this.canvas.height };
    if (!this.data || !this.hasTrack) {
      // No track yet: just the empty rounded panel, like the old item box.
      this.ctx.clearRect(0, 0, size.w, size.h);
      const m = S * 0.05;
      this.ctx.lineWidth = S * 0.035;
      this.ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      this.ctx.fillStyle = 'rgba(0,0,0,0.4)';
      this.ctx.beginPath();
      this.ctx.roundRect(m, m, S - 2 * m, S - 2 * m, S * 0.14);
      this.ctx.fill();
      this.ctx.stroke();
      return;
    }
    const dots: MapDot[] = [];
    for (let i = 0; i + 2 < this.dots.length; i += 3) {
      dots.push({ x: this.dots[i + 1], z: this.dots[i + 2], color: this.colorOf(this.dots[i]), own: this.dots[i] === this.me });
    }
    this.cache.draw(this.ctx, size, this.data, dots, { panel: 'rounded', fit: 0.78, panelColor: '#0c0f1f' });
  }
}
