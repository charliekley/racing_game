/**
 * Lobby track picker preview: draws the selected track's top-down map into a
 * small canvas using the shared map code (src/shared/mapDraw.ts).
 *
 * Building a sim `Track` takes a moment, so each track's map data is built
 * once on first view and cached by name.
 */
import { mapDataFromTrack } from '../sim/mapData';
import { Track } from '../sim/track';
import { drawMap, type MapData } from '../shared/mapDraw';
import type { TrackDef } from '../track';
import type { TrackCard } from '../shared/protocol';
import { TrackShooter } from '../render/trackShot';

/**
 * Canvas -> small image text. WebP is about 4x smaller than PNG here (3.5 KB vs 14 KB); the PeerJS
 * message channel only takes messages up to ~16 KB, so size matters. Browsers that cannot encode WebP
 * (Safari) silently return PNG, so then we use JPEG instead.
 */
function encodeImage(canvas: HTMLCanvasElement, quality = 0.8): string {
  const webp = canvas.toDataURL('image/webp', quality);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', quality);
}

/** Photos are noisier than the flat-colour map: step the quality down until the picture is small enough for one message. */
const SHOT_BUDGET_CHARS = 9000; // base64 text; ~6.5 KB of image
function encodeShot(canvas: HTMLCanvasElement): string {
  let url = '';
  for (const q of [0.72, 0.6, 0.48, 0.36, 0.25]) {
    url = encodeImage(canvas, q);
    if (url.length <= SHOT_BUDGET_CHARS) break;
  }
  return url;
}

export class TrackPreview {
  private cache = new Map<string, { data: MapData; length: number }>();
  private ctx: CanvasRenderingContext2D;
  /** Rendered 3D pictures by track name (data URLs); filled in the background by `renderShots`. */
  private shots = new Map<string, string>();
  /** Fallback pictures (the flat map) by track name, so cards are cheap to ask for again. */
  private mapImgs = new Map<string, string>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly nameEl: HTMLElement,
    private readonly metaEl: HTMLElement,
    /** Shows the rendered course picture instead of the flat map once it exists. */
    private readonly shotEl?: HTMLImageElement,
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  private entry(def: TrackDef): { data: MapData; length: number } {
    let entry = this.cache.get(def.name);
    if (!entry) {
      const track = new Track(def);
      entry = { data: mapDataFromTrack(track), length: track.length };
      this.cache.set(def.name, entry);
    }
    return entry;
  }

  /**
   * A small picture of the track for the phone menus: the same top-down map, drawn into an off-screen
   * canvas and turned into a image "data URL" (the image itself written as text, so it travels in a normal
   * message). The map is mostly flat colours, so a 176x104 PNG is only a few KB: cheap for phones.
   * (Drawing the MapData on the phone instead would need the full data for every track; this is smaller.)
   */
  card(def: TrackDef): TrackCard {
    const entry = this.entry(def);
    const canvas = document.createElement('canvas');
    canvas.width = 176;
    canvas.height = 104;
    const ctx = canvas.getContext('2d')!;
    drawMap(ctx, { w: canvas.width, h: canvas.height }, entry.data, [], { panel: 'rounded', panelColor: '#151a3a', fit: 0.88 });
    let img = this.shots.get(def.name);
    if (!img) {
      img = this.mapImgs.get(def.name) ?? encodeImage(canvas);
      this.mapImgs.set(def.name, img);
    }
    return { name: def.name, laps: def.laps, km: Math.round(entry.length / 100) / 10, img };
  }

  /**
   * Render the 3D course pictures in the background, one track at a time with a pause between them so the
   * lobby never stalls (each shot builds a whole scene, ~100-300 ms). `onShot` runs after each one (the
   * caller then re-sends cards). The WebGL renderer is released after the last.
   */
  renderShots(defs: TrackDef[], onShot: (def: TrackDef) => void, startDelayMs = 1500): void {
    const shooter = new TrackShooter();
    const queue = defs.filter((d) => !this.shots.has(d.name));
    const step = () => {
      const def = queue.shift();
      if (!def) {
        shooter.close();
        return;
      }
      requestAnimationFrame(() => {
        try {
          const canvas = shooter.shoot(def);
          this.shots.set(def.name, encodeShot(canvas));
          onShot(def);
        } catch (err) {
          console.warn('track picture failed for', def.name, err); // the flat map card stays
        }
        setTimeout(step, 250);
      });
    };
    setTimeout(step, startDelayMs);
  }

  /** The rendered picture of a track, once it exists (else null). */
  shotOf(def: TrackDef): string | null {
    return this.shots.get(def.name) ?? null;
  }
  show(def: TrackDef): void {
    const entry = this.entry(def);
    this.nameEl.textContent = def.name;
    this.metaEl.textContent = `${def.laps} laps · ${(entry.length / 1000).toFixed(1)} km`;
    this.nameEl.classList.remove('swap');
    void this.nameEl.offsetWidth; // restart the little pop animation
    this.nameEl.classList.add('swap');
    const shot = this.shots.get(def.name);
    if (this.shotEl) {
      if (shot && this.shotEl.src !== shot) this.shotEl.src = shot;
      this.shotEl.hidden = !shot;
      this.canvas.hidden = !!shot;
    }
    const size = { w: this.canvas.width, h: this.canvas.height };
    this.ctx.clearRect(0, 0, size.w, size.h);
    drawMap(this.ctx, size, entry.data, [], { panel: 'rounded', panelColor: '#151a3a', fit: 0.88 });
  }
}
