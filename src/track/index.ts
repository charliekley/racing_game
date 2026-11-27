/** All available tracks. Add new ones here. The lobby's track picker (T) cycles through them in this order. */
import { emberPeaks } from './tracks/emberPeaks';
import { docksideLoop } from './tracks/docksideLoop';
import { cloudGarden } from './tracks/cloudGarden';
import { switchbackSummit } from './tracks/switchbackSummit';
import { autumnSpeedway } from './tracks/autumnSpeedway';
import { mushroomValley } from './tracks/mushroomValley';
import { rainbowRoute } from './tracks/rainbowRoute';
import { palmPlaza } from './tracks/palmPlaza';
import type { TrackDef } from './types';

// The Grand Prix runs them in this order too, so Autumn Speedway is the 5th race, Mushroom Valley the 6th, Rainbow Route the 7th and Palm Plaza the 8th and last.
export const TRACKS: TrackDef[] = [emberPeaks, docksideLoop, cloudGarden, switchbackSummit, autumnSpeedway, mushroomValley, rainbowRoute, palmPlaza];
export type { TrackDef };

// Dev-only test tracks (never in the lobby picker). Open one with
// ?track=Shortcut%20Test etc. while running `npx vite` (see src/host/main.ts).
import { cannonTest } from './tracks/_cannonTest';
import { jumpTest } from './tracks/_jumpTest';
import { meadowRing } from './tracks/_meadowRing'; // the old flat oval: a simple baseline for tests
import { shortcutTest } from './tracks/_shortcutTest';
import { terrainTest } from './tracks/_terrainTest';

export const DEV_TRACKS: TrackDef[] = [meadowRing, terrainTest, cannonTest, shortcutTest, jumpTest];
