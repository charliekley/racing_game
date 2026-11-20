import { describe, expect, it } from 'vitest';
import { isControllerMessage, isHostMessage, parseSelect, parseSelectEcho } from './protocol';
import { canMoveStage, nextStage, previousStage } from './selectStage';
import { CHARACTERS, KART_BODIES } from './characters';

describe('select stages', () => {
  it('moves forward one step at a time and back any distance', () => {
    expect(canMoveStage('name', 'character')).toBe(true);
    expect(canMoveStage('name', 'kart')).toBe(false);
    expect(canMoveStage('name', 'ready')).toBe(false);
    expect(canMoveStage('kart', 'ready')).toBe(true);
    expect(canMoveStage('ready', 'name')).toBe(true);
    expect(canMoveStage('kart', 'kart')).toBe(true);
  });

  it('knows the neighbours', () => {
    expect(previousStage('name')).toBeNull();
    expect(previousStage('ready')).toBe('kart');
    expect(nextStage('ready')).toBeNull();
    expect(nextStage('character')).toBe('kart');
  });
});

describe('parseSelect (phone -> host)', () => {
  it('accepts a stage with optional values', () => {
    expect(parseSelect({ t: 'select', stage: 'kart' })).toEqual({ stage: 'kart' });
    expect(parseSelect({ stage: 'character', character: 2, name: 'Dana' })).toEqual({ stage: 'character', character: 2, name: 'Dana' });
    expect(parseSelect({ stage: 'ready', kart: KART_BODIES.length - 1 })).toEqual({ stage: 'ready', kart: KART_BODIES.length - 1 });
  });

  it('refuses unknown stages and non-objects', () => {
    for (const bad of [null, 5, 'x', {}, { stage: 'finish' }, { stage: 3 }, { stage: ['name'] }]) expect(parseSelect(bad)).toBeNull();
  });

  it('refuses bad indices', () => {
    for (const character of [-1, CHARACTERS.length, 1.5, NaN, Infinity, '2', null]) expect(parseSelect({ stage: 'character', character })).toBeNull();
    for (const kart of [-1, KART_BODIES.length, 0.5, '0']) expect(parseSelect({ stage: 'kart', kart })).toBeNull();
  });

  it('refuses names that are not strings or are absurdly long, keeps short ones as typed', () => {
    expect(parseSelect({ stage: 'name', name: 42 })).toBeNull();
    expect(parseSelect({ stage: 'name', name: 'x'.repeat(41) })).toBeNull();
    expect(parseSelect({ stage: 'name', name: '' })).toEqual({ stage: 'name', name: '' });
  });

  it('is a known message type both ways', () => {
    expect(isControllerMessage({ t: 'select', stage: 'name' })).toBe(true);
    expect(isHostMessage({ t: 'select', stage: 'name', name: 'A', loadout: { character: 0, kart: 0 } })).toBe(true);
  });
});

describe('parseSelectEcho (host -> phone)', () => {
  it('cleans the name and the loadout', () => {
    expect(parseSelectEcho({ stage: 'kart', name: '  Dana  ', loadout: { character: 99, kart: 1 } })).toEqual({
      stage: 'kart',
      name: 'Dana',
      loadout: { character: 3, kart: 1 }, // out of range falls back to the default driver
    });
  });

  it('refuses a bad stage or name', () => {
    expect(parseSelectEcho({ stage: 'zzz', name: 'A' })).toBeNull();
    expect(parseSelectEcho({ stage: 'name', name: 5 })).toBeNull();
    expect(parseSelectEcho(null)).toBeNull();
  });
});
