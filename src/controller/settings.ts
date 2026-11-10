/** Controller preferences, saved on the phone (localStorage survives reloads). */
import { DEFAULT_LOADOUT, sanitizeLoadout, type Loadout } from '../shared/characters';
import { DEFAULT_STEERING, type SteeringSettings } from './steering';

export interface ControllerPrefs {
  name: string;
  color: number;
  steering: SteeringSettings;
  showDebug: boolean;
  /** Chosen driver and kart body (indices into CHARACTERS / KART_BODIES). */
  loadout: Loadout;
}

const KEY = 'tiltkart.controllerPrefs';

export function loadPrefs(): ControllerPrefs {
  const defaults: ControllerPrefs = { name: '', color: 0, steering: { ...DEFAULT_STEERING }, showDebug: false, loadout: { ...DEFAULT_LOADOUT } };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const p = JSON.parse(raw) as Partial<ControllerPrefs>;
    return {
      name: typeof p.name === 'string' ? p.name : '',
      color: typeof p.color === 'number' ? p.color : 0,
      steering: { ...DEFAULT_STEERING, ...(p.steering ?? {}) },
      showDebug: !!p.showDebug,
      loadout: sanitizeLoadout(p.loadout), // missing/garbled -> the default
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
