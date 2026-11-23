/**
 * The Seeker follows the ROAD toward the racer ahead (like a red shell in other kart games): it must reach the
 * next racer on every track, including from right behind jumps, ravines and launch cannons, instead of flying
 * straight into a wall or falling into the gap.
 *
 * The test fires one Seeker from a parked kart at many places on every track. The target is a computer driver
 * (real kart physics, real cannons) some metres ahead on the road. The shot must hit it before it expires.
 */
import { describe, expect, it } from 'vitest';
import { Buttons, type ControlInput } from '../../shared/protocol';
import { TRACKS, DEV_TRACKS } from '../../track';
import { planScenery } from '../../track/sceneryPlan';
import { autopilot, botStyleFor } from '../autopilot';
import { stepCannons } from '../cannon';
import { Colliders } from '../colliders';
import { ITEMS, SIM_DT } from '../config';
import { createKart, stepKart, type KartState } from '../kart';
import { Track } from '../track';
import { ItemSystem, type ItemEvent } from './items';
import { seededRng } from './odds';

const NONE: ControlInput = { steer: 0, buttons: 0 };

function kartAt(track: Track, s: number, speed = 0): KartState {
  const p = track.pointAt(s);
  const k = createKart(p.x, p.z, p.heading, track.sample(p.x, p.z, p.index)?.height ?? p.y);
  k.trackIndex = p.index;
  k.speed = speed;
  k.vel.x = Math.sin(p.heading) * speed;
  k.vel.z = Math.cos(p.heading) * speed;
  return k;
}

interface Shot {
  hit: boolean;
  /** Seconds until the hit (or until the end of the run). */
  time: number;
  /** Did the shot ever leave the track area / get destroyed by scenery? */
  destroyed: boolean;
  /** Highest distance (m) the shot got from the centerline. */
  maxOffRoad: number;
  /** The target took a shortcut cannon (it lands hundreds of metres on: no shot can follow that) or fell off the course: no fair test. */
  exempt: boolean;
}

/**
 * Fire a Seeker from a parked kart at distance `s` along the track; the target kart (slot 1, in front in the
 * standings) is a bot that starts `gap` metres further along and drives on. Returns what happened.
 */
function fire(track: Track, colliders: Colliders, s: number, gap: number, seconds = ITEMS.seekerLifetime): Shot {
  const shooter = kartAt(track, s);
  const target = kartAt(track, s + gap, 22);
  const karts = new Map([
    [0, shooter],
    [1, target],
  ]);
  const items = new ItemSystem(track, seededRng(3), [0, 1]);
  items.setColliders(colliders);
  items.states.get(0)!.held = { id: 'seeker', count: 1 };
  const style = botStyleFor(0);
  const standings = [1, 0];
  const out: Shot = { hit: false, time: seconds, destroyed: false, maxOffRoad: 0, exempt: false };
  let shotSeen = false;
  const events: ItemEvent[] = [];
  for (let i = 0; i < seconds / SIM_DT; i++) {
    const press: ControlInput = i < 3 ? { steer: 0, buttons: Buttons.ITEM } : NONE;
    // Drive the target like a computer driver would (cannons capture it, ravines are jumped).
    stepKart(target, target.flight ? NONE : autopilot(target, track, style), track, SIM_DT);
    stepCannons(track, karts, SIM_DT);
    if (target.flight && !track.cannons[target.flight.cannon].mandatory) out.exempt = true;
    if (target.pos.y < track.project(target.pos.x, target.pos.z, target.trackIndex).y - 8) out.exempt = true;
    events.length = 0;
    events.push(...items.tick(karts, new Map([[0, press], [1, NONE]]), standings, new Set(), track));
    const shot = items.entityList.find((e) => e.kind === 'seeker');
    if (shot) {
      shotSeen = true;
      const p = track.project(shot.x, shot.z);
      out.maxOffRoad = Math.max(out.maxOffRoad, Math.abs(p.d) - p.width / 2);
    }
    if (events.some((e) => e.kind === 'hit' && e.slot === 1 && e.by === 'seeker')) {
      out.hit = true;
      out.time = i * SIM_DT;
      return out;
    }
    if (events.some((e) => e.kind === 'itemDestroyed')) out.destroyed = true;
    if (shotSeen && !shot) break; // gone without a hit
  }
  return out;
}

/** Places to fire from on a track: every ~90 m, and close behind every ramp, gap and cannon. */
function startPoints(track: Track): number[] {
  const pts = new Set<number>();
  for (let s = 30; s < track.length - 40; s += 90) pts.add(Math.round(s));
  for (const r of track.ramps) for (const back of [70, 35, 12]) pts.add(Math.round(r.s0 - back));
  for (const g of track.gaps) for (const back of [60, 25]) pts.add(Math.round(g.s0 - back));
  for (const c of track.cannons) for (const back of [70, 40, 15]) pts.add(Math.round(c.mouth.s - back));
  return [...pts].map((s) => ((s % track.length) + track.length) % track.length).sort((a, b) => a - b);
}

describe('Seeker follows the track', () => {
  const all = [...TRACKS, ...DEV_TRACKS];

  it.each(all.map((d) => [d.name, d] as const))('%s: hits the racer ahead from every start (jumps, ravines, cannons)', (_n, def) => {
    const track = new Track(def);
    const plan = planScenery(track);
    const colliders = new Colliders([...plan.colliders, ...plan.pierColliders]);
    const misses: string[] = [];
    let runs = 0;
    for (const s of startPoints(track)) {
      for (const gap of [60, 100]) {
        // Skip starts where the shooter or the target would stand in a gap / on a launch pad's far side.
        if (track.inGap(s) || track.inGap(s + gap) || track.inGap(s - 4)) continue;
        runs++;
        const r = fire(track, colliders, s, gap);
        if (!r.hit && !r.exempt) misses.push(`s=${s} gap=${gap} (destroyed=${r.destroyed}, maxOff=${r.maxOffRoad.toFixed(1)})`);
      }
    }
    expect(runs).toBeGreaterThan(5);
    expect(misses, `${def.name}: ${misses.length}/${runs} missed: ${misses.slice(0, 8).join('; ')}`).toEqual([]);
  }, 60000);

  it('stays on the road line: it never strays off the track while following it', () => {
    const track = new Track(TRACKS[0]);
    const plan = planScenery(track);
    const colliders = new Colliders([...plan.colliders, ...plan.pierColliders]);
    for (const s of [100, 400]) {
      const r = fire(track, colliders, s, 90);
      expect(r.hit).toBe(true);
      expect(r.maxOffRoad).toBeLessThan(track.def.offroadWidth);
    }
  });

  it('with nobody ahead (the leader fires) it follows the road and expires without a target', () => {
    const track = new Track(TRACKS[0]);
    const shooter = kartAt(track, 200);
    const karts = new Map([[0, shooter]]);
    const items = new ItemSystem(track, seededRng(1), [0]);
    items.states.get(0)!.held = { id: 'seeker', count: 1 };
    let maxOff = 0;
    for (let i = 0; i < 60 * (ITEMS.seekerLifetime + 1); i++) {
      items.tick(karts, new Map([[0, i < 3 ? { steer: 0, buttons: Buttons.ITEM } : NONE]]), [0], new Set(), track);
      const shot = items.entityList[0];
      if (shot) {
        const p = track.project(shot.x, shot.z);
        maxOff = Math.max(maxOff, Math.abs(p.d));
      }
    }
    expect(items.entityList.length).toBe(0); // timed out
    expect(maxOff).toBeLessThan(track.def.width / 2 + 2); // never left the road
  });

  it('goes for the next racer up the standings when it flies past its target', () => {
    const track = new Track(TRACKS[1]);
    // Shooter 3rd, racers 1 and 2 ahead; the shot's first target is the 2nd: a blocker standing still.
    const a = kartAt(track, 300); // leader, parked
    const b = kartAt(track, 150); // 2nd, parked right in the way
    const c = kartAt(track, 100);
    const karts = new Map([
      [0, a],
      [1, b],
      [2, c],
    ]);
    const items = new ItemSystem(track, seededRng(1), [0, 1, 2]);
    items.states.get(2)!.held = { id: 'seeker', count: 1 };
    // The 2nd place kart is protected (just hit): the shot passes through it and must carry on to the leader.
    b.invulnTime = 5;
    const ev: ItemEvent[] = [];
    for (let i = 0; i < 60 * 8; i++) {
      ev.push(...items.tick(karts, new Map<number, ControlInput>([[0, NONE], [1, NONE], [2, i < 3 ? { steer: 0, buttons: Buttons.ITEM } : NONE]]), [0, 1, 2], new Set(), track));
    }
    expect(ev).toContainEqual({ kind: 'hit', slot: 0, by: 'seeker', attacker: 2 });
  });
});
