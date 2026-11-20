/**
 * The TV's selection screen: one quadrant per player showing name -> character -> kart -> ready.
 *
 * This is the DISPLAY side of the flow: it subscribes to the SelectionHub (src/host/selectionHub.ts) and draws
 * whatever it is told; it never decides anything. The 3D parts (turntable, karts, pick animations, portraits)
 * are drawn by ONE shared WebGL canvas (src/render/kart/selectStage.ts); this file builds the DOM around it:
 * names, stat bars, portrait grids, the READY banner.
 *
 * Web concept: the canvas lies BEHIND the text in the same box. Each quadrant has an empty "window" element
 * (`.q-stage`); every frame we measure it and tell the renderer to draw that quadrant's 3D scene into exactly
 * that rectangle, so the DOM and the 3D picture can never drift apart.
 *
 * Lifetime: `show()` creates the WebGL renderer, `hide()` stops drawing and frees all GPU memory (the race
 * then has the GPU to itself). The DOM and the hub subscription stay, so nothing is lost between races.
 */
import { CHARACTERS, KART_BODIES, STAT_KEYS, paletteFor } from '../shared/characters';
import { colorHex } from '../shared/colors';
import { SelectRenderer } from '../render/kart/selectStage';
import { CLASS_LABEL, STAT_LABELS, kartName, quadrantLayout, statBars } from './selectLayout';
import type { SelectionHub, SelectionView } from './selectionHub';

interface QuadRefs {
  el: HTMLElement;
  stage: HTMLElement;
  numEl: HTMLElement;
  nameEl: HTMLElement;
  whatEl: HTMLElement;
  subEl: HTMLElement;
  swatches: HTMLElement[];
  bars: { seg: HTMLElement[] }[];
  charTiles: HTMLElement[];
  kartTiles: HTMLElement[];
  /** What was last drawn, so unchanged things are not touched. */
  shown: { name: string; stage: string; character: number; kart: number; bars: string };
  /** Current scale unit (px) and arrangement, see fitQuad. */
  u: number;
  tall: boolean;
}

export interface SelectViewOptions {
  /** Called when the little X on a quadrant is pressed (removes that player). */
  onKick?(slot: number): void;
}

export class SelectView {
  private readonly grid = document.createElement('div');
  private readonly quads = new Map<number, QuadRefs>();
  private ghosts: HTMLElement[] = [];
  private views: readonly SelectionView[] = [];
  private renderer: SelectRenderer | null = null;
  private raf = 0;
  private last = 0;
  private unsubscribe: () => void;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly hub: SelectionHub,
    private readonly opts: SelectViewOptions = {},
  ) {
    this.root.classList.add('select-area');
    this.grid.className = 'select-grid';
    this.root.appendChild(this.grid);
    this.unsubscribe = this.hub.subscribe((views) => this.onViews(views));
  }

  /** Start drawing (creates the WebGL renderer); call it once after constructing. Safe to call repeatedly. */
  show(): void {
    if (this.renderer || this.raf) return;
    this.root.classList.remove('paused');
    try {
      this.renderer = new SelectRenderer(this.root);
      this.renderer.onPortrait = () => this.refreshPortraits();
      this.renderer.setViews(this.views);
      this.renderer.prewarm();
    } catch (err) {
      // No WebGL (or it failed): the quadrants still work as plain text, just without the 3D picture.
      console.warn('Selection screen: 3D unavailable', err);
      this.renderer = null;
    }
    this.resizeObserver = new ResizeObserver(() => this.renderer?.resize());
    this.resizeObserver.observe(this.root);
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.loop(t));
    this.refreshPortraits();
  }

  /** Stop drawing and free the GPU (the race starts). The hub subscription stays. */
  hide(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.root.classList.add('paused');
  }

  /** Forget everything (leaving the page, tests). */
  dispose(): void {
    this.hide();
    this.unsubscribe();
    this.grid.remove();
  }

  /** Whether the 3D renderer exists (for the dev page and tests). */
  get running(): boolean {
    return this.renderer !== null;
  }

  // ---- frame loop -------------------------------------------------------------

  private loop(now: number): void {
    this.raf = requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const r = this.renderer;
    if (!r) return;
    r.resize();
    const base = this.root.getBoundingClientRect();
    for (const [slot, q] of this.quads) {
      this.fitQuad(q);
      const b = q.stage.getBoundingClientRect();
      r.setRect(slot, { x: b.left - base.left, y: b.top - base.top, w: b.width, h: b.height });
    }
    r.frame(dt);
  }

  /** Scale the text to the quadrant (--u = about 1% of its smaller side) and pick the wide or tall arrangement. */
  private fitQuad(q: QuadRefs): void {
    const b = q.el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) return;
    const u = Math.max(1.2, Math.min(b.width / 1.9, b.height) / 100);
    if (Math.abs(u - q.u) > 0.02) {
      q.u = u;
      q.el.style.setProperty('--u', `${u.toFixed(3)}px`);
    }
    const tall = b.width / b.height < 1.25;
    if (tall !== q.tall) {
      q.tall = tall;
      q.el.classList.toggle('tall', tall);
    }
  }

  // ---- hub -> DOM ---------------------------------------------------------------

  private onViews(views: readonly SelectionView[]): void {
    this.views = views;
    this.layout(views);
    for (const v of views) this.updateQuad(v);
    this.renderer?.setViews(views);
    this.refreshPortraits();
  }

  /** Create / remove quadrants and place them in the grid. */
  private layout(views: readonly SelectionView[]): void {
    const live = new Set(views.map((v) => v.slot));
    for (const [slot, q] of this.quads) {
      if (!live.has(slot)) {
        q.el.remove();
        this.quads.delete(slot);
      }
    }
    const lay = quadrantLayout(views.length);
    this.grid.style.gridTemplateColumns = `repeat(${lay.cols}, 1fr)`;
    this.grid.style.gridTemplateRows = `repeat(${lay.rows}, 1fr)`;
    views.forEach((v, i) => {
      let q = this.quads.get(v.slot);
      if (!q) {
        q = this.buildQuad(v.slot);
        this.quads.set(v.slot, q);
        this.grid.appendChild(q.el);
      }
      const cell = lay.cells[i] ?? { col: 0, row: 0 };
      q.el.style.gridColumn = String(cell.col + 1);
      q.el.style.gridRow = String(cell.row + 1);
      q.numEl.textContent = `P${v.slot + 1}`;
    });
    // "Join" hints: one big empty box when nobody is here yet, one spare cell when three are.
    this.ghosts.forEach((g) => g.remove());
    this.ghosts = [];
    const wantGhosts = views.length === 0 ? 1 : views.length === 3 ? 1 : 0;
    for (let i = 0; i < wantGhosts; i++) {
      const g = document.createElement('div');
      g.className = 'quad ghost';
      g.innerHTML = '<div class="ghost-icon"></div>';
      const cell = views.length === 0 ? { col: 0, row: 0 } : { col: 1, row: 1 };
      g.style.gridColumn = String(cell.col + 1);
      g.style.gridRow = String(cell.row + 1);
      this.grid.appendChild(g);
      this.ghosts.push(g);
    }
  }

  private buildQuad(slot: number): QuadRefs {
    const el = document.createElement('div');
    el.className = 'quad';
    el.dataset.slot = String(slot);
    el.style.setProperty('--slot', colorHex(slot));
    el.innerHTML = `
      <div class="q-stage"></div>
      <div class="q-head"><span class="q-num"></span><span class="q-name"></span><button class="q-kick" title="Remove player" tabindex="-1">&times;</button></div>
      <div class="q-banner">READY!</div>
      <div class="q-info">
        <div class="q-title"><b class="q-what"></b><i class="q-sub"></i><span class="q-pal"><u></u><u></u><u></u><u></u></span></div>
        <div class="q-bars"></div>
        <div class="q-grid chars"></div>
        <div class="q-grid karts"></div>
      </div>`;
    const q = (sel: string) => el.querySelector(sel) as HTMLElement;
    const barsEl = q('.q-bars');
    const bars = Array.from({ length: 6 }, () => {
      const row = document.createElement('div');
      row.className = 'q-bar';
      const label = document.createElement('span');
      const segs = document.createElement('span');
      segs.className = 'segs';
      const seg = Array.from({ length: 5 }, () => segs.appendChild(document.createElement('i')));
      row.append(label, segs);
      barsEl.appendChild(row);
      return { seg, label };
    });
    // Tiles: a coloured plate (the palette) with the head / kart picture on it.
    const makeTiles = (grid: HTMLElement, n: number, paint: (i: number) => string) =>
      Array.from({ length: n }, (_, i) => {
        const t = document.createElement('div');
        t.className = 'tile';
        t.style.setProperty('--tile', paint(i));
        t.appendChild(document.createElement('img'));
        grid.appendChild(t);
        return t;
      });
    const charTiles = makeTiles(q('.q-grid.chars'), CHARACTERS.length, (i) => `linear-gradient(150deg, ${CHARACTERS[i].palette.body}, ${CHARACTERS[i].palette.trim})`);
    const kartTiles = makeTiles(q('.q-grid.karts'), KART_BODIES.length, () => 'linear-gradient(150deg, #39418a, #232a62)');
    q('.q-kick').addEventListener('click', () => this.opts.onKick?.(slot));
    // Stat labels never change.
    bars.forEach((b, i) => (b.label.textContent = STAT_LABELS[STAT_KEYS[i]]));
    return {
      el,
      stage: q('.q-stage'),
      numEl: q('.q-num'),
      nameEl: q('.q-name'),
      whatEl: q('.q-what'),
      subEl: q('.q-sub'),
      swatches: Array.from(el.querySelectorAll('.q-pal u')) as HTMLElement[],
      bars,
      charTiles,
      kartTiles,
      shown: { name: '\u0000', stage: '', character: -1, kart: -1, bars: '' },
      u: 0,
      tall: false,
    };
  }

  private updateQuad(v: SelectionView): void {
    const q = this.quads.get(v.slot);
    if (!q) return;
    const s = q.shown;
    const el = q.el;
    const pal = paletteFor(v.character);
    if (s.stage !== v.stage) {
      el.dataset.stage = v.stage;
      // Replay the info panel's pop-in animation.
      el.classList.remove('swap');
      void el.offsetWidth; // forces the browser to notice the class was removed, so adding it again restarts the animation
      el.classList.add('swap');
      s.stage = v.stage;
    }
    el.dataset.input = v.input;
    el.style.setProperty('--body', pal.body);
    el.style.setProperty('--trim', pal.trim);
    el.style.setProperty('--accent', pal.accent);
    if (s.name !== v.name) {
      this.setName(q, v.name);
      s.name = v.name;
    }
    // Title and palette dots.
    const showKart = v.stage === 'kart';
    const c = CHARACTERS[v.character];
    if (s.character !== v.character || s.kart !== v.kart || s.bars === '') {
      [pal.body, pal.trim, pal.accent, pal.wheels].forEach((col, i) => (q.swatches[i].style.background = col));
      q.charTiles.forEach((t, i) => t.classList.toggle('on', i === v.character));
      q.kartTiles.forEach((t, i) => t.classList.toggle('on', i === v.kart));
    }
    if (v.stage === 'ready') {
      q.whatEl.textContent = c.name;
      q.subEl.textContent = kartName(v.kart);
    } else {
      q.whatEl.textContent = showKart ? kartName(v.kart) : c.name;
      q.subEl.textContent = showKart ? c.name : CLASS_LABEL[c.weightClass];
    }
    s.character = v.character;
    s.kart = v.kart;
    // Stat bars: the character alone while browsing characters, character + body after that.
    const bars = statBars(v.character, v.stage === 'character' || v.stage === 'name' ? -1 : v.kart);
    const sig = bars.map((b) => `${b.total}${b.bonus}${b.lost}`).join(',');
    if (sig !== s.bars) {
      s.bars = sig;
      bars.forEach((b, i) => {
        const segs = q.bars[i].seg;
        for (let k = 0; k < 5; k++) {
          const base = Math.min(b.base, b.total);
          segs[k].className = k < base ? 'on' : k < b.total ? 'bonus' : k < b.base ? 'lost' : '';
        }
      });
    }
    this.refreshPortraitsOf(q);
  }

  /** Show the name; letters that are new pop in (so a name typed on a phone appears letter by letter). */
  private setName(q: QuadRefs, name: string): void {
    const prev = q.nameEl.dataset.text ?? '';
    q.nameEl.dataset.text = name;
    q.nameEl.classList.toggle('empty', name.length === 0);
    q.nameEl.replaceChildren();
    // Names come from phones: only ever set as text, never as HTML.
    [...name].forEach((ch, i) => {
      const span = document.createElement('span');
      span.textContent = ch === ' ' ? ' ' : ch;
      if (i >= prev.length || prev[i] !== ch) span.className = 'new';
      q.nameEl.appendChild(span);
    });
  }

  // ---- portraits --------------------------------------------------------------------

  private refreshPortraits(): void {
    for (const q of this.quads.values()) this.refreshPortraitsOf(q);
  }

  private refreshPortraitsOf(q: QuadRefs): void {
    const r = this.renderer;
    if (!r) return;
    const view = this.views.find((v) => this.quads.get(v.slot) === q);
    if (!view) return;
    // Character heads (once) and, in the kart stage, the bodies in the chosen character's colours.
    q.charTiles.forEach((t, i) => this.setImg(t, r.portrait(i, -1)));
    if (view.stage === 'kart' || view.stage === 'ready') {
      q.kartTiles.forEach((t, k) => this.setImg(t, r.portrait(view.character, k)));
    }
  }

  private setImg(tile: HTMLElement, url: string | null): void {
    const img = tile.firstElementChild as HTMLImageElement;
    if (url && img.getAttribute('src') !== url) img.src = url;
    tile.classList.toggle('has-img', url !== null);
  }
}
