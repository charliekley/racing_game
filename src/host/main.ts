/**
 * Host (TV) entry point - Milestone 1: lobby + live input debug view.
 *
 * Flow: pick a room code -> register with the signaling server under it ->
 * show QR code -> phones connect -> PlayerManager tracks them -> LobbyView
 * draws them. Later milestones add the race on top of this.
 */
import QRCode from 'qrcode';
import './host.css';
import './lobby.css'; // title screen + lobby polish (loaded after host.css so it overrides)
import './series.css'; // race modes: mode chips, podium, loser-picks strip
import './select.css'; // selection screen quadrants (name -> character -> kart -> ready)
import { PeerHostTransport } from '../shared/net/peerTransport';
import { RoomTakenError } from '../shared/net/transport';
import type { ItemDisplay } from '../shared/protocol';
import { generateRoomCode, normalizeRoomCode } from '../shared/roomCode';
import { controllerUrl } from './controllerUrl';
import { Game } from './game';
import { ITEM_IDS, type ItemId } from '../sim/items/types';
import { DEFAULT_DIFFICULTY, nextDifficulty, sanitizeDifficulty, type Difficulty } from '../sim/bots';
import { DEFAULT_QUALITY, QUALITY_PRESETS, type QualitySettings } from '../render/scene';
import { gpuName, presetByName, presetNameForGpu } from '../render/gpuTier';
import { KeyboardState } from './input/localInput';
import { LobbyView } from './lobbyView';
import { SelectView } from './selectView';
import { nextRacers, sanitizeRacers, type RacerCount } from './raceSettings';
import { TrackPreview } from './trackPreview';
import { PlayerManager } from './playerManager';
import { SelectionHub } from './selectionHub';
import { SeriesHost } from './seriesHost';
import { MODE_NAMES, SERIES_MODES, sanitizeMode } from './series';
import { DEV_TRACKS, TRACKS, type TrackDef } from '../track';
import { AudioEngine } from '../audio'; // AUDIO
import { enableWakeLock } from '../shared/wakeLock';
import { FrameClock } from './frameClock';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ROOM_STORAGE_KEY = 'tiltkart.hostRoom';

const transport = new PeerHostTransport();
const keys = new KeyboardState();
const players = new PlayerManager(transport, keys);
// AUDIO: starts silent, unlocks itself on the first key press / click / gamepad button. M = mute.
const audio = new AudioEngine();
audio.playMusic('lobby');
if (import.meta.env.DEV) (window as unknown as { __audio?: AudioEngine }).__audio = audio; // debugging aid
if (import.meta.env.DEV) (window as unknown as { __players?: PlayerManager }).__players = players; // debugging aid (dev server only)

// --- Pre-race selection flow (name -> character -> kart -> ready) ----------------------------------
// Phones and keyboard / gamepad players choose; PlayerManager publishes every change to this hub, and the
// TV's selection display subscribes to it (the two sides never import each other). The hub is emptied when
// the race starts and refilled when we are back in the lobby.
const selectionHub = new SelectionHub();
players.hub = selectionHub;
if (import.meta.env.DEV) (window as unknown as { __selectionHub?: SelectionHub }).__selectionHub = selectionHub; // debugging aid
/** A keyboard player using the arrow keys owns the arrows / Enter for the flow, so the TV shortcuts for them step aside (T and G still work). */
const arrowsAreAPlayer = () => players.slots.find({ kind: 'keyboard', scheme: 1 }) !== null;
/** Is someone driving with WASD? Then D (browse right) and R (back) belong to them, not to the lobby shortcuts. */
const wasdIsAPlayer = () => players.slots.find({ kind: 'keyboard', scheme: 0 }) !== null;

const netStatus = $('net-status');
function setStatus(text: string, cls: 'ok' | 'warn' | 'bad' | '') {
  netStatus.textContent = text;
  netStatus.className = `net-status ${cls}`;
}

transport.onStatus.add((s) => {
  if (s.kind === 'online') setStatus('Online – waiting for players', 'ok');
  else if (s.kind === 'reconnecting') setStatus('Signaling server lost – reconnecting (connected phones keep working)', 'warn');
  else setStatus(`Error: ${s.message}`, 'bad');
});

/**
 * Register a room. We try to reuse the code from before a page refresh (kept in
 * sessionStorage, which lives as long as the tab) so phones can auto-rejoin.
 * Right after a refresh the server may still hold our old registration for a
 * few seconds, so retry the same code a few times before picking a new one.
 */
async function openRoom(): Promise<string> {
  let code = normalizeRoomCode(sessionStorage.getItem(ROOM_STORAGE_KEY)) ?? generateRoomCode();
  let sameCodeRetries = 3;
  for (;;) {
    try {
      await transport.start(code);
      sessionStorage.setItem(ROOM_STORAGE_KEY, code);
      return code;
    } catch (err) {
      if (err instanceof RoomTakenError) {
        if (sameCodeRetries-- > 0) {
          setStatus(`Room ${code} still registered, retrying…`, 'warn');
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          code = generateRoomCode();
          sameCodeRetries = 0;
        }
        continue;
      }
      setStatus(`Could not reach signaling server (${(err as Error).message ?? err}). Retrying…`, 'bad');
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function showRoom(code: string) {
  const url = controllerUrl(code);
  $('room-code').textContent = code;
  const link = $<HTMLAnchorElement>('join-url');
  link.textContent = url.replace(/^https?:\/\//, '');
  link.href = url;
  await QRCode.toCanvas($<HTMLCanvasElement>('qr'), url, { width: 280, margin: 1, errorCorrectionLevel: 'M' });
  if (__DEV_LAN_HOSTS__.length > 1 && ['localhost', '127.0.0.1'].includes(location.hostname)) {
    console.info('Other LAN addresses (use ?lan=IP on this page if the QR one is wrong):', __DEV_LAN_HOSTS__);
  }
}

// --- Lobby view + debug actions -------------------------------------------
const lobbyView = new LobbyView($('slots'), players, {
  buzz: (slot) => players.sendTo(slot, { t: 'haptic', pattern: [80, 60, 80] }),
  testItem: (slot) => {
    // Exercise the host -> phone status path: roulette, then each item in turn, then empty.
    const status = (item: ItemDisplay) =>
      players.sendTo(slot, { t: 'status', position: slot + 1, lap: 1, totalLaps: 3, item });
    status({ kind: 'roulette' });
    ITEM_IDS.forEach((id, i) =>
      setTimeout(() => status({ kind: 'item', id, count: id === 'dash' ? 3 : 1 }), 1500 + i * 1800),
    );
    setTimeout(() => status({ kind: 'none' }), 1500 + ITEM_IDS.length * 1800);
  },
  kick: (slot) => players.kick(slot),
});

// --- Selection screen (TV side) ---------------------------------------------------
// The hub is the shared contract (selectionHub.ts): the input side calls selectionHub.set(...) as players
// choose, and this view only draws it (one quadrant per player). It is paused while a race is on screen.
// The quadrants show HUMAN players only: bots are published to the hub too (always 'ready'), so they are filtered
// out here into a second hub that the view subscribes to.
const humanHub = new SelectionHub();
selectionHub.subscribe((views) => {
  const humans = views.filter((v) => {
    const kind = players.slots.slots[v.slot]?.owner.kind;
    return kind === undefined || kind !== 'bot'; // (the dev demo has no slots behind its views: keep those)
  });
  for (const v of humans) humanHub.set(v);
  for (const v of humanHub.list()) if (!humans.some((h) => h.slot === v.slot)) humanHub.remove(v.slot);
});
const selectView = new SelectView($('select'), humanHub, { onKick: (slot) => players.kick(slot) });
if (import.meta.env.DEV) (window as unknown as { __selectView?: SelectView }).__selectView = selectView; // debugging aid
// Dev: ?selectdemo=1..4 fakes that many players walking through the flow (no phones needed).
const demoParam = new URLSearchParams(location.search).get('selectdemo');
if (demoParam !== null) {
  void import('../dev/selectDemo').then(({ startSelectDemo }) => {
    (window as unknown as { __selectDemo?: unknown }).__selectDemo = startSelectDemo(humanHub, Number(demoParam) || 4);
  });
}

// --- Graphics quality (Q in the lobby; remembered on this computer) ----------
const QUALITY_KEY = 'tiltkart.quality'; // a preset the player picked with Q: always wins
// The preset adaptive quality had to drop to. Kept in sessionStorage (forgotten when the tab closes),
// so one slow moment (a busy laptop, a hidden tab) cannot leave the game on Low for good.
const AUTO_QUALITY_KEY = 'tiltkart.autoQuality';
/**
 * First-run choice. Priority: ?quality=low|medium|high in the address (testing), the player's saved
 * choice, otherwise a guess from the GPU name, lowered to wherever adaptive quality ended up earlier in this tab.
 */
const URL_QUALITY = presetByName(new URLSearchParams(location.search).get('quality'));
/** True once the player picked a preset with Q (now or on an earlier visit): adaptive quality must not change it. */
let manualQuality = false;
function loadQuality(): QualitySettings {
  if (URL_QUALITY) return URL_QUALITY;
  try {
    const manual = presetByName(localStorage.getItem(QUALITY_KEY));
    if (manual) {
      manualQuality = true;
      return manual;
    }
    const guess = presetByName(presetNameForGpu(gpuName())) ?? DEFAULT_QUALITY;
    const auto = presetByName(sessionStorage.getItem(AUTO_QUALITY_KEY));
    return auto && QUALITY_PRESETS.indexOf(auto) > QUALITY_PRESETS.indexOf(guess) ? auto : guess;
  } catch {
    return DEFAULT_QUALITY;
  }
}
/**
 * Adaptive quality says frames stay too slow even at the lowest render scale: go one preset down (never up
 * on its own). A preset the player chose with Q is respected (only the render scale adapts then).
 */
function stepDownQuality() {
  if (manualQuality || URL_QUALITY) return;
  const next = QUALITY_PRESETS[QUALITY_PRESETS.indexOf(quality) + 1];
  if (!next) return;
  quality = next;
  qualityEl.textContent = quality.name;
  qualityChip.textContent = quality.name;
  try {
    sessionStorage.setItem(AUTO_QUALITY_KEY, quality.name); // not the manual key: a manual choice is still respected next time
  } catch {
    /* ignore */
  }
  game?.setQuality(quality);
}
let quality = loadQuality();
const qualityEl = $('quality');
const qualityChip = $('chip-quality');
qualityEl.textContent = quality.name;
qualityChip.textContent = quality.name;
function cycleQuality() {
  quality = QUALITY_PRESETS[(QUALITY_PRESETS.indexOf(quality) + 1) % QUALITY_PRESETS.length];
  manualQuality = true;
  qualityEl.textContent = quality.name;
  qualityChip.textContent = quality.name;
  try {
    localStorage.setItem(QUALITY_KEY, quality.name);
  } catch {
    /* ignore */
  }
  game?.setQuality(quality);
}

// --- Bot difficulty (D in the lobby; remembered on this computer) -----------------
const BOTS_KEY = 'tiltkart.botDifficulty';
function loadDifficulty(): Difficulty {
  try {
    return sanitizeDifficulty(localStorage.getItem(BOTS_KEY));
  } catch {
    return DEFAULT_DIFFICULTY;
  }
}
let botDifficulty = loadDifficulty();
const botsChip = $('chip-bots');
botsChip.textContent = botDifficulty.toUpperCase();
function cycleDifficulty() {
  botDifficulty = nextDifficulty(botDifficulty);
  botsChip.textContent = botDifficulty.toUpperCase();
  try {
    localStorage.setItem(BOTS_KEY, botDifficulty);
  } catch {
    /* ignore */
  }
}

// --- RACERS: 4 / 8 / 12 karts on the grid (R in the lobby; remembered on this computer) -------
// People keep slots 0..3; computer drivers fill the rest (see raceSettings.ts).
const RACERS_KEY = 'tiltkart.racers';
function loadRacers(): RacerCount {
  try {
    return sanitizeRacers(new URLSearchParams(location.search).get('racers') ?? localStorage.getItem(RACERS_KEY)); // ?racers=12 for testing
  } catch {
    return sanitizeRacers(null);
  }
}
let racers = loadRacers();
const racersChip = $('chip-racers');
racersChip.textContent = String(racers);
function cycleRacers() {
  racers = nextRacers(racers);
  racersChip.textContent = String(racers);
  try {
    localStorage.setItem(RACERS_KEY, String(racers));
  } catch {
    /* ignore */
  }
}

// --- Track picker (T in the lobby; remembered on this computer) -------------
// localStorage keeps small strings per website, surviving page reloads and
// browser restarts. We store the track's name (not its index) so adding new
// tracks to the list later doesn't change someone's saved choice.
// Dev shortcut: ?track=2 or ?track=Maple%20Bay in the URL overrides it.
const TRACK_KEY = 'tiltkart.track';
function loadTrack(): TrackDef {
  const param = new URLSearchParams(location.search).get('track');
  if (param !== null) {
    const byParam = TRACKS[Number(param)] ?? TRACKS.find((t) => t.name.toLowerCase() === param.toLowerCase());
    if (byParam) return byParam;
    // In the dev server only (import.meta.env.DEV is false in the built site), test tracks too.
    const dev = import.meta.env.DEV ? DEV_TRACKS.find((t) => t.name.toLowerCase() === param.toLowerCase()) : undefined;
    if (dev) return dev;
  }
  try {
    return TRACKS.find((t) => t.name === localStorage.getItem(TRACK_KEY)) ?? TRACKS[0];
  } catch {
    return TRACKS[0]; // storage can be blocked (e.g. private mode)
  }
}
let track = loadTrack();
const trackEl = $('track');
trackEl.textContent = track.name;
const trackPreview = new TrackPreview($<HTMLCanvasElement>('track-map'), $('track-name'), $('track-meta'), $<HTMLImageElement>('track-shot'));
trackPreview.show(track);
/** Make `def` the lobby's selected track (keyboard, TV buttons, or P1's phone all end up here). */
function selectTrack(def: TrackDef) {
  track = def;
  trackEl.textContent = track.name;
  trackPreview.show(track);
  updateModeUi();
  try {
    localStorage.setItem(TRACK_KEY, track.name);
  } catch {
    /* ignore */
  }
  seriesHost.refresh(); // tell phones
}
/** step = +1 next track, -1 previous. */
function cycleTrack(step = 1) {
  seriesHost.hostChose(); // the host's own choice also closes the phone pop-up
  const i = Math.max(0, TRACKS.indexOf(track));
  selectTrack(TRACKS[(i + step + TRACKS.length) % TRACKS.length]);
}

// Clicking a button gives it keyboard focus; blur so Enter / arrows keep working for the lobby shortcuts.
$('track-prev').addEventListener('click', (e) => {
  cycleTrack(-1);
  (e.currentTarget as HTMLElement).blur();
});
$('track-next').addEventListener('click', (e) => {
  cycleTrack(1);
  (e.currentTarget as HTMLElement).blur();
});

// --- Race mode (single race / Grand Prix / Loser picks) -----------------------
// The mode is chosen on P1's phone, or here with the up/down arrow keys (or a click). The rules live in
// series.ts, the glue (what phones are told, podium, pick strip) in seriesHost.ts.
const modePills = $('mode-pills');
const modeBtns = SERIES_MODES.map((m) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mode-pill';
  b.textContent = MODE_NAMES[m];
  b.addEventListener('click', () => {
    seriesHost.setMode(m);
    seriesHost.hostChose();
    b.blur();
  });
  modePills.appendChild(b);
  return b;
});
/** Highlight the chosen mode; in Grand Prix the track panel says "all tracks" instead of one name. */
function updateModeUi() {
  const m = seriesHost.mode;
  SERIES_MODES.forEach((mode, i) => modeBtns[i].classList.toggle('on', mode === m));
  $('mode-note').textContent = seriesHost.choosing
    ? `${seriesHost.ownerName()} is choosing on their phone…`
    : m === 'single' ? 'One race, then back here' : m === 'gp' ? `All ${TRACKS.length} tracks, points for every place` : m === 'knockout' ? 'Last kart is out after every lap' : 'Last place picks the next track';
  document.querySelector('.track-panel')!.classList.toggle('gp', m === 'gp');
  if (m === 'gp') $('track-meta').textContent = `Grand Prix: all ${TRACKS.length} tracks in order`;
  else trackPreview.show(track);
}

// --- Mute indicator ----------------------------------------------------------
// The audio engine owns mute (M key, works in the lobby and during a race, saved
// in localStorage). It announces changes with a `tiltkart:mute` event; the lobby
// chip just mirrors it.
function showMute() {
  $('chip-mute').textContent = audio.muted ? 'OFF' : 'ON';
  $('chip-mute-wrap').classList.toggle('off', audio.muted);
}
window.addEventListener('tiltkart:mute', showMute);
showMute();

// --- Lobby <-> driving ------------------------------------------------------
const banner = $('banner');
const gameEl = $('game');
const seriesHost: SeriesHost = new SeriesHost({
  players,
  tracks: TRACKS,
  card: (def) => trackPreview.card(def),
  lobbyTrack: () => track,
  setLobbyTrack: (i) => selectTrack(TRACKS[i]),
  onModeChange: () => updateModeUi(),
  onPendingChange: () => {
    updateModeUi();
    updateStartBanner(); // while the owner is choosing, READY flags don't start the race
  },
  startRace: () => startDriving(),
  toLobby: () => backToLobby(),
  gameEl,
});
// Dev: ?mode=gp or ?mode=loser picks the mode from the address (handy with ?drive=4).
const URL_MODE = sanitizeMode(new URLSearchParams(location.search).get('mode'));
if (URL_MODE) seriesHost.mode = URL_MODE;
updateModeUi();
// Render the 3D course pictures for the track cards in the background (one per ~250 ms, after the page has settled).
trackPreview.renderShots(TRACKS, () => {
  seriesHost.cardsUpdated(); // phones that are choosing get the new picture
  trackPreview.show(track);
  updateModeUi();
}, 1500, () => driving); // paused while a race is on screen: a shot would stall the frame
let game: Game | null = null; // created on first use (sets up WebGL)
let driving = false;
let startTimer: ReturnType<typeof setTimeout> | null = null;

function startDriving() {
  startTimer = null;
  if (players.slots.players.length === 0) return;
  selectView.hide(); // free the selection screen's GPU memory while racing
  if (!seriesHost.series) seriesHost.begin(); // starting from the lobby: a new series with the chosen mode and track
  driving = true;
  players.setPhase('countdown');
  $('app').classList.add('hidden');
  gameEl.classList.remove('hidden');
  game ??= new Game(
    gameEl,
    players,
    {
      onGo: () => players.setPhase('race'),
      onResults: () => players.setPhase('results'),
      // Results screen buttons (same as the Enter / Esc keys).
      onRaceAgain: () => raceAgain(),
      onChangeTrack: () => backToLobby(),
      onRaceResults: (placings) => seriesHost.onRaceResults(placings),
      onQualityStepDown: () => stepDownQuality(),
    },
    quality,
  );
  // ?quality=... in the address is for testing and measuring: keep that preset exactly as it is (no adaptive scaling).
  if (URL_QUALITY) game.adaptive.enabled = false;
  game.audio = audio; // AUDIO
  game.setTrack(seriesHost.currentTrack()); // the lobby's track, or the series' next one
  game.botDifficulty = botDifficulty;
  game.racers = racers; // RACERS: bots fill the grid up to this many karts
  game.knockout = seriesHost.series?.mode === 'knockout'; // Knockout: more laps, the last kart is out after every lap
  if (import.meta.env.DEV) (window as unknown as { __game?: Game }).__game = game; // debugging aid (dev server only)
  // Practice aid: /host/?give=nova (or dash, slick (the Peel), ricochet, seeker, jumble, magnet, bumper, random) = endless supply of that item.
  const give = new URLSearchParams(location.search).get('give');
  game.devItem = give === 'random' || (ITEM_IDS as readonly string[]).includes(give ?? '') ? (give as ItemId | 'random') : null;
  game.start(players.slots.players.map((p) => p.index));
  seriesHost.refresh(); // phones learn the series state ('racing')
}

/**
 * From the results screen: the next step of the series (same track again, next Grand Prix race, the
 * loser's pick, the podium, or back to the menu). `fromReady` = every phone tapped READY.
 */
function raceAgain(fromReady = false) {
  if (driving && players.slots.phase === 'results') seriesHost.next(fromReady);
}

function backToLobby() {
  if (!driving) return;
  driving = false;
  seriesHost.end();
  players.setPhase('lobby');
  audio.stopKarts(); // AUDIO
  audio.playMusic('lobby');
  gameEl.classList.add('hidden');
  $('app').classList.remove('hidden');
  lobbyView.render();
  selectView.show();
}

players.onLobbyChange.add(() => {
  lobbyView.render();
  seriesHost.refresh(); // the menu owner may have changed (P1 left / joined)
  if (driving) {
    // Results screen: when every connected player taps RACE AGAIN, go again.
    if (players.slots.phase === 'results' && players.slots.allReady()) raceAgain(true);
    return;
  }
  updateStartBanner();
});
/** When everyone is ready (and nobody is still choosing the mode), start after a short pause (cancelled if someone un-readies). */
function updateStartBanner() {
  if (driving) return;
  // Everyone locked in at READY, and P1's mode / track pop-up is finished (it always comes first).
  const all = players.slots.canStart(seriesHost.choosing);
  banner.classList.toggle('hidden', !all);
  banner.textContent = all ? 'Everyone is ready! Starting…' : '';
  const n = players.slots.players.length;
  $('lobby-hint').textContent =
    n === 0 ? 'Waiting for players…' : `${n} player${n > 1 ? 's' : ''} · everyone picks a driver and kart, then READY (or press G to start now)`;
  if (all && !startTimer) startTimer = setTimeout(startDriving, 1500);
  if (!all && startTimer) {
    clearTimeout(startTimer);
    startTimer = null;
  }
}
lobbyView.render();

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') backToLobby();
  if (e.code === 'Enter' && driving && players.slots.phase === 'results') raceAgain();
  // Lobby shortcuts (ignored while typing in a text box).
  if (!driving && !(e.target instanceof HTMLInputElement)) {
    if (e.code === 'KeyG' && players.slots.players.length > 0) startDriving();
    if (e.code === 'KeyQ') cycleQuality();
    if (e.code === 'KeyD' && !wasdIsAPlayer()) cycleDifficulty(); // D is the WASD player's 'browse right'
    if (e.code === 'KeyN') cycleRacers(); // N, not R: R is the WASD player's trick / back key
    if (e.code === 'KeyT') cycleTrack();
    // Menu without phones: arrows choose track (left/right) and mode (up/down), Enter starts.
    if (e.code === 'ArrowLeft' && !arrowsAreAPlayer()) cycleTrack(-1);
    if (e.code === 'ArrowRight' && !arrowsAreAPlayer()) cycleTrack(1);
    if (e.code === 'Enter' && !arrowsAreAPlayer() && players.slots.players.length > 0 && !(e.target instanceof HTMLButtonElement)) startDriving();
    if (seriesHost.key(e.code, true)) e.preventDefault();
    if (e.code.startsWith('Arrow')) e.preventDefault(); // don't scroll the page
  } else if (driving && seriesHost.key(e.code, false)) {
    e.preventDefault(); // Loser picks: arrows / S on the results screen
  }
});

// Dev shortcut: /host/?drive adds a WASD keyboard player and jumps straight into
// a race; /host/?drive=4 also adds 3 bots (instant 4-way split-screen).
const driveParam = new URLSearchParams(location.search).get('drive');
if (driveParam === null) selectView.show(); // (the drive shortcut goes straight into a race, no selection screen needed)
if (driveParam !== null) {
  if (!URL_MODE) seriesHost.mode = 'single'; // the dev shortcut stays a plain single race unless ?mode= says otherwise
  players.slots.join({ kind: 'keyboard', scheme: 0 }, 'Keys WASD', 2);
  players.addKeyboardInput(0);
  const total = Math.max(1, Math.min(4, Number(driveParam) || 1));
  for (let i = 1; i < total; i++) players.addBot();
  startDriving();
}

// Debug toggle with the backtick key.
window.addEventListener('keydown', (e) => {
  if (e.code === 'Backquote') document.body.classList.toggle('no-debug');
});

// --- Frame loop ------------------------------------------------------------
// requestAnimationFrame calls us right before each screen refresh (~60 Hz).
const fpsEl = $('fps');
const clock = new FrameClock(0.1); // smooths timestamp jitter into an even dt (see frameClock.ts)
let frames = 0;
let fpsTimer = performance.now();
function frame(now: number) {
  const dt = clock.tick(now);
  players.updateLocal(dt);
  if (driving && game) game.frame(dt);
  else lobbyView.updateDebug();
  frames++;
  if (now - fpsTimer > 500) {
    fpsEl.textContent = `${Math.round((frames * 1000) / (now - fpsTimer))} fps`;
    frames = 0;
    fpsTimer = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

openRoom().then(showRoom);

// Keep the laptop/TV screen awake while the game page is open (like a video site does).
// Some browsers only grant it after the user interacts with the page, so also try on the first key/click.
void enableWakeLock();
for (const ev of ['keydown', 'pointerdown'] as const) window.addEventListener(ev, () => void enableWakeLock(), { once: true });
