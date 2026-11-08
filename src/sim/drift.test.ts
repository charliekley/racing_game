import { describe, expect, it } from 'vitest';
import { Buttons, type ControlInput } from '../shared/protocol';
import { TRACKS } from '../track';
import { KART, SIM_DT } from './config';
import type { Ground } from './ground';
import { createKart, stepKart, type KartEvent, type KartState } from './kart';
import { Track } from './track';
import { World } from './world';

const flat: Ground = { sample: () => ({ height: 0, surface: 'road' }) };
const { GAS, DRIFT, TRICK } = Buttons;

/** Run `seconds` of one input, collecting events. */
function run(k: KartState, input: ControlInput, seconds: number, ground = flat): KartEvent[] {
  const ev: KartEvent[] = [];
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) ev.push(...stepKart(k, input, ground, SIM_DT));
  return ev;
}

function atSpeed(v = 22): KartState {
  const k = createKart(0, 0, 0);
  k.speed = v;
  k.vel.z = v;
  return k;
}

describe('hop and drift', () => {
  it('DRIFT without steering is just a hop', () => {
    const k = atSpeed();
    const ev = run(k, { steer: 0, buttons: GAS | DRIFT }, 1);
    expect(ev.map((e) => e.kind)).toContain('hop');
    expect(k.driftDir).toBe(0);
    expect(k.grounded).toBe(true);
  });

  it('hop while steering right starts a right drift on landing', () => {
    const k = atSpeed();
    const ev = run(k, { steer: 0.6, buttons: GAS | DRIFT }, 0.6);
    expect(ev).toContainEqual({ kind: 'driftStart', dir: 1 });
    expect(k.driftDir).toBe(1);
  });

  it('too slow = no drift', () => {
    const k = atSpeed(5);
    run(k, { steer: 1, buttons: DRIFT }, 0.6);
    expect(k.driftDir).toBe(0);
  });

  it('charges blue then orange, and releasing gives a mini-turbo (longer for orange)', () => {
    const blue = atSpeed();
    run(blue, { steer: 0.5, buttons: GAS | DRIFT }, 0.4);
    run(blue, { steer: 0.5, buttons: GAS | DRIFT }, 0.9);
    expect(blue.driftTier).toBe(1);
    const evBlue = run(blue, { steer: 0, buttons: GAS }, SIM_DT);
    expect(evBlue).toContainEqual({ kind: 'miniTurbo', tier: 1 });
    const blueBoost = blue.boostTime;

    const orange = atSpeed();
    run(orange, { steer: 1, buttons: GAS | DRIFT }, 0.4);
    const ev = run(orange, { steer: 1, buttons: GAS | DRIFT }, 1.5);
    expect(ev).toContainEqual({ kind: 'driftTier', tier: 2 });
    run(orange, { steer: 0, buttons: GAS }, SIM_DT);
    expect(orange.boostTime).toBeGreaterThan(blueBoost);
  });

  it('releasing an uncharged drift gives nothing', () => {
    const k = atSpeed();
    run(k, { steer: 0.5, buttons: GAS | DRIFT }, 0.45);
    expect(k.driftDir).toBe(1);
    const ev = run(k, { steer: 0, buttons: GAS }, SIM_DT);
    expect(ev.map((e) => e.kind)).not.toContain('miniTurbo');
    expect(k.boostTime).toBe(0);
  });

  it('steering into the drift turns tighter than steering out of it', () => {
    const turnOver = (steer: number) => {
      const k = atSpeed();
      run(k, { steer: 0.5, buttons: GAS | DRIFT }, 0.45); // enter a right drift
      const h0 = k.heading;
      run(k, { steer, buttons: GAS | DRIFT }, 1);
      return Math.abs(k.heading - h0);
    };
    expect(turnOver(1)).toBeGreaterThan(turnOver(-1) * 2);
  });

  it('a drift slides: the velocity lags behind where the kart points', () => {
    const k = atSpeed();
    run(k, { steer: 1, buttons: GAS | DRIFT }, 1.2);
    const fx = Math.sin(k.heading);
    const fz = Math.cos(k.heading);
    const along = (k.vel.x * fx + k.vel.z * fz) / Math.hypot(k.vel.x, k.vel.z);
    expect(along).toBeLessThan(0.995); // noticeably sideways
    expect(along).toBeGreaterThan(0.7); // but still mostly forward
  });
});

describe('tricks', () => {
  const ramp: Ground = {
    // A 10 m ramp up to 2 m, then a drop back to 0.
    sample: (_x, z) => ({ height: z > 0 && z < 10 ? z * 0.2 : 0, surface: 'road' }),
  };

  it('a trick in the air after a ramp gives a boost on landing', () => {
    const k = createKart(0, -5, 0);
    k.speed = 25;
    k.vel.z = 25;
    run(k, { steer: 0, buttons: GAS }, 0.6, ramp); // up the ramp and off
    expect(k.grounded).toBe(false);
    expect(k.trickable).toBe(true);
    const ev = [...run(k, { steer: 0, buttons: GAS | TRICK }, SIM_DT, ramp), ...run(k, { steer: 0, buttons: GAS }, 1.5, ramp)];
    expect(ev.map((e) => e.kind)).toEqual(expect.arrayContaining(['trick', 'trickBoost']));
  });

  it('no tricks off a drift hop', () => {
    const k = atSpeed();
    run(k, { steer: 0, buttons: GAS | DRIFT }, SIM_DT);
    const ev = run(k, { steer: 0, buttons: GAS | DRIFT | TRICK }, 0.5);
    expect(ev.map((e) => e.kind)).not.toContain('trick');
  });
});

describe('respawn', () => {
  const track = new Track(TRACKS[0]);

  it('too slow over the jump: fall in the water, carrier puts you back on the road', () => {
    expect(track.gaps.length).toBeGreaterThan(0);
    const world = new World(track, track);
    const g = track.gaps[0];
    const p = track.pointAt(g.s0 + 2);
    world.addKart(0, { x: p.x, z: p.z, heading: p.heading });
    const k = world.karts.get(0)!;
    k.pos.y = 0;
    const events = [];
    for (let i = 0; i < 60 * 4; i++) events.push(...world.tick(() => ({ steer: 0, buttons: 0 })));
    expect(events.map((e) => e.kind)).toContain('respawn');
    expect(k.respawnTime).toBe(0);
    expect(k.grounded).toBe(true);
    const proj = track.project(k.pos.x, k.pos.z);
    expect(Math.abs(proj.d)).toBeLessThan(TRACKS[0].width / 2);
    expect(track.inGap(proj.s)).toBe(false);
  });

  it('wandering far off course triggers the carrier too', () => {
    const world = new World(track, track);
    const p = track.pointAt(100, 200); // 200 m to the side
    world.addKart(0, { x: p.x, z: p.z, heading: 0 });
    const kinds = [];
    for (let i = 0; i < 60 * (KART.offTrackRespawnTime + 0.5); i++) kinds.push(...world.tick(() => ({ steer: 0, buttons: 0 })).map((e) => e.kind));
    expect(kinds).toContain('respawn');
  });
});
