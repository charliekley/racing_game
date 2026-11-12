/**
 * Registry: hazard `kind` -> factory. Adding a hazard kind = writing a class that implements
 * `Hazard`, adding its def type in src/track/hazardTypes.ts and one line here.
 */
import type { HazardDef } from '../../track/hazardTypes';
import type { Track } from '../track';
import { Geyser } from './geyser';
import type { Hazard } from './types';

type Factory = (id: number, def: HazardDef, track: Track) => Hazard;

/** Placeholder for kinds that a later agent builds: fails loudly, but only if a track really uses it. */
const notBuilt =
  (kind: string): Factory =>
  () => {
    throw new Error(`Hazard kind "${kind}" is not built yet (see docs/TRACKS.md, wave 4).`);
  };

export const HAZARD_FACTORIES: Record<HazardDef['kind'], Factory> = {
  geyser: (id, def, track) => new Geyser(id, def as Extract<HazardDef, { kind: 'geyser' }>, track),
  drawbridge: notBuilt('drawbridge'),
  gust: notBuilt('gust'),
  roller: notBuilt('roller'),
};
