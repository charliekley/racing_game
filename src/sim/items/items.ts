/**
 * Item system: item boxes, roulette, held items, and the objects items create
 * (peels (internal id `slick`), ricochet shots, seeker shots) plus the two kart effects Rocket and Storm. Pure simulation:
 * no Three.js, no DOM, no Math.random (a seeded generator is injected), so it stays testable.
 *
 * Controls (the phone's ITEM button, edge-detected here):
 *  - Dash and Nova fire the instant you press ITEM.
 *  - Slick, Ricochet and Seeker: a quick TAP fires at once (Slick drops behind you,
 *    shots fly forward; hold BRAKE for a backward Ricochet). HOLD instead and the
 *    item is dragged behind you as a shield; release to fire/drop it.
 *  - A Peel/Slick (dragged or dropped) destroys any shot that hits it.
 *  - Seeker: homing shot that FOLLOWS THE ROAD toward the racer ahead (see rail.ts), homing in directly when close.
 *  - Rocket: the kart is driven along the road by this system for a few seconds (`driveRocket`, called by the
 *    World instead of the normal kart physics): invincible, very fast, knocks other karts aside.
 *  - Storm: shrinks every racer ahead (state lives on the karts: size / shrinkTime / zapTime, see kart.ts).
 *
 * Adding a new item: add its id to `types.ts`, a case in `use()` below
 * (what happens on use), and a row in `odds.ts`.
 */
import { Buttons, type ControlInput } from '../../shared/protocol';
import { ITEMS, KART, SIM_DT, type KartConfig } from '../config';
import { applyBoost, forwardOf, rightOf, spinOut, type KartState } from '../kart';
import { groundPose } from './groundPose';
import type { Colliders } from '../colliders';
import type { Ground } from '../ground';
import type { Track } from '../track';
import { angleDiff, railAim, steerToward } from './rail';
import { rollItem } from './odds';
import { ROULETTE_SECONDS, type HeldItem, type ItemBox, type ItemEntity, type ItemId } from './types';

export type HitSource = 'slick' | 'ricochet' | 'seeker' | 'nova' | 'rocket' | 'storm';

/** Shots are the fast projectiles; the other entity kinds are traps (peel) or effects tied to a kart. */
const isShot = (e: { kind: string }) => e.kind === 'ricochet' || e.kind === 'seeker';

/** A kart being shoved sideways (by the Rocket): it slides `dx,dz` metres per second for `time` more seconds. */
interface Shove {
  slot: number;
  dx: number;
  dz: number;
  time: number;
}

export type ItemEvent =
  | { kind: 'itemBox'; slot: number }
  | { kind: 'itemGet'; slot: number; item: HeldItem }
  | { kind: 'itemUse'; slot: number; id: ItemId }
  | { kind: 'hit'; slot: number; by: HitSource; attacker: number | null }
  | { kind: 'blocked'; slot: number; by: HitSource }
  /** `slot`'s steering was flipped by `attacker`'s Jumble. */
  | { kind: 'jumbled'; slot: number; attacker: number }
  /** `attacker`'s Storm struck `slot`: it loses its item, spins out and shrinks. */
  | { kind: 'shrunk'; slot: number; attacker: number }
  /** A full-size kart (`by`) drove over the shrunk kart `slot` and flattened it. */
  | { kind: 'squashed'; slot: number; by: number }
  /** `slot`'s Rocket ran out: the kart is a normal kart again. */
  | { kind: 'rocketEnd'; slot: number }
  /** A shot and a Slick cancelled each other out at (x, z). */
  | { kind: 'itemDestroyed'; x: number; z: number };

/** Per-player item state. */
export interface ItemState {
  held: HeldItem | null;
  /** Seconds of roulette left (> 0 while spinning). */
  roulette: number;
  /** Seconds the current item has been held (for bots, UI). */
  heldFor: number;
  /** ITEM was down last tick. */
  wasDown: boolean;
  /** Pressed while holding a trailable item; counts how long it has been held. */
  pressing: boolean;
  holdTime: number;
  /** Item is being dragged behind the kart. */
  trailing: boolean;
}

/** Internal entity: the public ItemEntity plus simulation data. */
interface Entity extends ItemEntity {
  speed: number;
  age: number;
  bounces: number;
  target: number | null;
  /** Seconds before it can hurt its owner. */
  grace: number;
  trackIndex: number;
}

type Standings = number[]; // slots, first place first

export class ItemSystem {
  readonly boxes: ItemBox[];
  readonly states = new Map<number, ItemState>();
  private entities: Entity[] = [];
  private nextUid = 1;
  /** Karts that are rockets right now, with the seconds they have left. */
  private readonly rockets = new Map<number, { time: number }>();
  private shoves: Shove[] = [];
  /** Solid scenery that destroys shots (null = shots fly through everything, as before). */
  private colliders: Colliders | null = null;

  /** Let solid scenery (trees, housesâ€¦) stop Ricochet and Seeker shots. */
  setColliders(colliders: Colliders | null): void {
    this.colliders = colliders;
  }

  /** Each kart's own physics numbers (set by the World), so a hit's spin-out can depend on the kart's weight. */
  configOf: (slot: number) => KartConfig = () => KART;

  constructor(
    private readonly track: Track,
    private readonly rng: () => number,
    slots: number[],
  ) {
    this.boxes = track.itemBoxes.map((b) => ({ ...b, active: true, respawn: 0 }));
    for (const s of slots) this.states.set(s, newState());
  }

  /** Public, render-ready view of every item object in the world. */
  get entityList(): readonly ItemEntity[] {
    return this.entities;
  }

  /** What the phone / HUD should show for a player. */
  displayFor(slot: number): { kind: 'none' } | { kind: 'roulette' } | { kind: 'item'; id: ItemId; count: number } {
    const st = this.states.get(slot);
    if (!st) return { kind: 'none' };
    if (st.roulette > 0) return { kind: 'roulette' };
    if (st.held) return { kind: 'item', id: st.held.id, count: st.held.count };
    return { kind: 'none' };
  }

  /**
   * Advance one fixed step.
   * @param standings  slots in race order (first place first)
   * @param finished   slots that have finished the race (they can't pick up items)
   */
  tick(
    karts: Map<number, KartState>,
    inputs: Map<number, ControlInput>,
    standings: Standings,
    finished: Set<number>,
    /** What shots glide over. The World passes the hazard-aware ground (raised drawbridge leaves); default: the track. */
    ground: Ground = this.track,
  ): ItemEvent[] {
    const events: ItemEvent[] = [];
    const racers = standings.length;
    const dt = SIM_DT;
    this.lastStandings = standings;
    this.lastFinished = finished;
    // A rocket that finishes the race (or is knocked out) turns back into a kart.
    for (const slot of [...this.rockets.keys()]) {
      const rk = karts.get(slot);
      if (rk && finished.has(slot)) this.endRocket(slot, rk, events);
    }

    // --- Boxes: respawn timers and pick-ups -----------------------------------------
    for (const box of this.boxes) {
      if (!box.active) {
        box.respawn -= dt;
        if (box.respawn <= 0) box.active = true;
        continue;
      }
      for (const [slot, k] of karts) {
        const st = this.states.get(slot);
        if (!st || finished.has(slot) || k.respawnTime > 0 || this.rockets.has(slot)) continue; // (a rocket's hands are full)
        const dx = k.pos.x - box.x;
        const dz = k.pos.z - box.z;
        if (dx * dx + dz * dz > ITEMS.boxRadius * ITEMS.boxRadius || Math.abs(k.pos.y - box.y) > 3) continue;
        if (st.held || st.roulette > 0) continue; // hands full: the box stays
        st.roulette = ROULETTE_SECONDS;
        box.active = false;
        box.respawn = ITEMS.boxRespawn;
        events.push({ kind: 'itemBox', slot });
        break;
      }
    }

    // --- Per player: roulette, ITEM button ---------------------------------------------
    for (const [slot, st] of this.states) {
      const k = karts.get(slot);
      if (!k) continue;
      if (st.held) st.heldFor += dt;

      if (st.roulette > 0) {
        st.roulette -= dt;
        if (st.roulette <= 0) {
          st.roulette = 0;
          const position = standings.indexOf(slot) + 1 || racers;
          st.held = rollItem(position, racers, this.rng);
          st.heldFor = 0;
          events.push({ kind: 'itemGet', slot, item: { ...st.held } });
        }
      }

      const input = inputs.get(slot);
      const down = !!input && (input.buttons & Buttons.ITEM) !== 0;
      const pressedNow = down && !st.wasDown;
      const releasedNow = !down && st.wasDown;
      st.wasDown = down;
      if (k.spinTime > 0 || k.respawnTime > 0 || k.flight || this.rockets.has(slot)) continue; // can't act while spinning / being carried / in a cannon
      if (!st.held || st.roulette > 0) {
        st.pressing = false;
        continue;
      }

      const id = st.held.id;
      const trailable = id === 'slick' || id === 'ricochet' || id === 'seeker';
      if (pressedNow) {
        if (trailable) {
          st.pressing = true;
          st.holdTime = 0;
        } else {
          this.use(slot, k, st, events, false, karts);
        }
      } else if (st.pressing && down) {
        st.holdTime += dt;
        if (st.holdTime >= ITEMS.tapSeconds && !st.trailing) {
          st.trailing = true;
          if (id === 'slick') this.spawnSlick(slot, k, true);
        }
      } else if (st.pressing && releasedNow) {
        const backward = !!input && (input.buttons & Buttons.BRAKE) !== 0;
        this.use(slot, k, st, events, backward, karts);
      }
    }

    // --- Objects ------------------------------------------------------------------------
    this.updateEntities(karts, events, dt, ground);
    return events;
  }

  /** A kart got hit by something: spin out (unless Nova protects it). Returns true if it hit. */
  private hitKart(slot: number, karts: Map<number, KartState>, by: HitSource, attacker: number | null, events: ItemEvent[]): boolean {
    const k = karts.get(slot);
    if (!k) return false;
    if (k.flight) return false; // inside a launch cannon: nothing can touch you
    if (this.rockets.has(slot)) return false; // a Rocket is invincible
    if (k.invulnTime > 0) return false; // just been hit: no chain-hits (the item passes through)
    if (k.starTime > 0) {
      events.push({ kind: 'blocked', slot, by });
      return false;
    }
    spinOut(k, this.configOf(slot));
    // A hit while dragging an item loses it (a dragged Slick is left on the road).
    const st = this.states.get(slot);
    if (st) this.cancelHold(slot, st, true);
    events.push({ kind: 'hit', slot, by, attacker });
    return true;
  }

  /** Stop dragging. If `lose`, the dragged item is gone (a dragged Slick stays where it is). */
  private cancelHold(slot: number, st: ItemState, lose: boolean): void {
    if (!st.trailing && !st.pressing) return;
    if (st.trailing && st.held?.id === 'slick') {
      const e = this.entities.find((x) => x.kind === 'slick' && x.owner === slot && x.trailing);
      if (e) {
        e.trailing = false;
        e.grace = ITEMS.ownerGrace;
      }
    }
    st.pressing = false;
    st.trailing = false;
    if (lose) st.held = null;
  }

  // --- Using items ------------------------------------------------------------------------
  /**
   * Flip the steering of the racers just ahead of `slot` in the race (Nova protects).
   * Only the nearest `ITEMS.jumbleReach` of them: it is a rare comeback tool, not a field-wide curse.
   */
  private jumbleAhead(slot: number, karts: Map<number, KartState>, events: ItemEvent[]): void {
    const rank = this.lastStandings.indexOf(slot);
    for (let i = Math.max(0, rank - ITEMS.jumbleReach); i < rank; i++) {
      const victim = this.lastStandings[i];
      const vk = karts.get(victim);
      if (!vk || vk.respawnTime > 0 || vk.flight) continue;
      if (vk.starTime > 0) {
        events.push({ kind: 'blocked', slot: victim, by: 'nova' });
        continue;
      }
      vk.invertTime = ITEMS.jumbleTime;
      events.push({ kind: 'jumbled', slot: victim, attacker: slot });
    }
  }

  private use(slot: number, k: KartState, st: ItemState, events: ItemEvent[], backward: boolean, karts: Map<number, KartState>): void {
    const held = st.held;
    if (!held) return;
    const wasTrailing = st.trailing;
    st.pressing = false;
    st.trailing = false;
    switch (held.id) {
      case 'dash':
        applyBoost(k, held.count > 1 ? ITEMS.tripleBoostTime : ITEMS.dashBoostTime);
        break;
      case 'nova':
        k.starTime = KART.novaTime;
        break;
      case 'slick': {
        const trailing = this.entities.find((e) => e.kind === 'slick' && e.owner === slot && e.trailing);
        if (trailing) {
          trailing.trailing = false; // drop where it is
          trailing.grace = ITEMS.ownerGrace;
        } else if (!wasTrailing) {
          this.spawnSlick(slot, k, false);
        }
        break;
      }
      case 'jumble':
        this.jumbleAhead(slot, karts, events);
        break;
      case 'storm':
        this.stormAhead(slot, karts, events);
        break;
      case 'rocket':
        this.startRocket(slot, k, st);
        break;
      case 'ricochet':
        this.spawnShot('ricochet', slot, k, backward);
        break;
      case 'seeker':
        this.spawnShot('seeker', slot, k, false);
        break;
    }
    events.push({ kind: 'itemUse', slot, id: held.id });
    held.count -= 1;
    st.heldFor = 0;
    if (held.count <= 0) st.held = null;
  }

  private spawnSlick(owner: number, k: KartState, trailing: boolean): void {
    // Keep the number of slicks on the road bounded: the oldest one goes first.
    const slicks = this.entities.filter((e) => e.kind === 'slick' && !e.trailing);
    if (slicks.length >= ITEMS.maxSlicks) this.remove(slicks[0]);
    const fx = Math.sin(k.heading);
    const fz = Math.cos(k.heading);
    const x = k.pos.x - fx * ITEMS.trailDistance;
    const z = k.pos.z - fz * ITEMS.trailDistance;
    const pose = groundPose(this.track, x, z, k.heading, k.trackIndex, k.pos.y);
    this.entities.push({
      uid: this.nextUid++,
      kind: 'slick',
      x,
      y: pose.y,
      z,
      pitch: pose.pitch,
      roll: pose.roll,
      heading: k.heading,
      owner,
      trailing,
      speed: 0,
      age: 0,
      bounces: 0,
      target: null,
      grace: ITEMS.ownerGrace,
      trackIndex: k.trackIndex,
    });
  }

  private spawnShot(kind: 'ricochet' | 'seeker', owner: number, k: KartState, backward: boolean): void {
    const heading = backward ? k.heading + Math.PI : k.heading;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    this.entities.push({
      uid: this.nextUid++,
      kind,
      x: k.pos.x + fx * ITEMS.muzzleDistance,
      y: k.pos.y,
      z: k.pos.z + fz * ITEMS.muzzleDistance,
      heading,
      owner,
      trailing: false,
      speed: kind === 'ricochet' ? ITEMS.ricochetSpeed : ITEMS.seekerSpeed,
      age: 0,
      bounces: 0,
      target: kind === 'seeker' ? this.targetAhead(owner) : null,
      grace: 0.25,
      trackIndex: k.trackIndex,
    });
  }

  private lastStandings: Standings = [];
  /** Slots that had finished the race (or were knocked out) at the last tick. */
  private lastFinished: ReadonlySet<number> = new Set();

  private targetAhead(owner: number): number | null {
    const i = this.lastStandings.indexOf(owner);
    return i > 0 ? this.lastStandings[i - 1] : null;
  }

  private remove(e: Entity): void {
    const i = this.entities.indexOf(e);
    if (i >= 0) this.entities.splice(i, 1);
  }

  // --- Objects: movement and collisions -------------------------------------------------------
  private updateEntities(karts: Map<number, KartState>, events: ItemEvent[], dt: number, ground: Ground): void {
    const dead = new Set<Entity>();
    const slicks = this.entities.filter((e) => e.kind === 'slick');
    this.applyShoves(karts, dt);

    for (const e of this.entities) {
      e.age += dt;
      e.grace = Math.max(0, e.grace - dt);

      if (e.kind === 'slick') {
        if (e.trailing) {
          const owner = karts.get(e.owner);
          if (!owner) {
            dead.add(e);
            continue;
          }
          e.x = owner.pos.x - Math.sin(owner.heading) * ITEMS.trailDistance;
          e.z = owner.pos.z - Math.cos(owner.heading) * ITEMS.trailDistance;
          e.heading = owner.heading;
          const pose = groundPose(this.track, e.x, e.z, e.heading, owner.trackIndex, owner.pos.y);
          e.y = pose.y;
          e.pitch = pose.pitch;
          e.roll = pose.roll;
          continue; // a dragged slick doesn't hurt anyone (it shields its owner)
        }
        // A dropped peel settles on the ground (re-checked now and then: e.g. a drawbridge may have moved).
        if (Math.round(e.age / dt) % 30 === 1) {
          const p = this.track.project(e.x, e.z, e.trackIndex);
          e.trackIndex = p.index;
          const pose = groundPose(this.track, e.x, e.z, e.heading, e.trackIndex, e.y);
          e.y = pose.y;
          e.pitch = pose.pitch;
          e.roll = pose.roll;
        }
        if (e.age > ITEMS.slickLifetime) dead.add(e);
        continue;
      }
      // Shots
      const life = e.kind === 'ricochet' ? ITEMS.ricochetLifetime : ITEMS.seekerLifetime;
      if (e.age > life) {
        dead.add(e);
        continue;
      }
      const homing = e.kind === 'seeker' ? this.steerSeeker(e, karts, dt) : null;
      e.x += Math.sin(e.heading) * e.speed * dt;
      e.z += Math.cos(e.heading) * e.speed * dt;
      const p = this.track.project(e.x, e.z, e.trackIndex);
      e.trackIndex = p.index;
      e.y = followGround(ground, e, dt);
      if (homing) e.y = climbToTarget(ground, e, homing, dt);

      // Scenery: a shot that runs into a solid tree/house/etc. is destroyed.
      if (this.colliders?.blocksPoint(e.x, e.z, e.kind === 'ricochet' ? ITEMS.ricochetRadius : ITEMS.seekerRadius, e.y)) {
        dead.add(e);
        events.push({ kind: 'itemDestroyed', x: e.x, z: e.z });
        continue;
      }
      if (e.kind === 'ricochet' && !this.bounceOffWalls(e, p)) {
        dead.add(e);
        continue;
      }
      // Wandered off the track area entirely (no walls there): gone.
      const edge = p.width / 2 + this.track.def.offroadWidth + 14;
      if (Math.abs(p.d) > edge) {
        dead.add(e);
        continue;
      }
    }

    // Shots vs slicks: both are destroyed.
    for (const e of this.entities) {
      if (dead.has(e) || !isShot(e)) continue;
      for (const sl of slicks) {
        if (dead.has(sl)) continue;
        const d = Math.hypot(e.x - sl.x, e.z - sl.z);
        if (d < ITEMS.slickRadius + 0.6) {
          dead.add(e);
          dead.add(sl);
          events.push({ kind: 'itemDestroyed', x: sl.x, z: sl.z });
          if (sl.trailing) {
            // The shield took the hit: the owner's Slick is used up.
            const st = this.states.get(sl.owner);
            if (st) Object.assign(st, { held: null, trailing: false, pressing: false });
          }
          break;
        }
      }
    }

    // Objects vs karts.
    for (const e of this.entities) {
      if (dead.has(e) || e.trailing) continue;
      const r = e.kind === 'slick' ? ITEMS.slickRadius : e.kind === 'ricochet' ? ITEMS.ricochetRadius : ITEMS.seekerRadius;
      for (const [slot, k] of karts) {
        if (k.respawnTime > 0 || k.spinTime > 0 || k.invulnTime > 0 || k.flight) continue; // protected karts: shots and slicks pass through
        if (slot === e.owner && e.grace > 0) continue;
        if (e.kind === 'slick' && !k.grounded) continue; // jumping over a slick is fine
        if (Math.abs(k.pos.y - e.y) > 2.2) continue;
        const d = Math.hypot(k.pos.x - e.x, k.pos.z - e.z);
        if (d < r + KART.radius * 0.6 * k.size) {
          this.hitKart(slot, karts, e.kind, e.owner, events);
          dead.add(e); // consumed whether it hurt (spin) or was blocked (Nova)
          break;
        }
      }
    }
    for (const e of dead) this.remove(e);
  }

  // --- Rocket --------------------------------------------------------------------------------------
  /** Is this kart a rocket right now? (The World then calls `driveRocket` instead of the normal kart physics.) */
  rocketActive(slot: number): boolean {
    return this.rockets.has(slot);
  }

  /** The kart turns into a rocket: it sheds whatever it was doing and the automatic flight begins. */
  private startRocket(slot: number, k: KartState, st: ItemState): void {
    this.rockets.set(slot, { time: ITEMS.rocketTime });
    k.rocketTime = ITEMS.rocketTime;
    k.spinTime = 0;
    k.invertTime = 0;
    k.boostTime = 0;
    k.driftDir = 0;
    k.driftCharge = 0;
    k.driftTier = 0;
    k.hopping = false;
    k.shrinkTime = 0; // a rocket is full size and never squashed
    k.size = 1;
    k.squashTime = 0;
    st.pressing = false;
    st.trailing = false;
  }

  /**
   * One tick of a Rocket kart (replaces `stepKart` for it). The kart steers itself along the road (pure pursuit on
   * the track's centerline, see rail.ts), accelerates to `rocketSpeed` and glides over the ground like a shot does.
   * Over a ravine, a water gap or a ramp gap there is no ground, so it just keeps its height and the road line:
   * it cannot fall in. A launch cannon still captures it (the cannon system moves it, then it flies on).
   * After `rocketTime` the kart returns to normal with a small boost and a short grace period.
   */
  driveRocket(slot: number, k: KartState, ground: Ground, dt: number, events: ItemEvent[]): void {
    const r = this.rockets.get(slot);
    if (!r) return;
    r.time -= dt;
    k.rocketTime = Math.max(0, r.time);
    k.invulnTime = Math.max(k.invulnTime, 0.1); // hazards and shots pass through a rocket
    if (r.time <= 0) {
      this.endRocket(slot, k, events);
      return;
    }
    if (k.flight) return; // inside a launch cannon: the cannon moves the kart
    k.spinTime = 0;
    k.invertTime = 0;
    k.driftDir = 0;
    k.hopping = false;
    k.trickable = false;

    // Speed up to the rocket speed.
    k.speed = Math.min(ITEMS.rocketSpeed, Math.max(0, k.speed) + ITEMS.rocketAccel * dt);

    // Steer along the road: aim at a point a little way down the centerline.
    const aim = railAim(this.track, k.pos.x, k.pos.z, k.trackIndex, ITEMS.rocketLookahead + k.speed * 0.2);
    const h0 = k.heading;
    k.heading = steerToward(k.heading, k.pos.x, k.pos.z, aim.x, aim.z, ITEMS.rocketTurnRate * dt);
    k.yawRate = angleDiff(h0, k.heading) / dt;
    k.steer = Math.max(-1, Math.min(1, -k.yawRate / ITEMS.rocketTurnRate));

    // Move, and follow the ground (or hold the height over a gap).
    const f = forwardOf(k.heading);
    k.vel.x = f.x * k.speed;
    k.vel.z = f.z * k.speed;
    k.pos.x += k.vel.x * dt;
    k.pos.z += k.vel.z * dt;
    const probe = { x: k.pos.x, z: k.pos.z, heading: k.heading, speed: k.speed, y: k.pos.y, trackIndex: k.trackIndex };
    const y = followGround(ground, probe, dt);
    const here = ground.sample(k.pos.x, k.pos.z, k.trackIndex);
    k.vel.y = (y - k.pos.y) / dt;
    k.pos.y = y;
    k.grounded = !!here && y <= here.height + 0.3;
    if (here) k.surface = here.surface;
    k.trackIndex = this.track.project(k.pos.x, k.pos.z, k.trackIndex).index;
    k.offTrackTime = 0;
  }

  /** The race ended (or the kart left it) while it was a rocket: quietly make it a normal kart again. */
  cancelRocket(slot: number, k: KartState): void {
    if (!this.rockets.delete(slot)) return;
    k.rocketTime = 0;
  }

  /** The Rocket is over: back to a normal kart, with a small boost and a grace period so it does not land into a pile. */
  private endRocket(slot: number, k: KartState, events: ItemEvent[]): void {
    this.rockets.delete(slot);
    k.rocketTime = 0;
    const c = this.configOf(slot);
    k.speed = Math.min(k.speed, c.maxSpeed * c.boostSpeedFactor);
    const f = forwardOf(k.heading);
    k.vel.x = f.x * k.speed;
    k.vel.z = f.z * k.speed;
    applyBoost(k, ITEMS.rocketEndBoost);
    k.invulnTime = Math.max(k.invulnTime, ITEMS.rocketGrace);
    events.push({ kind: 'rocketEnd', slot });
  }

  /** Rockets knock aside every full-size kart they touch (it spins out and is shoved sideways). */
  private rocketCollisions(karts: Map<number, KartState>, events: ItemEvent[]): void {
    for (const [sa] of this.rockets) {
      const a = karts.get(sa);
      if (!a || a.flight || a.respawnTime > 0) continue;
      const right = rightOf(a.heading);
      for (const [sb, b] of karts) {
        if (sb === sa || this.rockets.has(sb) || b.respawnTime > 0 || b.flight || b.starTime > 0) continue;
        if (b.size < ITEMS.shrunkBelow) continue; // tiny karts are squashed instead (see squashChecks)
        if (Math.abs(a.pos.y - b.pos.y) > 2) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        if (Math.hypot(dx, dz) > ITEMS.rocketReach) continue;
        if (!this.hitKart(sb, karts, 'rocket', sa, events)) continue;
        const side = dx * right.x + dz * right.z >= 0 ? 1 : -1; // away from the rocket's path
        const rate = ITEMS.rocketShove / ITEMS.rocketShoveTime;
        this.shoves.push({ slot: sb, dx: right.x * side * rate, dz: right.z * side * rate, time: ITEMS.rocketShoveTime });
      }
    }
  }

  // --- Storm (lightning) ------------------------------------------------------------------------------
  /**
   * The user fires the Storm: a dark cloud appears over every racer AHEAD of them at once. Each victim loses its
   * item, spins out and shrinks; the lower its race position the sooner it is full size again (see ITEMS.stormTime*).
   * Rockets and Nova karts are not affected; karts behind the user are not either.
   */
  private stormAhead(slot: number, karts: Map<number, KartState>, events: ItemEvent[]): void {
    const standings = this.lastStandings;
    const rank = standings.indexOf(slot);
    const racers = standings.length;
    for (let i = 0; i < rank; i++) {
      const victim = standings[i];
      const vk = karts.get(victim);
      const st = this.states.get(victim);
      if (!vk || this.lastFinished.has(victim)) continue;
      if (this.rockets.has(victim)) continue; // a Rocket is invincible
      if (vk.starTime > 0) {
        events.push({ kind: 'blocked', slot: victim, by: 'nova' });
        continue;
      }
      // Lose the item (a dragged Peel stays on the road).
      if (st) {
        this.cancelHold(victim, st, true);
        st.held = null;
        st.heldFor = 0;
      }
      // Shrink for a time that depends on the position: first place longest, last place shortest.
      const u = racers <= 1 ? 0.5 : (racers - (i + 1)) / (racers - 1);
      const total = ITEMS.stormTimeLast + (ITEMS.stormTimeFirst - ITEMS.stormTimeLast) * u;
      const age = vk.shrinkTime > 0 ? vk.shrinkTotal - vk.shrinkTime : 0; // already small: keep the size continuous
      vk.shrinkTime = Math.max(vk.shrinkTime, total);
      vk.shrinkTotal = age + vk.shrinkTime;
      vk.zapTime = ITEMS.stormZapSeconds;
      // Spin out (even right after another hit: a lightning strike is not skipped), unless in a cannon or on the carrier.
      if (!vk.flight && vk.respawnTime <= 0) {
        spinOut(vk, this.configOf(victim));
        events.push({ kind: 'hit', slot: victim, by: 'storm', attacker: slot });
      }
      events.push({ kind: 'shrunk', slot: victim, attacker: slot });
    }
  }

  /**
   * A full-size kart driving over a shrunk one flattens it: it is slowed for a moment (see ITEMS.squash*).
   * (The World lets full-size and shrunk karts pass through each other, so "driving over" really happens.)
   */
  private squashChecks(karts: Map<number, KartState>, events: ItemEvent[]): void {
    for (const [sb, b] of karts) {
      if (b.size >= ITEMS.shrunkBelow || b.squashTime > 0 || b.flight || b.respawnTime > 0) continue;
      for (const [sa, a] of karts) {
        if (sa === sb || a.size < ITEMS.fullSizeAbove || a.flight || a.respawnTime > 0 || a.speed < 3) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 1.5) continue;
        if (Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) > KART.radius) continue;
        b.squashTime = ITEMS.squashTime;
        b.speed *= ITEMS.squashSpeedKept;
        b.vel.x *= ITEMS.squashSpeedKept;
        b.vel.z *= ITEMS.squashSpeedKept;
        b.boostTime = 0;
        b.driftDir = 0;
        b.driftCharge = 0;
        b.driftTier = 0;
        events.push({ kind: 'squashed', slot: sb, by: sa });
        break;
      }
    }
  }

  /** Slide the karts that were shoved (the push is spread over a fraction of a second so it looks like a shove). */
  private applyShoves(karts: Map<number, KartState>, dt: number): void {
    if (this.shoves.length === 0) return;
    for (const s of this.shoves) {
      const k = karts.get(s.slot);
      if (k && k.respawnTime <= 0 && !k.flight) {
        k.pos.x += s.dx * dt;
        k.pos.z += s.dz * dt;
      }
      s.time -= dt;
    }
    this.shoves = this.shoves.filter((s) => s.time > 0);
  }

  /** Reflect a ricochet off a wall. Returns false when it has used up its bounces. */
  private bounceOffWalls(e: Entity, p: { i: number; route: number; d: number }): boolean {
    const walls = this.track.wallsAt(p.i, p.route);
    const sample = this.track.sampleOf(p.route, p.i);
    for (const side of ['left', 'right'] as const) {
      const wall = walls[side];
      if (wall === null) continue;
      const sign = side === 'right' ? 1 : -1;
      if (sign * p.d <= Math.abs(wall) - 0.5) continue;
      const nx = sign * sample.rx; // outward wall normal
      const nz = sign * sample.rz;
      const vx = Math.sin(e.heading);
      const vz = Math.cos(e.heading);
      const vOut = vx * nx + vz * nz;
      if (vOut <= 0) continue;
      const rx = vx - 2 * vOut * nx;
      const rz = vz - 2 * vOut * nz;
      e.heading = Math.atan2(rx, rz);
      // Put it back inside the wall so it doesn't bounce twice.
      const over = sign * p.d - (Math.abs(wall) - 0.5);
      e.x -= nx * (over + 0.1);
      e.z -= nz * (over + 0.1);
      e.bounces++;
      if (e.bounces > ITEMS.ricochetBounces) return false;
    }
    return true;
  }

  /**
   * Steer a Seeker for one tick. It follows the ROAD toward the racer ahead (like a red shell in other kart games):
   *  - far from its target it aims at a point a little way down the track's centerline (rail.ts), so corners, hairpins,
   *    jumps, ravines and cannons are followed through the air without hitting walls or falling in;
   *  - near the target (within `seekerHomeRange` metres, on the same stretch of road) it homes in on it directly;
   *  - if its target is passed, out of play or cannot be hit right now (just hit itself) it goes for the next racer up the standings; with nobody ahead at all
   *    (the leader fired it) it simply follows the road, hitting whatever it meets, until its time runs out.
   * Returns the target kart while it is homing directly (the caller then also matches height), otherwise null.
   */
  private steerSeeker(e: Entity, karts: Map<number, KartState>, dt: number): KartState | null {
    const track = this.track;
    const here = track.project(e.x, e.z, e.trackIndex);
    const info = (k: KartState) => {
      // A kart inside a launch cannon is nowhere near the road: it counts as being at the cannon's mouth, or at its
      // landing point once it is flying (so the shot keeps following the road through the sky gap toward it).
      if (k.flight) {
        const c = track.cannons[k.flight.cannon];
        return { gap: track.deltaS(here.s, k.flight.phase === 'air' ? c.landing.s : c.mouth.s), d: 0, route: 0 };
      }
      const p = track.project(k.pos.x, k.pos.z, k.trackIndex);
      return { gap: track.deltaS(here.s, p.s), d: p.d, route: p.route };
    };
    // The target: the racer ahead of the owner in the race. If we flew past it (or it is out of play, e.g. being
    // carried back after a fall), go for whoever is ahead of THAT racer, and so on up the standings.
    let t: KartState | undefined;
    let ti: ReturnType<typeof info> | null = null;
    let target = e.target;
    for (let guard = 0; target !== null && guard < 16; guard++) {
      const k = karts.get(target);
      const i = k ? info(k) : null;
      if (k && i && k.respawnTime <= 0 && k.invulnTime <= 0 && k.spinTime <= 0 && i.gap >= -SEEKER_PASSED) {
        t = k;
        ti = i;
        break;
      }
      const idx = this.lastStandings.indexOf(target);
      target = idx > 0 ? this.lastStandings[idx - 1] : null;
    }
    e.target = target;
    // Close and on the same stretch of road: home in directly.
    if (t && ti && !t.flight && Math.hypot(t.pos.x - e.x, t.pos.z - e.z) < ITEMS.seekerHomeRange && ti.gap < ITEMS.seekerHomeRange + 6) {
      e.heading = steerToward(e.heading, e.x, e.z, t.pos.x, t.pos.z, ITEMS.seekerTurnRate * dt);
        return t;
    }
    // Otherwise follow the road, lined up with the target's side of it (and onto its branch if it took a shortcut).
    const half = here.width / 2 - 1.2;
    const lane = ti && ti.route === 0 ? Math.max(-half, Math.min(half, ti.d)) : 0;
    const aim = railAim(track, e.x, e.z, e.trackIndex, ITEMS.seekerLookahead + e.speed * 0.15, lane, ti ? ti.route : 0);
    e.heading = steerToward(e.heading, e.x, e.z, aim.x, aim.z, ITEMS.seekerRailTurnRate * dt);
    return null;
  }

  /**
   * Everything kart-on-kart that items cause: Nova bumps, Rocket knock-asides and squashing of shrunk karts.
   * Called by the world after kart-vs-kart collision resolution.
   */
  bodyCollisions(karts: Map<number, KartState>, events: ItemEvent[]): void {
    this.novaCollisions(karts, events);
    this.rocketCollisions(karts, events);
    this.squashChecks(karts, events);
  }

  /** Nova bump: an invincible kart sends any kart it touches into a spin-out. */
  novaCollisions(karts: Map<number, KartState>, events: ItemEvent[]): void {
    const list = [...karts.entries()];
    const reach = KART.radius * 2 + 0.4;
    for (const [sa, a] of list) {
      if (a.starTime <= 0 || a.respawnTime > 0 || a.flight) continue;
      for (const [sb, b] of list) {
        if (sa === sb || b.respawnTime > 0 || b.spinTime > 0 || b.invulnTime > 0 || b.flight) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 1.5) continue;
        if (Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) > reach) continue;
        this.hitKart(sb, karts, 'nova', sa, events);
      }
    }
  }
}

/** A Seeker that is more than this many metres (along the road) past its target gives up on it and goes for the next racer ahead. */
const SEEKER_PASSED = 8;

/** While a Seeker homes in on a kart that is in the air (jumping a ravine), it climbs or dives toward the kart's height. */
function climbToTarget(ground: Ground, e: { x: number; z: number; y: number; trackIndex: number }, target: KartState, dt: number): number {
  if (target.grounded) return e.y; // on the ground: following the ground is already right
  const step = ITEMS.seekerClimb * dt;
  let y = e.y + Math.max(-step, Math.min(step, target.pos.y + 0.3 - e.y));
  const here = ground.sample(e.x, e.z, e.trackIndex);
  if (here) y = Math.max(y, here.height); // never into the ground
  return y;
}

/** How far ahead (s of flight) a shot looks at the ground, so it starts climbing before a slope arrives. */
const SHOT_LOOKAHEAD_S = 0.12;
/** How quickly (1/s) a shot's height eases toward the ground ahead when rising / when the ground falls away. */
const SHOT_RISE_RATE = 20;
const SHOT_FALL_RATE = 14;

/**
 * Height a ricochet / seeker shot should have after this tick: it glides over the ground it flies across.
 * We look at the ground under the shot and a short way ahead (road, ramps, raised drawbridge leaves, terrain;
 * the shot's track index keeps it on its own level on bridges and overpasses), ease toward the higher of the two
 * (smooth over crests and slopes), but never go below the ground right under it (never sinks in).
 * Where there is no ground at all (a gap, a hole) it keeps its height.
 */
function followGround(ground: Ground, e: { x: number; z: number; heading: number; speed: number; y: number; trackIndex: number }, dt: number): number {
  const here = ground.sample(e.x, e.z, e.trackIndex);
  if (!here) return e.y;
  const reach = e.speed * SHOT_LOOKAHEAD_S;
  const ahead = ground.sample(e.x + Math.sin(e.heading) * reach, e.z + Math.cos(e.heading) * reach, e.trackIndex);
  const target = Math.max(here.height, ahead?.height ?? here.height);
  const rate = target > e.y ? SHOT_RISE_RATE : SHOT_FALL_RATE;
  const eased = e.y + (target - e.y) * (1 - Math.exp(-rate * dt));
  return Math.max(here.height, eased);
}

function newState(): ItemState {
  return { held: null, roulette: 0, heldFor: 0, wasDown: false, pressing: false, holdTime: 0, trailing: false };
}

/**
 * Bot helper: the ITEM button state a computer driver should press this tick.
 * Waits a bit after getting an item, then taps; repeats for dash packs.
 */
export function botItemButton(slot: number, st: ItemState | undefined): number {
  if (!st?.held || st.roulette > 0) return 0;
  const delay = 1.5 + (slot % 3) * 0.8;
  if (st.heldFor < delay) return 0;
  // A short pulse (< tapSeconds) every 1.4 s.
  const phase = (st.heldFor - delay) % 1.4;
  return phase < 0.1 ? Buttons.ITEM : 0;
}
