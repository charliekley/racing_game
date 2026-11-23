/**
 * DEV ONLY: a tiny page script (controller/flow-dev.html) that shows the phone's pick screens, or a contact
 * sheet of every portrait and kart picture, without needing a host or a phone. Not part of the game build.
 */
import './controller.css';
import { CHARACTERS, KART_BODIES } from '../shared/characters';
import type { SelectStage } from '../shared/selectStage';
import { drawKartPicture, drawPortrait } from './portrait';
import { KickedView } from './kickedView';
import { SelectFlow } from './selectFlow';
import { SeriesMenu } from './seriesMenu';

const q = new URLSearchParams(location.search);
const stage = document.getElementById('stage') as HTMLElement;

if (q.has('sheet')) {
  // Contact sheet: each driver big (160 px) and small (44 px), then each kart body in the first driver's paint.
  stage.style.cssText = 'position:static;transform:none;width:auto;height:auto;overflow:auto;padding:8px;container-type:normal';
  document.body.style.cssText = 'position:static;overflow:auto;height:auto';
  document.documentElement.style.cssText = 'position:static;overflow:auto;height:auto';
  const row = (kids: HTMLElement[]) => {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;gap:8px;align-items:flex-end;margin-bottom:8px;flex-wrap:wrap';
    d.append(...kids);
    stage.appendChild(d);
  };
  const cv = (w: number, h: number) => {
    const c = document.createElement('canvas');
    c.width = w * 2;
    c.height = h * 2;
    c.style.cssText = `width:${w}px;height:${h}px;background:#0f1226`;
    return c;
  };
  row(
    CHARACTERS.map((ch) => {
      const c = cv(150, 150);
      drawPortrait(c, ch.look);
      return c;
    }),
  );
  row(
    CHARACTERS.map((ch) => {
      const c = cv(44, 44);
      drawPortrait(c, ch.look);
      return c;
    }),
  );
  // every kart body in two drivers' paints
  for (const who of [3, 6, 0, 7]) {
    row(
      KART_BODIES.map((_, k) => {
        const c = cv(160, 100);
        drawKartPicture(c, k, who);
        return c;
      }),
    );
  }
} else if (q.has('kicked')) {
  // ?kicked: the "Removed from the game" screen.
  const kicked = new KickedView(() => kicked.hide());
  stage.appendChild(kicked.root);
  kicked.show();
} else if (q.has('menu')) {
  // ?menu: the mode menu (what P1 sees after joining), without track pictures.
  const menu = new SeriesMenu({ setMode: () => {}, setTrack: () => {}, pick: () => {}, stop: () => {}, finish: () => {} });
  stage.appendChild(menu.root);
  const info = { mode: 'single' as const, track: 0, stage: 'menu' as const, owner: 0, picker: null, racesDone: 0, raceTotal: null, standings: [], pending: true };
  menu.update(info, null, false);
  menu.sync('setup');
} else {
  const flow = new SelectFlow({ select: () => {}, settings: () => {} });
  stage.appendChild(flow.root);
  flow.setHeader(`P1 · ${q.get('name') ?? 'Charlie'}`);
  flow.setVisible(true);
  const picks = { character: Number(q.get('char') ?? 3), kart: Number(q.get('kart') ?? 0) };
  flow.applyHost((q.get('stage') ?? 'character') as SelectStage, q.get('name') ?? 'Charlie', picks, true);
  // ?post=choose | wait: the READY screen as it looks after a race (CHANGE + READY, or the Grand Prix standings), with crowns.
  const post = q.get('post');
  if (post === 'choose' || post === 'wait') {
    const mk = (slot: number, name: string, ready: boolean, wins: number) => ({ slot, name, color: slot, connected: true, ready, stage: 'ready' as const, wins });
    flow.setPlayers([mk(0, q.get('name') ?? 'Charlie', true, 2), mk(1, 'Eli', false, 0), mk(2, 'Fay', true, 1)], 0);
    flow.setPost(post, post === 'choose' ? 'READY?' : 'NEXT RACE');
    if (post === 'choose') {
      const btn = document.createElement('button');
      btn.className = 'ready-btn';
      btn.textContent = 'READY';
      flow.readySlot.appendChild(btn);
    } else {
      const names = ['Charlie', 'Pip', 'Eli', 'Rex', 'Fay', 'Mochi', 'Bolt', 'Sable 2', 'Bruno', 'Juno', 'Fizz', 'Rex 2'];
      flow.setStandings(names.map((n, i) => ({ rank: i + 1, name: n, wins: i === 0 ? 2 : i === 1 ? 1 : 0, points: 40 - i * 3, me: i === 0 })));
    }
  }
  addEventListener('resize', () => flow.relayout());
  requestAnimationFrame(() => flow.relayout());
}
