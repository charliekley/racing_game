/**
 * Item system: item boxes, roulette, held items, and the objects items create
 * (peels (internal id `slick`), ricochet shots, seeker shots, the magnet and bumper effects). Pure simulation: no Three.js, no
 * DOM, no Math.random (a seeded generator is injected), so it stays testable.
 *
 * Controls (the phone's ITEM button, edge-detected here):
 *  - Dash and Nova fire the instant you press ITEM.
 *  - Slick, Ricochet and Seeker: a quick TAP fires at once (Slick drops behind you,
 *    shots fly forward; hold BRAKE for a backward Ricochet). HOLD instead and the
 *    item is dragged behind you as a shield; release to fire/drop it.
 *  - A Peel/Slick (dragged or dropped) destroys any shot that hits it.
 *  - Magnet and Bumper are "attached" effects: they live as entities that follow their owner
 *    (the renderer draws the model on the kart) and run their own timers here.
 *
 * Adding a new item: add its id to `types.ts`, a case in `use()` below
 * (what happens on use), and a row in `odds.ts`.
 */
import { Buttons, type ControlInput } from '../../shared/protocol';
import { ITEMS, KART, SIM_DT, type KartConfig } from '../config';
import { applyBoost, spinOut, type KartState } from '../kart';
import { groundPose } from './groundPose';
import type { Colliders } from '../colliders';
import type { Track } from '../track';
import { rollItem } from './odds';
import { ROULETTE_SECONDS, type HeldItem, type ItemBox, type ItemEntity, type ItemId } from './types';

export type HitSource = 'slick' | 'ricochet' | 'seeker' | 'nova';

/** Shots are the fast projectiles; the other entity kinds are traps (peel) or effects tied to a kart. */
const isShot = (e: { kind: string }) => e.kind === 'ricochet' || e.kind === 'seeker';

/** Per-owner state of a running Magnet. */
interface MagnetState {
  /** Seconds left. */
  time: number;
  /** Slot of the kart being towed toward, or null while nobody is in range. */
  target: number | null;
}

/** Per-owner state of a running Bumper orb. */
interface BumperState {
  time: number;
  /** Bumps / blocked shots left before the orb pops. */
  charges: number;
  /** Where the orb is on its circle (radians). */
  angle: number;
  /** Per victim: seconds until this orb may bump that kart again. */
  cooldown: Map<number, number>;
}

/** A kart being shoved sideways by a Bumper: it slides `dx,dz` metres per second for `time` more seconds. */
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
  /** `slot` was knocked aside by `attacker`'s Bumper orb. */
  | { kind: 'bumped'; slot: number; attacker: number }
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
  private readonly magnets = new Map<number, MagnetState>();
  private readonly bumpers = new Map<number, BumperState>();
  private shoves: Shove[] = [];
  /** Solid scenery that destroys shots (null = shots fly through everything, as before). */
  private colliders: Colliders | null = null;

  /** Let solid scenery (trees, houses…) stop Ricochet and Seeker shots. */
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
  ): ItemEvent[] {
    const events: ItemEvent[] = [];
    const racers = standings.length;
    const dt = SIM_DT;
    this.lastStandings = standings;

    // --- Boxes: respawn timers and pick-ups -----------------------------------------
    for (const box of this.boxes) {
      if (!box.active) {
        box.respawn -= dt;
        if (box.respawn <= 0) box.active = true;
        continue;
      }
      for (const [slot, k] of karts) {
        const st = this.states.get(slot);
        if (!st || finished.has(slot) || k.respawnTime > 0) continue;
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
      if (k.spinTime > 0 || k.respawnTime > 0 || k.flight) continue; // can't act while spinning / being carried / in a cannon
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
    this.updateEntities(karts, events, dt);
    return events;
  }

  /** A kart got hit by something: spin out (unless Nova protects it). Returns true if it hit. */
  private hitKart(slot: number, karts: Map<number, KartState>, by: HitSource, attacker: number | null, events: ItemEvent[]): boolean {
    const k = karts.get(slot);
    if (!k) return false;
    if (k.flight) return false; // inside a launch cannon: nothing can touch you
    if (k.invulnTime > 0) return false; // just been hit: no chain-hits (the item passes through)
    if (k.starTime > 0) {
      events.push({ kind: 'blocked', slot, by });
      return false;
    }
    spinOut(k, this.configOf(slot));
    this.magnets.delete(slot); // a spun-out kart loses the tow
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
      case 'magnet':
        this.magnets.set(slot, { time: ITEMS.magnetTime, target: null });
        this.ensureAttached('magnet', slot, k);
        break;
      case 'bumper':
        this.bumpers.set(slot, { time: ITEMS.bumperTime, charges: ITEMS.bumperCharges, angle: k.heading, cooldown: new Map() });
        this.ensureAttached('bumper', slot, k);
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

  /** Make sure `owner` has an entity of this kind (magnet / bumper) that follows the kart. */
  private ensureAttached(kind: 'magnet' | 'bumper', owner: number, k: KartState): void {
    if (this.entities.some((e) => e.kind === kind && e.owner === owner)) return;
    this.entities.push({
      uid: this.nextUid++,
      kind,
      x: k.pos.x,
      y: k.pos.y,
      z: k.pos.z,
      heading: k.heading,
      owner,
      trailing: false,
      speed: 0,
      age: 0,
      bounces: 0,
      target: null,
      grace: 0,
      trackIndex: k.trackIndex,
      life: 1,
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

  private targetAhead(owner: number): number | null {
    const i = this.lastStandings.indexOf(owner);
    return i > 0 ? this.lastStandings[i - 1] : null;
  }

  private remove(e: Entity): void {
    const i = this.entities.indexOf(e);
    if (i >= 0) this.entities.splice(i, 1);
  }

  // --- Objects: movement and collisions -------------------------------------------------------
  private updateEntities(karts: Map<number, KartState>, events: ItemEvent[], dt: number): void {
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
      if (e.kind === 'magnet') {
        if (!this.updateMagnet(e, karts, dt)) dead.add(e);
        continue;
      }
      if (e.kind === 'bumper') {
        if (!this.updateBumper(e, karts, events, dead, dt)) dead.add(e);
        continue;
      }

      // Shots
      const life = e.kind === 'ricochet' ? ITEMS.ricochetLifetime : ITEMS.seekerLifetime;
      if (e.age > life) {
        dead.add(e);
        continue;
      }
      if (e.kind === 'seeker') this.steerSeeker(e, karts, dt);
      e.x += Math.sin(e.heading) * e.speed * dt;
      e.z += Math.cos(e.heading) * e.speed * dt;
      const p = this.track.project(e.x, e.z, e.trackIndex);
      e.trackIndex = p.index;
      const ground = this.track.sample(e.x, e.z, e.trackIndex);
      if (ground) e.y = ground.height;

      // Scenery: a shot that runs into a solid tree/house/etc. is destroyed.
      if (this.colliders?.blocksPoint(e.x, e.z, e.kind === 'ricochet' ? ITEMS.ricochetRadius : ITEMS.seekerRadius)) {
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
      if (dead.has(e) || e.trailing || e.kind === 'magnet' || e.kind === 'bumper') continue;
      const r = e.kind === 'slick' ? ITEMS.slickRadius : e.kind === 'ricochet' ? ITEMS.ricochetRadius : ITEMS.seekerRadius;
      for (const [slot, k] of karts) {
        if (k.respawnTime > 0 || k.spinTime > 0 || k.invulnTime > 0 || k.flight) continue; // protected karts: shots and slicks pass through
        if (slot === e.owner && e.grace > 0) continue;
        if (e.kind === 'slick' && !k.grounded) continue; // jumping over a slick is fine
        if (Math.abs(k.pos.y - e.y) > 2.2) continue;
        const d = Math.hypot(k.pos.x - e.x, k.pos.z - e.z);
        if (d < r + KART.radius * 0.6) {
          this.hitKart(slot, karts, e.kind, e.owner, events);
          dead.add(e); // consumed whether it hurt (spin) or was blocked (Nova)
          break;
        }
      }
    }
    for (const e of dead) this.remove(e);
  }

  // --- Magnet ----------------------------------------------------------------------------------
  /**
   * Run one tick of a Magnet. Each tick it picks the nearest kart roughly ahead of its owner
   * (within `magnetRange`); while that kart is farther than `magnetMinDist` and the owner is not
   * already faster than it by `magnetOverspeed`, the owner gets a boost: a tow. Returns false when it ends.
   */
  private updateMagnet(e: Entity, karts: Map<number, KartState>, dt: number): boolean {
    const m = this.magnets.get(e.owner);
    const o = karts.get(e.owner);
    if (!m || !o || o.respawnTime > 0) {
      this.magnets.delete(e.owner);
      return false;
    }
    m.time -= dt;
    e.x = o.pos.x;
    e.y = o.pos.y;
    e.z = o.pos.z;
    e.heading = o.heading;
    e.life = Math.max(0, m.time / ITEMS.magnetTime);
    if (m.time <= 0) {
      this.magnets.delete(e.owner);
      return false;
    }
    m.target = this.magnetTarget(e.owner, o, karts);
    const t = m.target === null ? undefined : karts.get(m.target);
    if (!t) {
      e.link = undefined;
      return true;
    }
    e.link = { x: t.pos.x, y: t.pos.y, z: t.pos.z };
    const gap = Math.hypot(t.pos.x - o.pos.x, t.pos.z - o.pos.z);
    if (o.grounded && o.spinTime <= 0 && gap > ITEMS.magnetMinDist && o.speed < t.speed + ITEMS.magnetOverspeed) applyBoost(o, 0.1);
    return true;
  }

  /** Nearest other kart in front of `k` (inside a widening cone) within the magnet's range. */
  private magnetTarget(owner: number, k: KartState, karts: Map<number, KartState>): number | null {
    const fx = Math.sin(k.heading);
    const fz = Math.cos(k.heading);
    let best: number | null = null;
    let bestAlong = Infinity;
    for (const [slot, t] of karts) {
      if (slot === owner || t.respawnTime > 0 || t.flight) continue;
      const dx = t.pos.x - k.pos.x;
      const dz = t.pos.z - k.pos.z;
      const along = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      if (along < ITEMS.magnetMinDist * 0.5 || along > ITEMS.magnetRange) continue;
      if (side > 3 + 0.4 * along || Math.abs(t.pos.y - k.pos.y) > 6) continue;
      if (along < bestAlong) {
        bestAlong = along;
        best = slot;
      }
    }
    return best;
  }

  // --- Bumper ----------------------------------------------------------------------------------
  /**
   * Run one tick of a Bumper orb: it circles its owner, shoves aside any other kart it touches
   * (they lose speed, no spin-out) and swallows shots. Returns false when the orb pops.
   */
  private updateBumper(e: Entity, karts: Map<number, KartState>, events: ItemEvent[], dead: Set<Entity>, dt: number): boolean {
    const b = this.bumpers.get(e.owner);
    const o = karts.get(e.owner);
    if (!b || !o || o.respawnTime > 0) {
      this.bumpers.delete(e.owner);
      return false;
    }
    b.time -= dt;
    b.angle += ITEMS.bumperSpin * dt;
    e.x = o.pos.x + Math.sin(b.angle) * ITEMS.bumperOrbit;
    e.z = o.pos.z + Math.cos(b.angle) * ITEMS.bumperOrbit;
    e.y = o.pos.y + 0.55;
    e.heading = b.angle;
    e.life = Math.max(0, b.time / ITEMS.bumperTime);
    for (const [slot, left] of b.cooldown) {
      if (left <= dt) b.cooldown.delete(slot);
      else b.cooldown.set(slot, left - dt);
    }

    // Karts: shove aside whoever touches the orb.
    for (const [slot, k] of karts) {
      if (slot === e.owner || k.respawnTime > 0 || k.flight || k.spinTime > 0 || b.cooldown.has(slot)) continue;
      if (Math.abs(k.pos.y - e.y) > 2.2) continue;
      if (Math.hypot(k.pos.x - e.x, k.pos.z - e.z) > ITEMS.bumperRadius + KART.radius * 0.6) continue;
      b.cooldown.set(slot, ITEMS.bumperCooldown);
      if (k.starTime > 0) {
        events.push({ kind: 'blocked', slot, by: 'nova' });
        continue;
      }
      // Away from the owner's kart.
      let ax = k.pos.x - o.pos.x;
      let az = k.pos.z - o.pos.z;
      const len = Math.hypot(ax, az) || 1;
      ax /= len;
      az /= len;
      const rate = ITEMS.bumperShove / ITEMS.bumperShoveTime;
      this.shoves.push({ slot, dx: ax * rate, dz: az * rate, time: ITEMS.bumperShoveTime });
      k.speed *= ITEMS.bumperSpeedFactor;
      k.vel.x *= ITEMS.bumperSpeedFactor;
      k.vel.z *= ITEMS.bumperSpeedFactor;
      events.push({ kind: 'bumped', slot, attacker: e.owner });
      b.charges--;
    }
    // Shots: swallowed (each costs a charge).
    for (const s of this.entities) {
      if (b.charges <= 0) break;
      if (dead.has(s) || !isShot(s) || s.owner === e.owner) continue;
      const r = s.kind === 'ricochet' ? ITEMS.ricochetRadius : ITEMS.seekerRadius;
      if (Math.hypot(s.x - e.x, s.z - e.z) < ITEMS.bumperRadius + r) {
        dead.add(s);
        b.charges--;
        events.push({ kind: 'itemDestroyed', x: e.x, z: e.z });
      }
    }
    if (b.time <= 0 || b.charges <= 0) {
      this.bumpers.delete(e.owner);
      events.push({ kind: 'itemDestroyed', x: e.x, z: e.z });
      return false;
    }
    return true;
  }

  /** Slide the karts that were bumped (the push is spread over a fraction of a second so it looks like a shove). */
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

  private steerSeeker(e: Entity, karts: Map<number, KartState>, dt: number): void {
    if (e.target === null) return; // nobody ahead: flies straight
    const t = karts.get(e.target);
    if (!t || t.respawnTime > 0 || t.flight) return;
    const want = Math.atan2(t.pos.x - e.x, t.pos.z - e.z);
    const err = Math.atan2(Math.sin(want - e.heading), Math.cos(want - e.heading));
    const maxTurn = ITEMS.seekerTurnRate * dt;
    e.heading += Math.max(-maxTurn, Math.min(maxTurn, err));
  }

  /**
   * Nova bump: an invincible kart sends any kart it touches into a spin-out.
   * Called by the world after kart-vs-kart collision resolution.
   */
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
