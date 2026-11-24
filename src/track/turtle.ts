/**
 * The "turtle": a tiny route writer for tracks. A turtle stands on the road, heading somewhere, and obeys commands:
 * `line(len, dy)` drives straight, `turn(r, deg, dy)` drives a circle arc (positive = right turn, negative = left turn),
 * `mark(name)` names the point it stands on. It writes the control points [x, z, height], so every bend is an exact
 * circle arc with a known radius and a route can be re-shaped by changing a few numbers. (Mushroom Valley and Rainbow
 * Route are written with it.)
 */

/** A control point, optionally named so features can refer to it. */
export interface RoutePoint {
  name?: string;
  p: [number, number, number];
  /** Compass heading of the road here (degrees, 0 = north, 90 = east). */
  heading: number;
}

// ---------------------------------------------------------------------------
// The turtle
// ---------------------------------------------------------------------------

/** Longest distance (m) between two control points on a straight, and the longest on a bend. */
export const STEP = 24;

/** The angle (degrees) of a circle arc of radius r that is `len` metres long. */
export const arcDeg = (len: number, r: number): number => (len / r) * (180 / Math.PI);

export class Turtle {
  readonly route: RoutePoint[] = [];
  /** Where the turtle is: x, z, height (m) and compass heading (degrees). */
  constructor(
    public x: number,
    public z: number,
    public y: number,
    public heading: number,
  ) {
    this.push();
  }

  private push(name?: string): void {
    this.route.push({ name, p: [this.x, this.z, this.y], heading: this.heading });
  }

  /** Name the point the turtle stands on (the last one written). */
  mark(name: string): this {
    this.route[this.route.length - 1].name = name;
    return this;
  }

  /** Drive straight for `len` metres while the height changes by `dy`. */
  line(len: number, dy = 0): this {
    const n = Math.max(1, Math.ceil(len / STEP));
    const h = (this.heading * Math.PI) / 180;
    for (let k = 1; k <= n; k++) {
      this.x += (Math.sin(h) * len) / n;
      this.z += (Math.cos(h) * len) / n;
      this.y += dy / n;
      this.push();
    }
    return this;
  }

  /** An S-bend: `len` metres in all, swinging `deg` degrees one way and then back (so the heading is unchanged). */
  wiggle(len: number, dy: number, deg: number): this {
    const r = len / 2 / ((deg * Math.PI) / 180);
    return this.turn(r, deg, dy / 2).turn(r, -deg, dy / 2);
  }

  /**
   * Drive a circle arc of radius `r` through `deg` degrees: positive = right turn (clockwise seen from above), negative
   * = left turn. `dy` is the height change over the whole arc.
   */
  turn(r: number, deg: number, dy = 0): this {
    const len = (Math.abs(deg) * Math.PI * r) / 180;
    const n = Math.max(1, Math.ceil(len / STEP), Math.ceil(Math.abs(deg) / 22));
    const side = deg > 0 ? 1 : -1; // +1: the centre of the circle is on the right
    const h0 = (this.heading * Math.PI) / 180;
    // Centre of the circle: r metres to the right (or left) of the turtle.
    const cx = this.x + side * r * Math.cos(h0);
    const cz = this.z - side * r * Math.sin(h0);
    for (let k = 1; k <= n; k++) {
      const h = h0 + ((deg * Math.PI) / 180) * (k / n);
      this.x = cx - side * r * Math.cos(h);
      this.z = cz + side * r * Math.sin(h);
      this.y += dy / n;
      this.heading = (h * 180) / Math.PI;
      this.push();
    }
    return this;
  }
}

