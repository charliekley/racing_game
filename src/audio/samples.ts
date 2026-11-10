/**
 * Swap-in sound files.
 *
 * Every sound is synthesised in code (synth.ts). To replace one with a real
 * recording, put the file in `public/sounds/` and list it here, e.g.
 *
 *     boostPad: 'sounds/boost.mp3',
 *
 * The key is a sound name from SOUND_IDS (mapping.ts). If the file loads, it is
 * played instead of the synth (at the same volume and pitch rules); if it is
 * missing or fails to decode, the synth is used. Any format the browser can
 * decode works (mp3, ogg, wav). Paths are relative to the site root.
 */
import type { SoundId } from './mapping';

export const SAMPLE_FILES: Partial<Record<SoundId, string>> = {
  // boostPad: 'sounds/boost.mp3',
};

/** Loads and keeps the decoded buffers of the files listed above. */
export class SampleBank {
  private buffers = new Map<SoundId, AudioBuffer>();

  constructor(ctx: BaseAudioContext, files: Partial<Record<SoundId, string>> = SAMPLE_FILES) {
    const base = import.meta.env?.BASE_URL ?? '/';
    for (const [id, path] of Object.entries(files) as [SoundId, string][]) {
      fetch(base + path.replace(/^\//, ''))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((data) => ctx.decodeAudioData(data))
        .then((buf) => this.buffers.set(id, buf))
        .catch(() => {
          /* missing or undecodable: the synth stays in use */
        });
    }
  }

  get(id: SoundId): AudioBuffer | undefined {
    return this.buffers.get(id);
  }
}
