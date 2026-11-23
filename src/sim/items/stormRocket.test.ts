/**
 * Storm (lightning) and Rocket.
 *
 * Storm: every racer AHEAD of the user is shocked at once: loses its item, spins out and shrinks; the lower the
 * race position the sooner it grows back (last place almost at once, the leader after about ten seconds). A shrunk
 * kart is lighter and slower, and a full-size kart drives over it and squashes it. Rockets and Nova karts are immune.
 *
 * Rocket: the kart is driven along the road at a very high speed for a fixed time (it cannot fall off: ravines,
 * jumps and cannons are followed through the air), is invincible, knocks other karts aside, and returns to normal
 * with a small boost and a short grace.
 */
import { describe, expect, it } from 'vitest';
import { Buttons, type ControlInput } from '../../shared/protocol';
import { DEV_TRACKS, TRACKS } from '../../track';
import { BotPack } from '../bots';
import { botLoadoutFor } from '../classes';
import { stepCannons } from '../cannon';
import { ITEMS, KART, SIM_DT } from '../config';
import { createKart, stepSize, type KartState } from '../kart';
import { Track } from '../track';
import { World, type WorldEvent } from '../world';
import { ItemSystem, type ItemEvent } from './items';
import { seededRng } from './odds';
import { effectiveConfig } from './shrink';

const NONE: ControlInput = { steer: 0, buttons: 0 };
const ITEM: ControlInput = { steer: 0, buttons: Buttons.ITEM };
const meadow = TRACKS[0];

/** A race that is on (countdown over) with `n` parked karts on the grid; slot 0 leads, the last slot is last. */
function racing(n: number, def = meadow): World {
  const t = new Track(def);
  const world = new World(t, t);
  const slots = Array.from({ length: n }, (_, i) => i);
  world.startRace(slots, 3);
  for (let i = 0; i < 60 * 3.2; i++) world.tick(() => NONE);
  return world;
}

/** Run the world; `inputs` gives per-slot controls (default: nothing). Returns all events. */
function run(world: World, seconds: number, inputs: (slot: number) => ControlInput = () => NONE, until?: (e: WorldEvent) => boolean): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let i = 0; i < seconds / SIM_DT; i++) {
    const ev = world.tick(inputs);
    out.push(...ev);
    if (until && ev.some(until)) break;
  }
  return out;
}

/** Give `slot` an item and tap ITEM once. */
function use(world: World, slot: number, id: 'storm' | 'rocket'): WorldEvent[] {
  world.items!.states.get(slot)!.held = { id, count: 1 };
  const ev = run(world, 0.05, (s) => (s === slot ? ITEM : NONE));
  ev.push(...run(world, 0.05));
  return ev;
}

describe('Storm', () => {
  it('shocks every racer ahead of the user, and nobody behind', () => {
    const w = racing(4);
    const ev = use(w, 3, 'storm'); // last place
    const k = (s: number) => w.karts.get(s)!;
    for (const s of [0, 1, 2]) {
      expect(k(s).zapTime, `slot ${s} zapped`).toBeGreaterThan(0);
      expect(k(s).shrinkTime).toBeGreaterThan(0);
      expect(k(s).spinTime).toBeGreaterThan(0); // spun out
      expect(ev).toContainEqual({ kind: 'shrunk', slot: s, attacker: 3 });
    }
    expect(k(3).shrinkTime).toBe(0);
    expect(k(3).size).toBe(1);
    expect(k(3).zapTime).toBe(0);
    expect(ev.filter((e) => e.kind === 'shrunk').length).toBe(3);
  });

  it('only hits the racers ahead: the 2nd place user shocks just the leader', () => {
    const w = racing(4);
    use(w, 1, 'storm');
    expect(w.karts.get(0)!.shrinkTime).toBeGreaterThan(0);
    for (const s of [1, 2, 3]) expect(w.karts.get(s)!.shrinkTime).toBe(0);
  });

  it('makes the victims lose their held item', () => {
    const w = racing(3);
    w.items!.states.get(0)!.held = { id: 'ricochet', count: 1 };
    w.items!.states.get(1)!.held = { id: 'dash', count: 3 };
    use(w, 2, 'storm');
    expect(w.items!.states.get(0)!.held).toBeNull();
    expect(w.items!.states.get(1)!.held).toBeNull();
  });

  it('shrinks smoothly to a tiny size, then grows back: last place first, the leader after about ten seconds', () => {
    const w = racing(4);
    use(w, 3, 'storm');
    const sizes: number[][] = [[], [], []];
    const back: (number | null)[] = [null, null, null];
    let t = 0;
    for (let i = 0; i < 60 * 12; i++) {
      w.tick(() => NONE);
      t += SIM_DT;
      for (const s of [0, 1, 2]) {
        const sz = w.karts.get(s)!.size;
        sizes[s].push(sz);
        if (back[s] === null && sz >= 1 && t > 0.5) back[s] = t;
      }
    }
    for (const s of [0, 1, 2]) {
      expect(Math.min(...sizes[s])).toBeCloseTo(ITEMS.stormSize, 2); // tiny
      // smooth: no jump bigger than a few percent per tick
      for (let i = 1; i < sizes[s].length; i++) expect(Math.abs(sizes[s][i] - sizes[s][i - 1])).toBeLessThan(0.05);
    }
    // Regrowth order: 3rd place (s=2) first, then 2nd, then the leader.
    expect(back[2]!).toBeLessThan(back[1]!);
    expect(back[1]!).toBeLessThan(back[0]!);
    expect(back[0]!).toBeGreaterThan(ITEMS.stormTimeFirst - 0.3); // the leader: about ten seconds
    expect(back[0]!).toBeLessThan(ITEMS.stormTimeFirst + 0.5);
    expect(back[2]!).toBeLessThan(5);
  });

  it('with 12 racers: 12th and 11th are back almost at once, 1st takes about ten seconds', () => {
    const w = racing(12);
    use(w, 11, 'storm'); // user is last
    const total = (s: number) => w.karts.get(s)!.shrinkTotal;
    expect(total(0)).toBeCloseTo(ITEMS.stormTimeFirst, 1);
    expect(total(10)).toBeLessThan(2.5); // 11th place
    expect(total(10)).toBeGreaterThanOrEqual(ITEMS.stormTimeLast);
    for (let s = 1; s < 11; s++) expect(total(s)).toBeLessThan(total(s - 1)); // strictly shorter further back
    expect(w.karts.get(11)!.size).toBe(1); // the user is untouched
  });

  it('does not affect a Nova kart (blocked) or a Rocket', () => {
    const w = racing(3);
    w.karts.get(0)!.starTime = 5; // invincible
    w.karts.get(1)!.starTime = 0;
    // Make slot 1 a rocket.
    w.items!.states.get(1)!.held = { id: 'rocket', count: 1 };
    run(w, 0.05, (s) => (s === 1 ? ITEM : NONE));
    expect(w.items!.rocketActive(1)).toBe(true);
    const ev = use(w, 2, 'storm'); // (the rocket may have moved ahead: it still must not be hit)
    expect(w.karts.get(0)!.shrinkTime).toBe(0);
    expect(w.karts.get(1)!.shrinkTime).toBe(0);
    expect(ev).toContainEqual({ kind: 'blocked', slot: 0, by: 'nova' });
  });

  it('a shrunk kart is lighter and slower, bounces off walls more, and recovers its physics when full size again', () => {
    const small = { size: ITEMS.stormSize, squashTime: 0 };
    const normal = { size: 1, squashTime: 0 };
    const c = effectiveConfig(KART, small);
    expect(effectiveConfig(KART, normal)).toBe(KART);
    expect(c.maxSpeed).toBeLessThan(KART.maxSpeed);
    expect(c.accel).toBeLessThan(KART.accel);
    expect(c.mass).toBeLessThan(KART.mass * 0.6);
    expect(c.wallBounce).toBeGreaterThan(KART.wallBounce);
    expect(c.wallSpeedLoss).toBeGreaterThan(KART.wallSpeedLoss);
    // Halfway through the grow-back it is in between.
    const mid = effectiveConfig(KART, { size: (1 + ITEMS.stormSize) / 2, squashTime: 0 });
    expect(mid.maxSpeed).toBeGreaterThan(c.maxSpeed);
    expect(mid.maxSpeed).toBeLessThan(KART.maxSpeed);
    // In a real race the shrunk kart cannot reach the normal top speed.
    const w = racing(2);
    use(w, 1, 'storm');
    const k = w.karts.get(0)!;
    run(w, 3.5, (s) => (s === 0 ? { steer: 0, buttons: Buttons.GAS } : NONE));
    expect(k.size).toBeLessThan(0.5);
    expect(k.speed).toBeLessThan(KART.maxSpeed * ITEMS.stormSpeedFactor + 0.5);
  });

  it('is squashed flat (and slowed) when a full-size kart drives over it, but full-size karts still bump each other', () => {
    const w = racing(3);
    use(w, 2, 'storm'); // slots 0 and 1 shrink
    run(w, 1.6); // the spin-out and the shrinking are over
    const small = w.karts.get(0)!;
    const big = w.karts.get(2)!;
    expect(small.size).toBeLessThan(0.5);
    // Put the big kart right on top of the small one, driving.
    const p = small.pos;
    Object.assign(big.pos, { x: p.x - 0.2, y: p.y, z: p.z - 0.2 });
    big.heading = small.heading;
    big.speed = 20;
    big.vel.x = Math.sin(big.heading) * 20;
    big.vel.z = Math.cos(big.heading) * 20;
    small.speed = 12;
    const before = { x: small.pos.x, z: small.pos.z };
    const ev = run(w, 0.2, () => NONE);
    expect(ev).toContainEqual({ kind: 'squashed', slot: 0, by: 2 });
    expect(small.squashTime).toBeGreaterThan(0.5);
    expect(small.speed).toBeLessThan(12 * 0.5);
    // Driven over, not bounced: the small kart was not shoved by a collision (it only rolls on slowly).
    expect(Math.hypot(small.pos.x - before.x, small.pos.z - before.z)).toBeLessThan(3);
    expect(ev.some((e) => e.kind === 'kart' && (e.slot === 0 || e.slot === 2))).toBe(false);
    // Two full-size karts: ordinary bump.
    const a = racing(2);
    const ka = a.karts.get(0)!;
    const kb = a.karts.get(1)!;
    Object.assign(kb.pos, { x: ka.pos.x + 0.5, y: ka.pos.y, z: ka.pos.z });
    kb.vel.x = -6; // driving into it
    expect(run(a, 0.1).some((e) => e.kind === 'kart')).toBe(true);
  });

  it('a squashed kart is flat only briefly', () => {
    const k = createKart(0, 0, 0);
    k.squashTime = ITEMS.squashTime;
    k.shrinkTime = 3;
    k.shrinkTotal = 3;
    for (let i = 0; i < 60 * (ITEMS.squashTime + 0.1); i++) stepSize(k, SIM_DT);
    expect(k.squashTime).toBe(0);
  });

  it('bots use it when someone is ahead', () => {
    const t = new Track(meadow);
    const world = new World(t, t);
    const slots = [0, 1, 2, 3];
    world.startRace(slots, 3, new Map(slots.map((s) => [s, botLoadoutFor(s)])));
    const pack = new BotPack('normal');
    for (let i = 0; i < 60 * 3.2; i++) world.tick((s) => pack.input(world, s));
    world.items!.states.get(3)!.held = { id: 'storm', count: 1 };
    let used = false;
    for (let i = 0; i < 60 * 12 && !used; i++) {
      used = world.tick((s) => pack.input(world, s)).some((e) => e.kind === 'itemUse' && e.slot === 3 && e.id === 'storm');
    }
    expect(used).toBe(true);
    expect(world.karts.get(0)!.shrinkTime + world.karts.get(0)!.size).toBeGreaterThan(0);
  });
});

describe('Rocket', () => {
  it('drives the kart by itself at very high speed for a fixed time, then returns it to normal with a boost and a grace', () => {
    const w = racing(4);
    const k = w.karts.get(3)!;
    use(w, 3, 'rocket');
    expect(w.items!.rocketActive(3)).toBe(true);
    expect(k.rocketTime).toBeGreaterThan(ITEMS.rocketTime - 0.3);
    // Steering and gas are ignored: the controls do nothing while it is a rocket.
    const s0 = k.pos.z;
    run(w, 2, (s) => (s === 3 ? { steer: 1, buttons: 0 } : NONE));
    expect(k.speed).toBeGreaterThan(ITEMS.rocketSpeed * 0.9);
    expect(k.speed).toBeGreaterThan(KART.maxSpeed * 1.5);
    expect(Math.hypot(k.pos.x, k.pos.z - s0)).toBeGreaterThan(30);
    const ev = run(w, ITEMS.rocketTime + 0.5, () => NONE, (e) => e.kind === 'rocketEnd');
    expect(ev).toContainEqual({ kind: 'rocketEnd', slot: 3 });
    expect(w.items!.rocketActive(3)).toBe(false);
    expect(k.rocketTime).toBe(0);
    // Back to normal: a small boost, grace (items pass through), speed no higher than a boosted kart.
    expect(k.boostTime).toBeGreaterThan(ITEMS.rocketEndBoost - 0.2);
    expect(k.invulnTime).toBeGreaterThan(ITEMS.rocketGrace - 0.2);
    expect(k.speed).toBeLessThanOrEqual(KART.maxSpeed * KART.boostSpeedFactor + 0.01);
  });

  it('lasts rocketTime seconds', () => {
    const w = racing(2);
    use(w, 1, 'rocket');
    let seconds = 0;
    while (w.items!.rocketActive(1) && seconds < 20) {
      w.tick(() => NONE);
      seconds += SIM_DT;
    }
    expect(seconds).toBeGreaterThan(ITEMS.rocketTime - 0.2);
    expect(seconds).toBeLessThan(ITEMS.rocketTime + 0.2);
  });

  it('is invincible, knocks other karts aside (they spin out) and items cannot hit it', () => {
    const w = racing(4);
    use(w, 3, 'rocket');
    // A peel right in front of it on the road: a rocket drives over it unharmed.
    const ev = run(w, 3, () => NONE);
    const spun = new Set(ev.filter((e) => e.kind === 'hit' && e.by === 'rocket').map((e) => (e as { slot: number }).slot));
    expect(spun.size).toBeGreaterThanOrEqual(1); // it ran through the parked karts ahead of it on the grid
    for (const e of ev) if (e.kind === 'hit') expect(e.slot).not.toBe(3); // nothing hit the rocket
    expect(w.karts.get(3)!.spinTime).toBe(0);
    // Hazards and shots pass through: even a shot fired straight at it does nothing.
    const items = w.items!;
    const rk = w.karts.get(3)!;
    items.states.get(0)!.held = { id: 'ricochet', count: 1 };
    const k0 = w.karts.get(0)!;
    Object.assign(k0.pos, { x: rk.pos.x, y: rk.pos.y, z: rk.pos.z - 6 });
    k0.heading = rk.heading;
    k0.spinTime = 0;
    k0.invulnTime = 0;
    const ev2 = run(w, 0.6, (s) => (s === 0 ? ITEM : NONE));
    expect(ev2.some((e) => e.kind === 'hit' && e.slot === 3)).toBe(false);
  });

  it('a Nova kart is not spun out by a rocket (and the other way round)', () => {
    const w = racing(4);
    for (const s of [0, 1, 2]) w.karts.get(s)!.starTime = 30;
    use(w, 3, 'rocket');
    const ev = run(w, 3, () => NONE);
    expect(ev.filter((e) => e.kind === 'hit' && e.by === 'rocket').length).toBe(0);
    expect(w.karts.get(3)!.spinTime).toBe(0);
  });

  it('cannot pick up item boxes or use items while it is a rocket', () => {
    const w = racing(2);
    use(w, 1, 'rocket');
    const st = w.items!.states.get(1)!;
    expect(st.held).toBeNull();
    // Put the rocket right on an item box.
    const box = w.items!.boxes[0];
    const k = w.karts.get(1)!;
    Object.assign(k.pos, { x: box.x, y: box.y, z: box.z });
    run(w, 0.05);
    expect(st.roulette).toBe(0);
  });

  it('bots use it', () => {
    const t = new Track(meadow);
    const world = new World(t, t);
    const slots = [0, 1, 2, 3];
    world.startRace(slots, 3, new Map(slots.map((s) => [s, botLoadoutFor(s)])));
    const pack = new BotPack('normal');
    for (let i = 0; i < 60 * 3.2; i++) world.tick((s) => pack.input(world, s));
    world.items!.states.get(3)!.held = { id: 'rocket', count: 1 };
    let used = false;
    for (let i = 0; i < 60 * 10 && !used; i++) {
      used = world.tick((s) => pack.input(world, s)).some((e) => e.kind === 'itemUse' && e.slot === 3 && e.id === 'rocket');
    }
    expect(used).toBe(true);
    expect(world.items!.rocketActive(3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The rocket follows the road on every track, including jumps, ravines and cannons.
// ---------------------------------------------------------------------------------------------------------------------

function kartAt(track: Track, s: number): KartState {
  const p = track.pointAt(s);
  const k = createKart(p.x, p.z, p.heading, track.sample(p.x, p.z, p.index)?.height ?? p.y);
  k.trackIndex = p.index;
  k.speed = 20;
  k.vel.x = Math.sin(p.heading) * 20;
  k.vel.z = Math.cos(p.heading) * 20;
  return k;
}

/** Make a kart a rocket at s and drive it for the whole rocket time (the same loop the World runs). */
function flyRocket(track: Track, s: number) {
  const k = kartAt(track, s);
  const karts = new Map([[0, k]]);
  const items = new ItemSystem(track, seededRng(1), [0]);
  items.states.get(0)!.held = { id: 'rocket', count: 1 };
  const events: ItemEvent[] = [];
  items.tick(karts, new Map([[0, ITEM]]), [0], new Set(), track);
  events.length = 0;
  const startS = track.project(k.pos.x, k.pos.z, k.trackIndex).s;
  let maxOff = 0;
  let fellBelow = 0;
  let flightTicks = 0;
  for (let i = 0; i < 60 * (ITEMS.rocketTime + 1) && items.rocketActive(0); i++) {
    stepSize(k, SIM_DT);
    if (k.flight) flightTicks++;
    items.driveRocket(0, k, track, SIM_DT, events);
    stepCannons(track, karts, SIM_DT);
    items.tick(karts, new Map([[0, NONE]]), [0], new Set(), track);
    const p = track.project(k.pos.x, k.pos.z, k.trackIndex);
    if (!k.flight) maxOff = Math.max(maxOff, Math.abs(p.d));
    fellBelow = Math.max(fellBelow, p.y - k.pos.y);
  }
  const endS = track.project(k.pos.x, k.pos.z, k.trackIndex).s;
  return { ended: events.some((e) => e.kind === 'rocketEnd'), maxOff, fellBelow, progress: track.deltaS(startS, endS), flightTicks, width: track.def.width };
}

describe('Rocket follows the track', () => {
  const all = [...TRACKS, ...DEV_TRACKS];

  it.each(all.map((d) => [d.name, d] as const))('%s: stays on the road line from every start, over jumps, ravines and cannons', (_n, def) => {
    const track = new Track(def);
    const starts = new Set<number>();
    for (let s = 20; s < track.length - 20; s += 110) starts.add(Math.round(s));
    for (const r of track.ramps) for (const back of [60, 30, 10]) starts.add(Math.round(r.s0 - back));
    for (const g of track.gaps) starts.add(Math.round(g.s0 - 40));
    for (const c of track.cannons) for (const back of [60, 25]) starts.add(Math.round(c.mouth.s - back));
    const bad: string[] = [];
    let runs = 0;
    for (const s0 of starts) {
      const s = ((s0 % track.length) + track.length) % track.length;
      if (track.inGap(s)) continue;
      runs++;
      const r = flyRocket(track, s);
      if (!r.ended) bad.push(`s=${s}: did not end`);
      if (r.maxOff > r.width / 2) bad.push(`s=${s}: left the road by ${r.maxOff.toFixed(1)} m`);
      if (r.fellBelow > 3) bad.push(`s=${s}: sank ${r.fellBelow.toFixed(1)} m below the road`);
      // 7 s at 50 m/s is about 300 m (less while loading into a cannon; more when a cannon throws it ahead).
      if (r.progress < 150 && r.flightTicks === 0) bad.push(`s=${s}: only ${r.progress.toFixed(0)} m of progress`);
    }
    expect(runs).toBeGreaterThan(5);
    expect(bad, bad.slice(0, 6).join('; ')).toEqual([]);
  }, 60000);
});
