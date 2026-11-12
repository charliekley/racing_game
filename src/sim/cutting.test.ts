/**
 * Cutting across between two parts of the road (e.g. from one switchback leg to the next)
 * must never break the race: the kart is either carried back to its last checkpoint, or
 * it stays credited correctly, and it can always still finish.
 */
import { describe, expect, it } from 'vitest';
import { switchbackSummit } from '../track/tracks/switchbackSummit';
import { autopilot, botStyleFor } from './autopilot';
import { Track } from './track';
import { World } from './world';

const track = new Track(switchbackSummit);

/** Two road points close together in space but far apart along the road, at a drivable height difference (not an overpass). */
function findCut(): { a: number; b: number } {
  const S = track.samples;
  let best: { a: number; b: number; d: number } | null = null;
  for (let i = 0; i < S.length; i += 3) {
    for (let j = 0; j < S.length; j += 3) {
      const ahead = track.deltaS(S[i].s, S[j].s);
      if (ahead < 150 || ahead > track.length / 2 || Math.abs(S[i].y - S[j].y) > 12) continue; // a climb you could drive up
      const d = Math.hypot(S[i].x - S[j].x, S[i].z - S[j].z);
      if (d > 20 && d < 80 && (!best || d < best.d)) best = { a: i, b: j, d };
    }
  }
  expect(best, 'switchback legs close together').not.toBeNull();
  return best!;
}

describe('cutting between switchback legs', () => {
  for (const hintFollows of [false, true]) {
    it(`a teleported kart is sent back or stays correctly credited, and still finishes (hint ${hintFollows ? 'follows' : 'kept'})`, () => {
      const { a, b } = findCut();
      const world = new World(track, track);
      world.startRace([0], 2);
      const style = botStyleFor(1);
      const k = world.karts.get(0)!;
      const race = world.race!;
      let teleported = false;
      let respawned = false;
      let checkedBack = false;
      let teleportTick = -1;
      for (let i = 0; i < 60 * 240 && !race.racers.get(0)!.finished; i++) {
        // On lap 1, once the kart reaches point a, drop it onto point b (the "cut").
        if (!teleported && race.racers.get(0)!.lap === 1 && track.project(k.pos.x, k.pos.z, k.trackIndex).index === a) {
          const p = track.samples[b];
          k.pos = { x: p.x, y: p.y + 0.3, z: p.z };
          k.heading = p.heading;
          if (hintFollows) k.trackIndex = b;
          teleported = true;
          teleportTick = i;
        }
        const ev = world.tick(() => autopilot(k, track, style));
        if (teleported && ev.some((e) => e.kind === 'respawn')) respawned = true;
        // 3 s after the cut: either it is being carried back, or it is back on the road near a
        // (the guard rails pushed it back), i.e. it gained nothing.
        if (teleported && !checkedBack && i - teleportTick === 180) {
          checkedBack = true;
          const s = track.project(k.pos.x, k.pos.z, k.trackIndex).s;
          const nearA = Math.abs(track.deltaS(track.samples[a].s, s)) < 80;
          expect(respawned || nearA).toBe(true);
        }
      }
      expect(teleported).toBe(true);
      expect(checkedBack).toBe(true);
      // Not stuck uncounted: both laps are counted and the race is finished.
      expect(race.racers.get(0)!.finished).toBe(true);
      expect(race.racers.get(0)!.lapTimes.length).toBe(2);
    }, 60_000);
  }
});
