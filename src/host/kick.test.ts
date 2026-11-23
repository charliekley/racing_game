import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '../shared/protocol';
import type { HostTransport, Link } from '../shared/net/transport';
import { Signal } from '../shared/signal';
import { KeyboardState } from './input/localInput';
import { PlayerManager } from './playerManager';

/** A phone's end of the link, as the host sees it: records what the host sent and whether it closed. */
function fakeLink() {
  const sent: { t: string }[] = [];
  let open = true;
  const link: Link = {
    onEvent: new Signal<unknown>(),
    onInput: new Signal<ArrayBuffer>(),
    onClose: new Signal<void>(),
    get isOpen() {
      return open;
    },
    sendEvent: (m) => sent.push(m as { t: string }),
    sendInput: () => {},
    close: () => {
      if (!open) return;
      open = false;
      link.onClose.emit();
    },
  };
  return { link, sent };
}

function setup() {
  const transport: HostTransport = { onLink: new Signal<Link>(), onStatus: new Signal(), start: async () => {}, destroy: () => {} };
  // (A fake "window": the keyboard helper only needs addEventListener.)
  const players = new PlayerManager(transport, new KeyboardState({ addEventListener: () => {} } as unknown as Window));
  const join = (clientId: string) => {
    const phone = fakeLink();
    transport.onLink.emit(phone.link);
    phone.link.onEvent.emit({ t: 'hello', v: PROTOCOL_VERSION, clientId, name: clientId, color: 0 });
    return phone;
  };
  return { players, join };
}

describe('removing a player (the X on the TV)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('frees the slot, tells the phone it was kicked and then closes its connection', () => {
    const { players, join } = setup();
    const a = join('a');
    const b = join('b');
    expect(players.slots.players).toHaveLength(2);
    players.kick(0);
    expect(players.slots.slots[0]).toBeNull(); // slot freed
    expect(players.slots.slots[1]).not.toBeNull(); // the other player is untouched
    expect(a.sent.some((m) => m.t === 'kicked')).toBe(true);
    expect(b.sent.some((m) => m.t === 'kicked')).toBe(false);
    expect(a.link.isOpen).toBe(true); // closed a moment later, so the message gets through first
    vi.advanceTimersByTime(600);
    expect(a.link.isOpen).toBe(false);
    expect(b.link.isOpen).toBe(true);
    expect(players.slots.slots[1]).not.toBeNull(); // the close did not disconnect / disturb anybody else
  });

  it('a removed phone cannot act any more, and only gets back in with a fresh hello (JOIN AGAIN)', () => {
    const { players, join } = setup();
    const a = join('a');
    players.kick(0);
    // Messages from the removed link are ignored (it has no slot any more).
    a.link.onEvent.emit({ t: 'select', stage: 'character', name: 'Sneaky' });
    expect(players.slots.players).toHaveLength(0);
    vi.advanceTimersByTime(600);
    // JOIN AGAIN = a new link with a hello: a free slot, in the lobby.
    join('a');
    expect(players.slots.players).toHaveLength(1);
    expect(players.slots.slots[0]!.connected).toBe(true);
  });

  it('removing an empty or invalid slot does nothing', () => {
    const { players } = setup();
    expect(() => players.kick(3)).not.toThrow();
    expect(() => players.kick(99)).not.toThrow();
  });
});
