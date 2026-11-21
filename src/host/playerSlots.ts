/**
 * The four player slots, and the rules for filling them. Pure logic (no DOM,
 * no network) so it can be unit tested.
 *
 * A slot remembers *who* owns it (a phone's persistent clientId, or a local
 * keyboard/gamepad), so when a phone drops and reconnects it gets the same slot
 * back - even mid-race.
 */
import { DEFAULT_LOADOUT, sanitizeLoadout, type Loadout } from '../shared/characters';
import { KART_COLORS, clampColorIndex } from '../shared/colors';
import type { GamePhase, LobbyPlayerInfo, SelectRequest } from '../shared/protocol';
import { sanitizeName } from '../shared/protocol';
import { canMoveStage, type SelectStage } from '../shared/selectStage';

export const MAX_PLAYERS = 4;

export type SlotOwner =
  | { kind: 'phone'; clientId: string }
  | { kind: 'keyboard'; scheme: number }
  | { kind: 'gamepad'; index: number }
  /** Computer driver (autopilot), handy for testing split-screen alone. */
  | { kind: 'bot'; id: number };

export interface PlayerSlot {
  index: number;
  owner: SlotOwner;
  name: string;
  color: number;
  connected: boolean;
  ready: boolean;
  /**
   * Where the player is in the name -> character -> kart -> ready flow. In the lobby, `ready` simply follows
   * "stage is 'ready'"; on the results screen `ready` means "race again" (see select()).
   */
  stage: SelectStage;
  /** Character + kart body. Kept with the slot, so it survives a phone reconnecting like name and colour do. */
  loadout: Loadout;
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
    case 'bot':
      return a.id === (b as typeof a).id;
  }
}

export class PlayerSlots {
  readonly slots: (PlayerSlot | null)[] = new Array(MAX_PLAYERS).fill(null);
  phase: GamePhase = 'lobby';
  /**
   * The results screen is "look only": Grand Prix between races and the final podium. Phones then cannot change
   * their pick or press READY (the host moves on by itself, see postRaceFlow.ts). Single race / Knockout / Loser
   * picks leave this false: there the results screen is where everybody chooses CHANGE or READY.
   */
  postLock = false;

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
  join(owner: SlotOwner, name: string, preferredColor: number, loadout?: unknown, stage: SelectStage = 'name'): JoinResult {
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
      stage,
      loadout: loadout === undefined ? { ...DEFAULT_LOADOUT } : sanitizeLoadout(loadout),
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

  setProfile(index: number, name: string, preferredColor: number, loadout?: unknown): void {
    const s = this.slots[index];
    if (!s) return;
    s.name = sanitizeName(name);
    s.color = this.pickColor(preferredColor, index);
    if (loadout !== undefined && this.canChangeLoadout()) s.loadout = sanitizeLoadout(loadout);
  }

  /** Characters and karts can only be changed between races (lobby and results, unless the results are locked), never during one. */
  canChangeLoadout(): boolean {
    return this.phase === 'lobby' || (this.phase === 'results' && !this.postLock);
  }

  /** A phone's READY button on the results screen: only for someone locked in at 'ready', and only while the results are not locked. */
  setPostReady(index: number, ready: boolean): boolean {
    const s = this.slots[index];
    if (!s || this.phase !== 'results' || this.postLock || s.stage !== 'ready') return false;
    s.ready = ready;
    return true;
  }

  /**
   * The race ended and the results are up: everybody is still locked in at 'ready' (that is what the TV shows),
   * but nobody has pressed READY for the next race yet. Computer drivers (lobby bots) are always ready.
   * `locked` = look-only results (see postLock).
   */
  beginResults(locked: boolean): void {
    this.phase = 'results';
    this.postLock = locked;
    for (const p of this.players) p.ready = p.owner.kind === 'bot';
  }

  /** Change a slot's loadout (ignored while a race is running). Returns true if it changed. */
  setLoadout(index: number, loadout: unknown): boolean {
    const s = this.slots[index];
    if (!s || !this.canChangeLoadout()) return false;
    s.loadout = sanitizeLoadout(loadout);
    return true;
  }

  /**
   * The pre-race flow. A player proposes a stage plus values (already shape-checked by parseSelect); we decide.
   *  - only between races (lobby / results), never during one;
   *  - forward one step at a time, back any distance (canMoveStage);
   *  - a value is only taken while its own step is current or being entered: the name at 'name', the character at
   *    'character', the kart at 'kart'. So a locked-in pick cannot be changed without first going back.
   * Returns true if anything changed.
   */
  select(index: number, req: SelectRequest): boolean {
    const s = this.slots[index];
    if (!s || !this.canChangeLoadout() || !canMoveStage(s.stage, req.stage)) return false;
    const at = (stage: SelectStage) => s.stage === stage || req.stage === stage;
    const before = `${s.stage}|${s.name}|${s.loadout.character}|${s.loadout.kart}`;
    if (req.name !== undefined && at('name')) s.name = sanitizeName(req.name);
    if (req.character !== undefined && at('character')) s.loadout = { ...s.loadout, character: req.character };
    if (req.kart !== undefined && at('kart')) s.loadout = { ...s.loadout, kart: req.kart };
    const wasReady = s.stage === 'ready';
    s.stage = req.stage;
    // Entering / leaving READY flips the ready flag (lobby: that IS the flag; results: "race again").
    if (!wasReady && s.stage === 'ready') s.ready = true;
    if (wasReady && s.stage !== 'ready') s.ready = false;
    return before !== `${s.stage}|${s.name}|${s.loadout.character}|${s.loadout.kart}`;
  }

  /** The race starts: every driver on the grid is locked in, so everyone counts as being at 'ready'. */
  lockInAll(): void {
    for (const p of this.players) p.stage = 'ready';
  }

  /** The race may start: everyone connected is ready and nobody still owes the mode / track choice (P1's pop-up comes first). */
  canStart(modeChoicePending: boolean): boolean {
    return this.phase === 'lobby' && !modeChoicePending && this.allReady();
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

  /** The next race is starting (or we are back in the lobby): the results lock is over. */
  endResultsLock(): void {
    this.postLock = false;
  }

  /** Back to lobby: clear ready flags and drop players who never came back. */
  resetToLobby(): void {
    this.phase = 'lobby';
    this.postLock = false;
    for (const p of this.players) {
      p.ready = p.stage === 'ready'; // picks are kept: whoever was locked in stays locked in
      if (!p.connected) this.remove(p.index);
    }
  }

  /** What phones are told about everybody. `winsOf` gives each slot's race wins (crowns); without it nobody has any. */
  lobbyInfo(winsOf?: (slot: PlayerSlot) => number): LobbyPlayerInfo[] {
    return this.players.map((p) => ({
      slot: p.index,
      name: p.name,
      color: p.color,
      connected: p.connected,
      ready: p.ready,
      stage: p.stage,
      loadout: { ...p.loadout },
      wins: winsOf?.(p) ?? 0,
    }));
  }
}
