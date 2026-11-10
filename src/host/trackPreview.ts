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

  show(def: TrackDef): void {
    let entry = this.cache.get(def.name);
    if (!entry) {
      const track = new Track(def);
      entry = { data: mapDataFromTrack(track), length: track.length };
      this.cache.set(def.name, entry);
    }
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
