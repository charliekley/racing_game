import { describe, expect, it } from 'vitest';
import { Buttons, type ControlInput } from '../shared/protocol';
import { KART, SIM_DT } from './config';
import { TestGround, type Ground } from './ground';
import { createKart, forwardOf, stepKart, turnRateFor, updateSpeed } from './kart';
import { FixedStepLoop } from './loop';

const flatRoad: Ground = { sample: () => ({ height: 0, surface: 'road' }) };
const flatGrass: Ground = { sample: () => ({ height: 0, surface: 'offroad' }) };
const gas: ControlInput = { steer: 0, buttons: Buttons.GAS };

function drive(ground: Ground, input: ControlInput, seconds: number, k = createKart(0, 0, 0)) {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) stepKart(k, input, ground, SIM_DT);
  return k;
}

describe('kart speed', () => {
  it('accelerates to top speed on road and holds it', () => {
    const k = drive(flatRoad, gas, 8);
    expect(k.speed).toBeCloseTo(KART.maxSpeed, 1);
    expect(k.pos.z).toBeGreaterThan(50); // heading 0 drives along +z
  });

  it('is slower off-road, and slows down (not stops) when leaving the road', () => {
    const k = drive(flatRoad, gas, 8);
    stepKart(k, gas, flatGrass, SIM_DT);
    expect(k.speed).toBeGreaterThan(KART.maxSpeed * 0.9); // no instant stop
    drive(flatGrass, gas, 3, k);
    expect(k.speed).toBeCloseTo(KART.maxSpeed * KART.offroadSpeedFactor, 1);
  });

  it('brakes, then reverses up to the reverse limit', () => {
    let v = 20;
    const brake: ControlInput = { steer: 0, buttons: Buttons.BRAKE };
    for (let i = 0; i < 600; i++) v = updateSpeed(v, brake, 'road', SIM_DT);
    expect(v).toBeCloseTo(-KART.reverseMaxSpeed);
  });

  it('coasts to a stop without input', () => {
    const k = drive(flatRoad, gas, 3);
    drive(flatRoad, { steer: 0, buttons: 0 }, 10, k);
    expect(k.speed).toBe(0);
  });
});

describe('kart steering', () => {
  it('cannot turn while stopped', () => {
    const k = drive(flatRoad, { steer: 1, buttons: 0 }, 1);
    expect(k.heading).toBe(0);
  });

  it('positive steer turns right (toward -x when facing +z)', () => {
    const k = drive(flatRoad, { steer: 1, buttons: Buttons.GAS }, 1.5);
    expect(k.heading).toBeLessThan(0);
    expect(k.pos.x).toBeLessThan(0);
  });

  it('turns tighter at low speed than at high speed', () => {
    expect(turnRateFor(KART.fullTurnSpeed)).toBeGreaterThan(turnRateFor(KART.maxSpeed));
    expect(turnRateFor(0)).toBe(0);
  });

  it('reversing with right steer turns the nose the other way', () => {
    const k = createKart(0, 0, 0);
    k.speed = -5;
    stepKart(k, { steer: 1, buttons: Buttons.BRAKE }, flatRoad, SIM_DT);
    expect(k.heading).toBeGreaterThan(0);
  });

  it('velocity follows the heading (grip)', () => {
    const k = drive(flatRoad, { steer: 0.6, buttons: Buttons.GAS }, 4);
    const f = forwardOf(k.heading);
    const along = (k.vel.x * f.x + k.vel.z * f.z) / Math.hypot(k.vel.x, k.vel.z);
    expect(along).toBeGreaterThan(0.99);
  });
});

describe('ground', () => {
  it('falls when there is no ground and lands when there is', () => {
    const k = createKart(0, 0, 0);
    k.pos.y = 5;
    k.grounded = false;
    drive(flatRoad, { steer: 0, buttons: 0 }, 2, k);
    expect(k.grounded).toBe(true);
    expect(k.pos.y).toBe(0);
  });

  it('test ground has road on the oval and grass in the middle', () => {
    const g = new TestGround();
    expect(g.sample(38, 0)?.surface).toBe('road');
    expect(g.sample(0, 0)?.surface).toBe('offroad');
    expect(g.sample(0, 98)?.surface).toBe('road'); // top of far curve: 60 + 38
    expect(g.sample(1000, 0)).toBeNull();
  });

  it('is deterministic', () => {
    const input: ControlInput = { steer: 0.37, buttons: Buttons.GAS };
    const a = drive(new TestGround(), input, 5);
    const b = drive(new TestGround(), input, 5);
    expect(a).toEqual(b);
  });
});

describe('FixedStepLoop', () => {
  it('runs exactly 60 steps per simulated second regardless of frame rate', () => {
    let steps = 0;
    const loop = new FixedStepLoop(() => steps++, 1 / 60);
    for (let i = 0; i < 144; i++) loop.advance(1 / 144); // 144 Hz monitor
    expect(steps).toBeGreaterThanOrEqual(59);
    expect(steps).toBeLessThanOrEqual(60);
  });
  it('returns interpolation alpha in [0, 1) and drops huge backlogs', () => {
    let steps = 0;
    const loop = new FixedStepLoop(() => steps++, 1 / 60, 5);
    const alpha = loop.advance(1 / 120);
    expect(alpha).toBeCloseTo(0.5);
    loop.advance(10); // tab was hidden for 10 s
    expect(steps).toBe(5);
    expect(loop.advance(0)).toBeLessThan(1);
  });
});
