/**
 * Multi-touch buttons using Pointer Events.
 *
 * Web concept: Pointer Events unify mouse, pen and touch. Each finger gets its
 * own `pointerId`, so we track which button every finger is on. That gives true
 * multi-touch (gas + drift + item at once) and lets a thumb slide from one
 * button to a neighbour (e.g. GAS -> DRIFT) without lifting.
 *
 * Elements with a `data-button="GAS"` attribute (names from `Buttons`) inside
 * the given zones become buttons.
 */
import { Buttons, type ButtonName } from '../shared/protocol';

export class TouchButtons {
  /** pointerId -> button bit (0 = finger is down but not on a button) */
  private pointers = new Map<number, number>();
  private mask = 0;
  private elements = new Map<number, HTMLElement>();

  constructor(
    zones: HTMLElement[],
    private readonly onChange: (mask: number, pressedNow: number) => void,
  ) {
    for (const zone of zones) {
      zone.querySelectorAll<HTMLElement>('[data-button]').forEach((el) => {
        const bit = Buttons[el.dataset.button as ButtonName];
        if (bit) this.elements.set(bit, el);
      });
      zone.addEventListener('pointerdown', (e) => this.down(e));
      zone.addEventListener('pointermove', (e) => this.move(e));
      zone.addEventListener('pointerup', (e) => this.up(e));
      zone.addEventListener('pointercancel', (e) => this.up(e));
      zone.addEventListener('lostpointercapture', (e) => this.up(e));
    }
  }

  get buttons(): number {
    return this.mask;
  }

  /** Release everything (e.g. when the app goes to the background). */
  releaseAll(): void {
    this.pointers.clear();
    this.recompute();
  }

  private hit(e: PointerEvent): number {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-button]');
    return el ? (Buttons[el.dataset.button as ButtonName] ?? 0) : 0;
  }

  private down(e: PointerEvent): void {
    e.preventDefault(); // no text selection / emulated mouse events
    this.pointers.set(e.pointerId, this.hit(e));
    this.recompute();
  }

  private move(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    const bit = this.hit(e);
    if (bit !== this.pointers.get(e.pointerId)) {
      this.pointers.set(e.pointerId, bit);
      this.recompute();
    }
  }

  private up(e: PointerEvent): void {
    if (this.pointers.delete(e.pointerId)) this.recompute();
  }

  private recompute(): void {
    let mask = 0;
    for (const bit of this.pointers.values()) mask |= bit;
    const pressedNow = mask & ~this.mask;
    if (mask === this.mask) return;
    this.mask = mask;
    for (const [bit, el] of this.elements) el.classList.toggle('pressed', (mask & bit) !== 0);
    this.onChange(mask, pressedNow);
  }
}
