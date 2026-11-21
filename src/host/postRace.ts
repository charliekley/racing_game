/**
 * SHARED CONTRACT for what happens after a race (the post-race flow + the podium).
 *
 * Two sides meet here:
 *  - the FLOW side (main.ts, seriesHost.ts, playerManager.ts) decides WHEN to show what and with whose data;
 *  - the VISUAL side (podiumView.ts, resultsView.ts, seriesView.ts) decides HOW it looks.
 * Neither side should need the other's internals: only these types and timings.
 *
 * The flow after a race, per mode:
 *  - Grand Prix, not the last race: results + standings (scoreboard reveal), then the next race starts by
 *    itself after GP_NEXT_RACE_SECONDS. No ready step, no character change.
 *  - Grand Prix last race / Loser picks STOP: results, then the final standings with the 3D podium,
 *    then back to the lobby (players stay locked in at 'ready').
 *  - Single race and Knockout: results with the 3D podium (top three of THAT race), then the TV shows
 *    everyone's selection quadrant (turntable + ready state) while each phone offers CHANGE CHARACTER / READY.
 *    When everyone is ready, the race starts again.
 *  - Loser picks between races: results + standings, then the quadrants (like single) plus the track pick
 *    strip; the next race starts when the picker has chosen AND everyone is ready.
 */
import type { Loadout } from '../shared/characters';
import type { SlotOwner } from './playerSlots';

/** One racer on the podium (place 1, 2 or 3). Names come from phones: only ever use textContent. */
export interface PodiumEntry {
  slot: number;
  place: 1 | 2 | 3;
  name: string;
  /** CSS colour of the player. */
  color: string;
  /** Character + kart body, so the podium can build the right 3D model. */
  loadout: Loadout;
  /** Race wins this session (crown count, see shared/wins.ts). */
  wins: number;
  /** Series points (Grand Prix / Loser picks final), or null for a single race / Knockout. */
  points: number | null;
}

/**
 * The 3D podium on the TV. Implemented by podiumView.ts (createPodium). The flow side only calls these.
 *
 * Lifetime is like SelectView: show() creates what it needs, hide() stops drawing and frees GPU memory.
 */
export interface PodiumApi {
  /**
   * Show the podium for these entries (1 to 3 of them) and play the reveal: 3rd, then 2nd, then 1st, each
   * with their character's pick animation. Resolves when the reveal has finished (the podium stays up
   * until hide()). `title` is a small heading such as "GRAND PRIX · 4 RACES".
   */
  show(entries: readonly PodiumEntry[], title: string): Promise<void>;
  /** Take the podium off the screen and free its GPU memory. Safe to call when hidden. */
  hide(): void;
  /** Called every frame while shown (main.ts drives the loop). `dt` in seconds. */
  update(dt: number): void;
}

// --- Timings (seconds). One place to tune the pacing. ---------------------------------------------------

/** The scoreboard reveal (rows flipping in, points counting up) takes about this long. */
export const SCOREBOARD_REVEAL_SECONDS = 3;
/** Grand Prix: the standings stay up this long, then the next race starts on its own. */
export const GP_NEXT_RACE_SECONDS = 10;
/** Single race / Knockout / Loser picks: results (and podium) stay up this long before the TV switches to the quadrants. */
export const RESULTS_HOLD_SECONDS = 9;
/** End of a series: after the podium reveal has finished, wait this long, then back to the lobby. */
export const FINAL_PODIUM_HOLD_SECONDS = 8;

/**
 * The win-tally key for a racer (see shared/wins.ts). `owner` is the player slot's owner, or undefined for a
 * fill-in bot (slot >= 4, no player entry): those are keyed by slot, which maps 1:1 to their "CPU n" name.
 */
export function winKey(slot: number, owner?: SlotOwner): string {
  if (!owner) return `cpu:${slot}`;
  switch (owner.kind) {
    case 'phone':
      return `phone:${owner.clientId}`;
    case 'keyboard':
      return `kb:${owner.scheme}`;
    case 'gamepad':
      return `pad:${owner.index}`;
    case 'bot':
      return `bot:${owner.id}`;
  }
}
