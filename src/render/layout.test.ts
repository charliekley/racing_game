import { describe, expect, it } from 'vitest';
import { splitLayout, toViewport } from './layout';

describe('splitLayout', () => {
  it('1 player = full screen, 2 = top/bottom, 3 = quadrants + minimap, 4 = quadrants', () => {
    expect(splitLayout(1).views).toEqual([{ x: 0, y: 0, w: 1, h: 1 }]);
    const two = splitLayout(2).views;
    expect(two.map((r) => [r.y, r.w, r.h])).toEqual([
      [0, 1, 0.5],
      [0.5, 1, 0.5],
    ]);
    const three = splitLayout(3);
    expect(three.views.length).toBe(3);
    expect(three.minimap).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    expect(splitLayout(4).views.length).toBe(4);
    expect(splitLayout(4).minimap).toBeNull();
  });

  it('views tile the screen without overlap', () => {
    for (let n = 1; n <= 4; n++) {
      const { views, minimap } = splitLayout(n);
      const area = [...views, ...(minimap ? [minimap] : [])].reduce((a, r) => a + r.w * r.h, 0);
      expect(area).toBeCloseTo(1);
    }
  });
});

describe('toViewport', () => {
  it('flips y for WebGL and covers every pixel exactly once', () => {
    const W = 1921;
    const H = 1081; // odd sizes on purpose
    const vps = splitLayout(4).views.map((r) => toViewport(r, W, H));
    // Top-left quadrant in CSS = top half in WebGL = larger y.
    expect(vps[0].x).toBe(0);
    expect(vps[0].y + vps[0].h).toBe(H);
    expect(vps[2].y).toBe(0);
    expect(vps[0].w + vps[1].w).toBe(W);
    expect(vps[0].h + vps[2].h).toBe(H);
  });
});
