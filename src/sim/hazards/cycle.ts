/**
 * The repeating "idle -> warn -> active" cycle shared by timed hazards.
 *
 * One cycle lasts `period` seconds and always ENDS with the dangerous part:
 *
 *   |<------ idle ------>|<-- warn -->|<-- active -->|   (then it repeats)
 *   0                                              period
 *
 * `phase` slides the whole pattern later in time. The result depends only on `time`,
 * which is what makes a hazard "pure".
 */
import type { HazardPhase } from './types';

export interface CyclePose {
  phase: HazardPhase;
  /** Progress 0..1 inside the current phase. */
  t: number;
  /** Seconds since this cycle began (0..period). */
  clock: number;
}

/** Always-positive remainder (JavaScript's % can return negative numbers for negative times). */
export function wrap(value: number, period: number): number {
  return ((value % period) + period) % period;
}

export function cyclePose(time: number, period: number, phase: number, warn: number, active: number): CyclePose {
  const clock = wrap(time - phase, period);
  const idleLen = Math.max(0, period - warn - active);
  if (clock < idleLen) return { phase: 'idle', t: idleLen > 0 ? clock / idleLen : 0, clock };
  if (clock < idleLen + warn) return { phase: 'warn', t: (clock - idleLen) / warn, clock };
  return { phase: 'active', t: Math.min(1, (clock - idleLen - warn) / active), clock };
}
