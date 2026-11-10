import { describe, expect, it } from 'vitest';
import { BOT_GAIN, countdownCue, engineParams, panForRect, soundsForEvent, squealParams, SOUND_IDS } from './mapping';
import { SYNTHS } from './synth';

const ctx = { isHuman: (s: number) => s === 0, totalLaps: 3 };
const ids = (e: object) => soundsForEvent(e as never, ctx).map((c) => c.id);

describe('soundsForEvent', () => {
  it('maps simple events to their sounds', () => {
    expect(ids({ kind: 'go' })).toEqual(['go']);
    expect(ids({ kind: 'startBoost', slot: 0 })).toEqual(['rocket']);
    expect(ids({ kind: 'cannonFire', slot: 0, cannon: 0 })).toEqual(['cannonFire']);
    expect(ids({ kind: 'respawn', slot: 0 })).toEqual(['fall', 'drone']);
  });

  it('uses a different sound per item and per hit type', () => {
    const used = ['dash', 'slick', 'ricochet', 'seeker', 'nova', 'jumble'].map((id) => ids({ kind: 'itemUse', slot: 0, id })[0]);
    expect(new Set(used).size).toBe(6);
    expect(ids({ kind: 'hit', slot: 0, by: 'nova', attacker: 1 })).toEqual(['hitNova']);
    expect(ids({ kind: 'hit', slot: 0, by: 'slick', attacker: 1 })).toEqual(['hit']);
  });

  it('steps the drift sound at blue and orange, silent for tier 0', () => {
    expect(ids({ kind: 'driftTier', slot: 0, tier: 0 })).toEqual([]);
    expect(ids({ kind: 'driftTier', slot: 0, tier: 1 })).toEqual(['driftBlue']);
    expect(ids({ kind: 'driftTier', slot: 0, tier: 2 })).toEqual(['driftOrange']);
  });

  it('scales wall hits and landings by impact', () => {
    const soft = soundsForEvent({ kind: 'wall', slot: 0, impact: 4 }, ctx)[0];
    const hard = soundsForEvent({ kind: 'wall', slot: 0, impact: 14 }, ctx)[0];
    expect(hard.gain).toBeGreaterThan(soft.gain);
    expect(ids({ kind: 'land', slot: 0, fallSpeed: 0.5 })).toEqual([]);
    const small = soundsForEvent({ kind: 'land', slot: 0, fallSpeed: 4 }, ctx)[0];
    const big = soundsForEvent({ kind: 'land', slot: 0, fallSpeed: 12 }, ctx)[0];
    expect(big.gain).toBeGreaterThan(small.gain);
  });

  it('adds the FINAL LAP sting only when the last lap begins', () => {
    expect(ids({ kind: 'lap', slot: 0, lap: 1, lapTime: 30 })).toEqual(['lap']);
    expect(ids({ kind: 'lap', slot: 0, lap: 2, lapTime: 30 })).toEqual(['lap', 'finalLap']);
  });

  it('plays the winner fanfare only for 1st place', () => {
    expect(ids({ kind: 'finish', slot: 0, place: 1, time: 90 })).toEqual(['finishWin']);
    expect(ids({ kind: 'finish', slot: 0, place: 3, time: 90 })).toEqual(['finish']);
  });

  it('makes bots quieter than humans', () => {
    const human = soundsForEvent({ kind: 'boostPad', slot: 0 }, ctx)[0];
    const bot = soundsForEvent({ kind: 'boostPad', slot: 2 }, ctx)[0];
    expect(bot.gain).toBeCloseTo(human.gain * BOT_GAIN);
  });

  it('ignores events with no sound and unknown events', () => {
    expect(ids({ kind: 'done' })).toEqual([]);
    expect(ids({ kind: 'driftEnd', slot: 0 })).toEqual([]);
  });

  it('slipstream, combo and perfect start have cues; the per-tick charge event only sounds once', () => {
    expect(ids({ kind: 'slipBoost', slot: 0 })).toEqual(['slipBoost']);
    expect(ids({ kind: 'combo', slot: 0 })).toEqual(['combo']);
    expect(ids({ kind: 'perfectStart', slot: 0 })).toEqual(['perfect']);
    expect(ids({ kind: 'slipCharge', slot: 0, progress: 0.01 })).toEqual(['slipStart']); // the first tick of a charge
    expect(ids({ kind: 'slipCharge', slot: 0, progress: 0.5 })).toEqual([]);
    expect(ids({ kind: 'slipCharge', slot: 0, progress: 0 })).toEqual([]);
  });

  it('every sound id has a synth, and every cue returns a known id', () => {
    for (const id of SOUND_IDS) expect(typeof SYNTHS[id]).toBe('function');
    expect(Object.keys(SYNTHS).sort()).toEqual([...SOUND_IDS].sort());
  });

  it('GO countdown beep is higher than 3-2', () => {
    expect(countdownCue(1).rate).toBeGreaterThan(countdownCue(3).rate);
  });
});

describe('continuous sound parameters', () => {
  const base = { speed: 0, boosting: false, grounded: true, silent: false };
  it('pitch, brightness and level rise with speed', () => {
    const slow = engineParams({ ...base, speed: 3 });
    const fast = engineParams({ ...base, speed: 28 });
    expect(fast.freq).toBeGreaterThan(slow.freq);
    expect(fast.cutoff).toBeGreaterThan(slow.cutoff);
    expect(fast.gain).toBeGreaterThan(slow.gain);
  });
  it('revs up under boost and is silent when told to be', () => {
    expect(engineParams({ ...base, speed: 28, boosting: true }).freq).toBeGreaterThan(engineParams({ ...base, speed: 28 }).freq);
    expect(engineParams({ ...base, silent: true }).gain).toBe(0);
  });
  it('squeal is silent unless drifting and steps up by tier', () => {
    expect(squealParams(0, 25).gain).toBe(0);
    expect(squealParams(2, 25).freq).toBeGreaterThan(squealParams(1, 25).freq);
    expect(squealParams(3, 25).freq).toBeGreaterThan(squealParams(2, 25).freq);
  });
  it('pans viewports gently left/right', () => {
    expect(panForRect({ x: 0, w: 0.5 })).toBeLessThan(0);
    expect(panForRect({ x: 0.5, w: 0.5 })).toBeGreaterThan(0);
    expect(panForRect({ x: 0, w: 1 })).toBeCloseTo(0);
  });
});
