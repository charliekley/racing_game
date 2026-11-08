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
