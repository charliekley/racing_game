/**
 * Flat 2D portraits of the eight drivers, drawn with the canvas API (no images, no 3D).
 * Each one is built from a few circles, ellipses and triangles in the driver's two
 * colours (`look.primary`, `look.secondary` from shared/characters.ts).
 *
 * Web concept: a <canvas> is a bitmap you draw on with commands like `ctx.arc(...)`.
 * We draw in a fixed 100 x 100 "design space" and let `ctx.scale` fit it to whatever
 * size the canvas has, so the same code works at any resolution.
 */
import type { DriverLook } from '../shared/characters';

type Ctx = CanvasRenderingContext2D;

const OUTLINE = 'rgba(20, 22, 48, 0.55)';
const EYE = '#1b1d3a';

function path(c: Ctx, pts: [number, number][]): void {
  c.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
  c.closePath();
}

/** Filled shape with the common soft outline. `draw` must build the path. */
function fill(c: Ctx, color: string, draw: () => void): void {
  draw();
  c.fillStyle = color;
  c.fill();
  c.lineWidth = 2.5;
  c.strokeStyle = OUTLINE;
  c.lineJoin = 'round';
  c.stroke();
}

const circle = (c: Ctx, x: number, y: number, r: number, color: string) => fill(c, color, () => (c.beginPath(), c.arc(x, y, r, 0, Math.PI * 2)));
const ellipse = (c: Ctx, x: number, y: number, rx: number, ry: number, color: string) =>
  fill(c, color, () => (c.beginPath(), c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)));
const tri = (c: Ctx, color: string, a: [number, number], b: [number, number], d: [number, number]) => fill(c, color, () => path(c, [a, b, d]));

/** A cute eye: dark dot with a small white sparkle. */
function eye(c: Ctx, x: number, y: number, r = 4.2): void {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = EYE;
  c.fill();
  c.beginPath();
  c.arc(x + r * 0.3, y - r * 0.35, r * 0.38, 0, Math.PI * 2);
  c.fillStyle = '#fff';
  c.fill();
}

/** Small smile centred at (x, y). */
function smile(c: Ctx, x: number, y: number, w: number): void {
  c.beginPath();
  c.moveTo(x - w, y);
  c.quadraticCurveTo(x, y + w * 0.9, x + w, y);
  c.lineWidth = 2.2;
  c.lineCap = 'round';
  c.strokeStyle = EYE;
  c.stroke();
}

function line(c: Ctx, x0: number, y0: number, x1: number, y1: number, w = 1.6): void {
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.lineWidth = w;
  c.lineCap = 'round';
  c.strokeStyle = OUTLINE;
  c.stroke();
}

const DRAWERS: Record<DriverLook['species'], (c: Ctx, p: string, s: string) => void> = {
  chick(c, p, s) {
    for (const dx of [-7, 0, 7]) ellipse(c, 50 + dx, 17 + Math.abs(dx) * 0.25, 4, 8, p); // head tuft
    circle(c, 50, 55, 33, p);
    ellipse(c, 20, 60, 8, 12, p); // little wings
    ellipse(c, 80, 60, 8, 12, p);
    eye(c, 38, 48);
    eye(c, 62, 48);
    tri(c, s, [43, 56], [57, 56], [50, 68]); // beak
    circle(c, 30, 62, 4, 'rgba(255,120,120,0.55)'); // blush
    circle(c, 70, 62, 4, 'rgba(255,120,120,0.55)');
  },
  cat(c, p, s) {
    tri(c, p, [20, 44], [24, 12], [48, 28]); // ears
    tri(c, p, [80, 44], [76, 12], [52, 28]);
    tri(c, s, [26, 38], [28, 21], [41, 30]);
    tri(c, s, [74, 38], [72, 21], [59, 30]);
    ellipse(c, 50, 56, 35, 30, p);
    eye(c, 37, 52);
    eye(c, 63, 52);
    tri(c, s, [46, 61], [54, 61], [50, 66]); // nose
    smile(c, 44, 68, 5);
    smile(c, 56, 68, 5);
    line(c, 14, 58, 30, 61);
    line(c, 14, 68, 30, 66);
    line(c, 86, 58, 70, 61);
    line(c, 86, 68, 70, 66);
  },
  frog(c, p, s) {
    ellipse(c, 50, 60, 38, 28, p);
    circle(c, 31, 30, 14, p); // bulging eyes sit on top of the head
    circle(c, 69, 30, 14, p);
    circle(c, 31, 30, 9, '#fff');
    circle(c, 69, 30, 9, '#fff');
    circle(c, 33, 31, 5, EYE);
    circle(c, 67, 31, 5, EYE);
    ellipse(c, 50, 72, 22, 9, s); // pale chin
    smile(c, 50, 64, 16);
    circle(c, 22, 66, 3.5, 'rgba(255,120,120,0.55)');
    circle(c, 78, 66, 3.5, 'rgba(255,120,120,0.55)');
  },
  astronaut(c, p, s) {
    circle(c, 50, 52, 38, p); // helmet
    fill(c, s, () => {
      c.beginPath();
      c.roundRect(22, 36, 56, 36, 16); // visor
    });
    c.beginPath();
    c.ellipse(36, 46, 6, 3.5, -0.5, 0, Math.PI * 2); // glare
    c.fillStyle = 'rgba(255,255,255,0.65)';
    c.fill();
    eye(c, 42, 58, 3.6);
    eye(c, 58, 58, 3.6);
    line(c, 50, 14, 50, 4, 2.5); // antenna
    circle(c, 50, 5, 3.5, '#ff6b5a');
  },
  robot(c, p, s) {
    line(c, 50, 22, 50, 8, 3);
    circle(c, 50, 8, 5, s); // antenna bulb
    fill(c, p, () => {
      c.beginPath();
      c.roundRect(15, 22, 70, 62, 16);
    });
    ellipse(c, 12, 54, 4, 10, s); // ear bolts
    ellipse(c, 88, 54, 4, 10, s);
    fill(c, '#23264a', () => {
      c.beginPath();
      c.roundRect(24, 36, 52, 22, 10); // screen
    });
    fill(c, s, () => (c.beginPath(), c.roundRect(31, 42, 12, 10, 4)));
    fill(c, s, () => (c.beginPath(), c.roundRect(57, 42, 12, 10, 4)));
    for (const x of [34, 42, 50, 58, 66]) line(c, x, 68, x, 76, 2.4); // speaker grille
  },
  fox(c, p, s) {
    tri(c, p, [16, 48], [18, 10], [46, 30]); // tall ears
    tri(c, p, [84, 48], [82, 10], [54, 30]);
    tri(c, '#3a2a28', [24, 40], [24, 22], [38, 32]);
    tri(c, '#3a2a28', [76, 40], [76, 22], [62, 32]);
    ellipse(c, 50, 56, 36, 28, p);
    tri(c, s, [14, 58], [50, 50], [50, 86]); // cream cheeks
    tri(c, s, [86, 58], [50, 50], [50, 86]);
    eye(c, 37, 50);
    eye(c, 63, 50);
    circle(c, 50, 72, 4.5, '#2a2030'); // nose
  },
  bear(c, p, s) {
    circle(c, 22, 24, 12, p); // round ears
    circle(c, 78, 24, 12, p);
    circle(c, 22, 24, 6, s);
    circle(c, 78, 24, 6, s);
    circle(c, 50, 54, 38, p);
    ellipse(c, 50, 66, 18, 14, s); // muzzle
    eye(c, 36, 48);
    eye(c, 64, 48);
    ellipse(c, 50, 61, 6, 4.5, '#2a2030');
    smile(c, 50, 70, 6);
  },
  dino(c, p, s) {
    for (const x of [30, 44, 58]) tri(c, s, [x - 7, 26], [x, 8], [x + 7, 26]); // back spikes
    fill(c, p, () => {
      c.beginPath();
      c.roundRect(14, 22, 72, 62, 28); // big round head
    });
    ellipse(c, 62, 68, 26, 14, s); // snout belly colour
    circle(c, 70, 62, 2.6, 'rgba(20,22,48,0.6)'); // nostrils
    circle(c, 80, 62, 2.6, 'rgba(20,22,48,0.6)');
    eye(c, 40, 46, 5);
    circle(c, 24, 62, 4, 'rgba(255,120,120,0.5)');
  },
};

/**
 * Draw a driver portrait filling the whole canvas. Call again to change the character.
 * Works with any canvas size; for crisp output on phones set canvas.width/height to the
 * displayed size times `devicePixelRatio` first (the picker does).
 */
export function drawPortrait(canvas: HTMLCanvasElement, look: DriverLook): void {
  const c = canvas.getContext('2d');
  if (!c) return;
  const size = Math.min(canvas.width, canvas.height);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.save();
  c.translate((canvas.width - size) / 2, (canvas.height - size) / 2);
  c.scale(size / 100, size / 100);
  // Soft backdrop disc so the portrait reads on the dark page.
  c.beginPath();
  c.arc(50, 50, 48, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,255,255,0.10)';
  c.fill();
  DRAWERS[look.species](c, look.primary, look.secondary);
  c.restore();
}
