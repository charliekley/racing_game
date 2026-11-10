/**
 * The simulation world: track, karts, collisions and race rules. The host
 * calls `tick(getInput)` exactly SIM_HZ times per second; it returns events
 * (lap done, wall hit, drift sparks, …) for the UI, audio and phone haptics.
 */
import type { ControlInput } from '../shared/protocol';
import { DEFAULT_LOADOUT, sanitizeLoadout, type Loadout } from '../shared/characters';
import { KART, SIM_DT, type KartConfig } from './config';
import { kartConfigFor } from './classes';
import { stepCannons, type CannonEvent } from './cannon';
import { collideKarts, collideWalls, type CollisionEvent } from './collision';
import { Colliders } from './colliders';
import type { Ground } from './ground';
import { applyBoost, cloneKart, createKart, stepKart, type KartEvent, type KartState } from './kart';
import { ItemSystem, type ItemEvent } from './items/items';
import { seededRng } from './items/odds';
import { Race, type RaceEvent } from './race';
import type { Track } from './track';
import { planScenery } from '../track/sceneryPlan';

export interface SpawnPoint {
  x: number;
  z: number;
  heading: number;
}

export type WorldEvent =
  | RaceEvent
  | CollisionEvent
  | { kind: 'boostPad'; slot: number }
  | { kind: 'respawn'; slot: number }
  | ItemEvent
  | CannonEvent
  | (KartEvent & { slot: number });

/** Wall hits softer than this (m/s) aren't reported. */
const WALL_EVENT_MIN_IMPACT = 3;
/** The carrier starts this high above the drop point (m). */
export const CARRIER_HEIGHT = 7;
/** Falling rule: respawn when this far (m) below the road surface at the kart's nearest track point... */
export const FALL_BELOW_ROAD = 5;
/** ...or below this absolute height (m), whatever the road does. */
export const FALL_FLOOR_Y = -40;

export class World {
  /** Karts by player slot index. */
  readonly karts = new Map<number, KartState>();
  /** State at the previous tick (for render interpolation). */
  readonly prevKarts = new Map<number, KartState>();
  race: Race | null = null;
  /** Item boxes, held items and item objects (null until a race starts). */
  items: ItemSystem | null = null;
  /** Solid scenery (trees, houses, grandstands…). Built from the scenery plan in startRace unless set before. */
  colliders: Colliders | null = null;
  /** What each slot picked (character + kart body). Missing = the default loadout. */
  readonly loadouts = new Map<number, Loadout>();
  /** Per-slot physics numbers made from the loadout (cached in kartConfigFor). */
  private readonly configs = new Map<number, KartConfig>();
  /** Where each respawning kart is being lowered to. */
  private respawnTargets = new Map<number, { x: number; y: number; z: number }>();

  constructor(
    readonly ground: Ground,
    readonly track: Track | null = null,
    /** Seed for the item roulette: same seed + same inputs = same race. */
    private readonly seed = 1234,
  ) {}

  /** Set (or change) a slot's loadout. The default loadout is exactly the plain KART config. */
  setLoadout(slot: number, loadout: Loadout | undefined): void {
    if (!loadout) {
      this.loadouts.delete(slot);
      this.configs.delete(slot);
      return;
    }
    const l = sanitizeLoadout(loadout);
    this.loadouts.set(slot, l);
    this.configs.set(slot, kartConfigFor(l));
  }

  /** The physics numbers of one kart (KART itself for slots without a loadout). */
  configOf(slot: number): KartConfig {
    return this.configs.get(slot) ?? KART;
  }

  addKart(slot: number, spawn: SpawnPoint): void {
    const hit = this.ground.sample(spawn.x, spawn.z);
    const k = createKart(spawn.x, spawn.z, spawn.heading, hit?.height ?? 0);
    if (hit?.index !== undefined) k.trackIndex = hit.index;
    this.karts.set(slot, k);
    this.prevKarts.set(slot, cloneKart(k));
  }

  /**
   * Put every slot on the starting grid and begin the countdown.
   * `loadouts` (optional) says which character + kart body each slot drives; slots missing
   * from it get the default loadout, which behaves exactly like the original single kart.
   */
  startRace(slots: number[], laps: number, loadouts?: ReadonlyMap<number, Loadout>): void {
    if (!this.track) throw new Error('startRace needs a track');
    this.loadouts.clear();
    this.configs.clear();
    for (const slot of slots) this.setLoadout(slot, loadouts?.get(slot) ?? DEFAULT_LOADOUT);
    this.karts.clear();
    this.prevKarts.clear();
    this.respawnTargets.clear();
    slots.forEach((slot, i) => this.addKart(slot, this.track!.gridSpot(i)));
    this.race = new Race({ length: this.track.length, checkpoints: this.track.checkpoints }, laps, slots);
    this.items = new ItemSystem(this.track, seededRng(this.seed), slots);
    this.items.configOf = (slot) => this.configOf(slot);
    // Solid scenery: same plan the renderer draws from, so what you see is what you hit.
    this.colliders ??= new Colliders(planScenery(this.track).colliders);
    this.items.setColliders(this.colliders);
  }

  tick(getInput: (slot: number) => ControlInput): WorldEvent[] {
    const events: WorldEvent[] = [];
    const inputs = new Map<number, ControlInput>();
    for (const slot of this.karts.keys()) inputs.set(slot, getInput(slot));
    const frozen = this.race?.phase === 'countdown';

    for (const [slot, kart] of this.karts) {
      this.prevKarts.set(slot, cloneKart(kart));
      if (frozen) continue; // everyone waits on the grid during the countdown
      if (kart.respawnTime > 0) {
        this.lowerByCarrier(slot, kart);
        continue;
      }
      for (const e of stepKart(kart, inputs.get(slot)!, this.ground, SIM_DT, this.configOf(slot))) events.push({ ...e, slot });
      if (kart.grounded && kart.surface === 'boost') {
        if (kart.boostTime < KART.boostPadTime * 0.5) events.push({ kind: 'boostPad', slot });
        applyBoost(kart, KART.boostPadTime);
      }
      if (this.track && !kart.flight) {
        const impact = collideWalls(kart, this.track, this.configOf(slot));
        if (impact > WALL_EVENT_MIN_IMPACT) events.push({ kind: 'wall', slot, impact });
        // Solid scenery bounces karts like walls do (and reports the same event for haptics/audio).
        const bump = this.colliders?.collideKart(kart, this.configOf(slot)) ?? 0;
        if (bump > WALL_EVENT_MIN_IMPACT) events.push({ kind: 'wall', slot, impact: bump });
        if (this.needsRespawn(kart)) {
          this.startRespawn(slot, kart);
          events.push({ kind: 'respawn', slot });
        }
      }
    }
    // Launch cannons: capture, fly and land karts; a landing credits the skipped checkpoints.
    if (this.track && !frozen) {
      for (const e of stepCannons(this.track, this.karts, SIM_DT)) {
        events.push(e);
        if (e.kind === 'cannonLand' && this.race) {
          events.push(...this.race.grantProgress(e.slot, this.track.cannons[e.cannon].landing.s));
        }
      }
    }
    if (!frozen) {
      // Karts being carried back or flying through a cannon don't bump into anything.
      const active = new Map([...this.karts].filter(([, k]) => k.respawnTime <= 0 && !k.flight));
      events.push(...collideKarts(active, KART, (slot) => this.configOf(slot).mass));
    }

    // Items run while the race is on.
    if (this.items && this.race?.phase === 'racing') {
      const finished = new Set([...this.race.racers.values()].filter((r) => r.finished).map((r) => r.slot));
      events.push(...this.items.tick(this.karts, inputs, this.race.standings(), finished));
      this.items.novaCollisions(this.karts, events as ItemEvent[]);
    }

    if (this.race && this.track) {
      const positions = new Map<number, number>();
      for (const [slot, kart] of this.karts) {
        // In a cannon the kart is nowhere near the road: report the mouth so rankings don't jump around.
        positions.set(slot, kart.flight ? this.track.cannons[kart.flight.cannon].mouth.s : this.track.project(kart.pos.x, kart.pos.z, kart.trackIndex).s);
      }
      for (const e of this.race.tick(SIM_DT, positions, inputs)) {
        if (e.kind === 'startBoost') applyBoost(this.karts.get(e.slot)!, KART.startBoostTime);
        if (e.kind === 'stall') this.karts.get(e.slot)!.stallTime = KART.startStallTime;
        events.push(e);
      }
    }
    return events;
  }

  /**
   * Fell off the road (into water, a chasm, off a cliff or bridge) or off the
   * world, or wandered far off course for a while. "Fell" is relative to the
   * road: more than FALL_BELOW_ROAD below the road at the nearest track point,
   * so elevated roads and hills don't cause false respawns.
   */
  private needsRespawn(k: KartState): boolean {
    if (k.pos.y < FALL_FLOOR_Y) return true;
    const track = this.track!;
    const p = track.project(k.pos.x, k.pos.z, k.trackIndex);
    if (k.pos.y < p.y - FALL_BELOW_ROAD) return true;
    const outside = Math.abs(p.d) - (p.width / 2 + track.def.offroadWidth);
    k.offTrackTime = outside > KART.offTrackDistance ? k.offTrackTime + SIM_DT : 0;
    return k.offTrackTime > KART.offTrackRespawnTime;
  }

  /**
   * Respawn point: the start of the last checkpoint section the kart has
   * reached (so no progress is gained), a little way in, on the centerline.
   */
  private startRespawn(slot: number, k: KartState): void {
    const track = this.track!;
    let s: number;
    const racer = this.race?.racers.get(slot);
    if (racer && this.race!.phase !== 'countdown') {
      const cps = track.checkpoints;
      s = cps[(racer.next - 1 + cps.length) % cps.length] + 6;
    } else {
      s = track.project(k.pos.x, k.pos.z, k.trackIndex).s - 20;
    }
    // Never drop anyone into the water.
    while (track.inGap(s)) s -= 4;
    const lateral = ((slot % 3) - 1) * 2.5; // don't stack karts that fall in together
    const p = track.pointAt(s, lateral);
    const ground = track.sample(p.x, p.z, p.index);
    const y = ground?.height ?? p.y;
    Object.assign(k, {
      pos: { x: p.x, y: y + CARRIER_HEIGHT, z: p.z },
      vel: { x: 0, y: 0, z: 0 },
      heading: p.heading,
      speed: 0,
      yawRate: 0,
      grounded: false,
      boostTime: 0,
      driftDir: 0,
      driftCharge: 0,
      driftTier: 0,
      hopping: false,
      trickable: false,
      trickDone: false,
      offTrackTime: 0,
      trackIndex: p.index,
      respawnTime: KART.respawnTime,
    });
    this.respawnTargets.set(slot, { x: p.x, y, z: p.z });
  }

  /** Carrier phase: ease the kart down onto the track, then hand back control. */
  private lowerByCarrier(slot: number, k: KartState): void {
    const target = this.respawnTargets.get(slot);
    k.respawnTime = Math.max(0, k.respawnTime - SIM_DT);
    if (!target) return;
    const t = k.respawnTime / KART.respawnTime; // 1 -> 0
    k.pos.x = target.x;
    k.pos.z = target.z;
    k.pos.y = target.y + CARRIER_HEIGHT * t * t; // slows down as it nears the ground
    if (k.respawnTime === 0) {
      k.pos.y = target.y;
      k.grounded = true;
      k.surface = 'road';
      this.respawnTargets.delete(slot);
    }
  }
}
