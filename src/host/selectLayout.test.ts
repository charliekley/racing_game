import { describe, expect, it } from 'vitest';
import { LruCache } from '../render/kart/modelCache';
import { CHARACTERS, KART_BODIES, loadoutStats, paletteFor } from '../shared/characters';
import { demoView, DEMO_CYCLE } from '../dev/selectDemo';
import { SelectionHub } from './selectionHub';
import { quadrantLayout, statBars } from './selectLayout';

describe('quadrantLayout', () => {
  it('1 player: the whole screen', () => {
    expect(quadrantLayout(1)).toEqual({ cols: 1, rows: 1, cells: [{ col: 0, row: 0 }], spare: 0 });
  });
  it('2 players: side by side', () => {
    const l = quadrantLayout(2);
    expect([l.cols, l.rows, l.spare]).toEqual([2, 1, 0]);
    expect(l.cells).toEqual([{ col: 0, row: 0 }, { col: 1, row: 0 }]);
  });
  it('3 players: 2x2 with one free cell; 4 players: full', () => {
    const l3 = quadrantLayout(3);
    expect([l3.cols, l3.rows, l3.cells.length, l3.spare]).toEqual([2, 2, 3, 1]);
    const l4 = quadrantLayout(4);
    expect(l4.cells).toEqual([{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 0, row: 1 }, { col: 1, row: 1 }]);
    expect(l4.spare).toBe(0);
  });
  it('clamps odd counts (0, 5, NaN)', () => {
    expect(quadrantLayout(0).cells.length).toBe(1);
    expect(quadrantLayout(9).cells.length).toBe(4);
    expect(quadrantLayout(NaN).cells.length).toBe(1);
  });
  it('never puts two quadrants in the same cell', () => {
    for (let n = 1; n <= 4; n++) {
      const keys = quadrantLayout(n).cells.map((c) => `${c.col},${c.row}`);
      expect(new Set(keys).size).toBe(n);
    }
  });
});

describe('statBars', () => {
  it('shows the character alone when kart = -1', () => {
    for (let c = 0; c < CHARACTERS.length; c++) {
      for (const b of statBars(c, -1)) {
        expect(b.total).toBe(CHARACTERS[c].stats[b.key]);
        expect(b.bonus + b.lost).toBe(0);
      }
    }
  });
  it('matches loadoutStats and marks what the body changes', () => {
    for (let c = 0; c < CHARACTERS.length; c++) {
      for (let k = 0; k < KART_BODIES.length; k++) {
        const total = loadoutStats({ character: c, kart: k });
        for (const b of statBars(c, k)) {
          expect(b.total).toBe(total[b.key]);
          expect(b.total - b.bonus + b.lost).toBe(b.base);
          expect(b.total).toBeGreaterThanOrEqual(1);
          expect(b.total).toBeLessThanOrEqual(5);
        }
      }
    }
    // Mudlark: more off-road, a little less speed.
    const mud = statBars(3, 1);
    expect(mud.find((b) => b.key === 'offroad')!.bonus).toBeGreaterThan(0);
    expect(mud.find((b) => b.key === 'speed')!.lost).toBeGreaterThan(0);
  });
});

/** Minimum colour distance (CIE76 delta E; about 2.3 is just noticeable, 25+ is clearly another colour) between two characters' body paints, and over the whole paint job. */
const MIN_BODY_DE = 28;
const MIN_PAINT_DE = 25;

describe('kart palettes', () => {
  const HEX = /^#[0-9a-f]{6}$/i;
  it('every character has a valid palette and the lookup wraps', () => {
    for (let i = 0; i < CHARACTERS.length; i++) {
      const p = paletteFor(i);
      expect(p).toBe(CHARACTERS[i].palette);
      for (const c of [p.body, p.trim, p.accent, p.wheels]) expect(c).toMatch(HEX);
    }
    expect(paletteFor(CHARACTERS.length)).toBe(paletteFor(0));
    expect(paletteFor(-1)).toBe(paletteFor(CHARACTERS.length - 1));
  });
  it('body paints are all different (so karts are told apart)', () => {
    expect(new Set(CHARACTERS.map((c) => c.palette.body.toLowerCase())).size).toBe(CHARACTERS.length);
    for (const c of CHARACTERS) expect(c.palette.trim.toLowerCase()).not.toBe(c.palette.body.toLowerCase());
  });
  it('every pair of characters has clearly different kart paints (colour distance, CIE76 delta E)', () => {
    const lab = (hex: string): [number, number, number] => {
      const lin = [1, 3, 5].map((i) => {
        const v = parseInt(hex.slice(i, i + 2), 16) / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      const [r, g, b] = lin;
      const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
      const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
      const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
      const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
      return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
    };
    const dE = (a: string, b: string) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
    const bad: string[] = [];
    for (let i = 0; i < CHARACTERS.length; i++)
      for (let j = i + 1; j < CHARACTERS.length; j++) {
        const a = CHARACTERS[i].palette;
        const b = CHARACTERS[j].palette;
        const body = dE(a.body, b.body);
        // The whole paint job: body counts double (it is most of the kart), trim, accent and wheels once.
        const whole = (2 * body + dE(a.trim, b.trim) + dE(a.accent, b.accent) + dE(a.wheels, b.wheels)) / 5;
        if (body < MIN_BODY_DE || whole < MIN_PAINT_DE) bad.push(`${CHARACTERS[i].name} / ${CHARACTERS[j].name}: body dE ${body.toFixed(1)}, paint dE ${whole.toFixed(1)}`);
      }
    expect(bad, bad.join('\n')).toEqual([]);
  });
  it('keeps the older fields where they were', () => {
    expect(CHARACTERS.map((c) => c.id)).toEqual(['pip', 'mochi', 'fizz', 'juno', 'bolt', 'sable', 'bruno', 'rex', 'chip', 'otto', 'rocco', 'mabel']);
  });
});

describe('LruCache', () => {
  it('builds once per key and keeps only `capacity` entries, disposing the oldest', () => {
    const disposed: string[] = [];
    const cache = new LruCache<{ id: string }>(2, (v) => disposed.push(v.id));
    let built = 0;
    const get = (k: string) => cache.get(k, () => ({ id: (built++, k) }));
    const a = get('a');
    expect(get('a')).toBe(a);
    get('b');
    expect(built).toBe(2);
    get('a'); // a is now the newest
    get('c'); // evicts b
    expect(disposed).toEqual(['b']);
    expect(cache.size).toBe(2);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });
  it('clear disposes everything', () => {
    const disposed: string[] = [];
    const cache = new LruCache<string>(3, (v) => disposed.push(v));
    ['x', 'y', 'z'].forEach((k) => cache.get(k, () => k));
    cache.clear();
    expect(disposed.sort()).toEqual(['x', 'y', 'z']);
    expect(cache.size).toBe(0);
  });
  it('survives a capacity of 0', () => {
    const cache = new LruCache<number>(0);
    expect(cache.get('a', () => 1)).toBe(1);
    expect(cache.get('b', () => 2)).toBe(2);
    expect(cache.size).toBe(1);
  });
});

describe('selectdemo script', () => {
  it('walks every stage in order and stays in range', () => {
    const order: string[] = [];
    for (let t = 0; t < DEMO_CYCLE; t += 0.1) {
      const v = demoView(1, t);
      if (order[order.length - 1] !== v.stage) order.push(v.stage);
      expect(v.character).toBeGreaterThanOrEqual(0);
      expect(v.character).toBeLessThan(CHARACTERS.length);
      expect(v.kart).toBeGreaterThanOrEqual(0);
      expect(v.kart).toBeLessThan(KART_BODIES.length);
    }
    expect(order).toEqual(['name', 'character', 'kart', 'ready']);
  });
  it('feeds the hub, which tells subscribers', () => {
    const hub = new SelectionHub();
    const seen: number[] = [];
    hub.subscribe((v) => seen.push(v.length));
    for (let s = 0; s < 4; s++) hub.set(demoView(s, 5));
    expect(seen[seen.length - 1]).toBe(4);
  });
});
