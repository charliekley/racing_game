/**
 * Mushroom Valley: green bridges join the road flush (no launch at the joints), and orange caps are a skill test:
 * the arc is aimed but NOT guided, so the player flies the landing (see the AIR CONTROL notes in bouncers.ts).
 */
import { describe, expect, it } from 'vitest';
import { Buttons } from '../shared/protocol';
import { at, mushroomValley } from '../track/tracks/mushroomValley';
import { autopilot, botStyleFor } from './autopilot';
import { Bouncers } from './bouncers';
import { Track } from './track';
import { World } from './world';

const track = new Track(mushroomValley);

/** A one-kart world past the countdown, the kart on the main road `back` m before `from` doing `speed`. */
function setup(from: string, back: number, speed: number) {
  const world = new World(track, track);
  world.startRace([0], 3, undefined);
  while (world.race!.phase === 'countdown') world.tick(() => ({ steer: 0, buttons: 0 }));
  const s = track.sAt(at(from)) - back;
  const p = track.pointAt(s);
  const k = world.karts.get(0)!;
  k.pos = { x: p.x, y: p.y, z: p.z };
  k.heading = p.heading;
  k.trackIndex = p.index;
  k.speed = speed;
  k.vel = { x: Math.sin(p.heading) * speed, y: 0, z: Math.cos(p.heading) * speed };
  world.race!.grantProgress(0, s);
  return { world, k };
}

describe('green bridges join the road flush', () => {
  const bridges: [string, string][] = [
    ['g2a', 'g2b'], // Stepping Stones
    ['g3a', 'g3b'], // Twin Spans, main road
    ['caveIn', 'caveOut'], // the cave, main route
  ];

  it.each(bridges)('a kart drives across the green bridge at %s at 20 and 30 m/s without leaving the surface', (from, to) => {
    for (const speed of [20, 30]) {
      const { world, k } = setup(from, 50, speed);
      const style = { ...botStyleFor(0), shortcutBias: 0, pace: 1 };
      const ground = world.bouncers!.wrapGround(track);
      let airRun = 0;
      let longestAir = 0;
      let maxRise = 0;
      let bounced = false;
      let respawned = false;
      const end = track.sAt(at(to)) + 20;
      for (let i = 0; i < 60 * 12; i++) {
        const inp = autopilot(k, track, style, world.configOf(0));
        // Hold the speed: gas flat for the fast run, otherwise gas only below 20 m/s.
        const buttons = speed >= 28 || k.speed < speed ? Buttons.GAS : 0;
        for (const e of world.tick(() => ({ steer: inp.steer, buttons }))) {
          if (e.kind === 'bounce') bounced = true;
          if (e.kind === 'respawn') respawned = true;
        }
        const g = ground.sample(k.pos.x, k.pos.z, k.trackIndex);
        if (track.deltaS(track.sAt(at(from)), track.project(k.pos.x, k.pos.z, k.trackIndex).s) < -25) continue; // (the kart settles on the road first)
        if (k.grounded) airRun = 0;
        else longestAir = Math.max(longestAir, ++airRun);
        if (g) maxRise = Math.max(maxRise, k.pos.y - g.height);
        if (track.deltaS(end, track.project(k.pos.x, k.pos.z, k.trackIndex).s) > 0) break;
      }
      const where = `${from} at ${speed} m/s`;
      expect(bounced, where).toBe(false);
      expect(respawned, where).toBe(false);
      expect(longestAir, `${where}: ticks in the air`).toBeLessThanOrEqual(2); // (a tick or two of lift is not a launch)
      expect(maxRise, `${where}: rise above the surface (m)`).toBeLessThan(0.3);
      expect(track.deltaS(end, track.project(k.pos.x, k.pos.z, k.trackIndex).s), where).toBeGreaterThan(0); // made it across
    }
  });
});

describe('orange caps need skill: air control', () => {
  /** The first orange cap of the Twin Spans shortcut (route 1) and of the cave shortcut (route 2). */
  const firstOrange = (route: number) => new Bouncers(track).caps.find((c) => c.kind === 'orange' && track.project(c.x, c.z).route === route)!;

  /**
   * Put a kart on an orange cap (its centre, plus `side` m to the right of the line to the target), rolling `speed`
   * with its nose `turn` rad off that line, and fly: `control` 'none' = no steering, 'pilot' = the careful driver of
   * `Bouncers.pilot` (steering and pedals in the air). Returns whether it fell (respawned) and how many bounces it made.
   */
  function fly(route: number, side: number, turn: number, speed: number, control: 'none' | 'pilot') {
    const cap = firstOrange(route);
    const world = new World(track, track);
    world.startRace([0], 3, undefined);
    while (world.race!.phase === 'countdown') world.tick(() => ({ steer: 0, buttons: 0 }));
    const k = world.karts.get(0)!;
    const heading = Math.atan2(cap.target!.x - cap.x, cap.target!.z - cap.z);
    const x = cap.x - Math.cos(heading) * side;
    const z = cap.z + Math.sin(heading) * side;
    const h = heading + turn;
    k.pos = { x, y: Bouncers.surface(cap, x, z) + 0.05, z };
    k.heading = h;
    k.speed = speed;
    k.vel = { x: Math.sin(h) * speed, y: 0, z: Math.cos(h) * speed };
    k.trackIndex = track.project(x, z).index;
    let respawned = false;
    let bounces = 0;
    let lastBounce = 0;
    for (let i = 0; i < 60 * 8; i++) {
      // The flight is over once the kart is on the ground after the last bounce (what it does then is not the test).
      if (bounces > 0 && k.grounded && !world.bouncers!.bouncing(0) && i - lastBounce > 20) break;
      const events = world.tick(() => {
        const air = control === 'pilot' ? world.bouncers!.pilot(0, k) : null;
        return air ? { steer: air.steer, buttons: (air.gas ? Buttons.GAS : 0) | (air.brake ? Buttons.BRAKE : 0) } : { steer: 0, buttons: world.bouncers!.bouncing(0) ? 0 : Buttons.GAS };
      });
      for (const e of events) {
        if (e.kind === 'respawn') respawned = true;
        if (e.kind === 'bounce') {
          bounces++;
          lastBounce = i;
        }
      }
    }
    // Success = it made every hop of the route and ended up on the far landing (not short of it, not in the abyss).
    const last = world.bouncers!.caps.filter((c) => c.kind === 'orange' && track.project(c.x, c.z).route === route).pop()!;
    const ends = Math.hypot(last.target!.x - k.pos.x, last.target!.z - k.pos.z);
    const hops = world.bouncers!.caps.filter((c) => c.kind === 'orange' && track.project(c.x, c.z).route === route).length;
    return { respawned, bounces, landed: !respawned && bounces === hops && ends < 6 };
  }

  for (const route of [1, 2]) {
    const name = route === 1 ? 'Twin Spans' : 'the cave';
    it(`${name}: a well-aligned kart at racing speed lands the whole shortcut without any steering`, () => {
      expect(fly(route, 0, 0, 27, 'none').landed).toBe(true);
    });

    it(`${name}: a badly aligned kart (off-centre, wrong angle) with no steering misses, and so does a slow one`, () => {
      expect(fly(route, 4, 0.45, 27, 'none').landed).toBe(false);
      expect(fly(route, -4, -0.45, 27, 'none').landed).toBe(false);
      expect(fly(route, 0, 0, 6, 'none').landed).toBe(false);
    });

    it(`${name}: the same badly aligned and slow karts land when the player steers and uses the pedals in the air`, () => {
      expect(fly(route, 4, 0.45, 27, 'pilot').landed).toBe(true);
      expect(fly(route, -4, -0.45, 27, 'pilot').landed).toBe(true);
      expect(fly(route, 0, 0, 6, 'pilot').landed).toBe(true);
    });
  }

  it('steering in the air moves the kart sideways, gas and brake nudge it forward and back (within limits)', () => {
    const drift = (steer: number, buttons: number) => {
      const cap = firstOrange(2);
      const world = new World(track, track);
      world.startRace([0], 3, undefined);
      while (world.race!.phase === 'countdown') world.tick(() => ({ steer: 0, buttons: 0 }));
      const k = world.karts.get(0)!;
      const heading = Math.atan2(cap.target!.x - cap.x, cap.target!.z - cap.z);
      k.pos = { x: cap.x, y: cap.y + 0.05, z: cap.z };
      k.heading = heading;
      k.speed = 27;
      k.vel = { x: Math.sin(heading) * 27, y: 0, z: Math.cos(heading) * 27 };
      for (let i = 0; i < 40; i++) world.tick(() => ({ steer: i > 3 ? steer : 0, buttons }));
      const dx = k.pos.x - cap.x;
      const dz = k.pos.z - cap.z;
      // components to the right of and along the flight line
      return { right: dx * -Math.cos(heading) + dz * Math.sin(heading), forward: dx * Math.sin(heading) + dz * Math.cos(heading) };
    };
    const none = drift(0, 0);
    expect(drift(1, 0).right - none.right).toBeGreaterThan(2);
    expect(drift(-1, 0).right - none.right).toBeLessThan(-2);
    expect(drift(0, Buttons.GAS).forward - none.forward).toBeGreaterThan(0.5);
    expect(drift(0, Buttons.BRAKE).forward - none.forward).toBeLessThan(-0.5);
  });

  it('the orange route is the faster one when flown well (a trick on the way), by about a second or more', () => {
    const crossing = (from: string, to: string, bias: number) => {
      const { world, k } = setup(from, 60, 24);
      const style = { ...botStyleFor(0), shortcutBias: bias, pace: 1 };
      let tIn = -1;
      for (let i = 0; i < 60 * 25; i++) {
        world.tick(() => {
          const air = world.bouncers!.pilot(0, k);
          if (air) return { steer: air.steer, buttons: (air.gas ? Buttons.GAS : 0) | (air.brake ? Buttons.BRAKE : 0) | (i % 2 ? Buttons.TRICK : 0) };
          return autopilot(k, track, style, world.configOf(0));
        });
        const ps = track.project(k.pos.x, k.pos.z, k.trackIndex).s;
        if (tIn < 0 && track.deltaS(track.sAt(at(from)), ps) > 0) tIn = i;
        if (track.deltaS(track.sAt(at(to)), ps) > 0) return (i - tIn) / 60;
      }
      return Infinity;
    };
    for (const [from, to] of [
      ['g3fork', 'g3join'],
      ['caveFork', 'caveEnd'],
    ]) {
      const gain = crossing(from, to, 0) - crossing(from, to, 1);
      expect(gain, `${from}: seconds saved by the orange route`).toBeGreaterThan(0.8);
      expect(gain, `${from}: seconds saved by the orange route`).toBeLessThan(2);
    }
  });
});
