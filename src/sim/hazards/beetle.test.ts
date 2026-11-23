/** Tests of the acorn beetles (src/sim/hazards/beetle.ts) on Autumn Speedway. */
import { describe, expect, it } from 'vitest';
import { autumnSpeedway } from '../../track/tracks/autumnSpeedway';
import type { TrackDef } from '../../track/types';
import { KART } from '../config';
import { createKart, type KartState } from '../kart';
import { Track } from '../track';
import { Beetle } from './beetle';
import { HazardSystem } from './system';

/** Autumn Speedway with just the given hazards. */
function trackWith(hazards: TrackDef['hazards']): Track {
  return new Track({ ...autumnSpeedway, hazards });
}
const ONE: TrackDef['hazards'] = [{ kind: 'beetle', at: 3.5, period: 8, phase: 0 }];
const num = (v: unknown) => Number(v);

/** A kart on the road at distance `s` (lateral `d`), heading along the road at `speed`. */
function kartAt(track: Track, s: number, d: number, speed = 0): KartState {
  const p = track.pointAt(s, d);
  const k = createKart(p.x, p.z, p.heading, p.y);
  k.trackIndex = p.index;
  k.speed = speed;
  k.vel.x = Math.sin(p.heading) * speed;
  k.vel.z = Math.cos(p.heading) * speed;
  return k;
}

describe('acorn beetle', () => {
  const track = trackWith(ONE);
  const beetle = new HazardSystem(track).list[0] as Beetle;

  it('is pure and periodic: the same time gives the same pose, one period later too', () => {
    for (const t of [-2, 0, 1.3, 5.7]) {
      expect(beetle.pose(t)).toEqual(beetle.pose(t));
      expect(num(beetle.pose(t).lat)).toBeCloseTo(num(beetle.pose(t + 8).lat), 6);
    }
  });

  it('marches from beyond one verge to beyond the other and back', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t < 8; t += 0.05) {
      const lat = num(beetle.pose(t).lat);
      min = Math.min(min, lat);
      max = Math.max(max, lat);
    }
    expect(max).toBeGreaterThan(track.def.width / 2 + 2);
    expect(min).toBeLessThan(-track.def.width / 2 - 2);
    // On the road it is 'active'; out on the verge 'idle'.
    expect(beetle.pose(0).phase).toBe('active'); // lat = 0 at t = 0
    expect(beetle.pose(2).phase).toBe('idle'); // lat = +span at a quarter period
  });

  it('bounces a kart that drives into it back, without spinning it out', () => {
    // At t = 2 s the beetle stands still at the right end of its march; drive into it from behind.
    const b = beetle.where(2);
    const k = kartAt(track, beetle.s, b.lat, 25);
    k.pos.x = b.x - Math.sin(k.heading) * 2.3; // 2.3 m behind its centre, driving straight at it
    k.pos.z = b.z - Math.cos(k.heading) * 2.3;
    k.pos.y = b.y;
    const res = beetle.affect(k, 2, 1 / 60, KART);
    expect(res).toBe('hit');
    expect(k.spinTime).toBe(0);
    expect(k.speed).toBeLessThan(0); // knocked backwards
    expect(Math.hypot(k.pos.x - b.x, k.pos.z - b.z)).toBeGreaterThanOrEqual(beetle.radius); // pushed out of the shell
  });

  it('a Nova drives straight through, a kart far to the side is safe, and a flying kart passes over', () => {
    const b = beetle.where(2);
    const nova = kartAt(track, beetle.s - 2, b.lat, 25);
    nova.starTime = 3;
    expect(beetle.affect(nova, 2, 1 / 60, KART)).toBe(null);
    const aside = kartAt(track, beetle.s, b.lat - 6, 25);
    expect(beetle.affect(aside, 2, 1 / 60, KART)).toBe(null);
    const high = kartAt(track, beetle.s - 2, b.lat, 25);
    high.pos.y += 4;
    expect(beetle.affect(high, 2, 1 / 60, KART)).toBe(null);
  });

  it('tells bots where it will be', () => {
    const { lat } = beetle.lateral(1);
    expect(beetle.danger(beetle.s, lat, 0, 1)).toBe(1);
    expect(beetle.danger(beetle.s + 30, lat, 0, 1)).toBe(0);
  });

  it('the track has three beetles, all on the floor roads (not on a bridge)', () => {
    const real = new HazardSystem(new Track(autumnSpeedway));
    const beetles = real.list.filter((h) => h.kind === 'beetle');
    expect(beetles.length).toBe(3);
    const t = new Track(autumnSpeedway);
    for (const b of beetles) expect(t.onBridge(b.s)).toBe(false);
  });
});

