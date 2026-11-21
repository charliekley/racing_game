import { describe, expect, it } from 'vitest';
import { PostRaceFlow, type PostFacts } from './postRaceFlow';
import { FINAL_PODIUM_HOLD_SECONDS, GP_NEXT_RACE_SECONDS, RESULTS_HOLD_SECONDS, SCOREBOARD_REVEAL_SECONDS } from './postRace';

const idle: PostFacts = { allReady: false, someoneChanging: false, trackChosen: true, revealDone: true };

/** Run the clock in 0.5 s steps until it answers something other than 'none'; returns [answer, seconds it took]. */
function run(f: PostRaceFlow, facts: Partial<PostFacts> | ((t: number) => Partial<PostFacts>) = {}, max = 60): [string, number] {
  let t = 0;
  while (t < max) {
    t += 0.5;
    const a = f.tick(0.5, { ...idle, ...(typeof facts === 'function' ? facts(t) : facts) });
    if (a !== 'none') return [a, t];
  }
  return ['none', t];
}

describe('PostRaceFlow: Grand Prix between races', () => {
  it('starts the next race by itself after GP_NEXT_RACE_SECONDS, whatever the phones do', () => {
    const f = new PostRaceFlow('auto');
    expect(f.countdown).toBe(GP_NEXT_RACE_SECONDS);
    expect(run(f, { allReady: true, someoneChanging: true })).toEqual(['start', GP_NEXT_RACE_SECONDS]);
  });
  it('counts down', () => {
    const f = new PostRaceFlow('auto');
    f.tick(4, idle);
    expect(f.countdown).toBe(GP_NEXT_RACE_SECONDS - 4);
  });
});

describe('PostRaceFlow: single race / Knockout / Loser picks (choose)', () => {
  it('shows the quadrants after the hold when nobody does anything', () => {
    const f = new PostRaceFlow('choose');
    expect(run(f)).toEqual(['showSelect', RESULTS_HOLD_SECONDS]);
    expect(f.stage).toBe('select');
  });
  it('a CHANGE press brings the quadrants early, but not before the scoreboard reveal', () => {
    const f = new PostRaceFlow('choose');
    expect(run(f, { someoneChanging: true })).toEqual(['showSelect', SCOREBOARD_REVEAL_SECONDS]);
  });
  it('waits for the podium reveal before cutting to the quadrants early', () => {
    const f = new PostRaceFlow('choose');
    const [a, t] = run(f, (s) => ({ someoneChanging: true, revealDone: s >= 6 }));
    expect([a, t]).toEqual(['showSelect', 6]);
  });
  it('everyone ready starts the race (after the scoreboard moment), without the quadrants', () => {
    const f = new PostRaceFlow('choose');
    expect(run(f, { allReady: true })).toEqual(['start', SCOREBOARD_REVEAL_SECONDS]);
  });
  it('in the quadrant stage the race starts the moment the last player is ready', () => {
    const f = new PostRaceFlow('choose');
    run(f); // -> select
    expect(run(f, (s) => ({ allReady: s >= 4 }))).toEqual(['start', 4]);
  });
  it('Loser picks: ready is not enough without a chosen track', () => {
    const f = new PostRaceFlow('choose');
    run(f);
    expect(run(f, { allReady: true, trackChosen: false }, 20)[0]).toBe('none');
    expect(run(f, { allReady: true, trackChosen: true })[0]).toBe('start');
  });
  it('someone who is changing blocks the start (not ready)', () => {
    const f = new PostRaceFlow('choose');
    run(f);
    expect(run(f, { allReady: false, someoneChanging: true }, 30)[0]).toBe('none');
  });
});

describe('PostRaceFlow: end of a series', () => {
  it('Grand Prix last race: results, then the podium, then the lobby after the reveal and the hold', () => {
    const f = new PostRaceFlow('final');
    expect(run(f)).toEqual(['podium', GP_NEXT_RACE_SECONDS]);
    expect(f.stage).toBe('podium');
    // The reveal takes 7 s: the hold only starts after it.
    const [a, t] = run(f, (s) => ({ revealDone: s >= 7 }));
    expect(a).toBe('lobby');
    expect(t).toBe(7 + FINAL_PODIUM_HOLD_SECONDS - 0.5); // (the frame that sees the reveal finished already counts 0.5 s of hold)
  });
  it('Loser picks STOP starts at the podium', () => {
    const f = new PostRaceFlow('final', 'podium');
    expect(f.countdown).toBeNull();
    expect(run(f)).toEqual(['lobby', FINAL_PODIUM_HOLD_SECONDS]);
  });
});
