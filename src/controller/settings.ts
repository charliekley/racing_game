/** Controller preferences, saved on the phone (localStorage survives reloads). */
import { DEFAULT_STEERING, type SteeringSettings } from './steering';

export interface ControllerPrefs {
  name: string;
  color: number;
  steering: SteeringSettings;
  showDebug: boolean;
}

const KEY = 'tiltkart.controllerPrefs';

export function loadPrefs(): ControllerPrefs {
  const defaults: ControllerPrefs = { name: '', color: 0, steering: { ...DEFAULT_STEERING }, showDebug: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const p = JSON.parse(raw) as Partial<ControllerPrefs>;
    return {
      name: typeof p.name === 'string' ? p.name : '',
      color: typeof p.color === 'number' ? p.color : 0,
      steering: { ...DEFAULT_STEERING, ...(p.steering ?? {}) },
      showDebug: !!p.showDebug,
    };
  } catch {
    return defaults;
  }
}

export function savePrefs(p: ControllerPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode etc. */
  }
}
