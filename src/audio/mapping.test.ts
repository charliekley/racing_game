import { describe, expect, it } from 'vitest';
import { BOT_GAIN, botEngineGain, MAX_BOT_VOICES, planVoices, type VoiceKind, countdownCue, engineParams, panForRect, soundsForEvent, squealParams, SOUND_IDS } from './mapping';
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
    const used = ['dash', 'slick', 'ricochet', 'seeker', 'nova', 'jumble', 'storm', 'rocket'].map((id) => ids({ kind: 'itemUse', slot: 0, id })[0]);
    expect(new Set(used).size).toBe(8);
    expect(ids({ kind: 'hit', slot: 0, by: 'nova', attacker: 1 })).toEqual(['hitNova']);
    expect(ids({ kind: 'hit', slot: 0, by: 'slick', attacker: 1 })).toEqual(['hit']);
    expect(ids({ kind: 'itemUse', slot: 0, id: 'storm' })).toEqual(['useStorm']);
    expect(ids({ kind: 'itemUse', slot: 0, id: 'rocket' })).toEqual(['useRocket']);
    // Storm: a "zap" for each victim and no extra spin-out sound; a Rocket knock-aside sounds like a Nova hit; squash has its own.
    expect(ids({ kind: 'shrunk', slot: 0, attacker: 1 })).toEqual(['zap']);
    expect(ids({ kind: 'hit', slot: 0, by: 'storm', attacker: 1 })).toEqual([]);
    expect(ids({ kind: 'hit', slot: 0, by: 'rocket', attacker: 1 })).toEqual(['hitNova']);
    expect(ids({ kind: 'squashed', slot: 0, by: 1 })).toEqual(['squash']);
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

  it('hazard warnings and eruptions are heard only when a human kart is near', () => {
    const warn = (near: number[], type = 'geyser') => ids({ kind: 'hazardWarn', hazard: 0, type, near });
    const fire = (near: number[], type = 'geyser') => ids({ kind: 'hazardFire', hazard: 0, type, near });
    expect(warn([0])).toEqual(['hazardWarn']); // slot 0 is the human
    expect(fire([0, 2])).toEqual(['geyser']);
    expect(warn([2, 3])).toEqual([]); // only bots nearby: silent
    expect(fire([])).toEqual([]);
    // Each kind has its own sound.
    expect(warn([0], 'drawbridge')).toEqual(['bridgeBell']);
    expect(fire([0], 'drawbridge')).toEqual(['bridgeMove']);
    expect(warn([0], 'gust')).toEqual(['gust']);
    expect(warn([0], 'roller')).toEqual(['roller']);
    // The cue pans toward the human who is near.
    expect(soundsForEvent({ kind: 'hazardWarn', hazard: 0, type: 'geyser', near: [2, 0] } as never, ctx)[0].slot).toBe(0);
  });

  it('being hit by a hazard is heard by the human who was hit, not for bots', () => {
    expect(ids({ kind: 'hazardHit', slot: 0, hazard: 1, type: 'geyser' })).toEqual(['hazardHit']);
    expect(ids({ kind: 'hazardHit', slot: 2, hazard: 1, type: 'geyser' })).toEqual([]);
  });

  it('snowball and drawbridge hits have their own sounds (not the lava sizzle)', () => {
    expect(ids({ kind: 'hazardHit', slot: 0, hazard: 1, type: 'roller' })).toEqual(['hitSnow']);
    expect(ids({ kind: 'hazardHit', slot: 0, hazard: 1, type: 'drawbridge' })).toEqual(['hitWater']);
    expect(ids({ kind: 'hazardHit', slot: 0, hazard: 1, type: 'beetle' })).toEqual(['hitBeetle']);
    expect(ids({ kind: 'hazardHit', slot: 2, hazard: 1, type: 'roller' })).toEqual([]); // bots hit: silent
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

describe('engine voice planning (12 racers)', () => {
  const karts = (humans: number, total: number) =>
    Array.from({ length: total }, (_, i) => ({ slot: i, human: i < humans, dist: i < humans ? 0 : 10 + i * 7 }));

  it('gives humans full voices, the nearest few bots lite voices, the rest the shared pack', () => {
    const plan = planVoices(karts(1, 12), new Map());
    const count = (k: VoiceKind) => [...plan.values()].filter((v) => v === k).length;
    expect(count('full')).toBe(1);
    expect(count('lite')).toBe(MAX_BOT_VOICES);
    expect(count('pack')).toBe(12 - 1 - MAX_BOT_VOICES);
    expect([1, 2, 3].every((s) => plan.get(s) === 'lite')).toBe(true); // the nearest bots
  });
  it('four humans in split screen still cap the voices', () => {
    const plan = planVoices(karts(4, 12), new Map());
    expect([...plan.values()].filter((v) => v !== 'pack').length).toBe(4 + MAX_BOT_VOICES);
  });
  it('keeps a lite voice when another bot is only slightly closer (no flip-flopping)', () => {
    const ks = karts(1, 6);
    ks[4].dist = 40; // currently pack
    ks[3].dist = 42; // currently lite
    ks[1].dist = 10;
    ks[2].dist = 11;
    const plan = planVoices(ks, new Map<number, VoiceKind>([[3, 'lite']]));
    expect(plan.get(3)).toBe('lite');
  });
  it('bot engines are far quieter than a human and fade with distance', () => {
    expect(botEngineGain(0)).toBeLessThanOrEqual(0.25);
    expect(botEngineGain(60)).toBeLessThan(botEngineGain(5));
    expect(botEngineGain(Infinity)).toBe(0);
  });
});
