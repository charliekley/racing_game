import { describe, expect, it } from 'vitest';
import { Buttons } from '../shared/protocol';
import { at, mushroomValley } from '../track/tracks/mushroomValley';
import { autopilot, botStyleFor } from './autopilot';
import { BOUNCE, Bouncers, bounceArc } from './bouncers';
import { KART, SIM_DT } from './config';
import { Track } from './track';
import { World } from './world';

describe('bounce arc', () => {
  it('lands exactly on the target when flown with plain gravity', () => {
    const target = { x: 30, y: 2, z: 40 };
    const arc = bounceArc(0, 5, 0, target);
    let y = 5;
    let vy = arc.vy;
    let t = 0;
    for (; t < arc.air - 1e-9; t += 0.001) {
      vy -= KART.gravity * 0.001;
      y += vy * 0.001;
    }
    expect(y).toBeCloseTo(target.y, 1);
    expect(arc.speed * arc.air).toBeCloseTo(50, 5); // distance = speed x time
    expect(arc.heading).toBeCloseTo(Math.atan2(30, 40), 9);
  });

  it('takes longer over longer distances, within the air time limits', () => {
    const near = bounceArc(0, 0, 0, { x: 0, y: 0, z: 10 });
    const far = bounceArc(0, 0, 0, { x: 0, y: 0, z: 200 });
    expect(near.air).toBe(BOUNCE.airMin);
    expect(far.air).toBe(BOUNCE.airMax);
    expect(bounceArc(0, 0, 0, { x: 0, y: 0, z: 40 }).speed).toBeCloseTo(BOUNCE.speed, 0);
  });
});

describe('mushroom caps in the world', () => {
  const track = new Track(mushroomValley);

  /** A world with one kart, put on the main road `back` metres before `at(name)` doing `speed`, driven by the autopilot. */
  function setup(name: string, back: number, speed: number, shortcutBias = 0) {
    const world = new World(track, track);
    world.startRace([0], 3, undefined);
    const race = world.race!;
    while (race.phase === 'countdown') world.tick(() => ({ steer: 0, buttons: 0 }));
    const s = track.sAt(at(name)) - back;
    const p = track.pointAt(s);
    const k = world.karts.get(0)!;
    k.pos = { x: p.x, y: p.y, z: p.z };
    k.heading = p.heading;
    k.trackIndex = p.index;
    k.speed = speed;
    k.vel = { x: Math.sin(p.heading) * speed, y: 0, z: Math.cos(p.heading) * speed };
    race.grantProgress(0, s);
    return { world, k, style: { ...botStyleFor(0), shortcutBias, pace: 1 } };
  }

  /** Drive on for `seconds` (the autopilot steers; `gas` false = coast). Returns the events seen. */
  function run(w: ReturnType<typeof setup>, seconds: number, extra: (tick: number) => number = () => 0) {
    const kinds: string[] = [];
    let air = 0;
    for (let i = 0; i < seconds * 60; i++) {
      const cfg = w.world.configOf(0);
      const ev = w.world.tick(() => {
        const inp = autopilot(w.k, track, w.style, cfg);
        return { steer: inp.steer, buttons: inp.buttons | extra(i) };
      });
      for (const e of ev) kinds.push(e.kind);
      if (!w.k.grounded) air++;
    }
    return { kinds, air };
  }

  it('the huge cap of the Sky Leap carries a kart across in ONE bounce at every speed, even a slow one', () => {
    const end = track.sAt(at('g1b')) + 6;
    for (const speed of [4, 12, 20, 28, 37]) {
      const w = setup('g1a', 14, speed);
      const r = run(w, 9);
      expect(r.kinds.filter((k) => k === 'bounce').length, `speed ${speed}`).toBe(1);
      expect(r.kinds, `speed ${speed}`).not.toContain('respawn');
      const s = track.project(w.k.pos.x, w.k.pos.z, w.k.trackIndex).s;
      expect(track.deltaS(end, s), `speed ${speed}`).toBeGreaterThan(0); // on the far road and driving on
      expect(w.k.pos.y).toBeGreaterThan(track.project(w.k.pos.x, w.k.pos.z, w.k.trackIndex).y - 1); // on the road, not under it
    }
  });

  it('a kart entering a cap off to one side, or at an angle, still lands on the cap', () => {
    const end = track.sAt(at('g1b')) + 6;
    for (const [lane, turn] of [[-5, 0.0], [5, 0.0], [-4, 0.15], [4, -0.15]]) {
      const w = setup('g1a', 14, 24);
      const p = track.pointAt(track.sAt(at('g1a')) - 14, lane);
      w.k.pos.x = p.x;
      w.k.pos.z = p.z;
      w.k.heading += turn;
      const r = run(w, 9);
      expect(r.kinds, `lane ${lane} turn ${turn}`).not.toContain('respawn');
      expect(track.deltaS(end, track.project(w.k.pos.x, w.k.pos.z, w.k.trackIndex).s)).toBeGreaterThan(0);
    }
  });

  it('steering in the air cannot make a kart miss (the flight is guided)', () => {
    const end = track.sAt(at('g1b')) + 6;
    const w = setup('g1a', 14, 24);
    const r = run(w, 9, () => 0);
    expect(r.kinds).not.toContain('respawn');
    // Same again, fighting the guidance with full left lock the whole time.
    const w2 = setup('g1a', 14, 24);
    for (let i = 0; i < 9 * 60; i++) w2.world.tick(() => ({ steer: i < 20 ? 0 : -1, buttons: Buttons.GAS }));
    expect(track.deltaS(end, track.project(w2.k.pos.x, w2.k.pos.z, w2.k.trackIndex).s)).toBeGreaterThan(0);
  });

  it('a trick in the air after a bounce pays out a boost on landing', () => {
    const w = setup('g1a', 14, 24);
    const kinds: string[] = [];
    let tricked = false;
    for (let i = 0; i < 6 * 60; i++) {
      const ev = w.world.tick(() => {
        const inp = autopilot(w.k, track, w.style, w.world.configOf(0));
        const press = !w.k.grounded && w.k.trickable && !tricked;
        if (press) tricked = true;
        return { steer: inp.steer, buttons: inp.buttons | (press ? Buttons.TRICK : 0) };
      });
      for (const e of ev) kinds.push(e.kind);
    }
    expect(kinds).toContain('trick');
    expect(kinds).toContain('trickBoost');
  });

  it('the green path of gorge two is solid ground: a kart drives across without bouncing or falling', () => {
    const w = setup('g2a', 12, 22);
    const r = run(w, 6);
    expect(r.kinds).not.toContain('bounce');
    expect(r.kinds).not.toContain('respawn');
    expect(track.deltaS(track.sAt(at('g2b')), track.project(w.k.pos.x, w.k.pos.z, w.k.trackIndex).s)).toBeGreaterThan(0);
  });

  it('the cave: both routes cross with no fall (main road on green caps, shortcut on orange caps)', () => {
    for (const bias of [0, 1]) {
      const w = setup('caveFork', 40, 24, bias);
      const r = run(w, 14);
      expect(r.kinds, `bias ${bias}`).not.toContain('respawn');
      expect(r.kinds.includes('bounce'), `bias ${bias}`).toBe(bias === 1);
      expect(track.deltaS(track.sAt(at('caveOut')), track.project(w.k.pos.x, w.k.pos.z, w.k.trackIndex).s), `bias ${bias}`).toBeGreaterThan(0);
    }
  });

  it('a kart that falls past the side of an orange cap is not bounced from underneath', () => {
    const world = new World(track, track);
    world.startRace([0], 3, undefined);
    const b = world.bouncers!;
    const cap = b.caps.find((c) => c.kind === 'orange')!;
    const k = world.karts.get(0)!;
    // Beside the disc, level with its top, then below it, falling.
    k.grounded = false;
    k.vel = { x: 0, y: -10, z: 0 };
    k.pos = { x: cap.x + cap.radius + 1, y: cap.y, z: cap.z };
    expect(b.step(world.karts, SIM_DT)).toEqual([]);
    k.pos = { x: cap.x, y: cap.y - 3, z: cap.z }; // right under the disc: far below the top
    expect(b.step(world.karts, SIM_DT)).toEqual([]);
  });

  it('caps are ground: the sample over a cap is its top, over the void beside it there is none', () => {
    const b = new Bouncers(track);
    const wrapped = b.wrapGround(track);
    for (const cap of b.caps.filter((c) => c.kind === 'green').slice(0, 4)) {
      const hit = wrapped.sample(cap.x, cap.z);
      expect(hit?.height).toBeCloseTo(cap.y, 5);
      expect(hit?.surface).toBe('road');
    }
    const gap = b.caps[0]; // the huge orange cap of the Sky Leap: 12 m to the side the corridor has no ground
    const p = track.pointAt(track.sAt(at('g1a')) + 7, 12);
    expect(Math.hypot(p.x - gap.x, p.z - gap.z)).toBeGreaterThan(gap.radius);
    expect(wrapped.sample(p.x, p.z)).toBeNull();
  });
});
