/**
 * Wheel geometry: rubber tyre with tread and a bulging sidewall, a rim with a
 * lip and spokes, brake disc, hub and lug nuts. The whole wheel is ONE merged,
 * vertex-coloured geometry (1 draw call per wheel), axle along X, outer face
 * toward +X (left wheels are built mirrored so their outer face points -X).
 */
import * as THREE from 'three';
import { PartBuilder, SURF, capsule, lathe, sphere, shade, type Place, type Surf } from './geo';
import { PAL } from './materials';

export interface WheelSpec {
  radius: number;
  width: number;
  /** Rim / spoke colour. */
  rim: string;
  /** sport = twin-spoke alloy, knob = off-road knobbly tyre + beadlock bolts, retro = whitewall + hubcap. */
  kind: 'sport' | 'knob' | 'retro';
  spokes?: number;
  /** Centre cap colour (retro hubcaps etc.). */
  cap?: string;
}

const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);

/** Corner arc points around (cx, cy) with radius cr from angle a0 to a1. */
function arc(cx: number, cy: number, cr: number, a0: number, a1: number, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + cr * Math.cos(a), cy + cr * Math.sin(a)]);
  }
  return out;
}

/**
 * Tyre cross-section as a lathe profile (r, y): y is the axle direction.
 * Travels clockwise (outside on the right), see `lathe`.
 */
function tyreProfile(R: number, W: number, ri: number, kind: WheelSpec['kind'], rich: boolean): [number, number][] {
  const hw = W / 2;
  const cr = Math.min(hw * 0.7, R * 0.14);
  const sidewall = (r: number, sgn: number) => sgn * hw * (0.84 + 0.16 * Math.sin((Math.PI * (r - ri)) / (R - cr - ri)));
  const pts: [number, number][] = [];
  const nSide = rich ? 5 : 3;
  // bottom sidewall, going outward
  for (let i = 0; i <= nSide; i++) {
    const r = ri + ((R - cr - ri) * i) / nSide;
    pts.push([r, sidewall(r, -1)]);
  }
  // lower shoulder
  pts.push(...arc(R - cr, -hw + cr, cr, -Math.PI / 2, 0, rich ? 4 : 3).slice(1));
  // tread (with two shallow grooves on road-type tyres)
  const y0 = -hw + cr;
  const y1 = hw - cr;
  if (kind === 'knob') {
    for (let i = 0; i <= 4; i++) pts.push([R, y0 + ((y1 - y0) * i) / 4]);
  } else {
    const g = R * 0.016;
    const ys = [y0, y0 + (y1 - y0) * 0.3, y0 + (y1 - y0) * 0.36, y0 + (y1 - y0) * 0.64, y0 + (y1 - y0) * 0.7, y1];
    pts.push([R, ys[0]], [R, ys[1] - 0.004], [R - g, ys[1] + 0.004], [R - g, ys[2]], [R, ys[2] + 0.004]);
    pts.push([R, ys[3] - 0.004], [R - g, ys[3] + 0.004], [R - g, ys[4]], [R, ys[4] + 0.004], [R, ys[5]]);
  }
  // upper shoulder
  pts.push(...arc(R - cr, hw - cr, cr, 0, Math.PI / 2, rich ? 4 : 3).slice(1));
  // top sidewall, going inward
  for (let i = 1; i <= nSide; i++) {
    const r = R - cr - ((R - cr - ri) * i) / nSide;
    pts.push([r, sidewall(r, 1)]);
  }
  return pts;
}

/** Push tread vertices outward in chevron-shaped lugs, then re-smooth the normals. */
function knobbleTread(g: THREE.BufferGeometry, R: number, lugs: number, amp: number): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = pos.getY(i);
    const r = Math.hypot(x, z);
    const w = (r - R * 0.9) / (R * 0.1);
    if (w <= 0) continue;
    const th = Math.atan2(z, x);
    const phase = lugs * (th + Math.sign(y) * Math.abs(y) * 1.6 / R);
    // Flat-topped lug between valleys.
    const f = Math.min(1, Math.max(0, 0.5 + 0.9 * Math.cos(phase)));
    const k = 1 + amp * (f - 0.65) * Math.min(1, w); // lug tops reach about R, valleys sit a little below
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  g.computeVertexNormals();
}

/**
 * Build one wheel. `left` mirrors it so the rim faces -X.
 * `high` = more segments (High/Medium quality); false = cheaper Low build.
 */
export function buildWheelGeometry(spec: WheelSpec, left: boolean, high: boolean): THREE.BufferGeometry {
  const b = new PartBuilder();
  addWheelParts(b, spec, high, left ? MIRROR : new THREE.Matrix4());
  return b.build().detail!;
}

/** Add a wheel's parts to any builder (used for spare tyres too). `base` places the wheel (axle along +X before it). */
export function addWheelParts(b: PartBuilder, spec: WheelSpec, _high: boolean, base: THREE.Matrix4): void {
  const R = spec.radius;
  const W = spec.width;
  const hw = W / 2;
  const ri = R * 0.6; // tyre inner radius = rim lip radius
  const segs = spec.kind === 'knob' ? 36 : 30;
  const flip = (t: Place): THREE.Matrix4 => {
    const m = new THREE.Matrix4();
    // Wheel parts are built around the Y axis; rotate so the axle runs along X (+Y -> +X).
    const rot = new THREE.Matrix4().makeRotationZ(-Math.PI / 2);
    const place = new THREE.Matrix4();
    place.compose(
      new THREE.Vector3(...(t.p ?? [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(t.r ?? [0, 0, 0]))),
      typeof t.s === 'number' ? new THREE.Vector3(t.s, t.s, t.s) : new THREE.Vector3(...(t.s ?? [1, 1, 1])),
    );
    m.copy(rot).multiply(place);
    return base.clone().multiply(m);
  };
  const add = (g: THREE.BufferGeometry, t: Place, color: string, surf: Surf = SURF.plastic) => b.part(g, flip(t), color, surf);

  // --- tyre
  const prof = tyreProfile(R, W, ri, spec.kind, false);
  const tyre = lathe(prof, Math.round(segs));
  if (spec.kind === 'knob') knobbleTread(tyre, R, 14, 0.07);
  add(tyre, {}, PAL.tyre, SURF.rubber);

  // --- rim barrel + lip (outer surface, seen at the edge of the tyre), travelling bottom -> top then over the lip
  const lip = ri + R * 0.012;
  const rimProfile: [number, number][] = [
    [lip - 0.01, -hw * 0.75],
    [lip, -hw * 0.7],
    [lip, hw * 0.82],
    [lip + R * 0.012, hw * 0.9],
    [lip - R * 0.012, hw * 0.96],
    [lip - R * 0.05, hw * 0.88],
  ];
  const rimSegs = Math.round(segs * 0.9);
  add(lathe(rimProfile, rimSegs), {}, spec.rim, SURF.metal);
  // dark well behind the spokes (facing outward)
  add(lathe([[lip - R * 0.05, hw * 0.3], [lip * 0.55, hw * 0.3], [0, hw * 0.3]], rimSegs), {}, '#16171b', SURF.plastic);
  // brake disc just in front of the well
  const bt = R * 0.012;
  add(lathe([[R * 0.3, hw * 0.34 - bt], [R * 0.5, hw * 0.34 - bt], [R * 0.5, hw * 0.34 + bt], [R * 0.3, hw * 0.34 + bt]], rimSegs), {}, '#8a8f99', SURF.metal);

  // --- spokes
  const hubR = R * 0.17;
  const nSp = spec.spokes ?? (spec.kind === 'retro' ? 0 : spec.kind === 'knob' ? 6 : 5);
  const capsuleG = capsule(1, 1, 6, 2);
  const rLip = lip - R * 0.012;
  for (let k = 0; k < nSp; k++) {
    const a = (k / nSp) * Math.PI * 2;
    const rc = (hubR * 0.4 + rLip) / 2;
    const len = rLip - hubR * 0.4;
    const th = spec.kind === 'knob' ? R * 0.05 : R * 0.04;
    add(capsuleG, { p: [rc * Math.cos(a), hw * 0.66, -rc * Math.sin(a)], r: [0, a, Math.PI / 2], s: [th * 0.8, len / 2 - th * 0.5, th * 1.2] }, spec.rim, SURF.metal);
  }
  if (spec.kind === 'sport') {
    // second, thinner spoke of each twin-spoke pair
    for (let k = 0; k < nSp; k++) {
      const a = ((k + 0.14) / nSp) * Math.PI * 2;
      const rc = (hubR * 0.4 + rLip) / 2;
      const len = rLip - hubR * 0.4;
      const th = R * 0.026;
      add(capsuleG, { p: [rc * Math.cos(a), hw * 0.64, -rc * Math.sin(a)], r: [0, a, Math.PI / 2], s: [th * 0.8, len / 2 - th * 0.5, th * 1.2] }, spec.rim, SURF.metal);
    }
  }

  // --- hub / cap
  if (spec.kind === 'retro') {
    // Big domed hubcap with a coloured centre.
    const rr = lip * 0.92;
    add(lathe([[rr, hw * 0.4], [rr * 0.98, hw * 0.55], [rr * 0.85, hw * 0.78], [rr * 0.5, hw * 0.96], [0, hw * 1.02]], rimSegs), {}, spec.rim, SURF.chrome);
    add(lathe([[rr * 0.34, hw * 0.98], [rr * 0.3, hw * 1.0], [0, hw * 1.06]], 20), {}, spec.cap ?? PAL.red, SURF.gloss);
  } else {
    add(lathe([[hubR * 1.15, hw * 0.55], [hubR * 1.1, hw * 0.78], [hubR * 0.85, hw * 0.92], [hubR * 0.4, hw * 0.98], [0, hw * 1.0]], 20), {}, spec.cap ?? shade(spec.rim, 0.8), SURF.chrome);
    const nut = sphere(6, 4);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      add(nut, { p: [hubR * 0.75 * Math.cos(a), hw * 0.88, -hubR * 0.75 * Math.sin(a)], s: R * 0.028 }, PAL.chrome, SURF.chrome);
    }
  }
  if (spec.kind === 'knob') {
    // Beadlock bolts around the rim lip.
    const bolt = sphere(6, 4);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      add(bolt, { p: [(lip - R * 0.03) * Math.cos(a), hw * 0.9, -(lip - R * 0.03) * Math.sin(a)], s: R * 0.024 }, PAL.chrome, SURF.chrome);
    }
  }

  // --- whitewall band on the outer sidewall
  if (spec.kind === 'retro') {
    const ra = R * 0.7;
    const rb = R * 0.86;
    const cr = Math.min(hw * 0.7, R * 0.14);
    const sw = (r: number) => hw * (0.84 + 0.16 * Math.sin((Math.PI * (r - ri)) / (R - cr - ri))) + 0.003;
    const band: [number, number][] = [];
    for (let i = 0; i <= 6; i++) {
      const r = rb - ((rb - ra) * i) / 6;
      band.push([r, sw(r)]);
    }
    add(lathe(band, rimSegs), {}, PAL.white, SURF.rubber);
  }

}

export function describeWheel(spec: WheelSpec): string {
  return `${spec.kind} r=${spec.radius}`;
}
