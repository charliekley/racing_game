/**
 * Dev page for the post-race screens: the 3D podium next to a fake scoreboard, with made-up data.
 *
 *   /host/podium-dev.html?n=3&mode=gp&racers=12
 *
 *   n        1..3   how many racers stand on the podium (default 3)
 *   mode     single | gp | final   single race results, a Grand Prix race (standings + countdown), or the final standings
 *   racers   4..12  how many rows the scoreboard has (default 6)
 *   wins     0..9   crown count of the winner (others get fewer)
 *   manual   1      do not run by itself: call __dev.advance(seconds) to step the 3D podium (for screenshots)
 *   seed     N      shifts which characters and karts are used
 *
 * In the console: __dev.replay() shows everything again.
 */
import '../host/host.css';
import '../host/series.css'; // (main.ts loads it too: points column, standings chips)
import { CHARACTERS, KART_BODIES } from '../shared/characters';
import { colorHex } from '../shared/colors';
import { createPodium } from '../host/podiumView';
import { buildResults, type ResultRow } from '../host/resultsView';
import { buildPodium } from '../host/seriesView';
import type { PodiumEntry } from '../host/postRace';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => {
  const v = Number(q.get(k));
  return Number.isFinite(v) && q.has(k) ? v : d;
};
const N = Math.max(1, Math.min(3, num('n', 3)));
const RACERS = Math.max(N, Math.min(12, num('racers', 6)));
const MODE = q.get('mode') ?? 'single';
const SEED = num('seed', 0);
const WINS = Math.max(0, num('wins', 2));
const NAMES = ['Ada', 'Marko', 'Priya', 'Tomasz', 'Lena', 'Quentin', 'Bo', 'Rosalind-Maria', 'Yusuf', 'Ines', 'Dmitri', 'CPU 7'];

const game = document.getElementById('game') as HTMLDivElement;
game.style.background = 'radial-gradient(circle at 30% 20%, #26306b 0%, #0f1226 60%)';

// Fake race: racer i finishes in place i + 1.
const rows: ResultRow[] = Array.from({ length: RACERS }, (_, i) => ({
  slot: i,
  place: i + 1,
  name: NAMES[i],
  color: colorHex(i),
  loadoutText: `${CHARACTERS[(i + SEED) % 8].name} · ${KART_BODIES[(i + SEED) % 4].name}`,
  time: `1:${String(10 + i * 2).padStart(2, '0')}.${(i * 37) % 100}`.replace(/\.(\d)$/, '.0$1'),
  best: `0:${String(21 + i).padStart(2, '0')}.4${i}`,
  fastest: i === 2,
  finished: i < RACERS - 1,
  wins: Math.max(0, WINS - i),
}));
const entries: PodiumEntry[] = rows.slice(0, N).map((r, i) => ({
  slot: r.slot!,
  place: (i + 1) as 1 | 2 | 3,
  name: r.name,
  color: r.color,
  loadout: { character: (i * 3 + SEED + 1) % 8, kart: (i + SEED) % 4 },
  wins: r.wins ?? 0,
  points: MODE === 'single' ? null : 38 - i * 7,
}));

const podiumEl = document.createElement('div');
const layer = document.createElement('div');
// `beside-podium` moves the scoreboard to the right part of the screen while a podium is shown (podium.css).
// A Grand Prix race that is not the last has no podium, so its scoreboard keeps the whole width.
layer.className = MODE === 'final' ? 'results series-layer beside-podium' : MODE === 'gp' ? 'results' : 'results beside-podium';
game.append(layer, podiumEl);
const podium = createPodium(podiumEl);

function showAll(): void {
  const gain = new Map(rows.map((_r, i) => [i, Math.max(0, 10 - i * 2)]));
  if (MODE === 'final') {
    buildPodium(
      layer,
      rows.map((r, i) => ({ name: r.name, color: r.color, points: 38 - i * 5, wins: r.wins })),
      'GRAND PRIX · 4 RACES',
      () => {},
    );
  } else {
    buildResults(
      layer,
      rows,
      'Ember Run',
      { raceAgain: () => {}, changeTrack: () => {} },
      MODE === 'gp'
        ? {
            heading: 'GRAND PRIX 2/4',
            gain,
            standings: rows.map((r, i) => ({ name: r.name, color: r.color, points: 30 - i * 4, wins: r.wins })),
            primary: '',
            secondary: 'MENU',
            note: '',
            autoNextSeconds: 10,
          }
        : undefined,
    );
  }
  if (MODE === 'gp') {
    // A Grand Prix race that is not the last has no podium: the scoreboard alone.
    podium.hide();
    return;
  }
  void podium.show(entries, MODE === 'final' ? '' : 'EMBER RUN').then(() => ((window as unknown as { __revealed: boolean }).__revealed = true));
}

let last = performance.now();
const manual = q.get('manual') === '1';
function loop(now: number): void {
  podium.update(Math.min(0.1, (now - last) / 1000));
  last = now;
  if (!manual) requestAnimationFrame(loop);
}
if (!manual) requestAnimationFrame(loop);

(window as unknown as { __dev: unknown }).__dev = {
  replay: () => {
    (window as unknown as { __revealed: boolean }).__revealed = false;
    showAll();
  },
  /** Step the podium by `seconds` in 1/30 s frames (for screenshots with ?manual=1). */
  advance: (seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += 1 / 30) podium.update(Math.min(1 / 30, seconds - t));
  },
};
showAll();
