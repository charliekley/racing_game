/**
 * Keyboard and Gamepad fallback controls on the host, so you can develop and
 * test without phones.
 *
 * Web concepts:
 *  - `KeyboardEvent.code` names the physical key ("KeyW", "ArrowLeft") regardless
 *    of keyboard layout, which is what we want for game controls.
 *  - The Gamepad API has no events for buttons/sticks: you poll
 *    `navigator.getGamepads()` every frame. Pads using the "standard" mapping
 *    (Xbox/PlayStation style) have fixed button indices.
 */
import { CHARACTERS, KART_BODIES, type Loadout } from '../../shared/characters';
import { Buttons, type ControlInput, type GamePhase, type SelectRequest } from '../../shared/protocol';
import { nextStage, previousStage, type SelectStage } from '../../shared/selectStage';

export interface KeyScheme {
  label: string;
  left: string;
  right: string;
  gas: string;
  brake: string;
  drift: string;
  item: string;
  trick: string;
}

/** Keyboard schemes. Scheme 0 = player using WASD, scheme 1 = arrow keys. */
export const KEY_SCHEMES: KeyScheme[] = [
  { label: 'WASD', left: 'KeyA', right: 'KeyD', gas: 'KeyW', brake: 'KeyS', drift: 'Space', item: 'KeyE', trick: 'KeyR' },
  {
    label: 'Arrows',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    gas: 'ArrowUp',
    brake: 'ArrowDown',
    drift: 'ShiftRight',
    item: 'Enter',
    trick: 'Slash',
  },
];

/** Keys that add a keyboard player in the lobby ("1" -> WASD player, "2" -> arrows player). */
export const KEY_JOIN = ['Digit1', 'Digit2'];

/**
 * DEPRECATED: the old "press C / V to cycle driver / kart" keys. Nothing reads them any more (see keySelectActions);
 * kept only because lobbyView.ts still imports them for its hint text. Remove together with that text.
 */
export const KEY_CHARACTER = ['KeyC', 'Comma'];
export const KEY_KART = ['KeyV', 'Period'];

/** How fast keyboard steering ramps toward full lock / back to center (units per second). */
const KEY_STEER_RATE = 5;
const KEY_RETURN_RATE = 9;

/** Tracks which keys are held. */
export class KeyboardState {
  private held = new Set<string>();
  /** Keys pressed since the last `consumePressed()` (edge-triggered actions like "join"). */
  private pressed = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return; // typing in a text box
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
      // Stop arrows/space from scrolling the page.
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    // Releasing keys while the window is unfocused would leave them "stuck".
    target.addEventListener('blur', () => this.held.clear());
  }

  isHeld(code: string): boolean {
    return this.held.has(code);
  }

  consumePressed(): Set<string> {
    const p = this.pressed;
    this.pressed = new Set();
    return p;
  }
}

/** Converts a keyboard scheme into analog-ish ControlInput with a steering ramp. */
export class KeyboardPlayerInput {
  private steer = 0;

  constructor(
    private readonly keys: KeyboardState,
    readonly scheme: KeyScheme,
  ) {}

  update(dtSec: number): ControlInput {
    const k = this.keys;
    const s = this.scheme;
    const target = (k.isHeld(s.right) ? 1 : 0) - (k.isHeld(s.left) ? 1 : 0);
    const rate = target === 0 || Math.sign(target) !== Math.sign(this.steer) ? KEY_RETURN_RATE : KEY_STEER_RATE;
    const step = rate * dtSec;
    this.steer += Math.max(-step, Math.min(step, target - this.steer));

    let buttons = 0;
    if (k.isHeld(s.gas)) buttons |= Buttons.GAS;
    if (k.isHeld(s.brake)) buttons |= Buttons.BRAKE;
    if (k.isHeld(s.drift)) buttons |= Buttons.DRIFT;
    if (k.isHeld(s.item)) buttons |= Buttons.ITEM;
    if (k.isHeld(s.trick)) buttons |= Buttons.TRICK;
    return { steer: this.steer, buttons };
  }
}

// Standard gamepad mapping indices.
const GP = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, START: 9, DPAD_UP: 12 } as const;
const STICK_DEADZONE = 0.15;

export function readGamepad(pad: Gamepad): ControlInput {
  const pressed = (i: number) => (pad.buttons[i]?.pressed ?? false) || (pad.buttons[i]?.value ?? 0) > 0.4;
  let x = pad.axes[0] ?? 0;
  x = Math.abs(x) < STICK_DEADZONE ? 0 : Math.sign(x) * (Math.abs(x) - STICK_DEADZONE) / (1 - STICK_DEADZONE);
  let buttons = 0;
  if (pressed(GP.A) || pressed(GP.RT)) buttons |= Buttons.GAS;
  if (pressed(GP.B) || pressed(GP.LT)) buttons |= Buttons.BRAKE;
  if (pressed(GP.RB) || pressed(GP.X)) buttons |= Buttons.DRIFT;
  if (pressed(GP.LB) || pressed(GP.Y)) buttons |= Buttons.ITEM;
  if (pressed(GP.DPAD_UP)) buttons |= Buttons.TRICK;
  return { steer: x, buttons };
}

// ---------------------------------------------------------------------------
// Pre-race selection with keys / a gamepad (the same steps the phones have)
// ---------------------------------------------------------------------------

/** What a local player can do in the character / kart / ready flow. */
export type SelectAction = 'left' | 'right' | 'confirm' | 'back';

/**
 * Which key does what, per keyboard scheme: the steering keys browse, the ITEM key confirms, the TRICK key goes back.
 * (WASD player: A / D, E, R. Arrows player: left / right arrows, Enter, "/".)
 */
export function keySelectActions(pressed: ReadonlySet<string>, scheme: number): SelectAction[] {
  const k = KEY_SCHEMES[scheme];
  if (!k) return [];
  const out: SelectAction[] = [];
  if (pressed.has(k.left)) out.push('left');
  if (pressed.has(k.right)) out.push('right');
  if (pressed.has(k.item)) out.push('confirm');
  if (pressed.has(k.trick)) out.push('back');
  return out;
}

/** Gamepad bits for the flow: D-pad left = 1, D-pad right = 2, A = 4 (confirm), B = 8 (back). */
export const PAD_LEFT = 1;
export const PAD_RIGHT = 2;
export const PAD_CONFIRM = 4;
export const PAD_BACK = 8;

export function padSelectBits(pad: Gamepad): number {
  const down = (i: number) => (pad.buttons[i]?.pressed ? 1 : 0);
  return down(14) | (down(15) << 1) | (down(GP.A) << 2) | (down(GP.B) << 3);
}

/** Buttons that went down since last frame (edge-triggered: holding a button does not repeat). */
export function padSelectActions(now: number, was: number): SelectAction[] {
  const fresh = now & ~was;
  const out: SelectAction[] = [];
  if (fresh & PAD_LEFT) out.push('left');
  if (fresh & PAD_RIGHT) out.push('right');
  if (fresh & PAD_CONFIRM) out.push('confirm');
  if (fresh & PAD_BACK) out.push('back');
  return out;
}

/** What one action does to a local player: a stage / highlight request for the slot, a "race again" toggle, or nothing. */
export type LocalStep = { kind: 'select'; req: SelectRequest } | { kind: 'toggleReady' } | null;

/**
 * Pure mapping from (action, where the player is, what is highlighted) to the effect. Local players
 * start at the character step (their name is the key scheme's label, so there is no typing).
 */
export function localSelectStep(action: SelectAction, stage: SelectStage, loadout: Loadout, phase: GamePhase): LocalStep {
  if (phase !== 'lobby' && phase !== 'results') return null;
  if (action === 'left' || action === 'right') {
    const dir = action === 'left' ? -1 : 1;
    if (stage === 'character') return { kind: 'select', req: { stage, character: (loadout.character + dir + CHARACTERS.length) % CHARACTERS.length } };
    if (stage === 'kart') return { kind: 'select', req: { stage, kart: (loadout.kart + dir + KART_BODIES.length) % KART_BODIES.length } };
    return null;
  }
  if (action === 'confirm') {
    const next = nextStage(stage);
    if (next) return { kind: 'select', req: { stage: next } };
    return phase === 'results' ? { kind: 'toggleReady' } : null; // at READY: "race again" on the results screen
  }
  // back: one step earlier, but never to the name step (there is no name to type)
  const prev = previousStage(stage);
  return prev && prev !== 'name' ? { kind: 'select', req: { stage: prev } } : null;
}

/** True if the pad's Start or A button is down (used to join from the lobby). */
export function gamepadWantsJoin(pad: Gamepad): boolean {
  return !!(pad.buttons[GP.START]?.pressed || pad.buttons[GP.A]?.pressed);
}

export function connectedGamepads(): Gamepad[] {
  if (!navigator.getGamepads) return [];
  return navigator.getGamepads().filter((p): p is Gamepad => !!p && p.connected);
}
