/**
 * AudioEngine: owns the one AudioContext and wires everything together.
 *
 *   engine voices --> engineBus --\
 *   one-shot sounds -> sfxBus -----+--> master --> compressor --> speakers
 *   music ----------> musicBus ----/
 *
 * Browsers refuse to make sound until the user has interacted with the page,
 * so the AudioContext is created on the first key press / click / gamepad
 * button. Until then (and if Web Audio is missing) every method does nothing.
 */
import { BOT_GAIN, countdownCue, soundsForEvent, type Cue, type KartAudioState, type MapContext, type SoundId } from './mapping';
import { KartVoice } from './kartVoice';
import { SampleBank } from './samples';
import { notesBetween, stepSeconds, swingOffset, type Song } from './sequencer';
import { SONGS, type MusicId } from './songs';
import { musicNote, SYNTHS, type SynthEnv } from './synth';
import type { WorldEvent } from '../sim/world';

const MUTE_KEY = 'tiltkart.muted';
const MUSIC_VOL_KEY = 'tiltkart.musicVol';
/** Default bus levels. */
const LEVELS = { engine: 0.5, sfx: 0.9, music: 0.32 };
/** At most this many one-shots at once; quiet ones are dropped when it is full. */
const MAX_ONE_SHOTS = 28;
/** Music tempo multiplier on the final lap. */
export const FINAL_LAP_TEMPO = 1.15;

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage can be blocked */
  }
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private failed = false;
  private master!: GainNode;
  private engineBus!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private analyser!: AnalyserNode;
  private noise!: AudioBuffer;
  private samples: SampleBank | null = null;
  private voices = new Map<number, KartVoice>();
  private rollTimers = new Map<number, number>();
  private activeEnds: number[] = [];
  private muteIcon: HTMLElement | null = null;

  muted = readStore(MUTE_KEY) === '1';
  musicVolume = (() => {
    const v = parseFloat(readStore(MUSIC_VOL_KEY) ?? '');
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  })();

  // Music sequencer state.
  private musicId: MusicId | null = null;
  private song: Song | null = null;
  private songGain: GainNode | null = null;
  private nextStep = 0;
  private nextStepTime = 0;
  private tempoMul = 1;
  private scheduler: ReturnType<typeof setInterval> | null = null;
  private wantedMusic: MusicId | null = null;

  /** Counters for debugging/verification (read through `window.__game.audio.stats`). */
  readonly stats = { oneShots: 0, skipped: 0, musicNotes: 0, kartVoices: 0 };

  constructor() {
    this.updateMuteIcon();
    const unlock = () => this.unlock();
    for (const type of ['keydown', 'pointerdown', 'touchstart'] as const) {
      window.addEventListener(type, unlock, { passive: true });
    }
    // Gamepad buttons fire no events: poll until the audio is unlocked.
    const poll = setInterval(() => {
      if (this.ctx) return clearInterval(poll);
      const pads = navigator.getGamepads?.() ?? [];
      if (pads.some((p) => p?.buttons.some((b) => b.pressed))) this.unlock();
    }, 250);
    window.addEventListener('keydown', (e) => {
      if (e.repeat || (e.target instanceof HTMLInputElement)) return;
      if (e.code === 'KeyM') this.toggleMute();
      if (e.code === 'BracketLeft') this.setMusicVolume(this.musicVolume - 0.2);
      if (e.code === 'BracketRight') this.setMusicVolume(this.musicVolume + 0.2);
    });
  }

  // --- Setup -------------------------------------------------------------------

  /** Create (or resume) the AudioContext. Safe to call any time, any number of times. */
  unlock(): void {
    if (this.failed) return;
    try {
      if (!this.ctx) this.build();
      if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    } catch {
      this.failed = true; // no Web Audio: stay silent
      return;
    }
    if (this.wantedMusic && !this.musicId) this.playMusic(this.wantedMusic);
  }

  private build(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error('no Web Audio');
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;

    // Master chain: gain (mute) -> compressor (a limiter, so 4 karts never clip) -> out.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.master.connect(comp).connect(ctx.destination);
    comp.connect(this.analyser);

    const bus = (level: number) => {
      const g = ctx.createGain();
      g.gain.value = level;
      g.connect(this.master);
      return g;
    };
    this.engineBus = bus(LEVELS.engine);
    this.sfxBus = bus(LEVELS.sfx);
    this.musicBus = bus(LEVELS.music * this.musicVolume);

    // Two seconds of white noise, shared by every noise source.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.samples = new SampleBank(ctx);
  }

  /** Is the context up and running (after a user gesture)? */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  private env(out: AudioNode): SynthEnv {
    return { ctx: this.ctx!, out, noise: this.noise };
  }

  // --- One-shot effects --------------------------------------------------------

  /** Play a cue now (or after `delay` seconds). */
  playCue(cue: Cue, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || cue.gain <= 0.01) return;
    const t = ctx.currentTime + 0.01 + delay;
    this.activeEnds = this.activeEnds.filter((end) => end > ctx.currentTime);
    if (this.activeEnds.length >= MAX_ONE_SHOTS && cue.gain < 0.6) {
      this.stats.skipped++;
      return;
    }
    const sample = this.samples?.get(cue.id);
    let dur: number;
    if (sample) {
      const src = ctx.createBufferSource();
      src.buffer = sample;
      src.playbackRate.value = cue.rate;
      const g = ctx.createGain();
      g.gain.value = cue.gain;
      src.connect(g).connect(this.sfxBus);
      src.start(t);
      dur = sample.duration / cue.rate;
    } else {
      dur = SYNTHS[cue.id](this.env(this.sfxBus), t, cue.gain, cue.rate);
    }
    this.activeEnds.push(t + dur);
    this.stats.oneShots++;
  }

  play(id: SoundId, gain = 1, rate = 1): void {
    this.playCue({ id, gain, rate });
  }

  /** Feed sim events (from Game.handleEvents). */
  handleEvents(events: WorldEvent[], ctx: MapContext): void {
    if (!this.ctx) return;
    for (const e of events) {
      for (const cue of soundsForEvent(e, ctx)) this.playCue(cue);
    }
  }

  /** Countdown beep for 3, 2 or 1 (GO comes from the 'go' event). */
  countdown(n: number): void {
    this.playCue(countdownCue(n));
  }

  /** The results fanfare, then the calm results loop. */
  results(): void {
    this.play('resultsJingle');
    this.playMusic('results');
  }

  // --- Per-frame loops (engines, drift squeal, item roulette) -------------------

  update(dt: number, karts: KartAudioState[]): void {
    if (!this.ctx || !this.running) return;
    const seen = new Set<number>();
    for (const k of karts) {
      seen.add(k.slot);
      let v = this.voices.get(k.slot);
      if (!v) {
        v = new KartVoice(this.ctx, this.engineBus, this.noise);
        this.voices.set(k.slot, v);
      }
      v.update(k, k.human ? 1 : BOT_GAIN + 0.1);

      // Roulette: tick faster as it rolls. Only for people, bots are silent about it.
      if (k.rolling && k.human) {
        const left = (this.rollTimers.get(k.slot) ?? 0) - dt;
        if (left <= 0) {
          this.play('rouletteTick', 1, 0.9 + Math.random() * 0.25);
          this.rollTimers.set(k.slot, 0.075);
        } else this.rollTimers.set(k.slot, left);
      } else this.rollTimers.delete(k.slot);
    }
    for (const [slot, v] of this.voices) {
      if (!seen.has(slot)) {
        v.dispose();
        this.voices.delete(slot);
      }
    }
    this.stats.kartVoices = this.voices.size;
  }

  /** Silence all kart loops (e.g. when leaving the race). */
  stopKarts(): void {
    for (const v of this.voices.values()) v.dispose();
    this.voices.clear();
    this.rollTimers.clear();
    this.stats.kartVoices = 0;
  }

  // --- Music -------------------------------------------------------------------

  /** Start a tune (restarts if it is already playing a different one). Null stops the music. */
  playMusic(id: MusicId | null): void {
    this.wantedMusic = id; // remembered in case the context is not unlocked yet
    if (!this.ctx) return;
    if (id === this.musicId) return;
    this.fadeOutSong();
    this.musicId = id;
    if (!id) return this.stopScheduler();
    this.song = SONGS[id];
    this.tempoMul = 1;
    this.nextStep = 0;
    this.nextStepTime = this.ctx.currentTime + 0.08;
    this.songGain = this.ctx.createGain();
    this.songGain.connect(this.musicBus);
    if (!this.scheduler) this.scheduler = setInterval(() => this.schedule(), 40);
  }

  /** Speed the music up (final lap) or back to normal. Takes effect from the next step. */
  setFinalLap(on: boolean): void {
    this.tempoMul = on ? FINAL_LAP_TEMPO : 1;
  }

  private fadeOutSong(): void {
    const g = this.songGain;
    if (!g || !this.ctx) return;
    g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12);
    setTimeout(() => g.disconnect(), 800);
    this.songGain = null;
  }

  private stopScheduler(): void {
    if (this.scheduler) clearInterval(this.scheduler);
    this.scheduler = null;
    this.song = null;
  }

  /** Called every 40 ms: queue the notes of every step that falls in the next ~0.2 s. */
  private schedule(): void {
    const ctx = this.ctx;
    const song = this.song;
    if (!ctx || !song || !this.songGain || ctx.state !== 'running') return;
    // After a throttled background tab, do not play a burst of missed notes.
    if (this.nextStepTime < ctx.currentTime - 0.3) this.nextStepTime = ctx.currentTime + 0.05;
    const env = this.env(this.songGain);
    const horizon = ctx.currentTime + 0.2;
    while (this.nextStepTime < horizon) {
      const sec = stepSeconds(song, this.tempoMul);
      const t = this.nextStepTime + swingOffset(song, this.nextStep, sec);
      if (!this.muted) {
        for (const n of notesBetween(song, this.nextStep, this.nextStep + 1)) {
          musicNote(env, t, n.voice, n.midi, n.dur * sec, song);
          this.stats.musicNotes++;
        }
      }
      this.nextStep++;
      this.nextStepTime += sec;
    }
  }

  // --- Mixer controls ------------------------------------------------------------

  toggleMute(): void {
    this.muted = !this.muted;
    writeStore(MUTE_KEY, this.muted ? '1' : '0');
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.03);
    this.updateMuteIcon();
  }

  setMusicVolume(v: number): void {
    this.musicVolume = Math.max(0, Math.min(1, Math.round(v * 10) / 10));
    writeStore(MUSIC_VOL_KEY, String(this.musicVolume));
    if (this.ctx) this.musicBus.gain.setTargetAtTime(LEVELS.music * this.musicVolume, this.ctx.currentTime, 0.05);
  }

  /** A tiny speaker icon in the corner, shown only while muted. */
  private updateMuteIcon(): void {
    if (this.muted && !this.muteIcon) {
      const el = document.createElement('div');
      el.textContent = '\u{1F507}';
      el.style.cssText = 'position:fixed;right:10px;bottom:8px;z-index:50;font-size:18px;opacity:.7;pointer-events:none';
      document.body.appendChild(el);
      this.muteIcon = el;
    }
    if (this.muteIcon) this.muteIcon.style.display = this.muted ? 'block' : 'none';
  }

  /** Current output loudness 0..1 (RMS of the final mix). For verifying that sound is being produced. */
  getLevel(): number {
    if (!this.ctx) return 0;
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.sqrt(sum / buf.length);
  }

  /** Debug summary for the browser console. */
  get debug(): Record<string, unknown> {
    return {
      state: this.ctx?.state ?? 'none',
      muted: this.muted,
      music: this.musicId,
      tempoMul: this.tempoMul,
      level: this.getLevel(),
      ...this.stats,
    };
  }
}
