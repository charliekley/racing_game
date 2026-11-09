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
  const steer = Math.max(-1, Math.min(1, -err * 3));

  // Ease off for sharp corners coming up and when above our target pace.
  let sharp = 0;
  for (let o = 5; o <= 25; o += 5) sharp = Math.max(sharp, Math.abs(track.samples[(p.i + o) % n].curvature));
  // Flat out before a jump so we clear any water gap behind it.
  const jumpAhead = track.ramps.some((r) => {
    const d = track.deltaS(p.s, r.s0);
    return d > -2 && d < 80;
  });
  const target = jumpAhead ? Infinity : KART.maxSpeed * style.pace * (sharp > 0.03 ? 0.75 : 1);
  const gas = k.speed < target;
  return { steer, buttons: gas ? Buttons.GAS : 0 };
}
