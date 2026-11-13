/**
 * TV screens for a series: the final podium, and the "last place picks the next track" strip.
 * Plain DOM like resultsView.ts. Player names come from phones, so they only ever go
 * through `textContent`, never innerHTML.
 */
import type { TrackCard } from '../shared/protocol';

export interface PodiumRow {
  name: string;
  /** CSS colour. */
  color: string;
  points: number;
}

const BAR_HEIGHT = ['100%', '72%', '56%', '42%']; // 1st .. 4th

/** Final standings: the top three on steps (2nd, 1st, 3rd) and any 4th place below. */
export function buildPodium(container: HTMLElement, rows: PodiumRow[], title: string, onDone: () => void): void {
  const box = document.createElement('div');
  box.className = 'results-box podium-box';

  const head = document.createElement('div');
  head.className = 'res-head';
  const flag = document.createElement('div');
  flag.className = 'res-flag';
  flag.textContent = title;
  const h = document.createElement('h2');
  h.textContent = 'Podium';
  head.append(flag, h);
  box.appendChild(head);

  const steps = document.createElement('div');
  steps.className = 'podium-steps';
  // Visual order: 2nd, 1st, 3rd (like a real podium).
  for (const i of [1, 0, 2]) {
    const r = rows[i];
    if (!r) continue;
    const step = document.createElement('div');
    step.className = `podium-step place-${i + 1}`;
    step.style.setProperty('--slot-color', r.color);
    step.style.setProperty('--i', String(2 - i));
    const name = document.createElement('div');
    name.className = 'podium-name';
    name.textContent = r.name;
    const bar = document.createElement('div');
    bar.className = 'podium-bar';
    bar.style.height = BAR_HEIGHT[i];
    const place = document.createElement('b');
    place.textContent = String(i + 1);
    const pts = document.createElement('span');
    pts.textContent = `${r.points} pts`;
    bar.append(place, pts);
    step.append(name, bar);
    steps.appendChild(step);
  }
  box.appendChild(steps);

  if (rows[3]) {
    const fourth = document.createElement('div');
    fourth.className = 'podium-fourth';
    fourth.style.setProperty('--slot-color', rows[3].color);
    fourth.textContent = `4  ${rows[3].name}  ${rows[3].points} pts`;
    box.appendChild(fourth);
  }

  const actions = document.createElement('div');
  actions.className = 'res-actions';
  const b = document.createElement('button');
  b.className = 'res-btn primary';
  b.innerHTML = 'BACK TO MENU <kbd>Enter</kbd>';
  b.addEventListener('click', onDone);
  actions.appendChild(b);
  box.appendChild(actions);

  container.replaceChildren(box);
}

export interface PickState {
  /** Name of the player who must choose (last place). */
  who: string;
  cards: TrackCard[];
  /** Highlighted card (moved with the arrow keys on the TV, or by tapping a card). */
  selected: number;
}

/** The strip of track tiles shown over the results while the last-place player chooses. */
export function buildPickStrip(container: HTMLElement, st: PickState, onChoose: (i: number) => void): void {
  const box = document.createElement('div');
  box.className = 'pick-strip';

  const title = document.createElement('div');
  title.className = 'pick-title';
  const who = document.createElement('b');
  who.textContent = st.who;
  title.append(who, ' picks the next track');
  box.appendChild(title);

  const row = document.createElement('div');
  row.className = 'pick-row';
  st.cards.forEach((c, i) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `pick-tile${i === st.selected ? ' on' : ''}`;
    const img = document.createElement('img');
    img.src = c.img; // our own data URL, drawn by the host
    img.alt = '';
    const name = document.createElement('span');
    name.textContent = c.name;
    tile.append(img, name);
    tile.addEventListener('click', () => onChoose(i));
    row.appendChild(tile);
  });
  box.appendChild(row);

  const hint = document.createElement('div');
  hint.className = 'pick-hint';
  hint.innerHTML = '<kbd>&larr;</kbd><kbd>&rarr;</kbd> choose &nbsp; <kbd>Enter</kbd> go &nbsp; <kbd>S</kbd> stop &amp; podium';
  box.appendChild(hint);

  container.replaceChildren(box);
}
