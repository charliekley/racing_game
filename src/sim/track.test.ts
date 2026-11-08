import { describe, expect, it } from 'vitest';
import { TRACKS } from '../track';
import { Buttons } from '../shared/protocol';
import { SIM_DT } from './config';
import { Track } from './track';
import { World } from './world';

describe.each(TRACKS.map((t) => [t.name, t] as const))('track %s', (_name, def) => {
  const track = new Track(def);

  it('has a sensible length and evenly spaced samples', () => {
    expect(track.length).toBeGreaterThan(400);
    for (let i = 1; i < track.samples.length; i++) {
      const a = track.samples[i - 1];
      const b = track.samples[i];
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(track.spacing, 0);
    }
  });

  it('never passes too close to itself (walls/grass of two sections must not overlap)', () => {
    const S = track.samples;
    const n = S.length;
    const minGap = def.width + def.offroadWidth * 2 + 4;
    const skip = Math.ceil((minGap * 2) / track.spacing); // neighbours along the track are fine
    let worst = Infinity;
    for (let i = 0; i < n; i += 2) {
      for (let j = 0; j < n; j += 2) {
        const along = Math.min(Math.abs(i - j), n - Math.abs(i - j));
        if (along <= skip) continue;
        worst = Math.min(worst, Math.hypot(S[i].x - S[j].x, S[i].z - S[j].z));
      }
    }
    expect(worst).toBeGreaterThan(minGap);
  });

  it('has no corner tighter than a kart can take (radius >= 15 m)', () => {
    const maxCurv = Math.max(...track.samples.map((p) => Math.abs(p.curvature)));
    expect(1 / maxCurv).toBeGreaterThan(15);
  });

  it('projects centerline points back onto themselves', () => {
    for (let i = 0; i < track.samples.length; i += 37) {
      const p = track.samples[i];
      const proj = track.project(p.x + p.rx * 3, p.z + p.rz * 3);
      expect(proj.d).toBeCloseTo(3, 1);
      expect(Math.abs(track.deltaS(proj.s, p.s))).toBeLessThan(0.2);
    }
  });

  it('road surface: road in the middle, offroad outside, banking never digs below the base', () => {
    for (let i = 0; i < track.samples.length; i += 13) {
      const p = track.samples[i];
      expect(track.sample(p.x, p.z).surface).not.toBe('offroad');
      const far = def.width / 2 + def.offroadWidth - 0.5;
      expect(track.sample(p.x + p.rx * far, p.z + p.rz * far).surface).toBe('offroad');
      for (const d of [-def.width / 2, 0, def.width / 2]) {
        expect(Track.bankLift(p.bank, def.width / 2, d)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('grid spots are on the road, behind the start line', () => {
    for (let i = 0; i < 4; i++) {
      const g = track.gridSpot(i);
      const proj = track.project(g.x, g.z);
      expect(Math.abs(proj.d)).toBeLessThan(def.width / 2);
      expect(track.deltaS(0, proj.s)).toBeLessThan(0); // just before s = 0
    }
  });

  it('ramps rise to their height', () => {
    for (const r of track.ramps) {
      expect(track.rampHeight(r.s0 + (r.s1 - r.s0) * 0.99)).toBeGreaterThan(r.height * 0.9);
      expect(track.rampHeight(r.s1 + 1)).toBe(0);
    }
  });
});

describe('driving on the real track', () => {
  const track = new Track(TRACKS[0]);

  it('a kart driving straight off the grid crosses the line into lap 1', () => {
    const world = new World(track, track);
    world.startRace([0], 3);
    const gas = { steer: 0, buttons: Buttons.GAS };
    for (let i = 0; i < 60 * 6; i++) world.tick(() => gas);
    expect(world.race!.racers.get(0)!.lap).toBe(1);
    expect(world.karts.get(0)!.speed).toBeGreaterThan(10);
  });

  it('flies off the jump ramp', () => {
    const world = new World(track, track);
    const r = track.ramps[0];
    const k = track.samples[Math.floor((r.s0 - 30) / track.spacing)];
    world.addKart(0, { x: k.x, z: k.z, heading: k.heading });
    world.karts.get(0)!.speed = 28;
    let airborne = 0;
    for (let i = 0; i < 120; i++) {
      world.tick(() => ({ steer: 0, buttons: Buttons.GAS }));
      if (!world.karts.get(0)!.grounded) airborne++;
    }
    expect(airborne * SIM_DT).toBeGreaterThan(0.3);
  });

  it('a full 3-lap race with two autopilot karts finishes with sensible results', () => {
    const world = new World(track, track);
    world.startRace([0, 1], 3);
    /** Steer toward a point ~14 m ahead on the centerline (with a lateral offset per kart). */
    const autopilot = (slot: number) => {
      const k = world.karts.get(slot)!;
      const p = track.project(k.pos.x, k.pos.z, k.trackIndex);
      const ahead = track.samples[(p.i + 7) % track.samples.length];
      const off = slot === 0 ? -2 : 2;
      const tx = ahead.x + ahead.rx * off - k.pos.x;
      const tz = ahead.z + ahead.rz * off - k.pos.z;
      const want = Math.atan2(tx, tz);
      const err = Math.atan2(Math.sin(want - k.heading), Math.cos(want - k.heading));
      // Kart 1 is slower (lifts off sometimes) so the order is predictable.
      const lift = slot === 1 && Math.floor(world.race!.time * 2) % 5 === 0;
      return { steer: Math.max(-1, Math.min(1, -err * 3)), buttons: lift ? 0 : Buttons.GAS };
    };
    let ticks = 0;
    let airborne = false;
    let boosted = false;
    while (world.race!.phase !== 'done' && ticks < 60 * 300) {
      world.tick(autopilot);
      if (!world.karts.get(0)!.grounded) airborne = true;
      if (world.karts.get(0)!.boostTime > 0) boosted = true;
      ticks++;
    }
    const race = world.race!;
    expect(race.phase).toBe('done');
    expect(race.standings()).toEqual([0, 1]);
    const winner = race.racers.get(0)!;
    expect(winner.lapTimes.length).toBe(3);
    // ~1.2 km at up to ~28 m/s: a lap should take roughly 45-90 s.
    for (const t of winner.lapTimes) {
      expect(t).toBeGreaterThan(35);
      expect(t).toBeLessThan(100);
    }
    expect(airborne).toBe(true); // took the jump
    expect(boosted).toBe(true); // hit a boost pad
  });

  it('walls keep karts in', () => {
    const world = new World(track, track);
    // Middle of the first run of wall samples.
    const first = track.samples.findIndex((p) => p.wallLeft || p.wallRight);
    let last = first;
    while (track.samples[last + 1]?.wallLeft || track.samples[last + 1]?.wallRight) last++;
    const p = track.samples[Math.floor((first + last) / 2)];
    const side = p.wallRight ? 1 : -1;
    // Point the kart straight at the wall.
    const heading = Math.atan2(side * p.rx, side * p.rz);
    world.addKart(0, { x: p.x, z: p.z, heading });
    world.karts.get(0)!.speed = 25;
    for (let t = 0; t < 60; t++) world.tick(() => ({ steer: 0, buttons: Buttons.GAS }));
    const k = world.karts.get(0)!;
    const proj = track.project(k.pos.x, k.pos.z);
    expect(Math.abs(proj.d)).toBeLessThanOrEqual(TRACKS[0].width / 2 + TRACKS[0].offroadWidth);
  });
});
