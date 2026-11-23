/**
 * The TV's SETTINGS panel: a clean overlay with one row per setting (Racers, Bot difficulty, Graphics, Sound).
 * It is only a VIEW: main.ts owns the settings (and saves them); this file draws the rows, reports clicks and
 * highlights whatever `get()` says is current. Everything is mouse-clickable.
 *
 * Web concept: an "overlay" is a full-screen element on top of the page (position: fixed). Clicking the dark area
 * around the box (or the CLOSE button, or the Escape key) closes it.
 */

/** One row of the panel: a label, an explanation, and a few choices that act like radio buttons. */
export interface SettingRow {
  label: string;
  /** One short line under the label (may be empty). */
  note: string;
  options: { id: string; label: string }[];
  /** The id of the option that is on right now. */
  get(): string;
  /** The player clicked an option. */
  set(id: string): void;
}

export class SettingsPanel {
  readonly root: HTMLElement;
  private readonly buttons: { row: SettingRow; id: string; el: HTMLButtonElement }[] = [];

  constructor(rows: readonly SettingRow[]) {
    const root = document.createElement('div');
    root.className = 'settings-overlay hidden';
    root.innerHTML = `
      <div class="settings-box" role="dialog" aria-label="Settings">
        <h2>SETTINGS</h2>
        <div class="settings-rows"></div>
        <button type="button" class="settings-close">CLOSE</button>
      </div>`;
    this.root = root;
    const list = root.querySelector('.settings-rows') as HTMLElement;
    for (const row of rows) {
      const el = document.createElement('div');
      el.className = 'settings-row';
      const text = document.createElement('div');
      text.className = 'settings-text';
      const label = document.createElement('b');
      label.textContent = row.label;
      const note = document.createElement('small');
      note.textContent = row.note;
      text.append(label, note);
      const choices = document.createElement('div');
      choices.className = 'settings-choices';
      for (const o of row.options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = o.label;
        b.addEventListener('click', () => {
          row.set(o.id);
          this.refresh();
          b.blur();
        });
        choices.appendChild(b);
        this.buttons.push({ row, id: o.id, el: b });
      }
      el.append(text, choices);
      list.appendChild(el);
    }
    // Click on the dark background (not on the box) or CLOSE closes the panel.
    root.addEventListener('click', (e) => {
      if (e.target === root) this.close();
    });
    (root.querySelector('.settings-close') as HTMLElement).addEventListener('click', () => this.close());
    document.body.appendChild(root);
    this.refresh();
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(): void {
    this.refresh();
    this.root.classList.remove('hidden');
  }

  close(): void {
    this.root.classList.add('hidden');
  }

  /** Re-read the current values (call after a setting changed somewhere else, e.g. a keyboard shortcut). */
  refresh(): void {
    for (const b of this.buttons) b.el.classList.toggle('on', b.row.get() === b.id);
  }
}
