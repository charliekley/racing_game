import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STEERING,
  SteeringProcessor,
  rollFromGravity,
  shapeSteer,
  smoothingAlpha,
  uiRotationDeg,
  wrapDeg,
} from './steering';

const G = 9.81;
const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Gravity reading (W3C convention: points "up") for a phone rotated `cwDeg`
 * clockwise from upright portrait, screen vertical, facing the user.
 * `inverted` simulates browsers that report the opposite sign.
 */
function gravityForRoll(cwDeg: number, inverted = false): [number, number] {
  const s = inverted ? -1 : 1;
  return [-G * Math.sin(rad(cwDeg)) * s, G * Math.cos(rad(cwDeg)) * s];
}

/** Feed the same pose for ~1.6 s so smoothing and sign learning settle. */
function settle(p: SteeringProcessor, cwRollDeg: number, screenDeg = 0, inverted = false) {
  const [gx, gy] = gravityForRoll(cwRollDeg, inverted);
  let out = p.update(gx, gy, screenDeg, 16);
  for (let i = 0; i < 100; i++) out = p.update(gx, gy, screenDeg, 16);
  return out;
}

describe('wrapDeg', () => {
  it('wraps into (-180, 180]', () => {
    expect(wrapDeg(0)).toBe(0);
    expect(wrapDeg(190)).toBeCloseTo(-170);
    expect(wrapDeg(-190)).toBeCloseTo(170);
    expect(wrapDeg(540)).toBe(180);
    expect(wrapDeg(-180)).toBe(180);
  });
});

describe('rollFromGravity', () => {
  it('is 0 upright and grows clockwise', () => {
    expect(rollFromGravity(...gravityForRoll(0))).toBeCloseTo(0);
    expect(rollFromGravity(...gravityForRoll(30))).toBeCloseTo(30);
    expect(rollFromGravity(...gravityForRoll(-45))).toBeCloseTo(-45);
    expect(rollFromGravity(...gravityForRoll(90))).toBeCloseTo(90);
  });
});

describe('shapeSteer', () => {
  const s = { ...DEFAULT_STEERING, curve: 0 };
  it('applies deadzone', () => {
    expect(shapeSteer(0, s)).toBe(0);
    expect(shapeSteer(2.9, s)).toBe(0);
    expect(shapeSteer(-2.9, s)).toBe(0);
  });
  it('is continuous at the deadzone edge and reaches full lock at max angle', () => {
    expect(shapeSteer(3.01, s)).toBeLessThan(0.01);
    expect(shapeSteer(45, s)).toBeCloseTo(1);
    expect(shapeSteer(80, s)).toBe(1);
    expect(shapeSteer(-80, s)).toBe(-1);
  });
  it('is odd-symmetric and monotonic', () => {
    let prev = -Infinity;
    for (let a = -60; a <= 60; a += 1) {
      const v = shapeSteer(a, DEFAULT_STEERING);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(shapeSteer(-a, DEFAULT_STEERING)).toBeCloseTo(-v);
      prev = v;
    }
  });
  it('response curve gives finer control near center', () => {
    expect(shapeSteer(15, DEFAULT_STEERING)).toBeLessThan(shapeSteer(15, s));
  });
  it('invert and sensitivity', () => {
    expect(shapeSteer(20, { ...s, invert: true })).toBeCloseTo(-shapeSteer(20, s));
    expect(shapeSteer(20, { ...s, sensitivity: 2 })).toBeCloseTo(Math.min(1, 2 * shapeSteer(20, s)));
  });
});

describe('smoothingAlpha', () => {
  it('is frame-rate independent', () => {
    const a8 = smoothingAlpha(8, 40);
    const a16 = smoothingAlpha(16, 40);
    expect(1 - (1 - a8) * (1 - a8)).toBeCloseTo(a16);
    expect(smoothingAlpha(16, 0)).toBe(1);
  });
});

describe('SteeringProcessor', () => {
  it('portrait-locked, top of phone to the left: level = 0, clockwise = right', () => {
    const p = new SteeringProcessor();
    expect(settle(p, -90).steer).toBeCloseTo(0);
    expect(p.grip).toBe('left');
    expect(settle(p, -90 + 30).steer).toBeGreaterThan(0.3);
    expect(settle(p, -90 - 30).steer).toBeLessThan(-0.3);
  });

  it('portrait-locked, top of phone to the right', () => {
    const p = new SteeringProcessor();
    expect(settle(p, 90).steer).toBeCloseTo(0);
    expect(p.grip).toBe('right');
    expect(settle(p, 90 + 30).steer).toBeGreaterThan(0.3);
    expect(settle(p, 90 - 30).steer).toBeLessThan(-0.3);
  });

  it('screen auto-rotating mid-turn does NOT change steering', () => {
    const p = new SteeringProcessor();
    settle(p, -90, 90); // landscape, level
    const a = settle(p, -90 + 70, 90).steer; // big oversteer, still landscape
    const b = settle(p, -90 + 70, 0).steer; // browser flips page to portrait
    expect(a).toBeCloseTo(1, 5);
    expect(b).toBeCloseTo(1, 5);
  });

  it('oversteering past upright stays at full lock and does not flip grip', () => {
    const p = new SteeringProcessor();
    settle(p, -90);
    expect(settle(p, 0).steer).toBeCloseTo(1, 5); // turned 90 deg clockwise
    expect(settle(p, 20).steer).toBeCloseTo(1, 5); // 110 deg
    expect(p.grip).toBe('left');
  });

  it('flipping the phone fully around switches grip', () => {
    const p = new SteeringProcessor();
    settle(p, -90);
    settle(p, 90);
    expect(p.grip).toBe('right');
    expect(settle(p, 90).steer).toBeCloseTo(0);
  });

  it('steering direction is right even with the wrong sign convention', () => {
    const p = new SteeringProcessor(DEFAULT_STEERING, false);
    expect(settle(p, -90, 0, true).steer).toBeCloseTo(0);
    expect(settle(p, -90 + 30, 0, true).steer).toBeGreaterThan(0.3);
  });

  it('learns an inverted sign convention from an upright portrait pose', () => {
    const p = new SteeringProcessor(DEFAULT_STEERING, false);
    settle(p, 0, 0, true); // holding phone upright to type a name
    expect(p.inverted).toBe(true);
    settle(p, -90, 0, true);
    expect(p.grip).toBe('left');
  });

  it('learns the sign from the browser landscape orientation', () => {
    const p = new SteeringProcessor(DEFAULT_STEERING, true); // wrong guess
    settle(p, -90, 90, false);
    expect(p.inverted).toBe(false);
    expect(p.grip).toBe('left');
  });

  it('calibration makes the current pose center', () => {
    const p = new SteeringProcessor();
    settle(p, -90 + 10);
    p.calibrate();
    expect(settle(p, -90 + 10).steer).toBeCloseTo(0);
    expect(settle(p, -90 + 40).steer).toBeGreaterThan(0.3);
  });

  it('holds the last value when the phone is too flat to read', () => {
    const p = new SteeringProcessor();
    const turned = settle(p, -90 + 30).steer;
    const flat = p.update(0.1, 0.1, 0, 16);
    expect(flat.valid).toBe(false);
    expect(flat.steer).toBeCloseTo(turned, 3);
  });
});

describe('uiRotationDeg', () => {
  it('rotates the UI when the page is portrait-locked', () => {
    expect(uiRotationDeg('left', 0)).toBe(90);
    expect(uiRotationDeg('right', 0)).toBe(-90);
  });
  it('does nothing when the browser already rotated the page', () => {
    expect(uiRotationDeg('left', 90)).toBe(0);
    expect(uiRotationDeg('right', -90)).toBe(0);
    expect(uiRotationDeg(null, 0)).toBe(0);
  });
});
