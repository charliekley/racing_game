/**
 * A tiny step sequencer, as pure data + functions (no Web Audio here).
 *
 * A song is a loop of 16th-note steps. Each melodic voice is a text pattern:
 * space-separated tokens, each lasting `grid` steps:
 *   "."  rest      "-"  hold the previous note      a number = scale degree
 * (0 = the root, 7 = the root one octave up, -1 = the note just below the root...).
 * Drums are one character per step: k kick, s snare, h closed hat, o open hat,
 * K kick+hat, S snare+hat, "." nothing. A short pattern loops to fill the song.
 */

export type ScaleName = 'major' | 'minor' | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'pentatonic';

export const SCALES: Record<ScaleName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonic: [0, 2, 4, 7, 9], // 5 notes: degree 5 is the root an octave up
};

export interface VoicePattern {
  /** Steps per token (2 = eighth notes when a step is a 16th). */
  grid: number;
  /** One string per bar (16 steps), tokens separated by spaces. */
  bars: string[];
}

export interface Song {
  /** Beats per minute (a beat = 4 steps). */
  bpm: number;
  scale: ScaleName;
  /** MIDI note of degree 0 for each voice. */
  bassRoot: number;
  leadRoot: number;
  /** Swing: delay of every second 16th, as a fraction of a step (0 = straight). */
  swing: number;
  bass: VoicePattern;
  lead: VoicePattern;
  /** Optional soft arpeggio voice using the same format (plays at the lead's root). */
  arp?: VoicePattern;
  /** Drum pattern: one string per bar (16 chars); loops. */
  drums: string[];
  /** Lead waveform. */
  leadWave: OscillatorType;
}

export type VoiceName = 'bass' | 'lead' | 'arp' | 'kick' | 'snare' | 'hat' | 'openHat';

export interface NoteEvent {
  /** Absolute step number (can exceed the song length: the song loops). */
  step: number;
  voice: VoiceName;
  /** MIDI note (0 for drums). */
  midi: number;
  /** Length in steps. */
  dur: number;
}

/** Number of 16th-note steps in a song (bars * 16). */
export function songSteps(song: Song): number {
  const bars = Math.max(song.bass.bars.length, song.lead.bars.length, song.arp?.bars.length ?? 0, song.drums.length);
  return bars * 16;
}

/** Degree (may be negative or > 6) -> MIDI note in the scale. */
export function degreeToMidi(root: number, scale: ScaleName, degree: number): number {
  const iv = SCALES[scale];
  const n = iv.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return root + oct * 12 + iv[idx];
}

export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

interface Parsed {
  /** Step within the pattern where the note starts. */
  step: number;
  degree: number;
  dur: number;
}

const parseCache = new WeakMap<VoicePattern, Parsed[]>();
/** Parse a voice pattern into notes (start, degree, duration; holds merged). Cached per pattern object. */
export function parseVoice(p: VoicePattern): Parsed[] {
  const hit = parseCache.get(p);
  if (hit) return hit;
  const out: Parsed[] = [];
  p.bars.forEach((bar, b) => {
    bar
      .trim()
      .split(/\s+/)
      .forEach((tok, i) => {
        const step = b * 16 + i * p.grid;
        if (tok === '.') return;
        if (tok === '-') {
          if (out.length) out[out.length - 1].dur += p.grid;
          return;
        }
        const degree = Number(tok);
        if (!Number.isNaN(degree)) out.push({ step, degree, dur: p.grid });
      });
  });
  parseCache.set(p, out);
  return out;
}

/**
 * All note events whose step is in [from, to) (absolute steps; the song loops).
 * The engine calls this with a small lookahead window every ~50 ms.
 */
export function notesBetween(song: Song, from: number, to: number): NoteEvent[] {
  const total = songSteps(song);
  const out: NoteEvent[] = [];
  const voices: [VoiceName, VoicePattern, number][] = [
    ['bass', song.bass, song.bassRoot],
    ['lead', song.lead, song.leadRoot],
  ];
  if (song.arp) voices.push(['arp', song.arp, song.leadRoot]);
  for (let step = Math.ceil(from); step < to; step++) {
    const local = ((step % total) + total) % total;
    for (const [voice, pat, root] of voices) {
      const ls = local % (pat.bars.length * 16); // shorter patterns repeat
      for (const n of parseVoice(pat)) {
        if (n.step === ls) out.push({ step, voice, midi: degreeToMidi(root, song.scale, n.degree), dur: n.dur });
      }
    }
    const dl = song.drums.length * 16;
    const ch = song.drums[Math.floor((local % dl) / 16)][local % 16] ?? '.';
    if (ch === 'k' || ch === 'K') out.push({ step, voice: 'kick', midi: 0, dur: 1 });
    if (ch === 's' || ch === 'S') out.push({ step, voice: 'snare', midi: 0, dur: 1 });
    if (ch === 'h' || ch === 'K' || ch === 'S') out.push({ step, voice: 'hat', midi: 0, dur: 1 });
    if (ch === 'o') out.push({ step, voice: 'openHat', midi: 0, dur: 1 });
  }
  return out;
}

/** Seconds per step at a tempo multiplier (1.15 on the final lap). */
export function stepSeconds(song: Song, tempoMul = 1): number {
  return 60 / (song.bpm * tempoMul) / 4;
}

/** Time offset (s) of a step due to swing: odd 16ths are pushed late. */
export function swingOffset(song: Song, step: number, stepSec: number): number {
  return step % 2 === 1 ? song.swing * stepSec : 0;
}
