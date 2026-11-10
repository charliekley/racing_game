/**
 * Pure (no Web Audio) rules for "what should this game event sound like?".
 * Keeping this separate from the synth code means it can be unit-tested in
 * Node, where Web Audio does not exist.
 */
import type { WorldEvent } from '../sim/world';

/** Every one-shot sound the game can play. Each has a synth (synth.ts) and may be replaced by a sample file (samples.ts). */
export const SOUND_IDS = [
  'countdown', 'go', 'rocket', 'stall',
  'driftBlue', 'driftOrange', 'miniTurbo', 'boostPad', 'hop', 'land', 'trick',
  'wall', 'bump',
  'itemBox', 'rouletteTick', 'itemGet',
  'useDash', 'useSlick', 'useRicochet', 'useSeeker', 'useNova', 'useJumble',
  'hit', 'hitNova', 'blocked', 'jumbled', 'itemDestroyed',
  'cannonFire', 'cannonLand', 'fall', 'drone',
  'lap', 'finalLap', 'finishWin', 'finish', 'resultsJingle',
] as const;
export type SoundId = (typeof SOUND_IDS)[number];

/** One sound to play: which, how loud (0..1, before the bus level), and a pitch multiplier. */
export interface Cue {
  id: SoundId;
  gain: number;
  rate: number;
  slot?: number;
}

/** What the mapper needs to know about the race. */
export interface MapContext {
  isHuman: (slot: number) => boolean;
  totalLaps: number;
}

/** Bots are heard, but quieter, so the humans' own karts stay in front. */
export const BOT_GAIN = 0.35;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Loose view of the events: only the fields the mapper reads (so tests can pass plain objects). */
type Ev = WorldEvent | { kind: string; [k: string]: unknown };

/** Turn one sim event into zero or more sound cues. */
export function soundsForEvent(e: Ev, ctx: MapContext): Cue[] {
  const ev = e as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const slot: number | undefined = typeof ev.slot === 'number' ? ev.slot : undefined;
  const g = slot === undefined ? 1 : ctx.isHuman(slot) ? 1 : BOT_GAIN;
  const cue = (id: SoundId, gain = 1, rate = 1): Cue => ({ id, gain: gain * g, rate, slot });

  switch (e.kind) {
    case 'go':
      return [{ id: 'go', gain: 1, rate: 1 }];
    case 'startBoost':
      return [cue('rocket')];
    case 'stall':
      return [cue('stall')];
    case 'hop':
      return [cue('hop', 0.7)];
    case 'driftTier':
      return ev.tier === 1 ? [cue('driftBlue', 0.7)] : ev.tier === 2 ? [cue('driftOrange', 0.7)] : [];
    case 'miniTurbo':
      return [cue('miniTurbo', 0.8, ev.tier >= 2 ? 1.25 : 1)];
    case 'trick':
      return [cue('trick')];
    case 'trickBoost':
      return [cue('boostPad', 0.6, 1.2)];
    case 'boostPad':
      return [cue('boostPad')];
    case 'land': {
      const fall = Number(ev.fallSpeed) || 0;
      if (fall < 3) return []; // a drift-hop landing barely touches down
      return [cue('land', clamp01(fall / 14), 1.2 - clamp01(fall / 20) * 0.4)];
    }
    case 'wall': {
      const k = clamp01((Number(ev.impact) || 0) / 14);
      return k > 0 ? [cue('wall', 0.35 + 0.65 * k, 1.1 - k * 0.3)] : [];
    }
    case 'kart': {
      const k = clamp01((Number(ev.impact) || 0) / 10);
      return k > 0.1 ? [cue('bump', 0.3 + 0.7 * k)] : [];
    }
    case 'itemBox':
      return [cue('itemBox')];
    case 'itemGet':
      return [cue('itemGet')];
    case 'itemUse': {
      const map: Record<string, SoundId> = {
        dash: 'useDash', slick: 'useSlick', ricochet: 'useRicochet', seeker: 'useSeeker', nova: 'useNova', jumble: 'useJumble',
      };
      const id = map[String(ev.id)];
      return id ? [cue(id)] : [];
    }
    case 'hit':
      return [cue(ev.by === 'nova' ? 'hitNova' : 'hit')];
    case 'blocked':
      return [cue('blocked')];
    case 'jumbled':
      return [cue('jumbled')];
    case 'itemDestroyed':
      return [{ id: 'itemDestroyed', gain: 0.6, rate: 1 }];
    case 'cannonFire':
      return [cue('cannonFire')];
    case 'cannonLand':
      return [cue('cannonLand')];
    case 'respawn':
      return [cue('fall'), cue('drone', 0.8)];
    case 'lap': {
      // `lap` = the lap just completed; the next lap is the last one when lap + 1 === totalLaps.
      const out: Cue[] = [cue('lap')];
      if (ev.lap + 1 === ctx.totalLaps) out.push(cue('finalLap'));
      return out;
    }
    case 'finish':
      return [cue(ev.place === 1 ? 'finishWin' : 'finish')];
    default:
      return [];
  }
}

/** Countdown number (3, 2, 1) -> beep cue; the pitch is the same for all three, GO is higher. */
export function countdownCue(n: number): Cue {
  return { id: 'countdown', gain: 1, rate: n <= 1 ? 1.12 : 1 };
}

// --- Continuous sounds ------------------------------------------------------

/** Per-kart numbers the engine loops read each frame. */
export interface KartAudioState {
  slot: number;
  human: boolean;
  /** Forward speed (m/s), signed. */
  speed: number;
  boosting: boolean;
  grounded: boolean;
  /** 0 = not drifting, 1 = drifting (no sparks), 2 = blue, 3 = orange. */
  drift: number;
  /** In a cannon, being carried back after a fall, or otherwise silent. */
  silent: boolean;
  /** Item roulette is spinning. */
  rolling: boolean;
  /** -1 (left of screen) .. 1 (right): a gentle stereo position. */
  pan: number;
}

export interface EngineParams {
  /** Fundamental pitch (Hz). */
  freq: number;
  /** Low-pass cutoff (Hz): opens as the engine revs. */
  cutoff: number;
  /** Output level 0..1 (before the bot/human scale). */
  gain: number;
  /** Amount of airy noise, 0..1. */
  noise: number;
}

/** Top speed used to normalise (m/s): normal max is 28, boosted/Nova go a bit higher. */
const REF_SPEED = 30;

/** Engine pitch/brightness/level from the kart's state. A small kart motor: buzzy, revs from ~60 to ~190 Hz. */
export function engineParams(s: Pick<KartAudioState, 'speed' | 'boosting' | 'grounded' | 'silent'>): EngineParams {
  const v = clamp01(Math.abs(s.speed) / REF_SPEED);
  const rev = Math.pow(v, 0.8);
  let freq = 62 + rev * 125;
  if (s.boosting) freq *= 1.18; // rev-up under boost
  if (!s.grounded) freq *= 1.1; // wheels spin free in the air
  return {
    freq,
    cutoff: 350 + rev * 1900 + (s.boosting ? 700 : 0),
    gain: s.silent ? 0 : 0.35 + rev * 0.5,
    noise: 0.15 + rev * 0.5,
  };
}

/** Drift squeal: level and pitch by drift tier (pitch steps up at blue, again at orange). */
export function squealParams(drift: number, speed: number): { gain: number; freq: number } {
  if (drift <= 0) return { gain: 0, freq: 1800 };
  const base = drift === 1 ? 1700 : drift === 2 ? 2100 : 2600;
  return { gain: clamp01(Math.abs(speed) / 20) * 0.5, freq: base };
}

/** Stereo position for a viewport rectangle in 0..1 screen space (centre of the rect, softened). */
export function panForRect(rect: { x: number; w: number }, screenW = 1): number {
  return ((rect.x + rect.w / 2) / screenW - 0.5) * 0.5;
}
