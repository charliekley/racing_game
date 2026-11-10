/**
 * All the one-shot sounds, built from oscillators and filtered noise with the
 * Web Audio API. Each function schedules a short burst of nodes starting at
 * time `t` and returns its length in seconds. The nodes stop themselves; once
 * they have finished they are garbage collected, so there is nothing to clean up.
 *
 * Web Audio in one paragraph: sound is a graph. A source node (an oscillator
 * or a buffer of noise) is connected through processing nodes (filter, gain =
 * volume) to a destination. Parameters like `gain.value` or `frequency` can be
 * scheduled to change over time (ramps), which is how we draw volume envelopes
 * and pitch sweeps.
 */
import type { SoundId } from './mapping';
import { midiToFreq, type VoiceName } from './sequencer';

/** What every synth function needs: the context, where to send sound, and a shared noise buffer. */
export interface SynthEnv {
  ctx: BaseAudioContext;
  out: AudioNode;
  noise: AudioBuffer;
}

const FLOOR = 0.0001; // exponential ramps cannot reach 0

interface ToneOpts {
  type?: OscillatorType;
  f0: number;
  /** End frequency (Hz); omit for a steady pitch. */
  f1?: number;
  dur: number;
  gain: number;
  /** Attack time (s). */
  a?: number;
  /** Low-pass cutoff (Hz) if you want it duller. */
  cutoff?: number;
  /** Vibrato: depth (Hz) and rate (Hz). */
  vib?: [number, number];
  /** Detune in cents. */
  detune?: number;
}

/** One oscillator with a pitch sweep and a plucky volume envelope. */
export function tone(env: SynthEnv, t: number, o: ToneOpts): void {
  const { ctx } = env;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(Math.max(20, o.f0), t);
  if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
  if (o.detune) osc.detune.value = o.detune;
  const g = ctx.createGain();
  const a = o.a ?? 0.005;
  g.gain.setValueAtTime(FLOOR, t);
  g.gain.linearRampToValueAtTime(Math.max(FLOOR, o.gain), t + a);
  g.gain.exponentialRampToValueAtTime(FLOOR, t + o.dur);
  let node: AudioNode = osc;
  if (o.cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.cutoff;
    osc.connect(f);
    node = f;
  }
  node.connect(g).connect(env.out);
  if (o.vib) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = o.vib[1];
    const depth = ctx.createGain();
    depth.gain.value = o.vib[0];
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + o.dur + 0.05);
  }
  osc.start(t);
  osc.stop(t + o.dur + 0.05);
}

interface NoiseOpts {
  dur: number;
  gain: number;
  filter?: BiquadFilterType;
  f0?: number;
  f1?: number;
  q?: number;
  /** Attack (s). */
  a?: number;
}

/** A burst of filtered noise with an optional filter sweep. */
export function noiseBurst(env: SynthEnv, t: number, o: NoiseOpts): void {
  const { ctx } = env;
  const src = ctx.createBufferSource();
  src.buffer = env.noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.filter ?? 'bandpass';
  f.frequency.setValueAtTime(o.f0 ?? 1000, t);
  if (o.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
  f.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  const a = o.a ?? 0.004;
  g.gain.setValueAtTime(FLOOR, t);
  g.gain.linearRampToValueAtTime(Math.max(FLOOR, o.gain), t + a);
  g.gain.exponentialRampToValueAtTime(FLOOR, t + o.dur);
  src.connect(f).connect(g).connect(env.out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + o.dur + 0.05);
}

/** Several notes: [frequency, start offset, length]. */
function notes(env: SynthEnv, t: number, list: [number, number, number][], type: OscillatorType, gain: number, cutoff?: number): void {
  for (const [f, s, d] of list) tone(env, t + s, { type, f0: f, dur: d, gain, cutoff });
}

type SynthFn = (env: SynthEnv, t: number, gain: number, rate: number) => number;

/** The synth for every SoundId. `gain` is 0..1, `rate` multiplies pitch. Returns the sound's length (s). */
export const SYNTHS: Record<SoundId, SynthFn> = {
  countdown: (e, t, g, r) => {
    tone(e, t, { type: 'square', f0: 440 * r, dur: 0.28, gain: 0.25 * g, cutoff: 3000 });
    tone(e, t, { type: 'sine', f0: 220 * r, dur: 0.28, gain: 0.3 * g });
    return 0.3;
  },
  go: (e, t, g) => {
    tone(e, t, { type: 'square', f0: 880, dur: 0.7, gain: 0.25 * g, cutoff: 4000, a: 0.01 });
    tone(e, t, { type: 'square', f0: 1320, dur: 0.7, gain: 0.15 * g, cutoff: 4000, a: 0.01 });
    tone(e, t, { type: 'sine', f0: 440, dur: 0.7, gain: 0.3 * g });
    return 0.75;
  },
  rocket: (e, t, g) => {
    noiseBurst(e, t, { dur: 0.7, gain: 0.5 * g, f0: 300, f1: 3500, q: 1.2, a: 0.05 });
    tone(e, t, { type: 'sawtooth', f0: 80, f1: 420, dur: 0.7, gain: 0.25 * g, cutoff: 1500, a: 0.05 });
    return 0.75;
  },
  stall: (e, t, g) => {
    // Sputtering: a few falling coughs.
    [0, 0.12, 0.26, 0.45].forEach((s, i) => tone(e, t + s, { type: 'sawtooth', f0: 130 - i * 20, f1: 50, dur: 0.1, gain: 0.3 * g, cutoff: 500 }));
    noiseBurst(e, t, { dur: 0.6, gain: 0.12 * g, filter: 'lowpass', f0: 600, f1: 150 });
    return 0.7;
  },
  driftBlue: (e, t, g) => {
    tone(e, t, { type: 'triangle', f0: 1400, f1: 2100, dur: 0.12, gain: 0.3 * g });
    noiseBurst(e, t, { dur: 0.1, gain: 0.2 * g, filter: 'highpass', f0: 5000 });
    return 0.15;
  },
  driftOrange: (e, t, g) => {
    tone(e, t, { type: 'triangle', f0: 1900, f1: 2900, dur: 0.14, gain: 0.3 * g });
    tone(e, t + 0.07, { type: 'triangle', f0: 2500, f1: 3500, dur: 0.12, gain: 0.25 * g });
    noiseBurst(e, t, { dur: 0.14, gain: 0.22 * g, filter: 'highpass', f0: 6000 });
    return 0.2;
  },
  miniTurbo: (e, t, g, r) => {
    noiseBurst(e, t, { dur: 0.4, gain: 0.45 * g, f0: 500 * r, f1: 2800 * r, q: 1.5 });
    tone(e, t, { type: 'sawtooth', f0: 150 * r, f1: 560 * r, dur: 0.4, gain: 0.22 * g, cutoff: 2000 });
    return 0.45;
  },
  boostPad: (e, t, g, r) => {
    tone(e, t, { type: 'sawtooth', f0: 220 * r, f1: 880 * r, dur: 0.35, gain: 0.22 * g, cutoff: 2500 });
    tone(e, t + 0.05, { type: 'square', f0: 330 * r, f1: 1320 * r, dur: 0.3, gain: 0.1 * g, cutoff: 3000 });
    noiseBurst(e, t, { dur: 0.35, gain: 0.25 * g, f0: 800, f1: 4000, q: 1 });
    return 0.4;
  },
  hop: (e, t, g) => {
    tone(e, t, { type: 'sine', f0: 280, f1: 620, dur: 0.12, gain: 0.35 * g });
    return 0.15;
  },
  land: (e, t, g, r) => {
    tone(e, t, { type: 'sine', f0: 140 * r, f1: 45, dur: 0.22, gain: 0.7 * g });
    noiseBurst(e, t, { dur: 0.14, gain: 0.35 * g, filter: 'lowpass', f0: 700, f1: 200 });
    return 0.25;
  },
  trick: (e, t, g) => {
    notes(e, t, [[660, 0, 0.12], [880, 0.05, 0.12], [1100, 0.1, 0.12], [1320, 0.15, 0.25]], 'triangle', 0.22 * g);
    noiseBurst(e, t + 0.15, { dur: 0.2, gain: 0.12 * g, filter: 'highpass', f0: 6000 });
    return 0.45;
  },
  wall: (e, t, g, r) => {
    noiseBurst(e, t, { dur: 0.25, gain: 0.55 * g, filter: 'lowpass', f0: 1200 * r, f1: 200, q: 0.7 });
    tone(e, t, { type: 'sine', f0: 100 * r, f1: 40, dur: 0.22, gain: 0.6 * g });
    return 0.3;
  },
  bump: (e, t, g) => {
    tone(e, t, { type: 'sine', f0: 170, f1: 70, dur: 0.15, gain: 0.5 * g });
    noiseBurst(e, t, { dur: 0.08, gain: 0.25 * g, f0: 1500, q: 1 });
    return 0.2;
  },
  itemBox: (e, t, g) => {
    tone(e, t, { type: 'sine', f0: 700, f1: 1500, dur: 0.18, gain: 0.3 * g });
    tone(e, t + 0.08, { type: 'sine', f0: 1050, f1: 2100, dur: 0.2, gain: 0.25 * g });
    return 0.3;
  },
  rouletteTick: (e, t, g, r) => {
    tone(e, t, { type: 'square', f0: 1000 * r, dur: 0.03, gain: 0.12 * g, cutoff: 3500 });
    return 0.05;
  },
  itemGet: (e, t, g) => {
    notes(e, t, [[523, 0, 0.15], [659, 0.07, 0.15], [784, 0.14, 0.15], [1047, 0.21, 0.35]], 'triangle', 0.3 * g);
    return 0.6;
  },
  useDash: (e, t, g) => {
    noiseBurst(e, t, { dur: 0.45, gain: 0.45 * g, f0: 400, f1: 3500, q: 1.2 });
    tone(e, t, { type: 'sawtooth', f0: 160, f1: 700, dur: 0.4, gain: 0.2 * g, cutoff: 2200 });
    return 0.5;
  },
  useSlick: (e, t, g) => {
    noiseBurst(e, t, { dur: 0.2, gain: 0.35 * g, filter: 'lowpass', f0: 1200, f1: 250 });
    tone(e, t, { type: 'sine', f0: 320, f1: 90, dur: 0.22, gain: 0.45 * g });
    return 0.25;
  },
  useRicochet: (e, t, g) => {
    tone(e, t, { type: 'square', f0: 1100, f1: 320, dur: 0.16, gain: 0.25 * g, cutoff: 3500 });
    noiseBurst(e, t, { dur: 0.05, gain: 0.2 * g, filter: 'highpass', f0: 3000 });
    return 0.2;
  },
  useSeeker: (e, t, g) => {
    tone(e, t, { type: 'sine', f0: 500, f1: 1600, dur: 0.3, gain: 0.3 * g, vib: [60, 22] });
    tone(e, t + 0.28, { type: 'triangle', f0: 1800, dur: 0.12, gain: 0.2 * g });
    return 0.42;
  },
  useNova: (e, t, g) => {
    notes(e, t, [[262, 0, 0.5], [330, 0.04, 0.5], [392, 0.08, 0.5], [523, 0.12, 0.6]], 'sawtooth', 0.12 * g, 2500);
    tone(e, t, { type: 'sine', f0: 300, f1: 1400, dur: 0.6, gain: 0.3 * g });
    noiseBurst(e, t + 0.1, { dur: 0.6, gain: 0.18 * g, filter: 'highpass', f0: 4000 });
    return 0.75;
  },
  useJumble: (e, t, g) => {
    noiseBurst(e, t, { dur: 0.5, gain: 0.35 * g, filter: 'highpass', f0: 2500, q: 0.7 });
    tone(e, t, { type: 'sine', f0: 240, f1: 180, dur: 0.5, gain: 0.25 * g, vib: [50, 14] });
    return 0.55;
  },
  hit: (e, t, g) => {
    // Spun out: a falling, wobbling whistle plus a thump.
    tone(e, t, { type: 'sawtooth', f0: 700, f1: 120, dur: 0.7, gain: 0.25 * g, cutoff: 1800, vib: [80, 16] });
    tone(e, t, { type: 'sine', f0: 120, f1: 45, dur: 0.25, gain: 0.55 * g });
    noiseBurst(e, t, { dur: 0.15, gain: 0.3 * g, f0: 1200, q: 0.8 });
    return 0.75;
  },
  hitNova: (e, t, g) => {
    noiseBurst(e, t, { dur: 0.3, gain: 0.5 * g, filter: 'lowpass', f0: 2500, f1: 200 });
    tone(e, t, { type: 'square', f0: 330, f1: 70, dur: 0.35, gain: 0.3 * g, cutoff: 1500 });
    tone(e, t, { type: 'sine', f0: 100, f1: 35, dur: 0.3, gain: 0.6 * g });
    return 0.4;
  },
  blocked: (e, t, g) => {
    tone(e, t, { type: 'triangle', f0: 1800, dur: 0.18, gain: 0.3 * g });
    tone(e, t, { type: 'triangle', f0: 2700, dur: 0.12, gain: 0.2 * g });
    noiseBurst(e, t, { dur: 0.04, gain: 0.25 * g, filter: 'highpass', f0: 4000 });
    return 0.22;
  },
  jumbled: (e, t, g) => {
    // Woozy: two slightly detuned sines wobbling down.
    tone(e, t, { type: 'sine', f0: 520, f1: 330, dur: 0.6, gain: 0.25 * g, vib: [40, 9] });
    tone(e, t, { type: 'sine', f0: 540, f1: 340, dur: 0.6, gain: 0.2 * g, vib: [40, 11] });
    return 0.65;
  },
  itemDestroyed: (e, t, g) => {
    noiseBurst(e, t, { dur: 0.15, gain: 0.35 * g, f0: 2000, q: 0.8 });
    tone(e, t, { type: 'square', f0: 600, f1: 200, dur: 0.1, gain: 0.15 * g, cutoff: 2500 });
    return 0.2;
  },
  cannonFire: (e, t, g) => {
    noiseBurst(e, t, { dur: 0.7, gain: 0.7 * g, filter: 'lowpass', f0: 1800, f1: 90, q: 0.7 });
    tone(e, t, { type: 'sine', f0: 130, f1: 28, dur: 0.6, gain: 0.8 * g });
    tone(e, t + 0.05, { type: 'sawtooth', f0: 400, f1: 900, dur: 0.5, gain: 0.1 * g, cutoff: 1500 });
    return 0.75;
  },
  cannonLand: (e, t, g) => {
    tone(e, t, { type: 'sine', f0: 110, f1: 35, dur: 0.4, gain: 0.8 * g });
    noiseBurst(e, t, { dur: 0.3, gain: 0.5 * g, filter: 'lowpass', f0: 800, f1: 150 });
    return 0.45;
  },
  fall: (e, t, g) => {
    tone(e, t, { type: 'sine', f0: 900, f1: 120, dur: 0.8, gain: 0.35 * g });
    tone(e, t, { type: 'triangle', f0: 600, f1: 80, dur: 0.8, gain: 0.2 * g });
    return 0.85;
  },
  drone: (e, t, g) => {
    // The rescue drone: a buzzing rotor that fades in and out over ~2 s.
    const { ctx } = e;
    const dur = 2.2;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.linearRampToValueAtTime(95, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    const am = ctx.createGain();
    am.gain.value = 0.6;
    const lfo = ctx.createOscillator(); // rotor flutter
    lfo.frequency.value = 22;
    const depth = ctx.createGain();
    depth.gain.value = 0.4;
    lfo.connect(depth).connect(am.gain);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(FLOOR, t);
    g2.gain.linearRampToValueAtTime(0.25 * g, t + 0.3);
    g2.gain.setValueAtTime(0.25 * g, t + dur - 0.5);
    g2.gain.exponentialRampToValueAtTime(FLOOR, t + dur);
    osc.connect(f).connect(am).connect(g2).connect(e.out);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
    noiseBurst(e, t, { dur, gain: 0.08 * g, f0: 900, q: 2, a: 0.3 });
    return dur;
  },
  lap: (e, t, g) => {
    notes(e, t, [[880, 0, 0.2], [1175, 0.12, 0.35]], 'triangle', 0.35 * g);
    return 0.5;
  },
  finalLap: (e, t, g) => {
    // A short rising sting that ends on a held, bright chord.
    notes(e, t, [[392, 0, 0.12], [494, 0.1, 0.12], [587, 0.2, 0.12], [784, 0.3, 0.12]], 'square', 0.16 * g, 3500);
    notes(e, t + 0.45, [[784, 0, 0.7], [988, 0, 0.7], [1175, 0, 0.7]], 'sawtooth', 0.1 * g, 3000);
    return 1.2;
  },
  finishWin: (e, t, g) => {
    const seq: [number, number, number][] = [[523, 0, 0.14], [523, 0.16, 0.14], [523, 0.32, 0.14], [659, 0.48, 0.3], [784, 0.8, 0.14], [1047, 0.96, 0.9]];
    notes(e, t, seq, 'square', 0.16 * g, 3500);
    notes(e, t, seq.map(([f, s, d]) => [f / 2, s, d] as [number, number, number]), 'sawtooth', 0.12 * g, 1800);
    notes(e, t + 0.96, [[1319, 0, 0.9], [1568, 0, 0.9]], 'triangle', 0.15 * g);
    return 2;
  },
  finish: (e, t, g) => {
    notes(e, t, [[392, 0, 0.18], [330, 0.2, 0.18], [262, 0.4, 0.6]], 'square', 0.14 * g, 2500);
    notes(e, t + 0.4, [[330, 0, 0.6], [392, 0, 0.6]], 'triangle', 0.15 * g);
    return 1.1;
  },
  resultsJingle: (e, t, g) => {
    notes(e, t, [[523, 0, 0.2], [659, 0.12, 0.2], [784, 0.24, 0.2], [1047, 0.36, 0.2], [1319, 0.48, 0.7]], 'triangle', 0.3 * g);
    return 1.3;
  },
};

// --- Music voices ------------------------------------------------------------

export interface MusicStyle {
  leadWave: OscillatorType;
}

/** Play one drum hit or note of the background music. `dur` is in seconds. */
export function musicNote(env: SynthEnv, t: number, voice: VoiceName, midi: number, dur: number, style: MusicStyle): void {
  const f = midiToFreq(midi);
  switch (voice) {
    case 'kick':
      tone(env, t, { f0: 150, f1: 42, dur: 0.16, gain: 0.9 });
      break;
    case 'snare':
      noiseBurst(env, t, { dur: 0.13, gain: 0.5, f0: 1800, q: 0.8 });
      tone(env, t, { type: 'triangle', f0: 220, f1: 130, dur: 0.1, gain: 0.35 });
      break;
    case 'hat':
      noiseBurst(env, t, { dur: 0.04, gain: 0.18, filter: 'highpass', f0: 7500 });
      break;
    case 'openHat':
      noiseBurst(env, t, { dur: 0.16, gain: 0.18, filter: 'highpass', f0: 7000 });
      break;
    case 'bass':
      tone(env, t, { type: 'sawtooth', f0: f, dur: Math.max(0.1, dur * 0.95), gain: 0.5, cutoff: 700, a: 0.01 });
      tone(env, t, { type: 'square', f0: f / 2, dur: Math.max(0.1, dur * 0.95), gain: 0.35, cutoff: 400, a: 0.01 });
      break;
    case 'lead':
      tone(env, t, { type: style.leadWave, f0: f, dur: Math.max(0.12, dur * 1.05), gain: 0.3, cutoff: 3200, a: 0.012, vib: [f * 0.006, 5.5] });
      tone(env, t, { type: style.leadWave, f0: f, dur: Math.max(0.12, dur * 1.05), gain: 0.15, cutoff: 3200, a: 0.012, detune: 8 });
      break;
    case 'arp':
      tone(env, t, { type: 'triangle', f0: f, dur: 0.22, gain: 0.14 });
      break;
  }
}
