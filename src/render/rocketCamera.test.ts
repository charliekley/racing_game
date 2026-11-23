/**
 * Regression: a Rocket flight must not make the screen jitter.
 *
 * Cause that was found: the rocket steers by pure pursuit toward a point on the road centerline. The centerline is a
 * polyline with a sample every 2 m, and `project()` only reports the NEAREST sample, so the aim point hopped 2 m at a
 * time. At 50 m/s the kart covers 0.83 m per tick, so the aim (and therefore the heading) only changed every 2-3 ticks:
 * yaw rate alternated 0, -2.2, 0, 0, -2.2 rad/s. The chase camera looks along the kart's heading and uses its yaw
 * rate for the look-into-the-turn offset and the roll, so the view shuddered. (In physics terms: the commanded
 * angular velocity was a square-ish wave instead of a smooth signal, i.e. a huge angular JERK.)
 *
 * Metric: the second difference of the camera's forward vector between consecutive rendered frames (a measure of angular
 * acceleration, per frame^2), at 144 Hz render over a 60 Hz sim with interpolation, like the game. We compare the
 * rocket window with normal driving on the same track.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Buttons, type ControlInput } from '../shared/protocol';
import { autopilot, botStyleFor } from '../sim/autopilot';
import { SIM_DT } from '../sim/config';
import { Track } from '../sim/track';
import { World } from '../sim/world';
import { TRACKS } from '../track';
import { ChaseCamera, newCameraState } from './chaseCamera';
import { lerpAngle } from './kartView';

interface Frame {
  pos: THREE.Vector3;
  fwd: THREE.Vector3;
  rocket: boolean;
}

/** Drive one bot for 6 s, then (optionally) fire a Rocket, and film `seconds` of it through the chase camera. */
function film(trackIdx: number, rocket: boolean, seconds: number, fps: number): Frame[] {
  const t = new Track(TRACKS[trackIdx]);
  const w = new World(t, t);
  w.startRace([0], 3);
  for (let i = 0; i < 60 * 3.2; i++) w.tick(() => ({ steer: 0, buttons: 0 }));
  const k = w.karts.get(0)!;
  const input = (): ControlInput => autopilot(k, t, botStyleFor(0));
  for (let i = 0; i < 60 * 6; i++) w.tick(input);
  if (rocket) {
    w.items!.states.get(0)!.held = { id: 'rocket', count: 1 };
    w.tick(() => ({ steer: 0, buttons: Buttons.ITEM }));
  }
  const cam = new ChaseCamera();
  const st = newCameraState();
  const groundAt = (x: number, z: number) => t.sample(x, z)?.height ?? null;
  const frames: Frame[] = [];
  const dt = 1 / fps;
  let acc = 0;
  for (let time = 0; time < seconds; time += dt) {
    acc += dt;
    while (acc >= SIM_DT) {
      w.tick(input);
      acc -= SIM_DT;
    }
    const prev = w.prevKarts.get(0)!;
    const a = acc / SIM_DT;
    const pose = {
      x: prev.pos.x + (k.pos.x - prev.pos.x) * a,
      y: prev.pos.y + (k.pos.y - prev.pos.y) * a,
      z: prev.pos.z + (k.pos.z - prev.pos.z) * a,
      heading: lerpAngle(prev.heading, k.heading, a),
      speed: prev.speed + (k.speed - prev.speed) * a,
      yawRate: k.yawRate,
    };
    st.boosting = k.boostTime > 0 || k.rocketTime > 0;
    st.grounded = k.grounded;
    cam.update(pose, dt, st, groundAt);
    frames.push({ pos: cam.camera.position.clone(), fwd: cam.camera.getWorldDirection(new THREE.Vector3()), rocket: k.rocketTime > 0 });
  }
  return frames;
}

/** Angular "jerk" proxy: |f[i] - 2 f[i-1] + f[i-2]| of the view direction, over frames i in [from, to). */
function angularJerk(frames: Frame[], from: number, to: number): { p99: number; max: number } {
  const v: number[] = [];
  for (let i = Math.max(2, from); i < Math.min(frames.length, to); i++) {
    v.push(frames[i].fwd.clone().sub(frames[i - 1].fwd.clone().multiplyScalar(2)).add(frames[i - 2].fwd).length());
  }
  v.sort((a, b) => a - b);
  return { p99: v[Math.floor(v.length * 0.99)], max: v[v.length - 1] };
}

describe('Rocket flight and the chase camera', () => {
  // Ember Peaks, Cloud Garden, Switchback Summit: curvy roads where the old stair-stepped heading was worst.
  for (const idx of [0, 2, 3]) {
    it(`${TRACKS[idx].name}: the view is as smooth as normal driving`, () => {
      const fps = 144;
      const skip = Math.round(0.4 * fps); // camera warm-up right after the item press
      const rocketFrames = film(idx, true, 6.2, fps);
      const normal = film(idx, false, 6.2, fps);
      const r = angularJerk(rocketFrames, skip, rocketFrames.length - skip);
      const n = angularJerk(normal, skip, normal.length - skip);
      // Old behaviour: p99 was 0.07-0.11 (15-20x normal). Now it is within a few times normal.
      expect(r.p99, 'rocket p99 vs normal').toBeLessThan(Math.max(0.025, n.p99 * 5));
      expect(r.max, 'rocket worst frame').toBeLessThan(0.05);
    });
  }

  it('the rocket heading changes smoothly every sim tick (no stair-steps)', () => {
    const t = new Track(TRACKS[0]);
    const w = new World(t, t);
    w.startRace([0], 3);
    for (let i = 0; i < 60 * 3.2; i++) w.tick(() => ({ steer: 0, buttons: 0 }));
    const k = w.karts.get(0)!;
    const input = (): ControlInput => autopilot(k, t, botStyleFor(0));
    for (let i = 0; i < 360; i++) w.tick(input);
    w.items!.states.get(0)!.held = { id: 'rocket', count: 1 };
    w.tick(() => ({ steer: 0, buttons: Buttons.ITEM }));
    for (let i = 0; i < 20; i++) w.tick(input); // speed up
    let flatTicks = 0;
    let n = 0;
    let prevRate = k.yawRate;
    let worstStep = 0;
    for (let i = 0; i < 120; i++) {
      w.tick(input);
      // A tick with zero yaw rate between turning ticks is the stair-step signature.
      if (Math.abs(k.yawRate) < 0.05 && Math.abs(prevRate) > 0.5) flatTicks++;
      worstStep = Math.max(worstStep, Math.abs(k.yawRate - prevRate));
      prevRate = k.yawRate;
      n++;
    }
    expect(n).toBeGreaterThan(0);
    expect(flatTicks).toBe(0);
    expect(worstStep).toBeLessThan(0.6); // rad/s change per tick (was ~2.2)
  });
});
