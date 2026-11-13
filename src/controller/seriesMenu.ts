/**
 * The race menu on the phone: pick the mode and the track (menu owner, usually P1), or
 * pick the next track in "Loser picks" (the last-place player). A full-screen overlay with
 * a column of mode buttons and a row of track cards, each with a small map picture the TV drew.
 *
 * It only shows state and reports taps through `actions`; main.ts sends them to the host,
 * and the host decides whether they are allowed (never trust the phone, never trust the host
 * blindly either: the cards were already validated by parseTrackCards).
 *
 * Web concept: the track pictures are "data URLs" (`data:image/png;base64,...`): the image
 * bytes written as text, so they can travel inside one JSON message and be used as an <img src>.
 */
import type { SeriesInfo, SeriesMode, TrackCard } from '../shared/protocol';

export interface SeriesMenuActions {
  setMode(mode: SeriesMode): void;
  setTrack(track: number): void;
  pick(track: number): void;
  stop(): void;
}

const MODES: { mode: SeriesMode; label: string; sub: string }[] = [
  { mode: 'single', label: 'SINGLE RACE', sub: 'one track' },
  { mode: 'gp', label: 'GRAND PRIX', sub: 'all tracks, points' },
  { mode: 'loser', label: 'LOSER PICKS', sub: 'last place chooses' },
];

export type MenuKind = 'setup' | 'pick';

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
    (root.querySelector('.menu-close') as HTMLElement).addEventListener('click', () => this.close());
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
    this.root.classList.add('hidden');
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
    this.title.textContent = picking ? 'PICK THE NEXT TRACK' : 'RACE SETUP';
    this.modes.classList.toggle('hidden', picking);
    this.stopBtn.classList.toggle('hidden', !(picking && this.canStop));
    (this.root.querySelector('.menu-close') as HTMLElement).classList.toggle('hidden', picking);

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
        b.addEventListener('click', () => this.actions.setMode(m.mode));
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
            this.close();
            this.actions.pick(i);
          } else this.actions.setTrack(i);
        });
        return b;
      }),
    );
  }
}
