import { describe, expect, it } from 'vitest';
import { PICK_DURATION } from '../kart/pickAnim';
import { STEP_HEIGHT, STEP_WIDTH, cameraDistance, frameFor, phase, revealSchedule, stepX, type Place } from './podiumPlan';

describe('revealSchedule', () => {
  it('reveals 3rd, then 2nd, then 1st, each later than the one before', () => {
    const s = revealSchedule(3, false, PICK_DURATION);
    expect(s.slots.map((x) => x.place)).toEqual([3, 2, 1]);
    for (let i = 1; i < s.slots.length; i++) expect(s.slots[i].start).toBeGreaterThan(s.slots[i - 1].start + PICK_DURATION);
    expect(s.finale).toBe(s.slots[2].pick);
    expect(s.total).toBeGreaterThan(s.finale + PICK_DURATION);
  });

  it('within each slot: step first, then the racer, then the pick animation', () => {
    for (const x of revealSchedule(3).slots) {
      expect(x.model).toBeGreaterThan(x.start);
      expect(x.pick).toBeGreaterThanOrEqual(x.model);
    }
  });

  it('handles 1 and 2 racers (the best places) and 0', () => {
    expect(revealSchedule(2).slots.map((x) => x.place)).toEqual([2, 1]);
    expect(revealSchedule(1).slots.map((x) => x.place)).toEqual([1]);
    expect(revealSchedule(0)).toEqual({ slots: [], total: 0, finale: 0 });
    expect(revealSchedule(7).slots).toHaveLength(3);
  });

  it('reduced motion is much shorter', () => {
    expect(revealSchedule(3, true).total).toBeLessThan(revealSchedule(3, false).total / 2);
  });

  it('the full reveal takes a sensible time for a TV (4 to 10 s)', () => {
    const t = revealSchedule(3).total;
    expect(t).toBeGreaterThan(4);
    expect(t).toBeLessThan(10);
  });
});

describe('phase', () => {
  it('is 0 before, 1 after, linear between', () => {
    expect(phase(0, 1, 2)).toBe(0);
    expect(phase(2, 1, 2)).toBeCloseTo(0.5);
    expect(phase(9, 1, 2)).toBe(1);
  });
});

describe('layout and framing', () => {
  it('puts 2nd left, 1st centre, 3rd right, and steps do not overlap', () => {
    expect(stepX(2)).toBeLessThan(stepX(1));
    expect(stepX(1)).toBeLessThan(stepX(3));
    expect(stepX(1) - stepX(2)).toBeGreaterThan(STEP_WIDTH);
  });

  it('the winner stands highest', () => {
    expect(STEP_HEIGHT[1]).toBeGreaterThan(STEP_HEIGHT[2]);
    expect(STEP_HEIGHT[2]).toBeGreaterThan(STEP_HEIGHT[3]);
  });

  it('centres on the steps that exist', () => {
    expect(frameFor([3, 2, 1]).centerX).toBeCloseTo(0);
    expect(frameFor([1]).centerX).toBeCloseTo(0);
    expect(frameFor([1, 2]).centerX).toBeLessThan(0);
    expect(frameFor([1, 2]).halfWidth).toBeLessThan(frameFor([1, 2, 3]).halfWidth);
  });

  it('a narrower view needs the camera further back; fewer steps let it come closer', () => {
    const all = frameFor([1, 2, 3] as Place[]);
    expect(cameraDistance(all, 0.8, 30)).toBeGreaterThan(cameraDistance(all, 1.8, 30));
    expect(cameraDistance(frameFor([1]), 1, 30)).toBeLessThan(cameraDistance(all, 1, 30));
  });
});
