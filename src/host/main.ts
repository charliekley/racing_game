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
import { KeyboardState } from './input/localInput';
import { LobbyView } from './lobbyView';
import { PlayerManager } from './playerManager';

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
    // Exercise the host -> phone status path: roulette, then an item, then empty.
    const status = (item: ItemDisplay) =>
      players.sendTo(slot, { t: 'status', position: slot + 1, lap: 1, totalLaps: 3, item });
    status({ kind: 'roulette' });
    setTimeout(() => status({ kind: 'item', id: 'test', count: 1 }), 1500);
    setTimeout(() => status({ kind: 'none' }), 5000);
  },
  kick: (slot) => players.kick(slot),
});

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
  game ??= new Game(gameEl, players, {
    onGo: () => players.setPhase('race'),
    onResults: () => players.setPhase('results'),
  });
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
});

// Dev shortcut: /host/?drive adds a WASD keyboard player and jumps straight into driving.
if (new URLSearchParams(location.search).has('drive')) {
  players.slots.join({ kind: 'keyboard', scheme: 0 }, 'Keys WASD', 2);
  players.addKeyboardInput(0);
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
