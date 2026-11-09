import { describe, expect, it } from 'vitest';
import { TRACKS } from '../track';
import { Buttons } from '../shared/protocol';
import { SIM_DT } from './config';
import { Track } from './track';
import { autopilot, botStyleFor } from './autopilot';
import { World } from './world';
import { terrainTest } from '../track/tracks/_terrainTest';
import type { TrackDef } from '../track/types';

/** Where the road crosses over itself, the two levels must differ by at least this much (m). */
const OVERPASS_CLEARANCE = 7;

describe.each(TRACKS.map((t) => [t.name, t] as const))('track %s', (_name, def) => {
  const track = new Track(def);

  /**
   * True where a plain (hint-less) projection is ambiguous: another part of the road crosses
   * at a different level (overpass), or a shortcut branch runs alongside (near its junctions).
   * Those spots are covered by the overpass/shortcut tests; the generic checks skip them.
   */
  const ambiguousSpot = (i: number): boolean => {
    const p = track.samples[i];
    const n = track.samples.length;
    for (let j = 0; j < n; j += 2) {
      const along = Math.min(Math.abs(i - j), n - Math.abs(i - j));
      if (along < 40) continue; // our own neighbours
      if (Math.hypot(track.samples[j].x - p.x, track.samples[j].z - p.z) < 30) return true;
    }
    return track.branches.some((b) => b.samples.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 30));
  };

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
        // Overpass: two road parts may be close in plan view if one is well above the other.
        if (Math.abs(S[i].y - S[j].y) >= OVERPASS_CLEARANCE) continue;
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
      if (ambiguousSpot(i)) continue;
      const p = track.samples[i];
      const proj = track.project(p.x + p.rx * 3, p.z + p.rz * 3);
      expect(proj.d).toBeCloseTo(3, 1);
      expect(Math.abs(track.deltaS(proj.s, p.s))).toBeLessThan(0.2);
    }
  });

  it('road surface: road in the middle, offroad outside, banking never digs below the base', () => {
    for (let i = 0; i < track.samples.length; i += 13) {
      const p = track.samples[i];
      if (track.inGap(p.s)) {
        expect(track.sample(p.x, p.z)).toBeNull(); // water
        continue;
      }
      if (ambiguousSpot(i)) continue;
      expect(track.sample(p.x, p.z)!.surface).not.toBe('offroad');
      const far = def.width / 2 + def.offroadWidth - 0.5;
      expect(track.sample(p.x + p.rx * far, p.z + p.rz * far)!.surface).toBe('offroad');
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
      // Kickers peak at their end; humps and doubles peak inside: look for the highest point.
      let peak = 0;
      for (let s = r.s0; s <= r.s1; s += 0.5) peak = Math.max(peak, track.rampHeight(s));
      expect(peak).toBeGreaterThan(r.height * 0.9);
      // Right after the ramp it is flat road, unless a landing apron or a neighbouring ramp starts there.
      const touching = track.ramps.some((o) => o !== r && o.s0 <= r.s1 + 1 && o.s1 > r.s1 + 1);
      if (!touching && !r.gap) expect(track.rampHeight(r.s1 + 1)).toBe(0);
    }
  });

  it('four bots (the real bot driver) all finish a race', () => {
    const world = new World(track, track);
    world.startRace([0, 1, 2, 3], def.laps);
    let ticks = 0;
    let jumped = false;
    let boosted = false;
    while (world.race!.phase !== 'done' && ticks < 60 * 400) {
      world.tick((slot) => autopilot(world.karts.get(slot)!, track, botStyleFor(slot)));
      for (const k of world.karts.values()) {
        if (!k.grounded) jumped = true;
        if (k.boostTime > 0) boosted = true;
      }
      ticks++;
    }
    expect(world.race!.phase).toBe('done');
    for (const r of world.race!.racers.values()) expect(r.finished).toBe(true);
    if (track.ramps.length) expect(jumped).toBe(true);
    if (track.boostPads.length) expect(boosted).toBe(true);
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

// ---------------------------------------------------------------------------
// Track format v2: terrain, bridges, cliffs, void gaps, falling rule.
// The dev-only "Terrain Test" track (not in TRACKS) has one of each.
// ---------------------------------------------------------------------------
describe('terrain, bridges, cliffs and voids (Terrain Test track)', () => {
  const def = terrainTest;
  const track = new Track(def);
  const hw = def.width / 2;
  const sampleAtS = (s: number) => track.samples[Math.floor(s / track.spacing) % track.samples.length];
  const mid = (a: { s0: number; s1: number }) => (a.s0 + a.s1) / 2;

  it('terrain follows the road level at the centerline and the off-road strip', () => {
    for (let i = 0; i < track.samples.length; i += 17) {
      const p = track.samples[i];
      if (track.onBridge(p.s) || track.inGap(p.s)) continue;
      expect(track.terrain.height(p.x, p.z)).toBeCloseTo(p.y, 0);
      const out = hw + def.offroadWidth + 1; // just beyond the strip, inside the skirt
      expect(track.terrain.height(p.x + p.rx * out, p.z + p.rz * out)).toBeCloseTo(p.y, 0);
    }
  });

  it('terrain blends from road level to natural hills, smoothly', () => {
    const p = sampleAtS(300);
    let prevW = 1;
    for (let d = 0; d <= 60; d += 1) {
      const w = track.terrain.roadWeight(d);
      expect(w).toBeLessThanOrEqual(prevW + 1e-9); // the road's weight only ever decreases with distance
      prevW = w;
    }
    expect(track.terrain.roadWeight(hw + def.offroadWidth)).toBe(1);
    expect(track.terrain.roadWeight(hw + def.offroadWidth + 2 + 16)).toBe(0);
    // Far away the height is the natural terrain, with no road influence.
    const x = p.x + p.rx * 90;
    const z = p.z + p.rz * 90;
    expect(track.terrain.height(x, z)).toBeCloseTo(track.terrain.natural(x, z), 6);
    // No big jumps between neighbouring points on the way out.
    let last = track.terrain.height(p.x, p.z);
    for (let d = 0.5; d <= 40; d += 0.5) {
      const h = track.terrain.height(p.x + p.rx * d, p.z + p.rz * d);
      expect(Math.abs(h - last)).toBeLessThan(3);
      last = h;
    }
  });

  it('tracks without a terrain def keep the old flat behaviour', () => {
    const flat = new Track(TRACKS[0]);
    expect(flat.terrain.enabled).toBe(false);
    const p = flat.samples[40];
    const hit = flat.sample(p.x + p.rx * 40, p.z + p.rz * 40)!;
    expect(hit.height).toBeCloseTo(p.y, 6);
  });

  it('under a bridge the ground is NOT blended to the deck (it is natural terrain or the road below)', () => {
    // A bridge over open ground: Meadow Ring's start straight with hills and a bridge on it.
    const bridged = new Track({
      ...TRACKS[0],
      terrain: { seed: 5, hills: { amplitude: 6, wavelength: 120 } },
      bridges: [{ from: 0.15, to: 0.85 }],
    });
    const b = bridged.bridges[0];
    const p = bridged.samples[Math.floor(((b.s0 + b.s1) / 2) / bridged.spacing)];
    const i = bridged.project(p.x, p.z).i;
    const side = hw + 4; // beside the deck, past the curbs: no off-road strip on a bridge
    const x = p.x + p.rx * side;
    const z = p.z + p.rz * side;
    expect(bridged.terrain.height(x, z)).toBeCloseTo(bridged.terrain.natural(x, z), 6);
    const hit = bridged.sample(x, z, i)!;
    expect(hit.surface).toBe('offroad');
    expect(hit.height).toBeCloseTo(bridged.terrain.natural(x, z), 6);
    // The deck itself is still road at its (elevated) height; only the bridge ends blend into the road level.
    expect(bridged.sample(p.x, p.z, i)!.surface).not.toBe('offroad');
    // Beyond the bridge, next to normal road, the ground follows the road again.
    const off = bridged.samples[Math.floor((b.s1 + 60) / bridged.spacing)];
    expect(bridged.terrain.height(off.x, off.z)).toBeCloseTo(off.y, 0); // (banking lifts the centerline a little)
  });

  it('the Terrain Test bridge deck is high above the road and ground under it', () => {
    const p = sampleAtS(mid(track.bridges[0]));
    expect(p.y).toBeGreaterThan(10);
    expect(track.terrain.height(p.x, p.z)).toBeLessThan(p.y - 7);
  });

  it('cliff: no ground beyond the edge, only inside the cliff range and on its side', () => {
    const c = track.cliffs[0];
    expect(c.side).toBe('left');
    const p = sampleAtS(mid(c));
    const i = track.project(p.x, p.z).i;
    const at = (d: number) => track.sample(p.x + p.rx * d, p.z + p.rz * d, i);
    expect(at(0)).not.toBeNull();
    expect(at(-(c.edge - 0.5))).not.toBeNull(); // inside the edge
    expect(at(-(c.edge + 0.5))).toBeNull(); // beyond the edge on the left: falls
    expect(at(c.edge + 0.5)).not.toBeNull(); // the right side is unaffected
    // Outside the cliff range the off-road strip is intact.
    const out = sampleAtS(c.s1 + 30);
    const far = hw + def.offroadWidth - 0.5;
    expect(track.sample(out.x - out.rx * far, out.z - out.rz * far)).not.toBeNull();
    // At the very start of the range the edge has widened out (taper); inside it is the set edge.
    expect(track.cliffEdgeAt(c.s0 + 0.5, -1)).toBeGreaterThan(c.edge + 3);
    expect(track.cliffEdgeAt(mid(c), -1)).toBeCloseTo(c.edge, 6);
    expect(track.cliffEdgeAt(c.s1 + 20, -1)).toBe(Infinity);
  });

  it('void gap: no ground over the chasm, ground before and after it', () => {
    const g = track.gaps.find((x) => x.kind === 'void')!;
    expect(g).toBeDefined();
    const over = sampleAtS(mid(g));
    expect(track.sample(over.x, over.z)).toBeNull();
    const before = sampleAtS(g.s0 - 6);
    const after = sampleAtS(g.s1 + 6);
    expect(track.sample(before.x, before.z)).not.toBeNull();
    expect(track.sample(after.x, after.z)).not.toBeNull();
    expect(track.isVoid(track.project(over.x, over.z))).toBe(true);
    expect(track.isVoid(track.project(before.x, before.z))).toBe(false);
  });

  /** Tick a world for up to `seconds`, stopping at the first respawn; returns true if one happened. */
  function run(world: World, seconds: number, input: () => { steer: number; buttons: number }): boolean {
    for (let i = 0; i < seconds * 60; i++) {
      if (world.tick(input).some((e) => e.kind === 'respawn')) return true;
    }
    return false;
  }

  it('a kart driven off the cliff falls, is respawned and ends up back on the road', () => {
    const c = track.cliffs[0];
    const p = sampleAtS(mid(c));
    const world = new World(track, track);
    // Face the cliff edge (left of travel) and drive straight at it.
    world.addKart(0, { x: p.x, z: p.z, heading: Math.atan2(-p.rx, -p.rz) });
    world.karts.get(0)!.speed = 22;
    expect(run(world, 5, () => ({ steer: 0, buttons: Buttons.GAS }))).toBe(true);
    run(world, 4, () => ({ steer: 0, buttons: 0 }));
    const k = world.karts.get(0)!;
    expect(k.grounded).toBe(true);
    const proj = track.project(k.pos.x, k.pos.z, k.trackIndex);
    expect(Math.abs(proj.d)).toBeLessThan(hw + 1);
    expect(Math.abs(k.pos.y - proj.y)).toBeLessThan(2);
    expect(proj.y).toBeGreaterThan(5); // the ridge road is elevated: the carrier used the real road height
  });

  it('a kart that is too slow for the void jump falls in and is respawned on the road', () => {
    const g = track.gaps.find((x) => x.kind === 'void')!;
    const p = sampleAtS(g.s0 - 3); // on the ramp, almost at the lip
    const world = new World(track, track);
    world.addKart(0, { x: p.x, z: p.z, heading: p.heading });
    world.karts.get(0)!.speed = 5;
    // Far too slow to clear a 12 m chasm.
    expect(run(world, 8, () => ({ steer: 0, buttons: Buttons.GAS }))).toBe(true);
    run(world, 4, () => ({ steer: 0, buttons: 0 }));
    const k = world.karts.get(0)!;
    expect(k.grounded).toBe(true);
    expect(Math.abs(track.project(k.pos.x, k.pos.z, k.trackIndex).d)).toBeLessThan(hw + 1);
  });

  it('a kart driven off the bridge falls to the terrain below and is respawned', () => {
    const p = sampleAtS(mid(track.bridges[0]));
    const world = new World(track, track);
    world.addKart(0, { x: p.x, z: p.z, heading: Math.atan2(p.rx, p.rz) }); // toward the right edge
    world.karts.get(0)!.speed = 20;
    expect(run(world, 8, () => ({ steer: 0, buttons: Buttons.GAS }))).toBe(true);
  });

  it('a bot on the elevated road (climb + bridge) does not respawn by mistake', () => {
    const world = new World(track, track);
    world.startRace([0], 1);
    let respawns = 0;
    let maxY = 0;
    for (let i = 0; i < 60 * 200 && world.race!.phase !== 'done'; i++) {
      for (const e of world.tick((slot) => autopilot(world.karts.get(slot)!, track, botStyleFor(slot)))) {
        if (e.kind === 'respawn') respawns++;
      }
      maxY = Math.max(maxY, world.karts.get(0)!.pos.y);
    }
    expect(respawns).toBe(0);
    expect(maxY).toBeGreaterThan(20); // it really climbed the mountain
    expect(world.race!.phase).toBe('done');
  });

  it('four bots finish a race on it', () => {
    const world = new World(track, track);
    world.startRace([0, 1, 2, 3], def.laps);
    let ticks = 0;
    while (world.race!.phase !== 'done' && ticks < 60 * 400) {
      world.tick((slot) => autopilot(world.karts.get(slot)!, track, botStyleFor(slot)));
      ticks++;
    }
    expect(world.race!.phase).toBe('done');
    for (const r of world.race!.racers.values()) expect(r.finished).toBe(true);
  });
});

describe('overpass rule', () => {
  it('a flat self-crossing (no height difference) is caught by the closeness check', () => {
    const flat: TrackDef = {
      ...terrainTest,
      points: terrainTest.points.map((p) => [p[0], p[1], 0] as [number, number, number]),
      terrain: undefined,
      bridges: [],
      cliffs: [],
      ramps: [],
      boostPads: [],
      walls: [],
    };
    const S = new Track(flat).samples;
    let near = false;
    for (let i = 0; i < S.length && !near; i += 2) {
      for (let j = i + 60; j < S.length - 60 && !near; j += 2) {
        if (Math.hypot(S[i].x - S[j].x, S[i].z - S[j].z) < 10 && Math.abs(S[i].y - S[j].y) < OVERPASS_CLEARANCE) near = true;
      }
    }
    expect(near).toBe(true);
  });

  it('the Terrain Test bridge clears the road beneath it by at least 7 m', () => {
    const S = new Track(terrainTest).samples;
    let closest = Infinity;
    let dy = 0;
    for (let i = 0; i < S.length; i += 2) {
      for (let j = i + 40; j < S.length - 40; j += 2) {
        const d = Math.hypot(S[i].x - S[j].x, S[i].z - S[j].z);
        if (d < closest) {
          closest = d;
          dy = Math.abs(S[i].y - S[j].y);
        }
      }
    }
    expect(closest).toBeLessThan(5); // they really do cross
    expect(dy).toBeGreaterThanOrEqual(OVERPASS_CLEARANCE);
  });
});
