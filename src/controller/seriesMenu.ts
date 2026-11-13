/**
 * The race menu on the phone: pick the mode and the track (menu owner, usually P1), or
 * pick the next track in "Loser picks" (the last-place player). A full-screen overlay with
 * a column of mode buttons and a row of track cards, each with a small map picture the TV drew.
 *
 * It only shows state and reports taps through `actions`; main.ts sends them to the host,
 * and the host decides whether they are allowed (never trust the phone, never trust the host
 * blindly either: the cards were already validated by parseTrackCards).
 *
 * Web concept: the track pictures are "data URLs" (`data:image/webp;base64,...`): the image
 * bytes written as text, so they can travel inside one JSON message and be used as an <img src>.
 */
import type { ForcedKind } from '../shared/forcedChoice';
import type { SeriesInfo, SeriesMode, TrackCard } from '../shared/protocol';

export interface SeriesMenuActions {
  setMode(mode: SeriesMode): void;
  setTrack(track: number): void;
  pick(track: number): void;
  stop(): void;
  /** Forced pop-up finished: the host stops waiting for us. `track` = the chosen track (omitted in Grand Prix). */
  finish(track?: number): void;
}

const MODES: { mode: SeriesMode; label: string; sub: string }[] = [
  { mode: 'single', label: 'SINGLE RACE', sub: 'one track' },
  { mode: 'gp', label: 'GRAND PRIX', sub: 'all tracks, points' },
  { mode: 'loser', label: 'LOSER PICKS', sub: 'last place chooses' },
];

export type MenuKind = 'setup' | 'pick';

/**
 * The same overlay has two personalities:
 *  - normal (opened with a button): mode + tracks together, with a DONE button;
 *  - forced (`sync`): the host needs a decision from this phone, so there is NO close button.
 *    Setup is two steps (mode, then track; Grand Prix needs no track), Loser picks is one (track).
 *    It closes only when the host's state says the choice was made (by us, or by the host keyboard),
 *    or somebody else became the chooser, so it can never trap anybody.
 */

export class SeriesMenu {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly modes: HTMLElement;
  private readonly tracks: HTMLElement;
  private readonly note: HTMLElement;
  private readonly stopBtn: HTMLButtonElement;
  private kind: MenuKind = 'setup';
  private info: SeriesInfo | null = null;
  private cards: TrackCard[] | null = null;
  private canStop = false;
  /** Forced pop-up: which one, and for setup, which step we are on. */
  private forced: ForcedKind | null = null;
  private step: 'mode' | 'track' = 'mode';

  constructor(private readonly actions: SeriesMenuActions) {
    const root = document.createElement('div');
    root.className = 'overlay menu hidden';
    root.innerHTML = `
      <div class="menu-box">
        <div class="menu-head"><span class="menu-title"></span><button type="button" class="menu-close">DONE</button></div>
        <div class="menu-body">
          <div class="menu-modes"></div>
          <div class="menu-right"><div class="menu-tracks"></div><div class="menu-note"></div></div>
        </div>
        <button type="button" class="menu-stop">STOP &amp; PODIUM</button>
      </div>`;
    this.root = root;
    this.title = root.querySelector('.menu-title') as HTMLElement;
    this.modes = root.querySelector('.menu-modes') as HTMLElement;
    this.tracks = root.querySelector('.menu-tracks') as HTMLElement;
    this.note = root.querySelector('.menu-note') as HTMLElement;
    this.stopBtn = root.querySelector('.menu-stop') as HTMLButtonElement;
    (root.querySelector('.menu-close') as HTMLElement).addEventListener('click', () => {
      if (this.forced && this.step === 'track') {
        this.step = 'mode'; // forced setup: back to the mode step
        this.render();
      } else this.close();
    });
    this.stopBtn.addEventListener('click', () => {
      this.close();
      actions.stop();
    });
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(kind: MenuKind): void {
    this.kind = kind;
    this.root.classList.remove('hidden');
    this.render();
  }

  close(): void {
    if (this.forced) return; // a forced pop-up only closes through sync()
    this.root.classList.add('hidden');
  }

  /** Called with every state change: show the forced pop-up when this phone must choose, hide it when it no longer must. */
  sync(forced: ForcedKind | null): void {
    if (forced === this.forced) return;
    this.forced = forced;
    this.step = 'mode';
    if (forced) {
      this.kind = forced;
      this.root.classList.remove('hidden');
    } else {
      this.root.classList.add('hidden');
    }
    this.render();
  }

  /** New state from the host (series info, preview cards, whether this phone may STOP). */
  update(info: SeriesInfo, cards: TrackCard[] | null, canStop: boolean): void {
    this.info = info;
    this.cards = cards;
    this.canStop = canStop;
    if (this.isOpen) this.render();
  }

  private render(): void {
    const info = this.info;
    if (!info) return;
    const picking = this.kind === 'pick';
    const forced = this.forced !== null;
    const modeStep = forced && !picking && this.step === 'mode';
    const trackStep = forced && !picking && this.step === 'track';
    this.root.classList.toggle('forced', forced);
    this.title.textContent = picking ? 'PICK THE NEXT TRACK' : modeStep ? 'PICK A MODE' : trackStep ? 'PICK A TRACK' : 'RACE SETUP';
    this.modes.classList.toggle('hidden', picking || trackStep);
    this.root.querySelector('.menu-right')!.classList.toggle('hidden', modeStep);
    this.stopBtn.classList.toggle('hidden', !(picking && this.canStop));
    // Normal setup has DONE; the forced track step has a way back to the modes; other forced screens have no button at all.
    const close = this.root.querySelector('.menu-close') as HTMLElement;
    close.classList.toggle('hidden', picking || modeStep);
    close.textContent = trackStep ? '◂ MODE' : 'DONE';

    // Mode buttons (setup only).
    this.modes.replaceChildren(
      ...MODES.map((m) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `menu-mode${info.mode === m.mode ? ' on' : ''}`;
        const l = document.createElement('b');
        l.textContent = m.label;
        const s = document.createElement('small');
        s.textContent = m.sub;
        b.append(l, s);
        b.addEventListener('click', () => {
          this.actions.setMode(m.mode);
          if (modeStep) {
            if (m.mode === 'gp') this.actions.finish(); // Grand Prix plays every track: nothing more to choose
            else {
              this.step = 'track';
              this.render();
            }
          }
        });
        return b;
      }),
    );

    // Track cards. In Grand Prix every track is played, so they are shown dimmed and not tappable.
    const gp = !picking && info.mode === 'gp';
    this.note.textContent = gp ? 'Grand Prix plays every track in this order' : '';
    const count = this.cards?.length ?? 4;
    this.tracks.replaceChildren(
      ...Array.from({ length: count }, (_, i) => {
        const card = this.cards?.[i];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `tile${!picking && info.track === i && !gp ? ' on' : ''}${gp ? ' dim' : ''}`;
        b.disabled = gp;
        if (card) {
          const img = document.createElement('img');
          img.src = card.img;
          img.alt = '';
          const name = document.createElement('b');
          name.textContent = gp ? `${i + 1}. ${card.name}` : card.name;
          const meta = document.createElement('small');
          meta.textContent = `${card.laps} laps · ${card.km} km`;
          b.append(img, name, meta);
        } else {
          b.textContent = '…';
        }
        b.addEventListener('click', () => {
          if (picking) {
            this.close(); // (does nothing while forced: the host's answer closes it)
            this.actions.pick(i);
          } else if (trackStep) this.actions.finish(i);
          else this.actions.setTrack(i);
        });
        return b;
      }),
    );
  }
}
