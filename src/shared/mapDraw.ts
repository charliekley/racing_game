/**
 * Track-map drawing shared by the TV minimap and the phone map, so both look the same.
 *
 * Pure drawing code: it only needs a 2D canvas context (no Three.js, no document
 * lookups), which also lets the tests run it against a recording stub.
 *
 * What it draws, bottom to top:
 *   panel -> road outlines -> roads (colour = height: dark slate low, pale high)
 *   -> shortcut branches (thinner; dashed brown when dirt)
 *   -> crossings (where one road passes OVER another, the lower road gets a gap)
 *   -> bridges (bright edges) -> cliff edges (red ticks) -> gaps (water / chasm)
 *   -> cannons (icon, dotted arc, target ring) -> start line -> kart dots.
 *
 * Orientation: world +z is up on the map and x is mirrored (screen x = -world x),
 * the way a driver sees the start straight.
 *
 * The expensive part (everything except the dots) never changes during a race, so
 * `MapCache` renders it once into an offscreen canvas and redraws only the dots.
 */

// ---------------------------------------------------------------------------
// Data (this is what the host sends to phones, so keep it small)
// ---------------------------------------------------------------------------

export interface MapPoint3 {
  x: number;
  y: number;
  z: number;
}

/** One road as a polyline (same shape as `RouteLine` in sim/routes.ts). */
export interface MapRoute {
  kind: 'main' | 'shortcut';
  /** 'dirt' roads are drawn dashed and brown. */
  surface: 'road' | 'dirt';
  /** Road width (m). */
  width: number;
  /** True for the main loop (the last point connects back to the first). */
  closed: boolean;
  points: MapPoint3[];
}

/** A stretch of the main road that is a bridge (drawn on top, with bright edges). */
export interface MapBridge {
  points: MapPoint3[];
}

/** A cliff edge: the polyline runs along the ground edge, `side` is the side of travel the drop is on. */
export interface MapCliff {
  points: { x: number; z: number }[];
  side: 'left' | 'right';
}

/** A cannon: the kart drives into the mouth and lands at the landing. */
export interface MapCannon {
  mouth: { x: number; z: number };
  landing: { x: number; z: number };
}

/** Water or chasm across the road (centre, direction of travel, road width, length along the road). */
export interface MapGap {
  x: number;
  z: number;
  heading: number;
  width: number;
  /** Length of the gap along the road (m). Optional: older senders left it out. */
  length?: number;
  kind?: 'water' | 'void';
}

export interface MapData {
  routes: MapRoute[];
  bridges: MapBridge[];
  cliffs: MapCliff[];
  cannons: MapCannon[];
  voidGaps: MapGap[];
  /** Start/finish line centre and track heading there (rad; direction = (sin h, cos h)). */
  start: { x: number; z: number; heading: number };
  /** Highest road point (m); heights are shaded from 0 up to this. */
  maxHeight: number;
}

/** A kart on the map. `own` = the viewer's own kart (drawn bigger, with a ring, on top). */
export interface MapDot {
  x: number;
  z: number;
  color: string;
  label?: string;
  own?: boolean;
}

export interface MapSize {
  w: number;
  h: number;
}

export interface MapOpts {
  /** 'rect' = plain dark panel (TV); 'rounded' = rounded panel with a white border (phone). Default 'rect'. */
  panel?: 'rect' | 'rounded';
  /** Opaque panel colour. The "gap under a bridge" is painted with it, so it must be opaque. */
  panelColor?: string;
  /** Fraction of the canvas the track may fill (default 0.9). */
  fit?: number;
  /** Kart dot radius as a fraction of the smaller canvas side (default 0.036). */
  dotRadius?: number;
  /** Draw `dot.label` next to each dot (TV). */
  labels?: boolean;
}

/** Names of the layers drawBlocks reports (in drawing order); handy for tests. */
export type MapLayer =
  | 'panel'
  | 'outlines'
  | 'roads'
  | 'shortcuts'
  | 'crossings'
  | 'bridges'
  | 'cliffs'
  | 'gaps'
  | 'cannons'
  | 'start'
  | 'dots';

// ---------------------------------------------------------------------------
// Crossings (over / under roads)
// ---------------------------------------------------------------------------

export interface Crossing {
  x: number;
  z: number;
  /** Road that is higher here: route index + segment index (segment i = point i -> i+1). */
  over: { route: number; seg: number };
  under: { route: number; seg: number };
  overY: number;
  underY: number;
}

/**
 * Where two road segments cross in the top-down view but at least `minHeightDiff`
 * metres apart in height (an overpass). Roads that merely meet or join at the
 * same height (a shortcut leaving the road) are not reported.
 */
export function findCrossings(routes: MapRoute[], minHeightDiff = 5): Crossing[] {
  // Flatten to segments with a bounding box so most pairs are rejected cheaply.
  interface Seg {
    r: number;
    i: number;
    a: MapPoint3;
    b: MapPoint3;
  }
  const segs: Seg[] = [];
  routes.forEach((route, r) => {
    const n = route.points.length;
    const count = route.closed ? n : n - 1;
    for (let i = 0; i < count; i++) segs.push({ r, i, a: route.points[i], b: route.points[(i + 1) % n] });
  });

  const out: Crossing[] = [];
  for (let p = 0; p < segs.length; p++) {
    for (let q = p + 1; q < segs.length; q++) {
      const s = segs[p];
      const t = segs[q];
      if (s.r === t.r) {
        // Neighbouring segments of one road just share an end point.
        const n = routes[s.r].points.length;
        const gap = t.i - s.i;
        if (gap <= 1 || (routes[s.r].closed && n - gap <= 1)) continue;
      }
      if (Math.max(s.a.x, s.b.x) < Math.min(t.a.x, t.b.x) || Math.max(t.a.x, t.b.x) < Math.min(s.a.x, s.b.x)) continue;
      if (Math.max(s.a.z, s.b.z) < Math.min(t.a.z, t.b.z) || Math.max(t.a.z, t.b.z) < Math.min(s.a.z, s.b.z)) continue;

      // Segment intersection: s.a + u (s.b - s.a) = t.a + v (t.b - t.a). Half-open [0,1) so a
      // crossing exactly on a shared vertex is only counted once.
      const d1x = s.b.x - s.a.x;
      const d1z = s.b.z - s.a.z;
      const d2x = t.b.x - t.a.x;
      const d2z = t.b.z - t.a.z;
      const den = d1x * d2z - d1z * d2x;
      if (Math.abs(den) < 1e-9) continue; // parallel
      const u = ((t.a.x - s.a.x) * d2z - (t.a.z - s.a.z) * d2x) / den;
      const v = ((t.a.x - s.a.x) * d1z - (t.a.z - s.a.z) * d1x) / den;
      if (u < -1e-9 || u >= 1 - 1e-9 || v < -1e-9 || v >= 1 - 1e-9) continue;

      const sy = s.a.y + (s.b.y - s.a.y) * u;
      const ty = t.a.y + (t.b.y - t.a.y) * v;
      if (Math.abs(sy - ty) < minHeightDiff) continue;
      const sOver = sy > ty;
      out.push({
        x: s.a.x + d1x * u,
        z: s.a.z + d1z * u,
        over: sOver ? { route: s.r, seg: s.i } : { route: t.r, seg: t.i },
        under: sOver ? { route: t.r, seg: t.i } : { route: s.r, seg: s.i },
        overY: sOver ? sy : ty,
        underY: sOver ? ty : sy,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation (data from the network is untrusted)
// ---------------------------------------------------------------------------

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPts = (v: unknown, withY: boolean): boolean =>
  Array.isArray(v) && v.every((p) => p && isNum(p.x) && isNum(p.z) && (!withY || isNum(p.y)));

/** Structural check of a `MapData` that arrived over the network. */
export function isMapData(m: unknown): m is MapData {
  if (typeof m !== 'object' || m === null) return false;
  const d = m as Record<string, any>;
  const ok = (a: unknown, f: (e: any) => boolean) => Array.isArray(a) && a.length < 200 && a.every(f);
  return (
    ok(d.routes, (r) => r && (r.kind === 'main' || r.kind === 'shortcut') && isNum(r.width) && isPts(r.points, true)) &&
    ok(d.bridges, (b) => b && isPts(b.points, true)) &&
    ok(d.cliffs, (c) => c && (c.side === 'left' || c.side === 'right') && isPts(c.points, false)) &&
    ok(d.cannons, (c) => c && isNum(c.mouth?.x) && isNum(c.mouth?.z) && isNum(c.landing?.x) && isNum(c.landing?.z)) &&
    ok(d.voidGaps, (g) => g && isNum(g.x) && isNum(g.z) && isNum(g.heading) && isNum(g.width)) &&
    d.start && isNum(d.start.x) && isNum(d.start.z) && isNum(d.start.heading) &&
    isNum(d.maxHeight)
  );
}

/** A flat single-road map from the old `track` message (flat [x, z, ...] centerline + width). */
export function mapDataFromOutline(pts: number[], width: number): MapData {
  const points: MapPoint3[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) points.push({ x: pts[i], y: 0, z: pts[i + 1] });
  const a = points[0] ?? { x: 0, y: 0, z: 0 };
  const b = points[1] ?? a;
  return {
    routes: [{ kind: 'main', surface: 'road', width, closed: true, points }],
    bridges: [],
    cliffs: [],
    cannons: [],
    voidGaps: [],
    start: { x: a.x, z: a.z, heading: Math.atan2(b.x - a.x, b.z - a.z) },
    maxHeight: 0,
  };
}

// ---------------------------------------------------------------------------
// View (world -> screen)
// ---------------------------------------------------------------------------

export interface MapView {
  /** Pixels per metre. */
  scale: number;
  /** One "ui unit" in pixels: line widths and icon sizes are multiples of it (≈ 1 px on a 150 px map). */
  u: number;
  toScreen(x: number, z: number): [number, number];
}

/** Fit all roads (plus a margin) into the canvas, +z up, x mirrored. */
export function makeView(size: MapSize, data: MapData, opts: MapOpts = {}): MapView {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let pad = 6;
  const include = (x: number, z: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  };
  for (const r of data.routes) {
    pad = Math.max(pad, r.width + 6);
    for (const p of r.points) include(p.x, p.z);
  }
  for (const c of data.cliffs) for (const p of c.points) include(p.x, p.z);
  for (const c of data.cannons) {
    include(c.mouth.x, c.mouth.z);
    include(c.landing.x, c.landing.z);
  }
  if (!Number.isFinite(minX)) {
    minX = maxX = minZ = maxZ = 0;
  }
  minX -= pad;
  maxX += pad;
  minZ -= pad;
  maxZ += pad;
  const fit = opts.fit ?? 0.9;
  const scale = Math.min(size.w / (maxX - minX), size.h / (maxZ - minZ)) * fit;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  return {
    scale,
    u: Math.min(size.w, size.h) / 150,
    toScreen: (x, z) => [size.w / 2 - (x - cx) * scale, size.h / 2 - (z - cz) * scale],
  };
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const C = {
  panel: '#0f1226',
  outline: '#1b2338',
  low: [0x64, 0x72, 0x92], // dark slate (low ground)
  high: [0xf4, 0xf7, 0xff], // pale (high ground)
  dirt: '#b98a52',
  dirtOutline: '#2a1d10',
  bridgeEdge: '#dfe9ff',
  cliff: '#ff6a2e',
  water: '#2f8ee0',
  waterEdge: '#9fd4ff',
  voidFill: '#02030a',
  voidEdge: '#ff4d4d',
  cannon: '#ffb02e',
  cannonDark: '#3a2208',
  start: '#ffffff',
} as const;

/** Road colour for a height: dark slate at 0 m to pale at `maxHeight`. Flat tracks use a calm mid tone. */
export function heightColor(y: number, maxHeight: number): string {
  const t = maxHeight > 2 ? Math.max(0, Math.min(1, y / maxHeight)) : 0.3;
  const c = C.low.map((lo, i) => Math.round(lo + (C.high[i] - lo) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

/** Stroke width of a road's coloured surface (px): true width, but never thinner than ~3 ui units. */
function fillWidth(r: MapRoute, v: MapView): number {
  const w = r.width * v.scale * (r.kind === 'shortcut' ? 0.65 : 1);
  return Math.max(w, (r.kind === 'shortcut' ? 2.4 : 3.4) * v.u);
}

function tracePath(ctx: Ctx, v: MapView, pts: { x: number; z: number }[], closed: boolean): void {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [sx, sy] = v.toScreen(p.x, p.z);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  if (closed) ctx.closePath();
}

/** Stroke one road segment range [from..to] (inclusive points) as outline + surface. */
function strokeRoadPart(ctx: Ctx, v: MapView, r: MapRoute, data: MapData, from: number, to: number, outline: boolean): void {
  const n = r.points.length;
  const w = fillWidth(r, v);
  const dirt = r.surface === 'dirt';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (outline) {
    ctx.strokeStyle = dirt ? C.dirtOutline : C.outline;
    ctx.lineWidth = w + 2.4 * v.u;
    ctx.beginPath();
    for (let i = from; i <= to; i++) {
      const p = r.points[((i % n) + n) % n];
      const [sx, sy] = v.toScreen(p.x, p.z);
      if (i === from) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    return;
  }
  ctx.lineWidth = w;
  if (dirt) {
    // Dirt: one brown dashed line (no height shading, the dashes already say "rough").
    ctx.strokeStyle = C.dirt;
    ctx.lineCap = 'butt';
    ctx.setLineDash([4 * v.u, 3 * v.u]);
    ctx.beginPath();
    for (let i = from; i <= to; i++) {
      const p = r.points[((i % n) + n) % n];
      const [sx, sy] = v.toScreen(p.x, p.z);
      if (i === from) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  // Paved: each segment gets the colour of its average height.
  for (let i = from; i < to; i++) {
    const a = r.points[((i % n) + n) % n];
    const b = r.points[(((i + 1) % n) + n) % n];
    ctx.strokeStyle = heightColor((a.y + b.y) / 2, data.maxHeight);
    const [ax, ay] = v.toScreen(a.x, a.z);
    const [bx, by] = v.toScreen(b.x, b.z);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
}

/** Number of segments in a route (closed loops have one more). */
const segCount = (r: MapRoute) => (r.closed ? r.points.length : r.points.length - 1);

/** Everything except the kart dots. Returns the layers that were actually drawn, in order. */
export function drawMapStatic(ctx: Ctx, size: MapSize, data: MapData, opts: MapOpts = {}, view = makeView(size, data, opts)): MapLayer[] {
  const layers: MapLayer[] = [];
  const v = view;
  const u = v.u;
  const panelColor = opts.panelColor ?? C.panel;

  // Panel.
  ctx.clearRect(0, 0, size.w, size.h);
  ctx.fillStyle = panelColor;
  if (opts.panel === 'rounded') {
    const m = Math.min(size.w, size.h) * 0.05;
    ctx.lineWidth = Math.min(size.w, size.h) * 0.035;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.roundRect(m, m, size.w - 2 * m, size.h - 2 * m, Math.min(size.w, size.h) * 0.14);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(0, 0, size.w, size.h);
  }
  layers.push('panel');

  const main = data.routes.filter((r) => r.kind === 'main' && r.points.length >= 2);
  const shortcuts = data.routes.filter((r) => r.kind === 'shortcut' && r.points.length >= 2);

  // Road outlines under every road, so joins between roads merge cleanly.
  if (main.length + shortcuts.length > 0) {
    for (const r of [...main, ...shortcuts]) strokeRoadPart(ctx, v, r, data, 0, segCount(r), true);
    layers.push('outlines');
  }
  // Main roads with height colours.
  if (main.length > 0) {
    for (const r of main) strokeRoadPart(ctx, v, r, data, 0, segCount(r), false);
    layers.push('roads');
  }
  // Shortcut branches (thinner; dashed when dirt).
  if (shortcuts.length > 0) {
    for (const r of shortcuts) strokeRoadPart(ctx, v, r, data, 0, segCount(r), false);
    layers.push('shortcuts');
  }

  // Overpasses: paint a panel-coloured halo along the upper road (this erases the lower road
  // right there = the "gap"), then redraw the upper road on top.
  const crossings = findCrossings(data.routes);
  if (crossings.length > 0) {
    for (const c of crossings) {
      const r = data.routes[c.over.route];
      const n = r.points.length;
      const w = fillWidth(r, v);
      ctx.strokeStyle = panelColor;
      ctx.lineCap = 'butt'; // butt: do not bite into the upper road's own neighbours
      ctx.lineJoin = 'round';
      ctx.lineWidth = w + 6 * u;
      ctx.beginPath();
      let started = false;
      for (let i = c.over.seg - 1; i <= c.over.seg + 2; i++) {
        if (!r.closed && (i < 0 || i >= n)) continue;
        const p = r.points[((i % n) + n) % n];
        const [sx, sy] = v.toScreen(p.x, p.z);
        if (started) ctx.lineTo(sx, sy);
        else ctx.moveTo(sx, sy);
        started = true;
      }
      ctx.stroke();
      const from = r.closed ? c.over.seg - 2 : Math.max(0, c.over.seg - 2);
      const to = r.closed ? c.over.seg + 3 : Math.min(n - 1, c.over.seg + 3);
      strokeRoadPart(ctx, v, r, data, from, to, true);
      strokeRoadPart(ctx, v, r, data, from, to, false);
    }
    layers.push('crossings');
  }

  // Bridges: bright edges so the deck stands out from the ground-level road.
  if (data.bridges.some((b) => b.points.length >= 2)) {
    const roadW = main[0] ? fillWidth(main[0], v) : 4 * u;
    for (const b of data.bridges) {
      if (b.points.length < 2) continue;
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = C.bridgeEdge;
      ctx.lineWidth = roadW + 3 * u;
      tracePath(ctx, v, b.points, false);
      ctx.stroke();
      for (let i = 0; i + 1 < b.points.length; i++) {
        const p = b.points[i];
        const q = b.points[i + 1];
        ctx.strokeStyle = heightColor((p.y + q.y) / 2, data.maxHeight);
        ctx.lineWidth = roadW;
        const [ax, ay] = v.toScreen(p.x, p.z);
        const [bx, by] = v.toScreen(q.x, q.z);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
    layers.push('bridges');
  }

  // Cliff edges: a thin red-orange line along the edge with short ticks pointing at the drop.
  if (data.cliffs.some((c) => c.points.length >= 2)) {
    ctx.strokeStyle = C.cliff;
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.1 * u;
    const tick = 3.4 * u;
    for (const c of data.cliffs) {
      const P = c.points;
      if (P.length < 2) continue;
      tracePath(ctx, v, P, false);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < P.length; i++) {
        const a = P[Math.max(0, i - 1)];
        const b = P[Math.min(P.length - 1, i + 1)];
        let tx = b.x - a.x;
        let tz = b.z - a.z;
        const len = Math.hypot(tx, tz) || 1;
        tx /= len;
        tz /= len;
        // Right of travel is (-tz, tx) (same convention as the sim); the drop is on `side`.
        const s = c.side === 'right' ? 1 : -1;
        const [sx, sy] = v.toScreen(P[i].x, P[i].z);
        const [ex, ey] = v.toScreen(P[i].x + (-tz * s * tick) / v.scale, P[i].z + (tx * s * tick) / v.scale);
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
      }
      ctx.stroke();
    }
    layers.push('cliffs');
  }

  // Gaps: a notch cut across the road, blue for water, black with red edges for a chasm.
  if (data.voidGaps.length > 0) {
    for (const g of data.voidGaps) {
      const fx = Math.sin(g.heading);
      const fz = Math.cos(g.heading);
      const rx = -fz;
      const rz = fx;
      const halfLen = Math.max((g.length ?? 8) / 2, (2.2 * u) / v.scale);
      const halfW = g.width / 2 + Math.max(0.6, (1.4 * u) / v.scale);
      const corner = (a: number, b: number): [number, number] => v.toScreen(g.x + fx * halfLen * a + rx * halfW * b, g.z + fz * halfLen * a + rz * halfW * b);
      const water = g.kind !== 'void';
      ctx.beginPath();
      for (const [a, b] of [[-1, -1], [-1, 1], [1, 1], [1, -1]] as const) {
        const [sx, sy] = corner(a, b);
        if (a === -1 && b === -1) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.fillStyle = water ? C.water : C.voidFill;
      ctx.fill();
      // The two edges across the road.
      ctx.strokeStyle = water ? C.waterEdge : C.voidEdge;
      ctx.lineWidth = 1.4 * u;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      for (const a of [-1, 1]) {
        const [x1, y1] = corner(a, -1);
        const [x2, y2] = corner(a, 1);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    }
    layers.push('gaps');
  }

  // Cannons: icon at the mouth, dotted arc to a target ring at the landing.
  if (data.cannons.length > 0) {
    for (const c of data.cannons) {
      const [mx, my] = v.toScreen(c.mouth.x, c.mouth.z);
      const [lx, ly] = v.toScreen(c.landing.x, c.landing.z);
      const dx = lx - mx;
      const dy = ly - my;
      const dist = Math.hypot(dx, dy) || 1;
      // Bow the dotted line sideways so it reads as a flight arc and not a road.
      const bow = dist * 0.22;
      const qx = (mx + lx) / 2 - (dy / dist) * bow;
      const qy = (my + ly) / 2 + (dx / dist) * bow;
      ctx.strokeStyle = C.cannon;
      ctx.lineWidth = 1.8 * u;
      ctx.lineCap = 'round';
      ctx.setLineDash([0.1, 3.4 * u]);
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.quadraticCurveTo(qx, qy, lx, ly);
      ctx.stroke();
      ctx.setLineDash([]);
      // Target ring.
      ctx.lineWidth = 1.6 * u;
      ctx.beginPath();
      ctx.arc(lx, ly, 4.2 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = C.cannon;
      ctx.beginPath();
      ctx.arc(lx, ly, 1.4 * u, 0, Math.PI * 2);
      ctx.fill();
      // Cannon icon: dark disc, barrel pointing along the arc's start.
      const ang = Math.atan2(qy - my, qx - mx);
      ctx.strokeStyle = C.cannonDark;
      ctx.lineWidth = 4.2 * u;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + Math.cos(ang) * 5.5 * u, my + Math.sin(ang) * 5.5 * u);
      ctx.stroke();
      ctx.strokeStyle = C.cannon;
      ctx.lineWidth = 2.6 * u;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + Math.cos(ang) * 5.5 * u, my + Math.sin(ang) * 5.5 * u);
      ctx.stroke();
      ctx.fillStyle = C.cannonDark;
      ctx.strokeStyle = C.cannon;
      ctx.lineWidth = 1.2 * u;
      ctx.beginPath();
      ctx.arc(mx, my, 3.2 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    layers.push('cannons');
  }

  // Start / finish line across the main road.
  {
    const roadW = (main[0]?.width ?? 12) / 2;
    const fx = Math.sin(data.start.heading);
    const fz = Math.cos(data.start.heading);
    const [ax, ay] = v.toScreen(data.start.x + fz * roadW, data.start.z - fx * roadW);
    const [bx, by] = v.toScreen(data.start.x - fz * roadW, data.start.z + fx * roadW);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4.4 * u;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.strokeStyle = C.start;
    ctx.lineWidth = 2.4 * u;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    layers.push('start');
  }
  return layers;
}

/** Kart dots, always drawn last. Others first, the viewer's own on top (bigger, with an extra ring). */
export function drawMapDots(ctx: Ctx, size: MapSize, view: MapView, dots: MapDot[], opts: MapOpts = {}): void {
  const base = Math.min(size.w, size.h) * (opts.dotRadius ?? 0.036);
  const draw = (d: MapDot) => {
    const [sx, sy] = view.toScreen(d.x, d.z);
    const r = d.own ? base * 1.4 : base;
    if (d.own) {
      // Halo ring so "me" is easy to find.
      ctx.beginPath();
      ctx.arc(sx, sy, r + base * 0.45, 0, Math.PI * 2);
      ctx.lineWidth = base * 0.28;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = d.color;
    ctx.fill();
    ctx.lineWidth = base * (d.own ? 0.5 : 0.3);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    if (opts.labels && d.label) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(r * 1.6)}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.label, sx + r * 1.3, sy);
    }
  };
  for (const d of dots) if (!d.own) draw(d);
  for (const d of dots) if (d.own) draw(d);
}

/** One-shot: static layers, then dots. Returns the layers drawn (the last is 'dots'). */
export function drawMap(ctx: Ctx, size: MapSize, data: MapData, dots: MapDot[], opts: MapOpts = {}): MapLayer[] {
  const view = makeView(size, data, opts);
  const layers = drawMapStatic(ctx, size, data, opts, view);
  drawMapDots(ctx, size, view, dots, opts);
  layers.push('dots');
  return layers;
}

/**
 * Keeps the static layers in an offscreen canvas, re-rendered only when the track
 * data or the size changes, so a per-frame redraw is one drawImage plus the dots.
 */
export class MapCache {
  private layer: HTMLCanvasElement | null = null;
  private key = '';
  private view: MapView | null = null;
  private lastData: MapData | null = null;

  /** `makeCanvas` creates the offscreen canvas (kept as an argument so this file never touches `document`). */
  constructor(private readonly makeCanvas: () => HTMLCanvasElement) {}

  /** Forget the cached layers (call when the track data changes). */
  invalidate(): void {
    this.key = '';
  }

  draw(ctx: Ctx, size: MapSize, data: MapData, dots: MapDot[], opts: MapOpts = {}): void {
    const key = `${size.w}x${size.h}`;
    if (!this.layer || key !== this.key || data !== this.lastData) {
      this.layer ??= this.makeCanvas();
      this.layer.width = size.w;
      this.layer.height = size.h;
      this.view = makeView(size, data, opts);
      drawMapStatic(this.layer.getContext('2d')!, size, data, opts, this.view);
      this.key = key;
      this.lastData = data;
    }
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.drawImage(this.layer, 0, 0);
    drawMapDots(ctx, size, this.view!, dots, opts);
  }
}
