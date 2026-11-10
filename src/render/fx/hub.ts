/**
 * A tiny "service locator" so older code that creates its own effects
 * (SparkEmitter inside KartView and CannonView) can feed the one shared
 * particle system instead of owning its own THREE.Points.
 *
 * `GameFx` registers itself here when a race scene is created. Anything that
 * wants to emit particles asks the hub; if nothing is registered (unit tests,
 * kart preview page) the calls simply do nothing.
 */
import type { GameFx } from './gameFx';

export const fxHub: { current: GameFx | null } = { current: null };
