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
  sanitizeTrackIndex,
  type SeriesInfo,
  type SeriesMode,
  type TrackCard,
} from '../shared/protocol';
import { sanitizeLoadout, type Loadout } from '../shared/characters';
import { colorHex } from '../shared/colors';
import type { TrackDef } from '../track';
import type { PlayerManager } from './playerManager';
import { createPodium } from './podiumView';
import { GP_NEXT_RACE_SECONDS, type PodiumApi, type PodiumEntry } from './postRace';
import { PostRaceFlow, type PostKind } from './postRaceFlow';
import { isFillBot, type BotEntry } from './raceSettings';
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
  /** Show (true) or hide (false) everybody's selection quadrants over the results screen (main.ts moves the selection screen there). */
  showSelect(on: boolean): void;
}

/** One racer as the results, standings and podium show them. */
interface RacerInfo {
  slot: number;
  name: string;
  color: string;
  loadout: Loadout;
  wins: number;
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
  /** The 3D podium (podiumView.ts) and the element it draws into. */
  private readonly podium3d: PodiumApi;
  /** Which podium reveal is current (a reveal that finishes after the podium was hidden must not count). */
  private podiumGen = 0;
  private revealDone = true;
  /** The clock of the screens after a race (null while racing / in the menu). */
  private post: PostRaceFlow | null = null;
  /** Loser picks: the track the picker chose for the next race (null = not chosen yet). The race starts when everyone is ready too. */
  private pickedTrack: number | null = null;
  /** Colours of the fill-in bots of the last race (the game picks them), so standings use the same ones. */
  private fillColors: ReadonlyMap<number, string> = new Map();
  /** Names and looks of the fill-in bots of the last race (the game builds the roster), so the results, standings, podium and phones all say the same. */
  private roster: ReadonlyMap<number, BotEntry> = new Map();

  constructor(private readonly d: SeriesHostDeps) {
    this.mode = SeriesHost.loadMode();
    this.raceTrack = d.tracks[0];
    this.podiumLayer = document.createElement('div');
    this.podiumLayer.className = 'results series-layer hidden';
    this.pickLayer = document.createElement('div');
    this.pickLayer.className = 'pick-layer hidden';
    // The 3D podium's home: no z-index of its own, so what podiumView puts inside layers against the results (20) and the other layers here.
    const podiumMount = document.createElement('div');
    podiumMount.className = 'podium-mount';
    d.gameEl.append(podiumMount, this.podiumLayer, this.pickLayer);
    this.podium3d = createPodium(podiumMount);
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
    this.post = null;
    this.pickedTrack = null;
  }

  /** The track of the race that is about to start / running. */
  currentTrack(): TrackDef {
    return this.series ? this.raceTrack : this.d.lobbyTrack();
  }

  /** Back in the lobby / menu: the series is over. */
  end(): void {
    this.leavePost();
    this.series = null;
    this.podium = false;
    this.choice.reset(); // a new round: the owner's phone asks for mode and track again
    this.refresh();
  }

  /**
   * The race finished: record it, start the post-race clock and return what the results screen should add
   * (points, standings, labels). `fillColors` = colours of the fill-in bots (they have no player entry).
   * What happens next depends on the mode (see postRace.ts and postRaceFlow.ts).
   */
  onRaceResults(placings: Placing[], fillColors: ReadonlyMap<number, string> = new Map(), roster: ReadonlyMap<number, BotEntry> = new Map()): ResultsExtras | undefined {
    const s = this.series;
    if (!s) return undefined;
    this.fillColors = fillColors;
    this.roster = roster;
    s.recordRace(placings);
    this.tvPick = s.trackIndex;
    this.pickedTrack = null;
    // Grand Prix and a single race are look-only (the next race / the podium / the lobby comes by itself); only Loser picks lets phones choose CHANGE or READY.
    const kind: PostKind = s.mode === 'gp' ? (s.stage === 'over' ? 'final' : 'auto') : s.scoring ? 'choose' : 'single';
    this.post = new PostRaceFlow(kind);
    this.d.players.slots.postLock = kind !== 'choose';
    this.revealDone = true;
    // Single race: the top three of THIS race on the 3D podium next to the results table.
    if (kind === 'single') {
      const top = placings.filter((p) => p.place <= 3).sort((a, b) => a.place - b.place);
      void this.showPodium3d(top.map((p) => this.podiumEntry(p.slot, p.place as 1 | 2 | 3, null)), `${MODE_NAMES[s.mode].toUpperCase()} · ${this.raceTrack.name.toUpperCase()}`);
    }
    this.refresh();
    if (!s.scoring) return undefined; // single race: the plain results screen
    const total = s.raceTotal;
    const last = s.stage === 'over';
    return {
      heading: total ? `GRAND PRIX ${s.racesDone}/${total}` : `LOSER PICKS · RACE ${s.racesDone}`,
      gain: new Map(placings.map((p) => [p.slot, s.gainOf(p.slot)])),
      standings: this.standingRows().map((r) => ({ name: r.name, color: r.color, points: r.points, wins: r.wins })),
      primary: s.mode === 'gp' ? (last ? 'PODIUM' : 'NEXT RACE') : '',
      secondary: 'MENU',
      note: s.mode === 'gp' ? (last ? 'Final standings next' : `Next: ${this.d.tracks[s.trackIndex].name}`) : 'Last place picks the next track',
      // The scoreboard shows a countdown to the next Grand Prix race (the last race goes on to the podium instead).
      ...(kind === 'auto' ? { autoNextSeconds: GP_NEXT_RACE_SECONDS } : {}),
    };
  }

  // --- racers: players AND fill-in bots ---------------------------------------------

  /** Everybody who raced: the player slots plus the fill-in bots of the last race (slot 4 and up, which have no player entry). */
  private racerSlots(): number[] {
    const out = this.d.players.slots.players.map((p) => p.index);
    for (const p of this.series?.lastPlacings ?? []) if (isFillBot(p.slot) && !out.includes(p.slot)) out.push(p.slot);
    return out;
  }

  /** Name, colour, loadout and crowns of any racer. */
  private racer(slot: number): RacerInfo {
    const p = this.d.players.slots.slots[slot];
    const wins = this.d.players.winsOfSlot(slot);
    if (p) return { slot, name: p.name, color: colorHex(p.color), loadout: sanitizeLoadout(p.loadout), wins };
    if (isFillBot(slot)) {
      const bot = this.roster.get(slot);
      return { slot, name: bot?.name ?? `Bot ${slot}`, color: this.fillColors.get(slot) ?? colorHex(slot), loadout: sanitizeLoadout(bot?.loadout), wins };
    }
    return { slot, name: `P${slot + 1}`, color: colorHex(slot), loadout: sanitizeLoadout(undefined), wins }; // (a player who left)
  }

  private standingRows(): (RacerInfo & { points: number })[] {
    const s = this.series!;
    return s.standings(this.racerSlots()).map((r) => ({ ...this.racer(r.slot), points: r.points }));
  }

  private podiumEntry(slot: number, place: 1 | 2 | 3, points: number | null): PodiumEntry {
    const r = this.racer(slot);
    return { slot, place, name: r.name, color: r.color, loadout: r.loadout, wins: r.wins, points };
  }

  // --- the screens after a race -----------------------------------------------------

  /** Called every frame while the results are up (main.ts): runs the post-race clock and does what it says. */
  update(dt: number): void {
    const f = this.post;
    if (!f || !this.series) return;
    const slots = this.d.players.slots;
    const connectedHumans = this.humans().filter((p) => p.connected);
    const act = f.tick(dt, {
      // Somebody must still be here, and everybody (bots count as ready) must be ready.
      allReady: connectedHumans.length > 0 && slots.allReady(),
      someoneChanging: connectedHumans.some((p) => p.stage !== 'ready'),
      trackChosen: this.trackChosen(),
      revealDone: this.revealDone,
    });
    if (act === 'showSelect') {
      this.d.showSelect(true);
      this.podium3d.hide(); // (the quadrants have their own 3D scene)
      this.besidePodium(false);
      this.drawTv();
    } else if (act === 'podium') this.showPodium();
    else if (act === 'start') this.startNext();
    else if (act === 'lobby') this.d.toLobby();
  }

  /** Per-frame update of the 3D podium (main.ts calls it while a race is on screen). */
  updatePodium(dt: number): void {
    this.podium3d.update(dt);
  }

  /** Loser picks: has the picker chosen the next track? (Always true in the other modes, and when nobody is left to pick.) */
  private trackChosen(): boolean {
    return this.series?.mode !== 'loser' || this.pickedTrack !== null || this.picker() === null;
  }

  /** Is the TV showing the quadrants (so main.ts can pause the 3D game behind them)? */
  get selecting(): boolean {
    return this.post?.stage === 'select';
  }

  private async showPodium3d(entries: PodiumEntry[], title: string): Promise<void> {
    const gen = ++this.podiumGen;
    this.revealDone = false;
    this.besidePodium(true);
    try {
      await this.podium3d.show(entries, title);
    } catch (err) {
      console.warn('Podium failed', err); // the table still works without it
    }
    if (gen !== this.podiumGen) return;
    this.revealDone = true;
  }

  /** While the 3D podium is up the scoreboard (results layer or final table) moves to the right (podium.css: beside-podium). */
  private besidePodium(on: boolean): void {
    this.d.gameEl.querySelector('.results:not(.series-layer)')?.classList.toggle('beside-podium', on);
    this.podiumLayer.classList.toggle('beside-podium', on);
  }

  /** Back to "nothing special on screen": no podium, no quadrants, no clock. */
  private leavePost(): void {
    this.post = null;
    this.podiumGen++;
    this.revealDone = true;
    this.podium3d.hide();
    this.besidePodium(false);
    this.d.showSelect(false);
  }

  /**
   * "Next" pressed (Enter, the TV button): skip the waiting. Grand Prix: the next race / the podium; single race:
   * back to the lobby; Loser picks: race again right now (with the TV's highlighted track if none was chosen).
   */
  next(): void {
    const s = this.series;
    if (!s) return this.d.startRace();
    if (this.podium) return this.d.toLobby();
    if (s.stage === 'over') return this.showPodium();
    if (!s.scoring) return this.d.toLobby(); // single race: everybody readies up again in the lobby
    if (s.mode === 'loser' && this.pickedTrack === null && this.picker() !== null) this.pickedTrack = this.tvPick;
    this.startNext();
  }

  /** Start the next race of the series (everybody is ready, the clock ran out, or Enter). */
  private startNext(): void {
    const s = this.series;
    if (!s) return;
    this.leavePost();
    if (s.mode === 'loser') {
      const picker = this.picker();
      const t = this.pickedTrack ?? s.trackIndex;
      if (picker === null || !s.pick(picker, t, this.isPresent, this.humans().map((p) => p.index))) s.stage = 'racing'; // nobody left to pick: same track again
      this.raceTrack = this.d.tracks[s.trackIndex];
    } else {
      if (!s.advance()) return;
      if (s.mode === 'gp') this.raceTrack = this.d.tracks[s.trackIndex];
    }
    this.pickedTrack = null;
    this.refresh();
    this.d.startRace();
  }

  /** Loser mode: `slot` names the next track. Ignored unless it really is their turn; the race starts once everyone is ready too. */
  private choose(slot: number | null, track: unknown): void {
    const s = this.series;
    if (!s || s.mode !== 'loser' || s.stage !== 'between' || this.podium || !this.post || slot === null) return;
    const t = sanitizeTrackIndex(track, this.d.tracks.length);
    if (t === null || slot !== this.picker()) return;
    this.pickedTrack = t;
    this.tvPick = t;
    this.refresh(true);
  }

  /** One card per message: each carries a ~4 KB picture, and one big message would exceed the channel's size limit. */
  private sendCards(slot: number): void {
    const cards = this.cards();
    cards.forEach((c, i) => this.d.players.sendTo(slot, { t: 'tracks', from: i, total: cards.length, list: [c] }));
  }

  private stop(): void {
    const s = this.series;
    if (!s || s.mode !== 'loser' || s.stage !== 'between' || this.podium) return;
    s.stop();
    this.showPodium();
  }

  /** The final standings: the table (DOM) and the 3D podium with the top three, then back to the lobby after the reveal and a pause (postRaceFlow.ts). */
  private showPodium(): void {
    const s = this.series;
    if (!s) return;
    this.podium = true;
    this.pickedTrack = null;
    this.post = new PostRaceFlow('final', 'podium');
    this.d.players.slots.postLock = true; // look-only; the menu owner can still press MENU
    this.d.showSelect(false);
    const top = this.standingRows().slice(0, 3);
    // (title '': the standings table already says what this is)
    void this.showPodium3d(top.map((r, i) => this.podiumEntry(r.slot, (i + 1) as 1 | 2 | 3, r.points)), '');
    this.refresh(true);
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
    // Everybody who raced scores, the fill-in bots too (phones show them by their character names); their crowns travel here as well.
    const racers = this.racerSlots();
    const standings = s.scoring ? s.standings(racers).flatMap((r) => [r.slot, r.points]) : [];
    const botWins = racers.filter(isFillBot).flatMap((slot) => {
      const w = this.d.players.winsOfSlot(slot);
      return w > 0 ? [slot, w] : [];
    });
    const botNames = s.scoring ? racers.filter(isFillBot).map((slot) => ({ slot, name: this.racer(slot).name })) : [];
    const picked = stage === 'between' && s.mode === 'loser' && this.pickedTrack !== null;
    return {
      mode: s.mode,
      track: picked ? this.pickedTrack! : s.trackIndex,
      stage,
      owner: this.owner(),
      picker: stage === 'between' ? this.picker() : null,
      racesDone: s.racesDone,
      raceTotal: s.raceTotal,
      standings,
      ...(botWins.length ? { wins: botWins } : {}),
      ...(botNames.length ? { bots: botNames } : {}),
      ...(picked ? { picked: true } : {}),
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
      const cards = this.cards();
      buildPickStrip(this.pickLayer, { who: this.nameOf(this.picker()), cards, selected: this.pickedTrack ?? this.tvPick }, (i) => {
        this.tvPick = i;
        this.choose(this.picker(), i);
      });
      // Once chosen, say which track is next (the race starts when everybody is ready).
      if (this.pickedTrack !== null) {
        const next = document.createElement('div');
        next.className = 'pick-next';
        next.textContent = `NEXT · ${cards[this.pickedTrack]?.name ?? ''}`;
        this.pickLayer.querySelector('.pick-strip')?.appendChild(next);
      }
    }
    this.podiumLayer.classList.toggle('hidden', !this.podium);
    if (this.podium && s) {
      const rows = this.standingRows().map((r) => ({ name: r.name, color: r.color, points: r.points, wins: r.wins }));
      buildPodium(this.podiumLayer, rows, `${MODE_NAMES[s.mode].toUpperCase()} · ${s.racesDone} RACE${s.racesDone === 1 ? '' : 'S'}`, () => this.d.toLobby());
    } else {
      this.podiumLayer.replaceChildren();
    }
  }
}
