/**
 * Fixed-timestep loop ("fix your timestep" pattern).
 *
 * The browser calls our render function at the display rate (60/75/120 Hz,
 * and irregularly when busy). The simulation, however, always advances in
 * fixed steps of 1/60 s so physics behaves identically on every machine.
 * Leftover time is kept in an accumulator; `alpha` (0..1) says how far we are
 * between the last two sim states, and the renderer interpolates with it.
 */
export class FixedStepLoop {
  private accumulator = 0;
  /** Total sim steps taken (the sim "tick" counter). */
  tick = 0;

  constructor(
    private readonly step: (dt: number) => void,
    readonly dt: number,
    /** Cap on steps per frame so a long hiccup can't freeze the page ("spiral of death"). */
    private readonly maxStepsPerFrame = 5,
  ) {}

  /** Advance by real elapsed seconds; returns the interpolation alpha. */
  advance(elapsed: number): number {
    this.accumulator += Math.max(0, elapsed);
    let steps = 0;
    while (this.accumulator >= this.dt && steps < this.maxStepsPerFrame) {
      this.step(this.dt);
      this.accumulator -= this.dt;
      this.tick++;
      steps++;
    }
    // Way behind (tab was in background etc.): drop the backlog instead of fast-forwarding.
    if (steps === this.maxStepsPerFrame && this.accumulator >= this.dt) this.accumulator = 0;
    return this.accumulator / this.dt;
  }

  reset(): void {
    this.accumulator = 0;
    this.tick = 0;
  }
}
