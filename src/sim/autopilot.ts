/**
 * Simple computer driver ("bot"): steer toward a point a little way down the
 * centerline, ease off the gas before sharp corners. Used for bot players in
 * the lobby (handy for testing split-screen alone) and in tests.
 *
 * Deterministic: depends only on the world state.
 */
import { Buttons, type ControlInput } from '../shared/protocol';
import { KART } from './config';
import type { KartState } from './kart';
import type { Track } from './track';

export interface BotStyle {
  /** Fraction of top speed the bot aims for (lower = easier). */
  pace: number;
  /** Preferred lateral offset from the centerline (m). */
  lane: number;
  /** Aim for launch cannons that are close ahead and near this bot's line (default true; no effect on tracks without cannons). */
  useCannons?: boolean;
}

/** A different but fixed personality per slot so bots don't drive in a line. */
export function botStyleFor(slot: number): BotStyle {
  const paces = [0.95, 0.9, 0.93, 0.88];
  const lanes = [-2, 2, 0, -1];
  return { pace: paces[slot % 4], lane: lanes[slot % 4] };
}

export function autopilot(k: KartState, track: Track, style: BotStyle): ControlInput {
  const n = track.samples.length;
  const p = track.project(k.pos.x, k.pos.z, k.trackIndex);
  // A launch cannon within ~60 m ahead and roughly on our line: aim for its mouth.
  let lane = style.lane;
  if (style.useCannons !== false && track.cannons.length > 0) {
    for (const c of track.cannons) {
      const dist = track.deltaS(p.s, c.mouth.s);
      if (dist > -3 && dist < 60 && Math.abs(c.lateral - style.lane) < track.def.width * 0.45) lane = c.lateral;
    }
  }
  const lookSamples = Math.round(7 + Math.abs(k.speed) * 0.15);
  const ahead = track.samples[(p.i + lookSamples) % n];
  const tx = ahead.x + ahead.rx * lane - k.pos.x;
  const tz = ahead.z + ahead.rz * lane - k.pos.z;
  const want = Math.atan2(tx, tz);
  const err = Math.atan2(Math.sin(want - k.heading), Math.cos(want - k.heading));
  let steer = Math.max(-1, Math.min(1, -err * 3));

  // Stuck against a wall or tree beside the road (almost stopped, off the asphalt, nose pointing
  // away from where we want to go): a kart that slow can barely turn, so back up while swinging the
  // nose round (reversing steers the other way), then drive on once it points the right way again.
  if (k.speed < 2.5 && Math.abs(p.d) > track.def.width / 2 && Math.abs(err) > 0.6) {
    return { steer: -steer, buttons: Buttons.BRAKE };
  }

  // Ease off for sharp corners coming up and when above our target pace.
  let sharp = 0;
  for (let o = 5; o <= 25; o += 5) sharp = Math.max(sharp, Math.abs(track.samples[(p.i + o) % n].curvature));
  // Flat out before, on and just after every jump so we clear any gap behind it. Gapless
  // humps need no run-up, but the bot must not brake over them either (it stays on the gas
  // from 25 m before until the end of the ramp).
  const jumpAhead = track.ramps.some((r) => {
    const d = track.deltaS(p.s, r.s0); // distance to the ramp start (negative = already on/past it)
    const lookAhead = r.gap > 0 || r.shape !== 'hump' ? 80 : 25;
    const past = r.s1 - r.s0 + r.gap + 6; // stay on the gas through the ramp, the gap and the landing
    return d > -past && d < lookAhead;
  });
  const target = jumpAhead ? Infinity : KART.maxSpeed * style.pace * (sharp > 0.03 ? 0.75 : 1);
  const gas = k.speed < target;
  return { steer, buttons: gas ? Buttons.GAS : 0 };
}
