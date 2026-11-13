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

/**
 * Canvas -> small image text. WebP is about 4x smaller than PNG here (3.5 KB vs 14 KB); the PeerJS
 * message channel only takes messages up to ~16 KB, so size matters. Browsers that cannot encode WebP
 * (Safari) silently return PNG, so then we use JPEG instead.
 */
function encodeImage(canvas: HTMLCanvasElement): string {
  const webp = canvas.toDataURL('image/webp', 0.8);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.8);
}

export class TrackPreview {
  private cache = new Map<string, { data: MapData; length: number }>();
  private ctx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly nameEl: HTMLElement,
    private readonly metaEl: HTMLElement,
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
    return { name: def.name, laps: def.laps, km: Math.round(entry.length / 100) / 10, img: encodeImage(canvas) };
  }

  show(def: TrackDef): void {
    const entry = this.entry(def);
    this.nameEl.textContent = def.name;
    this.metaEl.textContent = `${def.laps} laps · ${(entry.length / 1000).toFixed(1)} km`;
    this.nameEl.classList.remove('swap');
    void this.nameEl.offsetWidth; // restart the little pop animation
    this.nameEl.classList.add('swap');
    const size = { w: this.canvas.width, h: this.canvas.height };
    this.ctx.clearRect(0, 0, size.w, size.h);
    drawMap(this.ctx, size, entry.data, [], { panel: 'rounded', panelColor: '#151a3a', fit: 0.88 });
  }
}
