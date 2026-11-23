/**
 * Driver FACE and HEAD-LOOK logic. PURE TypeScript: no Three.js, no DOM, so it can be unit tested.
 *
 * Two small state machines live here, one per kart:
 *
 *  1. Expression state. Game events ("you did a trick", "you got hit") start a timed REACTION such as
 *     `happy` for 1.3 s. When several are active the one with the highest PRIORITY wins (a spin-out
 *     beats a boost grin). Every expression has a WEIGHT 0..1 that eases toward 1 while it is the
 *     winner and back to 0 afterwards, so faces blend smoothly and always decay to neutral.
 *     The weights are plain numbers; `kartModel.ts` feeds them to the head mesh as "morph targets"
 *     (a morph target is a second copy of the head's vertices; the GPU blends between the copies).
 *
 *  2. Head look. A request such as "look back over your shoulder for 0.9 s" turns the head (and
 *     a little of the torso) smoothly toward the camera and back again. Cool-downs make sure a
 *     driver never keeps staring backwards.
 *
 * `reactionsForEvent` is the pure mapper from sim events (`WorldEvent`) to reactions.
 * Nothing here allocates during the per-frame `update` calls.
 */
import type { WorldEvent } from '../../sim/world';

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

/** Every expression except the neutral face (neutral = all weights zero). The order is the morph-target order. */
export const EXPRESSIONS = ['happy', 'shocked', 'dizzy', 'gritted', 'smug', 'despair', 'angry', 'celebrate'] as const;
export type Expression = 'neutral' | (typeof EXPRESSIONS)[number];

/**
 * Morph targets of the head, in order: [0] blink, then one per expression above.
 * (`TARGET_COUNT` weights are produced by `DriverFace.weights`.)
 */
export const BLINK = 0;
export const TARGET_COUNT = 1 + EXPRESSIONS.length;
/** Index of an expression's weight in `DriverFace.weights` (neutral has none: -1). */
export function targetIndex(e: Expression): number {
  return e === 'neutral' ? -1 : 1 + EXPRESSIONS.indexOf(e);
}

/** When two reactions are active the higher priority wins. */
export const PRIORITY: Record<Expression, number> = {
  neutral: 0,
  gritted: 1, // drifting / charging a mini-turbo: lowest, it is a background mood
  happy: 3,
  smug: 4,
  angry: 5,
  despair: 5,
  shocked: 7,
  dizzy: 8, // spun out: always shown
  celebrate: 9,
};

/** Seconds for a weight to ease in (attack) and out (release): about 95% there after 3x this. */
export const ATTACK = 0.06;
export const RELEASE = 0.18;
/** A blink lasts this long (s), and starts every BLINK_GAP seconds, give or take. */
export const BLINK_TIME = 0.17;
export const BLINK_GAP: readonly [number, number] = [2.2, 5.5];

/** Hold the expression until the end of the race (finish, knockout). */
export const FOREVER = 1e9;

export interface LookRequest {
  /** -1 = over the right shoulder, +1 = over the left shoulder, 0 = let the driver pick (see `sideHint`). */
  side: number;
  /** Seconds to hold the turned head, not counting the eased turn in and out. */
  hold: number;
  /** Seconds to wait before turning (a spin-out should finish first). */
  delay?: number;
  /** 1 = background glance (someone behind), 2 = event reaction (trick, hit, overtake). */
  priority?: number;
}

export interface Reaction {
  expr: Expression;
  /** Seconds the expression is held before it decays (FOREVER = until the race ends). */
  duration: number;
  /** Overrides PRIORITY[expr] (for example a finish beats everything). */
  priority?: number;
  look?: LookRequest;
}

// ---------------------------------------------------------------------------
// Head look
// ---------------------------------------------------------------------------

/** The head never stays turned longer than this in one go (s), whatever is requested. */
export const LOOK_MAX_HOLD = 1.3;
/** After a head turn ends, ignore background glances for this long, and event reactions for the shorter time (s). */
export const LOOK_GAP_GLANCE = 4.5;
export const LOOK_GAP_EVENT = 0.6;
const LOOK_IN = 0.13; // time constants (s) of the eased turn in / out
const LOOK_OUT = 0.2;

const smooth = (t: number) => t * t * (3 - 2 * t);

export class HeadLook {
  /** Eased turn amount 0..1 (0 = facing forward, 1 = fully looking back). Read this. */
  amount = 0;
  /** Which shoulder, -1 or +1 (stays fixed while the head is turned). */
  side = 1;
  /** Set by the owner each frame: the shoulder to prefer when a request says side 0 (for example away from the turn). */
  sideHint = 1;
  private raw = 0; // low-pass filtered target, before the smoothstep
  private hold = 0; // seconds of "turn" still wanted
  private delay = 0; // seconds until the turn starts
  private active = 0; // seconds spent turned in this go (capped by LOOK_MAX_HOLD)
  private pendingSide = 1;
  private pendingHold = 0;
  private waiting = false;
  private blockGlance = 0; // cool-down timers
  private blockEvent = 0;
  private turning = false;

  /** Ask for a head turn. Returns false when it was ignored (cool-down). */
  request(r: LookRequest): boolean {
    const prio = r.priority ?? 2;
    if (this.blockEvent > 0 || (prio < 2 && this.blockGlance > 0)) return false;
    if (this.turning && this.hold > 0 && !this.waiting) {
      // Already turned: just keep it a little longer (still capped by LOOK_MAX_HOLD in update).
      this.hold = Math.max(this.hold, r.hold);
      return true;
    }
    this.pendingHold = Math.min(LOOK_MAX_HOLD, r.hold);
    this.pendingSide = r.side === 0 ? (this.sideHint >= 0 ? 1 : -1) : r.side > 0 ? 1 : -1;
    this.delay = r.delay ?? 0;
    this.waiting = true;
    if (this.delay <= 0) this.start();
    return true;
  }

  private start(): void {
    this.waiting = false;
    this.turning = true;
    this.side = this.pendingSide;
    this.hold = this.pendingHold;
    this.active = 0;
  }

  /** Is a turn pending or in progress? */
  get busy(): boolean {
    return this.waiting || this.turning;
  }

  update(dt: number): void {
    if (this.blockGlance > 0) this.blockGlance -= dt;
    if (this.blockEvent > 0) this.blockEvent -= dt;
    if (this.waiting) {
      this.delay -= dt;
      if (this.delay <= 0) this.start();
    }
    let target = 0;
    if (this.turning) {
      this.hold -= dt;
      this.active += dt;
      if (this.hold > 0 && this.active < LOOK_MAX_HOLD) target = 1;
    }
    const tau = target > this.raw ? LOOK_IN : LOOK_OUT;
    this.raw += (target - this.raw) * (1 - Math.exp(-dt / tau));
    if (this.turning && target === 0 && this.raw < 0.01) {
      // Back facing forward: start the cool-down.
      this.raw = 0;
      this.turning = false;
      this.blockGlance = LOOK_GAP_GLANCE;
      this.blockEvent = LOOK_GAP_EVENT;
    }
    this.amount = smooth(Math.min(1, Math.max(0, this.raw)));
  }

  reset(): void {
    this.amount = this.raw = this.hold = this.delay = this.active = 0;
    this.turning = this.waiting = false;
    this.blockGlance = this.blockEvent = 0;
  }
}

// ---------------------------------------------------------------------------
// The face of one driver
// ---------------------------------------------------------------------------

/** Conditions that hold an expression while they last (set every frame by the kart view). */
export interface FaceConditions {
  /** Drifting / charging a mini-turbo: the driver grits their teeth. */
  gritted: boolean;
}

export class DriverFace {
  /** Weight per morph target (see TARGET_COUNT): [blink, happy, shocked, ...]. Updated in place by `update`. */
  readonly weights = new Float32Array(TARGET_COUNT);
  readonly look = new HeadLook();
  /** The winning expression right now (neutral when everything has decayed). */
  current: Expression = 'neutral';

  private readonly timeLeft = new Float32Array(EXPRESSIONS.length);
  private readonly prio = new Int8Array(EXPRESSIONS.length);
  private blinkT = -1; // < 0: not blinking; else seconds into the blink
  private nextBlink: number;
  private lastPlace = 0;
  private quiet = 0; // ignore place changes for a moment (race start shuffles everyone)

  /** `rng` returns 0..1 (inject a seeded one in tests). */
  constructor(private readonly rng: () => number = Math.random) {
    this.nextBlink = this.blinkGap();
  }

  private blinkGap(): number {
    return BLINK_GAP[0] + (BLINK_GAP[1] - BLINK_GAP[0]) * this.rng();
  }

  /** Start (or refresh) a reaction. A new reaction clears weaker ones; a weaker one than what is showing is dropped. */
  react(r: Reaction): void {
    const i = EXPRESSIONS.indexOf(r.expr as (typeof EXPRESSIONS)[number]);
    if (i < 0) return;
    const p = r.priority ?? PRIORITY[r.expr];
    for (let j = 0; j < this.timeLeft.length; j++) {
      if (this.timeLeft[j] > 0 && this.prio[j] > p) return; // something stronger is showing
    }
    for (let j = 0; j < this.timeLeft.length; j++) if (this.prio[j] < p) this.timeLeft[j] = 0;
    this.timeLeft[i] = Math.max(this.timeLeft[i], r.duration);
    this.prio[i] = p;
    if (r.look) this.look.request(r.look);
  }

  /**
   * Overtaking: call every frame with the kart's race position (1 = first). Passing someone makes the
   * driver smug and glance back at the kart they just passed. `racing` is false before GO and after the finish.
   */
  notePlace(place: number, racing: boolean): void {
    if (!racing) {
      this.lastPlace = place;
      this.quiet = 2.5;
      return;
    }
    if (this.lastPlace > 0 && place < this.lastPlace && this.quiet <= 0) {
      this.react({ expr: 'smug', duration: 1.8, look: { side: 0, hold: 0.9, priority: 2 } });
    }
    this.lastPlace = place;
  }

  /** Someone is right behind: glance back over the shoulder (background priority, rate limited). */
  tailgated(side: number): void {
    this.look.request({ side, hold: 0.8, priority: 1 });
  }

  update(dt: number, cond: FaceConditions): void {
    if (this.quiet > 0) this.quiet -= dt;
    // Background mood: keeps `gritted` alive while the condition holds, then it decays like any reaction.
    if (cond.gritted) this.react({ expr: 'gritted', duration: 0.25 });
    const w = this.weights;
    // Count timers down and find the winner.
    let best = -1;
    let bestPrio = -1;
    for (let i = 0; i < this.timeLeft.length; i++) {
      if (this.timeLeft[i] > 0) {
        this.timeLeft[i] -= dt;
        if (this.timeLeft[i] > 0 && this.prio[i] > bestPrio) {
          best = i;
          bestPrio = this.prio[i];
        }
      }
    }
    this.current = best < 0 ? 'neutral' : EXPRESSIONS[best];
    // Ease each weight toward 1 (the winner) or 0.
    let sum = 0;
    for (let i = 0; i < EXPRESSIONS.length; i++) {
      const target = i === best ? 1 : 0;
      const tau = target > w[1 + i] ? ATTACK : RELEASE;
      let v = w[1 + i] + (target - w[1 + i]) * (1 - Math.exp(-dt / tau));
      if (target === 0 && v < 0.004) v = 0; // decay all the way to neutral
      w[1 + i] = v;
      sum += v;
    }
    // Two faces cross-fading must never add up to more than one face.
    if (sum > 1) for (let i = 1; i < w.length; i++) w[i] /= sum;

    // Blinks (not while wide-eyed, dizzy or cheering: those already change the eyes).
    const noBlink = this.current === 'dizzy' || this.current === 'celebrate' || this.current === 'shocked';
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      if (this.blinkT >= BLINK_TIME) {
        this.blinkT = -1;
        // Sometimes a quick double blink.
        this.nextBlink = this.rng() < 0.2 ? 0.25 : this.blinkGap();
      }
    } else {
      this.nextBlink -= dt;
      if (this.nextBlink <= 0 && !noBlink) this.blinkT = 0;
    }
    w[BLINK] = this.blinkT >= 0 ? Math.sin((Math.PI * this.blinkT) / BLINK_TIME) : 0;

    this.look.update(dt);
  }

  /** Forget everything (new race). */
  reset(): void {
    this.timeLeft.fill(0);
    this.prio.fill(0);
    this.weights.fill(0);
    this.current = 'neutral';
    this.blinkT = -1;
    this.lastPlace = 0;
    this.quiet = 0;
    this.look.reset();
  }
}

// ---------------------------------------------------------------------------
// Pure mapper: sim events -> reactions
// ---------------------------------------------------------------------------

export interface FaceReaction extends Reaction {
  /** The kart (player slot) that should make this face. */
  slot: number;
}

export interface FaceContext {
  /** How many karts are in the race (to tell a good finish from a bad one). */
  racers: number;
  /** Seconds a spin-out lasts (KART.spinTime): the head turns to the camera when it is nearly over. */
  spinTime: number;
}

/** Impacts (m/s) that are worth a face. */
const WALL_SHOCK = 8;
const BUMP_GRUMP = 6;
const LAND_SHOCK = 9;

/**
 * Which faces should react to this sim event, and how? Returns an empty array for most events.
 * (A new array per EVENT is fine: events are rare, unlike per-frame work.)
 */
export function reactionsForEvent(e: WorldEvent, ctx: FaceContext): FaceReaction[] {
  switch (e.kind) {
    // --- good things: happy ---
    case 'trick':
      // Spin flourish: grin, then look at the camera once the spin is nearly done.
      return [{ slot: e.slot, expr: 'happy', duration: 1.4, look: { side: 0, hold: 0.9, delay: 0.3, priority: 2 } }];
    case 'trickBoost':
      return [{ slot: e.slot, expr: 'happy', duration: 1.3 }];
    case 'combo':
      return [{ slot: e.slot, expr: 'happy', duration: 1.6, look: { side: 0, hold: 0.7, priority: 2 } }];
    case 'perfectStart':
      return [{ slot: e.slot, expr: 'happy', duration: 1.6 }];
    case 'startBoost':
    case 'boostPad':
    case 'slipBoost':
      return [{ slot: e.slot, expr: 'happy', duration: 0.9 }];
    case 'miniTurbo':
      return [{ slot: e.slot, expr: 'happy', duration: 0.8 + 0.1 * e.tier }];
    case 'itemGet':
      return [{ slot: e.slot, expr: 'happy', duration: 0.7 }];
    case 'cannonLand':
      return [{ slot: e.slot, expr: 'happy', duration: 1.5 }];
    case 'blocked':
      return [{ slot: e.slot, expr: 'smug', duration: 1.3 }];

    // --- bad things: shocked / dizzy / despair / angry ---
    case 'hit': {
      const out: FaceReaction[] = [
        // Spun out: dizzy, and look at the camera when the spin is nearly over.
        { slot: e.slot, expr: 'dizzy', duration: ctx.spinTime + 0.9, look: { side: 0, hold: 0.9, delay: ctx.spinTime * 0.8, priority: 2 } },
      ];
      // The one who landed the hit is pleased.
      if (e.attacker !== null && e.attacker !== e.slot) out.push({ slot: e.attacker, expr: 'happy', duration: 1.7 });
      return out;
    }
    case 'hazardHit':
      return [{ slot: e.slot, expr: 'dizzy', duration: ctx.spinTime + 0.7, look: { side: 0, hold: 0.8, delay: ctx.spinTime * 0.8, priority: 2 } }];
    case 'jumbled':
      return [{ slot: e.slot, expr: 'shocked', duration: 1.4, look: { side: 0, hold: 0.6, priority: 2 } }];
    case 'shrunk':
      return [{ slot: e.slot, expr: 'shocked', duration: 1.4, look: { side: 0, hold: 0.6, priority: 2 } }];
    case 'squashed':
      return [{ slot: e.slot, expr: 'shocked', duration: 1.0 }];
    case 'wall':
      return e.impact >= WALL_SHOCK ? [{ slot: e.slot, expr: 'shocked', duration: 0.7 }] : [];
    case 'kart':
      return e.impact >= BUMP_GRUMP ? [{ slot: e.slot, expr: 'angry', duration: 0.8 }] : [];
    case 'land':
      return e.fallSpeed >= LAND_SHOCK ? [{ slot: e.slot, expr: 'shocked', duration: 0.5 }] : [];
    case 'cannonFire':
      return [{ slot: e.slot, expr: 'shocked', duration: 1.3 }];
    case 'respawn':
      return [{ slot: e.slot, expr: 'despair', duration: 1.8, look: { side: 0, hold: 0.8, delay: 0.4, priority: 2 } }];

    // --- the end of the race ---
    case 'finish': {
      // Top half cheers, the rest sulks. Held until the race ends.
      const good = e.place <= Math.max(1, Math.ceil(ctx.racers / 2));
      return [{ slot: e.slot, expr: good ? 'celebrate' : 'despair', duration: FOREVER, priority: 9 }];
    }
    case 'knockout':
      return [{ slot: e.slot, expr: 'despair', duration: 4, priority: 9 }];

    // --- bot personality (from sim/bots.ts) ---
    case 'botMood':
      switch (e.mood) {
        case 'celebrate':
          return [{ slot: e.slot, expr: 'celebrate', duration: 2.4 }];
        case 'despair':
          return [{ slot: e.slot, expr: 'despair', duration: 2.4 }];
        case 'angry':
          return [{ slot: e.slot, expr: 'angry', duration: 2.2 }];
        case 'smug':
          return [{ slot: e.slot, expr: 'smug', duration: 2.4 }];
      }
      return [];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// "Someone is right behind me"
// ---------------------------------------------------------------------------

/** Another kart this close behind (m, along our heading) and this near our line (m, sideways) makes the driver glance back. */
export const TAILGATE_BEHIND: readonly [number, number] = [1.5, 6.5];
export const TAILGATE_SIDE = 3;

/**
 * Is a kart at offset (dx, dz) from us (world metres) right behind a kart facing `heading`? Returns the shoulder
 * to look over (-1 right, +1 left) or 0 when not tailgated. Pure geometry.
 */
export function tailgateSide(dx: number, dz: number, heading: number): number {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const behind = -(dx * fx + dz * fz);
  if (behind < TAILGATE_BEHIND[0] || behind > TAILGATE_BEHIND[1]) return 0;
  // Local +X (the kart's left, facing +Z with Y up) in world coordinates is (cos h, -sin h).
  const lateral = dx * Math.cos(heading) - dz * fx;
  if (Math.abs(lateral) > TAILGATE_SIDE) return 0;
  return lateral >= 0 ? 1 : -1;
}
