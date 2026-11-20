/**
 * The steps of the pre-race flow, shared by the phone and the host. PURE DATA + tiny rules (no DOM).
 *
 *   name -> character -> kart -> ready
 *
 * A player may move forward ONE step at a time and back to any earlier step. The phone proposes a step
 * (`select` message), the host checks it with `canMoveStage` and answers with the real state.
 */

export const SELECT_STAGES = ['name', 'character', 'kart', 'ready'] as const;
export type SelectStage = (typeof SELECT_STAGES)[number];

/** Position in the flow (0 = name ... 3 = ready). -1 for anything that is not a stage. */
export function stageRank(s: unknown): number {
  return (SELECT_STAGES as readonly unknown[]).indexOf(s);
}

export function isSelectStage(s: unknown): s is SelectStage {
  return stageRank(s) >= 0;
}

/** Staying put, going back any distance, or forward exactly one step is allowed. Skipping ahead is not. */
export function canMoveStage(from: SelectStage, to: SelectStage): boolean {
  return stageRank(to) <= stageRank(from) + 1;
}

/** The step before this one (a Back button), or null at the start. */
export function previousStage(s: SelectStage): SelectStage | null {
  return SELECT_STAGES[stageRank(s) - 1] ?? null;
}

/** The step after this one (a Confirm button), or null at the end. */
export function nextStage(s: SelectStage): SelectStage | null {
  return SELECT_STAGES[stageRank(s) + 1] ?? null;
}
