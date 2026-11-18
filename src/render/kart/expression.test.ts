import { describe, expect, it } from 'vitest';
import type { WorldEvent } from '../../sim/world';
import {
  BLINK, DriverFace, EXPRESSIONS, FOREVER, HeadLook, LOOK_GAP_GLANCE, LOOK_MAX_HOLD, TARGET_COUNT,
  reactionsForEvent, tailgateSide, targetIndex, type FaceContext,
} from './expression';

const ctx: FaceContext = { racers: 8, spinTime: 1.3 };
/** A face that never blinks on its own (rng near 1 = the longest gap), so tests see only reactions. */
const calmFace = () => new DriverFace(() => 0.999);
const run = (f: DriverFace, seconds: number, gritted = false) => {
  for (let t = 0; t < seconds; t += 1 / 60) f.update(1 / 60, { gritted });
};
const w = (f: DriverFace, e: (typeof EXPRESSIONS)[number]) => f.weights[targetIndex(e)];

describe('expression state', () => {
  it('starts neutral with all weights zero', () => {
    const f = calmFace();
    run(f, 0.5);
    expect(f.current).toBe('neutral');
    expect([...f.weights].every((v) => v === 0)).toBe(true);
  });

  it('eases an expression in, holds it for its duration, then decays all the way to neutral', () => {
    const f = calmFace();
    f.react({ expr: 'happy', duration: 1 });
    run(f, 0.05);
    expect(w(f, 'happy')).toBeGreaterThan(0.2);
    expect(w(f, 'happy')).toBeLessThan(1); // eased, not a jump
    run(f, 0.4);
    expect(w(f, 'happy')).toBeGreaterThan(0.95);
    expect(f.current).toBe('happy');
    run(f, 0.8); // past the 1 s duration
    expect(f.current).toBe('neutral');
    run(f, 1.5);
    expect(w(f, 'happy')).toBe(0);
  });

  it('higher priority wins: a spin-out (dizzy) beats a boost grin, and a grin cannot interrupt dizzy', () => {
    const f = calmFace();
    f.react({ expr: 'happy', duration: 2 });
    run(f, 0.3);
    f.react({ expr: 'dizzy', duration: 1.5 });
    run(f, 0.4);
    expect(f.current).toBe('dizzy');
    expect(w(f, 'dizzy')).toBeGreaterThan(0.9);
    expect(w(f, 'happy')).toBeLessThan(0.1);
    f.react({ expr: 'happy', duration: 2 }); // weaker than what is showing: dropped
    run(f, 1.5);
    expect(f.current).toBe('neutral'); // the dropped grin does not pop up after the dizziness
  });

  it('cross-fades never add up to more than one face', () => {
    const f = calmFace();
    f.react({ expr: 'happy', duration: 5 });
    run(f, 0.5);
    f.react({ expr: 'shocked', duration: 5 });
    for (let i = 0; i < 30; i++) {
      f.update(1 / 60, { gritted: false });
      let sum = 0;
      for (let k = 1; k < TARGET_COUNT; k++) sum += f.weights[k];
      expect(sum).toBeLessThanOrEqual(1.0001);
    }
  });

  it('gritted teeth last while drifting, are the weakest mood and fade afterwards', () => {
    const f = calmFace();
    run(f, 0.6, true);
    expect(f.current).toBe('gritted');
    f.react({ expr: 'happy', duration: 0.5 });
    run(f, 0.3, true);
    expect(f.current).toBe('happy'); // a grin beats gritted teeth
    run(f, 1.5, false);
    expect(f.current).toBe('neutral');
  });

  it('a finish is held until reset, even through other reactions', () => {
    const f = calmFace();
    f.react({ expr: 'celebrate', duration: FOREVER, priority: 9 });
    f.react({ expr: 'dizzy', duration: 2 });
    run(f, 30);
    expect(f.current).toBe('celebrate');
    f.reset();
    run(f, 0.1);
    expect(f.current).toBe('neutral');
  });

  it('blinks every few seconds and each blink is short', () => {
    let n = 0;
    const f = new DriverFace(() => 0.1); // gaps of about 2.5 s
    let blinking = false;
    let longest = 0;
    let len = 0;
    for (let t = 0; t < 12; t += 1 / 60) {
      f.update(1 / 60, { gritted: false });
      const b = f.weights[BLINK] > 0.01;
      if (b) len += 1 / 60;
      if (b && !blinking) n++;
      if (!b && blinking) {
        longest = Math.max(longest, len);
        len = 0;
      }
      blinking = b;
    }
    expect(n).toBeGreaterThanOrEqual(3);
    expect(longest).toBeLessThan(0.25);
  });

  it('does not blink while dizzy or cheering', () => {
    const f = new DriverFace(() => 0);
    f.react({ expr: 'dizzy', duration: 6 });
    let max = 0;
    for (let t = 0; t < 5; t += 1 / 60) {
      f.update(1 / 60, { gritted: false });
      max = Math.max(max, f.weights[BLINK]);
    }
    expect(max).toBe(0);
  });

  it('overtaking makes the driver smug (not at the start), and being passed does nothing', () => {
    const f = calmFace();
    f.notePlace(5, false);
    run(f, 0.1);
    f.notePlace(5, true);
    f.notePlace(4, true); // inside the quiet period after the start: ignored
    run(f, 0.2);
    expect(f.current).toBe('neutral');
    run(f, 3);
    f.notePlace(3, true);
    run(f, 0.3);
    expect(f.current).toBe('smug');
    run(f, 3);
    f.notePlace(4, true); // lost a place
    run(f, 0.3);
    expect(f.current).toBe('neutral');
  });

  it('keeps one weights array and never grows (no per-frame allocation)', () => {
    const f = calmFace();
    const weights = f.weights;
    f.react({ expr: 'angry', duration: 1 });
    run(f, 2);
    expect(f.weights).toBe(weights);
    expect(f.weights.length).toBe(TARGET_COUNT);
  });
});

describe('head look timing', () => {
  const step = (h: HeadLook, s: number) => {
    for (let t = 0; t < s; t += 1 / 60) h.update(1 / 60);
  };

  it('turns smoothly, holds, and comes back; it never stays turned longer than the cap', () => {
    const h = new HeadLook();
    h.request({ side: 1, hold: 0.9 });
    h.update(1 / 60);
    expect(h.amount).toBeLessThan(0.2); // eased in, not a snap
    step(h, 0.5);
    expect(h.amount).toBeGreaterThan(0.95);
    expect(h.side).toBe(1);
    step(h, 2);
    expect(h.amount).toBe(0);
    // A request that tries to hold forever is capped.
    const h2 = new HeadLook();
    h2.request({ side: -1, hold: 50 });
    let turned = 0;
    for (let t = 0; t < 4; t += 1 / 60) {
      h2.update(1 / 60);
      if (h2.amount > 0.5) turned += 1 / 60;
    }
    expect(turned).toBeLessThan(LOOK_MAX_HOLD + 0.1);
    expect(h2.amount).toBe(0);
  });

  it('waits for the delay before turning', () => {
    const h = new HeadLook();
    h.request({ side: 1, hold: 0.5, delay: 0.5 });
    step(h, 0.4);
    expect(h.amount).toBe(0);
    step(h, 0.3);
    expect(h.amount).toBeGreaterThan(0.3);
  });

  it('rate limits background glances but still allows event reactions soon after', () => {
    const h = new HeadLook();
    expect(h.request({ side: 1, hold: 0.5, priority: 1 })).toBe(true);
    step(h, 1.6);
    expect(h.amount).toBe(0);
    expect(h.request({ side: 1, hold: 0.5, priority: 1 })).toBe(false); // glance blocked for LOOK_GAP_GLANCE
    step(h, 1);
    expect(h.request({ side: 1, hold: 0.5, priority: 2 })).toBe(true); // an event (trick, hit) is fine after a short gap
    step(h, 2);
    step(h, LOOK_GAP_GLANCE);
    expect(h.request({ side: 1, hold: 0.5, priority: 1 })).toBe(true);
  });

  it('side 0 uses the hint (the outside shoulder)', () => {
    const h = new HeadLook();
    h.sideHint = -1;
    h.request({ side: 0, hold: 0.5 });
    step(h, 0.1);
    expect(h.side).toBe(-1);
  });
});

describe('event -> reaction mapper', () => {
  const one = (e: WorldEvent) => reactionsForEvent(e, ctx);

  it('tricks and boosts make the driver happy; a trick also looks at the camera', () => {
    const r = one({ kind: 'trick', slot: 2 });
    expect(r[0]).toMatchObject({ slot: 2, expr: 'happy' });
    expect(r[0].look).toBeDefined();
    expect(one({ kind: 'boostPad', slot: 1 })[0].expr).toBe('happy');
  });

  it('a hit spins out the victim (dizzy, look back after the spin) and pleases the attacker', () => {
    const r = one({ kind: 'hit', slot: 1, by: 'ricochet', attacker: 3 } as WorldEvent);
    expect(r.find((x) => x.slot === 1)).toMatchObject({ expr: 'dizzy' });
    expect(r.find((x) => x.slot === 1)!.look!.delay).toBeGreaterThan(0.5);
    expect(r.find((x) => x.slot === 3)).toMatchObject({ expr: 'happy' });
    // Hitting yourself or an unknown attacker only reacts for the victim.
    expect(one({ kind: 'hit', slot: 1, by: 'slick', attacker: null } as WorldEvent)).toHaveLength(1);
    expect(one({ kind: 'hit', slot: 1, by: 'slick', attacker: 1 } as WorldEvent)).toHaveLength(1);
  });

  it('only hard impacts are worth a face', () => {
    expect(one({ kind: 'wall', slot: 0, impact: 4 })).toHaveLength(0);
    expect(one({ kind: 'wall', slot: 0, impact: 12 })[0].expr).toBe('shocked');
    expect(one({ kind: 'kart', slot: 0, impact: 3 })).toHaveLength(0);
    expect(one({ kind: 'kart', slot: 0, impact: 9 })[0].expr).toBe('angry');
    expect(one({ kind: 'land', slot: 0, fallSpeed: 3 })).toHaveLength(0);
  });

  it('finishing: top half cheers (held), the rest sulks; knockout is despair', () => {
    const good = one({ kind: 'finish', slot: 0, place: 2, time: 30 })[0];
    expect(good).toMatchObject({ expr: 'celebrate', duration: FOREVER });
    expect(one({ kind: 'finish', slot: 0, place: 7, time: 30 })[0].expr).toBe('despair');
    expect(one({ kind: 'knockout', slot: 0, place: 6, lap: 2 })[0].expr).toBe('despair');
  });

  it('bot moods map one to one', () => {
    for (const mood of ['celebrate', 'despair', 'angry', 'smug'] as const) {
      expect(one({ kind: 'botMood', slot: 4, mood })[0]).toMatchObject({ slot: 4, expr: mood });
    }
  });

  it('events nobody cares about give nothing', () => {
    expect(one({ kind: 'go' })).toEqual([]);
    expect(one({ kind: 'lap', slot: 0, lap: 1, lapTime: 20 })).toEqual([]);
  });

  it('every reaction is playable: the face accepts it and shows it', () => {
    const f = calmFace();
    f.react(one({ kind: 'respawn', slot: 0 })[0]);
    run(f, 0.5);
    expect(f.current).toBe('despair');
  });
});

describe('tailgateSide', () => {
  it('detects a kart right behind (heading 0 = facing +z) and tells which shoulder', () => {
    expect(tailgateSide(0, -4, 0)).toBe(1); // dead behind: default left shoulder
    expect(tailgateSide(1.5, -4, 0)).toBe(1); // behind and to +x = the kart's left
    expect(tailgateSide(-1.5, -4, 0)).toBe(-1);
  });
  it('ignores karts ahead, far behind, or far to the side', () => {
    expect(tailgateSide(0, 4, 0)).toBe(0);
    expect(tailgateSide(0, -12, 0)).toBe(0);
    expect(tailgateSide(6, -4, 0)).toBe(0);
    expect(tailgateSide(0, -0.5, 0)).toBe(0);
  });
  it('follows the heading', () => {
    // Facing +x (heading pi/2): behind is -x.
    expect(tailgateSide(-4, 0, Math.PI / 2)).not.toBe(0);
    expect(tailgateSide(4, 0, Math.PI / 2)).toBe(0);
  });
});
