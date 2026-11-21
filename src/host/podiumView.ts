/**
 * The 3D podium on the TV (the contract with the flow side is in postRace.ts: PodiumApi / PodiumEntry).
 *
 * WHERE THE PARENT ELEMENT GOES. `createPodium(parent)` needs a `parent` element that is positioned (CSS
 * `position: absolute / relative`) and has a size: the podium fills it completely (a WebGL canvas plus a layer
 * of name labels) and redraws whenever the parent's size changes. Nothing is drawn outside it.
 *  - We add the class `podium-stage` to the parent. In podium.css that class means "the left 46% of the game
 *    area, full height, above the results overlay, mouse clicks pass through". The scoreboard (results or final
 *    standings) goes in the remaining right part: give the results / series layer the class `beside-podium`
 *    (see results.css) while the podium is up. At 1280x720 the podium area is about 590x720 px.
 *  - Any other parent works too (a full-screen one gives a wide podium with larger karts).
 *
 * LIFETIME. `show()` creates the WebGL renderer, builds the steps and the three karts and plays the reveal;
 * `hide()` stops drawing and frees all GPU memory (like SelectView.hide). `update(dt)` must be called every
 * frame while shown: it advances the reveal clock, animates and draws. The reveal ends about 7 s after show().
 *
 * WEB CONCEPTS. The 3D picture is a <canvas> drawn by Three.js (src/render/podium/podiumScene.ts); the text
 * (names, crowns, points) is ordinary HTML laid over it, so it stays crisp and can be styled with CSS. Each frame
 * the 3D position under every step is projected to a pixel position and the label is moved there. Names come
 * from phones, so they are only ever set with `textContent`, never innerHTML.
 */
import { crownLabel } from '../shared/wins';
import { PICK_DURATION } from '../render/kart/pickAnim';
import { PodiumScene, type PodiumRacer } from '../render/podium/podiumScene';
import { phase, revealSchedule, type Place, type RevealSchedule } from '../render/podium/podiumPlan';
import type { PodiumApi, PodiumEntry } from './postRace';

interface LabelRefs {
  el: HTMLElement;
  place: Place;
}

/** Everything that exists only while the podium is shown. */
interface Active {
  root: HTMLElement;
  scene: PodiumScene | null;
  labels: LabelRefs[];
  schedule: RevealSchedule;
  /** Seconds since show(). */
  t: number;
  done: boolean;
  resolve: () => void;
  anchor: { x: number; y: number };
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/** The best three entries, one per place, in place order (bad input from the flow side is tolerated). */
export function normalizeEntries(entries: readonly PodiumEntry[]): PodiumEntry[] {
  const byPlace = new Map<number, PodiumEntry>();
  for (const e of entries) {
    if ((e.place === 1 || e.place === 2 || e.place === 3) && !byPlace.has(e.place)) byPlace.set(e.place, e);
  }
  return [...byPlace.values()].sort((a, b) => a.place - b.place);
}

export function createPodium(parent: HTMLElement): PodiumApi {
  parent.classList.add('podium-stage');
  let active: Active | null = null;

  function hide(): void {
    const a = active;
    if (!a) return;
    active = null;
    a.scene?.dispose();
    a.root.remove();
    a.resolve(); // never leave the flow side waiting on a reveal that was cut short
  }

  function show(entries: readonly PodiumEntry[], title: string): Promise<void> {
    hide();
    const list = normalizeEntries(entries);
    const reduced = typeof matchMedia === 'function' && matchMedia(REDUCED_QUERY).matches;
    const schedule = revealSchedule(list.length, reduced, PICK_DURATION);

    const root = document.createElement('div');
    root.className = 'pod-root';
    parent.appendChild(root);

    // 3D scene. If WebGL is not available the labels still appear on the same schedule.
    let scene: PodiumScene | null = null;
    try {
      const racers: PodiumRacer[] = list.map((e) => ({ place: e.place, character: e.loadout.character, kart: e.loadout.kart }));
      scene = new PodiumScene(root, racers, schedule, reduced);
    } catch (err) {
      console.warn('Podium: 3D unavailable', err);
      scene = null;
    }

    // Title (small heading) at the top.
    // (An empty title shows nothing: use it when the scoreboard next to the podium already says it.)
    if (title) {
      const heading = document.createElement('div');
      heading.className = 'pod-title';
      heading.textContent = title;
      root.appendChild(heading);
    }

    // One label per racer: colour bar + name + crown, then the points.
    const labels: LabelRefs[] = list.map((e) => {
      const el = document.createElement('div');
      el.className = `pod-label place-${e.place}`;
      el.style.setProperty('--slot-color', e.color);
      const name = document.createElement('div');
      name.className = 'pod-name';
      const text = document.createElement('span');
      text.className = 'pod-name-text';
      text.textContent = e.name;
      const crown = document.createElement('span');
      crown.className = 'pod-crown';
      crown.textContent = crownLabel(e.wins);
      name.append(text, crown);
      el.appendChild(name);
      if (e.points !== null) {
        const pts = document.createElement('div');
        pts.className = 'pod-pts';
        pts.textContent = `${e.points} pts`;
        el.appendChild(pts);
      }
      root.appendChild(el);
      return { el, place: e.place };
    });

    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    active = { root, scene, labels, schedule, t: 0, done: schedule.total <= 0, resolve, anchor: { x: 0, y: 0 } };
    if (active.done) resolve();
    layout(active);
    return promise;
  }

  /** Move every label under its step and fade it in on schedule. */
  function layout(a: Active): void {
    const w = a.root.clientWidth;
    const h = a.root.clientHeight;
    // One size unit for all the text: scales with the area (about 14 px per 590 px of width, kept readable).
    a.root.style.setProperty('--pu', `${Math.max(9, Math.min(w / 36, h / 24, 30)).toFixed(2)}px`);
    for (const l of a.labels) {
      const plan = a.schedule.slots.find((s) => s.place === l.place);
      const k = plan ? phase(a.t, plan.label, 0.4) : 1;
      l.el.style.opacity = String(k);
      l.el.style.transform = `translate(-50%, ${((1 - k) * 14).toFixed(1)}px)`;
      if (a.scene && a.scene.labelAnchor(l.place, a.anchor)) {
        l.el.style.left = `${a.anchor.x.toFixed(1)}px`;
        l.el.style.top = `${a.anchor.y.toFixed(1)}px`;
        l.el.style.width = `${(w / 3.2).toFixed(0)}px`;
        l.el.classList.remove('fallback');
      } else {
        l.el.classList.add('fallback'); // no 3D: CSS lays the labels out in a row
      }
    }
  }

  function update(dt: number): void {
    const a = active;
    if (!a) return;
    const step = Math.min(0.1, Math.max(0, dt));
    a.t += step;
    a.scene?.update(step, a.t);
    layout(a);
    if (!a.done && a.t >= a.schedule.total) {
      a.done = true;
      a.resolve();
    }
  }

  return { show, hide, update };
}
