import { describe, expect, it } from 'vitest';
import { chooserSlot, forcedChoice } from './forcedChoice';
import type { SeriesInfo } from './protocol';

const menu: SeriesInfo = { mode: 'single', track: 0, stage: 'menu', owner: 0, picker: null, racesDone: 0, raceTotal: null, standings: [], pending: true };
const loser: SeriesInfo = { ...menu, mode: 'loser', stage: 'between', pending: undefined, picker: 2, racesDone: 1 };

describe('forcedChoice (who must see the pop-up)', () => {
  it('the menu owner gets the setup pop-up while the choice is pending', () => {
    expect(forcedChoice(menu, 0)).toBe('setup');
  });
  it('other phones and phones without a slot do not', () => {
    expect(forcedChoice(menu, 1)).toBeNull();
    expect(forcedChoice(menu, null)).toBeNull();
    expect(forcedChoice(null, 0)).toBeNull();
  });
  it('closes once the choice is done (phone or host keyboard) or an old host never sends `pending`', () => {
    expect(forcedChoice({ ...menu, pending: false }, 0)).toBeNull();
    expect(forcedChoice({ ...menu, pending: undefined }, 0)).toBeNull();
  });
  it('owner leaves mid-choice: the next owner gets it, the old one does not', () => {
    const next = { ...menu, owner: 1 };
    expect(forcedChoice(next, 1)).toBe('setup');
    expect(forcedChoice(next, 0)).toBeNull();
  });
  it('reconnecting just re-reads the same state, so the pop-up comes back', () => {
    expect(forcedChoice(menu, 0)).toBe(forcedChoice({ ...menu }, 0));
  });
  it('never shows during a race or on the podium', () => {
    expect(forcedChoice({ ...menu, stage: 'racing' }, 0)).toBeNull();
    expect(forcedChoice({ ...menu, stage: 'over' }, 0)).toBeNull();
  });
  it('Loser picks: only the picker gets the track pop-up', () => {
    expect(forcedChoice(loser, 2)).toBe('pick');
    expect(forcedChoice(loser, 0)).toBeNull();
    expect(forcedChoice({ ...loser, picker: null }, 2)).toBeNull();
    expect(forcedChoice({ ...loser, mode: 'gp' }, 2)).toBeNull();
  });
});

describe('chooserSlot (who the others wait for)', () => {
  it('is the owner in the menu and the picker in Loser picks', () => {
    expect(chooserSlot(menu)).toBe(0);
    expect(chooserSlot(loser)).toBe(2);
  });
  it('is nobody when nothing is pending', () => {
    expect(chooserSlot({ ...menu, pending: false })).toBeNull();
    expect(chooserSlot({ ...menu, stage: 'racing' })).toBeNull();
    expect(chooserSlot(null)).toBeNull();
  });
});
