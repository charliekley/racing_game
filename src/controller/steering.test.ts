import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STEERING,
  SteeringProcessor,
  rollFromGravity,
  shapeSteer,
  smoothingAlpha,
  wheelAngle,
  wrapDeg,
} from './steering';

const G = 9.81;
const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Gravity reading (W3C convention: points "up") for a phone rotated `cwDeg`
 * clockwise from upright portrait, screen vertical, facing the user.
 */
function gravityForRoll(cwDeg: number): [number, number] {
  return [-G * Math.sin(rad(cwDeg)), G * Math.cos(rad(cwDeg))];
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

describe('wheelAngle (landscape handling)', () => {
  // window.orientation = 90: phone rotated 90 deg counter-clockwise (roll -90).
  it('landscape with orientation 90: level = 0, clockwise tilt = right', () => {
    expect(wheelAngle(-90, 90)).toBeCloseTo(0);
    expect(wheelAngle(-90 + 20, 90)).toBeCloseTo(20);
    expect(wheelAngle(-90 - 20, 90)).toBeCloseTo(-20);
  });
  // window.orientation = -90: phone rotated 90 deg clockwise (roll +90).
  it('landscape with orientation -90: level = 0, clockwise tilt = right', () => {
    expect(wheelAngle(90, -90)).toBeCloseTo(0);
    expect(wheelAngle(90 + 20, -90)).toBeCloseTo(20);
    expect(wheelAngle(90 - 20, -90)).toBeCloseTo(-20);
  });
  it('flipped sign convention adds 180', () => {
    expect(wheelAngle(90, 90, true)).toBeCloseTo(0);
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
    const curved = shapeSteer(15, DEFAULT_STEERING);
    const linear = shapeSteer(15, s);
    expect(curved).toBeLessThan(linear);
  });
  it('invert and sensitivity', () => {
    expect(shapeSteer(20, { ...s, invert: true })).toBeCloseTo(-shapeSteer(20, s));
    expect(shapeSteer(20, { ...s, sensitivity: 2 })).toBeCloseTo(Math.min(1, 2 * shapeSteer(20, s)));
  });
});

describe('smoothingAlpha', () => {
  it('is frame-rate independent', () => {
    // Two 8 ms steps should equal one 16 ms step.
    const a8 = smoothingAlpha(8, 40);
    const a16 = smoothingAlpha(16, 40);
    expect(1 - (1 - a8) * (1 - a8)).toBeCloseTo(a16);
    expect(smoothingAlpha(16, 0)).toBe(1);
  });
});

describe('SteeringProcessor', () => {
  /** Run the processor long enough for the smoothing to settle. */
  function settle(p: SteeringProcessor, cwRollDeg: number, orientation: number, flipSign = false) {
    let [gx, gy] = gravityForRoll(cwRollDeg);
    if (flipSign) [gx, gy] = [-gx, -gy];
    let out = p.update(gx, gy, orientation, 16);
    for (let i = 0; i < 100; i++) out = p.update(gx, gy, orientation, 16);
    return out;
  }

  it('steers right when the wheel is turned clockwise (landscape, orientation 90)', () => {
    const p = new SteeringProcessor();
    expect(settle(p, -90, 90).steer).toBeCloseTo(0);
    expect(settle(p, -90 + 30, 90).steer).toBeGreaterThan(0.3);
    expect(settle(p, -90 - 30, 90).steer).toBeLessThan(-0.3);
  });

  it('steers right when turned clockwise in the other landscape (orientation -90)', () => {
    const p = new SteeringProcessor();
    expect(settle(p, 90 + 30, -90).steer).toBeGreaterThan(0.3);
  });

  it('auto-detects an inverted gravity sign convention (some iOS versions)', () => {
    const p = new SteeringProcessor();
    expect(settle(p, -90, 90, true).steer).toBeCloseTo(0);
    expect(settle(p, -90 + 30, 90, true).steer).toBeGreaterThan(0.3);
  });

  it('calibration makes the current pose center', () => {
    const p = new SteeringProcessor();
    settle(p, -90 + 10, 90); // user holds the wheel slightly tilted
    p.calibrate();
    expect(settle(p, -90 + 10, 90).steer).toBeCloseTo(0);
    expect(settle(p, -90 + 40, 90).steer).toBeGreaterThan(0.3);
  });

  it('holds the last value when the phone is too flat to read', () => {
    const p = new SteeringProcessor();
    const turned = settle(p, -90 + 30, 90).steer;
    const flat = p.update(0.1, 0.1, 90, 16); // gravity almost all along z
    expect(flat.valid).toBe(false);
    expect(flat.steer).toBeCloseTo(turned, 3);
  });
});
