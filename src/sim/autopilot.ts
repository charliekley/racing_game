/**
 * Simple computer driver ("bot"): steer toward a point a little way down the
 * centerline, ease off the gas before sharp corners. Used for bot players in
 * the lobby (handy for testing split-screen alone) and in tests.
 *
 * Deterministic: depends only on the world state.
 */
import { Buttons, type ControlInput } from '../shared/protocol';
import { KART, type KartConfig } from './config';
import type { KartState } from './kart';
import type { Track } from './track';

export interface BotStyle {
  /** Fraction of top speed the bot aims for (lower = easier). */
  pace: number;
  /** Preferred lateral offset from the centerline (m). */
  lane: number;
  /** Aim for launch cannons that are close ahead and near this bot's line (default true; no effect on tracks without cannons). */
  useCannons?: boolean;
  /**
   * 0..1: how much this bot likes shortcuts. Above 0.5 it takes every shortcut it comes to,
   * otherwise it stays on the main road. Fixed per slot, so races stay deterministic.
   * (No effect on tracks without shortcuts.)
   */
  shortcutBias?: number;
  /** Corner speed: fraction of the target speed kept before sharp corners (default 0.75). Higher = brave. */
  cornerSpeed?: number;
  /** Curvature (1/m) above which the next stretch counts as a sharp corner (default 0.03). */
  cornerCurvature?: number;
  /** Steering gain: how hard the bot turns per radian of heading error (default 3). */
  steerGain?: number;
  /** Share (0..1+) of the track's `botTuning.wander` this bot uses (default 1; the better the bot, the less it sways). */
  wanderScale?: number;
}

/** A bot starts steering for a shortcut this far (m) before the junction. */
const SHORTCUT_APPROACH = 50;

/** A different but fixed personality per slot so bots don't drive in a line. */
export function botStyleFor(slot: number): BotStyle {
  const paces = [0.95, 0.9, 0.93, 0.88];
  const lanes = [-2, 2, 0, -1];
  const shortcutBias = [0.9, 0.2, 0.7, 0.4]; // slots 0 and 2 take shortcuts
  return { pace: paces[slot % 4], lane: lanes[slot % 4], shortcutBias: shortcutBias[slot % 4] };
}

/** `c` is this kart's own physics (a bot in a faster kart aims for a higher speed). */
export function autopilot(k: KartState, track: Track, style: BotStyle, c: KartConfig = KART): ControlInput {
  let p = track.project(k.pos.x, k.pos.z, k.trackIndex);
  // Which road we steer along: (route, position on it). Normally where the kart is projected.
  let route = p.route;
  let at = p.i;
  let atFork = false; // steering for a shortcut junction: take it at corner speed
  if (track.branches.length > 0) {
    const wants = (style.shortcutBias ?? 0) > 0.5;
    if (route > 0 && !wants && at <= (track.branches[route - 1].def.deck ? 60 : 30)) {
      // Where the roads overlap, a bot that doesn't want the shortcut ignores the branch.
      p = track.projectOnMain(k.pos.x, k.pos.z);
      route = 0;
      at = p.i;
    } else if (route === 0 && wants) {
      // Approaching (or just past) a junction of a branch we like: steer along the branch.
      for (const b of track.branches) {
        const dist = track.deltaS(p.s, b.s0);
        // (A deck fork is a Y whose arms overlap for a while: keep steering for the branch until it has taken the kart.)
        if (dist > (b.def.deck ? -90 : -30) && dist < SHORTCUT_APPROACH) {
          route = b.route;
          at = Math.round(-dist / track.spacing); // negative = still on the main road before the fork
          atFork = b.def.surface !== 'road'; // (a hard-packed branch is taken at full speed)
          break;
        }
      }
    }
  }
  // A launch cannon within ~60 m ahead and roughly on our line: aim for its mouth.
  let lane = style.lane;
  // A track may ask for a slowly swaying line (Rainbow Route): bots do not hit every boost pad, like people. It is off
  // around every ramp (a kart in the air cannot steer back), on branches and before the cannon, where the line has to be exact.
  const wander = (track.def.botTuning?.wander ?? 0) * (style.wanderScale ?? 1);
  if (wander > 0 && route === 0) {
    const exact = track.ramps.some((r) => track.deltaS(p.s, r.s0) > -40 && track.deltaS(p.s, r.s0) < (r.gap > 0 ? 90 : r.s1 - r.s0 + 30)) || track.cannons.some((cn) => track.deltaS(p.s, cn.mouth.s) > -80 && track.deltaS(p.s, cn.mouth.s) < 5);
    if (!exact) {
      const edge = track.def.width / 2 - 3; // (never closer to the rail-less edge than 3 m)
      lane = Math.max(-edge, Math.min(edge, lane + wander * Math.sin(p.s * 0.043)));
    }
  }
  if (style.useCannons !== false && track.cannons.length > 0) {
    for (const c of track.cannons) {
      const dist = track.deltaS(p.s, c.mouth.s);
      if (dist > -3 && dist < 60 && Math.abs(c.lateral - style.lane) < track.def.width * 0.45) lane = c.lateral;
    }
  }
  const lookSamples = Math.round(7 + Math.abs(k.speed) * 0.15);
  const ahead = track.sampleAhead(route, at, lookSamples);
  // A branch is narrower than the main road: keep our lane inside it.
  if (route > 0) lane = Math.max(-1, Math.min(1, lane));
  const tx = ahead.x + ahead.rx * lane - k.pos.x;
  const tz = ahead.z + ahead.rz * lane - k.pos.z;
  const want = Math.atan2(tx, tz);
  const err = Math.atan2(Math.sin(want - k.heading), Math.cos(want - k.heading));
  let steer = Math.max(-1, Math.min(1, -err * (style.steerGain ?? 3)));

  // Stuck against a wall or tree beside the road (almost stopped, off the asphalt, nose pointing
  // away from where we want to go): a kart that slow can barely turn, so back up while swinging the
  // nose round (reversing steers the other way), then drive on once it points the right way again.
  if (k.speed < 2.5 && Math.abs(p.d) > track.def.width / 2 && Math.abs(err) > 0.6) {
    return { steer: -steer, buttons: Buttons.BRAKE };
  }

  // Ease off for sharp corners coming up and when above our target pace.
  let sharp = 0;
  for (let o = 5; o <= 25; o += 5) sharp = Math.max(sharp, Math.abs(track.sampleAhead(route, at, o).curvature));
  // Flat out before, on and just after every jump so we clear any gap behind it. Gapless
  // humps need no run-up, but the bot must not brake over them either (it stays on the gas
  // from 25 m before until the end of the ramp).
  const jumpAhead = track.ramps.some((r) => {
    const d = track.deltaS(p.s, r.s0); // distance to the ramp start (negative = already on/past it)
    const lookAhead = r.gap > 0 || r.shape !== 'hump' ? 80 : 25;
    const past = r.s1 - r.s0 + r.gap + 6; // stay on the gas through the ramp, the gap and the landing
    return d > -past && d < lookAhead;
  });
  // Corner speed is limited by how hard the kart can turn, not by its top speed (v = turn rate / curvature):
  // so it scales with the kart's handling (turnRateHigh relative to the stock kart), and a bullet-shaped
  // low-handling kart must lift more than a nimble one, like a human would. A bot never takes a corner
  // faster than its straight-line pace.
  const handling = c.turnRateHigh / KART.turnRateHigh;
  const cornering = sharp > (style.cornerCurvature ?? track.def.botTuning?.cornerCurvature ?? 0.03) || atFork;
  const straight = c.maxSpeed * style.pace * (track.def.botTuning?.pace ?? 1);
  const target = jumpAhead ? Infinity : cornering ? Math.min(straight, KART.maxSpeed * style.pace * (track.def.botTuning?.pace ?? 1) * (style.cornerSpeed ?? 0.75) * handling) : straight;
  const gas = k.speed < target;
  return { steer, buttons: gas ? Buttons.GAS : 0 };
}
