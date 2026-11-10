import { describe, expect, it } from 'vitest';
import { COMBO, SIM_DT, SLIPSTREAM } from './config';
import { createKart, type KartState } from './kart';
import { ComboTracker, SlipstreamSystem, applyComboBonus, inWake, type StyleEvent } from './style';

/** A kart at (x, z) facing +Z (heading 0) driving at `speed`. */
function kart(x: number, z: number, speed = 24): KartState {
  const k = createKart(x, z, 0);
  k.speed = speed;
  k.vel.z = speed;
  return k;
}

/** Run the slipstream system for `seconds`, moving both karts forward at their speeds. */
function run(sys: SlipstreamSystem, follower: KartState, leader: KartState, seconds: number): StyleEvent[] {
  const karts = new Map([[0, follower], [1, leader]]);
  const events: StyleEvent[] = [];
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    events.push(...sys.tick(karts));
    follower.pos.z += follower.speed * SIM_DT;
    leader.pos.z += leader.speed * SIM_DT;
  }
  return events;
}

describe('slipstream geometry', () => {
  it('a kart 8 m straight behind another is in its wake', () => {
    expect(inWake(kart(0, 0), kart(0, 8))).toBe(true);
  });
  it('too close, too far, or beside it is not', () => {
    expect(inWake(kart(0, 0), kart(0, SLIPSTREAM.minDist - 1))).toBe(false);
    expect(inWake(kart(0, 0), kart(0, SLIPSTREAM.maxDist + 1))).toBe(false);
    expect(inWake(kart(0, 0), kart(6, 8))).toBe(false);
  });
  it('the leader must point the same way', () => {
    const lead = kart(0, 8);
    lead.heading = Math.PI / 2; // driving across the follower's path
    expect(inWake(kart(0, 0), lead)).toBe(false);
  });
  it('the cone widens with distance', () => {
    // 1.9 m to the side: outside the cone at 4 m, inside at 12 m.
    expect(inWake(kart(0, 0), kart(1.9, 4))).toBe(false);
    expect(inWake(kart(0, 0), kart(1.9, 12))).toBe(true);
  });
});

describe('slipstream charge and boost', () => {
  it('charges while drafting, then fires a boost after about chargeTime seconds', () => {
    const sys = new SlipstreamSystem();
    const follower = kart(0, 0);
    const leader = kart(0, 8);
    const early = run(sys, follower, leader, SLIPSTREAM.chargeTime * 0.5);
    expect(early.some((e) => e.kind === 'slipBoost')).toBe(false);
    const charges = early.filter((e) => e.kind === 'slipCharge') as Extract<StyleEvent, { kind: 'slipCharge' }>[];
    expect(charges.length).toBeGreaterThan(10);
    expect(charges[charges.length - 1].progress).toBeGreaterThan(0.4); // progress climbs towards 1
    expect(follower.boostTime).toBe(0);

    const late = run(sys, follower, leader, SLIPSTREAM.chargeTime * 0.6);
    expect(late.filter((e) => e.kind === 'slipBoost')).toEqual([{ kind: 'slipBoost', slot: 0 }]);
    expect(follower.boostTime).toBeGreaterThan(SLIPSTREAM.boostTime * 0.9);
    expect(leader.boostTime).toBe(0); // only the follower benefits
  });

  it('does not charge when the leader is out of the cone, or the follower is slow', () => {
    const wide = run(new SlipstreamSystem(), kart(0, 0), kart(8, 8), 2);
    expect(wide.some((e) => e.kind === 'slipCharge' || e.kind === 'slipBoost')).toBe(false);
    const slow = run(new SlipstreamSystem(), kart(0, 0, 8), kart(0, 8, 8), 2);
    expect(slow.some((e) => e.kind === 'slipCharge' || e.kind === 'slipBoost')).toBe(false);
  });

  it('leaving the wake drains the charge (and reports progress 0 at the end)', () => {
    const sys = new SlipstreamSystem();
    const follower = kart(0, 0);
    const leader = kart(0, 8);
    run(sys, follower, leader, 1);
    expect(sys.charge.get(0)!).toBeGreaterThan(0.5);
    leader.pos.x = 20; // swerves away
    const ev = run(sys, follower, leader, 1);
    expect(sys.charge.get(0)).toBe(0);
    expect(ev[ev.length - 1]).toEqual({ kind: 'slipCharge', slot: 0, progress: 0 });
    expect(follower.boostTime).toBe(0);
  });

  it('has a cooldown: right after a slingshot the next one needs the cooldown plus a full charge', () => {
    const sys = new SlipstreamSystem();
    const follower = kart(0, 0);
    const leader = kart(0, 8);
    const ev = run(sys, follower, leader, 3.4);
    // With a 1.5 s charge and 1 s cooldown the second boost cannot come before ~4 s.
    expect(ev.filter((e) => e.kind === 'slipBoost').length).toBe(1);
  });
});

describe('style combo', () => {
  it('trick + mini-turbo + slipstream within the window completes a combo; any order', () => {
    const c = new ComboTracker();
    expect(c.note(0, 'trick', 10)).toBe(false);
    expect(c.note(0, 'miniTurbo', 12)).toBe(false);
    expect(c.note(0, 'slipstream', 14)).toBe(true);
    // The memory is cleared: it takes all three again.
    expect(c.note(0, 'slipstream', 15)).toBe(false);
    expect(c.note(0, 'trick', 16)).toBe(false);
    expect(c.note(0, 'miniTurbo', 17)).toBe(true);
  });

  it('moves that are too far apart (or the same move twice) do not count, and slots are independent', () => {
    const c = new ComboTracker();
    c.note(0, 'trick', 0);
    c.note(0, 'miniTurbo', 1);
    expect(c.note(0, 'slipstream', COMBO.window + 2)).toBe(false); // the trick is too old
    c.note(1, 'trick', 0);
    c.note(1, 'trick', 1);
    expect(c.note(1, 'miniTurbo', 2)).toBe(false);
  });

  it('the reward lengthens the running boost', () => {
    const k = kart(0, 0);
    k.boostTime = 0.5;
    applyComboBonus(k);
    expect(k.boostTime).toBeCloseTo(0.5 + COMBO.boostTime, 9);
  });
});
