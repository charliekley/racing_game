/**
 * Shared contract for the pre-race selection flow (name -> character -> kart -> ready).
 *
 * Two parts of the host use this:
 *  - the INPUT side (phones over the network, plus keyboard/gamepad players on the TV) decides what each
 *    player is doing and calls `hub.set(...)` whenever something changes;
 *  - the DISPLAY side (the TV's per-player quadrants with the 3D turntable) calls `hub.subscribe(...)` and
 *    draws whatever it is told.
 * Neither side imports the other: they only meet here. (Web concept: a tiny "publish/subscribe" hub.)
 */

/** Where a player is in the flow. 'ready' = locked in and waiting for the others. */
export type SelectStage = 'name' | 'character' | 'kart' | 'ready';

/** Everything the TV needs to draw one player's quadrant. Indices refer to CHARACTERS / KART_BODIES in shared/characters.ts. */
export interface SelectionView {
  /** Player slot (0..3); the quadrant is chosen from this. */
  slot: number;
  name: string;
  stage: SelectStage;
  /** Character currently highlighted (while browsing) or chosen (once past the character stage). */
  character: number;
  /** Kart body currently highlighted or chosen. */
  kart: number;
  /** How this player makes choices: on their phone, or with keyboard/gamepad on the TV. */
  input: 'phone' | 'local';
  /**
   * Ready flag. In the lobby it follows stage === 'ready'. After a race (results phase) everyone is still at
   * stage 'ready' (locked in), and this says whether they pressed READY (race again) yet.
   */
  ready: boolean;
  /** Race wins this session (crown count, see shared/wins.ts). */
  wins: number;
}

type Listener = (views: readonly SelectionView[]) => void;

export class SelectionHub {
  private readonly views = new Map<number, SelectionView>();
  private readonly listeners = new Set<Listener>();

  /** Add or update one player's view, then tell every subscriber. */
  set(view: SelectionView): void {
    this.views.set(view.slot, { ...view });
    this.emit();
  }

  /** A player left (or the flow ended for them). */
  remove(slot: number): void {
    if (this.views.delete(slot)) this.emit();
  }

  /** Forget everyone (e.g. when the flow is finished and the race starts). */
  clear(): void {
    if (this.views.size === 0) return;
    this.views.clear();
    this.emit();
  }

  get(slot: number): SelectionView | undefined {
    return this.views.get(slot);
  }

  /** All players, in slot order. */
  list(): SelectionView[] {
    return [...this.views.values()].sort((a, b) => a.slot - b.slot);
  }

  /** True when there is at least one player and all of them are ready. */
  allReady(): boolean {
    return this.views.size > 0 && [...this.views.values()].every((v) => v.stage === 'ready');
  }

  /** Get told about every change (called once right away with the current state). Returns an unsubscribe function. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.list());
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const list = this.list();
    for (const fn of this.listeners) fn(list);
  }
}
