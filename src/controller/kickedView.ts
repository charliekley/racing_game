/**
 * The "Removed from the game" screen: shown when the host pressed the X on this player's quadrant (`kicked` message).
 * A full-screen overlay with one button. The phone stays disconnected until JOIN AGAIN is tapped, so a removed
 * player can never slip back into the game through the automatic reconnect loop.
 */
export class KickedView {
  readonly root: HTMLElement;

  constructor(onJoinAgain: () => void) {
    const root = document.createElement('div');
    root.className = 'overlay kicked hidden';
    root.innerHTML = `
      <div class="kicked-title">Removed from the game</div>
      <button type="button" class="big-btn kicked-btn">JOIN AGAIN</button>`;
    root.querySelector('.kicked-btn')!.addEventListener('click', () => {
      this.hide();
      onJoinAgain();
    });
    this.root = root;
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
