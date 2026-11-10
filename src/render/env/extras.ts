/**
 * Style-specific set dressing that is not part of the scenery plan (no colliders, so it is
 * only placed well away from the road): cranes, lava vents, cabins, ski-lift pylons...
 */
import * as THREE from 'three';
import type { Track } from '../../sim/track';
import type { SceneryPlan, Site } from '../../track/sceneryPlan';
import type { TrackDef } from '../../track/types';
import type { Batches } from './structures';
import type { Style } from './props';

export interface ExtrasContext {
  style: Style;
  track: Track;
  plan: SceneryPlan;
  site: Site;
  rnd: () => number;
  batches: Batches;
  theme: TrackDef['theme'];
}

export function addExtras(_ctx: ExtrasContext): THREE.Object3D[] {
  return [];
}
