/**
 * Small wrappers around phone/browser features, each failing silently where
 * unsupported (every browser supports a different subset).
 */

/** iPhone/iPad (iPadOS reports itself as a Mac with touch). */
export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

type PermissionFn = () => Promise<'granted' | 'denied'>;

/** iOS 13+ hides motion sensors behind a permission prompt that must be triggered by a tap. */
export function motionPermissionNeeded(): boolean {
  const DM = (window as unknown as { DeviceMotionEvent?: { requestPermission?: PermissionFn } }).DeviceMotionEvent;
  return typeof DM?.requestPermission === 'function';
}

/**
 * Must be called synchronously inside a tap handler (a "user gesture"),
 * otherwise iOS refuses to show the prompt. Both requests are started in the
 * same tick; iOS shows a single "Motion & Orientation Access" dialog.
 */
export function requestMotionPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
  const DM = (window as unknown as { DeviceMotionEvent?: { requestPermission?: PermissionFn } }).DeviceMotionEvent;
  const DO = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: PermissionFn } }).DeviceOrientationEvent;
  if (typeof DM?.requestPermission !== 'function') return Promise.resolve('unsupported');
  const motion = DM.requestPermission();
  const orient = typeof DO?.requestPermission === 'function' ? DO.requestPermission().catch(() => 'denied' as const) : Promise.resolve('granted' as const);
  return Promise.all([motion, orient])
    .then(([m]) => m)
    .catch(() => 'denied' as const);
}

/**
 * How far the screen content is rotated counter-clockwise from the phone's
 * natural portrait orientation: 0, 90, 180 or -90.
 * iOS Safari only has the old `window.orientation`; others have `screen.orientation`.
 */
export function screenOrientationDeg(): number {
  const legacy = (window as unknown as { orientation?: number }).orientation;
  if (typeof legacy === 'number') return legacy;
  const angle = screen.orientation?.angle ?? 0;
  return angle > 180 ? angle - 360 : angle;
}

export function isPortrait(): boolean {
  return window.innerHeight > window.innerWidth;
}

// --- Wake Lock: keep the screen on while playing (shared with the host page) ---
export { enableWakeLock } from '../shared/wakeLock';

/** Fullscreen + landscape lock. Works on Android Chrome; iOS Safari ignores it (that's fine). */
export function tryFullscreenLandscape(): void {
  const el = document.documentElement as HTMLElement & { requestFullscreen?: (o?: FullscreenOptions) => Promise<void> };
  if (isIOS() || document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => {
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      return o.lock?.('landscape');
    })
    .catch(() => {
      /* user agent said no; carry on */
    });
}

/** Vibration (Android only; iOS Safari has no vibrate API). */
export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}

/** Stable random id for this phone, so the host can give it back its slot on reconnect. */
export function getClientId(): string {
  const KEY = 'tiltkart.clientId';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}
