/**
 * Screen Wake Lock: keep the screen (and the laptop) from dimming or sleeping while the game runs,
 * the same browser feature video-streaming sites use.
 *
 * Web concept: `navigator.wakeLock.request('screen')` asks the browser to keep the display on.
 * It only works on secure pages (https or localhost) and only while the tab is visible: the browser
 * drops the lock whenever you switch tabs or minimise, so we take it back when the tab returns.
 * Browsers without the API (older Safari) simply ignore it.
 */
type Sentinel = { release(): Promise<void> } & Partial<EventTarget>;
type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> };

let lock: Sentinel | null = null;
let wanted = false;

/** Ask for the screen to stay on (safe to call many times). */
export async function enableWakeLock(): Promise<void> {
  wanted = true;
  const api = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;
  if (!api || lock || document.visibilityState !== 'visible') return;
  try {
    lock = await api.request('screen');
    lock.addEventListener?.('release', () => (lock = null));
  } catch {
    /* not allowed right now (e.g. battery saver); retried on the next visibility change or click */
  }
}

// The browser drops the lock whenever the tab is hidden: take it back when it is shown again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wanted) {
    lock = null;
    void enableWakeLock();
  }
});
