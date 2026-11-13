/**
 * Wire protocol between the phone controllers and the host (TV).
 *
 * Two channels per phone:
 *  - "events": reliable + ordered, JSON messages (join, ready, item state, pings...).
 *    Think of it like TCP: every message arrives, in order.
 *  - "input": unreliable + unordered, tiny binary packets sent ~60x/second.
 *    Think of it like UDP: a late packet is useless (a newer one is already on
 *    the way), so we never wait for retransmissions. The host just keeps the
 *    packet with the highest sequence number.
 */

import type { Loadout } from './characters';
import type { MapData } from './mapDraw';

/** Bump when the message format changes incompatibly. */
export const PROTOCOL_VERSION = 1;

/** Button bitmask. Several buttons can be held at once: mask = GAS | DRIFT. */
export const Buttons = {
  GAS: 1 << 0,
  BRAKE: 1 << 1,
  DRIFT: 1 << 2,
  ITEM: 1 << 3,
  /** Pulsed for a few frames when the phone detects a flick/shake. */
  TRICK: 1 << 4,
} as const;
export type ButtonName = keyof typeof Buttons;
export const BUTTON_NAMES = Object.keys(Buttons) as ButtonName[];

/** One sample of a player's controls. steer: -1 (full left) .. +1 (full right). */
export interface ControlInput {
  steer: number;
  buttons: number;
}

export const NEUTRAL_INPUT: Readonly<ControlInput> = Object.freeze({ steer: 0, buttons: 0 });

export interface InputPacket extends ControlInput {
  /** Increments every packet; lets the host discard stale/out-of-order packets. */
  seq: number;
}

/**
 * Binary layout of an input packet (8 bytes, little-endian):
 *   [0..3] uint32 seq
 *   [4..5] int16  steer * 32767
 *   [6..7] uint16 buttons
 */
export const INPUT_PACKET_BYTES = 8;

export function encodeInput(p: InputPacket): ArrayBuffer {
  const buf = new ArrayBuffer(INPUT_PACKET_BYTES);
  const v = new DataView(buf);
  v.setUint32(0, p.seq >>> 0, true);
  const s = Math.max(-1, Math.min(1, Number.isFinite(p.steer) ? p.steer : 0));
  v.setInt16(4, Math.round(s * 32767), true);
  v.setUint16(6, p.buttons & 0xffff, true);
  return buf;
}

/** Returns null for anything that isn't a well-formed input packet. */
export function decodeInput(data: unknown): InputPacket | null {
  let view: DataView;
  if (data instanceof ArrayBuffer) view = new DataView(data);
  else if (ArrayBuffer.isView(data)) view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  else return null;
  if (view.byteLength < INPUT_PACKET_BYTES) return null;
  return {
    seq: view.getUint32(0, true),
    steer: view.getInt16(4, true) / 32767,
    buttons: view.getUint16(6, true),
  };
}

// ---------------------------------------------------------------------------
// Reliable "events" channel messages (JSON). `t` is the message type tag.
// ---------------------------------------------------------------------------

export type GamePhase = 'lobby' | 'countdown' | 'race' | 'results';

/** What the phone should show in its big item window. */
export type ItemDisplay =
  | { kind: 'none' }
  | { kind: 'roulette' }
  | { kind: 'item'; id: string; count: number };

export interface LobbyPlayerInfo {
  slot: number;
  name: string;
  color: number;
  connected: boolean;
  ready: boolean;
  /** Character + kart body (indices, see shared/characters.ts). Optional so older hosts still work; always run it through sanitizeLoadout. */
  loadout?: Loadout;
}

// --- Race modes (see src/host/series.ts) ---------------------------------------

export type SeriesMode = 'single' | 'gp' | 'loser';
export const SERIES_MODES: readonly SeriesMode[] = ['single', 'gp', 'loser'];

/** Phone input is untrusted: only these three words are modes. */
export function sanitizeMode(x: unknown): SeriesMode | null {
  return typeof x === 'string' && (SERIES_MODES as readonly string[]).includes(x) ? (x as SeriesMode) : null;
}

/** A valid index into a list of `count` tracks, or null (rejects NaN, fractions, strings, out of range). */
export function sanitizeTrackIndex(x: unknown, count: number): number | null {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < count ? x : null;
}

/** What a series message says the game is doing: the menu (lobby), racing, between races, or finished. */
export type SeriesStage = 'menu' | 'racing' | 'between' | 'over';
export const SERIES_STAGES: readonly SeriesStage[] = ['menu', 'racing', 'between', 'over'];

/** Menu + series state for phones. Sent to everybody whenever it changes. */
export interface SeriesInfo {
  mode: SeriesMode;
  /** Selected track (menu) or the current / next track (series), an index into the track list. */
  track: number;
  stage: SeriesStage;
  /** Slot that owns the menu (P1, or the next player if P1 left); null if nobody can. */
  owner: number | null;
  /** Loser picks, stage 'between': the slot that must choose the next track. */
  picker: number | null;
  racesDone: number;
  /** Grand Prix length, or null. */
  raceTotal: number | null;
  /** Ranked standings, flat [slot, points, slot, points, ...]; empty in single races. */
  standings: number[];
  /**
   * Stage 'menu' only: nobody has made this round's mode / track choice yet, so the owner's phone shows
   * its forced pop-up (see src/shared/forcedChoice.ts). Optional: hosts from before the pop-up leave it out (= false).
   */
  pending?: boolean;
}

/** One track card for the phone menu. `img` is a small PNG data URL drawn by the host. */
export interface TrackCard {
  name: string;
  laps: number;
  /** Lap length in km. */
  km: number;
  img: string;
}

const IMG_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMG_CHARS = 60000;
/** Upper bound on the track list the protocol will carry (the phone does not know the real count, the host checks that). */
export const MAX_TRACKS = 16;

/** Keep only well-formed cards (the phone puts `img` into an <img src>, so the format is checked strictly). */
export function parseTrackCards(list: unknown): TrackCard[] | null {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_TRACKS) return null;
  const out: TrackCard[] = [];
  for (const c of list) {
    if (typeof c !== 'object' || c === null) return null;
    const { name, laps, km, img } = c as Record<string, unknown>;
    if (typeof name !== 'string' || typeof laps !== 'number' || typeof km !== 'number') return null;
    if (typeof img !== 'string' || img.length > MAX_IMG_CHARS || !IMG_URL.test(img)) return null;
    out.push({ name: name.slice(0, 24), laps: Math.max(0, Math.min(99, Math.round(laps))), km: Math.max(0, Math.min(99, km)), img });
  }
  return out;
}

/** Validate a SeriesInfo from the host (the phone shows it, so keep it strict). Returns a clean copy or null. */
export function parseSeriesInfo(m: unknown, trackCount: number): SeriesInfo | null {
  if (typeof m !== 'object' || m === null) return null;
  const o = m as Record<string, unknown>;
  const mode = sanitizeMode(o.mode);
  const track = sanitizeTrackIndex(o.track, trackCount);
  if (!mode || track === null) return null;
  if (typeof o.stage !== 'string' || !(SERIES_STAGES as readonly string[]).includes(o.stage)) return null;
  const slotOrNull = (x: unknown) => (x === null ? null : sanitizeTrackIndex(x, 4));
  const owner = slotOrNull(o.owner);
  const picker = slotOrNull(o.picker);
  if ((o.owner !== null && owner === null) || (o.picker !== null && picker === null)) return null;
  if (!Array.isArray(o.standings) || o.standings.length > 8 || o.standings.length % 2 !== 0) return null;
  if (!o.standings.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const racesDone = typeof o.racesDone === 'number' && Number.isInteger(o.racesDone) ? o.racesDone : null;
  const raceTotal = o.raceTotal === null ? null : typeof o.raceTotal === 'number' && Number.isInteger(o.raceTotal) ? o.raceTotal : undefined;
  if (racesDone === null || raceTotal === undefined) return null;
  if (o.pending !== undefined && typeof o.pending !== 'boolean') return null;
  return { mode, track, stage: o.stage as SeriesStage, owner, picker, racesDone, raceTotal, standings: o.standings as number[], ...(o.pending ? { pending: true } : {}) };
}

export type ControllerToHost =
  // `loadout` is optional so phones from before the class system still work (the host then picks the default).
  | { t: 'hello'; v: number; clientId: string; name: string; color: number; loadout?: Loadout }
  | { t: 'profile'; name: string; color: number; loadout?: Loadout }
  | { t: 'ready'; ready: boolean }
  /** Menu owner only (lobby): choose the mode and/or the track. The host validates both fields. */
  /** `done: true` = the owner finished the forced pop-up (mode and, where it matters, track): the host then stops waiting for them. */
  | { t: 'setup'; mode?: SeriesMode; track?: number; done?: boolean }
  /** Loser picks: the chosen player names the next track. Ignored from anybody else. */
  | { t: 'pick'; track: number }
  /** Menu owner only: back to the menu after a race ('menu'), or finish a series now ('stop'). Anyone who may choose a track asks for the preview cards with 'cards'. */
  | { t: 'series'; act: 'menu' | 'stop' | 'cards' }
  | { t: 'ping'; id: number; sentAt: number }
  | { t: 'pong'; id: number; sentAt: number };

export type HostToController =
  | { t: 'welcome'; slot: number; name: string; color: number; ready: boolean; phase: GamePhase; loadout?: Loadout }
  | { t: 'reject'; reason: 'full' | 'in-progress' | 'version' }
  | { t: 'lobby'; players: LobbyPlayerInfo[] }
  | { t: 'phase'; phase: GamePhase }
  | {
      t: 'status';
      /** 1-based race position, or null when not racing. */
      position: number | null;
      lap: number | null;
      totalLaps: number;
      item: ItemDisplay;
    }
  | { t: 'haptic'; pattern: number[] }
  /**
   * Track outline for the phone's minimap: flat [x, z, x, z, …] along the centerline, road width `w` (m).
   * `map` (optional, so older hosts still work) is the full picture: roads with heights, bridges, cliffs,
   * cannons, gaps (see shared/mapDraw.ts). Phones fall back to `pts` when it is missing or malformed.
   */
  | { t: 'track'; pts: number[]; w: number; map?: MapData }
  /** Kart positions for the minimap: flat [slot, x, z, slot, x, z, …], sent ~8x/second. */
  | { t: 'map'; d: number[] }
  /** Mode, selected track, standings, who chooses (see SeriesInfo). Run it through parseSeriesInfo. */
  | ({ t: 'series' } & SeriesInfo)
  /** Track cards with preview images for the menu (only sent to the phone that owns / picks). One card per message, because the message channel caps a message at ~16 KB: `from` = index of the first card in `list`, `total` = number of tracks. Run `list` through parseTrackCards. */
  | { t: 'tracks'; from: number; total: number; list: TrackCard[] }
  /** Drift state for the DRIFT button glow: null = not drifting, 0 = charging, 1 = blue, 2 = orange. */
  | { t: 'drift'; tier: number | null }
  | { t: 'ping'; id: number; sentAt: number }
  | { t: 'pong'; id: number; sentAt: number };

const CONTROLLER_TYPES = new Set(['hello', 'profile', 'ready', 'setup', 'pick', 'series', 'ping', 'pong']);
const HOST_TYPES = new Set(['welcome', 'reject', 'lobby', 'phase', 'status', 'haptic', 'track', 'map', 'series', 'tracks', 'drift', 'ping', 'pong']);

/** Validate a phone's `setup` message. Bad fields are dropped; returns null if nothing valid is left. */
export function parseSetup(m: unknown, trackCount: number): { mode?: SeriesMode; track?: number; done?: true } | null {
  if (typeof m !== 'object' || m === null) return null;
  const mode = sanitizeMode((m as { mode?: unknown }).mode);
  const track = sanitizeTrackIndex((m as { track?: unknown }).track, trackCount);
  const done = (m as { done?: unknown }).done === true;
  if (!mode && track === null && !done) return null;
  return { ...(mode ? { mode } : {}), ...(track !== null ? { track } : {}), ...(done ? { done: true as const } : {}) };
}

/** Validate a phone's `series` action. */
export function parseSeriesAct(m: unknown): 'menu' | 'stop' | 'cards' | null {
  const act = typeof m === 'object' && m !== null ? (m as { act?: unknown }).act : null;
  return act === 'menu' || act === 'stop' || act === 'cards' ? act : null;
}

/** Cheap structural check; data from the network is untrusted. */
export function isControllerMessage(m: unknown): m is ControllerToHost {
  return typeof m === 'object' && m !== null && CONTROLLER_TYPES.has((m as { t?: unknown }).t as string);
}

export function isHostMessage(m: unknown): m is HostToController {
  if (typeof m !== 'object' || m === null || !HOST_TYPES.has((m as { t?: unknown }).t as string)) return false;
  // A track message needs its outline; the optional rich `map` is checked by the phone (isMapData),
  // which falls back to the outline, so a bad `map` never loses the whole message.
  if ((m as { t: string }).t === 'track') {
    const { pts, w } = m as { pts?: unknown; w?: unknown };
    return Array.isArray(pts) && typeof w === 'number';
  }
  return true;
}

/** Trim and limit player names so a phone can't break the TV layout. */
export function sanitizeName(name: unknown): string {
  const s = typeof name === 'string' ? name : '';
  // eslint-disable-next-line no-control-regex
  const cleaned = s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 12);
  return cleaned || 'Player';
}
