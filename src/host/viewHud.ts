/**
 * The HUD drawn over one player's viewport: position, lap, race time, speed,
 * held item, drift meter, big center messages and screen flashes.
 *
 * Web concept: each HUD is an absolutely positioned <div> covering its
 * viewport. It's a CSS "size container", so its fonts use cqh units
 * (1cqh = 1% of the HUD's own height) and scale correctly whether the view
 * is full screen or a quarter of it. Animations are CSS keyframes: we only
 * add/remove a class (restarting an animation = remove class, force a
 * reflow with `void el.offsetWidth`, add the class again).
 */
import type { Rect } from '../render/layout';
import { KART } from '../sim/config';
import { InkOverlay } from './inkOverlay';
import type { ItemDisplay } from '../shared/protocol';
import { isIconAnimated, paintItemIcon, paintRoulette } from '../shared/itemIcons';

const ordinalSuffix = (n: number) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');

export interface HudState {
  position: number;
  racers: number;
  lap: number;
  laps: number;
  time: string;
  speedKmh: number;
  boosting: boolean;
  item: ItemDisplay;
  /** Drift charge, 0..1 where 1 = the orange (tier 2) threshold. */
  driftCharge: number;
  /** 0 = not drifting / no sparks, 1 = blue, 2 = orange. */
  driftTier: number;
  drifting: boolean;
  /** 0..1 strength of the speed-line overlay. */
  speedFx: number;
}

/** Style of a big center message. */
export type ToastKind = 'plain' | 'count' | 'go' | 'finish';

export class ViewHud {
  readonly root = document.createElement('div');
  private pos: HTMLElement;
  private posBox: HTMLElement;
  private posSuffix: HTMLElement;
  private lap: HTMLElement;
  private time: HTMLElement;
  private speed: HTMLElement;
  private center: HTMLElement;
  private banner: HTMLElement;
  private flashEl: HTMLElement;
  private itemBox: HTMLElement;
  private itemCanvas: HTMLCanvasElement;
  private itemCtx: CanvasRenderingContext2D;
  private drift: HTMLElement;
  private driftFill: HTMLElement;
  private itemKey = '';
  private ink: InkOverlay;
  private toastUntil = 0;
  private bannerUntil = 0;
  private last = '';
  private lastPos = 0;
  private lastLap = 0;
  private lastFx = -1;
  private lastDrift = -1;
  private lastTier = -1;

  constructor(parent: HTMLElement, name: string, color: string, slot: number) {
    this.root.className = 'view-hud';
    this.root.style.setProperty('--slot-color', color);
    this.root.innerHTML = `
      <div class="hud-flash"></div>
      <div class="hud-speedlines"><i></i><i></i></div>
      <div class="hud-pos"><span class="pos-num"></span><span class="pos-suffix"></span></div>
      <div class="hud-tag"><span class="tag-slot">P${slot + 1}</span> <span class="tag-name"></span></div>
      <div class="hud-item" title="Item"><canvas width="96" height="96"></canvas></div>
      <div class="hud-topright"><div class="hud-lap"></div><div class="hud-time"></div></div>
      <div class="hud-drift"><div class="drift-fill"></div><div class="drift-mark"></div></div>
      <div class="hud-center"></div>
      <div class="hud-banner"></div>
      <div class="hud-speed"></div>`;
    (this.root.querySelector('.tag-name') as HTMLElement).textContent = name; // from a phone: textContent only
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.pos = q('.pos-num');
    this.posBox = q('.hud-pos');
    this.posSuffix = q('.pos-suffix');
    this.lap = q('.hud-lap');
    this.time = q('.hud-time');
    this.speed = q('.hud-speed');
    this.center = q('.hud-center');
    this.banner = q('.hud-banner');
    this.flashEl = q('.hud-flash');
    this.itemBox = q('.hud-item');
    this.drift = q('.hud-drift');
    this.driftFill = q('.drift-fill');
    // Marker where the blue tier starts on the meter.
    q('.drift-mark').style.left = `${(KART.driftTier1 / KART.driftTier2) * 100}%`;
    this.itemCanvas = this.itemBox.querySelector('canvas') as HTMLCanvasElement;
    this.itemCtx = this.itemCanvas.getContext('2d')!;
    parent.appendChild(this.root);
    // Ink splat (Jumble). Its canvas is added last, so CSS keeps the HUD text above it.
    this.ink = new InkOverlay(this.root);
  }

  place(rect: Rect): void {
    Object.assign(this.root.style, {
      left: `${rect.x * 100}%`,
      top: `${rect.y * 100}%`,
      width: `${rect.w * 100}%`,
      height: `${rect.h * 100}%`,
    });
  }

  /** Restart a CSS animation class on an element. */
  private static retrigger(el: HTMLElement, cls: string): void {
    el.classList.remove(cls);
    void el.offsetWidth; // force a reflow so the browser restarts the animation
    el.classList.add(cls);
  }

  update(s: HudState, now: number): void {
    // Only touch the DOM when something visible changed (cheap with 4 HUDs at 60 fps).
    const key = `${s.position}|${s.lap}|${s.time}|${s.speedKmh}|${s.boosting}`;
    if (key !== this.last) {
      this.last = key;
      this.pos.textContent = String(s.position);
      this.posSuffix.textContent = ordinalSuffix(s.position);
      this.lap.innerHTML = `LAP <b>${s.lap}</b>/${s.laps}`;
      this.time.textContent = s.time;
      this.speed.innerHTML = `<b>${s.speedKmh}</b><span>km/h</span>`;
      // Subtle speedometer ring: fills with speed (0..1 of top speed ~ 190 km/h).
      this.speed.style.setProperty('--spd', String(Math.min(1, s.speedKmh / (KART.maxSpeed * 3.6)).toFixed(2)));
      this.root.classList.toggle('boosting', s.boosting);
    }

    // Position pop: green kick when you gain a place, red when you lose one.
    if (s.position !== this.lastPos) {
      if (this.lastPos !== 0) {
        this.posBox.classList.remove('pop-up', 'pop-down');
        ViewHud.retrigger(this.posBox, s.position < this.lastPos ? 'pop-up' : 'pop-down');
      }
      this.lastPos = s.position;
    }
    // Lap pill pulses when a new lap starts.
    if (s.lap !== this.lastLap) {
      if (this.lastLap !== 0) ViewHud.retrigger(this.lap, 'pop');
      this.lastLap = s.lap;
    }

    // Speed lines (quantised so we write the style rarely).
    const fx = Math.round(s.speedFx * 20) / 20;
    if (fx !== this.lastFx) {
      this.lastFx = fx;
      this.root.style.setProperty('--fx', String(fx));
    }

    // Drift meter: shown while drifting, fills through the tiers.
    const charge = s.drifting ? Math.round(Math.min(1, s.driftCharge) * 100) : 0;
    if (charge !== this.lastDrift) {
      this.lastDrift = charge;
      this.driftFill.style.width = `${charge}%`;
      this.drift.classList.toggle('on', s.drifting);
    }
    if (s.driftTier !== this.lastTier) {
      this.lastTier = s.driftTier;
      this.drift.dataset.tier = String(s.driftTier);
    }

    this.drawItem(s.item, now);
    this.ink.update(now);
    if (now > this.toastUntil && this.center.classList.contains('show')) this.center.classList.remove('show');
    if (now > this.bannerUntil && this.banner.classList.contains('show')) this.banner.classList.remove('show');
  }

  /** Redraw the item icon when it changes, and every frame while it animates (roulette, shimmer). */
  private drawItem(item: ItemDisplay, now: number): void {
    const animating = item.kind === 'roulette' || (item.kind === 'item' && isIconAnimated(item.id));
    const key = item.kind === 'item' ? `${item.id}x${item.count}` : item.kind;
    if (key === this.itemKey && !animating) return;
    if (key !== this.itemKey) {
      // Slot reacts: a spin frame while the roulette runs, a pop when the item is revealed.
      this.itemBox.classList.toggle('rolling', item.kind === 'roulette');
      this.itemBox.classList.toggle('filled', item.kind === 'item');
      if (item.kind === 'item') ViewHud.retrigger(this.itemBox, 'got');
    }
    this.itemKey = key;
    const ctx = this.itemCtx;
    const size = this.itemCanvas.width;
    ctx.clearRect(0, 0, size, size);
    const inset = size * 0.1;
    ctx.save();
    ctx.translate(inset, inset);
    if (item.kind === 'roulette') paintRoulette(ctx, size - inset * 2, now * 1000);
    else if (item.kind === 'item') paintItemIcon(ctx, item.id, size - inset * 2, now * 1000, item.count);
    ctx.restore();
  }

  /** Splat ink over this player's screen for `seconds` (they were hit by a Jumble). */
  showInk(seconds: number): void {
    this.ink.show(seconds);
  }

  /** A quick coloured screen flash: 'hit' (red/white), 'boost' (orange), 'item' (gold). */
  flash(kind: 'hit' | 'boost' | 'item'): void {
    this.flashEl.dataset.kind = kind;
    ViewHud.retrigger(this.flashEl, 'go');
  }

  /** Big center message for `seconds`. `kind` picks its look (countdown digit, GO!, finish). */
  toast(text: string, seconds: number, now: number, kind: ToastKind = 'plain'): void {
    this.center.textContent = text;
    this.center.dataset.kind = kind;
    this.center.dataset.n = kind === 'count' ? text : '';
    this.center.classList.remove('show');
    void this.center.offsetWidth; // restart the pop-in animation
    this.center.classList.add('show');
    this.toastUntil = now + seconds;
  }

  /** A wide banner that sweeps across the screen (FINAL LAP!). */
  showBanner(text: string, seconds: number, now: number): void {
    this.banner.textContent = text;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    this.bannerUntil = now + seconds;
  }

  get toastText(): string {
    return this.center.textContent ?? '';
  }

  dispose(): void {
    this.ink.dispose();
    this.root.remove();
  }
}
