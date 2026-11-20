/**
 * DEV ONLY: a tiny page script (controller/flow-dev.html) that shows the phone's pick screens, or a contact
 * sheet of every portrait and kart picture, without needing a host or a phone. Not part of the game build.
 */
import './controller.css';
import { CHARACTERS, KART_BODIES } from '../shared/characters';
import type { SelectStage } from '../shared/selectStage';
import { drawKartPicture, drawPortrait } from './portrait';
import { SelectFlow } from './selectFlow';

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
} else {
  const flow = new SelectFlow({ select: () => {}, settings: () => {} });
  stage.appendChild(flow.root);
  flow.setHeader(`P1 · ${q.get('name') ?? 'Charlie'}`);
  flow.setVisible(true);
  const picks = { character: Number(q.get('char') ?? 3), kart: Number(q.get('kart') ?? 0) };
  flow.applyHost((q.get('stage') ?? 'character') as SelectStage, q.get('name') ?? 'Charlie', picks, true);
  addEventListener('resize', () => flow.relayout());
  requestAnimationFrame(() => flow.relayout());
}
