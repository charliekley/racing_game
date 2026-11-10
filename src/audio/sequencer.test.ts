import { describe, expect, it } from 'vitest';
import { degreeToMidi, midiToFreq, notesBetween, parseVoice, songSteps, stepSeconds, swingOffset } from './sequencer';
import { musicForTrack, SONGS } from './songs';
import { TRACKS } from '../track';

describe('scale maths', () => {
  it('maps degrees to MIDI notes across octaves', () => {
    expect(degreeToMidi(60, 'major', 0)).toBe(60);
    expect(degreeToMidi(60, 'major', 2)).toBe(64);
    expect(degreeToMidi(60, 'major', 7)).toBe(72);
    expect(degreeToMidi(60, 'major', -1)).toBe(59);
    expect(degreeToMidi(60, 'pentatonic', 5)).toBe(72);
  });
  it('converts MIDI to Hz', () => {
    expect(midiToFreq(69)).toBeCloseTo(440);
    expect(midiToFreq(57)).toBeCloseTo(220);
  });
});

describe('parseVoice', () => {
  it('handles rests, holds and bar offsets', () => {
    const p = parseVoice({ grid: 2, bars: ['0 . 2 - 4 . . .', '1 - - - . . . .'] });
    expect(p).toEqual([
      { step: 0, degree: 0, dur: 2 },
      { step: 4, degree: 2, dur: 4 },
      { step: 8, degree: 4, dur: 2 },
      { step: 16, degree: 1, dur: 8 },
    ]);
  });
});

describe('notesBetween', () => {
  const song = SONGS.ember;
  it('returns each step once and the song loops', () => {
    const total = songSteps(song);
    const a = notesBetween(song, 0, 16);
    const b = notesBetween(song, total, total + 16);
    expect(a.length).toBeGreaterThan(0);
    expect(b.map((n) => ({ ...n, step: n.step - total }))).toEqual(a);
  });
  it('splitting a window gives the same notes as one big window', () => {
    const whole = notesBetween(song, 0, 32);
    const parts = [...notesBetween(song, 0, 7), ...notesBetween(song, 7, 19), ...notesBetween(song, 19, 32)];
    expect(parts).toEqual(whole);
  });
  it('has drums on the downbeat', () => {
    const first = notesBetween(song, 0, 1).map((n) => n.voice);
    expect(first).toContain('kick');
    expect(first).toContain('bass');
  });
});

describe('timing', () => {
  it('final lap tempo is 15% faster', () => {
    const s = SONGS.dockside;
    expect(stepSeconds(s, 1) / stepSeconds(s, 1.15)).toBeCloseTo(1.15);
  });
  it('swing delays only odd steps', () => {
    expect(swingOffset(SONGS.dockside, 0, 0.1)).toBe(0);
    expect(swingOffset(SONGS.dockside, 1, 0.1)).toBeGreaterThan(0);
  });
});

describe('songs', () => {
  it('every song parses, loops and has all voices', () => {
    for (const [id, song] of Object.entries(SONGS)) {
      const voices = new Set(notesBetween(song, 0, songSteps(song)).map((n) => n.voice));
      expect(voices.has('bass'), id).toBe(true);
      expect(voices.has('lead'), id).toBe(true);
      expect(voices.has('kick'), id).toBe(true);
      for (const bar of [...song.bass.bars, ...song.lead.bars]) {
        const tokens = bar.trim().split(/\s+/).length;
        expect(tokens * (song.bass.bars.includes(bar) ? song.bass.grid : song.lead.grid), id).toBe(16);
      }
    }
  });
  it('each track has its own tune with its own tempo', () => {
    const tunes = TRACKS.map((t, i) => musicForTrack(t.name, i));
    expect(new Set(tunes).size).toBe(TRACKS.length);
    expect(new Set(tunes.map((id) => SONGS[id].bpm)).size).toBe(TRACKS.length);
  });
});
