/**
 * Phone controller entry point.
 *
 * Screens: join form -> (iOS) motion permission -> controller pad.
 * Networking: one Link to the host; reliable JSON events + a 60 Hz unreliable
 * input stream. Reconnects automatically with the same clientId so the host
 * gives us our slot back.
 */
import './controller.css';
import { KART_COLORS, colorHex } from '../shared/colors';
import { PeerControllerTransport } from '../shared/net/peerTransport';
import { RoomNotFoundError, type Link } from '../shared/net/transport';
import {
  Buttons,
  PROTOCOL_VERSION,
  encodeInput,
  isHostMessage,
  MAX_TRACKS,
  parseSeriesInfo,
  parseTrackCards,
  sanitizeName,
  type GamePhase,
  type SeriesInfo,
  type TrackCard,
  type HostToController,
  type LobbyPlayerInfo,
} from '../shared/protocol';
import { normalizeRoomCode } from '../shared/roomCode';
import {
  enableWakeLock,
  getClientId,
  isIOS,
  isPortrait,
  motionPermissionNeeded,
  requestMotionPermission,
  screenOrientationDeg,
  tryFullscreenLandscape,
  vibrate,
} from './device';
import { ItemView } from './itemView';
import { Picker } from './picker';
import { PhoneMap } from './phoneMap';
import { SeriesMenu } from './seriesMenu';
import { forcedChoice } from '../shared/forcedChoice';
import { MotionInput } from './motionInput';
import { loadPrefs, savePrefs } from './settings';
import { uiRotationDeg } from './steering';
import { TouchButtons } from './touchButtons';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const SEND_HZ = 60;
const PING_INTERVAL_MS = 1000;
/** If the host is silent this long, assume the link is dead and reconnect. */
const HOST_TIMEOUT_MS = 4000;
/** How long the TRICK bit stays set after a flick (several packets, so one drop doesn't lose it). */
const TRICK_PULSE_MS = 150;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const prefs = loadPrefs();
const clientId = getClientId();
const transport = new PeerControllerTransport();
// Gravity sign convention: remembered per device once learned; first guess is
// "inverted" on iOS (see steering.ts).
const SIGN_KEY = 'tiltkart.gravityInverted';
function loadInverted(): boolean {
  try {
    const v = localStorage.getItem(SIGN_KEY);
    if (v === '1' || v === '0') return v === '1';
  } catch {
    /* ignore */
  }
  return isIOS();
}
function saveInverted(v: boolean) {
  try {
    localStorage.setItem(SIGN_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}
const motion = new MotionInput(prefs.steering, loadInverted());
motion.onSignLearned = saveInverted;
// Where no permission prompt is needed (Android), start listening right away:
// while the player types their name in portrait we learn the sensor's sign.
if (!motionPermissionNeeded()) motion.start();

let room: string | null = normalizeRoomCode(new URLSearchParams(location.search).get('room'));
let link: Link | null = null;
let wantConnection = false;
let welcomed = false;
let mySlot: number | null = null;
let myColor = prefs.color;
let ready = false;
let phase: GamePhase = 'lobby';
/** True during the race countdown: the steering keeps re-zeroing to the current pose. */
let recentering = false;
let lobby: LobbyPlayerInfo[] = [];
/** Race mode state from the host (menu / between races / podium) and the track pictures, once we are allowed to choose. */
let series: SeriesInfo | null = null;
let trackCards: TrackCard[] | null = null;
let cardsRequestedAt = 0;
let lastHostMsgAt = 0;
let rttMs: number | null = null;
let pingId = 1;
let seq = 0;
let trickUntil = 0;
let sentThisSecond = 0;
let sendRate = 0;

// ---------------------------------------------------------------------------
// Block browser gestures that would fight the controller (iOS ignores
// user-scalable=no, so we also cancel pinch/double-tap in JS).
// ---------------------------------------------------------------------------
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener(
  'touchmove',
  (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest('#join-screen, .settings-box')) e.preventDefault();
  },
  { passive: false }, // "passive: false" is required for preventDefault to work on touchmove
);

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
function showScreen(id: 'join-screen' | 'motion-screen' | 'pad-screen') {
  for (const s of ['join-screen', 'motion-screen', 'pad-screen']) $(s).classList.toggle('hidden', s !== id);
  document.body.classList.toggle('playing', id === 'pad-screen');
}

function showConn(text: string | null) {
  $('conn-overlay').classList.toggle('hidden', text === null);
  if (text) $('conn-text').textContent = text;
}

function renderSwatches(container: HTMLElement, selected: number, onPick: (i: number) => void) {
  container.replaceChildren();
  const taken = new Set(lobby.filter((p) => p.slot !== mySlot).map((p) => p.color));
  KART_COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = c.hex;
    b.title = c.name;
    if (i === selected) b.classList.add('selected');
    if (taken.has(i)) b.classList.add('taken');
    b.addEventListener('click', () => onPick(i));
    container.appendChild(b);
  });
}

function applyPlayerColor() {
  document.documentElement.style.setProperty('--player', colorHex(myColor));
}

// ---------------------------------------------------------------------------
// Join form
// ---------------------------------------------------------------------------
const roomInput = $<HTMLInputElement>('room-input');
const nameInput = $<HTMLInputElement>('name-input');
roomInput.value = room ?? '';
nameInput.value = prefs.name;
let joinColor = prefs.color;
const drawJoinSwatches = () =>
  renderSwatches($('join-colors'), joinColor, (i) => {
    joinColor = i;
    drawJoinSwatches();
  });
drawJoinSwatches();

$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = normalizeRoomCode(roomInput.value);
  if (!code) {
    $('join-error').textContent = 'Enter the 4-letter code shown on the TV.';
    return;
  }
  room = code;
  prefs.name = sanitizeName(nameInput.value);
  prefs.color = joinColor;
  myColor = joinColor;
  savePrefs(prefs);
  $('join-error').textContent = '';
  // Put the room in the URL so a page reload rejoins automatically.
  history.replaceState(null, '', `?room=${code}`);

  // Everything below must happen inside this tap ("user gesture").
  tryFullscreenLandscape();
  void enableWakeLock();
  if (motionPermissionNeeded()) {
    requestMotionPermission().then((result) => {
      if (result === 'granted') startPlaying();
      else showMotionScreen(result === 'denied');
    });
  } else {
    startPlaying();
  }
});

// ---------------------------------------------------------------------------
// iOS motion permission screen (fallback if the prompt on JOIN didn't work)
// ---------------------------------------------------------------------------
function showMotionScreen(denied: boolean) {
  showScreen('motion-screen');
  $('motion-error').textContent = !denied
    ? ''
    : isIOS()
      ? 'Motion access was denied. To fix it: close this Safari tab, reopen the link and tap "Allow". ' +
        'If it still fails, check Settings › Apps › Safari › Advanced (Motion & Orientation Access) and try again.'
      : 'Motion access was denied or this device has no motion sensor.';
  $('motion-skip').classList.toggle('hidden', !denied);
}
$('motion-skip').addEventListener('click', () => startPlaying());
$('motion-btn').addEventListener('click', () => {
  void enableWakeLock();
  requestMotionPermission().then((result) => {
    if (result === 'granted' || result === 'unsupported') startPlaying();
    else showMotionScreen(true);
  });
});

// ---------------------------------------------------------------------------
// Controller pad
// ---------------------------------------------------------------------------
const itemView = new ItemView($<HTMLCanvasElement>('item-icon'), false); // lives inside the ITEM button
const phoneMap = new PhoneMap($<HTMLCanvasElement>('map-canvas'));
const touch = new TouchButtons([$('zone-left'), $('zone-right')], (_mask, pressedNow) => {
  if (pressedNow) vibrate(8); // tiny tick so buttons feel physical (Android)
  sendInput(); // send immediately on change, don't wait for the next 60 Hz tick
});

motion.onTrick = () => {
  trickUntil = performance.now() + TRICK_PULSE_MS;
};

// --- One-time "turn on rotation lock" tip (per browser session) -------------
const LOCK_TIP_KEY = 'tiltkart.lockTipSeen';
let lockTipDone = (() => {
  try {
    return sessionStorage.getItem(LOCK_TIP_KEY) === '1';
  } catch {
    return false;
  }
})();
$('lock-ok').addEventListener('click', () => {
  lockTipDone = true;
  try {
    sessionStorage.setItem(LOCK_TIP_KEY, '1');
  } catch {
    /* ignore */
  }
  $('lock-overlay').classList.add('hidden');
});

function startPlaying() {
  if (!lockTipDone) $('lock-overlay').classList.remove('hidden');
  motion.start();
  showScreen('pad-screen');
  applyPlayerColor();
  $('player-name').textContent = prefs.name;
  itemView.set({ kind: 'none' });
  wantConnection = true;
  void connectLoop();
}

// --- Driver + kart picker: replaces the race HUD while in the lobby / results; locked during a race ---
const picker = new Picker(prefs.loadout, (l) => {
  prefs.loadout = l;
  savePrefs(prefs);
  // Tell the TV (same message as a name/colour change). The host ignores it if a race is running.
  link?.sendEvent({ t: 'profile', name: prefs.name, color: myColor, loadout: l });
});
document.querySelector('.center')!.insertBefore(picker.root, document.querySelector('.bottom'));

function updatePickerVisibility() {
  const choosing = phase === 'lobby' || phase === 'results';
  picker.root.classList.toggle('hidden', !choosing);
  picker.setLocked(!choosing);
  document.querySelector('.hud')!.classList.toggle('hidden', choosing);
  if (choosing) picker.drawPortrait(); // size is only known once it is visible
}
updatePickerVisibility();
window.addEventListener('resize', () => picker.drawPortrait());

$('ready-btn').addEventListener('click', () => {
  const next = !ready;
  // Pressing Ready is also "this is how I hold the wheel straight".
  if (next) motion.calibrate();
  link?.sendEvent({ t: 'ready', ready: next });
  ready = next; // optimistic; the host's lobby message is the final word
  updateReadyButton();
});

function updateReadyButton() {
  const btn = $('ready-btn');
  // Between races the button means "go on": next Grand Prix race, race again, or back to the menu after the podium.
  let label = phase === 'results' ? 'RACE AGAIN' : 'READY';
  let hidden = phase !== 'lobby' && phase !== 'results';
  if (phase === 'results' && series) {
    if (series.stage === 'over') label = 'MENU';
    else if (series.mode === 'gp') label = series.racesDone >= (series.raceTotal ?? 0) ? 'FINISH' : 'NEXT RACE';
    else if (series.mode === 'loser') hidden = true; // the pick starts the next race
  }
  btn.classList.toggle('hidden', hidden);
  btn.classList.toggle('is-ready', ready);
  btn.textContent = ready ? `${label} ✓` : label;
}

// --- Race modes: mode/track menu, Loser-picks choice, place + points line ----------------------
const seriesMenu = new SeriesMenu({
  setMode: (mode) => link?.sendEvent({ t: 'setup', mode }),
  setTrack: (track) => link?.sendEvent({ t: 'setup', track }),
  pick: (track) => link?.sendEvent({ t: 'pick', track }),
  stop: () => link?.sendEvent({ t: 'series', act: 'stop' }),
  finish: (track) => link?.sendEvent({ t: 'setup', ...(track !== undefined ? { track } : {}), done: true }),
});
$('stage').appendChild(seriesMenu.root);

const MODE_SHORT = { single: 'Single race', gp: 'Grand Prix', loser: 'Loser picks' } as const;

function nameOfSlot(slot: number | null): string {
  return lobby.find((p) => p.slot === slot)?.name ?? 'Someone';
}

/** Rebuild the race-mode line, the READY label and the menu from the latest `series` + `phase`. */
function updateSeriesUi() {
  const bar = $('series-bar');
  const s = series;
  const choosing = phase === 'lobby' || phase === 'results';
  bar.classList.toggle('hidden', !choosing || !s);
  if (!s) return;
  const isOwner = s.owner !== null && s.owner === mySlot;
  const isPicker = s.picker !== null && s.picker === mySlot;
  const text = $('series-text');
  const btns = $('series-btns');
  btns.replaceChildren();
  const addBtn = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'series-btn';
    b.textContent = label;
    b.addEventListener('click', fn);
    btns.appendChild(b);
  };

  // Ask the host for the track pictures when we get a say in the track choice.
  const forced = forcedChoice(s, mySlot);
  const mayChoose = (isOwner && s.stage === 'menu') || (isPicker && s.stage === 'between') || forced !== null;
  // (Retried at most every 1.5 s while we still have none: the host only answers whoever may choose right now.)
  if (mayChoose && !trackCards && performance.now() - cardsRequestedAt > 1500) {
    cardsRequestedAt = performance.now();
    link?.sendEvent({ t: 'series', act: 'cards' });
  }
  const canStop = isOwner && s.mode === 'loser' && s.stage === 'between';
  seriesMenu.update(s, trackCards, canStop);
  // The forced pop-up: shown whenever the host is waiting for THIS phone (join, reconnect, after a race, Loser picks).
  seriesMenu.sync(forced);

  const at = s.standings.findIndex((v, i) => i % 2 === 0 && v === mySlot);
  const myRank = at >= 0 ? at / 2 + 1 : null;
  const standing = myRank ? `${ordinal(myRank)} · ${s.standings[at + 1]} pts` : '';

  if (s.stage === 'menu') {
    const trackName = trackCards?.[s.track]?.name;
    if (isOwner) {
      text.textContent = '';
      addBtn(`${MODE_SHORT[s.mode]}${s.mode !== 'gp' && trackName ? ` · ${trackName}` : ''}  ▸`, () => seriesMenu.open('setup'));
    } else {
      text.textContent = s.pending ? `${nameOfSlot(s.owner)} is choosing…` : `${MODE_SHORT[s.mode]} · ${nameOfSlot(s.owner)} chooses`;
    }
  } else if (s.stage === 'between') {
    const race = s.raceTotal ? `Race ${s.racesDone}/${s.raceTotal}` : '';
    if (s.mode === 'loser') {
      text.textContent = isPicker ? `${standing} · your pick` : `${standing} · ${nameOfSlot(s.picker)} is choosing…`;
    } else {
      text.textContent = [race, standing].filter(Boolean).join(' · ');
    }
    if (isOwner) addBtn('MENU', () => link?.sendEvent({ t: 'series', act: 'menu' }));
    if (canStop) addBtn('STOP', () => link?.sendEvent({ t: 'series', act: 'stop' }));
  } else if (s.stage === 'over') {
    text.textContent = myRank ? `FINAL ${standing}` : 'FINAL';
  } else {
    text.textContent = '';
  }
  // (The series message can arrive just before the 'phase' message, so only the series stage closes the menu.)
  if (s.stage === 'racing') seriesMenu.close();
  if (s.stage === 'menu' && !isOwner) seriesMenu.close(); // (a no-op while forced; sync() above decides that)
  updateReadyButton();
}

// Pause: release all buttons when the app is backgrounded.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') {
    touch.releaseAll();
    sendInput();
  }
});

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------
async function connectLoop() {
  let attempt = 0;
  while (wantConnection && !link && room) {
    showConn(attempt === 0 ? 'Connecting…' : `Reconnecting… (try ${attempt + 1})`);
    try {
      const l = await transport.connect(room);
      attachLink(l);
      return;
    } catch (err) {
      if (err instanceof RoomNotFoundError) {
        showConn(`No game found with code ${room}.\nIs the TV page open? Retrying…`);
      } else {
        console.warn('connect failed', err);
      }
      attempt++;
      await new Promise((r) => setTimeout(r, Math.min(5000, 1000 + attempt * 500)));
    }
  }
}

function attachLink(l: Link) {
  link = l;
  welcomed = false;
  trackCards = null; // a fresh link: ask for the pictures again if we need them
  cardsRequestedAt = 0;
  lastHostMsgAt = performance.now();
  showConn('Joining…');
  l.onEvent.add((msg) => {
    lastHostMsgAt = performance.now();
    if (isHostMessage(msg)) handleHostMessage(msg);
  });
  l.onClose.add(() => {
    if (link !== l) return;
    link = null;
    welcomed = false;
    if (wantConnection) {
      showConn('Connection lost. Reconnecting…');
      void connectLoop();
    }
  });
  l.sendEvent({ t: 'hello', v: PROTOCOL_VERSION, clientId, name: prefs.name, color: prefs.color, loadout: prefs.loadout });
}

function handleHostMessage(msg: HostToController) {
  switch (msg.t) {
    case 'welcome':
      // The first welcome on a new link: the host's record of our driver wins (matters when we
      // rejoin a game that already knows us); later welcomes are just echoes of our own changes.
      if (!welcomed && msg.loadout) {
        picker.setValue(msg.loadout);
        prefs.loadout = picker.value;
        savePrefs(prefs);
      }
      welcomed = true;
      mySlot = msg.slot;
      myColor = msg.color;
      ready = msg.ready;
      phase = msg.phase;
      recentering = phase === 'countdown';
      updatePickerVisibility();
      updateSeriesUi();
      $('player-name').textContent = `P${msg.slot + 1} · ${msg.name}`;
      applyPlayerColor();
      updateReadyButton();
      showConn(null);
      vibrate([30, 40, 30]);
      break;
    case 'reject':
      wantConnection = false;
      link?.close();
      showScreen('join-screen');
      showConn(null);
      $('join-error').textContent =
        msg.reason === 'full'
          ? 'That game is full (4 players) or you were removed.'
          : msg.reason === 'in-progress'
            ? 'A race is in progress. Join when it ends.'
            : 'Version mismatch: reload both the TV page and this page.';
      break;
    case 'lobby': {
      lobby = msg.players;
      const me = lobby.find((p) => p.slot === mySlot);
      if (me) {
        ready = me.ready;
        myColor = me.color;
        applyPlayerColor();
        updateReadyButton();
      }
      updateSeriesUi(); // names may have changed ("Dana is choosing")
      break;
    }
    case 'phase':
      phase = msg.phase;
      // During the 3-2-1 countdown the wheel keeps re-centering, so wherever you
      // are holding the phone at GO is "straight ahead" (even if you just picked it up).
      recentering = phase === 'countdown';
      if (phase === 'lobby') phoneMap.clear();
      if (phase === 'lobby' || phase === 'results') ready = false;
      updateReadyButton();
      updatePickerVisibility();
      updateSeriesUi();
      break;
    case 'series': {
      const info = parseSeriesInfo(msg, MAX_TRACKS); // untrusted: ignore anything malformed
      if (info) {
        series = info;
        updateSeriesUi();
      }
      break;
    }
    case 'tracks': {
      // Cards arrive one per message; collect them by position (clamped, the host is not fully trusted either).
      const list = parseTrackCards(msg.list);
      const total = Number.isInteger(msg.total) ? Math.max(1, Math.min(MAX_TRACKS, msg.total)) : 0;
      if (list && total && Number.isInteger(msg.from) && msg.from >= 0 && msg.from + list.length <= total) {
        const next: TrackCard[] = trackCards && trackCards.length === total ? [...trackCards] : new Array<TrackCard>(total);
        list.forEach((c, i) => (next[msg.from + i] = c));
        trackCards = next;
        updateSeriesUi();
      }
      break;
    }
    case 'track':
      phoneMap.setTrack(msg.pts, msg.w, msg.map);
      break;
    case 'map':
      phoneMap.setDots(msg.d, (slot) => colorHex(lobby.find((p) => p.slot === slot)?.color ?? slot), mySlot);
      break;
    case 'status':
      $('position').textContent = msg.position ? ordinal(msg.position) : '–';
      $('lap').textContent = msg.lap ? `LAP ${msg.lap}/${msg.totalLaps}` : 'LAP –';
      itemView.set(msg.item);
      document.querySelector('.btn.item')!.classList.toggle('has-item', msg.item.kind !== 'none');
      break;
    case 'haptic':
      vibrate(msg.pattern);
      break;
    case 'drift': {
      // Glow the DRIFT button with the current spark color.
      const btn = document.querySelector('[data-button="DRIFT"]')!;
      btn.classList.remove('drift-t0', 'drift-t1', 'drift-t2');
      if (msg.tier !== null) btn.classList.add(`drift-t${msg.tier}`);
      break;
    }
    case 'ping':
      link?.sendEvent({ t: 'pong', id: msg.id, sentAt: msg.sentAt });
      break;
    case 'pong': {
      const rtt = performance.now() - msg.sentAt;
      rttMs = rttMs === null ? rtt : rttMs * 0.7 + rtt * 0.3;
      $('ping-chip').textContent = `${Math.round(rttMs)} ms`;
      break;
    }
  }
}

function ordinal(n: number): string {
  return n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
}

/** Build and send one input packet with the latest steering + buttons. */
function sendInput() {
  if (!link || !welcomed) return;
  let buttons = touch.buttons;
  if (performance.now() < trickUntil) buttons |= Buttons.TRICK;
  link.sendInput(encodeInput({ seq: seq++, steer: motion.steer, buttons }));
  sentThisSecond++;
}

// 60 Hz send loop. (setInterval keeps running even if no animation frames are drawn.)
let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  if (recentering) motion.calibrate();
  motion.tickFallback(now - lastTick);
  lastTick = now;
  sendInput();
}, 1000 / SEND_HZ);

// Once a second: ping, heartbeat check, stats.
setInterval(() => {
  sendRate = sentThisSecond;
  sentThisSecond = 0;
  if (!link) return;
  link.sendEvent({ t: 'ping', id: pingId++, sentAt: performance.now() });
  if (performance.now() - lastHostMsgAt > HOST_TIMEOUT_MS) link.close(); // -> reconnect
}, PING_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Steering wheel graphic + debug overlay (drawn every frame)
// ---------------------------------------------------------------------------
const wheel = $('wheel');
const debugEl = $('debug-overlay');
const stage = $('stage');
let stageRot = NaN;
let stageW = 0;
let stageH = 0;

/**
 * Rotate the controller to match how the phone is held. With rotation lock on,
 * the page stays portrait while you hold the phone sideways, so we turn the
 * whole stage 90 deg ourselves. Without the lock the browser has already turned
 * the page and the extra rotation works out to 0.
 */
let seenSideways = false;

function layoutStage() {
  const st = motion.steering;
  // The first time the phone is held sideways, lock the grip: from then on the
  // layout never moves (only the Flip 180 button can change it).
  if (motion.hasSensor && !st.gripLocked && st.grip !== null && !st.upright && lockTipDone) {
    st.gripLocked = true;
  }
  if (motion.hasSensor ? st.gripLocked : !isPortrait()) seenSideways = true;
  // Before the lock, show portrait (the "turn sideways" prompt is on top anyway).
  const rot = motion.hasSensor && st.gripLocked ? uiRotationDeg(st.grip, screenOrientationDeg()) : 0;
  const sideways = Math.abs(rot) === 90;
  const w = sideways ? window.innerHeight : window.innerWidth;
  const h = sideways ? window.innerWidth : window.innerHeight;
  if (rot !== stageRot || w !== stageW || h !== stageH) {
    stageRot = rot;
    stageW = w;
    stageH = h;
    stage.style.setProperty('--stage-rot', `${rot}deg`);
    stage.style.setProperty('--stage-w', `${w}px`);
    stage.style.setProperty('--stage-h', `${h}px`);
    stage.classList.toggle('rot90', rot === 90);
    stage.classList.toggle('rotm90', rot === -90);
    stage.classList.toggle('rot180', rot === 180);
    window.dispatchEvent(new Event('resize')); // let the item canvas re-measure
  }
  // "Turn your phone sideways" prompt: from the sensor if we have one, else from the window shape.
  // Only shown once, at the start; never again after the first time sideways.
  const needRotate = lockTipDone && !seenSideways;
  document.body.classList.toggle('need-rotate', needRotate);
}

function frame() {
  layoutStage();
  // The wheel graphic turns a little with the steering (40 deg at full lock: enough to read, not dizzying).
  wheel.style.transform = `rotate(${(motion.steer * 40).toFixed(1)}deg)`;
  if (prefs.showDebug) {
    debugEl.textContent =
      `ping ${rttMs === null ? '–' : rttMs.toFixed(0)} ms  send ${sendRate} Hz  motion ${motion.eventRateHz.toFixed(0)} Hz\n` +
      `angle ${motion.angleDeg.toFixed(1)}°  steer ${motion.steer.toFixed(3)}  orient ${motion.orientationDeg}°\n` +
      `sensor ${motion.hasSensor ? 'yes' : 'NO (use ←/→ keys)'}  pose ${motion.validPose ? 'ok' : 'too flat'}  ` +
      `cal ${motion.steering.isCalibrated ? 'yes' : 'no'}  btn ${touch.buttons.toString(2).padStart(5, '0')}
` +
      `grip ${motion.steering.grip ?? '–'}  ui rot ${stageRot}°  sign ${motion.steering.inverted ? 'inverted' : 'spec'}  ${isIOS() ? 'iOS' : ''}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------
const setName = $<HTMLInputElement>('set-name');
const setSens = $<HTMLInputElement>('set-sens');
const setAngle = $<HTMLInputElement>('set-angle');
const setInvert = $<HTMLInputElement>('set-invert');
const setDebug = $<HTMLInputElement>('set-debug');
let settingsColor = myColor;

function refreshSettingLabels() {
  $('sens-val').textContent = `${Number(setSens.value).toFixed(2)}×`;
  $('angle-val').textContent = `${setAngle.value}°`;
}
const drawSettingsSwatches = () =>
  renderSwatches($('set-colors'), settingsColor, (i) => {
    settingsColor = i;
    drawSettingsSwatches();
  });

function openSettings() {
  setName.value = prefs.name;
  setSens.value = String(prefs.steering.sensitivity);
  setAngle.value = String(prefs.steering.maxAngleDeg);
  setInvert.checked = prefs.steering.invert;
  setDebug.checked = prefs.showDebug;
  settingsColor = myColor;
  drawSettingsSwatches();
  refreshSettingLabels();
  $('settings-panel').classList.remove('hidden');
}

function applySettings() {
  prefs.steering.sensitivity = Number(setSens.value);
  prefs.steering.maxAngleDeg = Number(setAngle.value);
  prefs.steering.invert = setInvert.checked;
  prefs.showDebug = setDebug.checked;
  motion.steering.settings = { ...prefs.steering };
  debugEl.classList.toggle('hidden', !prefs.showDebug);
  refreshSettingLabels();
}

for (const el of [setSens, setAngle, setInvert, setDebug]) el.addEventListener('input', applySettings);
$('settings-btn').addEventListener('click', openSettings);
$('ping-chip').addEventListener('click', () => {
  prefs.showDebug = !prefs.showDebug;
  debugEl.classList.toggle('hidden', !prefs.showDebug);
  savePrefs(prefs);
});
$('flip-btn').addEventListener('click', () => {
  // Only needed if the controller shows upside down (sensor sign guessed wrong).
  motion.steering.toggleInverted();
  saveInverted(motion.steering.inverted);
  vibrate(20);
});
$('recenter-chip').addEventListener('click', () => {
  motion.calibrate();
  vibrate(20);
});
$('recenter-btn').addEventListener('click', () => {
  motion.calibrate();
  vibrate(20);
});
$('settings-close').addEventListener('click', () => {
  applySettings();
  const newName = sanitizeName(setName.value);
  const changed = newName !== prefs.name || settingsColor !== myColor;
  prefs.name = newName;
  prefs.color = settingsColor;
  savePrefs(prefs);
  if (changed) link?.sendEvent({ t: 'profile', name: prefs.name, color: prefs.color });
  $('settings-panel').classList.add('hidden');
});
debugEl.classList.toggle('hidden', !prefs.showDebug);

// ---------------------------------------------------------------------------
// Start: always show the join form first (a tap is needed for permissions,
// wake lock and fullscreen anyway). Room/name are prefilled.
// ---------------------------------------------------------------------------
showScreen('join-screen');
if (room && prefs.name) $<HTMLButtonElement>('join-btn').focus();
