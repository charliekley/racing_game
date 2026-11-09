/**
 * Host (TV) entry point - Milestone 1: lobby + live input debug view.
 *
 * Flow: pick a room code -> register with the signaling server under it ->
 * show QR code -> phones connect -> PlayerManager tracks them -> LobbyView
 * draws them. Later milestones add the race on top of this.
 */
import QRCode from 'qrcode';
import './host.css';
import { PeerHostTransport } from '../shared/net/peerTransport';
import { RoomTakenError } from '../shared/net/transport';
import type { ItemDisplay } from '../shared/protocol';
import { generateRoomCode, normalizeRoomCode } from '../shared/roomCode';
import { controllerUrl } from './controllerUrl';
import { Game } from './game';
import { ITEM_IDS, type ItemId } from '../sim/items/types';
import { DEFAULT_QUALITY, QUALITY_PRESETS, type QualitySettings } from '../render/scene';
import { KeyboardState } from './input/localInput';
import { LobbyView } from './lobbyView';
import { PlayerManager } from './playerManager';
import { DEV_TRACKS, TRACKS, type TrackDef } from '../track';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ROOM_STORAGE_KEY = 'tiltkart.hostRoom';

const transport = new PeerHostTransport();
const keys = new KeyboardState();
const players = new PlayerManager(transport, keys);

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

// --- Graphics quality (Q in the lobby; remembered on this computer) ----------
const QUALITY_KEY = 'tiltkart.quality';
function loadQuality(): QualitySettings {
  try {
    return QUALITY_PRESETS.find((q) => q.name === localStorage.getItem(QUALITY_KEY)) ?? DEFAULT_QUALITY;
  } catch {
    return DEFAULT_QUALITY;
  }
}
let quality = loadQuality();
const qualityEl = $('quality');
qualityEl.textContent = quality.name;
function cycleQuality() {
  quality = QUALITY_PRESETS[(QUALITY_PRESETS.indexOf(quality) + 1) % QUALITY_PRESETS.length];
  qualityEl.textContent = quality.name;
  try {
    localStorage.setItem(QUALITY_KEY, quality.name);
  } catch {
    /* ignore */
  }
  game?.setQuality(quality);
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
function cycleTrack() {
  track = TRACKS[(TRACKS.indexOf(track) + 1) % TRACKS.length];
  trackEl.textContent = track.name;
  try {
    localStorage.setItem(TRACK_KEY, track.name);
  } catch {
    /* ignore */
  }
}

// --- Lobby <-> driving ------------------------------------------------------
const banner = $('banner');
const gameEl = $('game');
let game: Game | null = null; // created on first use (sets up WebGL)
let driving = false;
let startTimer: ReturnType<typeof setTimeout> | null = null;

function startDriving() {
  startTimer = null;
  if (players.slots.players.length === 0) return;
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
    },
    quality,
  );
  game.setTrack(track);
  if (import.meta.env.DEV) (window as unknown as { __game?: Game }).__game = game; // debugging aid (dev server only)
  // Practice aid: /host/?give=nova (or dash, slick, ricochet, seeker, random) = endless supply of that item.
  const give = new URLSearchParams(location.search).get('give');
  game.devItem = give === 'random' || (ITEM_IDS as readonly string[]).includes(give ?? '') ? (give as ItemId | 'random') : null;
  game.start(players.slots.players.map((p) => p.index));
}

/** From the results screen: same players, new race. */
function raceAgain() {
  if (driving && players.slots.phase === 'results') startDriving();
}

function backToLobby() {
  if (!driving) return;
  driving = false;
  players.setPhase('lobby');
  gameEl.classList.add('hidden');
  $('app').classList.remove('hidden');
  lobbyView.render();
}

players.onLobbyChange.add(() => {
  lobbyView.render();
  if (driving) {
    // Results screen: when every connected player taps RACE AGAIN, go again.
    if (players.slots.phase === 'results' && players.slots.allReady()) raceAgain();
    return;
  }
  // When everyone is ready, start after a short pause (cancelled if someone un-readies).
  const all = players.slots.allReady();
  banner.classList.toggle('hidden', !all);
  banner.textContent = all ? 'Everyone is ready! Starting…' : '';
  const n = players.slots.players.length;
  $('lobby-hint').textContent =
    n === 0 ? 'Waiting for players…' : `${n} player${n > 1 ? 's' : ''} · everyone taps READY to start (or press G to start now)`;
  if (all && !startTimer) startTimer = setTimeout(startDriving, 1500);
  if (!all && startTimer) {
    clearTimeout(startTimer);
    startTimer = null;
  }
});
lobbyView.render();

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') backToLobby();
  if (e.code === 'Enter' && driving && players.slots.phase === 'results') raceAgain();
  // Lobby shortcuts (ignored while typing in a text box).
  if (!driving && !(e.target instanceof HTMLInputElement)) {
    if (e.code === 'KeyG' && players.slots.players.length > 0) startDriving();
    if (e.code === 'KeyQ') cycleQuality();
    if (e.code === 'KeyT') cycleTrack();
  }
});

// Dev shortcut: /host/?drive adds a WASD keyboard player and jumps straight into
// a race; /host/?drive=4 also adds 3 bots (instant 4-way split-screen).
const driveParam = new URLSearchParams(location.search).get('drive');
if (driveParam !== null) {
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
let last = performance.now();
let frames = 0;
let fpsTimer = last;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
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
