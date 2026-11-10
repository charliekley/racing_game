/**
 * Computer drivers that are fun to race against.
 *
 * `autopilot.ts` is the low-level driver: it follows the road and sets a target speed.
 * This file adds the "human" layer on top of it, one `Bot` per computer slot:
 *
 *  - difficulty (easy / normal / hard): pace, drifting, mistakes, item use, shortcuts, rocket starts;
 *  - personality from the character's weight class (light bots drift a lot, heavy bots are pushy);
 *  - hop-drift through long corners and release the mini-turbo, tricks off ramps;
 *  - items used with some sense (dash on straights, shots when someone is in front, shield items held while leading);
 *  - dodging karts and slicks, getting unstuck, gentle rubber-banding against the best human.
 *
 * Deterministic: all "randomness" comes from a small seeded generator per bot, so the same race always plays out
 * the same way (and tests are repeatable). Pure TypeScript, no DOM.
 */
import { CHARACTERS, DEFAULT_LOADOUT, type WeightClass } from '../shared/characters';
import { Buttons, type ControlInput } from '../shared/protocol';
import { autopilot, botStyleFor, type BotStyle } from './autopilot';
import { BOTS, ITEMS, SIM_DT } from './config';
import type { ItemState } from './items/items';
import type { KartState } from './kart';
import { forwardOf, rightOf } from './kart';
import type { Track } from './track';
import type { World } from './world';

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
export const DEFAULT_DIFFICULTY: Difficulty = 'normal';

/** The next difficulty in the lobby cycle (easy -> normal -> hard -> easy). */
export function nextDifficulty(d: Difficulty): Difficulty {
  return DIFFICULTIES[(DIFFICULTIES.indexOf(d) + 1) % DIFFICULTIES.length];
}

/** Accepts anything (e.g. a string from localStorage) and returns a valid difficulty. */
export function sanitizeDifficulty(v: unknown): Difficulty {
  return DIFFICULTIES.includes(v as Difficulty) ? (v as Difficulty) : DEFAULT_DIFFICULTY;
}

// ---------------------------------------------------------------------------
// Rubber band
// ---------------------------------------------------------------------------

/**
 * Pace multiplier from how far a bot is ahead of (+) or behind (-) the best human, in metres of track.
 * Inside the dead zone: 1. Far ahead: down to `1 - maxEase`; far behind: up to `1 + maxBoost`.
 * Always inside [1 - maxEase, 1 + maxBoost], so it is a nudge, never a cheat.
 */
export function rubberBand(ahead: number): number {
  const { deadZone, fullAt, maxEase, maxBoost } = BOTS.rubber;
  const over = Math.max(0, Math.abs(ahead) - deadZone);
  const t = Math.min(1, over / (fullAt - deadZone));
  return ahead > 0 ? 1 - maxEase * t : 1 + maxBoost * t;
}

// ---------------------------------------------------------------------------
// Difficulty and personality tables
// ---------------------------------------------------------------------------

export interface Skill {
  /** Fraction of top speed aimed for (before rubber band). */
  pace: number;
  /** 0 = never drifts. Otherwise the smallest average curvature (1/m) of a corner worth drifting. */
  driftCurvature: number;
  /** Chance (0..1) of attempting a trick off a ramp. */
  trickChance: number;
  /** Rocket start: gas is pressed between `rocketEarly` and `rocketLate` s before GO (a wrong-way value is a mistimed press). */
  rocketEarly: number;
  rocketLate: number;
  /** Chance of botching the start: a flooded engine (pressing far too early). */
  stallChance: number;
  /** Mean seconds between driving mistakes (0 = never), and how long one lasts. */
  mistakeEvery: number;
  mistakeLength: number;
  /** Seconds to wait before using an item, and whether shield items are held while leading. */
  itemDelay: number;
  holdShields: boolean;
  /** Dodge karts and slicks (0..1 strength). */
  dodge: number;
  /** Takes shortcuts and cannons when the bot's slot likes them. */
  skillful: boolean;
  /** Steering gain (higher = sharper lines). */
  steerGain: number;
  /** Added to the personality's corner speed: braver (+) or more careful (-) in corners. */
  cornerBonus: number;
}

export const SKILLS: Record<Difficulty, Skill> = {
  easy: {
    pace: BOTS.pace.easy, driftCurvature: 0, trickChance: 0.3, rocketEarly: -1.2, rocketLate: 0.15, stallChance: 0.2,
    mistakeEvery: 16, mistakeLength: 0.4, itemDelay: 2.5, holdShields: false, dodge: 0.5, skillful: false, steerGain: 2.4, cornerBonus: -0.06,
  },
  normal: {
    pace: BOTS.pace.normal, driftCurvature: 0.032, trickChance: 0.8, rocketEarly: -0.75, rocketLate: -0.08, stallChance: 0.04,
    mistakeEvery: 25, mistakeLength: 0.3, itemDelay: 1.0, holdShields: true, dodge: 0.85, skillful: true, steerGain: 3, cornerBonus: 0,
  },
  hard: {
    pace: BOTS.pace.hard, driftCurvature: 0.028, trickChance: 1, rocketEarly: -0.28, rocketLate: -0.03, stallChance: 0,
    mistakeEvery: 0, mistakeLength: 0, itemDelay: 0.35, holdShields: true, dodge: 1, skillful: true, steerGain: 3.4, cornerBonus: 0.06,
  },
};

interface Personality {
  /** How much the bot likes to drift (multiplies the corner threshold: lower threshold = drifts more). */
  driftEager: number;
  /** 0..1: how willing the bot is to fire items backwards / not dodge. Heavy bots bully. */
  aggression: number;
  /** Corner speed fraction (see BotStyle.cornerSpeed). */
  cornerSpeed: number;
}

/** Light karts are nimble drifters, heavy karts bulldoze and brake earlier because they turn wider. */
const PERSONALITY: Record<WeightClass, Personality> = {
  light: { driftEager: 1.25, aggression: 0.4, cornerSpeed: 0.8 },
  medium: { driftEager: 1, aggression: 0.7, cornerSpeed: 0.76 },
  heavy: { driftEager: 0.8, aggression: 1, cornerSpeed: 0.72 },
};

// ---------------------------------------------------------------------------
// Seeded random numbers
// ---------------------------------------------------------------------------

/** mulberry32: tiny, fast, good enough for "random" bot decisions. Returns numbers in [0, 1). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Ticks an ITEM button stays down for a "tap" (must stay below ITEMS.tapSeconds). */
const TAP_TICKS = Math.max(1, Math.floor((ITEMS.tapSeconds * 0.6) / SIM_DT));

// ---------------------------------------------------------------------------
// One bot
// ---------------------------------------------------------------------------

type Mistake = { kind: 'wobble' | 'lift'; dir: number; until: number };

export class Bot {
  private readonly skill: Skill;
  private readonly personality: Personality;
  private readonly style: BotStyle;
  private readonly rnd: () => number;

  // Rocket start
  private rocketAt: number;
  // Mistakes
  private nextMistake: number;
  private mistake: Mistake | null = null;
  // Drift
  private drifting = false;
  private driftCooldown = 0;
  // Tricks
  private wasTrickable = false;
  private wantsTrick = false;
  private airTime = 0;
  // Stuck recovery
  private stuckFor = 0;
  private reverseUntil = 0;
  // Dodging
  private avoid = 0;
  // Items
  private tapLeft = 0;
  private tapBackward = false;
  private holding = false;
  /** Smoothed pace multiplier (rubber band changes slowly so nobody notices). */
  private rubber = 1;
  /** The bot's own tick counter (seconds since it was created). */
  private clock = 0;

  constructor(
    readonly slot: number,
    readonly difficulty: Difficulty,
    weightClass: WeightClass = 'medium',
  ) {
    this.skill = SKILLS[difficulty];
    this.personality = PERSONALITY[weightClass];
    const base = botStyleFor(slot);
    this.style = {
      ...base,
      pace: this.skill.pace,
      cornerSpeed: this.personality.cornerSpeed + this.skill.cornerBonus,
      steerGain: this.skill.steerGain,
      // Easy bots never leave the main road; the others take what their slot likes (hard bots like shortcuts more).
      useCannons: this.skill.skillful,
      shortcutBias: !this.skill.skillful ? 0 : difficulty === 'hard' ? Math.max(base.shortcutBias ?? 0, 0.6) : base.shortcutBias,
    };
    this.rnd = seeded(slot * 7919 + DIFFICULTIES.indexOf(difficulty) * 104729 + 17);
    // Rocket start: when (race clock, negative = before GO) to press the gas.
    const s = this.skill;
    this.rocketAt = s.rocketEarly + (s.rocketLate - s.rocketEarly) * this.rnd();
    if (this.rnd() < s.stallChance) this.rocketAt = -2.5; // far too early: floods the engine
    this.nextMistake = s.mistakeEvery > 0 ? s.mistakeEvery * (0.4 + this.rnd()) : Infinity;
  }

  /** The controls for this tick. */
  drive(world: World, humanAhead: number | null): ControlInput {
    const k = world.karts.get(this.slot);
    const race = world.race;
    if (!k || !race) return { steer: 0, buttons: 0 };
    const track = world.track!;
    this.clock += SIM_DT;

    // --- Countdown: rocket start timing -----------------------------------------------------
    if (race.phase === 'countdown') return { steer: 0, buttons: race.time >= this.rocketAt ? Buttons.GAS : 0 };

    // --- Rubber band: smooth towards the wanted multiplier ----------------------------------
    const wantRubber = humanAhead === null ? 1 : rubberBand(humanAhead);
    this.rubber += (wantRubber - this.rubber) * 0.02;

    // --- Dodging: shift the racing line away from karts / slicks just ahead -------------------
    // Not on a shortcut or right before its junction: there the line must stay exactly on the branch.
    const sNow = track.project(k.pos.x, k.pos.z, k.trackIndex);
    const nearFork = sNow.route > 0 || track.branches.some((b) => track.deltaS(sNow.s, b.s0) > -15 && track.deltaS(sNow.s, b.s0) < 70);
    const lane = this.style.lane + (nearFork ? 0 : this.dodge(world, k) * this.skill.dodge);
    const half = track.def.width / 2 - 2.2;
    const style: BotStyle = { ...this.style, pace: this.skill.pace * this.rubber, lane: clamp(lane, -half, half) };

    // --- Base driving ---------------------------------------------------------------------
    // While sliding in a drift the kart travels along its VELOCITY, not its nose: steer by where we are really going.
    const sliding = this.drifting && k.driftDir !== 0 && Math.hypot(k.vel.x, k.vel.z) > 5;
    const base = autopilot(sliding ? { ...k, heading: Math.atan2(k.vel.x, k.vel.z) } : k, track, style, world.configOf(this.slot));
    let steer = base.steer;
    let buttons = base.buttons;
    const p = track.project(k.pos.x, k.pos.z, k.trackIndex);
    const ahead = (o: number) => track.sampleAhead(p.route, p.i, o).curvature;

    // --- Jumbled (steering flipped by ink): steer the opposite way. Easy bots take a second to work it out. ---
    if (k.invertTime > 0) {
      const confused = this.difficulty === 'easy' && k.invertTime > ITEMS.jumbleTime - 1;
      if (confused) buttons &= ~Buttons.GAS; // easy bots lift for a second before they work it out
      else steer = -steer;
    }

    // --- Mistakes (easy / normal only) --------------------------------------------------------
    if (this.mistake && this.clock > this.mistake.until) this.mistake = null;
    if (!this.mistake && this.clock > this.nextMistake && k.grounded) {
      const len = this.skill.mistakeLength * (0.7 + 0.6 * this.rnd());
      this.mistake = { kind: this.rnd() < 0.5 ? 'wobble' : 'lift', dir: this.rnd() < 0.5 ? -1 : 1, until: this.clock + len };
      this.nextMistake = this.clock + this.skill.mistakeEvery * (0.6 + 0.8 * this.rnd());
    }
    if (this.mistake?.kind === 'wobble') steer = clamp(steer + this.mistake.dir * 0.4, -1, 1);
    if (this.mistake?.kind === 'lift') buttons &= ~Buttons.GAS;

    // --- Drifting through long corners, mini-turbo on release ----------------------------------
    const driftButton = this.driftLogic(k, track, p, ahead);
    if (driftButton.hold) buttons |= Buttons.DRIFT;
    if (driftButton.forceSteer !== 0) steer = driftButton.forceSteer * Math.max(Math.abs(steer), 0.7);
    if (this.drifting) buttons |= Buttons.GAS; // never lift in a drift: the charge needs speed

    // --- Tricks off ramps -------------------------------------------------------------------------
    if (k.grounded) this.airTime = 0;
    else this.airTime += SIM_DT;
    if (k.trickable && !this.wasTrickable) this.wantsTrick = this.rnd() < this.skill.trickChance;
    this.wasTrickable = k.trickable;
    if (!k.grounded && k.trickable && !k.trickDone && this.wantsTrick && this.airTime > 0.12) buttons |= Buttons.TRICK;

    // --- Items ----------------------------------------------------------------------------------------
    buttons |= this.itemLogic(world, k, ahead);

    // --- Stuck: back up and turn around ---------------------------------------------------------------
    const stuckable = k.grounded && k.spinTime <= 0 && k.respawnTime <= 0 && k.stallTime <= 0 && !k.flight;
    this.stuckFor = stuckable && Math.abs(k.speed) < 3.5 && race.time > 1 ? this.stuckFor + SIM_DT : 0;
    if (this.stuckFor > 1.5) {
      this.reverseUntil = this.clock + 1.6;
      this.stuckFor = 0;
    }
    if (this.clock < this.reverseUntil) return { steer: -steer, buttons: Buttons.BRAKE };

    return { steer, buttons };
  }

  // -------------------------------------------------------------------------
  // Drift
  // -------------------------------------------------------------------------

  private driftLogic(
    k: KartState,
    track: Track,
    p: { route: number; s: number; i: number },
    ahead: (o: number) => number,
  ): { hold: boolean; forceSteer: number } {
    const none = { hold: false, forceSteer: 0 };
    const threshold = this.skill.driftCurvature;
    this.driftCooldown = Math.max(0, this.driftCooldown - SIM_DT);
    if (threshold <= 0) return none;

    if (this.drifting) {
      // Keep the button down through the hop, the drift, and release once the corner is nearly over.
      const dir = k.driftDir;
      const hopping = k.hopping || !k.grounded;
      if (dir === 0 && !hopping) {
        this.drifting = false; // the hop did not turn into a drift (not steering hard enough)
        this.driftCooldown = 0.8;
        return none;
      }
      if (dir !== 0) {
        const cornerNow = -Math.sign(ahead(3)) === dir ? Math.abs(ahead(3)) : 0;
        const cornerSoon = -Math.sign(ahead(8)) === dir ? Math.abs(ahead(8)) : 0;
        if (Math.max(cornerNow, cornerSoon) < threshold * 0.45) {
          this.drifting = false; // corner over: let go -> mini-turbo
          this.driftCooldown = 0.6;
          return none;
        }
      }
      // Only the hop needs a forced steer (the drift starts if we steer when landing); inside the drift the normal line-following steers.
      return { hold: true, forceSteer: dir !== 0 ? 0 : this.pendingDir };
    }

    // Start a drift: grounded, quick enough, a decent corner ahead, and no jump / cannon / branch nearby.
    if (this.driftCooldown > 0 || !k.grounded || k.spinTime > 0 || k.boostTime > 1.5 || k.speed < 14 || p.route !== 0) return none;
    const samples = [6, 10, 14, 18].map(ahead);
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    if (Math.abs(avg) < threshold / this.personality.driftEager) return none;
    if (!samples.every((c) => c * avg > 0 && Math.abs(c) > Math.abs(avg) * 0.35)) return none; // one steady corner, not an S-bend
    // Sliding wide is only safe where a wall catches the kart on the outside of the corner (no bridges, cliffs or open verges).
    const outsideWall = avg < 0 ? 'wallLeft' : 'wallRight';
    if (![0, 8, 14, 20].every((o) => track.sampleAhead(p.route, p.i, o)[outsideWall])) return none;
    if (track.ramps.some((r) => track.deltaS(p.s, r.s0) > -(r.s1 - r.s0 + r.gap + 8) && track.deltaS(p.s, r.s0) < 55)) return none;
    if (track.branches.some((b) => track.deltaS(p.s, b.s0) > -(b.span + 30) && track.deltaS(p.s, b.s0) < 90)) return none; // roads fork and rejoin here
    if (track.cannons.some((c) => track.deltaS(p.s, c.mouth.s) > -8 && track.deltaS(p.s, c.mouth.s) < 70)) return none;
    this.drifting = true;
    this.pendingDir = -Math.sign(avg); // curvature < 0 = right turn = drift direction +1
    return { hold: true, forceSteer: this.pendingDir };
  }
  /** Direction (+1 right) of the drift being started, used while the hop is in the air. */
  private pendingDir = 0;

  // -------------------------------------------------------------------------
  // Dodging
  // -------------------------------------------------------------------------

  /** Sideways lane shift (m) to get around obstacles in front. Smoothed so it does not jitter. */
  private dodge(world: World, k: KartState): number {
    const f = forwardOf(k.heading);
    const r = rightOf(k.heading);
    let target = 0;
    let best = Infinity;
    const consider = (x: number, z: number, y: number, reach: number, width: number) => {
      const dx = x - k.pos.x;
      const dz = z - k.pos.z;
      const along = dx * f.x + dz * f.z;
      const side = dx * r.x + dz * r.z;
      if (along < 0 || along > reach || Math.abs(side) > width || Math.abs(y - k.pos.y) > 2) return;
      if (along < best) {
        best = along;
        const push = (width - Math.abs(side) + 0.6) * (this.personality.aggression > 0.9 ? 0.7 : 1);
        target = (side >= 0 ? -1 : 1) * push; // other kart to my right -> move left
      }
    };
    for (const [slot, o] of world.karts) {
      if (slot === this.slot || o.respawnTime > 0 || o.flight) continue;
      consider(o.pos.x, o.pos.z, o.pos.y, 11, 2.6);
    }
    if (this.skill.dodge >= 0.85 && world.items) {
      for (const e of world.items.entityList) if (e.kind === 'slick' && !e.trailing) consider(e.x, e.z, e.y, 16, 1.9);
    }
    this.avoid += (target - this.avoid) * 0.12;
    return this.avoid;
  }

  // -------------------------------------------------------------------------
  // Items
  // -------------------------------------------------------------------------

  /** ITEM / BRAKE bits for this tick. Decides when to fire the held item. */
  private itemLogic(world: World, k: KartState, ahead: (o: number) => number): number {
    const st: ItemState | undefined = world.items?.states.get(this.slot);
    // A pulse in progress: ITEM is down for a few ticks (a "tap"), then released (with BRAKE for a backward shot).
    if (this.tapLeft > 0) {
      this.tapLeft--;
      return Buttons.ITEM;
    }
    if (this.tapBackward) {
      this.tapBackward = false;
      return Buttons.BRAKE;
    }
    if (!st?.held || st.roulette > 0) {
      this.holding = false;
      return 0;
    }
    if (k.spinTime > 0 || k.respawnTime > 0 || k.flight) return this.holding ? Buttons.ITEM : 0;

    const standings = world.race!.standings();
    const rank = standings.indexOf(this.slot); // 0 = leading
    const f = forwardOf(k.heading);
    const r = rightOf(k.heading);
    // Nearest racer in front / behind, in metres along my heading, with their sideways offset.
    let front: { d: number; side: number } | null = null;
    let back: { d: number; side: number } | null = null;
    for (const [slot, o] of world.karts) {
      if (slot === this.slot || o.respawnTime > 0 || o.flight) continue;
      const dx = o.pos.x - k.pos.x;
      const dz = o.pos.z - k.pos.z;
      const d = dx * f.x + dz * f.z;
      const side = dx * r.x + dz * r.z;
      if (d > 0 && (!front || d < front.d)) front = { d, side };
      if (d < 0 && (!back || -d < back.d)) back = { d: -d, side };
    }
    const wait = this.skill.itemDelay + (this.slot % 3) * 0.2;
    const ready = st.heldFor >= wait;
    const straight = Math.abs(ahead(10)) < 0.008 && Math.abs(ahead(25)) < 0.012 && k.grounded;
    const tap = (backward = false) => {
      this.holding = false;
      this.tapLeft = TAP_TICKS - 1;
      this.tapBackward = backward;
      return Buttons.ITEM;
    };
    const release = (backward = false) => {
      // Let go of a dragged item: it fires/drops on the tick the button is up (BRAKE then = backwards).
      this.holding = false;
      this.tapBackward = false;
      return backward ? Buttons.BRAKE : 0;
    };

    switch (st.held.id) {
      case 'dash': {
        const stuckOffroad = k.surface === 'offroad';
        if (k.boostTime < 0.3 && ready && (straight || stuckOffroad || st.heldFor > 6)) return tap();
        return 0;
      }
      case 'nova':
        return ready && (rank > 0 || st.heldFor > 3) ? tap() : 0;
      case 'jumble':
        return ready && rank > 0 ? tap() : 0;
      case 'seeker':
        return ready && rank > 0 ? tap() : ready && st.heldFor > 8 ? tap() : 0;
      case 'ricochet': {
        const inLineFront = front !== null && front.d > 4 && front.d < 45 && Math.abs(front.side) < 3.2;
        const inLineBack = back !== null && back.d > 3 && back.d < 28 && Math.abs(back.side) < 2.8;
        if (this.holding) {
          if (inLineFront && rank > 0) return release();
          if (inLineBack && this.personality.aggression > 0.5) return release(true);
          if (st.heldFor > 20) return release();
          return Buttons.ITEM;
        }
        if (!ready) return 0;
        if (inLineFront) return tap();
        if (inLineBack && this.personality.aggression > 0.5) return tap(true);
        // Nothing to shoot at: when leading keep it as a shield, otherwise wait for a target (fire blind after a while).
        if (rank === 0 && this.skill.holdShields) {
          this.holding = true;
          return Buttons.ITEM;
        }
        return st.heldFor > 10 ? tap() : 0;
      }
      case 'slick': {
        const inLineBack = back !== null && back.d < 12 && Math.abs(back.side) < 2.8;
        if (this.holding) {
          if (inLineBack || st.heldFor > 25) return release();
          return Buttons.ITEM;
        }
        if (!ready) return 0;
        if (this.skill.holdShields && (rank === 0 || (back !== null && back.d < 45))) {
          this.holding = true; // drag it behind as a shield until someone closes in
          return Buttons.ITEM;
        }
        return inLineBack || st.heldFor > 5 ? tap() : 0;
      }
    }
    return 0;
  }
}

// ---------------------------------------------------------------------------
// All bots of a race
// ---------------------------------------------------------------------------

/** Makes and remembers one `Bot` per computer slot. The host asks it for every bot's controls each tick. */
export class BotPack {
  private readonly bots = new Map<number, Bot>();

  constructor(
    public difficulty: Difficulty = DEFAULT_DIFFICULTY,
    /** True for slots a person drives (the rubber band follows the best of them). */
    private readonly isHuman: (slot: number) => boolean = () => false,
  ) {}

  /** The controls of computer slot `slot` for this tick. */
  input(world: World, slot: number): ControlInput {
    let bot = this.bots.get(slot);
    if (!bot) {
      const loadout = world.loadouts.get(slot) ?? DEFAULT_LOADOUT;
      bot = new Bot(slot, this.difficulty, CHARACTERS[loadout.character]?.weightClass ?? 'medium');
      this.bots.set(slot, bot);
    }
    return bot.drive(world, this.humanAhead(world, slot));
  }

  /** How many metres this bot is ahead of the best unfinished human (negative = behind); null when there is no such human. */
  private humanAhead(world: World, slot: number): number | null {
    const race = world.race;
    const me = race?.racers.get(slot);
    if (!race || !me) return null;
    let best: number | null = null;
    for (const r of race.racers.values()) {
      if (r.slot === slot || !this.isHuman(r.slot) || r.finished) continue;
      best = best === null ? r.progress : Math.max(best, r.progress);
    }
    return best === null ? null : me.progress - best;
  }
}
