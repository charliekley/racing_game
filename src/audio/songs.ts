/**
 * The tunes. All original, written as text patterns for sequencer.ts
 * (see the format notes there: numbers are scale degrees, "." rest, "-" hold).
 * Each is 4 bars long and loops. One per track, plus lobby and results.
 */
import type { Song } from './sequencer';

/** Ember Peaks (volcano): D phrygian, fast and driving, buzzy saw lead. */
const ember: Song = {
  bpm: 142,
  scale: 'phrygian',
  bassRoot: 38,
  leadRoot: 62,
  swing: 0,
  leadWave: 'sawtooth',
  bass: {
    grid: 2,
    bars: ['0 0 7 0 0 7 0 7', '0 0 7 0 0 7 1 1', '-2 -2 5 -2 -2 5 -2 5', '-3 -3 4 -3 -1 -1 0 1'],
  },
  lead: {
    grid: 2,
    bars: ['4 . 5 4 3 . 1 .', '0 . 1 3 4 - - .', '5 . 4 5 7 . 5 4', '3 - 1 - 0 - . .'],
  },
  drums: ['K.h.S.h.K.hkS.ho', 'K.h.S.hhK.h.S.ho'],
};

/** Dockside Loop (harbour): G mixolydian, swung and jaunty. */
const dockside: Song = {
  bpm: 112,
  scale: 'mixolydian',
  bassRoot: 43,
  leadRoot: 67,
  swing: 0.3,
  leadWave: 'square',
  bass: {
    grid: 2,
    bars: ['0 . 4 . 0 . 4 4', '3 . 7 . 3 . 7 7', '4 . 8 . 4 . 8 .', '0 . 4 . 0 . 4 .'],
  },
  lead: {
    grid: 2,
    bars: ['2 . 4 5 4 . 2 .', '3 . 5 7 5 . 3 .', '4 . 5 4 2 . 1 .', '0 - - . 2 4 5 .'],
  },
  drums: ['K...S..hK.h.S..h', 'K...S..hK..kS.h.'],
};

/** Cloud Garden (sky islands): C lydian, floaty, with a sparkling arpeggio. */
const cloud: Song = {
  bpm: 122,
  scale: 'lydian',
  bassRoot: 36,
  leadRoot: 72,
  swing: 0.1,
  leadWave: 'triangle',
  bass: {
    grid: 2,
    bars: ['0 . 4 . 0 . 4 .', '3 . 7 . 3 . 7 .', '5 . 9 . 5 . 9 .', '1 . 5 . 4 . 1 .'],
  },
  lead: {
    grid: 2,
    bars: ['4 . 6 . 8 . 6 4', '7 - 6 4 2 . . .', '8 . 9 8 6 . 4 .', '6 - 4 - 2 - . .'],
  },
  arp: {
    grid: 1,
    bars: ['0 2 4 2 0 2 4 2 3 5 7 5 3 5 7 5', '2 4 6 4 2 4 6 4 1 3 5 3 1 3 5 3'],
  },
  drums: ['k...h.h.s...h.ho', 'k...h.h.s.k.h.ho'],
};

/** Switchback Summit (snowy mountain): A minor, steady and crisp, bell-like pluck lead. */
const summit: Song = {
  bpm: 128,
  scale: 'minor',
  bassRoot: 45,
  leadRoot: 69,
  swing: 0,
  leadWave: 'square',
  bass: {
    grid: 2,
    bars: ['0 . 0 4 0 . 4 7', '5 . 5 . 5 . 4 .', '3 . 3 . 3 . 4 .', '4 . 4 . 4 . 6 .'],
  },
  lead: {
    grid: 2,
    bars: ['7 . 9 . 7 . 4 .', '5 . 7 . 5 . 4 .', '2 - 4 - 2 . 0 .', '1 . 2 . 4 - - .'],
  },
  drums: ['K..hS..hK.hhS..h', 'K..hS.hhK..hS.oh'],
};

/** Lobby: C major, relaxed and friendly. */
const lobby: Song = {
  bpm: 96,
  scale: 'major',
  bassRoot: 36,
  leadRoot: 72,
  swing: 0.2,
  leadWave: 'triangle',
  bass: {
    grid: 2,
    bars: ['0 . 4 . 0 . 4 .', '5 . 9 . 5 . 9 .', '3 . 7 . 3 . 7 .', '4 . 8 . 4 . 8 .'],
  },
  lead: {
    grid: 2,
    bars: ['4 . 2 . 4 5 4 .', '5 . 4 . 2 . . .', '3 . 4 5 4 . 2 .', '1 . 2 . 0 - - .'],
  },
  drums: ['k...h...s...h...', 'k...h..hs...h.h.'],
};

/** Results: a calm, content loop. */
const results: Song = {
  bpm: 84,
  scale: 'pentatonic',
  bassRoot: 43,
  leadRoot: 67,
  swing: 0.15,
  leadWave: 'triangle',
  bass: {
    grid: 4,
    bars: ['0 . 2 .', '3 . 2 .'],
  },
  lead: {
    grid: 2,
    bars: ['4 . 2 . 0 - . .', '2 . 3 4 2 - - .'],
  },
  drums: ['k...h...s...h...'],
};

export type MusicId = 'lobby' | 'results' | 'ember' | 'dockside' | 'cloud' | 'summit';

export const SONGS: Record<MusicId, Song> = { lobby, results, ember, dockside, cloud, summit };

/** Track name (from src/track) -> its tune. Unknown (dev) tracks get a default by index. */
const BY_TRACK_NAME: Record<string, MusicId> = {
  'Ember Peaks': 'ember',
  'Dockside Loop': 'dockside',
  'Cloud Garden': 'cloud',
  'Switchback Summit': 'summit',
};
const RACE_TUNES: MusicId[] = ['ember', 'dockside', 'cloud', 'summit'];

export function musicForTrack(name: string, index = 0): MusicId {
  return BY_TRACK_NAME[name] ?? RACE_TUNES[Math.abs(index) % RACE_TUNES.length];
}
