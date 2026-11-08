/**
 * DOM rendering for the TV lobby: the 4 player cards plus a live debug readout
 * of each player's input (steering bar, buttons, packet stats, ping).
 *
 * Web concept: the DOM is the browser's tree of page elements. We build the
 * cards once per lobby change (`render`) and then only poke a few text/style
 * values every frame (`updateDebug`), which is cheap.
 */
import { colorHex } from '../shared/colors';
import { BUTTON_NAMES, Buttons } from '../shared/protocol';
import { MAX_PLAYERS, type PlayerManager } from './playerManager';
import { KEY_SCHEMES } from './input/localInput';
import type { PlayerSlot } from './playerSlots';

interface CardRefs {
  fill: HTMLElement;
  pills: Record<string, HTMLElement>;
  stats: HTMLElement;
}

export interface LobbyActions {
  buzz(slot: number): void;
  testItem(slot: number): void;
  kick(slot: number): void;
}

export class LobbyView {
  private cards = new Map<number, CardRefs>();

  constructor(
    private readonly container: HTMLElement,
    private readonly players: PlayerManager,
    private readonly actions: LobbyActions,
  ) {}

  render(): void {
    this.container.replaceChildren();
    this.cards.clear();
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const slot = this.players.slots.slots[i];
      this.container.appendChild(slot ? this.playerCard(slot) : this.emptyCard(i));
    }
  }

  private emptyCard(i: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'slot empty';
    el.textContent = `P${i + 1} — scan to join`;
    return el;
  }

  private playerCard(slot: PlayerSlot): HTMLElement {
    const el = document.createElement('div');
    el.className = 'slot';
    el.style.setProperty('--slot-color', colorHex(slot.color));
    if (slot.ready) el.classList.add('ready');
    if (!slot.connected) el.classList.add('disconnected');

    const device =
      slot.owner.kind === 'phone'
        ? 'phone'
        : slot.owner.kind === 'keyboard'
          ? `keyboard (${KEY_SCHEMES[slot.owner.scheme].label})`
          : slot.owner.kind === 'gamepad'
            ? `gamepad ${slot.owner.index + 1}`
            : 'computer';
    const stateText = !slot.connected ? 'Disconnected – waiting to rejoin' : slot.ready ? 'READY!' : 'Not ready';
    const stateClass = !slot.connected ? 'gone' : slot.ready ? 'ready' : 'waiting';

    el.innerHTML = `
      <div class="slot-head">
        <span class="slot-num">P${slot.index + 1}</span>
        <span class="slot-name"></span>
        <span class="slot-device">${device}</span>
      </div>
      <div class="slot-state ${stateClass}">${stateText}</div>
      <div class="debug">
        <div class="steer-bar"><div class="steer-fill"></div></div>
        <div class="pills"></div>
        <div class="stats"></div>
      </div>
      <div class="slot-actions"></div>`;
    // Names come from phones: set via textContent (never innerHTML) so they can't inject HTML.
    el.querySelector('.slot-name')!.textContent = slot.name;

    const pillsEl = el.querySelector('.pills') as HTMLElement;
    const pills: Record<string, HTMLElement> = {};
    for (const name of BUTTON_NAMES) {
      const p = document.createElement('span');
      p.className = 'pill';
      p.textContent = name;
      pillsEl.appendChild(p);
      pills[name] = p;
    }

    const actionsEl = el.querySelector('.slot-actions') as HTMLElement;
    const addButton = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', fn);
      actionsEl.appendChild(b);
    };
    if (slot.owner.kind === 'phone') {
      addButton('Buzz phone', () => this.actions.buzz(slot.index));
      addButton('Test item', () => this.actions.testItem(slot.index));
    }
    addButton('Remove', () => this.actions.kick(slot.index));

    this.cards.set(slot.index, {
      fill: el.querySelector('.steer-fill') as HTMLElement,
      pills,
      stats: el.querySelector('.stats') as HTMLElement,
    });
    return el;
  }

  /** Called every frame: refresh live input values. */
  updateDebug(): void {
    const now = performance.now();
    for (const [index, refs] of this.cards) {
      const input = this.players.inputFor(index);
      const s = Math.max(-1, Math.min(1, input.steer));
      const w = Math.abs(s) * 50;
      refs.fill.style.left = `${s < 0 ? 50 - w : 50}%`;
      refs.fill.style.width = `${w}%`;
      for (const name of BUTTON_NAMES) refs.pills[name].classList.toggle('on', (input.buttons & Buttons[name]) !== 0);

      const phone = this.players.phoneStats(index);
      let text = `steer ${s >= 0 ? '+' : ''}${s.toFixed(3)}`;
      if (phone) {
        const st = phone.stats;
        const age = st.lastPacketAt ? Math.round(now - st.lastPacketAt) : NaN;
        const total = st.lastSeq + 1;
        const lossPct = total > 0 ? ((st.lost / total) * 100).toFixed(1) : '0.0';
        text +=
          `   seq ${st.lastSeq}\n` +
          `rate ${st.rateHz.toFixed(0).padStart(3)} Hz   lost ${st.lost} (${lossPct}%)   stale ${st.stale}\n` +
          `ping ${phone.rttMs === null ? '–' : phone.rttMs.toFixed(0) + ' ms'}   last pkt ${Number.isNaN(age) ? '–' : age + ' ms ago'}`;
      }
      refs.stats.textContent = text;
    }
  }
}
