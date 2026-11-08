/**
 * The HUD drawn over one player's viewport: position, lap, race time, speed,
 * held item, player tag and big center messages (countdown, LAP 2, FINISH!).
 *
 * Web concept: each HUD is an absolutely positioned <div> covering its
 * viewport. It's a CSS "size container", so its fonts use cqh units
 * (1cqh = 1% of the HUD's own height) and scale correctly whether the view
 * is full screen or a quarter of it.
 */
import type { Rect } from '../render/layout';

const ordinalSuffix = (n: number) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');

export interface HudState {
  position: number;
  racers: number;
  lap: number;
  laps: number;
  time: string;
  speedKmh: number;
  boosting: boolean;
}

export class ViewHud {
  readonly root = document.createElement('div');
  private pos: HTMLElement;
  private posSuffix: HTMLElement;
  private lap: HTMLElement;
  private time: HTMLElement;
  private speed: HTMLElement;
  private center: HTMLElement;
  private toastUntil = 0;
  private last = '';

  constructor(parent: HTMLElement, name: string, color: string, slot: number) {
    this.root.className = 'view-hud';
    this.root.style.setProperty('--slot-color', color);
    this.root.innerHTML = `
      <div class="hud-pos"><span class="pos-num"></span><span class="pos-suffix"></span></div>
      <div class="hud-tag"><span class="tag-slot">P${slot + 1}</span> <span class="tag-name"></span></div>
      <div class="hud-item" title="Item"></div>
      <div class="hud-topright"><div class="hud-lap"></div><div class="hud-time"></div></div>
      <div class="hud-center"></div>
      <div class="hud-speed"></div>`;
    (this.root.querySelector('.tag-name') as HTMLElement).textContent = name; // from a phone: textContent only
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.pos = q('.pos-num');
    this.posSuffix = q('.pos-suffix');
    this.lap = q('.hud-lap');
    this.time = q('.hud-time');
    this.speed = q('.hud-speed');
    this.center = q('.hud-center');
    parent.appendChild(this.root);
  }

  place(rect: Rect): void {
    Object.assign(this.root.style, {
      left: `${rect.x * 100}%`,
      top: `${rect.y * 100}%`,
      width: `${rect.w * 100}%`,
      height: `${rect.h * 100}%`,
    });
  }

  update(s: HudState, now: number): void {
    // Only touch the DOM when something visible changed (cheap with 4 HUDs at 60 fps).
    const key = `${s.position}|${s.lap}|${s.time}|${s.speedKmh}|${s.boosting}`;
    if (key !== this.last) {
      this.last = key;
      this.pos.textContent = String(s.position);
      this.posSuffix.textContent = `${ordinalSuffix(s.position)}`;
      this.lap.innerHTML = `LAP <b>${s.lap}</b>/${s.laps}`;
      this.time.textContent = s.time;
      this.speed.innerHTML = `<b>${s.speedKmh}</b> km/h`;
      this.root.classList.toggle('boosting', s.boosting);
    }
    if (now > this.toastUntil && this.center.classList.contains('show')) this.center.classList.remove('show');
  }

  /** Big center message for `seconds`. */
  toast(text: string, seconds: number, now: number): void {
    this.center.textContent = text;
    this.center.classList.remove('show');
    void this.center.offsetWidth; // restart the pop-in animation
    this.center.classList.add('show');
    this.toastUntil = now + seconds;
  }

  get toastText(): string {
    return this.center.textContent ?? '';
  }

  dispose(): void {
    this.root.remove();
  }
}
