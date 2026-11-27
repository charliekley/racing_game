/**
 * Registry: hazard `kind` -> factory. Adding a hazard kind = writing a class that implements
 * `Hazard`, adding its def type in src/track/hazardTypes.ts and one line here.
 */
import type { HazardDef } from '../../track/hazardTypes';
import type { Track } from '../track';
import { Drawbridge } from './drawbridge';
import { Geyser } from './geyser';
import { Roller } from './roller';
import { Gust } from './gust';
import { Beetle } from './beetle';
import { Escalator } from './escalator';
import { Car } from './car';
import type { Hazard } from './types';

type Factory = (id: number, def: HazardDef, track: Track) => Hazard;

export const HAZARD_FACTORIES: Record<HazardDef['kind'], Factory> = {
  geyser: (id, def, track) => new Geyser(id, def as Extract<HazardDef, { kind: 'geyser' }>, track),
  roller: (id, def, track) => new Roller(id, def as Extract<HazardDef, { kind: 'roller' }>, track),
  drawbridge: (id, def, track) => new Drawbridge(id, def as Extract<HazardDef, { kind: 'drawbridge' }>, track),
  gust: (id, def, track) => new Gust(id, def as Extract<HazardDef, { kind: 'gust' }>, track),
  beetle: (id, def, track) => new Beetle(id, def as Extract<HazardDef, { kind: 'beetle' }>, track),
  escalator: (id, def, track) => new Escalator(id, def as Extract<HazardDef, { kind: 'escalator' }>, track),
  car: (id, def, track) => new Car(id, def as Extract<HazardDef, { kind: 'car' }>, track),
};
