/**
 * Room codes: 4 letters shown on the TV. The host registers with the signaling
 * server under a peer ID derived from the code; phones derive the same ID.
 */

// No I or O: too easy to confuse with 1 and 0 on a TV.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 4;

/** Namespaces our IDs on the shared public PeerJS server so we don't collide with other apps. */
const PEER_ID_PREFIX = 'tiltkart-r1-';

export function generateRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length];
  }
  return code;
}

/** Uppercases and strips anything that's not a letter. Returns null if invalid. */
export function normalizeRoomCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const code = input.toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ALPHABET.includes(ch)) return null;
  return code;
}

export function peerIdForRoom(code: string): string {
  return PEER_ID_PREFIX + code;
}
