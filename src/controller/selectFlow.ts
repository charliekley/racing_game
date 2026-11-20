/**
 * The pre-race screens on the phone, full screen: NAME -> CHARACTER -> KART -> READY.
 *
 * This class only draws and reports taps. The HOST decides which step we are really on: a button sends a
 * `select` message (via `actions.select`) and the screen changes when the host's answer arrives
 * (`applyHost`). Browsing (arrows, swipes, tapping a thumbnail) updates the screen right away and is also
 * sent, so the TV shows the highlighted driver / kart live.
 *
 * Web concepts: plain DOM built with innerHTML; "pointer events" cover mouse and touch with one API, so a
 * swipe is just pointerdown followed by pointerup far enough to the left or right.
 */
import { CHARACTERS, KART_BODIES, STAT_KEYS, loadoutStats, sanitizeLoadout, type Loadout, type StatKey } from '../shared/characters';
import type { LobbyPlayerInfo, SelectRequest } from '../shared/protocol';
import { SELECT_STAGES, previousStage, stageRank, type SelectStage } from '../shared/selectStage';
import { drawPortrait } from './portrait';

const STAT_LABELS: Record<StatKey, string> = {
  speed: 'Speed',
  accel: 'Accel',
  handling: 'Handling',
  weight: 'Weight',
  drift: 'Drift',
  offroad: 'Off-road',
};

/** Swipe distance (px) that counts as "next / previous". */
const SWIPE_PX = 30;

/**
 * A finger's screen movement as movement along the controller's own x axis. When the phone is held sideways
 * with rotation lock on, main.ts rotates the whole stage with CSS (classes rot90 / rotm90 / rot180),
 * so "left" for the player is not "left" on the screen.
 */
function stageDeltaX(dx: number, dy: number): number {
  const stage = document.getElementById('stage');
  if (stage?.classList.contains('rot90')) return dy;
  if (stage?.classList.contains('rotm90')) return -dy;
  if (stage?.classList.contains('rot180')) return -dx;
  return dx;
}

export interface SelectFlowActions {
  /** Propose a step / highlight to the host. */
  select(req: SelectRequest): void;
  /** The settings gear in the header. */
  settings(): void;
}

/** The short text under a player's name on the READY screen while they are still choosing. */
const STAGE_NOTE: Record<SelectStage, string> = { name: 'joining', character: 'picking driver', kart: 'picking kart', ready: 'ready' };

type Browse = 'character' | 'kart';

export class SelectFlow {
  readonly root: HTMLElement;
  /** An empty box on the READY screen: main.ts parks the race-mode line and the RACE AGAIN button here. */
  readonly readySlot: HTMLElement;
  private stage: SelectStage = 'name';
  private loadout: Loadout = sanitizeLoadout(undefined);
  private results = false;
  private visible = false;

  private readonly head: HTMLElement;
  private readonly dots: HTMLElement[] = [];
  private readonly nameInput: HTMLInputElement;
  private readonly nameNext: HTMLButtonElement;
  private readonly browse: Record<Browse, BrowseView>;
  private readonly who: HTMLElement;
  private readonly backBtn: HTMLButtonElement;
  private players: LobbyPlayerInfo[] = [];
  private mySlot: number | null = null;

  constructor(private readonly actions: SelectFlowActions) {
    const root = document.createElement('div');
    root.className = 'sf hidden';
    root.innerHTML = `
      <div class="sf-head">
        <span class="sf-me"></span>
        <span class="sf-dots">${SELECT_STAGES.map(() => '<i></i>').join('')}</span>
        <button type="button" class="sf-gear" aria-label="Settings">⚙</button>
      </div>
      <section class="sf-screen" data-stage="name">
        <label class="sf-name-label">YOUR NAME
          <input class="sf-name" maxlength="12" autocomplete="off" spellcheck="false" placeholder="Player" />
        </label>
        <button type="button" class="sf-next">NEXT</button>
      </section>
      <section class="sf-screen" data-stage="character"></section>
      <section class="sf-screen" data-stage="kart"></section>
      <section class="sf-screen" data-stage="ready">
        <div class="sf-ready-title">READY</div>
        <div class="sf-who"></div>
        <div class="sf-ready-slot"></div>
        <button type="button" class="sf-back sf-back-ready">BACK</button>
      </section>`;
    this.root = root;
    this.head = root.querySelector('.sf-me') as HTMLElement;
    root.querySelectorAll<HTMLElement>('.sf-dots i').forEach((d) => this.dots.push(d));
    this.nameInput = root.querySelector('.sf-name') as HTMLInputElement;
    this.nameNext = root.querySelector('.sf-next') as HTMLButtonElement;
    this.who = root.querySelector('.sf-who') as HTMLElement;
    this.readySlot = root.querySelector('.sf-ready-slot') as HTMLElement;
    this.backBtn = root.querySelector('.sf-back-ready') as HTMLButtonElement;

    root.querySelector('.sf-gear')!.addEventListener('click', () => actions.settings());

    // NAME: every keystroke is sent so the TV shows the name as it is typed; NEXT (or Enter) moves on.
    this.nameInput.addEventListener('input', () => {
      this.nameNext.disabled = this.nameInput.value.trim() === '';
      actions.select({ stage: 'name', name: this.nameInput.value });
    });
    this.nameInput.addEventListener('focus', () => this.nameInput.select()); // typing replaces last time's name
    const next = () => {
      if (this.nameInput.value.trim() !== '') actions.select({ stage: 'character', name: this.nameInput.value });
    };
    this.nameNext.addEventListener('click', next);
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        next();
      }
    });

    // CHARACTER and KART share one layout.
    this.browse = {
      character: new BrowseView(root.querySelector('[data-stage="character"]') as HTMLElement, 'character', {
        step: (d) => this.step('character', d),
        jump: (i) => this.setIndex('character', i),
        confirm: () => actions.select({ stage: 'kart', character: this.loadout.character }),
        back: () => actions.select({ stage: 'name' }),
      }),
      kart: new BrowseView(root.querySelector('[data-stage="kart"]') as HTMLElement, 'kart', {
        step: (d) => this.step('kart', d),
        jump: (i) => this.setIndex('kart', i),
        confirm: () => actions.select({ stage: 'ready', kart: this.loadout.kart }),
        back: () => actions.select({ stage: 'character' }),
      }),
    };

    // BACK on the READY screen: lobby = one step back (kart); results = "Change" = start again at the driver.
    this.backBtn.addEventListener('click', () => actions.select({ stage: this.results ? 'character' : (previousStage('ready') ?? 'kart') }));
    this.render();
  }

  // --- host -> screen ---------------------------------------------------------

  /**
   * The host's word on where we are. The stage always follows the host. Name and picks are adopted only when
   * the stage changed (or `force`, e.g. the first answer on a fresh link): while we are browsing, an old echo
   * must not drag the highlight back.
   */
  applyHost(stage: SelectStage, name: string, loadout: Loadout, force = false): void {
    const changed = stage !== this.stage;
    this.stage = stage;
    if (changed || force) {
      this.loadout = sanitizeLoadout(loadout);
      if (stage === 'name' || force) this.nameInput.value = name;
    }
    this.render();
  }

  /** Who is in the game (the READY screen lists them) and which one is us. */
  setPlayers(players: LobbyPlayerInfo[], mySlot: number | null): void {
    this.players = players;
    this.mySlot = mySlot;
    this.renderWho();
  }

  setHeader(text: string): void {
    this.head.textContent = text;
  }

  /** True on the results screen: the READY screen's BACK button becomes CHANGE. */
  setResults(results: boolean): void {
    this.results = results;
    this.backBtn.textContent = results ? 'CHANGE' : 'BACK';
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.classList.toggle('hidden', !visible);
    this.render();
  }

  get currentStage(): SelectStage {
    return this.stage;
  }

  /** The text typed so far (for saving it on the phone). */
  get typedName(): string {
    return this.nameInput.value;
  }

  get picks(): Loadout {
    return { ...this.loadout };
  }

  /** Redraw the portraits (their size is only known once the screen is visible, and after rotation). */
  relayout(): void {
    if (this.visible) this.render();
  }

  // --- browsing -----------------------------------------------------------------

  private step(what: Browse, dir: number): void {
    const n = what === 'character' ? CHARACTERS.length : KART_BODIES.length;
    this.setIndex(what, (this.loadout[what] + dir + n) % n);
  }

  private setIndex(what: Browse, i: number): void {
    if (this.stage !== what || this.loadout[what] === i) return;
    this.loadout = { ...this.loadout, [what]: i };
    this.render();
    this.actions.select({ stage: what, [what]: i }); // live highlight for the TV
  }

  // --- drawing ------------------------------------------------------------------

  private render(): void {
    this.root.querySelectorAll<HTMLElement>('.sf-screen').forEach((s) => s.classList.toggle('on', s.dataset.stage === this.stage));
    const rank = stageRank(this.stage);
    this.dots.forEach((d, i) => {
      d.classList.toggle('done', i < rank);
      d.classList.toggle('now', i === rank);
    });
    this.nameNext.disabled = this.nameInput.value.trim() === '';
    if (!this.visible) return;
    if (this.stage === 'character' || this.stage === 'kart') this.browse[this.stage].show(this.loadout);
    this.renderWho();
  }

  private renderWho(): void {
    this.who.replaceChildren();
    for (const p of this.players) {
      const chip = document.createElement('span');
      const stage = p.stage ?? 'ready';
      chip.className = `sf-chip${stage === 'ready' ? ' ok' : ''}${p.slot === this.mySlot ? ' me' : ''}`;
      const name = document.createElement('b');
      name.textContent = p.name;
      const note = document.createElement('small');
      note.textContent = p.connected ? STAGE_NOTE[stage] : 'away';
      chip.append(name, note);
      this.who.appendChild(chip);
    }
  }
}

interface BrowseActions {
  step(dir: number): void;
  jump(i: number): void;
  confirm(): void;
  back(): void;
}

/** One browsing screen (character or kart): big picture with arrows, name + stat bars, a strip to tap, Back / Confirm. */
class BrowseView {
  private readonly hero: HTMLCanvasElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly blurb: HTMLElement;
  private readonly bars = new Map<StatKey, HTMLElement[]>();
  private readonly thumbs: HTMLElement[] = [];

  constructor(
    el: HTMLElement,
    private readonly what: Browse,
    actions: BrowseActions,
  ) {
    el.classList.add('sf-browse');
    el.innerHTML = `
      <div class="sf-main">
        <div class="sf-hero-box">
          <button type="button" class="sf-arrow" data-act="prev" aria-label="Previous">‹</button>
          <canvas class="sf-hero"></canvas>
          <button type="button" class="sf-arrow" data-act="next" aria-label="Next">›</button>
        </div>
        <div class="sf-info">
          <div class="sf-title"></div>
          <div class="sf-sub"></div>
          <div class="sf-blurb"></div>
          <div class="sf-stats"></div>
        </div>
      </div>
      <div class="sf-strip"></div>
      <div class="sf-foot">
        <button type="button" class="sf-back">BACK</button>
        <button type="button" class="sf-confirm">${what === 'character' ? 'THIS ONE' : 'LET’S GO'}</button>
      </div>`;
    this.hero = el.querySelector('.sf-hero') as HTMLCanvasElement;
    this.title = el.querySelector('.sf-title') as HTMLElement;
    this.sub = el.querySelector('.sf-sub') as HTMLElement;
    this.blurb = el.querySelector('.sf-blurb') as HTMLElement;

    const stats = el.querySelector('.sf-stats') as HTMLElement;
    for (const key of STAT_KEYS) {
      const row = document.createElement('div');
      row.className = 'sf-stat';
      const label = document.createElement('span');
      label.textContent = STAT_LABELS[key];
      const bar = document.createElement('span');
      bar.className = 'sf-bar';
      const segs: HTMLElement[] = [];
      for (let i = 0; i < 5; i++) {
        const seg = document.createElement('i');
        bar.appendChild(seg);
        segs.push(seg);
      }
      row.append(label, bar);
      stats.appendChild(row);
      this.bars.set(key, segs);
    }

    // The strip: eight little portraits, or four kart names. Tapping one jumps there.
    const strip = el.querySelector('.sf-strip') as HTMLElement;
    const count = what === 'character' ? CHARACTERS.length : KART_BODIES.length;
    for (let i = 0; i < count; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sf-thumb';
      b.setAttribute('aria-label', what === 'character' ? CHARACTERS[i].name : KART_BODIES[i].name);
      if (what === 'character') {
        const c = document.createElement('canvas');
        c.width = c.height = 96; // drawn once, shown at ~44 px (sharp on high-DPI screens)
        drawPortrait(c, CHARACTERS[i].look);
        b.appendChild(c);
      } else {
        b.textContent = KART_BODIES[i].name;
      }
      b.addEventListener('click', () => actions.jump(i));
      strip.appendChild(b);
      this.thumbs.push(b);
    }

    el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'prev') actions.step(-1);
      if (act === 'next') actions.step(1);
    });
    el.querySelector('.sf-back')!.addEventListener('click', actions.back);
    el.querySelector('.sf-confirm')!.addEventListener('click', actions.confirm);

    // Swipe the big picture: finger moves left = next, like flipping a page.
    let start: { x: number; y: number } | null = null;
    const box = el.querySelector('.sf-hero-box') as HTMLElement;
    box.addEventListener('pointerdown', (e) => (start = { x: e.clientX, y: e.clientY }));
    box.addEventListener('pointerup', (e) => {
      if (!start) return;
      const dx = stageDeltaX(e.clientX - start.x, e.clientY - start.y);
      start = null;
      if (Math.abs(dx) >= SWIPE_PX) actions.step(dx < 0 ? 1 : -1);
    });
    box.addEventListener('pointercancel', () => (start = null));
  }

  show(l: Loadout): void {
    const ch = CHARACTERS[l.character];
    const kart = KART_BODIES[l.kart];
    if (this.what === 'character') {
      this.title.textContent = ch.name;
      this.sub.textContent = ch.weightClass;
      this.blurb.textContent = ch.blurb;
    } else {
      this.title.textContent = kart.name;
      this.sub.textContent = `${ch.name}'s kart`;
      this.blurb.textContent = kart.blurb;
    }
    this.sub.dataset.cls = ch.weightClass;
    // Character step: the driver's own points. Kart step: driver + this body (the bars move as you browse).
    const stats = loadoutStats(this.what === 'character' ? { character: l.character, kart: 0 } : l);
    for (const key of STAT_KEYS) this.bars.get(key)!.forEach((seg, i) => seg.classList.toggle('on', i < stats[key]));
    const index = l[this.what];
    this.thumbs.forEach((t, i) => t.classList.toggle('on', i === index));
    // Portrait at the size it is displayed (sharp on high-DPI phones).
    const css = this.hero.clientWidth;
    if (css > 0) {
      const px = Math.round(css * Math.min(2, window.devicePixelRatio || 1));
      if (this.hero.width !== px) this.hero.width = this.hero.height = px;
    }
    drawPortrait(this.hero, ch.look);
  }
}
