/**
 * The looping sounds of the karts.
 *
 * WHY THIS FILE IS CAREFUL ABOUT COST (the "choppy with 12 racers" fix):
 * every Web Audio node costs CPU on the audio thread, which must deliver a
 * block of 128 samples about 345 times a second. If one block is late the
 * speakers get a gap: a click or stutter. The old design gave EVERY kart a
 * full voice (~19 nodes: 4 oscillators, 2 noise loops, 3 filters, ...) and
 * rewrote ~12 parameters per kart on every frame. With 12 karts that was
 * ~230 live nodes and ~140 parameter events per frame.
 *
 * Now:
 *   - Human karts (the people playing) get a FULL voice (`KartVoice`, rich).
 *   - Only the few bots nearest to a human get a LITE voice (4 nodes).
 *   - Everyone else shares ONE cheap "pack" rumble (`PackRumble`) whose
 *     loudness follows how many karts are out there.
 *   - Parameters are only written when they changed noticeably, and the
 *     engine calls us at ~30 Hz, not every frame.
 *   - All changes use `setTargetAtTime` (an exponential glide to the new
 *     value), so there are no sudden jumps ("zipper noise") between updates.
 */
import { engineParams, squealParams, type KartAudioState } from './mapping';

/** Glide time constant (s) for pitch/filter changes; a bit longer than the 33 ms update period so steps blend together. */
const GLIDE = 0.05;

/** Writes a smoothed parameter target, but only if it moved by more than `eps` (relative) since the last write. */
class Smooth {
  private last = NaN;
  constructor(private param: AudioParam, private tau: number, private eps = 0.01, private absEps = 0.002) {}
  set(v: number, t: number): void {
    if (Math.abs(v - this.last) <= Math.max(this.absEps, Math.abs(this.last) * this.eps)) return;
    this.last = v;
    this.param.setTargetAtTime(v, t, this.tau);
  }
}

/** Common interface so the engine can treat full and lite voices alike. */
export interface EngineVoice {
  update(s: KartAudioState, scale: number): void;
  dispose(): void;
  /** Approximate number of Web Audio nodes this voice keeps alive (for the stats/tests). */
  readonly nodeCount: number;
}

/**
 * Full voice (for human karts): two detuned sawtooths + a sub square + a
 * little filtered noise through a low-pass filter that opens as the revs rise,
 * a tremolo (the "putt-putt" of a small motor) and a tyre squeal.
 * (About 19 nodes; there are at most 4 of these, one per player.)
 */
export class KartVoice implements EngineVoice {
  readonly nodeCount = 19;
  private oscs: OscillatorNode[] = [];
  private noiseSources: AudioBufferSourceNode[] = [];
  private lfo: OscillatorNode;
  private pan: StereoPannerNode;
  private level: GainNode;
  private p: Record<'a' | 'b' | 'sub' | 'lfo' | 'cut' | 'noise' | 'level' | 'sqF' | 'sqG' | 'pan', Smooth>;

  constructor(private ctx: AudioContext, dest: AudioNode, noise: AudioBuffer) {
    this.pan = ctx.createStereoPanner();
    this.pan.connect(dest);
    const level = (this.level = ctx.createGain());
    level.gain.value = 0;
    level.connect(this.pan);

    // Tremolo gain: base 0.8, plus an LFO swinging +-0.25.
    const am = ctx.createGain();
    am.gain.value = 0.8;
    this.lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.25;
    this.lfo.connect(lfoDepth).connect(am.gain);
    am.connect(level);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    filter.connect(am);

    const mix = (type: OscillatorType, gain: number, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(filter);
      this.oscs.push(o);
      return o;
    };
    const sawA = mix('sawtooth', 0.35, -9);
    const sawB = mix('sawtooth', 0.3, 11);
    const sub = mix('square', 0.22);

    // Air/exhaust hiss.
    const ns = ctx.createBufferSource();
    ns.buffer = noise;
    ns.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 900;
    nf.Q.value = 0.6;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    ns.connect(nf).connect(noiseGain).connect(filter);
    this.noiseSources.push(ns);

    // Tyre squeal: narrow band of noise, silent until drifting.
    const ss = ctx.createBufferSource();
    ss.buffer = noise;
    ss.loop = true;
    const squealFilter = ctx.createBiquadFilter();
    squealFilter.type = 'bandpass';
    squealFilter.Q.value = 9;
    squealFilter.frequency.value = 1800;
    const squealGain = ctx.createGain();
    squealGain.gain.value = 0;
    ss.connect(squealFilter).connect(squealGain).connect(this.pan);
    this.noiseSources.push(ss);

    this.p = {
      a: new Smooth(sawA.frequency, GLIDE),
      b: new Smooth(sawB.frequency, GLIDE),
      sub: new Smooth(sub.frequency, GLIDE),
      lfo: new Smooth(this.lfo.frequency, GLIDE),
      cut: new Smooth(filter.frequency, GLIDE),
      noise: new Smooth(noiseGain.gain, GLIDE),
      level: new Smooth(level.gain, 0.08),
      sqF: new Smooth(squealFilter.frequency, 0.04),
      sqG: new Smooth(squealGain.gain, 0.05),
      pan: new Smooth(this.pan.pan, 0.15, 0.01, 0.02),
    };

    const now = ctx.currentTime;
    for (const o of [...this.oscs, this.lfo]) o.start(now);
    this.noiseSources[0].start(now, Math.random());
    this.noiseSources[1].start(now, Math.random());
  }

  /** `scale` is the loudness factor (humans 1). */
  update(s: KartAudioState, scale: number): void {
    const t = this.ctx.currentTime;
    const e = engineParams(s);
    const sq = squealParams(s.silent || !s.grounded ? 0 : s.drift, s.speed);
    this.p.a.set(e.freq, t);
    this.p.b.set(e.freq, t);
    this.p.sub.set(e.freq / 2, t);
    this.p.lfo.set(e.freq / 3, t);
    this.p.cut.set(e.cutoff, t);
    this.p.noise.set(e.noise * 0.5, t);
    this.p.level.set(e.gain * scale, t);
    this.p.sqF.set(sq.freq, t);
    this.p.sqG.set(sq.gain * scale, t);
    this.p.pan.set(s.pan, t);
  }

  /** Stop and disconnect (the garbage collector does the rest). */
  dispose(): void {
    // Fade out over ~50 ms (an instant cut would click), then stop the sources and unplug.
    const t = this.ctx.currentTime;
    this.level.gain.cancelScheduledValues(t);
    this.level.gain.setTargetAtTime(0, t, 0.015);
    const squeal = this.p.sqG;
    squeal.set(0, t);
    for (const n of [...this.oscs, this.lfo, ...this.noiseSources]) {
      try {
        n.stop(t + 0.15);
      } catch {
        /* already stopped */
      }
    }
    setTimeout(() => this.pan.disconnect(), 250);
  }
}

/** Cheap voice for a bot near a human: one sawtooth through a low-pass, a gain and a panner (4 nodes). */
export class LiteVoice implements EngineVoice {
  readonly nodeCount = 4;
  private osc: OscillatorNode;
  private out: GainNode;
  private p: Record<'f' | 'cut' | 'level', Smooth>;

  constructor(private ctx: AudioContext, dest: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1;
    filter.connect(this.out);
    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc.connect(filter);
    this.osc.start(ctx.currentTime);
    this.p = {
      f: new Smooth(this.osc.frequency, GLIDE * 1.5),
      cut: new Smooth(filter.frequency, GLIDE * 1.5),
      level: new Smooth(this.out.gain, 0.1),
    };
  }

  update(s: KartAudioState, scale: number): void {
    const t = this.ctx.currentTime;
    const e = engineParams(s);
    this.p.f.set(e.freq, t);
    this.p.cut.set(e.cutoff * 0.6, t); // duller than a human's engine: it is "over there"
    this.p.level.set(e.gain * scale, t);
  }

  dispose(): void {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, 0.015);
    try {
      this.osc.stop(t + 0.15);
    } catch {
      /* already stopped */
    }
    setTimeout(() => this.out.disconnect(), 250);
  }
}

/**
 * One shared, constant "pack" rumble standing in for all the karts that have no voice of their own:
 * a low sawtooth plus low-passed noise. Its loudness follows how many karts it represents and how fast they go.
 */
export class PackRumble {
  readonly nodeCount = 5;
  private osc: OscillatorNode;
  private src: AudioBufferSourceNode;
  private level: Smooth;
  private pitch: Smooth;
  private out: GainNode;

  constructor(private ctx: AudioContext, dest: AudioNode, noise: AudioBuffer) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.connect(this.out);
    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc.frequency.value = 80;
    this.osc.connect(filter);
    this.src = ctx.createBufferSource();
    this.src.buffer = noise;
    this.src.loop = true;
    this.src.connect(filter);
    this.osc.start();
    this.src.start(0, Math.random());
    this.level = new Smooth(this.out.gain, 0.3, 0.02, 0.002);
    this.pitch = new Smooth(this.osc.frequency, 0.3, 0.02);
  }

  /** `count` karts represented, `avgRev` their mean speed 0..1. */
  update(count: number, avgRev: number): void {
    const t = this.ctx.currentTime;
    // Grows with sqrt(count): ten karts are not ten times louder than one.
    this.level.set(count > 0 ? Math.min(1, Math.sqrt(count) * 0.2) * (0.4 + 0.6 * avgRev) : 0, t);
    this.pitch.set(70 + avgRev * 50, t);
  }

  dispose(): void {
    this.out.disconnect();
    for (const n of [this.osc, this.src]) {
      try {
        n.stop(this.ctx.currentTime + 0.05);
      } catch {
        /* already stopped */
      }
    }
  }
}
