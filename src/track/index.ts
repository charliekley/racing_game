/** All available tracks. Add new ones here. The lobby's track picker (T) cycles through them in this order. */
import { mapleBay } from './tracks/mapleBay';
import { meadowRing } from './tracks/meadowRing';
import { sunscorchCanyon } from './tracks/sunscorchCanyon';
import type { TrackDef } from './types';

export const TRACKS: TrackDef[] = [meadowRing, sunscorchCanyon, mapleBay];
export type { TrackDef };
