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
 *  - dodging karts and slicks, getting unstuck, gentle rubber-banding against the best human;
 *  - a visible character: each bot picks a rival (usually the nearest human) and fights harder near them
 *    (blocks the line, uses items on them sooner), makes bold moves (a late-braking dive down the inside,
 *    a risky shortcut when behind), recovers with a burst after being hit, and shows its mood
 *    (`botMood` events: celebrating a lead or a win, despairing after a hit or at the back).
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
import type { Race, Racer } from './race';
import type { World } from './world';

/** What a bot feels: the host can turn these into driver faces. */
export type BotMood = 'celebrate' | 'despair' | 'angry' | 'smug';
/** Emitted (see `BotPack.drainEvents`) when a bot's mood changes; rides along with the world's events. */
export interface BotMoodEvent {
  kind: 'botMood';
  slot: number;
  mood: BotMood;
}

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
  /**
   * How the bot copes with a Jumble (steering flipped). It has to re-learn the controls:
   *  - reaction: seconds before it notices and flips its steering (until then it steers "normally" and veers away),
   *  - overshoot: extra steering amplitude right after noticing (over-correction), fading as it gets used to it,
   *  - wobble: size of the left-right sway it can't quite stop, fading over the effect,
   *  - caution: 0..1 share of the time it lifts off the gas while unsure, fading over the effect.
   * Easy bots suffer most, hard bots least, but everybody loses real time.
   */
  jumble: { reaction: number; overshoot: number; wobble: number; caution: number };
  /** 0..1: how hard the bot fights its rival (blocking, items). */
  rivalry: number;
  /** 0..1: how often it tries a late-braking dive on the inside, and takes a risky shortcut when behind. */
  boldness: number;
  /** 0..1: chance of a burst (full gas, dash used at once) after being hit or put back on the track. */
  recovery: number;
}

export const SKILLS: Record<Difficulty, Skill> = {
  easy: {
    pace: BOTS.pace.easy, driftCurvature: 0, trickChance: 0.3, rocketEarly: -1.2, rocketLate: 0.15, stallChance: 0.2,
    mistakeEvery: 16, mistakeLength: 0.4, itemDelay: 2.5, holdShields: false, dodge: 0.5, skillful: false, steerGain: 2.4, cornerBonus: -0.06,
    jumble: { reaction: 1.3, overshoot: 0.7, wobble: 0.8, caution: 0.65 },
    rivalry: 0.25, boldness: 0, recovery: 0.35,
  },
  normal: {
    pace: BOTS.pace.normal, driftCurvature: 0.032, trickChance: 0.8, rocketEarly: -0.75, rocketLate: -0.08, stallChance: 0.04,
    mistakeEvery: 25, mistakeLength: 0.3, itemDelay: 1.0, holdShields: true, dodge: 0.85, skillful: true, steerGain: 3, cornerBonus: 0,
    jumble: { reaction: 0.85, overshoot: 0.5, wobble: 0.55, caution: 0.5 },
    rivalry: 0.6, boldness: 0.5, recovery: 0.7,
  },
  hard: {
    pace: BOTS.pace.hard, driftCurvature: 0.028, trickChance: 1, rocketEarly: -0.28, rocketLate: -0.03, stallChance: 0,
    mistakeEvery: 0, mistakeLength: 0, itemDelay: 0.35, holdShields: true, dodge: 1, skillful: true, steerGain: 3.4, cornerBonus: 0.06,
    jumble: { reaction: 0.6, overshoot: 0.35, wobble: 0.42, caution: 0.55 },
    rivalry: 1, boldness: 1, recovery: 1,
  },
};

/** Position (0..2) of a difficulty on the easy-normal-hard scale, shifted by a tier rating (0..1, see BOTS.tier). */
export function tierLevel(difficulty: Difficulty, rating: number): number {
  const centre = DIFFICULTIES.indexOf(difficulty);
  return clamp(centre + (clamp(rating, 0, 1) - 0.5) * 2 * BOTS.tier.spread, 0, DIFFICULTIES.length - 1);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Interpolate a "mean seconds between events" value where 0 means never: blend the RATES, so 'never' stays rare. */
const lerpEvery = (a: number, b: number, t: number) => {
  const rate = lerp(a > 0 ? 1 / a : 0, b > 0 ? 1 / b : 0, t);
  return rate < 1 / 200 ? 0 : 1 / rate;
};
/** Same for the drift threshold (0 = never drifts, smaller = drifts more): blend the eagerness 1/curvature. */
const lerpDrift = (a: number, b: number, t: number) => {
  const eager = lerp(a > 0 ? 1 / a : 0, b > 0 ? 1 / b : 0, t);
  return eager < 5 ? 0 : 1 / eager;
};

/**
 * The skill of a bot with tier `rating` (0..1) on `difficulty`: the easy / normal / hard tables blended at
 * `tierLevel`. Numbers are interpolated (never-values like "no mistakes" through their rates); yes/no abilities
 * switch at the halfway point. With rating 0.5 you get the plain table of the difficulty back.
 */
export function skillAt(difficulty: Difficulty, rating: number): Skill {
  const level = tierLevel(difficulty, rating);
  const lo = Math.min(DIFFICULTIES.length - 2, Math.floor(level));
  const t = level - lo;
  const a = SKILLS[DIFFICULTIES[lo]];
  const b = SKILLS[DIFFICULTIES[lo + 1]];
  const near = t < 0.5 ? a : b;
  const l = (key: keyof Skill) => lerp(a[key] as number, b[key] as number, t);
  return {
    pace: l('pace'),
    driftCurvature: lerpDrift(a.driftCurvature, b.driftCurvature, t),
    trickChance: l('trickChance'),
    rocketEarly: l('rocketEarly'),
    rocketLate: l('rocketLate'),
    stallChance: l('stallChance'),
    mistakeEvery: lerpEvery(a.mistakeEvery, b.mistakeEvery, t),
    mistakeLength: l('mistakeLength'),
    itemDelay: l('itemDelay'),
    holdShields: near.holdShields,
    dodge: l('dodge'),
    skillful: near.skillful,
    steerGain: l('steerGain'),
    cornerBonus: l('cornerBonus'),
    jumble: {
      reaction: lerp(a.jumble.reaction, b.jumble.reaction, t),
      overshoot: lerp(a.jumble.overshoot, b.jumble.overshoot, t),
      wobble: lerp(a.jumble.wobble, b.jumble.wobble, t),
      caution: lerp(a.jumble.caution, b.jumble.caution, t),
    },
    rivalry: l('rivalry'),
    boldness: l('boldness'),
    recovery: l('recovery'),
  };
}

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
// Rivals
// ---------------------------------------------------------------------------

/** How a rival is chosen: the nearest HUMAN with this chance (else the nearest kart of any kind). */
export const RIVAL_HUMAN_BIAS = 0.75;
/** A bot re-considers its rival this often (s), so rivalries shift during a race. */
const RIVAL_REPICK_SECONDS = 9;

export interface RivalCandidate {
  slot: number;
  /** Distance raced (m). */
  progress: number;
  human: boolean;
}

/**
 * Who a bot picks as its rival: usually (RIVAL_HUMAN_BIAS) the human closest to it on the track,
 * otherwise the closest kart of any kind. `rnd` is the bot's seeded generator (0..1).
 * `others` must not contain the bot itself; returns null when there is nobody.
 */
export function pickRival(myProgress: number, others: RivalCandidate[], rnd: () => number): number | null {
  const nearest = (list: RivalCandidate[]) =>
    list.reduce<RivalCandidate | null>((best, c) => {
      if (!best) return c;
      const d = Math.abs(c.progress - myProgress);
      const bd = Math.abs(best.progress - myProgress);
      return d < bd || (d === bd && c.slot < best.slot) ? c : best;
    }, null);
  const humans = others.filter((c) => c.human);
  const wantHuman = humans.length > 0 && rnd() < RIVAL_HUMAN_BIAS;
  return nearest(wantHuman ? humans : others)?.slot ?? null;
}

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
  /** The nearest plain difficulty to this bot's skill (decides the yes/no behaviours). */
  private readonly label: Difficulty;
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
  /** Smoothed sideways shift (m) of the racing line that steers around hazards. */
  private hazardShift = 0;
  // Items
  private tapLeft = 0;
  private tapBackward = false;
  private holding = false;
  /** Smoothed pace multiplier (rubber band changes slowly so nobody notices). */
  private rubber = 1;
  /** The bot's own tick counter (seconds since it was created). */
  private clock = 0;
  /** Jumble bookkeeping: seconds since the steering was last flipped on us, and last tick's invertTime (to spot a new hit). */
  private jumbleAge = 0;
  private lastInvert = 0;
  // --- Character: rival, bold moves, recovery, mood ---
  /** Mood events waiting to be collected by `BotPack.drainEvents`. */
  readonly events: BotMoodEvent[] = [];
  /** The slot this bot is fighting (null = none yet) and when (own clock) it was chosen. */
  rival: number | null = null;
  private rivalAt = -Infinity;
  /** Smoothed sideways shift (m) from blocking the rival or diving down the inside. */
  private fightShift = 0;
  /** Late-braking dive: until when, which side (+1 right), earliest next try, and who it is aimed at. */
  private diveUntil = 0;
  private diveSide = 0;
  private nextDive = 8;
  private diveTarget: number | null = null;
  /** Burst after a hit: gas flat down and the dash used at once, until this time. */
  private recoverUntil = 0;
  private wasHit = false;
  private wasCarried = false;
  /** Mood bookkeeping: last mood time, current rank and since when, and which "said it" flags are set. */
  private moodAt = -Infinity;
  private rank = 0;
  private rankSince = 0;
  private rankChecked = 0;
  private saidLead = false;
  private saidLast = false;
  private saidFinish = false;
  private saidOut = false;
  /** A bold bot that is behind takes the shortcuts too (only changed away from junctions). */
  private riskShortcut = false;

  constructor(
    readonly slot: number,
    readonly difficulty: Difficulty,
    weightClass: WeightClass = 'medium',
    /** Tier rating 0..1 from the series roster (see BOTS.tier); undefined = the plain difficulty table (tests, lobby bots). */
    readonly rating?: number,
  ) {
    this.skill = rating === undefined ? SKILLS[difficulty] : skillAt(difficulty, rating);
    // The nearest of easy / normal / hard decides the yes/no behaviours (shortcuts, sloppy landings).
    const label = rating === undefined ? difficulty : DIFFICULTIES[Math.round(tierLevel(difficulty, rating))];
    this.label = label;
    this.personality = PERSONALITY[weightClass];
    const base = botStyleFor(slot);
    this.style = {
      ...base,
      pace: this.skill.pace,
      cornerSpeed: this.personality.cornerSpeed + this.skill.cornerBonus,
      steerGain: this.skill.steerGain,
      // On a track that asks for it (`botTuning.wander`) the line sways: weak bots a lot, strong ones little.
      wanderScale: label === 'easy' ? 1.6 : label === 'normal' ? 0.8 : 0.5,
      // Easy bots never leave the main road; the others take what their slot likes (hard bots like shortcuts more).
      useCannons: this.skill.skillful,
      shortcutBias: !this.skill.skillful ? 0 : label === 'hard' ? Math.max(base.shortcutBias ?? 0, 0.6) : base.shortcutBias,
    };
    this.rnd = seeded(slot * 7919 + DIFFICULTIES.indexOf(difficulty) * 104729 + 17);
    // Rocket start: when (race clock, negative = before GO) to press the gas.
    const s = this.skill;
    this.rocketAt = s.rocketEarly + (s.rocketLate - s.rocketEarly) * this.rnd();
    if (this.rnd() < s.stallChance) this.rocketAt = -2.5; // far too early: floods the engine
    this.nextMistake = s.mistakeEvery > 0 ? s.mistakeEvery * (0.4 + this.rnd()) : Infinity;
  }

  /** The controls for this tick. */
  drive(world: World, humanAhead: number | null, isHuman: (slot: number) => boolean = () => false): ControlInput {
    const k = world.karts.get(this.slot);
    const race = world.race;
    if (!k || !race) return { steer: 0, buttons: 0 };
    const track = world.track!;
    this.clock += SIM_DT;

    // --- Countdown: rocket start timing -----------------------------------------------------
    if (race.phase === 'countdown') return { steer: 0, buttons: race.time >= this.rocketAt ? Buttons.GAS : 0 };

    // --- Knocked out (Knockout mode): the carrier has us; all that is left is to sulk ---------
    const me = race.racers.get(this.slot);
    if (me?.out) {
      if (!this.saidOut) {
        this.saidOut = true;
        this.mood('despair', 0);
      }
      return { steer: 0, buttons: Buttons.BRAKE };
    }
    this.watchMood(k, me, race);
    const recovering = this.clock < this.recoverUntil;

    // --- Rubber band: smooth towards the wanted multiplier ----------------------------------
    let wantRubber = humanAhead === null ? 1 : rubberBand(humanAhead);
    // Tiers: the back of the field gets only a share of the catch-up boost, or the rubber band would drag the weak
    // bots up to the humans and the tiers would melt together (see BOTS.tier). Easing off when far ahead is unchanged.
    if (wantRubber > 1 && this.rating !== undefined) wantRubber = 1 + (wantRubber - 1) * lerp(BOTS.tier.backBoost, 1, this.rating);
    this.rubber += (wantRubber - this.rubber) * 0.02;

    // --- Dodging: shift the racing line away from karts / slicks just ahead -------------------
    // Not on a shortcut or right before its junction: there the line must stay exactly on the branch.
    const sNow = track.project(k.pos.x, k.pos.z, k.trackIndex);
    const nearFork = sNow.route > 0 || track.branches.some((b) => track.deltaS(sNow.s, b.s0) > -15 && track.deltaS(sNow.s, b.s0) < 70);
    let lane = this.style.lane + (nearFork ? 0 : this.dodge(world, k) * this.skill.dodge);
    const half = track.def.width / 2 - 2.2;
    // --- Fighting: block the rival's line, dive down the inside (never near a junction) ---
    this.fightShift += ((nearFork ? 0 : this.fightTarget(world, k, track, sNow, lane, half, isHuman)) - this.fightShift) * 0.06;
    lane += this.fightShift;
    if (!nearFork && sNow.route === 0) this.riskShortcut = this.skill.boldness > 0.4 && this.skill.skillful && (me?.progress ?? 0) < this.leaderProgress(race) - 40;
    // --- Hazards (lava geysers...): swing to a free lane, or lift when every lane is blocked ---
    // The advice is a function of the race clock, so bots "see" the same eruptions as the players.
    // Easy bots react only partly (care 0.75), so they are sometimes caught; hard bots almost never.
    const care = 0.5 + 0.5 * this.skill.dodge;
    const hazard = world.hazards && !nearFork ? world.hazards.dangerAhead(k, track, race.time, clamp(lane, -half, half)) : { brake: 0, steer: 0 };
    const hazardTarget = hazard.steer !== 0 ? sNow.d + hazard.steer * care - lane : 0;
    this.hazardShift += (hazardTarget - this.hazardShift) * 0.25;
    lane += this.hazardShift;
    const diving = this.clock < this.diveUntil;
    const style: BotStyle = {
      ...this.style,
      pace: this.skill.pace * this.rubber,
      lane: clamp(lane, -half, half),
      // Bold moves: brake later for the dive; and a bold bot that has fallen behind goes for the shortcuts.
      cornerSpeed: (this.style.cornerSpeed ?? 0.75) + (diving ? 0.1 : 0),
      shortcutBias: this.riskShortcut ? Math.max(this.style.shortcutBias ?? 0, 0.6) : this.style.shortcutBias,
    };

    // --- Base driving ---------------------------------------------------------------------
    // While sliding in a drift the kart travels along its VELOCITY, not its nose: steer by where we are really going.
    const sliding = this.drifting && k.driftDir !== 0 && Math.hypot(k.vel.x, k.vel.z) > 5;
    const base = autopilot(sliding ? { ...k, heading: Math.atan2(k.vel.x, k.vel.z) } : k, track, style, world.configOf(this.slot));
    let steer = base.steer;
    let buttons = base.buttons;
    // In the air after an orange-cap bounce nothing guides the kart: fly it onto the landing like a careful player would
    // (easy bots aim a little to one side, so their landings are sloppier).
    const air = world.bouncers?.pilot(this.slot, k, this.label === 'easy' ? (this.slot % 2 ? 1.5 : -1.5) : 0);
    if (air) {
      steer = air.steer;
      buttons = (buttons & ~(Buttons.GAS | Buttons.BRAKE)) | (air.gas ? Buttons.GAS : 0) | (air.brake ? Buttons.BRAKE : 0);
    }
    // No free lane past a hazard: lift (and brake when it is close) so we arrive after it has finished.
    if (hazard.brake * care >= 0.5 && k.grounded) {
      buttons &= ~Buttons.GAS;
      if (hazard.brake * care >= 0.85 && k.speed > 12) buttons |= Buttons.BRAKE;
    }
    // Recovering from a hit: gas flat down for a moment (unless a hazard needs us to wait).
    if (recovering && k.grounded && hazard.brake * care < 0.5) buttons |= Buttons.GAS;
    const p =track.project(k.pos.x, k.pos.z, k.trackIndex);
    const ahead = (o: number) => track.sampleAhead(p.route, p.i, o).curvature;

    // --- Jumbled (steering flipped by ink): the bot has to re-learn the controls (see Skill.jumble). ---
    const jumbled = k.invertTime > 0;
    if (jumbled) {
      if (k.invertTime > this.lastInvert + 1e-9) this.jumbleAge = 0; // freshly hit (or hit again)
      this.jumbleAge += SIM_DT;
      const j = this.skill.jumble;
      const fade = clamp(k.invertTime / ITEMS.jumbleTime, 0, 1); // 1 at the start of the effect, 0 at the end
      if (this.jumbleAge < j.reaction) {
        // Not noticed yet: the bot steers as usual, the kart goes the other way (it runs wide). Startled, it lifts off the gas.
        buttons &= ~Buttons.GAS;
      } else {
        // Flipped on purpose, but too hard and with a sway: the confusion fades as the effect runs out.
        steer = -steer * (1 + j.overshoot * fade);
        steer += j.wobble * fade * Math.sin(this.clock * 5 + this.slot);
        steer = clamp(steer, -1, 1);
        // Unsure drivers lift: off the gas for part of every 1.5 s, less and less as it fades.
        if ((this.clock * 0.67 + this.slot * 0.31) % 1 < j.caution * fade * 1.4) buttons &= ~Buttons.GAS;
      }
    } else {
      this.jumbleAge = 0;
    }
    this.lastInvert = k.invertTime;

    // --- Mistakes (easy / normal only) --------------------------------------------------------
    if (this.mistake && this.clock > this.mistake.until) this.mistake = null;
    if (!this.mistake && this.clock > this.nextMistake && k.grounded && !recovering) {
      const len = this.skill.mistakeLength * (0.7 + 0.6 * this.rnd());
      this.mistake = { kind: this.rnd() < 0.5 ? 'wobble' : 'lift', dir: this.rnd() < 0.5 ? -1 : 1, until: this.clock + len };
      this.nextMistake = this.clock + this.skill.mistakeEvery * (0.6 + 0.8 * this.rnd());
    }
    if (this.mistake?.kind === 'wobble') steer = clamp(steer + this.mistake.dir * 0.4, -1, 1);
    if (this.mistake?.kind === 'lift') buttons &= ~Buttons.GAS;

    // --- Drifting through long corners, mini-turbo on release ----------------------------------
    let driftButton = this.driftLogic(k, track, p, ahead);
    if (jumbled) {
      // Nobody drifts with flipped controls: let go (a drift in progress ends with its mini-turbo).
      driftButton = { hold: false, forceSteer: 0 };
      this.drifting = false;
      this.driftCooldown = Math.max(this.driftCooldown, 1);
    }
    if (driftButton.hold) buttons |= Buttons.DRIFT;
    if (driftButton.forceSteer !== 0 && !air) steer = driftButton.forceSteer * Math.max(Math.abs(steer), 0.7);
    if (this.drifting) buttons |= Buttons.GAS; // never lift in a drift: the charge needs speed

    // --- Tricks off ramps -------------------------------------------------------------------------
    if (k.grounded) this.airTime = 0;
    else this.airTime += SIM_DT;
    if (k.trickable && !this.wasTrickable) this.wantsTrick = this.rnd() < this.skill.trickChance * (track.def.botTuning?.trickScale ?? 1);
    this.wasTrickable = k.trickable;
    if (!k.grounded && k.trickable && !k.trickDone && this.wantsTrick && this.airTime > 0.12) buttons |= Buttons.TRICK;

    // --- Items ----------------------------------------------------------------------------------------
    buttons |= this.itemLogic(world, k, ahead, recovering);

    // --- Stuck: back up and turn around ---------------------------------------------------------------
    // (A bot that stands still on purpose, waiting for a hazard such as the raised drawbridge, is not stuck.)
    const waiting = hazard.brake * care >= 0.5;
    const stuckable = k.grounded && k.spinTime <= 0 && k.respawnTime <= 0 && k.stallTime <= 0 && !k.flight && !waiting;
    // (After a reversing spell the bot gets a moment to drive forward before it may decide it is stuck again: a kart that
    // creeps backwards along a wall below 3.5 m/s would otherwise reverse for ever and never try the road ahead.)
    const retrying = this.clock < this.reverseUntil + 1.2;
    this.stuckFor = stuckable && !retrying && Math.abs(k.speed) < 3.5 && race.time > 1 ? this.stuckFor + SIM_DT : 0;
    if (this.stuckFor > 1.5) {
      this.reverseUntil = this.clock + 1.6;
      this.stuckFor = 0;
    }
    if (this.clock < this.reverseUntil) return { steer: -steer, buttons: Buttons.BRAKE };

    return { steer, buttons };
  }

  // -------------------------------------------------------------------------
  // Character: rival, bold moves, recovery, mood
  // -------------------------------------------------------------------------

  /** Distance raced by the kart in front (m). */
  private leaderProgress(race: Race): number {
    let best = -Infinity;
    for (const r of race.racers.values()) if (!r.out) best = Math.max(best, r.progress);
    return best;
  }

  /** Choose (or re-choose) the rival: see `pickRival`. A rival that is out or finished no longer counts. */
  private updateRival(race: Race, isHuman: (slot: number) => boolean): void {
    const current = this.rival !== null ? race.racers.get(this.rival) : undefined;
    if (current && !current.out && !current.finished && this.clock - this.rivalAt < RIVAL_REPICK_SECONDS) return;
    const me = race.racers.get(this.slot);
    if (!me) return;
    const others: RivalCandidate[] = [];
    for (const r of race.racers.values()) if (r.slot !== this.slot && !r.out && !r.finished) others.push({ slot: r.slot, progress: r.progress, human: isHuman(r.slot) });
    this.rival = pickRival(me.progress, others, this.rnd);
    this.rivalAt = this.clock;
  }

  /**
   * The sideways shift (m) the fight asks for this tick:
   *  - block: when ahead of the rival (4..30 m) slide towards the rival's lateral position, so they cannot pass on that side;
   *  - dive: when a kart is just ahead before a corner, brake late and take the inside line for a moment.
   * Both are limited by the difficulty (rivalry, boldness) and the class (aggression); easy bots barely do either.
   */
  private fightTarget(
    world: World,
    k: KartState,
    track: Track,
    p: { route: number; i: number; d: number },
    lane: number,
    half: number,
    isHuman: (slot: number) => boolean,
  ): number {
    const race = world.race!;
    const me = race.racers.get(this.slot);
    if (!me || p.route !== 0) return 0;
    this.updateRival(race, isHuman);
    // Keep the line exactly where it is before jumps and cannons (they need a straight run-up).
    const s = track.project(k.pos.x, k.pos.z, k.trackIndex).s;
    if (track.ramps.some((r) => track.deltaS(s, r.s0) > -(r.s1 - r.s0 + r.gap + 8) && track.deltaS(s, r.s0) < 90)) return 0;
    if (track.cannons.some((c) => track.deltaS(s, c.mouth.s) > -8 && track.deltaS(s, c.mouth.s) < 90)) return 0;
    let target = 0;

    // Block.
    const rk = this.rival !== null ? world.karts.get(this.rival) : undefined;
    const rr = this.rival !== null ? race.racers.get(this.rival) : undefined;
    if (rk && rr && rk.respawnTime <= 0 && !rk.flight) {
      const gap = me.progress - rr.progress; // > 0: we lead
      if (gap > 4 && gap < 30) {
        const rp = track.project(rk.pos.x, rk.pos.z, rk.trackIndex);
        if (rp.route === 0) target += (clamp(rp.d, -half, half) - lane) * clamp(this.skill.rivalry * this.personality.aggression * 0.7, 0, 0.7);
      }
    }

    // Dive: end of the move (did it work?), or start a new one.
    if (this.diveTarget !== null && this.clock >= this.diveUntil) {
      const t = race.racers.get(this.diveTarget);
      if (t && me.progress > t.progress) this.mood('smug', 4);
      this.diveTarget = null;
    }
    if (this.clock < this.diveUntil) {
      target += this.diveSide * 2.2;
    } else if (this.skill.boldness > 0 && this.clock >= this.nextDive && k.grounded && k.speed > 14) {
      const curv = track.sampleAhead(p.route, p.i, 14).curvature;
      if (Math.abs(curv) > 0.012) {
        for (const o of race.racers.values()) {
          if (o.slot === this.slot || o.out || o.finished) continue;
          const ok = world.karts.get(o.slot);
          const gap = o.progress - me.progress; // > 0: they are ahead
          if (!ok || gap < 3 || gap > 14 || ok.respawnTime > 0) continue;
          if (Math.abs(track.project(ok.pos.x, ok.pos.z, ok.trackIndex).d - p.d) > 3.5) continue;
          this.nextDive = this.clock + 7 + 6 * this.rnd();
          if (this.rnd() < this.skill.boldness * 0.6) {
            this.diveUntil = this.clock + 1.5;
            this.diveSide = -Math.sign(curv); // curvature < 0 = right turn: the inside is on the right (+)
            this.diveTarget = o.slot;
          }
          break;
        }
      }
    }
    return target;
  }

  /** Emit a mood (at most one every `cooldown` seconds). */
  private mood(mood: BotMood, cooldown = 5): void {
    if (this.clock - this.moodAt < cooldown) return;
    this.moodAt = this.clock;
    this.events.push({ kind: 'botMood', slot: this.slot, mood });
  }

  /** Moods and recovery: notices hits, a new lead, sinking to the back and the finish. */
  private watchMood(k: KartState, me: Racer | undefined, race: Race): void {
    if (!me) return;
    const hit = k.spinTime > 0 || k.invertTime > 0;
    if (hit && !this.wasHit) this.mood(this.personality.aggression > 0.6 ? 'angry' : 'despair', 3);
    const carried = k.respawnTime > 0;
    // Back in control after a hit or a carry: sometimes a burst (full gas, dash at once).
    if (((this.wasHit && !hit) || (this.wasCarried && !carried)) && this.rnd() < this.skill.recovery) this.recoverUntil = this.clock + 1.6;
    this.wasHit = hit;
    this.wasCarried = carried;

    if (me.finished && !this.saidFinish) {
      this.saidFinish = true;
      if (me.place === 1) this.mood('celebrate', 0);
      else if (race.racers.size >= 3 && me.place === race.racers.size) this.mood('despair', 0);
    }
    if (this.clock - this.rankChecked < 0.25) return;
    this.rankChecked = this.clock;
    const r = race.positionOf(this.slot);
    const n = race.racers.size;
    if (r !== this.rank) {
      this.rank = r;
      this.rankSince = this.clock;
      this.saidLead = r === 1 ? this.saidLead : false;
      this.saidLast = r === n ? this.saidLast : false;
    }
    if (n >= 2 && r === 1 && !this.saidLead && this.clock - this.rankSince > 1.5) {
      this.saidLead = true;
      this.mood('celebrate');
    }
    if (n >= 3 && r === n && !this.saidLast && this.clock - this.rankSince > 2.5) {
      this.saidLast = true;
      this.mood('despair');
    }
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
    if (threshold <= 0 || track.def.botTuning?.noDrift) return none;

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
      for (const e of world.items.entityList) if ((e.kind === 'slick' || e.kind === 'decoy') && !e.trailing) consider(e.x, e.z, e.y, 16, 1.9);
    }
    this.avoid += (target - this.avoid) * 0.12;
    return this.avoid;
  }

  // -------------------------------------------------------------------------
  // Items
  // -------------------------------------------------------------------------

  /** ITEM / BRAKE bits for this tick. Decides when to fire the held item. */
  private itemLogic(world: World, k: KartState, ahead: (o: number) => number, recovering = false): number {
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
    /** Where the rival is relative to us (m along our heading, m sideways), null when it is not on the track. */
    let rivalRel: { d: number; side: number } | null = null;
    for (const [slot, o] of world.karts) {
      if (slot === this.slot || o.respawnTime > 0 || o.flight) continue;
      const dx = o.pos.x - k.pos.x;
      const dz = o.pos.z - k.pos.z;
      const d = dx * f.x + dz * f.z;
      const side = dx * r.x + dz * r.z;
      if (d > 0 && (!front || d < front.d)) front = { d, side };
      if (d < 0 && (!back || -d < back.d)) back = { d: -d, side };
      if (slot === this.rival) rivalRel = { d, side };
    }
    // Fighting the rival: items come out sooner when it is close, and shots at it are taken more readily.
    const rv = rivalRel as { d: number; side: number } | null;
    const hot = rv !== null && Math.abs(rv.d) < 45;
    const rivalFront = rv !== null && rv.d > 0 && front !== null && Math.abs(front.d - rv.d) < 1.5;
    const rivalBack = rv !== null && rv.d < 0 && back !== null && Math.abs(back.d + rv.d) < 1.5;
    const wait = (this.skill.itemDelay + (this.slot % 3) * 0.2) * (hot ? 1 - 0.5 * this.skill.rivalry : 1);
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
        if (k.boostTime < 0.3 && (ready || recovering) && (straight || stuckOffroad || recovering || st.heldFor > 6)) return tap();
        return 0;
      }
      case 'nova':
        return ready && (rank > 0 || st.heldFor > 3 || hot) ? tap() : 0;
      case 'jumble':
        return ready && (rank > 0 || rivalFront) ? tap() : 0;
      case 'rocket':
        // The Rocket drives itself: use it as soon as it is ready (it only comes to karts far back anyway).
        return ready && rank > 0 ? tap() : 0;
      case 'storm':
        // Lightning hits everybody AHEAD: worth it as soon as someone is. The more racers ahead, the better, so a
        // bot in the pack waits a moment; a bot right behind the leader fires when its rival is ahead or it has held it long.
        return ready && rank > 0 && (rank >= 2 || rivalFront || st.heldFor > 4) ? tap() : 0;
      case 'seeker':
        return ready && (rank > 0 || rivalFront) ? tap() : ready && st.heldFor > 8 ? tap() : 0;
      case 'ricochet': {
        const inLineFront = front !== null && front.d > 4 && front.d < 45 && Math.abs(front.side) < (rivalFront ? 4.4 : 3.2);
        const inLineBack = back !== null && back.d > 3 && back.d < 28 && Math.abs(back.side) < (rivalBack ? 3.8 : 2.8);
        if (this.holding) {
          if (inLineFront && rank > 0) return release();
          if (inLineBack && (this.personality.aggression > 0.5 || rivalBack)) return release(true);
          if (st.heldFor > 20) return release();
          return Buttons.ITEM;
        }
        if (!ready) return 0;
        if (inLineFront) return tap();
        if (inLineBack && (this.personality.aggression > 0.5 || rivalBack)) return tap(true);
        // A Ricochet x3 already orbits the kart as a shield: keep it for targets, one shot at a time (blind only after a long wait).
        if (st.held.pack) return st.heldFor > 14 ? tap() : 0;
        // Nothing to shoot at: when leading keep it as a shield, otherwise wait for a target (fire blind after a while).
        if (rank === 0 && this.skill.holdShields) {
          this.holding = true;
          return Buttons.ITEM;
        }
        return st.heldFor > 10 ? tap() : 0;
      }
      case 'hunter':
        // It always flies to the leader, so any bot that is not leading (it never comes to the leader) fires it when ready.
        return ready && rank > 0 ? tap() : 0;
      case 'decoy':
      case 'slick': {
        // Peel x3 / Decoy: dragged behind as a shield while someone is near behind, dropped (one at a time) when they close in.
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
    /** Tier rating (0..1) of the fill-in bots, by slot (the series roster). Slots without one drive the plain difficulty. */
    private readonly ratings: ReadonlyMap<number, number> = new Map(),
  ) {}

  /** The controls of computer slot `slot` for this tick. */
  input(world: World, slot: number): ControlInput {
    let bot = this.bots.get(slot);
    if (!bot) {
      const loadout = world.loadouts.get(slot) ?? DEFAULT_LOADOUT;
      bot = new Bot(slot, this.difficulty, CHARACTERS[loadout.character]?.weightClass ?? 'medium', this.ratings.get(slot));
      this.bots.set(slot, bot);
    }
    return bot.drive(world, this.humanAhead(world, slot), this.isHuman);
  }

  /** The mood events the bots produced since the last call (the host passes them on with the world's events). */
  drainEvents(): BotMoodEvent[] {
    const out: BotMoodEvent[] = [];
    for (const bot of this.bots.values()) if (bot.events.length) out.push(...bot.events.splice(0));
    return out;
  }

  /** The rival of a bot slot (null before it has one); for tests and debugging. */
  rivalOf(slot: number): number | null {
    return this.bots.get(slot)?.rival ?? null;
  }

  /** How many metres this bot is ahead of the best unfinished human (negative = behind); null when there is no such human. */
  private humanAhead(world: World, slot: number): number | null {
    const race = world.race;
    const me = race?.racers.get(slot);
    if (!race || !me) return null;
    let best: number | null = null;
    for (const r of race.racers.values()) {
      if (r.slot === slot || !this.isHuman(r.slot) || r.finished || r.out) continue;
      best = best === null ? r.progress : Math.max(best, r.progress);
    }
    return best === null ? null : me.progress - best;
  }
}
