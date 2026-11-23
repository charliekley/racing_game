/**
 * Flat 2D pictures for the phone picker, drawn with the canvas API (no images, no 3D):
 *  - `drawPortrait`  : the driver's head, front view (the twelve characters)
 *  - `drawKartPicture`: a side view of one kart body in the driver's paint, with the driver's small head in it
 *
 * Every head is built from a few circles, ellipses and triangles in the driver's two colours
 * (`look.primary`, `look.secondary` from shared/characters.ts). All of them share one style: a soft dark
 * outline, big dark eyes with a white sparkle, a little blush.
 *
 * Web concept: a <canvas> is a bitmap you draw on with commands like `ctx.arc(...)`. We draw in a fixed
 * "design space" (100 x 100 for a head, 160 x 100 for a kart) and let `ctx.scale` fit it to whatever size
 * the canvas has, so the same code works at any resolution. Finished pictures are kept in a small cache
 * (an off-screen canvas per picture and size) so redrawing while browsing is just one `drawImage`.
 */
import { CHARACTERS, type DriverLook, type KartPalette } from '../shared/characters';
import { fitDesign } from './pictureMath';

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

const OUTLINE = 'rgba(20, 22, 48, 0.6)';
const EYE = '#1b1d3a';
const BLUSH = 'rgba(255, 110, 130, 0.5)';
const NOSE = '#2a2030';

function path(c: Ctx, pts: Pt[]): void {
  c.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
  c.closePath();
}

/** Filled shape with the common soft outline. `draw` must build the path. */
function fill(c: Ctx, color: string, draw: () => void, lineWidth = 2.5): void {
  draw();
  c.fillStyle = color;
  c.fill();
  c.lineWidth = lineWidth;
  c.strokeStyle = OUTLINE;
  c.lineJoin = 'round';
  c.stroke();
}

const circle = (c: Ctx, x: number, y: number, r: number, color: string) => fill(c, color, () => (c.beginPath(), c.arc(x, y, r, 0, Math.PI * 2)));
const ellipse = (c: Ctx, x: number, y: number, rx: number, ry: number, color: string, rot = 0) =>
  fill(c, color, () => (c.beginPath(), c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2)));
const tri = (c: Ctx, color: string, a: Pt, b: Pt, d: Pt) => fill(c, color, () => path(c, [a, b, d]));
const rrect = (c: Ctx, x: number, y: number, w: number, h: number, r: number | number[], color: string, lw = 2.5) =>
  fill(c, color, () => (c.beginPath(), c.roundRect(x, y, w, h, r)), lw);
/** A shape with no outline (shine, shadow, spots). */
function plain(c: Ctx, color: string, draw: () => void): void {
  draw();
  c.fillStyle = color;
  c.fill();
}

/** A cute eye: dark dot with a small white sparkle. */
function eye(c: Ctx, x: number, y: number, r = 4.4): void {
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

function line(c: Ctx, x0: number, y0: number, x1: number, y1: number, w = 1.6, color = OUTLINE): void {
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.lineWidth = w;
  c.lineCap = 'round';
  c.strokeStyle = color;
  c.stroke();
}

const blush = (c: Ctx, x: number, y: number, r = 4.2) => plain(c, BLUSH, () => (c.beginPath(), c.ellipse(x, y, r * 1.3, r, 0, 0, Math.PI * 2)));

type HeadDrawer = (c: Ctx, p: string, s: string) => void;

const HEADS: Record<DriverLook['species'], HeadDrawer> = {
  // Pip: round yellow chick, three head feathers, stubby wings, orange beak.
  chick(c, p, s) {
    for (const dx of [-8, 0, 8]) ellipse(c, 50 + dx, 18 + Math.abs(dx) * 0.3, 4.2, 9, p, dx * 0.03); // head tuft
    ellipse(c, 17, 62, 8, 13, p, 0.25); // little wings
    ellipse(c, 83, 62, 8, 13, p, -0.25);
    circle(c, 50, 56, 34, p);
    plain(c, 'rgba(255,255,255,0.28)', () => (c.beginPath(), c.ellipse(50, 72, 20, 11, 0, 0, Math.PI * 2))); // fluffy tummy glow
    eye(c, 37, 49, 4.8);
    eye(c, 63, 49, 4.8);
    // Beak: two orange halves (upper wider) so it reads as a beak, not a nose.
    fill(c, s, () => path(c, [[40, 58], [60, 58], [50, 72]]));
    line(c, 42, 61.5, 58, 61.5, 1.4);
    blush(c, 27, 62);
    blush(c, 73, 62);
  },
  // Mochi: white cat, pink ears, whiskers, little "w" mouth.
  cat(c, p, s) {
    tri(c, p, [18, 48], [22, 10], [48, 28]); // ears
    tri(c, p, [82, 48], [78, 10], [52, 28]);
    tri(c, s, [25, 40], [27, 21], [41, 30]); // pink inner ears
    tri(c, s, [75, 40], [73, 21], [59, 30]);
    ellipse(c, 50, 57, 37, 31, p);
    // forehead stripes in the pink
    for (const dx of [-7, 0, 7]) line(c, 50 + dx, 28, 50 + dx, dx === 0 ? 38 : 35, 2.4, s);
    eye(c, 36, 54, 4.8);
    eye(c, 64, 54, 4.8);
    tri(c, s, [46, 62], [54, 62], [50, 67]); // nose
    smile(c, 44.5, 68, 5);
    smile(c, 55.5, 68, 5);
    blush(c, 25, 65);
    blush(c, 75, 65);
    for (const dy of [-3, 4]) {
      line(c, 12, 62 + dy, 27, 63 + dy * 0.5, 1.6); // whiskers
      line(c, 88, 62 + dy, 73, 63 + dy * 0.5, 1.6);
    }
  },
  // Fizz: wide green frog, bulging eyes on top, big grin, pale chin.
  frog(c, p, s) {
    ellipse(c, 50, 62, 39, 28, p);
    ellipse(c, 50, 74, 24, 11, s); // pale chin
    circle(c, 30, 32, 15, p); // bulging eyes sit on top of the head
    circle(c, 70, 32, 15, p);
    circle(c, 30, 32, 10, '#fff');
    circle(c, 70, 32, 10, '#fff');
    circle(c, 32, 33, 5.5, EYE);
    circle(c, 68, 33, 5.5, EYE);
    plain(c, '#fff', () => (c.beginPath(), c.arc(33.8, 31, 1.8, 0, Math.PI * 2)));
    plain(c, '#fff', () => (c.beginPath(), c.arc(69.8, 31, 1.8, 0, Math.PI * 2)));
    c.beginPath(); // wide grin
    c.moveTo(24, 62);
    c.quadraticCurveTo(50, 84, 76, 62);
    c.lineWidth = 2.6;
    c.lineCap = 'round';
    c.strokeStyle = EYE;
    c.stroke();
    circle(c, 46, 54, 1.6, NOSE); // nostrils
    circle(c, 54, 54, 1.6, NOSE);
    blush(c, 19, 66, 3.6);
    blush(c, 81, 66, 3.6);
  },
  // Juno: white helmet, dark glass visor with the face glowing inside, red antenna.
  astronaut(c, p, s) {
    line(c, 50, 15, 50, 5, 3);
    circle(c, 50, 6, 4, '#ff6b5a'); // antenna
    ellipse(c, 13, 54, 5, 11, s); // ear pods
    ellipse(c, 87, 54, 5, 11, s);
    circle(c, 50, 54, 38, p); // helmet
    rrect(c, 20, 34, 60, 42, 20, s); // visor frame
    rrect(c, 25, 39, 50, 32, 15, '#14204a', 1.6); // dark glass
    eye(c, 39, 55, 4.4);
    eye(c, 61, 55, 4.4);
    for (const x of [39, 61]) plain(c, '#bfe6ff', () => (c.beginPath(), c.arc(x, 55, 3.2, 0, Math.PI * 2)));
    smile(c, 50, 62, 4);
    plain(c, 'rgba(255,255,255,0.55)', () => (c.beginPath(), c.ellipse(34, 44, 6, 3, -0.5, 0, Math.PI * 2))); // glare
  },
  // Bolt: boxy grey robot, screen face with yellow eyes, ear bolts, speaker grille.
  robot(c, p, s) {
    line(c, 50, 22, 50, 8, 3);
    circle(c, 50, 8, 5, s); // antenna bulb
    rrect(c, 8, 44, 10, 22, 4, s); // ear bolts
    rrect(c, 82, 44, 10, 22, 4, s);
    rrect(c, 15, 22, 70, 64, 16, p);
    plain(c, 'rgba(255,255,255,0.3)', () => (c.beginPath(), c.roundRect(20, 26, 60, 5, 2.5))); // top shine
    rrect(c, 23, 36, 54, 26, 10, '#23264a'); // screen
    rrect(c, 30, 42, 14, 14, 5, s, 1.4);
    rrect(c, 56, 42, 14, 14, 5, s, 1.4);
    for (const x of [34, 42, 50, 58, 66]) line(c, x, 70, x, 78, 2.6); // speaker grille
  },
  // Sable: orange fox, tall dark-tipped ears, cream cheek ruffs meeting in a pointed muzzle.
  fox(c, p, s) {
    tri(c, p, [14, 50], [18, 8], [46, 30]); // tall ears
    tri(c, p, [86, 50], [82, 8], [54, 30]);
    tri(c, '#3a2a28', [22, 36], [20, 20], [34, 29]); // dark ear tips
    tri(c, '#3a2a28', [78, 36], [80, 20], [66, 29]);
    // Head: round top with pointed cheek ruffs on both sides.
    fill(c, p, () => path(c, [[14, 52], [26, 30], [50, 24], [74, 30], [86, 52], [88, 64], [50, 90], [12, 64]]));
    // Cream face mask: cheeks + muzzle in one shape.
    fill(c, s, () => path(c, [[14, 62], [30, 56], [50, 62], [70, 56], [86, 62], [50, 90]]), 2);
    plain(c, 'rgba(0,0,0,0.08)', () => path(c, [[50, 26], [44, 40], [56, 40]])); // forehead blaze
    eye(c, 35, 49, 4.6);
    eye(c, 65, 49, 4.6);
    ellipse(c, 50, 80, 5.2, 4, NOSE); // nose
    line(c, 50, 84, 50, 86, 1.6, EYE);
    blush(c, 26, 62, 3.4);
    blush(c, 74, 62, 3.4);
  },
  // Bruno: brown bear, round ears, big cream muzzle.
  bear(c, p, s) {
    circle(c, 21, 25, 13, p); // round ears
    circle(c, 79, 25, 13, p);
    circle(c, 21, 25, 6.5, s);
    circle(c, 79, 25, 6.5, s);
    circle(c, 50, 55, 38, p);
    ellipse(c, 50, 67, 19, 15, s); // muzzle
    eye(c, 35, 48, 4.8);
    eye(c, 65, 48, 4.8);
    ellipse(c, 50, 61, 6.5, 4.6, NOSE);
    line(c, 50, 65, 50, 69, 1.8, EYE);
    smile(c, 50, 69, 6.5);
    blush(c, 24, 62, 3.8);
    blush(c, 76, 62, 3.8);
  },
  // Rex: green dino, three yellow head spikes, round snout with nostrils on top, toothy grin.
  dino(c, p, s) {
    for (const [x, h] of [[34, 15], [50, 8], [66, 15]] as const) tri(c, s, [x - 8, 30], [x, h], [x + 8, 30]); // head spikes
    ellipse(c, 50, 56, 38, 33, p); // head
    plain(c, 'rgba(10,60,50,0.18)', () => (c.beginPath(), c.arc(25, 42, 4, 0, Math.PI * 2))); // skin spots
    plain(c, 'rgba(10,60,50,0.18)', () => (c.beginPath(), c.arc(76, 38, 3, 0, Math.PI * 2)));
    plain(c, 'rgba(10,60,50,0.18)', () => (c.beginPath(), c.arc(20, 56, 3, 0, Math.PI * 2)));
    // Big friendly eyes with white sparkle, set wide on the top of the head.
    eye(c, 33, 46, 5.4);
    eye(c, 67, 46, 5.4);
    // Snout: broad pale muzzle in the lower half of the face, nostrils on top, mouth line + teeth.
    ellipse(c, 50, 72, 27, 15, s);
    circle(c, 43, 65, 1.9, NOSE);
    circle(c, 57, 65, 1.9, NOSE);
    c.beginPath();
    c.moveTo(30, 74);
    c.quadraticCurveTo(50, 90, 70, 74);
    c.lineWidth = 2.4;
    c.lineCap = 'round';
    c.strokeStyle = EYE;
    c.stroke();
    tri(c, '#fff', [40, 80.5], [46, 82.5], [43, 87]); // two little teeth
    tri(c, '#fff', [60, 80.5], [54, 82.5], [57, 87]);
    blush(c, 18, 66, 3.6);
    blush(c, 82, 66, 3.6);
  },
  // Chip: navy penguin, white face mask, flat orange beak, little head crest.
  penguin(c, p, s) {
    for (const dx of [-7, 0, 7]) ellipse(c, 50 + dx, 17 + Math.abs(dx) * 0.4, 3.6, 8, p, dx * 0.04); // crest
    ellipse(c, 14, 62, 7, 14, p, 0.3); // flippers
    ellipse(c, 86, 62, 7, 14, p, -0.3);
    circle(c, 50, 55, 35, p);
    ellipse(c, 50, 62, 26, 24, '#f7f9ff'); // white face mask
    eye(c, 38, 52, 4.8);
    eye(c, 62, 52, 4.8);
    fill(c, s, () => path(c, [[38, 60], [62, 60], [50, 74]])); // beak
    line(c, 41, 63.5, 59, 63.5, 1.4);
    plain(c, s, () => (c.beginPath(), c.ellipse(26, 62, 4, 3, 0, 0, Math.PI * 2))); // cheek dabs
    plain(c, s, () => (c.beginPath(), c.ellipse(74, 62, 4, 3, 0, 0, Math.PI * 2)));
  },
  // Otto: tawny owl, big cream facial discs with round amber eyes, ear tufts, tiny hooked beak.
  owl(c, p, s) {
    tri(c, p, [18, 42], [14, 8], [40, 26]); // ear tufts
    tri(c, p, [82, 42], [86, 8], [60, 26]);
    ellipse(c, 50, 56, 39, 33, p);
    ellipse(c, 33, 52, 20, 20, s); // facial discs
    ellipse(c, 67, 52, 20, 20, s);
    for (const x of [33, 67]) {
      circle(c, x, 52, 11, '#fff7e0');
      circle(c, x, 52, 7.5, '#f4b21c');
      circle(c, x, 52, 4.4, EYE);
      plain(c, '#fff', () => (c.beginPath(), c.arc(x + 1.8, 49.5, 1.7, 0, Math.PI * 2)));
    }
    fill(c, '#f0a020', () => path(c, [[45, 60], [55, 60], [50, 74]])); // beak
    for (const dx of [-8, 0, 8]) plain(c, 'rgba(90,50,20,0.25)', () => (c.beginPath(), c.ellipse(50 + dx, 85, 3.5, 2.2, 0, 0, Math.PI * 2))); // chest scallops
  },
  // Rocco: blue-grey rhino, big cream horn, small ears, wide snout.
  rhino(c, p, s) {
    ellipse(c, 22, 28, 8, 11, p, -0.5); // ears
    ellipse(c, 78, 28, 8, 11, p, 0.5);
    ellipse(c, 50, 54, 38, 31, p);
    ellipse(c, 50, 72, 27, 17, '#b8c4d6'); // snout
    tri(c, s, [40, 54], [60, 54], [50, 2]); // horn
    tri(c, s, [43, 36], [57, 36], [50, 22]); // second horn
    eye(c, 28, 50, 4.4);
    eye(c, 72, 50, 4.4);
    circle(c, 41, 66, 2, NOSE); // nostrils
    circle(c, 59, 66, 2, NOSE);
    smile(c, 50, 76, 8);
    blush(c, 20, 62, 3.6);
    blush(c, 80, 62, 3.6);
  },
  // Mabel: lilac elephant, huge ears with pink insides, trunk with a curl, small ivory tusks.
  elephant(c, p, s) {
    ellipse(c, 18, 52, 14, 27, p, 0.15); // big ears
    ellipse(c, 82, 52, 14, 27, p, -0.15);
    ellipse(c, 18, 52, 8, 18, s, 0.15);
    ellipse(c, 82, 52, 8, 18, s, -0.15);
    circle(c, 50, 50, 33, p);
    eye(c, 38, 44, 4.4);
    eye(c, 62, 44, 4.4);
    // Trunk: a rounded bar down the middle that ends in a curl.
    fill(c, p, () => path(c, [[42, 52], [58, 52], [58, 80], [66, 86], [60, 94], [48, 90], [44, 80]]), 2.2);
    for (const y of [62, 70]) line(c, 45, y, 55, y, 1.5);
    tri(c, '#fff4dc', [34, 70], [41, 66], [34, 82]); // tusks
    tri(c, '#fff4dc', [66, 70], [59, 66], [66, 82]);
    blush(c, 27, 60, 3.6);
    blush(c, 73, 60, 3.6);
  },
};

// ---------------------------------------------------------------------------------------------------
// Kart bodies, side view, facing right. Design space 160 x 100, ground at y = 96.
// ---------------------------------------------------------------------------------------------------

export const KART_DESIGN_W = 160;
export const KART_DESIGN_H = 100;

const TIRE = '#23253f';

/** A wheel seen from the side: dark tyre, coloured rim, accent hub cap. */
function wheel(c: Ctx, x: number, y: number, r: number, pal: KartPalette, knobs = false): void {
  circle(c, x, y, r, TIRE);
  if (knobs) {
    // chunky off-road tread: little ticks around the tyre
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      line(c, x + Math.cos(a) * (r - 0.5), y + Math.sin(a) * (r - 0.5), x + Math.cos(a) * (r + 3), y + Math.sin(a) * (r + 3), 3, TIRE);
    }
  }
  circle(c, x, y, r * 0.6, pal.wheels);
  circle(c, x, y, r * 0.24, pal.accent);
}

/** Draw the driver's head small, centred at (x, y), `size` design units wide. */
function miniHead(c: Ctx, look: DriverLook, x: number, y: number, size: number): void {
  c.save();
  c.translate(x - size / 2, y - size / 2);
  c.scale(size / 100, size / 100);
  HEADS[look.species](c, look.primary, look.secondary);
  c.restore();
}

type KartDrawer = (c: Ctx, pal: KartPalette, look: DriverLook) => void;

/** Same order as KART_BODIES in shared/characters.ts (sprinter, mudlark, comet, splash). */
const KARTS: KartDrawer[] = [
  // Sprinter: low open-wheel racer, rear wing, nose cone and front wing.
  (c, pal, look) => {
    line(c, 24, 44, 24, 66, 4.5, '#6a709c'); // wing post (light grey so it shows on the dark page)
    rrect(c, 8, 38, 32, 8, 4, pal.trim); // rear wing
    miniHead(c, look, 70, 42, 46);
    fill(c, pal.body, () => path(c, [[18, 80], [24, 62], [58, 60], [74, 64], [112, 66], [146, 76], [148, 84], [20, 86]])); // hull
    plain(c, pal.trim, () => path(c, [[30, 74], [112, 72], [140, 78], [30, 80]])); // side stripe
    rrect(c, 128, 79, 28, 7, 3.5, pal.trim); // front wing, tucked against the nose
    wheel(c, 40, 80, 16, pal);
    wheel(c, 124, 83, 12, pal);
  },
  // Mudlark: tall buggy with a roll cage, chunky tyres and a short hood.
  (c, pal, look) => {
    miniHead(c, look, 70, 46, 44);
    // roll cage (bent bar over the driver)
    c.beginPath();
    c.moveTo(46, 66);
    c.lineTo(52, 30);
    c.lineTo(94, 30);
    c.lineTo(104, 66);
    c.lineWidth = 5;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.strokeStyle = pal.trim;
    c.stroke();
    rrect(c, 34, 62, 92, 20, 8, pal.body); // tub
    rrect(c, 108, 58, 40, 18, 7, pal.body); // hood
    plain(c, pal.trim, () => (c.beginPath(), c.roundRect(40, 70, 84, 5, 2.5)));
    circle(c, 144, 66, 3.5, pal.accent); // headlight
    wheel(c, 38, 78, 19, pal, true);
    wheel(c, 120, 78, 19, pal, true);
  },
  // Comet: long smooth bullet with a glass dome and a tail fin.
  (c, pal, look) => {
    tri(c, pal.trim, [14, 80], [6, 46], [40, 66]); // tail fin
    miniHead(c, look, 70, 46, 40);
    fill(c, pal.body, () => {
      c.beginPath();
      c.moveTo(6, 84);
      c.bezierCurveTo(8, 62, 50, 52, 92, 54);
      c.bezierCurveTo(128, 56, 152, 68, 156, 84);
      c.closePath();
    });
    fill(c, 'rgba(190,235,255,0.5)', () => (c.beginPath(), c.ellipse(70, 56, 26, 18, 0, Math.PI, 0)), 2); // glass dome
    plain(c, pal.trim, () => {
      c.beginPath();
      c.moveTo(24, 76);
      c.bezierCurveTo(60, 70, 110, 70, 148, 78);
      c.lineTo(148, 82);
      c.lineTo(24, 82);
      c.closePath();
    });
    wheel(c, 36, 84, 11, pal);
    wheel(c, 124, 84, 11, pal);
  },
  // Splash: round bathtub on wheels with a rim, a little tap at the front.
  (c, pal, look) => {
    miniHead(c, look, 80, 44, 46);
    rrect(c, 14, 56, 132, 28, [6, 6, 26, 26], pal.body); // tub
    plain(c, 'rgba(255,255,255,0.3)', () => (c.beginPath(), c.roundRect(24, 68, 80, 6, 3))); // shine
    rrect(c, 10, 50, 140, 10, 5, pal.trim); // rim
    // tap
    c.beginPath();
    c.moveTo(138, 50);
    c.lineTo(138, 36);
    c.quadraticCurveTo(138, 30, 148, 30);
    c.lineWidth = 4.5;
    c.lineCap = 'round';
    c.strokeStyle = pal.accent;
    c.stroke();
    wheel(c, 38, 84, 12, pal);
    wheel(c, 124, 84, 12, pal);
  },
];

// ---------------------------------------------------------------------------------------------------
// Public drawing functions (with a cache)
// ---------------------------------------------------------------------------------------------------

/** Finished pictures, one small off-screen canvas each. Key = what + size. */
const cache = new Map<string, HTMLCanvasElement>();

function offscreen(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Render a picture once per key and reuse it. */
function cached(key: string, w: number, h: number, render: (c: Ctx, w: number, h: number) => void): HTMLCanvasElement | null {
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size >= 150) cache.clear(); // sizes change with rotation / resize; do not let old ones pile up
  const canvas = offscreen(w, h);
  const c = canvas.getContext('2d');
  if (!c) return null;
  render(c, w, h);
  cache.set(key, canvas);
  return canvas;
}

/** Copy a cached picture onto `target` (same size in the common case; scaled otherwise). */
function blit(target: HTMLCanvasElement, src: HTMLCanvasElement | null): void {
  const c = target.getContext('2d');
  if (!c) return;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, target.width, target.height);
  if (src) c.drawImage(src, 0, 0, target.width, target.height);
}

/** Scale/centre `c` so a `dw x dh` design box fills a `w x h` canvas (aspect kept). */
function enterDesign(c: Ctx, w: number, h: number, dw: number, dh: number): void {
  const f = fitDesign(w, h, dw, dh);
  c.translate(f.x, f.y);
  c.scale(f.scale, f.scale);
}

/**
 * Draw a driver portrait filling the whole canvas (centred, aspect kept). Call again to change the
 * character. For crisp output on phones set canvas.width/height to the displayed size times
 * `devicePixelRatio` first (the picker does).
 */
export function drawPortrait(canvas: HTMLCanvasElement, look: DriverLook): void {
  const { width: w, height: h } = canvas;
  if (w <= 0 || h <= 0) return;
  const key = `head|${look.species}|${look.primary}|${look.secondary}|${w}x${h}`;
  const img = cached(key, w, h, (c) => {
    enterDesign(c, w, h, 100, 100);
    // Soft backdrop disc so the portrait reads on the dark page.
    c.beginPath();
    c.arc(50, 50, 48, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,0.10)';
    c.fill();
    HEADS[look.species](c, look.primary, look.secondary);
  });
  blit(canvas, img);
}

/**
 * Draw a kart body (index into KART_BODIES) side-on in `character`'s paint, with the driver's small head in
 * the seat, filling the canvas (centred, aspect kept).
 */
export function drawKartPicture(canvas: HTMLCanvasElement, kart: number, character: number): void {
  const { width: w, height: h } = canvas;
  if (w <= 0 || h <= 0) return;
  const k = ((Math.trunc(kart) % KARTS.length) + KARTS.length) % KARTS.length;
  const ch = CHARACTERS[((Math.trunc(character) % CHARACTERS.length) + CHARACTERS.length) % CHARACTERS.length];
  const key = `kart|${k}|${ch.id}|${w}x${h}`;
  const img = cached(key, w, h, (c) => {
    enterDesign(c, w, h, KART_DESIGN_W, KART_DESIGN_H);
    // ground shadow
    plain(c, 'rgba(0,0,0,0.28)', () => (c.beginPath(), c.ellipse(80, 97, 68, 4.5, 0, 0, Math.PI * 2)));
    KARTS[k](c, ch.palette, ch.look);
  });
  blit(canvas, img);
}
