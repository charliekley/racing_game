/**
 * The clock of the screens after a race: PURE LOGIC (no DOM, no network), so it can be unit tested.
 * seriesHost.ts feeds it the time and a few facts every frame and does what it answers.
 *
 * Four kinds of "after a race" (see postRace.ts for the picture):
 *   'auto'   Grand Prix, not the last race: results + standings, then the next race starts by itself.
 *   'single' Single race (and the hidden Knockout): results with the podium, then back to the lobby, where
 *            P1 chooses again and everybody has to ready up.
 *   'choose' Loser picks (between races): results, then everybody's selection
 *            quadrant; the next race starts when all are ready and the track is chosen.
 *   'final'  Grand Prix last race: results, then the 3D podium, then back to the lobby.
 *            (Loser picks STOP starts straight at the podium.)
 */
import { FINAL_PODIUM_HOLD_SECONDS, GP_NEXT_RACE_SECONDS, RESULTS_HOLD_SECONDS, SCOREBOARD_REVEAL_SECONDS } from './postRace';

export type PostKind = 'auto' | 'single' | 'choose' | 'final';
/** What the TV shows: the results table, everybody's selection quadrant, or the final podium. */
export type PostStage = 'results' | 'select' | 'podium';
/** What the host has to do now. 'showSelect' / 'podium' change the TV screen, 'start' starts the next race, 'lobby' leaves the series. */
export type PostAction = 'none' | 'showSelect' | 'podium' | 'start' | 'lobby';

/** The facts the clock needs each frame. */
export interface PostFacts {
  /** Every connected human (and bot) is ready for the next race. */
  allReady: boolean;
  /** Somebody went back to pick another character or kart (a CHANGE press). */
  someoneChanging: boolean;
  /** Loser picks: the track for the next race has been chosen (always true elsewhere). */
  trackChosen: boolean;
  /** The 3D podium has finished its reveal (true when there is no podium to wait for). */
  revealDone: boolean;
}

export class PostRaceFlow {
  stage: PostStage;
  /** Seconds in the current stage (for the podium stage: seconds since the reveal finished). */
  elapsed = 0;
  /** Seconds since the results appeared (never reset by the podium reveal). */
  private shown = 0;

  constructor(
    readonly kind: PostKind,
    /** 'podium' to start at the podium (Loser picks STOP skips the results: they were already on screen). */
    start: PostStage = 'results',
  ) {
    this.stage = start;
  }

  /** Seconds until the next race / the podium starts by itself (kinds 'auto' and 'final', results stage); null otherwise. */
  get countdown(): number | null {
    if (this.stage !== 'results' || this.kind === 'choose' || this.kind === 'single') return null;
    return Math.max(0, GP_NEXT_RACE_SECONDS - this.elapsed);
  }

  /**
   * Advance by `dt` seconds and say what to do. The caller applies it; 'showSelect' and 'podium' are
   * already reflected in `stage` when this returns, 'start' and 'lobby' end the flow.
   */
  tick(dt: number, f: PostFacts): PostAction {
    this.elapsed += dt;
    this.shown += dt;
    if (this.stage === 'podium') {
      if (!f.revealDone) this.elapsed = 0; // the hold starts when the reveal is over
      return this.elapsed >= FINAL_PODIUM_HOLD_SECONDS ? 'lobby' : 'none';
    }
    if (this.kind === 'auto') return this.elapsed >= GP_NEXT_RACE_SECONDS ? 'start' : 'none';
    if (this.kind === 'final') return this.elapsed >= GP_NEXT_RACE_SECONDS ? this.go('podium') : 'none';
    if (this.kind === 'single') {
      // The hold starts when the podium reveal is over, then it is back to the lobby.
      if (!f.revealDone) this.elapsed = 0;
      return this.elapsed >= RESULTS_HOLD_SECONDS ? 'lobby' : 'none';
    }

    // 'choose': the hold only starts once the podium reveal is over.
    if (this.stage === 'results' && !f.revealDone) this.elapsed = 0;
    // everybody ready (and the track chosen) starts the race.
    const go = f.allReady && f.trackChosen;
    if (this.stage === 'select') return go ? 'start' : 'none';
    // Results stage. The scoreboard (and podium) get their moment first; after that, a CHANGE press, a full
    // house of READY, or the hold running out all move things along.
    const seen = this.shown >= SCOREBOARD_REVEAL_SECONDS && f.revealDone;
    if (seen && go) return 'start';
    if ((seen && f.someoneChanging) || this.elapsed >= RESULTS_HOLD_SECONDS) return this.go('showSelect');
    return 'none';
  }

  private go(action: 'showSelect' | 'podium'): PostAction {
    this.stage = action === 'showSelect' ? 'select' : 'podium';
    this.elapsed = 0;
    return action;
  }
}
