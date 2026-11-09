import { describe, expect, it } from 'vitest';
import { TRACKS } from '../track';
import { cannonTest } from '../track/tracks/_cannonTest';
import { terrainTest } from '../track/tracks/_terrainTest';
import type { TrackDef } from '../track/types';
import { findCrossings, isMapData } from '../shared/mapDraw';
import { isHostMessage, type HostToController } from '../shared/protocol';
import { mapDataFromTrack } from './mapData';
import { Track } from './track';

const all: [string, TrackDef][] = [...TRACKS.map((d) => [d.name, d] as [string, TrackDef]), ['terrainTest', terrainTest], ['cannonTest', cannonTest]];

/** Every number anywhere in the object is finite. */
function allFinite(o: unknown): boolean {
  if (typeof o === 'number') return Number.isFinite(o);
  if (Array.isArray(o)) return o.every(allFinite);
  if (o && typeof o === 'object') return Object.values(o).every(allFinite);
  return true;
}

describe.each(all)('mapDataFromTrack: %s', (_name, def) => {
  const track = new Track(def);
  const data = mapDataFromTrack(track);
  // What the host really sends: the old outline plus the rich map.
  const msg: HostToController = { t: 'track', pts: new Array(2 * Math.ceil(track.samples.length / 6)).fill(123.4), w: def.width, map: data };
  const json = JSON.stringify(msg);

  it('is valid, finite and small', () => {
    expect(isMapData(data)).toBe(true);
    expect(allFinite(data)).toBe(true);
    expect(data.routes.length).toBeGreaterThanOrEqual(1);
    expect(data.routes[0].kind).toBe('main');
    expect(json.length).toBeLessThan(12_000);
    expect(isHostMessage(JSON.parse(json))).toBe(true);
  });

  it('carries the track features', () => {
    expect(data.bridges).toHaveLength(track.bridges.length);
    expect(data.cannons).toHaveLength(track.cannons.length);
    expect(data.voidGaps).toHaveLength(track.gaps.length);
    const cliffSides = track.cliffs.reduce((n, c) => n + (c.side === 'both' ? 2 : 1), 0);
    expect(data.cliffs).toHaveLength(cliffSides);
    for (const b of data.bridges) expect(b.points.length).toBeGreaterThanOrEqual(2);
    for (const c of data.cliffs) expect(c.points.length).toBeGreaterThanOrEqual(2);
  });

  it('uses rounded numbers (0.1 m)', () => {
    for (const p of data.routes[0].points) expect(Math.abs(p.x * 10 - Math.round(p.x * 10))).toBeLessThan(1e-6);
  });
});

describe('specific tracks', () => {
  it('terrain test: bridge, cliff, void gap, height, and an overpass crossing', () => {
    const data = mapDataFromTrack(new Track(terrainTest));
    expect(data.bridges.length).toBeGreaterThan(0);
    expect(data.cliffs.length).toBeGreaterThan(0);
    expect(data.voidGaps.some((g) => g.kind === 'void')).toBe(true);
    expect(data.maxHeight).toBeGreaterThan(5);
    expect(findCrossings(data.routes).length).toBeGreaterThan(0);
  });

  it('cannon test: a cannon whose landing is away from its mouth', () => {
    const data = mapDataFromTrack(new Track(cannonTest));
    expect(data.cannons.length).toBeGreaterThan(0);
    const c = data.cannons[0];
    expect(Math.hypot(c.landing.x - c.mouth.x, c.landing.z - c.mouth.z)).toBeGreaterThan(10);
  });

  it('flat standard tracks have no features and no crossings', () => {
    const data = mapDataFromTrack(new Track(TRACKS[0]));
    expect(data.bridges).toHaveLength(0);
    expect(data.cannons).toHaveLength(0);
    expect(findCrossings(data.routes)).toHaveLength(0);
  });

  it('shortcut routes on a track are passed through', () => {
    const track = new Track(TRACKS[0]);
    const main = track.routes[0];
    const fake = { ...main, kind: 'shortcut' as const, surface: 'dirt' as const, closed: false, points: main.points.slice(0, 8) };
    Object.defineProperty(track, 'routes', { get: () => [main, fake] });
    const data = mapDataFromTrack(track);
    expect(data.routes.map((r) => r.kind)).toEqual(['main', 'shortcut']);
    expect(data.routes[1].surface).toBe('dirt');
  });
});
