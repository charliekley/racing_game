/**
 * Networking abstraction.
 *
 * The rest of the game only talks to these interfaces, never to PeerJS
 * directly, so the signaling/transport implementation can be swapped later
 * (self-hosted PeerJS server, a WebSocket relay, ...) by writing another class
 * that implements them.
 */
import type { Signal } from '../signal';

/** A live connection between one phone and the host (same shape on both ends). */
export interface Link {
  /** Reliable, ordered JSON messages from the other side (validate before use!). */
  readonly onEvent: Signal<unknown>;
  /** Unreliable, unordered binary packets from the other side. */
  readonly onInput: Signal<ArrayBuffer>;
  /** Fires once when the link is gone (remote closed, network failure, or close()). */
  readonly onClose: Signal<void>;
  readonly isOpen: boolean;
  sendEvent(msg: object): void;
  /** Fire-and-forget; silently dropped if the input channel isn't open yet. */
  sendInput(packet: ArrayBuffer): void;
  close(): void;
}

export type HostStatus =
  | { kind: 'online' }
  | { kind: 'reconnecting' } // lost the signaling server; existing links keep working
  | { kind: 'error'; message: string };

export interface HostTransport {
  /** A new phone connected (it hasn't said hello yet). */
  readonly onLink: Signal<Link>;
  readonly onStatus: Signal<HostStatus>;
  /** Register under the room code. Rejects with RoomTakenError if the code is in use. */
  start(roomCode: string): Promise<void>;
  destroy(): void;
}

export interface ControllerTransport {
  /** Connect to the host for a room. Rejects with RoomNotFoundError if nobody hosts it. */
  connect(roomCode: string): Promise<Link>;
  destroy(): void;
}

export class RoomTakenError extends Error {
  constructor() {
    super('Room code already in use');
  }
}

export class RoomNotFoundError extends Error {
  constructor() {
    super('No game found with that room code');
  }
}

/**
 * The phone could not reach the signaling server (0.peerjs.com) at all, so it cannot even look for the TV.
 * On phones this is usually a DNS ad-blocker ("Private DNS"), a VPN, or a network that blocks the server.
 */
export class SignalingError extends Error {
  constructor(detail: string) {
    super(`Signaling server unreachable (${detail})`);
  }
}

/**
 * The TV was found, but the direct phone <-> TV link (WebRTC) never opened: the two devices could not find a
 * network path to each other (e.g. a Wi-Fi with "client isolation", a VPN, or a strict mobile network).
 */
export class LinkFailedError extends Error {
  constructor(detail: string) {
    super(`Direct link failed (${detail})`);
  }
}
