/**
 * Shared shapes of the hazard system (see docs/TRACKS.md, "Hazards: the contract").
 *
 * Everything here is pure TypeScript (no DOM, no Three.js, no Math.random). A hazard is
 * described by `pose(time)`: a function of the RACE CLOCK only. Same time in, same pose
 * out, so the simulation, the renderer (which feeds it an interpolated time) and the bots
 * (which ask "what will it be doing in 1 s?") always agree, and a replay is exact.
 */
import type { HazardDef } from '../../track/hazardTypes';
import type { KartConfig } from '../config';
import type { Ground } from '../ground';
import type { KartState } from '../kart';

/** idle = harmless, warn = about to fire (the telegraph), active = dangerous right now. */
export type HazardPhase = 'idle' | 'warn' | 'active';

/** What a hazard looks like at one instant. Each kind adds its own fields (position, radius...). */
export interface HazardPose {
  phase: HazardPhase;
  /** Progress 0..1 inside the current phase. */
  t: number;
  [k: string]: unknown;
}

export interface Hazard {
  /** Index in `track.def.hazards`. */
  readonly id: number;
  readonly kind: HazardDef['kind'];
  /** Main-route distance (m), for bots, audio and maps. */
  readonly s: number;
  /** PURE: the state at race time `time` (s, negative during the countdown). */
  pose(time: number): HazardPose;
  /** Apply the hazard to one kart this tick. Must respect invulnTime, respawnTime and flight. */
  affect(k: KartState, time: number, dt: number, c: KartConfig): 'hit' | 'push' | null;
  /** Ground override (drawbridge): a height, null = no ground (fall), undefined = not mine. */
  groundAt?(x: number, z: number, time: number): number | null | undefined;
  /** 0..1 danger for a kart at main-route distance s, lateral offset d (m, + = right), `ahead` seconds from now. For bots. */
  danger(s: number, d: number, time: number, ahead: number): number;
}

/** Karts within this distance (m, along the road) of a hazard hear / see its warning. */
export const HAZARD_NEAR_DISTANCE = 150;

export type HazardEvent =
  | { kind: 'hazardWarn'; hazard: number; type: HazardDef['kind']; near: number[] }
  | { kind: 'hazardFire'; hazard: number; type: HazardDef['kind']; near: number[] }
  | { kind: 'hazardHit'; slot: number; hazard: number; type: HazardDef['kind'] };

/** Advice for a bot: `brake` 0..1 (lift at ~0.5, brake hard near 1) and `steer`, a suggested sideways shift of its line in metres (+ = right). */
export interface BotAdvice {
  brake: number;
  steer: number;
}

export type { Ground, KartConfig, KartState };
