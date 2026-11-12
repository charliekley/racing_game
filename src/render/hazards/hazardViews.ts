/**
 * HazardViews: draws every hazard of the current track. One view file per hazard kind
 * (geyserView.ts today; drawbridge, gust and roller views come with those kinds).
 *
 * `update(time)` is called once per rendered frame with the INTERPOLATED race time (see game.ts):
 * hazards are pure functions of the race clock, so drawing them at a time between two sim ticks
 * is exact, and the picture is as smooth as the karts, whatever the display rate.
 */
import type * as THREE from 'three';
import type { HazardSystem } from '../../sim/hazards/system';
import type { Hazard } from '../../sim/hazards/types';
import type { QualitySettings } from '../scene';
import { GeyserView } from './geyserView';

export class HazardViews {
  private readonly geysers: GeyserView | null;
  private lastTime = Number.NaN;

  constructor(
    scene: THREE.Scene,
    system: HazardSystem,
    quality: QualitySettings,
  ) {
    const ofKind = (kind: Hazard['kind']) => system.list.filter((h) => h.kind === kind);
    const geysers = ofKind('geyser');
    this.geysers = geysers.length > 0 ? new GeyserView(scene, geysers, quality) : null;
    // drawbridge / gust / roller: views are added together with their sim classes.
  }

  /** Pose everything at race time `time` (s). `focus` = positions of the karts the cameras follow (culls particles far away). */
  update(time: number, focus?: readonly { x: number; z: number }[]): void {
    const dt = Number.isFinite(this.lastTime) ? time - this.lastTime : 0;
    this.lastTime = time;
    this.geysers?.update(time, dt, focus);
  }

  setQuality(q: QualitySettings): void {
    this.geysers?.setQuality(q);
  }

  dispose(): void {
    this.geysers?.dispose();
  }
}
