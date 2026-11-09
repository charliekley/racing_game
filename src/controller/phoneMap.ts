/**
 * Track minimap for the middle of the phone screen.
 *
 * The host sends the track outline once per race ({t:'track'}) and every
 * kart's position about 8 times a second ({t:'map'}). We redraw only when a
 * message arrives (not every animation frame), which keeps the phone cool.
 *
 * Orientation matches the TV's overview map: the world is drawn with +z up and
 * x mirrored, the way the driver sees the start straight.
 */
export class PhoneMap {
  private ctx: CanvasRenderingContext2D;
  private pts: number[] = [];
  private halfWidth = 7;
  private bounds = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
  private dots: number[] = [];
  private colorOf: (slot: number) => string = () => '#ffffff';
  private me: number | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get hasTrack(): boolean {
    return this.pts.length >= 6;
  }

  /** `pts` = flat [x, z, x, z, …] along the closed centerline; `width` = road width (m). */
  setTrack(pts: number[], width: number): void {
    this.pts = pts;
    this.halfWidth = width / 2;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i + 1 < pts.length; i += 2) {
      minX = Math.min(minX, pts[i]);
      maxX = Math.max(maxX, pts[i]);
      minZ = Math.min(minZ, pts[i + 1]);
      maxZ = Math.max(maxZ, pts[i + 1]);
    }
    const pad = width + 6;
    this.bounds = { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
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
    this.pts = [];
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
    const ctx = this.ctx;
    const S = this.canvas.width;
    ctx.clearRect(0, 0, S, S);

    // Rounded dark panel with the same white border as the old item box.
    ctx.lineWidth = S * 0.035;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    const r = S * 0.14;
    const m = S * 0.05;
    ctx.beginPath();
    ctx.roundRect(m, m, S - 2 * m, S - 2 * m, r);
    ctx.fill();
    ctx.stroke();
    if (!this.hasTrack) return;

    const b = this.bounds;
    const inner = S - 2 * m - S * 0.08;
    const scale = Math.min(inner / (b.maxX - b.minX), inner / (b.maxZ - b.minZ));
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const toScreen = (x: number, z: number): [number, number] => [S / 2 - (x - cx) * scale, S / 2 - (z - cz) * scale];

    // Road: a dark outline under a lighter line.
    const trace = () => {
      ctx.beginPath();
      for (let i = 0; i + 1 < this.pts.length; i += 2) {
        const [sx, sy] = toScreen(this.pts[i], this.pts[i + 1]);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
    };
    ctx.lineJoin = 'round';
    trace();
    ctx.strokeStyle = '#202a3a';
    ctx.lineWidth = Math.max(5, this.halfWidth * 2 * scale + 4);
    ctx.stroke();
    trace();
    ctx.strokeStyle = '#9aa3b8';
    ctx.lineWidth = Math.max(3, this.halfWidth * 2 * scale);
    ctx.stroke();

    // Start/finish tick at the first point.
    const [sx, sy] = toScreen(this.pts[0], this.pts[1]);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx - 3, sy - 3, 6, 6);

    // Karts: everyone else first, then me on top (bigger, with a ring).
    const dot = (slot: number, x: number, z: number, isMe: boolean) => {
      const [px, py] = toScreen(x, z);
      ctx.beginPath();
      ctx.arc(px, py, S * (isMe ? 0.05 : 0.036), 0, Math.PI * 2);
      ctx.fillStyle = this.colorOf(slot);
      ctx.fill();
      ctx.lineWidth = S * (isMe ? 0.018 : 0.01);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    };
    for (let i = 0; i + 2 < this.dots.length; i += 3) if (this.dots[i] !== this.me) dot(this.dots[i], this.dots[i + 1], this.dots[i + 2], false);
    for (let i = 0; i + 2 < this.dots.length; i += 3) if (this.dots[i] === this.me) dot(this.dots[i], this.dots[i + 1], this.dots[i + 2], true);
  }
}
