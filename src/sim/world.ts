/**
 * The simulation world: all karts plus the ground they drive on. The host
 * calls `tick(getInput)` exactly SIM_HZ times per second.
 */
import type { ControlInput } from '../shared/protocol';
import { SIM_DT } from './config';
import type { Ground } from './ground';
import { cloneKart, createKart, stepKart, type KartState } from './kart';

export interface SpawnPoint {
  x: number;
  z: number;
  heading: number;
}

export class World {
  /** Karts by player slot index. */
  readonly karts = new Map<number, KartState>();
  /** State at the previous tick (for render interpolation). */
  readonly prevKarts = new Map<number, KartState>();

  constructor(readonly ground: Ground) {}

  addKart(slot: number, spawn: SpawnPoint): void {
    const k = createKart(spawn.x, spawn.z, spawn.heading);
    this.karts.set(slot, k);
    this.prevKarts.set(slot, cloneKart(k));
  }

  tick(getInput: (slot: number) => ControlInput): void {
    for (const [slot, kart] of this.karts) {
      this.prevKarts.set(slot, cloneKart(kart));
      stepKart(kart, getInput(slot), this.ground, SIM_DT);
    }
  }
}
