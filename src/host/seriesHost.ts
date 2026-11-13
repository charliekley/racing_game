/**
 * Host-side glue for the race modes: owns the chosen mode, the running `Series`
 * (see series.ts for the rules), what phones are told, and the TV screens that
 * belong to a series (podium, "last place picks"). main.ts calls into this at
 * the few moments that matter: start, race finished, "next" pressed, back to lobby.
 *
 * Who may do what (phones are untrusted, every message is checked here):
 *   - the menu owner (P1, or the next connected human) sets mode / track and may STOP / go back to the menu;
 *   - in Loser picks only the last-place human may name the next track;
 *   - the host keyboard can always do both (arrow keys + Enter), so the game works without phones.
 */
import {
  parseSeriesAct,
  parseSetup,
  type SeriesInfo,
  type SeriesMode,
  type TrackCard,
} from '../shared/protocol';
import { colorHex } from '../shared/colors';
import type { TrackDef } from '../track';
import type { PlayerManager } from './playerManager';
import type { ResultsExtras } from './resultsView';
import { DEFAULT_MODE, MenuChoice, MODE_NAMES, Series, menuOwner, nextMode, sanitizeMode, type Placing } from './series';
import { buildPickStrip, buildPodium } from './seriesView';

const MODE_KEY = 'tiltkart.mode';

export interface SeriesHostDeps {
  players: PlayerManager;
  tracks: TrackDef[];
  /** Small preview picture + facts for one track (cached by the caller). */
  card(def: TrackDef): TrackCard;
  /** The lobby's selected track (may be a dev track that is not in `tracks`). */
  lobbyTrack(): TrackDef;
  setLobbyTrack(index: number): void;
  /** The mode changed (update the lobby chips). */
  onModeChange(mode: SeriesMode): void;
  /** "Owner still choosing" turned on or off (TV hint; the lobby may now be allowed to auto-start). */
  onPendingChange(): void;
  /** Start the race for the current series state (main.ts: startDriving). */
  startRace(): void;
  /** Back to the lobby / menu. */
  toLobby(): void;
  /** The element that holds the 3D game; the podium and pick strip are added to it. */
  gameEl: HTMLElement;
}

export class SeriesHost {
  mode: SeriesMode;
  series: Series | null = null;
  private raceTrack: TrackDef;
  private podium = false;
  /** Track highlighted on the TV pick strip (loser mode, arrow keys). */
  private tvPick = 0;
  /** Has the menu owner made this round's choice? (drives the forced pop-up on their phone) */
  private readonly choice = new MenuChoice();
  private lastPending = false; // (what choosing was the last time we told main.ts)
  private lastKey = '';
  private readonly podiumLayer: HTMLElement;
  private readonly pickLayer: HTMLElement;

  constructor(private readonly d: SeriesHostDeps) {
    this.mode = SeriesHost.loadMode();
    this.raceTrack = d.tracks[0];
    this.podiumLayer = document.createElement('div');
    this.podiumLayer.className = 'results series-layer hidden';
    this.pickLayer = document.createElement('div');
    this.pickLayer.className = 'pick-layer hidden';
    d.gameEl.append(this.podiumLayer, this.pickLayer);
    d.players.onMenuMessage.add(({ slot, msg }) => this.handleMessage(slot, msg));
    d.players.onRemoved.add((slot) => this.series?.dropSlot(slot));
  }

  private static loadMode(): SeriesMode {
    try {
      return sanitizeMode(localStorage.getItem(MODE_KEY)) ?? DEFAULT_MODE;
    } catch {
      return DEFAULT_MODE; // storage can be blocked (private mode)
    }
  }

  // --- who is who -------------------------------------------------------------

  private humans() {
    return this.d.players.slots.players.filter((p) => p.owner.kind !== 'bot');
  }
  private isPresent = (slot: number): boolean => {
    const p = this.d.players.slots.slots[slot];
    return !!p && p.connected && p.owner.kind !== 'bot';
  };
  /** The menu owner: P1, or the next connected human if P1 left. */
  owner(): number | null {
    return menuOwner(this.d.players.slots.players.map((p) => ({ slot: p.index, human: p.owner.kind !== 'bot', connected: p.connected })));
  }
  private picker(): number | null {
    return this.series?.currentPicker(this.isPresent, this.humans().map((p) => p.index)) ?? null;
  }
  private nameOf(slot: number | null): string {
    return (slot !== null ? this.d.players.slots.slots[slot]?.name : null) ?? 'Player';
  }

  /** Cards for every track (the caller caches them, so this is cheap; pictures upgrade as they get rendered). */
  private cards(): TrackCard[] {
    return this.d.tracks.map((t) => this.d.card(t));
  }

  /** The owner is still choosing in the menu (phones' READY must not start the race meanwhile). */
  get choosing(): boolean {
    return !this.series && this.choice.blocksAutoStart(this.owner() !== null);
  }

  /** Name of the menu owner, for the TV hint "X is choosing". */
  ownerName(): string {
    return this.nameOf(this.owner());
  }

  /** The host keyboard / TV buttons chose a mode or track: that counts as the choice and closes the phone pop-up. */
  hostChose(): void {
    if (this.choice.complete()) this.refresh();
  }

  /** A track picture was (re)rendered: send the new cards to whoever is choosing a track and redraw the TV strip. */
  cardsUpdated(): void {
    const slot = this.series ? this.picker() : this.owner(); // (same rule as the 'cards' request below)
    if (slot !== null) this.sendCards(slot);
    this.drawTv();
  }

  // --- mode (lobby) -----------------------------------------------------------

  setMode(m: SeriesMode): void {
    if (this.series || m === this.mode) return;
    this.mode = m;
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
    this.d.onModeChange(m);
    this.refresh();
  }
  cycleMode(step: number): void {
    this.setMode(nextMode(this.mode, step));
  }

  // --- series lifecycle -------------------------------------------------------

  /** Called when a race is started from the lobby: begin a new series from the menu choices. */
  begin(mode = this.mode): void {
    const lobby = this.d.lobbyTrack();
    this.series = new Series(mode, this.d.tracks.length, this.d.tracks.indexOf(lobby));
    this.raceTrack = mode === 'gp' ? this.d.tracks[0] : lobby; // keeps dev tracks (?track=) working in single mode
    this.podium = false;
  }

  /** The track of the race that is about to start / running. */
  currentTrack(): TrackDef {
    return this.series ? this.raceTrack : this.d.lobbyTrack();
  }

  /** Back in the lobby / menu: the series is over. */
  end(): void {
    this.series = null;
    this.podium = false;
    this.choice.reset(); // a new round: the owner's phone asks for mode and track again
    this.refresh();
  }

  /** The race finished: record it and return what the results screen should add (points, labels). */
  onRaceResults(placings: Placing[]): ResultsExtras | undefined {
    const s = this.series;
    if (!s) return undefined;
    s.recordRace(placings);
    this.tvPick = s.trackIndex;
    this.refresh();
    if (!s.scoring) return undefined; // single race: the plain results screen
    const total = s.raceTotal;
    const last = s.stage === 'over';
    return {
      heading: total ? `GRAND PRIX ${s.racesDone}/${total}` : `LOSER PICKS · RACE ${s.racesDone}`,
      gain: new Map(placings.map((p) => [p.slot, s.gainOf(p.slot)])),
      standings: this.standingRows().map((r) => ({ name: r.name, color: r.color, points: r.points })),
      primary: s.mode === 'gp' ? (last ? 'PODIUM' : 'NEXT RACE') : '',
      secondary: 'MENU',
      note: s.mode === 'gp' ? (last ? 'Tap FINISH on every phone' : `Next: ${this.d.tracks[s.trackIndex].name}`) : 'Last place picks the next track',
    };
  }

  private standingRows() {
    const s = this.series!;
    return s.standings(this.d.players.slots.players.map((p) => p.index)).map((r) => {
      const p = this.d.players.slots.slots[r.slot];
      return { name: p?.name ?? `P${r.slot + 1}`, color: colorHex(p?.color ?? r.slot), points: r.points };
    });
  }

  /**
   * "Next" pressed (Enter, button, or every phone ready): the next Grand Prix race, the same track again,
   * the podium, or back to the menu. `fromReady` = triggered by phones' READY flags, which never confirms
   * a Loser-picks choice (only a deliberate pick does).
   */
  next(fromReady = false): void {
    const s = this.series;
    if (!s) return this.d.startRace();
    if (this.podium) return this.d.toLobby();
    if (s.stage === 'over') return this.showPodium();
    if (s.mode === 'loser') {
      if (fromReady) return;
      this.choose(this.picker(), this.tvPick);
      return;
    }
    if (!s.advance()) return;
    if (s.mode === 'gp') this.raceTrack = this.d.tracks[s.trackIndex];
    this.refresh();
    this.d.startRace();
  }

  /** Loser mode: `slot` names the next track. Ignored unless it really is their turn. */
  private choose(slot: number | null, track: unknown): void {
    const s = this.series;
    if (!s || slot === null) return;
    if (!s.pick(slot, track, this.isPresent, this.humans().map((p) => p.index))) return;
    this.raceTrack = this.d.tracks[s.trackIndex];
    this.refresh();
    this.d.startRace();
  }

  /** One card per message: each carries a ~4 KB picture, and one big message would exceed the channel's size limit. */
  private sendCards(slot: number): void {
    const cards = this.cards();
    cards.forEach((c, i) => this.d.players.sendTo(slot, { t: 'tracks', from: i, total: cards.length, list: [c] }));
  }

  private stop(): void {
    const s = this.series;
    if (!s || s.mode !== 'loser' || s.stage !== 'between') return;
    s.stop();
    this.showPodium();
  }

  private showPodium(): void {
    this.podium = true;
    // Everyone un-readies, then "ready" on a phone means "back to the menu".
    this.d.players.setPhase('results');
    this.refresh();
  }

  // --- messages from phones -----------------------------------------------------

  private handleMessage(slot: number, msg: { t: string }): void {
    const m = msg as unknown;
    const t = (msg as { t: string }).t;
    if (t === 'setup') {
      if (this.series || slot !== this.owner()) return; // only the owner, only in the menu
      const v = parseSetup(m, this.d.tracks.length);
      if (!v) return;
      if (v.track !== undefined) this.d.setLobbyTrack(v.track);
      if (v.mode) this.setMode(v.mode);
      if (v.done) this.choice.complete(); // the owner finished the forced pop-up
      this.refresh();
    } else if (t === 'pick') {
      this.choose(slot, (m as { track?: unknown }).track);
    } else if (t === 'series') {
      const act = parseSeriesAct(m);
      if (act === 'cards') {
        // Only someone who may choose a track gets the pictures (about 20 KB).
        if ((!this.series && slot === this.owner()) || slot === this.picker()) this.sendCards(slot);
      } else if (act === 'stop' && slot === this.owner()) {
        this.stop();
      } else if (act === 'menu' && slot === this.owner() && this.series && this.series.stage !== 'racing') {
        this.d.toLobby();
      }
    }
  }

  // --- keyboard on the host (works with no phones) --------------------------------

  /** Returns true if the key was used. `inLobby`: the lobby menu is showing. */
  key(code: string, inLobby: boolean): boolean {
    if (inLobby && !this.series) {
      if (code === 'ArrowUp') this.cycleMode(-1);
      else if (code === 'ArrowDown') this.cycleMode(1);
      else return false;
      this.hostChose();
      return true;
    }
    const s = this.series;
    if (s && s.mode === 'loser' && s.stage === 'between' && !this.podium) {
      const n = this.d.tracks.length;
      if (code === 'ArrowLeft') this.tvPick = (this.tvPick + n - 1) % n;
      else if (code === 'ArrowRight') this.tvPick = (this.tvPick + 1) % n;
      else if (code === 'KeyS') {
        this.stop();
        return true;
      } else return false;
      this.refresh(true);
      return true;
    }
    return false;
  }

  // --- what phones and the TV show --------------------------------------------------

  info(): SeriesInfo {
    const s = this.series;
    const lobbyIdx = Math.max(0, this.d.tracks.indexOf(this.d.lobbyTrack()));
    if (!s) {
      return { mode: this.mode, track: lobbyIdx, stage: 'menu', owner: this.owner(), picker: null, racesDone: 0, raceTotal: this.mode === 'gp' ? this.d.tracks.length : null, standings: [], pending: this.choice.pending };
    }
    const stage = s.stage === 'racing' ? 'racing' : this.podium ? 'over' : 'between';
    const standings = s.scoring ? s.standings(this.d.players.slots.players.map((p) => p.index)).flatMap((r) => [r.slot, r.points]) : [];
    return {
      mode: s.mode,
      track: s.trackIndex,
      stage,
      owner: this.owner(),
      picker: stage === 'between' ? this.picker() : null,
      racesDone: s.racesDone,
      raceTotal: s.raceTotal,
      standings,
    };
  }

  /** Tell the phones (only if something changed) and redraw the TV screens. */
  refresh(force = false): void {
    const info = this.info();
    const key = JSON.stringify(info);
    const pending = this.choosing;
    if (pending !== this.lastPending) {
      this.lastPending = pending;
      this.d.onPendingChange();
    }
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.d.players.setSeriesMessage({ t: 'series', ...info });
    } else if (!force) {
      return;
    }
    this.drawTv();
  }

  private drawTv(): void {
    const s = this.series;
    const showPick = !!s && s.mode === 'loser' && s.stage === 'between' && !this.podium;
    this.pickLayer.classList.toggle('hidden', !showPick);
    this.d.gameEl.classList.toggle('pick-open', showPick); // CSS makes room for the strip under the results
    if (showPick) {
      buildPickStrip(this.pickLayer, { who: this.nameOf(this.picker()), cards: this.cards(), selected: this.tvPick }, (i) => {
        this.tvPick = i;
        this.choose(this.picker(), i);
      });
    }
    this.podiumLayer.classList.toggle('hidden', !this.podium);
    if (this.podium && s) {
      const rows = this.standingRows();
      buildPodium(this.podiumLayer, rows, `${MODE_NAMES[s.mode].toUpperCase()} · ${s.racesDone} RACE${s.racesDone === 1 ? '' : 'S'}`, () => this.d.toLobby());
    } else {
      this.podiumLayer.replaceChildren();
    }
  }
}
