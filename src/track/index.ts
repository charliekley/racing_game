/** All available tracks. Add new ones here. The lobby's track picker (T) cycles through them in this order. */
import { docksideLoop } from './tracks/docksideLoop';
import { mapleBay } from './tracks/mapleBay';
import { meadowRing } from './tracks/meadowRing';
import { sunscorchCanyon } from './tracks/sunscorchCanyon';
import type { TrackDef } from './types';

export const TRACKS: TrackDef[] = [meadowRing, sunscorchCanyon, mapleBay, docksideLoop];
export type { TrackDef };

// Dev-only test tracks (never in the lobby picker). Open one with
// ?track=Shortcut%20Test etc. while running `npx vite` (see src/host/main.ts).
import { cannonTest } from './tracks/_cannonTest';
import { jumpTest } from './tracks/_jumpTest';
import { shortcutTest } from './tracks/_shortcutTest';
import { terrainTest } from './tracks/_terrainTest';

export const DEV_TRACKS: TrackDef[] = [terrainTest, cannonTest, shortcutTest, jumpTest];
