/**
 * PeerJS implementation of the transport interfaces.
 *
 * Web concepts:
 *  - WebRTC lets two browsers talk directly (peer-to-peer). To *find* each
 *    other they need a "signaling" server to exchange connection offers once;
 *    after that, data flows directly between the devices (over your home LAN
 *    when both are on the same Wi-Fi). PeerJS wraps WebRTC and provides a free
 *    public signaling server (0.peerjs.com).
 *  - A "data channel" is a message pipe inside a WebRTC connection. Each one can
 *    be configured as reliable (TCP-like) or unreliable (UDP-like).
 *
 * PeerJS's `reliable: false` option only makes a channel *unordered*, it still
 * retransmits lost packets. For real UDP-like behaviour we open our own extra
 * "negotiated" data channel on the same RTCPeerConnection with
 * maxRetransmits: 0. "Negotiated" means both sides create it with an agreed
 * numeric id, so it doesn't interfere with PeerJS's own channel handling.
 */
import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import { Signal } from '../signal';
import { peerIdForRoom } from '../roomCode';
import {
  RoomNotFoundError,
  RoomTakenError,
  type ControllerTransport,
  type HostStatus,
  type HostTransport,
  type Link,
} from './transport';

/** Id of our extra unreliable channel; must match on both sides. */
const INPUT_CHANNEL_ID = 42;

/**
 * Options passed to every Peer. Swap `host`/`port`/`path` here to use a
 * self-hosted PeerJS server (`npx peer --port 9000`) instead of the public one.
 */
const PEER_OPTIONS: PeerOptions = {
  debug: 1, // 0 = silent, 3 = verbose (handy when debugging connection issues)
};

class PeerLink implements Link {
  readonly onEvent = new Signal<unknown>();
  readonly onInput = new Signal<ArrayBuffer>();
  readonly onClose = new Signal<void>();
  private inputChannel: RTCDataChannel | null = null;
  private closed = false;

  constructor(private readonly conn: DataConnection) {
    conn.on('data', (d) => this.onEvent.emit(d));
    conn.on('close', () => this.close());
    conn.on('error', () => this.close());

    const pc = conn.peerConnection;
    if (pc) {
      try {
        const ch = pc.createDataChannel('input', {
          negotiated: true,
          id: INPUT_CHANNEL_ID,
          ordered: false,
          maxRetransmits: 0,
        });
        ch.binaryType = 'arraybuffer';
        ch.onmessage = (e) => {
          if (e.data instanceof ArrayBuffer) this.onInput.emit(e.data);
        };
        this.inputChannel = ch;
      } catch (err) {
        console.warn('Could not create unreliable input channel', err);
      }
      // Detect hard network failures quickly (PeerJS only watches ICE state).
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.close();
      });
    }
  }

  get isOpen(): boolean {
    return !this.closed && this.conn.open;
  }

  sendEvent(msg: object): void {
    if (!this.isOpen) return;
    try {
      this.conn.send(msg);
    } catch (err) {
      console.warn('sendEvent failed', err);
    }
  }

  sendInput(packet: ArrayBuffer): void {
    const ch = this.inputChannel;
    if (this.closed || !ch || ch.readyState !== 'open') return;
    // If the channel is backed up (bad Wi-Fi), drop this packet; a newer one comes in 16 ms.
    if (ch.bufferedAmount > 1024) return;
    try {
      ch.send(packet);
    } catch {
      /* ignore: unreliable by design */
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.inputChannel?.close();
    } catch {
      /* ignore */
    }
    try {
      this.conn.close();
    } catch {
      /* ignore */
    }
    this.onClose.emit();
    this.onEvent.clear();
    this.onInput.clear();
    this.onClose.clear();
  }
}

export class PeerHostTransport implements HostTransport {
  readonly onLink = new Signal<Link>();
  readonly onStatus = new Signal<HostStatus>();
  private peer: Peer | null = null;
  private destroyed = false;

  start(roomCode: string): Promise<void> {
    this.peer?.destroy();
    return new Promise((resolve, reject) => {
      const peer = new Peer(peerIdForRoom(roomCode), PEER_OPTIONS);
      this.peer = peer;
      let opened = false;

      peer.on('open', () => {
        opened = true;
        this.onStatus.emit({ kind: 'online' });
        resolve();
      });

      peer.on('connection', (conn) => {
        conn.on('open', () => this.onLink.emit(new PeerLink(conn)));
      });

      peer.on('disconnected', () => {
        // Lost the signaling server (e.g. laptop Wi-Fi blip). Existing phones keep
        // working peer-to-peer; we only need signaling for *new* phones.
        if (this.destroyed || peer.destroyed) return;
        this.onStatus.emit({ kind: 'reconnecting' });
        setTimeout(() => {
          if (!peer.destroyed && peer.disconnected) peer.reconnect();
        }, 1500);
      });

      peer.on('error', (err) => {
        const type = (err as { type?: string }).type;
        if (!opened) {
          peer.destroy();
          reject(type === 'unavailable-id' ? new RoomTakenError() : err);
          return;
        }
        // 'peer-unavailable' etc. are per-connection problems; only report serious ones.
        if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
          this.onStatus.emit({ kind: 'reconnecting' });
        } else {
          console.warn('PeerJS error', type, err);
        }
      });
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.peer?.destroy();
    this.peer = null;
  }
}

export class PeerControllerTransport implements ControllerTransport {
  private peer: Peer | null = null;

  /** Get (or re-create) our own Peer registered with the signaling server. */
  private async ensurePeer(): Promise<Peer> {
    const existing = this.peer;
    if (existing && !existing.destroyed && existing.open) return existing;
    existing?.destroy();
    const peer = new Peer(PEER_OPTIONS); // random id; phones don't need a fixed one
    this.peer = peer;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Signaling server timeout')), 10000);
      peer.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      peer.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    return peer;
  }

  async connect(roomCode: string): Promise<Link> {
    try {
      return await this.tryConnect(roomCode);
    } catch (err) {
      // After a phone sleeps, the signaling socket can be silently dead while
      // PeerJS still thinks it's open. Start from a fresh Peer next attempt.
      if (!(err instanceof RoomNotFoundError)) {
        this.peer?.destroy();
        this.peer = null;
      }
      throw err;
    }
  }

  private async tryConnect(roomCode: string): Promise<Link> {
    const peer = await this.ensurePeer();
    return new Promise<Link>((resolve, reject) => {
      const conn = peer.connect(peerIdForRoom(roomCode), { reliable: true, serialization: 'json' });
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.off('error', onPeerError);
        fn();
      };
      const timer = setTimeout(() => finish(() => {
        conn.close();
        reject(new Error('Connection timed out'));
      }), 12000);
      const onPeerError = (err: unknown) => {
        const type = (err as { type?: string }).type;
        if (type === 'peer-unavailable') finish(() => reject(new RoomNotFoundError()));
        else finish(() => reject(err));
      };
      peer.on('error', onPeerError);
      conn.on('open', () => finish(() => resolve(new PeerLink(conn))));
      conn.on('error', (err) => finish(() => reject(err)));
    });
  }

  destroy(): void {
    this.peer?.destroy();
    this.peer = null;
  }
}
