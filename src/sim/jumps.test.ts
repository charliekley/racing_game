import { describe, expect, it } from 'vitest';
import { Buttons } from '../shared/protocol';
import { jumpTest } from '../track/tracks/_jumpTest';
import type { TrackDef } from '../track/types';
import { autopilot, botStyleFor } from './autopilot';
import { KART, SIM_DT } from './config';
import { jumpClearance, LANDING_LENGTH, minClearSpeed, shapeHeight } from './jumps';
import { createKart, stepKart } from './kart';
import { Track } from './track';
import { World } from './world';

type RampDef = TrackDef['ramps'][number];

/** The dev track's stadium loop with different ramps (straight A starts at point 0 and runs 400 m). */
function trackWith(ramps: RampDef[]): Track {
  return new Track({ ...jumpTest, ramps, boostPads: [], walls: [] });
}

describe('shape heights', () => {
  const shapes = ['kicker', 'hump', 'double'] as const;

  it('are 0 outside the ramp and at its start', () => {
    for (const shape of shapes) {
      expect(shapeHeight(shape, 2, -0.1)).toBe(0);
      expect(shapeHeight(shape, 2, 1.1)).toBe(0);
      expect(shapeHeight(shape, 2, 0)).toBe(0);
    }
    expect(shapeHeight('hump', 2, 1)).toBeCloseTo(0, 9);
  });

  it('kicker keeps the original behaviour: linear rise to the full height', () => {
    for (const u of [0, 0.1, 0.5, 0.99, 1]) expect(shapeHeight('kicker', 2.2, u)).toBeCloseTo(2.2 * u, 12);
    const track = trackWith([{ at: 1.3, length: 10, height: 2.2 }]); // no shape given = kicker
    const r = track.ramps[0];
    expect(r.shape).toBe('kicker');
    expect(track.rampHeight(r.s0 + 5)).toBeCloseTo(1.1, 9);
    expect(track.rampHeight(r.s1 + 1)).toBe(0);
  });

  it('hump is a smooth mound: peak in the middle, symmetric, small steps between samples', () => {
    expect(shapeHeight('hump', 1.4, 0.5)).toBeCloseTo(1.4, 9);
    for (let u = 0; u <= 0.5; u += 0.05) expect(shapeHeight('hump', 1.4, u)).toBeCloseTo(shapeHeight('hump', 1.4, 1 - u), 9);
    let maxStep = 0;
    for (let u = 0; u < 0.99; u += 0.01) maxStep = Math.max(maxStep, Math.abs(shapeHeight('hump', 1.4, u + 0.01) - shapeHeight('hump', 1.4, u)));
    expect(maxStep).toBeLessThan(0.05);
  });

  it('double has two peaks with a dip between them', () => {
    const h = (u: number) => shapeHeight('double', 1.4, u);
    expect(h(0.49)).toBeGreaterThan(1.3);
    expect(h(0.51)).toBeLessThan(0.1);
    expect(h(1)).toBeGreaterThan(1.3);
    let peaks = 0;
    for (let u = 0.01; u <= 1; u += 0.01) if (h(u) > h(u - 0.01) && h(Math.min(1, u + 0.01)) >= h(u)) peaks++;
    expect(peaks).toBeGreaterThanOrEqual(1);
    // Rising on both halves, dropping once in the middle.
    expect(h(0.25)).toBeLessThan(h(0.49));
    expect(h(0.75)).toBeLessThan(h(1));
    expect(h(0.51)).toBeLessThan(h(0.49));
  });
});

describe('jumpClearance', () => {
  const water = { shape: 'kicker', length: 10, height: 2.2, gap: 12 } as const;

  it('more speed = more distance; matches ballistic maths', () => {
    const a = jumpClearance(water, 10);
    const b = jumpClearance(water, 20);
    const c = jumpClearance(water, 28);
    expect(b.airDistance).toBeGreaterThan(a.airDistance);
    expect(c.airDistance).toBeGreaterThan(b.airDistance);
    // vy = slope * speed; h + vy t - g t^2/2 = 0
    expect(c.launchVy).toBeCloseTo((2.2 / 10) * 28, 9);
    expect(2.2 + c.launchVy * c.airTime - 0.5 * KART.gravity * c.airTime ** 2).toBeCloseTo(0, 6);
  });

  it('a 10 m gap is clearable at 20 m/s but not at 10 m/s', () => {
    const water = { shape: 'kicker', length: 10, height: 2.2, gap: 10 } as const;
    expect(jumpClearance(water, 20).clears).toBe(true);
    expect(jumpClearance(water, 10).clears).toBe(false);
    const min = minClearSpeed(water);
    expect(min).toBeGreaterThan(10);
    expect(min).toBeLessThan(20);
  });

  it('every gapped ramp of the dev track is clearable at normal speed (25 m/s) and not at 10 m/s', () => {
    for (const r of jumpTest.ramps.filter((x) => x.gap)) {
      expect(jumpClearance(r, 25).clears).toBe(true);
      expect(jumpClearance(r, 10).clears).toBe(false);
    }
  });
});

describe('ramp bookkeeping', () => {
  it('ramps get shape, gap and landing apron; landing can be switched off', () => {
    const t = trackWith([
      { at: 1.3, length: 10, height: 2.4, gap: 14, gapKind: 'void' },
      { at: 2.8, length: 24, height: 1.4, shape: 'double' },
      { at: 3.2, length: 10, height: 2, gap: 8, landing: false },
    ]);
    expect(t.ramps[0].landHeight).toBeGreaterThan(0);
    expect(t.ramps[1].landHeight).toBe(0); // no gap = no apron
    expect(t.ramps[2].landHeight).toBe(0);
    // The apron slopes down from the far edge of the gap to the road.
    const g = t.gaps[0];
    expect(t.rampHeight(g.s1 + 0.01)).toBeGreaterThan(0.9 * t.ramps[0].landHeight);
    expect(t.rampHeight(g.s1 + LANDING_LENGTH / 2)).toBeCloseTo(t.ramps[0].landHeight / 2, 1);
    expect(t.rampHeight(g.s1 + LANDING_LENGTH + 0.5)).toBe(0);
    expect(t.rampHeight(g.s0 + 3)).toBe(0); // nothing over the gap itself
  });

  it('a chain of adjacent humps has no seam problems: ~0 at every joint, never negative', () => {
    const t = new Track(jumpTest);
    const humps = t.ramps.filter((r) => r.shape === 'hump');
    expect(humps.length).toBe(5);
    for (let i = 1; i < humps.length; i++) {
      expect(humps[i].s0 - humps[i - 1].s1).toBeCloseTo(0, 6); // exactly adjacent
      expect(t.rampHeight(humps[i].s0)).toBeCloseTo(0, 6);
    }
    for (let s = humps[0].s0 - 5; s < humps[4].s1 + 5; s += 0.5) expect(t.rampHeight(s)).toBeGreaterThanOrEqual(0);
    expect(t.rampHeight(humps[2].s0 + 10)).toBeCloseTo(1.4, 6);
  });

  it('a ramp just behind another ramp gap: the higher surface wins and the gap stays empty', () => {
    const t = trackWith([
      { at: 1.3, length: 10, height: 2, gap: 10, gapKind: 'void' },
      { at: 1.5, length: 12, height: 1, shape: 'hump' }, // starts shortly after the gap ends -> overlaps the apron
    ]);
    const g = t.gaps[0];
    const p = t.samples[Math.floor((g.s0 + 4) / t.spacing)];
    expect(t.sample(p.x, p.z)).toBeNull();
    for (let s = g.s1; s < g.s1 + 20; s += 0.5) expect(t.rampHeight(s)).toBeGreaterThanOrEqual(0);
  });

  it('a ramp across the start line (wrap-around) works', () => {
    const t = trackWith([{ at: 15.8, length: 20, height: 1.4, shape: 'hump' }]);
    const r = t.ramps[0];
    expect(t.rampHeight((r.s0 + 10) % t.length)).toBeCloseTo(1.4, 6);
    expect(t.rampHeight((r.s0 + 25) % t.length)).toBe(0);
    expect(t.rampHeight((r.s0 - 3 + t.length) % t.length)).toBe(0);
  });

  it('item boxes stay clear of every ramp, gap and landing, including chains', () => {
    const t = new Track(jumpTest);
    expect(t.itemBoxes.length).toBeGreaterThan(0);
    for (const b of t.itemBoxes) {
      const s = t.project(b.x, b.z).s;
      for (const r of t.ramps) {
        const inside = t.deltaS(r.s0 - 3, s) >= 0 && t.deltaS(s, r.s1 + r.gap + LANDING_LENGTH + 3) >= 0;
        expect(inside).toBe(false);
      }
    }
  });
});

/** Drive straight at `speed` over one ramp on the stadium straight; report what happened. */
function fly(ramp: RampDef, speed: number) {
  const t = trackWith([ramp]);
  const r = t.ramps[0];
  const start = t.samples[Math.floor((r.s0 - 40) / t.spacing)];
  const k = createKart(start.x, start.z, start.heading, t.sample(start.x, start.z)!.height); // start ON the road surface
  k.speed = speed;
  k.vel.x = Math.sin(start.heading) * speed;
  k.vel.z = Math.cos(start.heading) * speed;
  let airTime = 0;
  let apex = 0;
  let flights = 0;
  let trickable = false;
  let maxLaunchVy = 0;
  let prevGrounded = true;
  let fell = false;
  const end = r.s1 + r.gap + 40;
  for (let i = 0; i < 60 * 20; i++) {
    // Hold the speed: gas when below, coast when above.
    stepKart(k, { steer: 0, buttons: k.speed < speed ? Buttons.GAS : 0 }, t, SIM_DT);
    const p = t.project(k.pos.x, k.pos.z, k.trackIndex);
    if (!k.grounded) {
      airTime += SIM_DT;
      apex = Math.max(apex, k.pos.y - p.y);
    }
    if (prevGrounded && !k.grounded) {
      flights++;
      trickable = trickable || k.trickable;
      maxLaunchVy = Math.max(maxLaunchVy, k.vel.y);
    }
    prevGrounded = k.grounded;
    if (k.pos.y < p.y - 5) fell = true; // the world would send the carrier
    if (fell || t.deltaS(p.s, end) < 0) break;
  }
  return { airTime, apex, flights, trickable, maxLaunchVy, fell, grounded: k.grounded };
}

describe('real physics over each shape', () => {
  const kicker: RampDef = { at: 1.3, length: 10, height: 2.2, shape: 'kicker' };
  const hump: RampDef = { at: 1.3, length: 18, height: 1.4, shape: 'hump' };
  const dbl: RampDef = { at: 1.3, length: 24, height: 1.4, shape: 'double' };

  it('kicker: higher speed = more air and a higher apex; trickable at speed', () => {
    const a = fly(kicker, 10);
    const b = fly(kicker, 20);
    const c = fly(kicker, 28);
    expect(b.airTime).toBeGreaterThan(a.airTime);
    expect(c.airTime).toBeGreaterThan(b.airTime);
    expect(c.apex).toBeGreaterThan(b.apex);
    expect(c.trickable).toBe(true);
    expect(c.airTime).toBeGreaterThan(0.5);
  });

  it('hump: fast karts get airborne with a trick-worthy launch, slow karts just roll over', () => {
    const slow = fly(hump, 10);
    const mid = fly(hump, 20);
    const fast = fly(hump, 28);
    expect(slow.flights).toBe(0);
    expect(mid.flights).toBe(0);
    expect(fast.flights).toBeGreaterThan(0);
    expect(fast.trickable).toBe(true);
    expect(fast.maxLaunchVy).toBeGreaterThan(KART.trickMinLaunchSpeed);
    expect(fast.airTime).toBeGreaterThan(0.2);
    expect(fast.airTime).toBeLessThan(1.2); // a gentle jump, not a ski jump
  });

  it('double kicker: more speed = more air; at speed the kart flies over the dip', () => {
    const a = fly(dbl, 10);
    const b = fly(dbl, 20);
    const c = fly(dbl, 28);
    expect(b.airTime).toBeGreaterThan(a.airTime);
    expect(c.airTime).toBeGreaterThan(b.airTime);
    expect(c.airTime).toBeGreaterThan(0.6);
  });

  it('kicker over a gap: the real flight agrees with jumpClearance (clears at 25, falls at 10)', () => {
    const gapped: RampDef = { at: 1.3, length: 10, height: 2.2, gap: 12, gapKind: 'void' };
    expect(fly(gapped, 25).fell).toBe(false);
    expect(fly(gapped, 10).fell).toBe(true);
    expect(jumpClearance(gapped, 25).clears).toBe(true);
    expect(jumpClearance(gapped, 10).clears).toBe(false);
  });

  it('same for water, and for a double kicker in front of a void gap', () => {
    const water: RampDef = { at: 1.3, length: 10, height: 2.2, gap: 12, gapKind: 'water' };
    expect(fly(water, 25).fell).toBe(false);
    expect(fly(water, 10).fell).toBe(true);
    const dbl2: RampDef = { at: 1.3, length: 24, height: 1.4, gap: 8, gapKind: 'void', shape: 'double' };
    expect(fly(dbl2, 26).fell).toBe(false);
    expect(fly(dbl2, 8).fell).toBe(true);
  });

  it('a gap-free hump has ground everywhere', () => {
    const t = trackWith([hump]);
    const r = t.ramps[0];
    for (let s = r.s0; s <= r.s1; s += 0.7) {
      const p = t.samples[Math.floor(s / t.spacing)];
      expect(t.sample(p.x, p.z)).not.toBeNull();
    }
  });

  it('a chain of humps launches a fast kart repeatedly, and it keeps its speed', () => {
    const t = new Track(jumpTest);
    const humps = t.ramps.filter((r) => r.shape === 'hump');
    const start = t.samples[Math.floor((humps[0].s0 - 40) / t.spacing)];
    const k = createKart(start.x, start.z, start.heading, t.sample(start.x, start.z)!.height);
    k.speed = 28;
    k.vel.x = Math.sin(start.heading) * 28;
    k.vel.z = Math.cos(start.heading) * 28;
    let flights = 0;
    let prev = true;
    for (let i = 0; i < 60 * 6; i++) {
      stepKart(k, { steer: 0, buttons: Buttons.GAS }, t, SIM_DT);
      if (prev && !k.grounded) flights++;
      prev = k.grounded;
      if (t.deltaS(t.project(k.pos.x, k.pos.z, k.trackIndex).s, humps[4].s1 + 5) < 0) break;
    }
    expect(flights).toBeGreaterThanOrEqual(3);
    expect(k.speed).toBeGreaterThan(24);
  });
});

describe('void and water gaps in the world', () => {
  it('a too-slow kart is respawned for every gap kind and ends on the road', () => {
    for (const kind of ['void', 'water'] as const) {
      const t = trackWith([{ at: 1.3, length: 10, height: 2.2, gap: 12, gapKind: kind }]);
      const r = t.ramps[0];
      const world = new World(t, t);
      const p = t.samples[Math.floor((r.s0 + 6) / t.spacing)];
      world.addKart(0, { x: p.x, z: p.z, heading: p.heading });
      world.karts.get(0)!.speed = 6;
      let respawned = false;
      for (let i = 0; i < 60 * 8 && !respawned; i++) respawned = world.tick(() => ({ steer: 0, buttons: Buttons.GAS })).some((e) => e.kind === 'respawn');
      expect(respawned).toBe(true);
      for (let i = 0; i < 60 * 5; i++) world.tick(() => ({ steer: 0, buttons: 0 }));
      const k = world.karts.get(0)!;
      expect(k.grounded).toBe(true);
      expect(Math.abs(t.project(k.pos.x, k.pos.z, k.trackIndex).d)).toBeLessThan(8);
    }
  });

  it('no ground over a void gap, for every shape in front of it', () => {
    for (const shape of ['kicker', 'hump', 'double'] as const) {
      const t = trackWith([{ at: 1.3, length: 20, height: 1.4, gap: 12, gapKind: 'void', shape }]);
      const g = t.gaps[0];
      const p = t.samples[Math.floor((g.s0 + g.s1) / 2 / t.spacing)];
      expect(t.sample(p.x, p.z)).toBeNull();
      const after = t.samples[Math.floor((g.s1 + 3) / t.spacing)];
      expect(t.sample(after.x, after.z)).not.toBeNull();
    }
  });
});

describe('bots on the jump test track', () => {
  it('four bots finish a 2-lap race over every shape, the chain, both gaps and the boost pad', () => {
    const track = new Track(jumpTest);
    const world = new World(track, track);
    world.startRace([0, 1, 2, 3], jumpTest.laps);
    let ticks = 0;
    let respawns = 0;
    let airborne = false;
    while (world.race!.phase !== 'done' && ticks < 60 * 300) {
      for (const e of world.tick((slot) => autopilot(world.karts.get(slot)!, track, botStyleFor(slot)))) if (e.kind === 'respawn') respawns++;
      for (const k of world.karts.values()) if (!k.grounded) airborne = true;
      ticks++;
    }
    expect(world.race!.phase).toBe('done');
    for (const r of world.race!.racers.values()) expect(r.finished).toBe(true);
    expect(airborne).toBe(true);
    expect(respawns).toBeLessThanOrEqual(2); // the odd mishap is fine; they should mostly clear everything
  });
});
