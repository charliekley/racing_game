import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../sim/config';
import { FixedStepLoop } from '../sim/loop';
import { PHOTO_SCALE, PHOTO_SECONDS, PhotoFinishFx, worthSlowMotion } from './photoFinish';

const human = (s: number) => s === 0 || s === 1;

describe('worthSlowMotion', () => {
  const base = { slots: [0, 3] as const, isHuman: human, knockout: false, alreadyPlayed: false };
  it('plays when a human is involved', () => expect(worthSlowMotion(base)).toBe(true));
  it('not for bots only, not in Knockout, not twice', () => {
    expect(worthSlowMotion({ ...base, slots: [2, 3] })).toBe(false);
    expect(worthSlowMotion({ ...base, knockout: true })).toBe(false);
    expect(worthSlowMotion({ ...base, alreadyPlayed: true })).toBe(false);
  });
});

describe('PhotoFinishFx', () => {
  it('is normal speed when idle', () => expect(new PhotoFinishFx().tick(1 / 60)).toBe(1));

  it('runs at 30% speed, eases back, and lasts PHOTO_SECONDS of real time', () => {
    const fx = new PhotoFinishFx();
    fx.start();
    expect(fx.tick(1 / 60)).toBeCloseTo(PHOTO_SCALE);
    let real = 1 / 60;
    let last = 0;
    while (fx.active) {
      last = fx.tick(1 / 60);
      real += 1 / 60;
    }
    expect(real).toBeGreaterThanOrEqual(PHOTO_SECONDS - 0.02);
    expect(real).toBeLessThanOrEqual(PHOTO_SECONDS + 0.04);
    expect(last).toBeGreaterThan(PHOTO_SCALE); // eased back up
    expect(fx.tick(1 / 60)).toBe(1);
  });

  it('can be skipped', () => {
    const fx = new PhotoFinishFx();
    fx.start();
    fx.skip();
    expect(fx.active).toBe(false);
    expect(fx.tick(1 / 60)).toBe(1);
  });

  it('the sim still steps in fixed steps: slow motion only means fewer steps per real second', () => {
    const steps: number[] = [];
    const loop = new FixedStepLoop((dt) => steps.push(dt), SIM_DT);
    const fx = new PhotoFinishFx();
    fx.start();
    let real = 0;
    while (fx.active) {
      loop.advance((1 / 60) * fx.tick(1 / 60));
      real += 1 / 60;
    }
    expect(steps.every((d) => d === SIM_DT)).toBe(true); // every step has exactly the normal size
    expect(steps.length).toBeLessThan(real / SIM_DT); // fewer steps than real time would give
    expect(steps.length).toBeGreaterThan(0.3 * (real / SIM_DT) - 2); // ...but at least the 30% share
  });
});
