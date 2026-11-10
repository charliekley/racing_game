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
import { Buttons, type ControlInput } from '../../shared/protocol';

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

/** Lobby keys to pick a driver (character) and a kart body: one per keyboard scheme (WASD player, arrows player). */
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

/** D-pad left / right / down as bits 1 / 2 / 4: the lobby uses them to pick a driver and a kart. */
export function padLoadoutButtons(pad: Gamepad): number {
  const down = (i: number) => (pad.buttons[i]?.pressed ? 1 : 0);
  return down(14) | (down(15) << 1) | (down(13) << 2);
}

/** True if the pad's Start or A button is down (used to join from the lobby). */
export function gamepadWantsJoin(pad: Gamepad): boolean {
  return !!(pad.buttons[GP.START]?.pressed || pad.buttons[GP.A]?.pressed);
}

export function connectedGamepads(): Gamepad[] {
  if (!navigator.getGamepads) return [];
  return navigator.getGamepads().filter((p): p is Gamepad => !!p && p.connected);
}
