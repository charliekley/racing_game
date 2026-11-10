/**
 * The driver + kart picker shown on the phone while in the lobby.
 *
 * Layout (built with plain DOM, inserted into the controller's centre column):
 *   [‹]  portrait  [›]      <- pick a driver (or swipe the portrait left/right)
 *        Name  · class
 *        one-line blurb
 *   [‹]  Kart name  [›]     <- pick a kart body
 *   six stat bars           <- from loadoutStats(): driver points + kart bonus, live
 *
 * It only edits a `Loadout` and reports changes through `onChange`; saving it and
 * sending it to the TV is main.ts's job.
 *
 * Web concept: "pointer events" cover mouse and touch with one API. A swipe is just
 * pointerdown, then pointerup far enough to the left or right.
 */
import { CHARACTERS, KART_BODIES, STAT_KEYS, loadoutStats, sanitizeLoadout, type Loadout, type StatKey } from '../shared/characters';
import { drawPortrait } from './portrait';

const STAT_LABELS: Record<StatKey, string> = {
  speed: 'Speed',
  accel: 'Accel',
  handling: 'Handling',
  weight: 'Weight',
  drift: 'Drift',
  offroad: 'Off-road',
};

/**
 * A finger's screen movement as movement along the controller's own x axis. When the phone is
 * held sideways with rotation lock on, main.ts rotates the whole stage with CSS (classes
 * rot90 / rotm90 / rot180), so "left" for the player is not "left" on the screen.
 */
function stageDeltaX(dx: number, dy: number): number {
  const stage = document.getElementById('stage');
  if (stage?.classList.contains('rot90')) return dy;
  if (stage?.classList.contains('rotm90')) return -dy;
  if (stage?.classList.contains('rot180')) return -dx;
  return dx;
}

/** Swipe distance (px) that counts as "next/previous". */
const SWIPE_PX = 30;

export class Picker {
  readonly root: HTMLElement;
  private loadout: Loadout;
  private readonly portrait: HTMLCanvasElement;
  private readonly nameEl: HTMLElement;
  private readonly classEl: HTMLElement;
  private readonly blurbEl: HTMLElement;
  private readonly kartNameEl: HTMLElement;
  private readonly kartBlurbEl: HTMLElement;
  private readonly bars = new Map<StatKey, HTMLElement[]>();
  private locked = false;

  constructor(
    initial: Loadout,
    private readonly onChange: (l: Loadout) => void,
  ) {
    this.loadout = sanitizeLoadout(initial);
    const root = document.createElement('div');
    root.className = 'picker';
    root.innerHTML = `
      <div class="pk-char">
        <button type="button" class="pk-arrow" data-act="cprev" aria-label="Previous driver">‹</button>
        <canvas class="pk-portrait" width="160" height="160"></canvas>
        <button type="button" class="pk-arrow" data-act="cnext" aria-label="Next driver">›</button>
      </div>
      <div class="pk-name"><span class="pk-name-text"></span><span class="pk-class"></span></div>
      <div class="pk-blurb"></div>
      <div class="pk-kart">
        <button type="button" class="pk-arrow small" data-act="kprev" aria-label="Previous kart">‹</button>
        <div class="pk-kart-text"><b></b><span></span></div>
        <button type="button" class="pk-arrow small" data-act="knext" aria-label="Next kart">›</button>
      </div>
      <div class="pk-stats"></div>`;
    this.root = root;
    this.portrait = root.querySelector('.pk-portrait') as HTMLCanvasElement;
    this.nameEl = root.querySelector('.pk-name-text') as HTMLElement;
    this.classEl = root.querySelector('.pk-class') as HTMLElement;
    this.blurbEl = root.querySelector('.pk-blurb') as HTMLElement;
    this.kartNameEl = root.querySelector('.pk-kart-text b') as HTMLElement;
    this.kartBlurbEl = root.querySelector('.pk-kart-text span') as HTMLElement;

    const statsEl = root.querySelector('.pk-stats') as HTMLElement;
    for (const key of STAT_KEYS) {
      const row = document.createElement('div');
      row.className = 'pk-stat';
      const label = document.createElement('span');
      label.textContent = STAT_LABELS[key];
      const bar = document.createElement('span');
      bar.className = 'pk-bar';
      const segs: HTMLElement[] = [];
      for (let i = 0; i < 5; i++) {
        const seg = document.createElement('i');
        bar.appendChild(seg);
        segs.push(seg);
      }
      row.append(label, bar);
      statsEl.appendChild(row);
      this.bars.set(key, segs);
    }

    root.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (!act || this.locked) return;
      if (act === 'cprev') this.step('character', -1);
      if (act === 'cnext') this.step('character', 1);
      if (act === 'kprev') this.step('kart', -1);
      if (act === 'knext') this.step('kart', 1);
    });

    // Swipe the portrait sideways to change driver; swipe the kart row to change kart.
    this.addSwipe(root.querySelector('.pk-char') as HTMLElement, 'character');
    this.addSwipe(root.querySelector('.pk-kart') as HTMLElement, 'kart');
    this.render();
  }

  private addSwipe(el: HTMLElement, what: 'character' | 'kart'): void {
    let start: { x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointerup', (e) => {
      if (!start) return;
      const dx = stageDeltaX(e.clientX - start.x, e.clientY - start.y);
      start = null;
      if (Math.abs(dx) < SWIPE_PX || this.locked) return;
      this.step(what, dx < 0 ? 1 : -1); // finger moves left = next, like flipping a page
    });
    el.addEventListener('pointercancel', () => (start = null));
  }

  private step(what: 'character' | 'kart', dir: number): void {
    const n = what === 'character' ? CHARACTERS.length : KART_BODIES.length;
    this.set({ ...this.loadout, [what]: (this.loadout[what] + dir + n) % n });
  }

  get value(): Loadout {
    return { ...this.loadout };
  }

  /** Replace the loadout (e.g. what the host says we have). Does not fire onChange. */
  setValue(l: Loadout): void {
    const next = sanitizeLoadout(l);
    if (next.character === this.loadout.character && next.kart === this.loadout.kart) return;
    this.loadout = next;
    this.render();
  }

  /** While locked (a race is running) the arrows and swipes do nothing. */
  setLocked(locked: boolean): void {
    this.locked = locked;
    this.root.classList.toggle('locked', locked);
  }

  private set(l: Loadout): void {
    this.loadout = l;
    this.render();
    this.onChange({ ...l });
  }

  /** Redraw the portrait, names and stat bars for the current loadout. */
  private render(): void {
    const ch = CHARACTERS[this.loadout.character];
    const kart = KART_BODIES[this.loadout.kart];
    this.nameEl.textContent = ch.name;
    this.classEl.textContent = ch.weightClass;
    this.classEl.dataset.cls = ch.weightClass;
    this.blurbEl.textContent = ch.blurb;
    this.kartNameEl.textContent = kart.name;
    this.kartBlurbEl.textContent = kart.blurb;
    const stats = loadoutStats(this.loadout);
    for (const key of STAT_KEYS) this.bars.get(key)!.forEach((seg, i) => seg.classList.toggle('on', i < stats[key]));
    this.drawPortrait();
  }

  /** (Re)draw the portrait at the size it is displayed (sharp on high-DPI phones). Also call after layout changes. */
  drawPortrait(): void {
    const cssSize = this.portrait.clientWidth;
    if (cssSize > 0) {
      const px = Math.round(cssSize * Math.min(2, window.devicePixelRatio || 1));
      if (this.portrait.width !== px) {
        this.portrait.width = px;
        this.portrait.height = px;
      }
    }
    drawPortrait(this.portrait, CHARACTERS[this.loadout.character].look);
  }
}
