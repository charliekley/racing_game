import { describe, expect, it } from 'vitest';
import {
  isControllerMessage,
  isHostMessage,
  parseSeriesAct,
  parseSeriesInfo,
  parseSetup,
  parseTrackCards,
  sanitizeMode,
  sanitizeTrackIndex,
} from './protocol';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('mode / track validation', () => {
  it('accepts only the three modes', () => {
    expect(sanitizeMode('gp')).toBe('gp');
    expect(sanitizeMode('loser')).toBe('loser');
    expect(sanitizeMode('GP')).toBeNull();
    expect(sanitizeMode(1)).toBeNull();
    expect(sanitizeMode(undefined)).toBeNull();
    expect(sanitizeMode('__proto__')).toBeNull();
  });

  it('accepts only whole track indexes in range', () => {
    expect(sanitizeTrackIndex(0, 4)).toBe(0);
    expect(sanitizeTrackIndex(3, 4)).toBe(3);
    for (const bad of [4, -1, 1.5, NaN, Infinity, '2', null, undefined, {}]) expect(sanitizeTrackIndex(bad, 4)).toBeNull();
  });

  it('parseSetup keeps valid fields and drops bad ones', () => {
    expect(parseSetup({ t: 'setup', mode: 'gp', track: 2 }, 4)).toEqual({ mode: 'gp', track: 2 });
    expect(parseSetup({ t: 'setup', mode: 'gp', track: 99 }, 4)).toEqual({ mode: 'gp' });
    expect(parseSetup({ t: 'setup', track: 1 }, 4)).toEqual({ track: 1 });
    expect(parseSetup({ t: 'setup', mode: 'x', track: -1 }, 4)).toBeNull();
    expect(parseSetup(null, 4)).toBeNull();
  });

  it('parseSeriesAct accepts menu and stop only', () => {
    expect(parseSeriesAct({ act: 'menu' })).toBe('menu');
    expect(parseSeriesAct({ act: 'stop' })).toBe('stop');
    expect(parseSeriesAct({ act: 'cards' })).toBe('cards');
    expect(parseSeriesAct({ act: 'delete' })).toBeNull();
    expect(parseSeriesAct({})).toBeNull();
  });

  it('knows the new message types', () => {
    expect(isControllerMessage({ t: 'setup' })).toBe(true);
    expect(isControllerMessage({ t: 'pick', track: 1 })).toBe(true);
    expect(isControllerMessage({ t: 'nope' })).toBe(false);
    expect(isHostMessage({ t: 'series' })).toBe(true);
    expect(isHostMessage({ t: 'tracks', list: [] })).toBe(true);
  });
});

describe('host -> phone payload validation', () => {
  it('accepts a good track card and rejects bad images', () => {
    const ok = parseTrackCards([{ name: 'A', laps: 3, km: 1.2, img: PNG }]);
    expect(ok).toHaveLength(1);
    expect(parseTrackCards([{ name: 'A', laps: 3, km: 1.2, img: 'https://evil.example/x.png' }])).toBeNull();
    expect(parseTrackCards([{ name: 'A', laps: 3, km: 1.2, img: 'javascript:alert(1)' }])).toBeNull();
    expect(parseTrackCards([{ name: 'A', laps: 3, km: 1.2, img: 'data:image/svg+xml;base64,AAAA' }])).toBeNull();
    expect(parseTrackCards([{ name: 'A', laps: 3, km: 1.2, img: 'data:image/png;base64,' + 'A'.repeat(70000) }])).toBeNull();
    expect(parseTrackCards([])).toBeNull();
    expect(parseTrackCards('x')).toBeNull();
  });

  const good = { mode: 'gp', track: 1, stage: 'between', owner: 0, picker: null, racesDone: 1, raceTotal: 4, standings: [0, 10, 1, 7] };
  it('parseSeriesInfo accepts a good message and rejects broken ones', () => {
    expect(parseSeriesInfo(good, 4)).toEqual(good);
    expect(parseSeriesInfo({ ...good, mode: 'x' }, 4)).toBeNull();
    expect(parseSeriesInfo({ ...good, track: 9 }, 4)).toBeNull();
    expect(parseSeriesInfo({ ...good, stage: 'zzz' }, 4)).toBeNull();
    expect(parseSeriesInfo({ ...good, owner: 7 }, 4)).toBeNull();
    expect(parseSeriesInfo({ ...good, standings: [0, 'a'] }, 4)).toBeNull();
    expect(parseSeriesInfo({ ...good, standings: [0] }, 4)).toBeNull();
    expect(parseSeriesInfo({ ...good, raceTotal: 'x' }, 4)).toBeNull();
  });

  it('pending is optional (old hosts) but must be a boolean when present', () => {
    const menu = { ...good, stage: 'menu', picker: null, racesDone: 0, raceTotal: null, standings: [] };
    expect(parseSeriesInfo(menu, 4)?.pending).toBeUndefined();
    expect(parseSeriesInfo({ ...menu, pending: true }, 4)?.pending).toBe(true);
    expect(parseSeriesInfo({ ...menu, pending: false }, 4)?.pending).toBeUndefined();
    expect(parseSeriesInfo({ ...menu, pending: 'yes' }, 4)).toBeNull();
    expect(parseSeriesInfo({ ...menu, pending: 1 }, 4)).toBeNull();
  });

  it('parseSetup understands done (strictly true) and keeps old messages working', () => {
    expect(parseSetup({ t: 'setup', done: true }, 4)).toEqual({ done: true });
    expect(parseSetup({ t: 'setup', track: 2, done: true }, 4)).toEqual({ track: 2, done: true });
    expect(parseSetup({ t: 'setup', done: 'true' }, 4)).toBeNull();
    expect(parseSetup({ t: 'setup', done: 1 }, 4)).toBeNull();
    expect(parseSetup({ t: 'setup', mode: 'gp', done: false }, 4)).toEqual({ mode: 'gp' });
  });
});
