/**
 * Builds the compact `MapData` the maps draw from (see shared/mapDraw.ts) out of a Track.
 * Pure: no rendering. Numbers are rounded to 0.1 m and polylines are thinned so the
 * result stays small enough to send to every phone as JSON (a few KB).
 */
import type { MapBridge, MapCannon, MapCliff, MapData, MapGap, MapPoint3, MapRoute } from '../shared/mapDraw';
import type { Track } from './track';

/** No route keeps more than this many points (a ~1.5 km loop ends up with a point every ~12 m). */
export const MAX_ROUTE_POINTS = 120;
/** Spacing (m) of the points along bridges and cliffs. */
const BRIDGE_STEP = 6;
const CLIFF_STEP = 10;

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Every `ceil(n / max)`-th point; the last point of an open route is always kept. */
function thin(points: MapPoint3[], closed: boolean): MapPoint3[] {
  const step = Math.max(1, Math.ceil(points.length / MAX_ROUTE_POINTS));
  const out: MapPoint3[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  if (!closed && (points.length - 1) % step !== 0) out.push(points[points.length - 1]);
  return out.map((p) => ({ x: r1(p.x), y: r1(p.y), z: r1(p.z) }));
}

/** Distances s along the track from s0 to s1 (wrapping past the start line) every `step` metres, ending exactly at s1. */
function sRange(track: Track, s0: number, s1: number, step: number): number[] {
  const L = track.length;
  const len = (((s1 - s0) % L) + L) % L;
  const n = Math.max(1, Math.ceil(len / step));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push((s0 + (len * i) / n) % L);
  return out;
}

export function mapDataFromTrack(track: Track): MapData {
  // Shortcuts are left OFF the maps on purpose: they are secrets for players to discover.
  const routes: MapRoute[] = track.routes.filter((r) => r.kind !== 'shortcut').map((r) => ({
    kind: r.kind,
    surface: r.surface,
    width: r1(r.width),
    closed: r.closed,
    points: thin(r.points, r.closed),
  }));

  const bridges: MapBridge[] = track.bridges.map((b) => ({
    points: sRange(track, b.s0, b.s1, BRIDGE_STEP).map((s) => {
      const p = track.pointAt(s);
      return { x: r1(p.x), y: r1(p.y), z: r1(p.z) };
    }),
  }));

  // One polyline per cliff side, offset from the centerline to where the ground ends.
  const reach = track.def.width / 2 + track.def.offroadWidth;
  const cliffs: MapCliff[] = [];
  for (const c of track.cliffs) {
    const edge = Math.min(c.edge, reach);
    const sides = c.side === 'both' ? (['left', 'right'] as const) : ([c.side] as const);
    for (const side of sides) {
      const points = sRange(track, c.s0, c.s1, CLIFF_STEP).map((s) => {
        const p = track.pointAt(s, side === 'right' ? edge : -edge);
        return { x: r1(p.x), z: r1(p.z) };
      });
      cliffs.push({ points, side });
    }
  }

  const cannons: MapCannon[] = track.cannons.map((c) => ({
    mouth: { x: r1(c.mouth.x), z: r1(c.mouth.z) },
    landing: { x: r1(c.landing.x), z: r1(c.landing.z) },
  }));

  // Water and chasm gaps: marked at their middle.
  const voidGaps: MapGap[] = track.gaps.map((g) => {
    const len = (((g.s1 - g.s0) % track.length) + track.length) % track.length;
    const mid = track.pointAt(g.s0 + len / 2);
    return { x: r1(mid.x), z: r1(mid.z), heading: r2(mid.heading), width: r1(track.def.width), length: r1(len), kind: g.kind };
  });

  const s0 = track.samples[0];
  let maxHeight = 0;
  for (const r of routes) for (const p of r.points) maxHeight = Math.max(maxHeight, p.y);

  return {
    routes,
    bridges,
    cliffs,
    cannons,
    voidGaps,
    start: { x: r1(s0.x), z: r1(s0.z), heading: r2(s0.heading) },
    maxHeight: r1(maxHeight),
  };
}
