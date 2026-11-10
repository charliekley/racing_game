/**
 * The results screen shown after a race: animated standings with each racer's
 * place, colour, name, kart, finish time and best lap, plus clear buttons.
 *
 * Web concept: the rows are plain DOM elements; CSS animations (results.css)
 * slide them in one after another using a per-row `--i` variable as the
 * animation delay. Names come from phones, so they are only ever set with
 * `textContent` (never innerHTML) so nobody can inject HTML.
 */

export interface ResultRow {
  place: number;
  name: string;
  /** Player colour (CSS hex). */
  color: string;
  /** Character and kart name shown under the player's name, e.g. "Pip · Racer". */
  loadoutText: string;
  /** Formatted finish time, or 'DNF'. */
  time: string;
  /** Formatted best lap, or '–'. */
  best: string;
  /** True for the single fastest lap of the race. */
  fastest: boolean;
  finished: boolean;
}

export interface ResultsActions {
  raceAgain(): void;
  changeTrack(): void;
}

const ordinalSuffix = (n: number) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
const CONFETTI = ['#ff4d6d', '#ffbe0b', '#3ddc84', '#3a86ff', '#c77dff', '#ff7a1a'];

export function buildResults(container: HTMLElement, rows: ResultRow[], trackName: string, actions: ResultsActions): void {
  const box = document.createElement('div');
  box.className = 'results-box';

  const head = document.createElement('div');
  head.className = 'res-head';
  head.innerHTML = '<div class="res-flag">RACE COMPLETE</div><h2>Results</h2><div class="res-track"></div>';
  head.querySelector('.res-track')!.textContent = trackName;
  box.appendChild(head);

  const list = document.createElement('ol');
  list.className = 'res-list';
  rows.forEach((row, i) => {
    const li = document.createElement('li');
    li.className = `res-row${row.place === 1 ? ' winner' : ''}${row.finished ? '' : ' dnf'}`;
    li.style.setProperty('--i', String(i));
    li.style.setProperty('--slot-color', row.color);
    li.innerHTML = `
      <span class="res-place"></span>
      <span class="res-dot"></span>
      <span class="res-who"><span class="res-name"></span><span class="res-kart"></span></span>
      <span class="res-time"></span>
      <span class="res-best"></span>`;
    li.querySelector('.res-place')!.innerHTML = `${row.place}<sup>${ordinalSuffix(row.place)}</sup>`;
    li.querySelector('.res-name')!.textContent = row.name;
    li.querySelector('.res-kart')!.textContent = row.loadoutText;
    li.querySelector('.res-time')!.textContent = row.time;
    const best = li.querySelector('.res-best') as HTMLElement;
    best.textContent = row.best;
    best.classList.toggle('fastest', row.fastest);
    if (row.fastest) best.title = 'Fastest lap of the race';
    list.appendChild(li);
  });
  box.appendChild(list);

  const actionsEl = document.createElement('div');
  actionsEl.className = 'res-actions';
  const mk = (label: string, key: string, primary: boolean, fn: () => void) => {
    const b = document.createElement('button');
    b.className = `res-btn${primary ? ' primary' : ''}`;
    b.innerHTML = `${label} <kbd>${key}</kbd>`;
    b.addEventListener('click', fn);
    return b;
  };
  actionsEl.append(mk('RACE AGAIN', 'Enter', true, actions.raceAgain), mk('CHANGE TRACK', 'Esc', false, actions.changeTrack));
  box.appendChild(actionsEl);

  const help = document.createElement('p');
  help.className = 'res-help';
  help.innerHTML = 'Or tap <b>RACE AGAIN</b> on every phone';
  box.appendChild(help);

  // A cheap CSS confetti rain behind the box (24 little rectangles).
  const rain = document.createElement('div');
  rain.className = 'res-confetti';
  for (let i = 0; i < 24; i++) {
    const c = document.createElement('i');
    c.style.left = `${(i * 41) % 100}%`;
    c.style.background = CONFETTI[i % CONFETTI.length];
    c.style.animationDelay = `${(i % 8) * 0.35}s`;
    c.style.animationDuration = `${3.2 + (i % 5) * 0.5}s`;
    rain.appendChild(c);
  }
  container.replaceChildren(rain, box);
}
