import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../../shared/characters';
import { EXPRESSIONS } from './expression';
import { NEUTRAL_PICK, PICK_DURATION, PICK_FACES, facesDue, fitDistance, pickPose, popIn, type PickPose } from './pickAnim';
import type { Species } from './drivers';

const SPECIES = CHARACTERS.map((c) => c.look.species) as Species[];
const TAU = Math.PI * 2;
/** Angles that make a whole turn look the same as none: compare them modulo a full turn. */
const ANGLES: (keyof PickPose)[] = ['yaw', 'pitch', 'roll', 'headYaw', 'headPitch', 'headRoll', 'torsoYaw', 'torsoPitch', 'torsoRoll'];
const wrapped = (a: number) => Math.abs(Math.sin(a / 2));

describe('pick animations', () => {
  it('last about 1.5 s', () => {
    expect(PICK_DURATION).toBeGreaterThanOrEqual(1.3);
    expect(PICK_DURATION).toBeLessThanOrEqual(1.7);
  });

  it('has a move for every one of the 12 species', () => {
    expect(new Set(SPECIES).size).toBe(12);
    for (const sp of SPECIES) expect(PICK_FACES[sp].length).toBeGreaterThan(0);
  });

  it.each(SPECIES)('%s starts and ends exactly neutral', (sp) => {
    expect(pickPose(sp, 0)).toEqual(NEUTRAL_PICK);
    expect(pickPose(sp, -1)).toEqual(NEUTRAL_PICK);
    expect(pickPose(sp, PICK_DURATION)).toEqual(NEUTRAL_PICK);
    expect(pickPose(sp, PICK_DURATION + 5)).toEqual(NEUTRAL_PICK);
  });

  it.each(SPECIES)('%s is continuous at the ends (just inside the move it is already almost neutral)', (sp) => {
    for (const t of [0.002, PICK_DURATION - 0.002]) {
      const p = pickPose(sp, t);
      for (const k of Object.keys(NEUTRAL_PICK) as (keyof PickPose)[]) {
        const v = p[k];
        expect(Number.isFinite(v)).toBe(true);
        // Angles may sit on a whole turn (2 pi): that looks like zero.
        const off = ANGLES.includes(k) ? wrapped(v) : Math.abs(v);
        expect(off, `${sp} ${k} at ${t}`).toBeLessThan(0.08);
      }
    }
  });

  it.each(SPECIES)('%s does something visible and stays in sane limits', (sp) => {
    let moved = 0;
    for (let t = 0; t < PICK_DURATION; t += 0.01) {
      const p = pickPose(sp, t);
      moved = Math.max(moved, p.lift, Math.abs(p.squash) * 3, wrapped(p.yaw), wrapped(p.headYaw), wrapped(p.pitch), Math.abs(p.torsoPitch), Math.abs(p.torsoRoll), Math.abs(p.headPitch), p.armsUp, p.blink);
      expect(p.lift).toBeGreaterThanOrEqual(0);
      expect(p.lift).toBeLessThan(0.8);
      expect(Math.abs(p.squash)).toBeLessThan(0.4);
      expect(p.armsUp).toBeGreaterThanOrEqual(0);
      expect(p.armsUp).toBeLessThanOrEqual(1);
      expect(p.flash).toBeGreaterThanOrEqual(0);
      expect(p.flash).toBeLessThanOrEqual(1);
      expect(p.blink).toBeLessThanOrEqual(1);
    }
    expect(moved).toBeGreaterThan(0.1);
  });

  it('every species has its own move (the poses differ)', () => {
    const signature = (sp: Species) => {
      const parts: string[] = [];
      for (let t = 0.1; t < PICK_DURATION; t += 0.2) parts.push(Object.values(pickPose(sp, t)).map((v) => v.toFixed(2)).join(','));
      return parts.join('|');
    };
    expect(new Set(SPECIES.map(signature)).size).toBe(12);
  });

  it('spinning moves complete a full turn', () => {
    // fox: whole body, robot: head, astronaut: flip.
    let fox = 0;
    let robot = 0;
    let astro = 0;
    for (let t = 0; t < PICK_DURATION; t += 0.005) {
      fox = Math.max(fox, pickPose('fox', t).yaw);
      robot = Math.max(robot, pickPose('robot', t).headYaw);
      astro = Math.max(astro, pickPose('astronaut', t).pitch);
    }
    for (const turn of [fox, robot, astro]) expect(turn).toBeGreaterThan(TAU * 0.95);
  });

  it('reuses the output object when given one', () => {
    const out = { ...NEUTRAL_PICK };
    expect(pickPose('frog', 0.8, out)).toBe(out);
    expect(out.lift).toBeGreaterThan(0);
    pickPose('frog', 0, out);
    expect(out).toEqual(NEUTRAL_PICK);
  });

  it('only uses faces that exist, inside the move', () => {
    for (const sp of SPECIES) {
      for (const f of PICK_FACES[sp]) {
        expect((EXPRESSIONS as readonly string[]).includes(f.expr)).toBe(true);
        expect(f.at).toBeGreaterThanOrEqual(0);
        expect(f.at).toBeLessThan(PICK_DURATION);
      }
    }
  });

  it('facesDue fires each face once as time advances in frames', () => {
    for (const sp of SPECIES) {
      let fired = 0;
      let prev = 0;
      for (let t = 1 / 60; t < PICK_DURATION + 0.1; t += 1 / 60) {
        fired += facesDue(sp, prev, t).length;
        prev = t;
      }
      expect(fired).toBe(PICK_FACES[sp].length);
    }
  });
});

describe('stage helpers', () => {
  it('popIn goes from 0 to exactly 1 with a little overshoot', () => {
    expect(popIn(0)).toBe(0);
    expect(popIn(-1)).toBe(0);
    expect(popIn(1)).toBe(1);
    expect(popIn(2)).toBe(1);
    let max = 0;
    for (let u = 0; u <= 1; u += 0.01) max = Math.max(max, popIn(u));
    expect(max).toBeGreaterThan(1.02);
    expect(max).toBeLessThan(1.3);
  });

  it('fitDistance grows for narrow views and bigger objects', () => {
    const wide = fitDistance(1.5, 30, 2);
    const narrow = fitDistance(1.5, 30, 0.7);
    expect(narrow).toBeGreaterThan(wide);
    expect(fitDistance(3, 30, 1.5)).toBeCloseTo(2 * fitDistance(1.5, 30, 1.5), 6);
  });
});
