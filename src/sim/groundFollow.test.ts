/**
 * Regression tests for ground following on steep roads (Autumn Speedway: ~22 % spiral climb, ~34 % plunge).
 *
 * 1. Smooth climbs. The road is a chain of 2 m straight segments. Projecting a kart onto the nearest segment gave a
 *    road height that stepped at every joint (see mitreSegment in shortcuts.ts); each step looked like a crest to the
 *    kart, which kept leaving the ground ("driving up stairs"). Measured before the fix on the spiral: airborne
 *    80 % of the time, rms vertical acceleration 88 m/s^2.
 * 2. Drift hop on a descent. vel.y while grounded is the slope's vertical speed (slope x speed). A hop that sets
 *    vel.y = +4.2 on a 34 % descent starts 13 m/s above the falling road, so the kart flies. The hop is now added
 *    to the slope's vertical speed, so it looks the same on flat ground, uphill and downhill.
 */
import { describe, expect, it } from 'vitest';
import { Buttons } from '../shared/protocol';
import { at, autumnSpeedway } from '../track/tracks/autumnSpeedway';
import { autopilot, botStyleFor } from './autopilot';
import { SIM_DT } from './config';
import { TestGround, type Ground } from './ground';
import { createKart, stepKart, type KartState } from './kart';
import { Track } from './track';

const track = new Track(autumnSpeedway);

describe('climbing the spiral', () => {
  it('stays on the ground and has a smooth vertical motion (no stairs)', () => {
    const s0 = track.sAt(at('spiral'));
    const s1 = track.sAt(at('spiralTop'));
    const p = track.pointAt(s0 - 30);
    const k = createKart(p.x, p.z, p.heading, p.y);
    const style = botStyleFor(0);
    let prevVy = 0;
    let n = 0;
    let airTicks = 0;
    let sumA2 = 0;
    for (let t = 0; t < 4000; t++) {
      stepKart(k, autopilot(k, track, style), track, SIM_DT);
      const s = track.project(k.pos.x, k.pos.z, k.trackIndex).s;
      if (track.deltaS(s1 - 30, s) > 0) break; // stop before the crest at the top (a real crest may launch)
      const a = (k.vel.y - prevVy) / SIM_DT;
      prevVy = k.vel.y;
      if (track.deltaS(s0 + 25, s) < 0) continue; // skip the foot of the ramp: the grade really does change there
      n++;
      sumA2 += a * a;
      if (!k.grounded) airTicks++;
    }
    expect(n).toBeGreaterThan(300);
    expect(airTicks).toBe(0);
    expect(Math.sqrt(sumA2 / n)).toBeLessThan(6); // m/s^2 (before the fix: ~88)
  });

  it('road height has no steps along the spiral centerline', () => {
    // Walk along the spiral in 5 cm steps: the height may only change by grade x step.
    // Walk in 5 cm steps along the straight line between consecutive centerline samples (pointAt snaps to samples).
    const S = track.samples;
    const i0 = Math.round((track.sAt(at('spiral')) + 10) / track.spacing);
    let prev = NaN;
    let maxStep = 0;
    for (let i = i0; i < i0 + 60; i++) {
      const a = S[i % S.length];
      const b = S[(i + 1) % S.length];
      for (let u = 0; u < 1; u += 0.025) {
        const h = track.sample(a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u, i % S.length)!.height;
        if (!Number.isNaN(prev)) maxStep = Math.max(maxStep, Math.abs(h - prev));
        prev = h;
      }
    }
    expect(maxStep).toBeLessThan(0.05 * 0.3); // 30 % grade at 5 cm steps = 0.015 m
  });
});

/** Press DRIFT once while driving straight; returns the highest point above the road and the airtime in ticks. */
function hopStats(ground: Ground, k: KartState) {
  let maxHeight = 0;
  let airTicks = 0;
  stepKart(k, { steer: 0, buttons: Buttons.GAS | Buttons.DRIFT }, ground, SIM_DT);
  for (let t = 0; t < 120 && !k.grounded; t++) {
    airTicks++;
    maxHeight = Math.max(maxHeight, k.pos.y - ground.sample(k.pos.x, k.pos.z, k.trackIndex)!.height);
    stepKart(k, { steer: 0, buttons: Buttons.GAS }, ground, SIM_DT);
  }
  return { maxHeight, airTicks };
}

describe('drift hop on a steep descent', () => {
  it('rises and lands as on flat ground (does not launch the kart)', () => {
    const flat = createKart(38, -40, 0, 0);
    flat.speed = 24;
    for (let i = 0; i < 5; i++) stepKart(flat, { steer: 0, buttons: Buttons.GAS }, new TestGround(), SIM_DT);
    const f = hopStats(new TestGround(), flat);
    expect(f.airTicks).toBeGreaterThan(10);

    // Steepest point of the plunge.
    const sa = track.sAt(at('plungeTop'));
    const sb = track.sAt(at('plungeEnd'));
    let worst = sa;
    let steepest = 0;
    for (let s = sa + 40; s < sb - 5; s += 2) {
      if (track.ramps.some((r) => s > r.s0 - 40 && s < r.s1 + 20)) continue; // keep clear of the real ramps
      const g = (track.pointAt(s).y - track.pointAt(s + 2).y) / 2;
      if (g > steepest) [steepest, worst] = [g, s];
    }
    expect(steepest).toBeGreaterThan(0.3);

    const p = track.pointAt(worst - 12);
    const k = createKart(p.x, p.z, p.heading, track.sample(p.x, p.z, p.index)!.height);
    k.speed = 24;
    k.trackIndex = p.index;
    for (let i = 0; i < 20; i++) stepKart(k, { steer: 0, buttons: Buttons.GAS }, track, SIM_DT);
    expect(k.grounded).toBe(true);
    const d = hopStats(track, k);
    expect(d.maxHeight).toBeLessThan(f.maxHeight * 1.5);
    expect(d.airTicks).toBeLessThan(f.airTicks * 1.5);
  });
});
