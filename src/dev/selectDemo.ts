/**
 * Dev tool: fakes players moving through the selection flow so the TV screen can be checked without phones.
 *
 * Open the host page with `?selectdemo=1` (4 players), `?selectdemo=3` (3 players), and so on. Every fake
 * player loops through name -> character -> kart -> ready, each one a few seconds ahead of the last so all
 * four stages are on screen at once. In the browser console:
 *   __selectDemo.pause()          stop the script (the 3D animations keep running)
 *   __selectDemo.seek(seconds)    jump to a moment of the script (and pause)
 *   __selectDemo.play()           carry on
 *   __selectDemo.hold(slot, stage, character?, kart?)   park one player in a given stage
 */
import { CHARACTERS, KART_BODIES } from '../shared/characters';
import type { SelectStage, SelectionHub, SelectionView } from '../host/selectionHub';

const NAMES = ['Ada', 'Marko', 'Priya', 'Tomasz', 'Lena'];
/** Seconds one pass through the flow takes, and the lead each following player is given. */
export const DEMO_CYCLE = 24;
const LEAD = 3.2;

/** One fake player's state `c` seconds into its loop. Pure (the same time always gives the same view), so it can be tested. */
export function demoView(slot: number, c: number): SelectionView {
  const name = NAMES[slot % NAMES.length];
  const startChar = (slot * 3 + 1) % CHARACTERS.length;
  const base = { slot, input: slot % 2 === 0 ? ('phone' as const) : ('local' as const) };
  const t = ((c % DEMO_CYCLE) + DEMO_CYCLE) % DEMO_CYCLE;
  if (t < 3) {
    // Typing the name, one letter every 0.4 s.
    return { ...base, name: name.slice(0, Math.floor(t / 0.4)), stage: 'name', character: startChar, kart: 0 };
  }
  if (t < 10) {
    // Browsing characters: the highlight moves on every 1.1 s; the last one is the choice.
    const character = (startChar + Math.floor((t - 3) / 1.1)) % CHARACTERS.length;
    return { ...base, name, stage: 'character', character, kart: 0 };
  }
  const chosen = (startChar + Math.floor(6.99 / 1.1)) % CHARACTERS.length;
  if (t < 17) {
    const kart = Math.floor((t - 10) / 1.5) % KART_BODIES.length;
    return { ...base, name, stage: 'kart', character: chosen, kart };
  }
  return { ...base, name, stage: 'ready', character: chosen, kart: Math.floor(6.99 / 1.5) % KART_BODIES.length };
}

export interface SelectDemo {
  pause(): void;
  play(): void;
  seek(seconds: number): void;
  hold(slot: number, stage: SelectStage, character?: number, kart?: number): void;
  stop(): void;
}

/** Start the fake players. `players` = 1..4. Returns controls (also put on `window.__selectDemo` by the caller). */
export function startSelectDemo(hub: SelectionHub, players: number): SelectDemo {
  const n = Math.max(1, Math.min(4, Math.floor(players) || 4));
  let time = 0;
  let playing = true;
  const held = new Map<number, SelectionView>();
  const push = () => {
    for (let slot = 0; slot < n; slot++) hub.set(held.get(slot) ?? demoView(slot, time + (n - 1 - slot) * LEAD));
  };
  push();
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    if (playing) {
      time += (now - last) / 1000;
      push();
    }
    last = now;
  }, 100);
  return {
    pause: () => (playing = false),
    play: () => (playing = true),
    seek: (s) => {
      time = s;
      playing = false;
      held.clear();
      push();
    },
    hold: (slot, stage, character = 0, kart = 0) => {
      const prev = hub.get(slot);
      const v: SelectionView = { slot, name: prev?.name || NAMES[slot % NAMES.length], stage, character, kart, input: prev?.input ?? 'phone' };
      held.set(slot, v);
      hub.set(v);
    },
    stop: () => {
      clearInterval(timer);
      hub.clear();
    },
  };
}
