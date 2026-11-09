/**
 * Ink splat overlay for one viewport (the "Jumble" item effect).
 *
 * `show(seconds)` builds a random pattern of big ink blobs, drawn ONCE into an
 * offscreen canvas. Each frame `update()` only does a clear + one drawImage
 * (with scale/alpha) + a few drip lines, so it is cheap for 4 viewports.
 *
 * Timeline: pop-in (0.35 s, overshoot) -> hold -> smooth fade over the last 1.2 s.
 * Everything here is cosmetic, so `Math.random` is fine.
 */

const APPEAR_SECONDS = 0.35;
const FADE_SECONDS = 1.2;

/** Clamp to 0..1. */
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Pure timing helper. `t` = seconds since the splat started, `total` = lifetime.
 * - appear: 0 -> 1 over the first 0.35 s (linear progress; the overshoot is applied by the caller)
 * - fade:   opacity multiplier, 1 while holding, smoothly 1 -> 0 over the last 1.2 s
 */
export function inkPhase(t: number, total: number): { appear: number; fade: number } {
  const appear = clamp01(t / APPEAR_SECONDS);
  const fadeLen = Math.min(FADE_SECONDS, Math.max(total, 1e-6));
  const f = clamp01((total - t) / fadeLen); // 1 -> 0 across the fade window
  const fade = f * f * (3 - 2 * f); // smoothstep
  return { appear, fade };
}

/** Ease-out-back: rises past 1 and settles back (the quick "splat" overshoot). */
export function easeOutBack(x: number): number {
  const c1 = 1.9;
  const c3 = c1 + 1;
  const u = x - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

// --- pattern description (normalised 0..1 coordinates, so it survives resizes) ---

interface Blob {
  x: number; y: number; // centre as a fraction of width / height
  r: number; // radius as a fraction of the viewport HEIGHT
  harmonics: { k: number; amp: number; phase: number }[]; // makes the edge irregular
}
/** A drip running down from (x, y); `speed` is in viewport heights per second. */
interface Drip { x: number; y: number; w: number; maxLen: number; speed: number }
interface Pattern { blobs: Blob[]; drops: { x: number; y: number; r: number }[]; drips: Drip[] }

/** Keep this central area (fraction of width / height) free so the player can still drive. */
const KEEP_CLEAR_RX = 0.2;
const KEEP_CLEAR_RY = 0.26;

/** Build a random pattern covering roughly 40-55% of the screen. */
function makePattern(aspect: number): Pattern {
  const target = 0.42 + Math.random() * 0.1;
  // Coarse grid used only to estimate how much of the screen is covered.
  const GX = 40, GY = 24;
  const covered = new Uint8Array(GX * GY);
  let coveredCount = 0;
  const blobs: Blob[] = [];
  const drops: Pattern['drops'] = [];

  for (let tries = 0; tries < 120 && coveredCount / (GX * GY) < target; tries++) {
    const x = Math.random() * 1.1 - 0.05;
    const y = Math.random() * 1.1 - 0.05;
    // Distance from the clear centre zone in "ellipse units" (1 = its edge).
    const dist = Math.hypot((x - 0.5) / KEEP_CLEAR_RX, (y - 0.5) / KEEP_CLEAR_RY);
    if (dist < 1.1) continue;
    // Big blobs, but never reaching into the clear zone.
    const wantR = 0.1 + Math.random() * 0.17;
    const maxToCentre = (dist - 1) * KEEP_CLEAR_RY * 0.85;
    const r = Math.min(wantR, maxToCentre + 0.05);
    if (r < 0.06) continue;

    blobs.push({
      x, y, r,
      harmonics: [
        { k: 3, amp: 0.12 + Math.random() * 0.1, phase: Math.random() * 6.28 },
        { k: 5, amp: 0.07 + Math.random() * 0.06, phase: Math.random() * 6.28 },
        { k: 8, amp: 0.04 + Math.random() * 0.05, phase: Math.random() * 6.28 },
      ],
    });

    // Mark grid cells inside this blob as covered.
    for (let gy = 0; gy < GY; gy++) {
      for (let gx = 0; gx < GX; gx++) {
        const i = gy * GX + gx;
        if (covered[i]) continue;
        const px = ((gx + 0.5) / GX - x) * aspect; // width fraction -> height units
        const py = (gy + 0.5) / GY - y;
        if (Math.hypot(px, py) < r * 0.92) {
          covered[i] = 1;
          coveredCount++;
        }
      }
    }

    // Small satellite droplets flung out from the blob.
    const nd = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < nd; i++) {
      const a = Math.random() * 6.28;
      const d = r * (1.25 + Math.random() * 0.7);
      const px = x + (Math.cos(a) * d) / aspect, py = y + Math.sin(a) * d;
      if (Math.hypot((px - 0.5) / KEEP_CLEAR_RX, (py - 0.5) / KEEP_CLEAR_RY) < 1.05) continue;
      drops.push({ x: px, y: py, r: r * (0.07 + Math.random() * 0.12) });
    }
  }

  // A few drips run down from the lower side of the bigger blobs.
  const drips: Drip[] = [];
  for (const b of [...blobs].sort((a, c) => c.r - a.r).slice(0, 5)) {
    if (b.y > 0.8 || Math.random() < 0.25) continue;
    drips.push({
      x: b.x + (((Math.random() - 0.5) * b.r * 0.9) / aspect),
      y: b.y + b.r * 0.55,
      w: 0.012 + Math.random() * 0.012,
      maxLen: 0.08 + Math.random() * 0.14,
      speed: 0.03 + Math.random() * 0.03,
    });
  }
  return { blobs, drops, drips };
}

/** Closed smooth outline whose radius wobbles with a few sine harmonics. */
function blobOutline(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, b: Blob): void {
  const n = 40;
  const pts: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let rr = 1;
    for (const h of b.harmonics) rr += h.amp * Math.sin(h.k * a + h.phase);
    pts.push([cx + Math.cos(a) * r * rr, cy + Math.sin(a) * r * rr]);
  }
  // Quadratic curves between the midpoints of neighbouring points give a smooth closed shape.
  const mid = (p: number[], q: number[]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const start = mid(pts[n - 1], pts[0]);
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const m = mid(pts[i], pts[(i + 1) % n]);
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
  }
  ctx.closePath();
}

const INK_DARK = '#120a2c';
const INK_MID = '#2a1658';
const INK_LIGHT = '#6a4cc0';

export class InkOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly layer: HTMLCanvasElement; // offscreen: the pre-rendered blobs
  private readonly resizeObs: ResizeObserver | null;

  private pattern: Pattern | null = null;
  private total = 0;
  private startTime: number | null = null; // taken from the first update() after show()
  private isActive = false;
  private w = 0;
  private h = 0;

  constructor(private readonly parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ink-overlay';
    this.ctx = this.canvas.getContext('2d');
    this.layer = document.createElement('canvas');
    parent.appendChild(this.canvas);

    this.resizeObs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObs?.observe(parent);
  }

  /** True while a splat is on screen (the host should call `update` every frame while this is true). */
  get active(): boolean {
    return this.isActive;
  }

  /** Splat new ink that lasts `seconds`. Restarts if already active. */
  show(seconds: number): void {
    this.total = Math.max(0.1, seconds);
    this.startTime = null;
    this.isActive = true;
    this.measure();
    this.pattern = makePattern(this.w / this.h);
    this.renderLayer();
    this.canvas.style.display = 'block';
    this.drawFrame(0);
  }

  /** Advance the animation. `nowSeconds` is any steadily increasing clock (e.g. performance.now() / 1000). */
  update(nowSeconds: number): void {
    if (!this.isActive) return;
    if (this.startTime === null) this.startTime = nowSeconds;
    const t = nowSeconds - this.startTime;
    if (t >= this.total) {
      this.finish();
      return;
    }
    this.drawFrame(t);
  }

  /** Remove the canvas and stop observing. */
  dispose(): void {
    this.resizeObs?.disconnect();
    this.canvas.remove();
    this.isActive = false;
  }

  // --- internals ---

  private finish(): void {
    this.isActive = false;
    this.pattern = null;
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.canvas.style.display = 'none';
  }

  /** Read the parent's size and size both canvases to match. Returns true if it changed. */
  private measure(): boolean {
    const w = Math.max(2, this.parent.clientWidth);
    const h = Math.max(2, this.parent.clientHeight);
    if (w === this.w && h === this.h) return false;
    this.w = w;
    this.h = h;
    this.canvas.width = this.layer.width = w;
    this.canvas.height = this.layer.height = h;
    return true;
  }

  private resize(): void {
    if (!this.measure() || !this.isActive || !this.pattern) return;
    // Same pattern (it is in normalised units), redrawn at the new size.
    this.renderLayer();
  }

  /** Draw all blobs into the offscreen layer. Done once per show() (or on resize). */
  private renderLayer(): void {
    const g = this.layer.getContext('2d');
    if (!g || !this.pattern) return;
    const { w, h } = this;
    g.clearRect(0, 0, w, h);
    g.lineJoin = 'round';

    for (const d of this.pattern.drops) {
      g.fillStyle = INK_DARK;
      g.beginPath();
      g.arc(d.x * w, d.y * h, d.r * h, 0, Math.PI * 2);
      g.fill();
    }
    // Dark body of every blob first (overlaps merge into one mass)...
    for (const b of this.pattern.blobs) {
      const cx = b.x * w, cy = b.y * h, r = b.r * h;
      blobOutline(g, cx, cy, r, b);
      const grad = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r * 1.2);
      grad.addColorStop(0, INK_MID);
      grad.addColorStop(1, INK_DARK);
      g.fillStyle = grad;
      g.fill();
    }
    // ...then glossy highlights on top.
    for (const b of this.pattern.blobs) {
      const cx = b.x * w, cy = b.y * h, r = b.r * h;
      g.fillStyle = 'rgba(190,170,255,0.35)';
      g.beginPath();
      g.ellipse(cx - r * 0.35, cy - r * 0.4, r * 0.28, r * 0.13, -0.7, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.beginPath();
      g.arc(cx - r * 0.5, cy - r * 0.22, r * 0.05, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = INK_LIGHT;
      g.globalAlpha = 0.35;
      g.lineWidth = Math.max(1.5, r * 0.04);
      g.beginPath();
      g.arc(cx, cy, r * 0.8, 0.15 * Math.PI, 0.55 * Math.PI);
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  /** Per-frame work: clear, one scaled/faded drawImage, and a handful of drip lines. */
  private drawFrame(t: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.pattern) return;
    const { w, h } = this;
    const { appear, fade } = inkPhase(t, this.total);
    const scale = 0.5 + 0.5 * easeOutBack(appear); // 0.5 -> ~1.04 -> 1 (overshoot)
    const alpha = fade * Math.min(1, appear * 2.5);

    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    ctx.translate(-w / 2, -h / 2);
    ctx.drawImage(this.layer, 0, 0);
    ctx.restore();

    // Drips start running once the splat has landed.
    const run = t - APPEAR_SECONDS;
    if (run > 0) {
      ctx.strokeStyle = INK_DARK;
      ctx.fillStyle = INK_DARK;
      ctx.lineCap = 'round';
      for (const d of this.pattern.drips) {
        const len = Math.min(d.maxLen, d.speed * run) * h;
        const x = d.x * w, y = d.y * h, lw = d.w * h;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + len);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y + len, lw * 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}
