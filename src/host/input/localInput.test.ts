import { describe, expect, it } from 'vitest';
import { PAD_BACK, PAD_CONFIRM, PAD_LEFT, PAD_RIGHT, keySelectActions, localSelectStep, padSelectActions } from './localInput';
import { CHARACTERS, KART_BODIES } from '../../shared/characters';

const L = { character: 0, kart: 0 };

describe('keySelectActions', () => {
  it('maps the WASD player: A / D browse, E confirms, R goes back', () => {
    expect(keySelectActions(new Set(['KeyA']), 0)).toEqual(['left']);
    expect(keySelectActions(new Set(['KeyD', 'KeyE']), 0)).toEqual(['right', 'confirm']);
    expect(keySelectActions(new Set(['KeyR']), 0)).toEqual(['back']);
  });
  it('maps the arrows player separately', () => {
    expect(keySelectActions(new Set(['ArrowLeft', 'Enter', 'Slash']), 1)).toEqual(['left', 'confirm', 'back']);
    expect(keySelectActions(new Set(['KeyA']), 1)).toEqual([]);
  });
  it('ignores unknown schemes and unrelated keys', () => {
    expect(keySelectActions(new Set(['KeyA']), 7)).toEqual([]);
    expect(keySelectActions(new Set(['KeyQ']), 0)).toEqual([]);
  });
});

describe('padSelectActions', () => {
  it('fires once per press (edge-triggered)', () => {
    expect(padSelectActions(PAD_LEFT, 0)).toEqual(['left']);
    expect(padSelectActions(PAD_LEFT, PAD_LEFT)).toEqual([]);
    expect(padSelectActions(PAD_RIGHT | PAD_CONFIRM | PAD_BACK, 0)).toEqual(['right', 'confirm', 'back']);
  });
});

describe('localSelectStep', () => {
  it('browses the character, wrapping around', () => {
    expect(localSelectStep('right', 'character', L, 'lobby')).toEqual({ kind: 'select', req: { stage: 'character', character: 1 } });
    expect(localSelectStep('left', 'character', L, 'lobby')).toEqual({ kind: 'select', req: { stage: 'character', character: CHARACTERS.length - 1 } });
  });
  it('browses the kart body, wrapping around', () => {
    expect(localSelectStep('left', 'kart', L, 'lobby')).toEqual({ kind: 'select', req: { stage: 'kart', kart: KART_BODIES.length - 1 } });
  });
  it('does not browse at READY', () => {
    expect(localSelectStep('right', 'ready', L, 'lobby')).toBeNull();
  });
  it('confirm moves one step forward', () => {
    expect(localSelectStep('confirm', 'character', L, 'lobby')).toEqual({ kind: 'select', req: { stage: 'kart' } });
    expect(localSelectStep('confirm', 'kart', L, 'lobby')).toEqual({ kind: 'select', req: { stage: 'ready' } });
  });
  it('confirm at READY does nothing in the lobby and means "race again" on the results screen', () => {
    expect(localSelectStep('confirm', 'ready', L, 'lobby')).toBeNull();
    expect(localSelectStep('confirm', 'ready', L, 'results')).toEqual({ kind: 'toggleReady' });
  });
  it('back goes one step earlier but never to the name step', () => {
    expect(localSelectStep('back', 'ready', L, 'lobby')).toEqual({ kind: 'select', req: { stage: 'kart' } });
    expect(localSelectStep('back', 'kart', L, 'lobby')).toEqual({ kind: 'select', req: { stage: 'character' } });
    expect(localSelectStep('back', 'character', L, 'lobby')).toBeNull();
  });
  it('does nothing during a race', () => {
    expect(localSelectStep('confirm', 'character', L, 'race')).toBeNull();
  });
});
