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

export type ControllerToHost =
  // `loadout` is optional so phones from before the class system still work (the host then picks the default).
  | { t: 'hello'; v: number; clientId: string; name: string; color: number; loadout?: Loadout }
  | { t: 'profile'; name: string; color: number; loadout?: Loadout }
  | { t: 'ready'; ready: boolean }
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
  /** Drift state for the DRIFT button glow: null = not drifting, 0 = charging, 1 = blue, 2 = orange. */
  | { t: 'drift'; tier: number | null }
  | { t: 'ping'; id: number; sentAt: number }
  | { t: 'pong'; id: number; sentAt: number };

const CONTROLLER_TYPES = new Set(['hello', 'profile', 'ready', 'ping', 'pong']);
const HOST_TYPES = new Set(['welcome', 'reject', 'lobby', 'phase', 'status', 'haptic', 'track', 'map', 'drift', 'ping', 'pong']);

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
