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

  constructor(track: Track, parent: HTMLElement) {
    this.canvas.className = 'minimap';
    parent.appendChild(this.canvas);
    this.data = mapDataFromTrack(track);
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

  /** `dots` come in standings order; the leader is drawn last so it ends up on top. */
  draw(dots: MapDot[]): void {
    if (this.canvas.style.display === 'none') return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(this.canvas.clientWidth * dpr);
    const H = Math.round(this.canvas.clientHeight * dpr);
    if (W === 0 || H === 0) return;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    this.cache.draw(this.ctx, { w: W, h: H }, this.data, [...dots].reverse(), { labels: true, dotRadius: 0.025 });
  }
}
