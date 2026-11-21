/**
 * The results screen shown after a race: animated standings with each racer's
 * place, colour, name, kart, finish time and best lap, plus clear buttons.
 *
 * Web concept: the rows are plain DOM elements; CSS animations (results.css)
 * flip them in one after another, LAST place first, using per-row CSS variables
 * (`--r` = order of appearance, `--step` = gap between rows) as the animation delay.
 * CSS cannot count a number up, so the "+N" points and the standings totals are
 * counted by a small frame ticker (revealTiming.ts). The whole reveal takes about
 * SCOREBOARD_REVEAL_SECONDS (postRace.ts). With prefers-reduced-motion the final
 * numbers are shown straight away.
 *
 * Names come from phones, so they are only ever set with `textContent` (never
 * innerHTML) so nobody can inject HTML. Crowns (race wins, shared/wins.ts) go next
 * to names the same way.
 */
import { crownLabel } from '../shared/wins';
import { countUpJob, prefersReducedMotion, rowTiming, startTicker, type TickJob, COUNT_TIME, ROW_FLIP } from './revealTiming';

export interface ResultRow {
  /** Player slot, used to look up series points. */
  slot?: number;
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
  /** Race wins this session INCLUDING this race (crown count, see shared/wins.ts). */
  wins?: number;
}

/** Extra information for Grand Prix / Loser-picks results (see seriesHost.ts). Absent for a single race. */
export interface ResultsExtras {
  /** Small title above "Results", e.g. "GRAND PRIX 2/4". */
  heading: string;
  /** Points each slot earned in this race. */
  gain: Map<number, number>;
  /** Running standings, best first. */
  standings: { name: string; color: string; points: number; wins?: number }[];
  /** Label of the main button (e.g. "NEXT RACE"); empty hides it. */
  primary: string;
  secondary: string;
  /** One line under the buttons, e.g. who picks next. */
  note: string;
  /** Grand Prix: seconds until the next race starts by itself (the screen shows a countdown); absent = no countdown. */
  autoNextSeconds?: number;
}

export interface ResultsActions {
  raceAgain(): void;
  changeTrack(): void;
}

const ordinalSuffix = (n: number) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
const CONFETTI = ['#ff4d6d', '#ffbe0b', '#3ddc84', '#3a86ff', '#c77dff', '#ff7a1a'];

export function buildResults(
  container: HTMLElement,
  rows: ResultRow[],
  trackName: string,
  actions: ResultsActions,
  extras?: ResultsExtras,
  /** Small title above "Results" for a plain race (e.g. "KNOCKOUT"); default "RACE COMPLETE". */
  flag?: string,
): void {
  const box = document.createElement('div');
  box.className = 'results-box';

  const head = document.createElement('div');
  head.className = 'res-head';
  head.innerHTML = '<div class="res-flag">RACE COMPLETE</div><h2>Results</h2><div class="res-track"></div>';
  head.querySelector('.res-track')!.textContent = trackName;
  if (extras) head.querySelector('.res-flag')!.textContent = extras.heading;
  else if (flag) head.querySelector('.res-flag')!.textContent = flag;
  box.appendChild(head);

  const reduced = prefersReducedMotion();
  const timing = rowTiming(rows.length);
  const jobs: TickJob[] = [];

  const list = document.createElement('ol');
  list.className = extras ? 'res-list with-pts' : 'res-list';
  if (rows.length > 6) list.classList.add('many'); // 8 or 12 racers: tighter rows (see results.css)
  list.style.setProperty('--t0', `${timing.startOf(0)}s`);
  list.style.setProperty('--step', `${timing.step}s`);
  rows.forEach((row, i) => {
    const r = rows.length - 1 - i; // order of appearance: the last place flips in first
    const li = document.createElement('li');
    li.className = `res-row${row.place === 1 ? ' winner' : ''}${row.finished ? '' : ' dnf'}`;
    li.style.setProperty('--r', String(r));
    li.style.setProperty('--slot-color', row.color);
    li.innerHTML = `
      <span class="res-place"></span>
      <span class="res-dot"></span>
      <span class="res-who"><span class="res-name"><span class="res-name-text"></span><span class="res-crown"></span></span><span class="res-kart"></span></span>
      <span class="res-time"></span>
      <span class="res-best"></span>
      ${extras ? '<span class="res-pts"></span>' : ''}`;
    if (extras) {
      // "+N" ticks up from +0 just after the row has flipped in.
      const pts = li.querySelector('.res-pts') as HTMLElement;
      const gain = extras.gain.get(row.slot ?? -1) ?? 0;
      pts.textContent = reduced ? `+${gain}` : '+0';
      if (!reduced) jobs.push(countUpJob(pts, 0, gain, timing.startOf(r) + ROW_FLIP * 0.5, COUNT_TIME, (n) => `+${n}`));
    }
    li.querySelector('.res-place')!.innerHTML = `${row.place}<sup>${ordinalSuffix(row.place)}</sup>`;
    li.querySelector('.res-name-text')!.textContent = row.name;
    li.querySelector('.res-crown')!.textContent = crownLabel(row.wins ?? 0);
    li.querySelector('.res-kart')!.textContent = row.loadoutText;
    li.querySelector('.res-time')!.textContent = row.time;
    const best = li.querySelector('.res-best') as HTMLElement;
    best.textContent = row.best;
    best.classList.toggle('fastest', row.fastest);
    if (row.fastest) best.title = 'Fastest lap of the race';
    list.appendChild(li);
  });
  box.appendChild(list);

  // Grand Prix / Loser picks: the running standings as a row of chips (names are set with textContent).
  // They pop in after the rows (last to first) and their totals count up from the points before this race.
  if (extras) {
    const st = document.createElement('div');
    st.className = 'res-standings';
    const chipStart = Math.max(0.3, timing.end * 0.45);
    const chipStep = Math.min(0.25, Math.max(0.06, (timing.end - chipStart - COUNT_TIME) / Math.max(1, extras.standings.length - 1)));
    st.style.setProperty('--t0', `${chipStart}s`);
    st.style.setProperty('--step', `${chipStep}s`);
    const n = extras.standings.length;
    extras.standings.forEach((r, i) => {
      const chip = document.createElement('span');
      chip.className = 'res-chip';
      chip.style.setProperty('--slot-color', r.color);
      chip.style.setProperty('--r', String(n - 1 - i));
      const rank = document.createElement('b');
      rank.textContent = String(i + 1);
      const name = document.createElement('span');
      name.className = 'res-chip-name';
      name.textContent = r.name;
      const crown = document.createElement('span');
      crown.className = 'res-crown';
      crown.textContent = crownLabel(r.wins ?? 0);
      const pts = document.createElement('em');
      const fmt = (v: number) => `${v} pts`;
      // The points before this race: this race's gain taken off (found by name + colour; unknown = count from 0).
      const prev = previousPoints(r, rows, extras);
      pts.textContent = fmt(reduced ? r.points : prev);
      if (!reduced) jobs.push(countUpJob(pts, prev, r.points, chipStart + (n - 1 - i) * chipStep + 0.2, COUNT_TIME, fmt));
      chip.append(rank, name, crown, pts);
      st.appendChild(chip);
    });
    box.appendChild(st);
  }

  const actionsEl = document.createElement('div');
  actionsEl.className = 'res-actions';
  actionsEl.style.setProperty('--delay', `${(timing.end * 0.7).toFixed(2)}s`);
  const mk = (label: string, key: string, primary: boolean, fn: () => void) => {
    const b = document.createElement('button');
    b.className = `res-btn${primary ? ' primary' : ''}`;
    b.innerHTML = `${label} <kbd>${key}</kbd>`;
    b.addEventListener('click', fn);
    return b;
  };
  if (!extras) {
    actionsEl.append(mk('RACE AGAIN', 'Enter', true, actions.raceAgain), mk('CHANGE TRACK', 'Esc', false, actions.changeTrack));
  } else {
    if (extras.primary) actionsEl.append(mk(extras.primary, 'Enter', true, actions.raceAgain));
    actionsEl.append(mk(extras.secondary, 'Esc', false, actions.changeTrack));
  }
  box.appendChild(actionsEl);

  const help = document.createElement('p');
  help.className = 'res-help';
  if (extras) help.textContent = extras.note;
  else help.innerHTML = 'Or tap <b>RACE AGAIN</b> on every phone';
  box.appendChild(help);

  // Grand Prix: a slim bar and a number counting down to the next race (the flow side starts the race itself).
  if (extras?.autoNextSeconds && extras.autoNextSeconds > 0) {
    const secs = extras.autoNextSeconds;
    const next = document.createElement('div');
    next.className = 'res-next';
    const label = document.createElement('span');
    label.textContent = 'NEXT RACE';
    const num = document.createElement('b');
    num.textContent = String(Math.ceil(secs));
    const bar = document.createElement('i');
    const fill = document.createElement('u');
    fill.style.animationDuration = `${secs}s`;
    bar.appendChild(fill);
    next.append(label, num, bar);
    box.appendChild(next);
    // Whole seconds left, written only when the number changes.
    let shown = Math.ceil(secs);
    jobs.push((t) => {
      const left = Math.max(0, Math.ceil(secs - t));
      if (left !== shown) {
        shown = left;
        num.textContent = String(left);
      }
      return t >= secs;
    });
  }

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
  startTicker(box, jobs);
}

/** A chip's points before this race: its total minus the gain of the row with the same name and colour (0 gain if none matches). */
function previousPoints(chip: { name: string; color: string; points: number }, rows: ResultRow[], extras: ResultsExtras): number {
  const row = rows.find((r) => r.name === chip.name && r.color === chip.color);
  const gain = row ? extras.gain.get(row.slot ?? -1) ?? 0 : 0;
  return Math.max(0, chip.points - gain);
}
