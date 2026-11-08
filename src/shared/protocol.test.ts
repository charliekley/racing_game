import { describe, expect, it } from 'vitest';
import { Buttons, decodeInput, encodeInput, isControllerMessage, sanitizeName } from './protocol';
import { generateRoomCode, normalizeRoomCode } from './roomCode';

describe('input packets', () => {
  it('round-trips', () => {
    const p = { seq: 123456, steer: -0.5, buttons: Buttons.GAS | Buttons.DRIFT };
    const d = decodeInput(encodeInput(p))!;
    expect(d.seq).toBe(123456);
    expect(d.steer).toBeCloseTo(-0.5, 4);
    expect(d.buttons).toBe(Buttons.GAS | Buttons.DRIFT);
  });
  it('clamps steer and handles NaN', () => {
    expect(decodeInput(encodeInput({ seq: 0, steer: 5, buttons: 0 }))!.steer).toBeCloseTo(1);
    expect(decodeInput(encodeInput({ seq: 0, steer: NaN, buttons: 0 }))!.steer).toBe(0);
  });
  it('rejects garbage', () => {
    expect(decodeInput('hello')).toBeNull();
    expect(decodeInput(new ArrayBuffer(3))).toBeNull();
    expect(decodeInput(new Uint8Array(8))).not.toBeNull();
  });
});

describe('messages', () => {
  it('validates controller messages', () => {
    expect(isControllerMessage({ t: 'ready', ready: true })).toBe(true);
    expect(isControllerMessage({ t: 'welcome' })).toBe(false);
    expect(isControllerMessage(null)).toBe(false);
  });
  it('sanitizes names', () => {
    expect(sanitizeName('  Charlie  ')).toBe('Charlie');
    expect(sanitizeName('a\u0000b')).toBe('ab');
    expect(sanitizeName('x'.repeat(50)).length).toBe(12);
    expect(sanitizeName('')).toBe('Player');
    expect(sanitizeName(42)).toBe('Player');
  });
});

describe('room codes', () => {
  it('generates valid codes', () => {
    for (let i = 0; i < 100; i++) {
      const c = generateRoomCode();
      expect(normalizeRoomCode(c)).toBe(c);
      expect(c).not.toMatch(/[IO]/);
    }
  });
  it('normalizes user input', () => {
    expect(normalizeRoomCode(' abcd ')).toBe('ABCD');
    expect(normalizeRoomCode('ab-cd')).toBe('ABCD');
    expect(normalizeRoomCode('ABC')).toBeNull();
    expect(normalizeRoomCode('ABCI')).toBeNull(); // I is not in the alphabet
    expect(normalizeRoomCode(null)).toBeNull();
  });
});
