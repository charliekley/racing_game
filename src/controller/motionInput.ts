/**
 * Reads the phone's motion sensors and turns them into a steering value and
 * trick events.
 *
 * Web concept: the browser fires a `devicemotion` event ~60 times/second with
 * accelerometer readings. `accelerationIncludingGravity` is the raw
 * accelerometer (gravity + your hand's motion); `acceleration` has gravity
 * removed (not available on every device).
 *
 * Desktop fallback: if no motion events arrive (laptop browser), arrow keys /
 * A,D steer so you can test the controller page without a phone.
 */
import { screenOrientationDeg } from './device';
import { SteeringProcessor, type SteeringSettings } from './steering';
import { TrickDetector } from './trick';

export class MotionInput {
  readonly steering: SteeringProcessor;
  private trick = new TrickDetector();
  private lastEventAt = 0;
  private started = false;
  private eventCount = 0;
  private rateWindowStart = performance.now();

  /** Latest values, read by the send loop. */
  steer = 0;
  angleDeg = 0;
  validPose = true;
  orientationDeg = 0;
  /** Motion events per second (for the debug overlay). */
  eventRateHz = 0;
  /** True when at least one real sensor reading has arrived. */
  hasSensor = false;
  /** Called on each detected flick. */
  onTrick: () => void = () => {};

  // Desktop keyboard fallback
  private keyLeft = false;
  private keyRight = false;
  private keySteer = 0;

  constructor(settings: SteeringSettings) {
    this.steering = new SteeringProcessor(settings);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener('devicemotion', (e) => this.onMotion(e));
    window.addEventListener('keydown', (e) => this.onKey(e.code, true));
    window.addEventListener('keyup', (e) => this.onKey(e.code, false));
  }

  calibrate(): void {
    this.steering.calibrate();
  }

  /** If no sensor, ramp keyboard steering. Call from the send loop. */
  tickFallback(dtMs: number): void {
    if (this.hasSensor) return;
    const target = (this.keyRight ? 1 : 0) - (this.keyLeft ? 1 : 0);
    const step = dtMs / 200;
    this.keySteer += Math.max(-step, Math.min(step, target - this.keySteer));
    this.steer = this.keySteer;
    this.angleDeg = this.keySteer * this.steering.settings.maxAngleDeg;
  }

  private onKey(code: string, down: boolean): void {
    if (code === 'ArrowLeft' || code === 'KeyA') this.keyLeft = down;
    if (code === 'ArrowRight' || code === 'KeyD') this.keyRight = down;
  }

  private onMotion(e: DeviceMotionEvent): void {
    const g = e.accelerationIncludingGravity;
    // Desktop Chrome fires one event with all-null values; ignore those.
    if (!g || g.x === null || g.y === null || g.z === null) return;
    const now = performance.now();
    const dt = this.lastEventAt ? Math.min(100, now - this.lastEventAt) : 16;
    this.lastEventAt = now;
    this.hasSensor = true;

    this.orientationDeg = screenOrientationDeg();
    const sample = this.steering.update(g.x, g.y, this.orientationDeg, dt);
    this.steer = sample.steer;
    this.angleDeg = sample.angleDeg;
    this.validPose = sample.valid;

    const a = e.acceleration;
    const linear: [number, number, number] | null =
      a && a.x !== null && a.y !== null && a.z !== null ? [a.x, a.y, a.z] : null;
    if (this.trick.update(linear, [g.x, g.y, g.z], now, dt)) this.onTrick();

    this.eventCount++;
    if (now - this.rateWindowStart >= 1000) {
      this.eventRateHz = (this.eventCount * 1000) / (now - this.rateWindowStart);
      this.eventCount = 0;
      this.rateWindowStart = now;
    }
  }
}
