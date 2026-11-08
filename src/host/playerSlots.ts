/**
 * The four player slots, and the rules for filling them. Pure logic (no DOM,
 * no network) so it can be unit tested.
 *
 * A slot remembers *who* owns it (a phone's persistent clientId, or a local
 * keyboard/gamepad), so when a phone drops and reconnects it gets the same slot
 * back - even mid-race.
 */
import { KART_COLORS, clampColorIndex } from '../shared/colors';
import type { GamePhase, LobbyPlayerInfo } from '../shared/protocol';
import { sanitizeName } from '../shared/protocol';

export const MAX_PLAYERS = 4;

export type SlotOwner =
  | { kind: 'phone'; clientId: string }
  | { kind: 'keyboard'; scheme: number }
  | { kind: 'gamepad'; index: number };

export interface PlayerSlot {
  index: number;
  owner: SlotOwner;
  name: string;
  color: number;
  connected: boolean;
  ready: boolean;
}

export type JoinResult =
  | { ok: true; slot: PlayerSlot; rejoined: boolean }
  | { ok: false; reason: 'full' | 'in-progress' };

function sameOwner(a: SlotOwner, b: SlotOwner): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'phone':
      return a.clientId === (b as typeof a).clientId;
    case 'keyboard':
      return a.scheme === (b as typeof a).scheme;
    case 'gamepad':
      return a.index === (b as typeof a).index;
  }
}

export class PlayerSlots {
  readonly slots: (PlayerSlot | null)[] = new Array(MAX_PLAYERS).fill(null);
  phase: GamePhase = 'lobby';

  find(owner: SlotOwner): PlayerSlot | null {
    return this.slots.find((s) => s && sameOwner(s.owner, owner)) ?? null;
  }

  /** All occupied slots, in slot order. */
  get players(): PlayerSlot[] {
    return this.slots.filter((s): s is PlayerSlot => s !== null);
  }

  /**
   * Add a player, or re-attach a returning one to their old slot.
   * New players may only join in the lobby; returning players can rejoin any time.
   */
  join(owner: SlotOwner, name: string, preferredColor: number): JoinResult {
    const existing = this.find(owner);
    if (existing) {
      existing.connected = true;
      return { ok: true, slot: existing, rejoined: true };
    }
    if (this.phase !== 'lobby') return { ok: false, reason: 'in-progress' };
    const index = this.slots.findIndex((s) => s === null);
    if (index < 0) return { ok: false, reason: 'full' };
    const slot: PlayerSlot = {
      index,
      owner,
      name: sanitizeName(name),
      color: this.pickColor(preferredColor, index),
      connected: true,
      ready: false,
    };
    this.slots[index] = slot;
    return { ok: true, slot, rejoined: false };
  }

  /** Phone went away. Keep the slot reserved so the same phone can come back. */
  markDisconnected(index: number): void {
    const s = this.slots[index];
    if (s) s.connected = false;
  }

  /** Remove a player entirely (lobby kick / local player leaving). */
  remove(index: number): void {
    this.slots[index] = null;
  }

  setReady(index: number, ready: boolean): void {
    const s = this.slots[index];
    if (s) s.ready = ready;
  }

  setProfile(index: number, name: string, preferredColor: number): void {
    const s = this.slots[index];
    if (!s) return;
    s.name = sanitizeName(name);
    s.color = this.pickColor(preferredColor, index);
  }

  /**
   * Colors are unique: use the preferred one if nobody else has it,
   * otherwise the first free one.
   */
  pickColor(preferred: number, forSlot: number): number {
    const taken = new Set(this.players.filter((p) => p.index !== forSlot).map((p) => p.color));
    const want = clampColorIndex(preferred);
    if (!taken.has(want)) return want;
    for (let i = 0; i < KART_COLORS.length; i++) if (!taken.has(i)) return i;
    return want;
  }

  /** True when at least one player is connected and every connected player is ready. */
  allReady(): boolean {
    const connected = this.players.filter((p) => p.connected);
    return connected.length > 0 && connected.every((p) => p.ready);
  }

  /** Back to lobby: clear ready flags and drop players who never came back. */
  resetToLobby(): void {
    this.phase = 'lobby';
    for (const p of this.players) {
      p.ready = false;
      if (!p.connected) this.remove(p.index);
    }
  }

  lobbyInfo(): LobbyPlayerInfo[] {
    return this.players.map((p) => ({
      slot: p.index,
      name: p.name,
      color: p.color,
      connected: p.connected,
      ready: p.ready,
    }));
  }
}
