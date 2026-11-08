/**
 * The simulation world: track, karts, collisions and race rules. The host
 * calls `tick(getInput)` exactly SIM_HZ times per second; it returns events
 * (lap done, wall hit, …) for the UI, audio and phone haptics.
 */
import type { ControlInput } from '../shared/protocol';
import { KART, SIM_DT } from './config';
import { collideKarts, collideWalls, type CollisionEvent } from './collision';
import type { Ground } from './ground';
import { applyBoost, cloneKart, createKart, stepKart, type KartState } from './kart';
import { Race, type RaceEvent } from './race';
import type { Track } from './track';

export interface SpawnPoint {
  x: number;
  z: number;
  heading: number;
}

export type WorldEvent = RaceEvent | CollisionEvent | { kind: 'boostPad'; slot: number };

/** Wall hits softer than this (m/s) aren't reported. */
const WALL_EVENT_MIN_IMPACT = 3;

export class World {
  /** Karts by player slot index. */
  readonly karts = new Map<number, KartState>();
  /** State at the previous tick (for render interpolation). */
  readonly prevKarts = new Map<number, KartState>();
  race: Race | null = null;

  constructor(
    readonly ground: Ground,
    readonly track: Track | null = null,
  ) {}

  addKart(slot: number, spawn: SpawnPoint): void {
    const hit = this.ground.sample(spawn.x, spawn.z);
    const k = createKart(spawn.x, spawn.z, spawn.heading, hit?.height ?? 0);
    if (hit?.index !== undefined) k.trackIndex = hit.index;
    this.karts.set(slot, k);
    this.prevKarts.set(slot, cloneKart(k));
  }

  /** Put every slot on the starting grid and begin the countdown. */
  startRace(slots: number[], laps: number): void {
    if (!this.track) throw new Error('startRace needs a track');
    this.karts.clear();
    this.prevKarts.clear();
    slots.forEach((slot, i) => this.addKart(slot, this.track!.gridSpot(i)));
    this.race = new Race({ length: this.track.length, checkpoints: this.track.checkpoints }, laps, slots);
  }

  tick(getInput: (slot: number) => ControlInput): WorldEvent[] {
    const events: WorldEvent[] = [];
    const inputs = new Map<number, ControlInput>();
    for (const slot of this.karts.keys()) inputs.set(slot, getInput(slot));
    const frozen = this.race?.phase === 'countdown';

    for (const [slot, kart] of this.karts) {
      this.prevKarts.set(slot, cloneKart(kart));
      if (frozen) continue; // everyone waits on the grid during the countdown
      stepKart(kart, inputs.get(slot)!, this.ground, SIM_DT);
      if (kart.grounded && kart.surface === 'boost') {
        if (kart.boostTime < KART.boostPadTime * 0.5) events.push({ kind: 'boostPad', slot });
        applyBoost(kart, KART.boostPadTime);
      }
      if (this.track) {
        const impact = collideWalls(kart, this.track);
        if (impact > WALL_EVENT_MIN_IMPACT) events.push({ kind: 'wall', slot, impact });
      }
    }
    if (!frozen) events.push(...collideKarts(this.karts));

    if (this.race && this.track) {
      const positions = new Map<number, number>();
      for (const [slot, kart] of this.karts) {
        positions.set(slot, this.track.project(kart.pos.x, kart.pos.z, kart.trackIndex).s);
      }
      for (const e of this.race.tick(SIM_DT, positions, inputs)) {
        if (e.kind === 'startBoost') applyBoost(this.karts.get(e.slot)!, KART.startBoostTime);
        if (e.kind === 'stall') this.karts.get(e.slot)!.stallTime = KART.startStallTime;
        events.push(e);
      }
    }
    return events;
  }
}
