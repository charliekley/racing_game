/**
 * Top-down overview map drawn with the 2D canvas API (cheap: a few hundred
 * line segments + a dot per kart). Used in the spare quadrant with 3 players.
 */
import type { Track } from '../sim/track';
import type { Rect } from './layout';

export interface MapDot {
  x: number;
  z: number;
  color: string;
  label: string;
}

export class Minimap {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private bounds: { minX: number; maxX: number; minZ: number; maxZ: number };

  constructor(
    private readonly track: Track,
    parent: HTMLElement,
  ) {
    this.canvas.className = 'minimap';
    parent.appendChild(this.canvas);
    const xs = track.samples.map((p) => p.x);
    const zs = track.samples.map((p) => p.z);
    const pad = track.def.width + 10;
    this.bounds = {
      minX: Math.min(...xs) - pad,
      maxX: Math.max(...xs) + pad,
      minZ: Math.min(...zs) - pad,
      maxZ: Math.max(...zs) + pad,
    };
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
    const ctx = this.ctx;
    const b = this.bounds;
    // Fit the track, preserving aspect ratio. Screen x = world -x so the map
    // matches the driver's left/right when heading +z is "up".
    const scale = Math.min(W / (b.maxX - b.minX), H / (b.maxZ - b.minZ)) * 0.9;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const toScreen = (x: number, z: number): [number, number] => [W / 2 - (x - cx) * scale, H / 2 - (z - cz) * scale];

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(15, 18, 38, 0.92)';
    ctx.fillRect(0, 0, W, H);

    // Road
    const S = this.track.samples;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    S.forEach((p, i) => {
      const [sx, sy] = toScreen(p.x, p.z);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.strokeStyle = '#2a3a2a';
    ctx.lineWidth = (this.track.def.width + 6) * scale;
    ctx.stroke();
    ctx.strokeStyle = '#8a90a0';
    ctx.lineWidth = this.track.def.width * scale;
    ctx.stroke();

    // Start line
    const s0 = S[0];
    const hw = this.track.def.width / 2;
    const [ax, ay] = toScreen(s0.x - s0.rx * hw, s0.z - s0.rz * hw);
    const [bx, by] = toScreen(s0.x + s0.rx * hw, s0.z + s0.rz * hw);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();

    // Karts (draw leader last so it's on top)
    const r = Math.max(6, Math.min(W, H) * 0.025);
    for (const d of [...dots].reverse()) {
      const [sx, sy] = toScreen(d.x, d.z);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(r * 1.6)}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.label, sx + r * 1.3, sy);
    }
  }
}
