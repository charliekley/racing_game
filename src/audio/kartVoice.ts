/**
 * The looping sounds of one kart: engine + drift squeal. The nodes are created
 * once and kept running for the whole race; every frame we only nudge their
 * parameters (pitch, filter, volume), which is very cheap.
 *
 * Engine = two detuned sawtooths + a sub square + a little filtered noise, all
 * through a low-pass filter that opens as the revs rise, with a fast tremolo
 * (the "putt-putt" of a small motor) tied to the pitch.
 */
import { engineParams, squealParams, type KartAudioState } from './mapping';

export class KartVoice {
  private oscs: OscillatorNode[] = [];
  private sawA: OscillatorNode;
  private sawB: OscillatorNode;
  private sub: OscillatorNode;
  private lfo: OscillatorNode;
  private filter: BiquadFilterNode;
  private noiseGain: GainNode;
  private level: GainNode;
  private squealFilter: BiquadFilterNode;
  private squealGain: GainNode;
  private pan: StereoPannerNode;
  private noiseSources: AudioBufferSourceNode[] = [];

  constructor(private ctx: AudioContext, dest: AudioNode, noise: AudioBuffer) {
    this.pan = ctx.createStereoPanner();
    this.pan.connect(dest);
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    this.level.connect(this.pan);

    // Tremolo gain: base 0.8, plus an LFO swinging +-0.25.
    const am = ctx.createGain();
    am.gain.value = 0.8;
    this.lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.25;
    this.lfo.connect(lfoDepth).connect(am.gain);
    am.connect(this.level);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 2.5;
    this.filter.connect(am);

    const mix = (type: OscillatorType, gain: number, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(this.filter);
      this.oscs.push(o);
      return o;
    };
    this.sawA = mix('sawtooth', 0.35, -9);
    this.sawB = mix('sawtooth', 0.3, 11);
    this.sub = mix('square', 0.22);

    // Air/exhaust hiss.
    const ns = ctx.createBufferSource();
    ns.buffer = noise;
    ns.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 900;
    nf.Q.value = 0.6;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    ns.connect(nf).connect(this.noiseGain).connect(this.filter);
    this.noiseSources.push(ns);

    // Tyre squeal: narrow band of noise, silent until drifting.
    const ss = ctx.createBufferSource();
    ss.buffer = noise;
    ss.loop = true;
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.Q.value = 9;
    this.squealFilter.frequency.value = 1800;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    ss.connect(this.squealFilter).connect(this.squealGain).connect(this.pan);
    this.noiseSources.push(ss);

    const now = ctx.currentTime;
    for (const o of [...this.oscs, this.lfo]) o.start(now);
    this.noiseSources[0].start(now, Math.random());
    this.noiseSources[1].start(now, Math.random());
  }

  /** Called every frame. `scale` is the loudness factor (humans 1, bots quieter). */
  update(s: KartAudioState, scale: number): void {
    const t = this.ctx.currentTime;
    const p = engineParams(s);
    const sq = squealParams(s.silent || !s.grounded ? 0 : s.drift, s.speed);
    const k = 0.04; // smoothing time constant (s)
    this.sawA.frequency.setTargetAtTime(p.freq, t, k);
    this.sawB.frequency.setTargetAtTime(p.freq, t, k);
    this.sub.frequency.setTargetAtTime(p.freq / 2, t, k);
    this.lfo.frequency.setTargetAtTime(p.freq / 3, t, k);
    this.filter.frequency.setTargetAtTime(p.cutoff, t, k);
    this.noiseGain.gain.setTargetAtTime(p.noise * 0.5, t, k);
    this.level.gain.setTargetAtTime(p.gain * scale, t, 0.06);
    this.squealFilter.frequency.setTargetAtTime(sq.freq, t, 0.03);
    this.squealGain.gain.setTargetAtTime(sq.gain * scale, t, 0.04);
    this.pan.pan.setTargetAtTime(s.pan, t, 0.1);
  }

  /** Stop everything and disconnect (the garbage collector does the rest). */
  dispose(): void {
    const t = this.ctx.currentTime + 0.05;
    this.level.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    this.squealGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    for (const n of [...this.oscs, this.lfo, ...this.noiseSources]) {
      try {
        n.stop(t);
      } catch {
        /* already stopped */
      }
    }
    setTimeout(() => this.pan.disconnect(), 200);
  }
}
