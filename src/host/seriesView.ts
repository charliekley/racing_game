/**
 * TV screens for a series: the final standings (next to the 3D podium), and the "last place picks the next track" strip.
 * Plain DOM like resultsView.ts. Player names come from phones, so they only ever go
 * through `textContent`, never innerHTML.
 */
import type { TrackCard } from '../shared/protocol';
import { crownLabel } from '../shared/wins';
import { COUNT_TIME, ROW_FLIP, prefersReducedMotion, rowTiming, startTicker, countUpJob, type TickJob } from './revealTiming';

export interface PodiumRow {
  name: string;
  /** CSS colour. */
  color: string;
  points: number;
  /** Race wins this session (crown count). */
  wins?: number;
}

/**
 * Final standings of a series, as a table. It sits next to the 3D podium (podiumView.ts), which shows the top
 * three with their karts; this table lists EVERYONE with their points. Rows flip in from last place to first and
 * the points count up, like the scoreboard in resultsView.ts. `onDone` is the BACK TO MENU button.
 */
export function buildPodium(container: HTMLElement, rows: PodiumRow[], title: string, onDone: () => void): void {
  const box = document.createElement('div');
  box.className = 'results-box standings-box';

  const head = document.createElement('div');
  head.className = 'res-head';
  const flag = document.createElement('div');
  flag.className = 'res-flag';
  flag.textContent = title;
  const h = document.createElement('h2');
  h.textContent = 'Standings';
  head.append(flag, h);
  box.appendChild(head);

  const reduced = prefersReducedMotion();
  const timing = rowTiming(rows.length);
  const jobs: TickJob[] = [];
  const list = document.createElement('ol');
  list.className = 'res-list fin-list';
  if (rows.length > 6) list.classList.add('many');
  list.style.setProperty('--t0', `${timing.startOf(0)}s`);
  list.style.setProperty('--step', `${timing.step}s`);
  rows.forEach((row, i) => {
    const r = rows.length - 1 - i; // the last place flips in first
    const li = document.createElement('li');
    li.className = `res-row fin-row${i === 0 ? ' winner' : ''}`;
    li.style.setProperty('--r', String(r));
    li.style.setProperty('--slot-color', row.color);
    const place = document.createElement('span');
    place.className = 'res-place';
    place.textContent = String(i + 1);
    const dot = document.createElement('span');
    dot.className = 'res-dot';
    const name = document.createElement('span');
    name.className = 'res-name';
    const text = document.createElement('span');
    text.className = 'res-name-text';
    text.textContent = row.name; // names come from phones: textContent only
    const crown = document.createElement('span');
    crown.className = 'res-crown';
    crown.textContent = crownLabel(row.wins ?? 0);
    name.append(text, crown);
    const pts = document.createElement('span');
    pts.className = 'fin-pts';
    const fmt = (n: number) => `${n} pts`;
    pts.textContent = fmt(reduced ? row.points : 0);
    if (!reduced) jobs.push(countUpJob(pts, 0, row.points, timing.startOf(r) + ROW_FLIP * 0.5, COUNT_TIME, fmt));
    li.append(place, dot, name, pts);
    list.appendChild(li);
  });
  box.appendChild(list);

  const actions = document.createElement('div');
  actions.className = 'res-actions';
  actions.style.setProperty('--delay', `${(timing.end * 0.7).toFixed(2)}s`);
  const b = document.createElement('button');
  b.className = 'res-btn primary';
  b.textContent = 'BACK TO MENU';
  b.addEventListener('click', onDone);
  actions.appendChild(b);
  box.appendChild(actions);

  container.replaceChildren(box);
  startTicker(box, jobs);
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

  container.replaceChildren(box);
}
