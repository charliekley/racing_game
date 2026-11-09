/**
 * Route lines: the shape of every road on a track as plain polylines, for drawing
 * maps (the TV minimap and the phone map) and for anything else that needs "where
 * are the roads" without knowing how the simulation stores them.
 *
 * The main route is always present. Shortcut branches (`kind: 'shortcut'`) are
 * added by the shortcut code. Keep this interface stable: maps are written against it.
 */
import type { Track } from './track';

export interface RoutePoint {
  x: number;
  y: number;
  z: number;
}

export interface RouteLine {
  kind: 'main' | 'shortcut';
  /** 'dirt' routes slow you down like off-road; maps draw them dashed/brown. */
  surface: 'road' | 'dirt';
  /** Road width (m). */
  width: number;
  /** True for the main loop (the last point connects to the first). */
  closed: boolean;
  /** Points along the road in driving direction, about 6–12 m apart. */
  points: RoutePoint[];
}

/** Take every `step`-th centerline sample (step 4 ≈ 8 m) of the main loop. */
export function mainRoute(track: Track, step = 4): RouteLine {
  const points: RoutePoint[] = [];
  for (let i = 0; i < track.samples.length; i += step) {
    const p = track.samples[i];
    points.push({ x: p.x, y: p.y, z: p.z });
  }
  return { kind: 'main', surface: 'road', width: track.def.width, closed: true, points };
}
