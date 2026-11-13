/**
 * Which phone must make a choice right now? Pure logic (no DOM) so it can be unit tested.
 *
 * The host sends every phone the same `SeriesInfo`. From that alone each phone can tell whether IT
 * has to show the forced pop-up, so nothing can get stuck:
 *   - the owner leaves mid-choice -> `owner` becomes the next player -> their phone shows the pop-up;
 *   - a phone reconnects -> it gets the latest `SeriesInfo` again -> the pop-up comes back;
 *   - the host keyboard chooses -> `pending` turns false -> the pop-up closes everywhere.
 */
import type { SeriesInfo } from './protocol';

/** 'setup' = pick the mode (and track); 'pick' = Loser picks: choose the next track. */
export type ForcedKind = 'setup' | 'pick';

export function forcedChoice(info: SeriesInfo | null, mySlot: number | null): ForcedKind | null {
  if (!info || mySlot === null) return null;
  if (info.stage === 'menu' && info.pending === true && info.owner === mySlot) return 'setup';
  if (info.stage === 'between' && info.mode === 'loser' && info.picker === mySlot) return 'pick';
  return null;
}

/** Who the other phones should say is choosing: the owner (menu) or the picker (Loser picks); null = nobody. */
export function chooserSlot(info: SeriesInfo | null): number | null {
  if (!info) return null;
  if (info.stage === 'menu' && info.pending === true) return info.owner;
  if (info.stage === 'between' && info.mode === 'loser') return info.picker;
  return null;
}
