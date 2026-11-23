import { describe, expect, it } from 'vitest';
import { KartVoice, LiteVoice, PackRumble } from './kartVoice';
import { botEngineGain, planVoices, type KartAudioState } from './mapping';

/**
 * A fake AudioContext that only counts what is created and how often parameters are written.
 * (Web Audio does not exist in Node; this is enough to check the cost of the engine sounds.)
 */
function fakeCtx() {
  const counts = { nodes: 0, paramWrites: 0 };
  const param = () => ({
    value: 0,
    setTargetAtTime: () => counts.paramWrites++,
    setValueAtTime: () => counts.paramWrites++,
    cancelScheduledValues: () => undefined,
  });
  const node = (): Record<string, unknown> => {
    counts.nodes++;
    const n: Record<string, unknown> = {
      connect: (d: unknown) => d,
      disconnect: () => undefined,
      start: () => undefined,
      stop: () => undefined,
      type: '',
      loop: false,
      buffer: null,
    };
    for (const k of ['gain', 'frequency', 'detune', 'Q', 'pan']) n[k] = param();
    return n;
  };
  const ctx = {
    currentTime: 0,
    createGain: node,
    createOscillator: node,
    createBiquadFilter: node,
    createStereoPanner: node,
    createBufferSource: node,
  };
  return { ctx: ctx as unknown as AudioContext, counts };
}

const dest = {} as AudioNode;
const noise = {} as AudioBuffer;

function kartsAt(n: number, humans: number): KartAudioState[] {
  return Array.from({ length: n }, (_, i) => ({
    slot: i, human: i < humans, speed: 10 + i, boosting: false, grounded: true, drift: 0, silent: false, rolling: false,
    pan: 0, dist: i < humans ? 0 : 15 + i * 9,
  }));
}

/** Run `frames` frames at 60 fps the way AudioEngine does (voice updates at 30 Hz). */
function simulate(n: number, humans: number, frames: number) {
  const { ctx, counts } = fakeCtx();
  const plan = planVoices(kartsAt(n, humans), new Map());
  const voices = new Map<number, KartVoice | LiteVoice>();
  const pack = new PackRumble(ctx, dest, noise);
  for (const [slot, kind] of plan) {
    if (kind === 'full') voices.set(slot, new KartVoice(ctx, dest, noise));
    if (kind === 'lite') voices.set(slot, new LiteVoice(ctx, dest));
  }
  const built = counts.nodes;
  counts.paramWrites = 0;
  for (let f = 0; f < frames; f++) {
    if (f % 2) continue; // 30 Hz
    const karts = kartsAt(n, humans).map((k) => ({ ...k, speed: 10 + 8 * Math.sin(f / 20 + k.slot) }));
    for (const k of karts) voices.get(k.slot)?.update(k, k.human ? 1 : botEngineGain(k.dist));
    pack.update(karts.filter((k) => plan.get(k.slot) === 'pack').length, 0.5);
  }
  return { built, writesPerFrame: counts.paramWrites / frames };
}

describe('engine voice cost with 12 racers', () => {
  it('stays small: far fewer nodes and parameter writes than one full voice per kart', () => {
    // The old design: 12 full voices (19 nodes each) and ~12 writes per kart on every frame.
    const oldNodes = 12 * 19;
    const oldWrites = 12 * 12;
    const one = simulate(12, 1, 120);
    const four = simulate(12, 4, 120);
    expect(one.built).toBeLessThanOrEqual(oldNodes / 3);
    expect(four.built).toBeLessThanOrEqual(oldNodes / 2);
    expect(one.writesPerFrame).toBeLessThanOrEqual(oldWrites / 4);
    // Report the numbers (visible with `vitest --reporter=verbose` / in failures).
    console.info(`12 racers: 1 human -> ${one.built} nodes, ${one.writesPerFrame.toFixed(1)} param writes/frame; 4 humans -> ${four.built} nodes, ${four.writesPerFrame.toFixed(1)} writes/frame (old: ${oldNodes} nodes, ${oldWrites} writes/frame)`);
  });
  it('does not write parameters when nothing changed', () => {
    const { ctx, counts } = fakeCtx();
    const v = new LiteVoice(ctx, dest);
    const k = kartsAt(1, 0)[0];
    v.update(k, 0.2);
    const after = counts.paramWrites;
    for (let i = 0; i < 10; i++) v.update(k, 0.2);
    expect(counts.paramWrites).toBe(after);
  });
});
