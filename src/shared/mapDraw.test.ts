import { describe, expect, it } from 'vitest';
import { drawMap, drawMapDots, findCrossings, heightColor, isMapData, makeView, mapDataFromOutline, type MapData, type MapRoute } from './mapDraw';

/** A fake 2D context that records every call (name + args) and accepts any property assignment. */
function stubCtx() {
  const calls: { name: string; args: unknown[] }[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const road = (pts: [number, number, number][], extra: Partial<MapRoute> = {}): MapRoute => ({
  kind: 'main',
  surface: 'road',
  width: 12,
  closed: false,
  points: pts.map(([x, y, z]) => ({ x, y, z })),
  ...extra,
});

/** A tiny but complete map: a square loop with one of everything. */
function fullData(): MapData {
  return {
    routes: [
      road([[0, 0, 0], [100, 0, 0], [100, 8, 100], [0, 4, 100]], { closed: true }),
      road([[50, 0, 0], [50, 0, -40], [20, 0, -60]], { kind: 'shortcut', surface: 'dirt' }),
    ],
    bridges: [{ points: [{ x: 100, y: 4, z: 20 }, { x: 100, y: 6, z: 60 }] }],
    cliffs: [{ points: [{ x: 108, z: 10 }, { x: 108, z: 40 }], side: 'right' }],
    cannons: [{ mouth: { x: 0, z: 50 }, landing: { x: 60, z: 90 } }],
    voidGaps: [{ x: 50, z: 100, heading: 1.57, width: 12, length: 10, kind: 'void' }],
    start: { x: 0, z: 0, heading: 0 },
    maxHeight: 8,
  };
}

const SIZE = { w: 300, h: 300 };

describe('drawMap layers', () => {
  it('draws every layer when the data has it, dots last', () => {
    const { ctx } = stubCtx();
    const layers = drawMap(ctx, SIZE, fullData(), [{ x: 10, z: 10, color: '#f00' }]);
    expect(layers).toEqual(['panel', 'outlines', 'roads', 'shortcuts', 'bridges', 'cliffs', 'gaps', 'cannons', 'start', 'dots']);
  });

  it('skips layers whose data is absent', () => {
    const { ctx } = stubCtx();
    const flat = mapDataFromOutline([0, 0, 100, 0, 100, 100, 0, 100], 12);
    const layers = drawMap(ctx, SIZE, flat, []);
    expect(layers).toEqual(['panel', 'outlines', 'roads', 'start', 'dots']);
  });

  it('adds a crossings layer when one road passes over another', () => {
    const { ctx } = stubCtx();
    const data = fullData();
    data.routes = [road([[-50, 0, 0], [50, 0, 0]]), road([[0, 10, -50], [0, 10, 50]])];
    expect(drawMap(ctx, SIZE, data, [])).toContain('crossings');
  });

  it('draws the dots after all other drawing, and the own dot bigger', () => {
    const { ctx, calls } = stubCtx();
    drawMap(ctx, SIZE, fullData(), [
      { x: 10, z: 10, color: '#0f0' },
      { x: 20, z: 10, color: '#f00', own: true },
    ]);
    const arcs = calls.map((c, i) => ({ c, i })).filter((e) => e.c.name === 'arc');
    // Last two arc groups are the dots; own dot (drawn last) has the largest radius.
    const radii = arcs.map((a) => a.c.args[2] as number);
    const lastFill = calls.map((c) => c.name).lastIndexOf('fill');
    expect(calls[lastFill].name).toBe('fill');
    // The final fill belongs to the own dot, and nothing but dot strokes follows it.
    const after = calls.slice(lastFill + 1).map((c) => c.name);
    expect(after.every((n) => n === 'stroke')).toBe(true);
    const ownR = radii[radii.length - 1];
    const otherR = radii[radii.length - 3]; // [other] [own halo] [own]
    expect(ownR).toBeGreaterThan(otherR);
  });

  it('keeps the old orientation: +z up, x mirrored', () => {
    const v = makeView(SIZE, fullData());
    const [x0, y0] = v.toScreen(0, 0);
    const [x1, y1] = v.toScreen(50, 50);
    expect(x1).toBeLessThan(x0); // +x goes left
    expect(y1).toBeLessThan(y0); // +z goes up
  });

  it('drawMapDots alone draws only dots', () => {
    const { ctx, calls } = stubCtx();
    drawMapDots(ctx, SIZE, makeView(SIZE, fullData()), [{ x: 0, z: 0, color: '#fff' }]);
    expect(calls.some((c) => c.name === 'arc')).toBe(true);
    expect(calls.some((c) => c.name === 'fillRect' || c.name === 'clearRect')).toBe(false);
  });
});

describe('height colour', () => {
  it('goes from darker to paler with height, and is calm on flat tracks', () => {
    const lum = (s: string) => s.match(/\d+/g)!.map(Number).reduce((a, b) => a + b, 0);
    expect(lum(heightColor(20, 20))).toBeGreaterThan(lum(heightColor(0, 20)));
    expect(heightColor(0, 0)).toBe(heightColor(0, 1));
  });
});

describe('findCrossings', () => {
  const flat = road([[-50, 0, 0], [50, 0, 0]]);
  const high = road([[0, 10, -50], [0, 10, 50]]);

  it('finds an overpass and says which road is over', () => {
    const [c, ...rest] = findCrossings([flat, high]);
    expect(rest).toHaveLength(0);
    expect(c.x).toBeCloseTo(0);
    expect(c.z).toBeCloseTo(0);
    expect(c.over.route).toBe(1);
    expect(c.under.route).toBe(0);
    expect(c.overY).toBeCloseTo(10);
    expect(c.underY).toBeCloseTo(0);
  });

  it('works whichever order the routes are given in', () => {
    expect(findCrossings([high, flat])[0].over.route).toBe(0);
  });

  it('ignores roads at the same height, and small height differences', () => {
    expect(findCrossings([flat, road([[0, 0, -50], [0, 0, 50]])])).toHaveLength(0);
    expect(findCrossings([flat, road([[0, 4, -50], [0, 4, 50]])])).toHaveLength(0);
    expect(findCrossings([flat, road([[0, 4, -50], [0, 4, 50]])], 3)).toHaveLength(1);
  });

  it('ignores roads that do not touch, and neighbouring segments of one road', () => {
    expect(findCrossings([flat, road([[200, 10, -50], [200, 10, 50]])])).toHaveLength(0);
    expect(findCrossings([road([[0, 0, 0], [10, 20, 0], [20, 0, 0]])])).toHaveLength(0);
  });

  it('finds the self-crossing of a figure 8 once', () => {
    // Closed figure 8 in the x/z plane; the first and the second half pass the middle at heights 0 and 12.
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 40; i++) {
      const a = ((i + 0.5) / 40) * Math.PI * 2; // offset so the crossing falls inside segments, not on a vertex
      pts.push([Math.sin(a) * 100, 6 - Math.cos(a) * 6, Math.sin(2 * a) * 50]);
    }
    const found = findCrossings([road(pts, { closed: true })]);
    expect(found).toHaveLength(1);
    expect(found[0].overY).toBeGreaterThan(found[0].underY);
    expect(Math.hypot(found[0].x, found[0].z)).toBeLessThan(5);
  });
});

describe('isMapData', () => {
  it('accepts good data and rejects junk', () => {
    expect(isMapData(fullData())).toBe(true);
    expect(isMapData(null)).toBe(false);
    expect(isMapData({})).toBe(false);
    expect(isMapData({ ...fullData(), routes: [{ kind: 'main', width: 'x', points: [] }] })).toBe(false);
    expect(isMapData({ ...fullData(), maxHeight: NaN })).toBe(false);
  });
});
