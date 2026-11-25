import { describe, expect, it } from 'vitest';
import { Buttons } from '../shared/protocol';
import { BACK_SWIPE_PX, isBackSwipe } from './touchButtons';

describe('ITEM swipe down = use backward', () => {
  it('a short drag or a tap is not a swipe', () => {
    expect(isBackSwipe(0, 0)).toBe(false);
    expect(isBackSwipe(2, 10)).toBe(false);
    expect(isBackSwipe(0, BACK_SWIPE_PX - 1)).toBe(false);
  });
  it('a long, mostly vertical drag down is a swipe', () => {
    expect(isBackSwipe(0, BACK_SWIPE_PX)).toBe(true);
    expect(isBackSwipe(10, 60)).toBe(true);
  });
  it('sideways or upward drags are not', () => {
    expect(isBackSwipe(80, 40)).toBe(false);
    expect(isBackSwipe(0, -80)).toBe(false);
  });
  it('BACK is its own bit, distinct from the other buttons (it travels in the 16-bit button mask)', () => {
    const others = Buttons.GAS | Buttons.BRAKE | Buttons.DRIFT | Buttons.ITEM | Buttons.TRICK;
    expect(Buttons.BACK & others).toBe(0);
    expect(Buttons.BACK).toBeLessThanOrEqual(0xffff);
  });
});
