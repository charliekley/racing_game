/**
 * Owns everything about "who is playing and what are they pressing":
 *  - the PlayerSlots (lobby state),
 *  - phone connections (handshake, input packets, pings, heartbeats, rejoin),
 *  - local keyboard/gamepad players.
 *
 * The game simulation (later milestones) only calls `inputFor(slot)` once per
 * tick and always gets the *latest* input, whatever device it came from.
 */
import {
  Buttons,
  NEUTRAL_INPUT,
  PROTOCOL_VERSION,
  decodeInput,
  isControllerMessage,
  type ControlInput,
  type ControllerToHost,
  type GamePhase,
  type HostToController,
} from '../shared/protocol';
import type { HostTransport, Link } from '../shared/net/transport';
import { CHARACTERS, KART_BODIES } from '../shared/characters';
import { botLoadoutFor } from '../sim/classes';
import { Signal } from '../shared/signal';
import { MAX_PLAYERS, PlayerSlots, type PlayerSlot } from './playerSlots';
import {
  KEY_CHARACTER,
  KEY_JOIN,
  KEY_KART,
  KEY_SCHEMES,
  KeyboardPlayerInput,
  KeyboardState,
  connectedGamepads,
  gamepadWantsJoin,
  padLoadoutButtons,
  readGamepad,
} from './input/localInput';

/** A phone that hasn't sent anything for this long is considered gone. */
const HEARTBEAT_TIMEOUT_MS = 3000;
const PING_INTERVAL_MS = 1000;
/** Close links that never introduce themselves. */
const HELLO_TIMEOUT_MS = 5000;

export interface InputStats {
  /** Packets per second received (measured over the last second). */
  rateHz: number;
  /** Packets that never arrived (gaps in sequence numbers), total. */
  lost: number;
  /** Packets that arrived after a newer one and were ignored, total. */
  stale: number;
  lastSeq: number;
  /** performance.now() of the last input packet. */
  lastPacketAt: number;
}

interface PhoneSession {
  link: Link;
  clientId: string | null;
  slotIndex: number | null;
  latest: ControlInput;
  stats: InputStats;
  packetsThisSecond: number;
  lastHeardAt: number;
  rttMs: number | null;
  nextPingId: number;
}

export class PlayerManager {
  readonly slots = new PlayerSlots();
  /** Fires whenever lobby-visible state changes (joins, leaves, ready, names...). */
  readonly onLobbyChange = new Signal<void>();

  private sessions = new Set<PhoneSession>();
  private sessionBySlot = new Map<number, PhoneSession>();
  private localInputs = new Map<number, ControlInput>();
  private keyboards: (KeyboardPlayerInput | null)[] = KEY_SCHEMES.map(() => null);
  private prevLocalButtons = new Map<number, number>();
  private padJoinHeld = new Set<number>();
  /** D-pad buttons held last frame per gamepad slot (bit 1 left, 2 right, 4 down), for edge detection. */
  private padHeld = new Map<number, number>();

  constructor(
    transport: HostTransport,
    private readonly keys: KeyboardState,
  ) {
    transport.onLink.add((link) => this.acceptLink(link));
    setInterval(() => this.housekeeping(), 250);
  }

  // -------------------------------------------------------------------------
  // Queries used by the UI / simulation
  // -------------------------------------------------------------------------

  /** Latest controls for a slot. Disconnected players get neutral input (kart coasts). */
  inputFor(slotIndex: number): ControlInput {
    const slot = this.slots.slots[slotIndex];
    if (!slot || !slot.connected) return NEUTRAL_INPUT;
    if (slot.owner.kind === 'phone') return this.sessionBySlot.get(slotIndex)?.latest ?? NEUTRAL_INPUT;
    return this.localInputs.get(slotIndex) ?? NEUTRAL_INPUT;
  }

  phoneStats(slotIndex: number): { stats: InputStats; rttMs: number | null } | null {
    const s = this.sessionBySlot.get(slotIndex);
    return s ? { stats: s.stats, rttMs: s.rttMs } : null;
  }

  /** Send a reliable message to the phone in a slot (no-op for local players). */
  sendTo(slotIndex: number, msg: HostToController): void {
    this.sessionBySlot.get(slotIndex)?.link.sendEvent(msg);
  }

  broadcast(msg: HostToController): void {
    for (const s of this.sessionBySlot.values()) s.link.sendEvent(msg);
  }

  /** Track outline for the phones' minimaps; re-sent to phones that (re)join mid-race. */
  private trackMsg: HostToController | null = null;

  setTrackMessage(msg: HostToController | null): void {
    this.trackMsg = msg;
    if (msg) this.broadcast(msg);
  }

  /** Menu / series messages from phones (setup, pick, series). The sender's slot is attached; SeriesHost validates and decides. */
  readonly onMenuMessage = new Signal<{ slot: number; msg: ControllerToHost }>();

  /** Latest series state for phones, re-sent to phones that (re)join. */
  private seriesMsg: HostToController | null = null;

  setSeriesMessage(msg: HostToController): void {
    this.seriesMsg = msg;
    this.broadcast(msg);
  }

  setPhase(phase: GamePhase): void {
    this.slots.phase = phase;
    if (phase === 'lobby') {
      this.slots.resetToLobby();
      this.trackMsg = null;
    }
    // Results screen: "ready" now means "race again", so everyone starts un-ready.
    if (phase === 'results') for (const p of this.slots.players) p.ready = false;
    this.readyBots();
    this.broadcast({ t: 'phase', phase });
    this.lobbyChanged();
  }

  /** A player was removed from their slot (kicked / left). */
  readonly onRemoved = new Signal<number>();

  kick(slotIndex: number): void {
    const s = this.sessionBySlot.get(slotIndex);
    this.sessionBySlot.delete(slotIndex);
    if (s) {
      s.slotIndex = null;
      s.link.sendEvent({ t: 'reject', reason: 'full' });
      s.link.close();
    }
    const slot = this.slots.slots[slotIndex];
    if (slot?.owner.kind === 'keyboard') this.keyboards[slot.owner.scheme] = null;
    this.slots.remove(slotIndex);
    this.localInputs.delete(slotIndex);
    this.onRemoved.emit(slotIndex);
    this.lobbyChanged();
  }

  isBot(slotIndex: number): boolean {
    return this.slots.slots[slotIndex]?.owner.kind === 'bot';
  }

  /** Add a computer driver (lobby only). Bots are always ready. */
  addBot(): boolean {
    if (this.slots.phase !== 'lobby') return false;
    let id = 1;
    while (this.slots.find({ kind: 'bot', id })) id++;
    const r = this.slots.join({ kind: 'bot', id }, `Bot ${id}`, id + 3);
    if (!r.ok) return false;
    r.slot.loadout = botLoadoutFor(r.slot.index); // varied but fixed per slot
    r.slot.ready = true;
    this.lobbyChanged();
    return true;
  }

  /** Step a local player's character (or kart body) forwards/backwards through the lists. */
  private cycleLoadout(slotIndex: number, what: 'character' | 'kart', dir = 1): void {
    const slot = this.slots.slots[slotIndex];
    if (!slot) return;
    const n = what === 'character' ? CHARACTERS.length : KART_BODIES.length;
    const next = { ...slot.loadout, [what]: (slot.loadout[what] + dir + n) % n };
    if (this.slots.setLoadout(slotIndex, next)) this.lobbyChanged();
  }

  private readyBots(): void {
    for (const p of this.slots.players) if (p.owner.kind === 'bot') p.ready = true;
  }

  /** Attach keyboard controls for a scheme (used by the ?drive dev shortcut). */
  addKeyboardInput(scheme: number): void {
    this.keyboards[scheme] = new KeyboardPlayerInput(this.keys, KEY_SCHEMES[scheme]);
  }

  // -------------------------------------------------------------------------
  // Local players (keyboard / gamepad). Call once per rendered frame.
  // -------------------------------------------------------------------------

  updateLocal(dtSec: number): void {
    const pressed = this.keys.consumePressed();
    const inLobby = this.slots.phase === 'lobby';
    const canReady = inLobby || this.slots.phase === 'results';

    // Join / leave with keys 1 and 2.
    KEY_JOIN.forEach((code, scheme) => {
      if (!pressed.has(code) || !inLobby) return;
      const existing = this.slots.find({ kind: 'keyboard', scheme });
      if (existing) {
        this.kick(existing.index);
      } else {
        const r = this.slots.join({ kind: 'keyboard', scheme }, `Keys ${KEY_SCHEMES[scheme].label}`, scheme + 2);
        if (r.ok) {
          this.keyboards[scheme] = new KeyboardPlayerInput(this.keys, KEY_SCHEMES[scheme]);
          this.lobbyChanged();
        }
      }
    });

    // Keyboard players pick their driver and kart with two keys each (lobby only; the race locks it in).
    for (const slot of this.slots.players) {
      if (slot.owner.kind !== 'keyboard' || !inLobby) continue;
      const { scheme } = slot.owner;
      if (pressed.has(KEY_CHARACTER[scheme])) this.cycleLoadout(slot.index, 'character');
      if (pressed.has(KEY_KART[scheme])) this.cycleLoadout(slot.index, 'kart');
    }

    // B adds a bot.
    if (pressed.has('KeyB') && inLobby) this.addBot();

    // Gamepads: press Start/A to join.
    for (const pad of connectedGamepads()) {
      const wants = gamepadWantsJoin(pad);
      if (wants && !this.padJoinHeld.has(pad.index) && inLobby && !this.slots.find({ kind: 'gamepad', index: pad.index })) {
        const r = this.slots.join({ kind: 'gamepad', index: pad.index }, `Pad ${pad.index + 1}`, pad.index + 4);
        if (r.ok) {
          this.padHeld.set(r.slot.index, 0);
          this.prevLocalButtons.set(r.slot.index, Buttons.GAS); // don't count this press as "ready"
          this.lobbyChanged();
        }
      }
      if (wants) this.padJoinHeld.add(pad.index);
      else this.padJoinHeld.delete(pad.index);
    }

    // Read inputs for every local player.
    const pads = new Map(connectedGamepads().map((p) => [p.index, p]));
    for (const slot of this.slots.players) {
      let input: ControlInput | null = null;
      if (slot.owner.kind === 'keyboard') {
        input = this.keyboards[slot.owner.scheme]?.update(dtSec) ?? null;
      } else if (slot.owner.kind === 'gamepad') {
        const pad = pads.get(slot.owner.index);
        const wasConnected = slot.connected;
        slot.connected = !!pad;
        if (wasConnected !== slot.connected) this.lobbyChanged();
        input = pad ? readGamepad(pad) : null;
        // D-pad left/right = previous/next driver, D-pad down = next kart (edge-triggered, lobby only).
        if (pad && inLobby) {
          const dpad = padLoadoutButtons(pad);
          const was = this.padHeld.get(slot.index) ?? 0;
          if (dpad & ~was & 1) this.cycleLoadout(slot.index, 'character', -1);
          if (dpad & ~was & 2) this.cycleLoadout(slot.index, 'character', 1);
          if (dpad & ~was & 4) this.cycleLoadout(slot.index, 'kart');
          this.padHeld.set(slot.index, dpad);
        }
      }
      if (!input) continue;
      this.localInputs.set(slot.index, input);

      // In the lobby, the ITEM button toggles ready for local players.
      const prev = this.prevLocalButtons.get(slot.index) ?? 0;
      if (canReady && input.buttons & Buttons.ITEM && !(prev & Buttons.ITEM)) {
        this.slots.setReady(slot.index, !slot.ready);
        this.lobbyChanged();
      }
      this.prevLocalButtons.set(slot.index, input.buttons);
    }
  }

  // -------------------------------------------------------------------------
  // Phones
  // -------------------------------------------------------------------------

  private acceptLink(link: Link): void {
    const now = performance.now();
    const session: PhoneSession = {
      link,
      clientId: null,
      slotIndex: null,
      latest: { ...NEUTRAL_INPUT },
      stats: { rateHz: 0, lost: 0, stale: 0, lastSeq: -1, lastPacketAt: 0 },
      packetsThisSecond: 0,
      lastHeardAt: now,
      rttMs: null,
      nextPingId: 1,
    };
    this.sessions.add(session);

    link.onEvent.add((msg) => {
      session.lastHeardAt = performance.now();
      if (isControllerMessage(msg)) this.handleMessage(session, msg);
    });
    link.onInput.add((data) => {
      session.lastHeardAt = performance.now();
      this.handleInput(session, data);
    });
    link.onClose.add(() => this.handleClose(session));
  }

  private handleMessage(session: PhoneSession, msg: ControllerToHost): void {
    switch (msg.t) {
      case 'hello': {
        if (msg.v !== PROTOCOL_VERSION) {
          session.link.sendEvent({ t: 'reject', reason: 'version' });
          return;
        }
        if (typeof msg.clientId !== 'string' || !msg.clientId) return;
        const result = this.slots.join({ kind: 'phone', clientId: msg.clientId }, msg.name, msg.color, msg.loadout);
        if (!result.ok) {
          session.link.sendEvent({ t: 'reject', reason: result.reason });
          setTimeout(() => session.link.close(), 500);
          return;
        }
        const slot = result.slot;
        // Same phone reconnected while the old link hadn't timed out yet: drop the old one.
        const old = this.sessionBySlot.get(slot.index);
        if (old && old !== session) {
          old.slotIndex = null;
          old.link.close();
        }
        session.clientId = msg.clientId;
        session.slotIndex = slot.index;
        this.sessionBySlot.set(slot.index, session);
        if (!result.rejoined) this.slots.setProfile(slot.index, msg.name, msg.color, msg.loadout);
        session.link.sendEvent(this.welcomeFor(slot));
        if (this.trackMsg && this.slots.phase !== 'lobby') session.link.sendEvent(this.trackMsg);
        if (this.seriesMsg) session.link.sendEvent(this.seriesMsg);
        this.lobbyChanged();
        return;
      }
      case 'profile':
        if (session.slotIndex === null) return;
        this.slots.setProfile(session.slotIndex, msg.name, msg.color, msg.loadout);
        this.sendTo(session.slotIndex, this.welcomeFor(this.slots.slots[session.slotIndex]!));
        this.lobbyChanged();
        return;
      case 'ready':
        if (session.slotIndex === null || (this.slots.phase !== 'lobby' && this.slots.phase !== 'results')) return;
        this.slots.setReady(session.slotIndex, !!msg.ready);
        this.lobbyChanged();
        return;
      case 'setup':
      case 'pick':
      case 'series':
        // Only phones that already joined can send these; SeriesHost checks the sender's role and the values.
        if (session.slotIndex !== null) this.onMenuMessage.emit({ slot: session.slotIndex, msg });
        return;
      case 'ping':
        session.link.sendEvent({ t: 'pong', id: msg.id, sentAt: msg.sentAt });
        return;
      case 'pong': {
        const rtt = performance.now() - msg.sentAt;
        if (rtt >= 0 && rtt < 10000) {
          // Exponential moving average so the readout doesn't flicker.
          session.rttMs = session.rttMs === null ? rtt : session.rttMs * 0.7 + rtt * 0.3;
        }
        return;
      }
    }
  }

  private handleInput(session: PhoneSession, data: ArrayBuffer): void {
    if (session.slotIndex === null) return;
    const pkt = decodeInput(data);
    if (!pkt) return;
    const st = session.stats;
    if (pkt.seq <= st.lastSeq) {
      st.stale++; // arrived late; we already have something newer
      return;
    }
    if (st.lastSeq >= 0) st.lost += pkt.seq - st.lastSeq - 1;
    st.lastSeq = pkt.seq;
    st.lastPacketAt = performance.now();
    session.packetsThisSecond++;
    session.latest = { steer: pkt.steer, buttons: pkt.buttons };
  }

  private handleClose(session: PhoneSession): void {
    this.sessions.delete(session);
    const idx = session.slotIndex;
    if (idx === null || this.sessionBySlot.get(idx) !== session) return;
    this.sessionBySlot.delete(idx);
    this.slots.markDisconnected(idx);
    this.lobbyChanged();
  }

  private welcomeFor(slot: PlayerSlot): HostToController {
    return { t: 'welcome', slot: slot.index, name: slot.name, color: slot.color, ready: slot.ready, phase: this.slots.phase, loadout: { ...slot.loadout } };
  }

  private lastSecond = performance.now();
  private lastPing = 0;

  private housekeeping(): void {
    const now = performance.now();
    for (const s of [...this.sessions]) {
      const limit = s.clientId ? HEARTBEAT_TIMEOUT_MS : HELLO_TIMEOUT_MS;
      if (now - s.lastHeardAt > limit) s.link.close(); // -> handleClose
    }
    if (now - this.lastSecond >= 1000) {
      const secs = (now - this.lastSecond) / 1000;
      for (const s of this.sessions) {
        s.stats.rateHz = s.packetsThisSecond / secs;
        s.packetsThisSecond = 0;
      }
      this.lastSecond = now;
    }
    if (now - this.lastPing >= PING_INTERVAL_MS) {
      this.lastPing = now;
      for (const s of this.sessionBySlot.values()) s.link.sendEvent({ t: 'ping', id: s.nextPingId++, sentAt: now });
    }
  }

  private lobbyChanged(): void {
    this.broadcast({ t: 'lobby', players: this.slots.lobbyInfo() });
    this.onLobbyChange.emit();
  }
}

export { MAX_PLAYERS };
