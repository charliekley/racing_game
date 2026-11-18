/**
 * Top-down overview map for the spare quadrant with 3 players. The drawing lives in
 * shared/mapDraw.ts (the phone map uses the same code); this class just owns the canvas,
 * keeps it sized to its on-screen rect, and feeds it the track's MapData and the kart dots.
 * The roads, bridges, cliffs and cannons are rendered once into an offscreen layer
 * (MapCache), so each frame only draws the dots.
 */
import { mapDataFromTrack } from '../sim/mapData';
import type { Track } from '../sim/track';
import { MapCache, type MapData, type MapDot } from '../shared/mapDraw';
import type { Rect } from './layout';

export type { MapDot };

export class Minimap {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private cache = new MapCache(() => document.createElement('canvas'));
  /** What the map shows (also what the phones are sent). */
  readonly data: MapData;
  /** PERF: reading clientWidth forces the browser to lay out the page (right after the HUD wrote to it), so the size is cached and refreshed only when the element is resized. */
  private cssW = 0;
  private cssH = 0;
  private lastDraw = 0;
  private readonly watcher: ResizeObserver | null;
  private readonly dotsScratch: MapDot[] = [];

  constructor(track: Track, parent: HTMLElement) {
    this.canvas.className = 'minimap';
    parent.appendChild(this.canvas);
    this.data = mapDataFromTrack(track);
    this.watcher = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.measure());
    this.watcher?.observe(this.canvas);
  }

  private measure(): void {
    this.cssW = this.canvas.clientWidth;
    this.cssH = this.canvas.clientHeight;
  }

  /** Stop watching (the canvas is going away). */
  dispose(): void {
    this.watcher?.disconnect();
    this.canvas.remove();
  }

  /** Position the map over a screen rect (fractions) or hide it (null). */
  place(rect: Rect | null): void {
    this.canvas.style.display = rect ? 'block' : 'none';
    if (!rect) return;
    Object.assign(this.canvas.style, {
      left: `${rect.x * 100}%`,
      top: `${rect.y * 100}%`,
      width: `${rect.w * 100}%`,
      height: `${rect.h * 100}%`,
    });
  }

  /**
   * True when a redraw is worthwhile: the map is visible (only with 3 players) and the last one is older than
   * 32 ms (dots barely move in 1/30 s on a map this small). The caller can skip building its dots otherwise.
   */
  due(): boolean {
    return this.canvas.style.display !== 'none' && performance.now() - this.lastDraw >= 32;
  }

  /** `dots` come in standings order; the leader is drawn last so it ends up on top. */
  draw(dots: MapDot[]): void {
    if (this.canvas.style.display === 'none') return;
    if (!this.due()) return;
    this.lastDraw = performance.now();
    if (this.cssW === 0) this.measure();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(this.cssW * dpr);
    const H = Math.round(this.cssH * dpr);
    if (W === 0 || H === 0) return;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const rev = this.dotsScratch; // reused array (no per-frame allocation)
    rev.length = 0;
    for (let i = dots.length - 1; i >= 0; i--) rev.push(dots[i]);
    this.cache.draw(this.ctx, { w: W, h: H }, this.data, rev, { labels: true, dotRadius: 0.025 });
  }
}
