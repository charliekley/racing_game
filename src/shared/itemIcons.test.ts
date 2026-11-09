import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from '../sim/items/types';
import { ITEM_ICONS, paintItemIcon, paintRoulette } from './itemIcons';

/** Node has no canvas: a Proxy that accepts any call/property and records method names. */
function stubContext(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const target = function () {};
  const ctx: unknown = new Proxy(target, {
    get: (_t, prop) => {
      if (typeof prop === 'string') calls.push(prop);
      return ctx;
    },
    set: () => true,
    apply: () => ctx,
  });
  return { ctx: ctx as CanvasRenderingContext2D, calls };
}

describe('item icons', () => {
  it('has a painter for every item id', () => {
    for (const id of ITEM_IDS) expect(typeof ITEM_ICONS[id]).toBe('function');
  });

  it('paints every icon, unknown ids and the roulette without throwing', () => {
    for (const id of [...ITEM_IDS, 'bogus']) {
      const { ctx, calls } = stubContext();
      paintItemIcon(ctx, id, 100, 1234);
      expect(calls.length).toBeGreaterThan(0);
    }
    const { ctx, calls } = stubContext();
    paintRoulette(ctx, 100, 500);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('draws a count badge only when count > 1', () => {
    const one = stubContext();
    paintItemIcon(one.ctx, 'dash', 100, 0, 1);
    const three = stubContext();
    paintItemIcon(three.ctx, 'dash', 100, 0, 3);
    expect(one.calls).not.toContain('fillText');
    expect(three.calls).toContain('fillText');
  });
});
