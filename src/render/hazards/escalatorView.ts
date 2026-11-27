/**
 * Draws Palm Plaza's escalators and the guide robot (the rules live in sim/hazards/escalator.ts).
 *
 *  - the STEPS: a ribbon of ribbed metal steps over the moving part of each lane (a bright tread with fine ribs, a yellow
 *    leading edge and a dark riser, plus a bump map so the sun rakes across every step). Both textures scroll by exactly the
 *    belt's travel (`pose.travel`, the integral of the belt speed), so the steps move at the belt's real speed and direction,
 *    slow down and reverse smoothly when the timetable changes.
 *  - COMB PLATES: a yellow grooved plate across both ends of every lane.
 *  - BALUSTRADES: on the sides that have a railing, a black rubber HAND RAIL on top of the glass, a brushed-steel skirt below
 *    it, and two LIGHT STRIPS (one under the hand rail, one on the skirt) that show the lane's state: GREEN = it runs with you
 *    (down), RED = against you, AMBER = stopped; they blink during the few seconds before a change. A bar of the same
 *    light crosses the lane at its top end.
 *  - OVERHEAD SIGNS at the top of both lanes (on a post at the outer rail): big chevrons pointing DOWN (green, with you), UP (red,
 *    against) or two bars (amber, stopped).
 *  - ARROWS: a row of glowing chevrons down the middle of each lane, pointing the belt's way (hidden while stopped).
 *  - TRUSS PANELS under the lanes (aluminium with cross bracing and a teal stripe) down to the floor, and a tall information
 *    pillar between them for the robot to stand on.
 *  - the GUIDE ROBOT (an original design: a friendly rounded mall-staff robot with a screen face, a teal sash, ears, an antenna
 *    and a wheel base): its head turns to follow the nearest kart; its screen shows expressions (smile, joy, shrug, wow, a blink
 *    now and then); two jointed arms (shoulder and elbow) point at the lane that runs with the traffic, shrug when both are
 *    stopped, and wave at the camera just before the escalators change.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Escalator, EscalatorPose } from '../../sim/hazards/escalator';
import type { Hazard } from '../../sim/hazards/types';
import type { TrackSample } from '../../sim/track';
import { blobGeo, matrix, merge, paint } from '../env/geo';
import { noise3 } from '../env/noise';
import { boxPart } from '../env/parts';
import type { QualitySettings } from '../scene';

/** Metres of lane per repeat of the steps texture (8 steps of 0.5 m) and of the arrow texture. */
const STEP_REPEAT = 4;
const ARROW_REPEAT = 6;
/** The steps texture repeats this often across the lane (so the ribs stay fine on a 16 m wide lane). */
const STEP_ACROSS = 2;
/** Size of the robot (it is a giant, statue-sized robot: easy to read from a kart). */
const ROBOT_SCALE = 1.7;
/** Hand rail height above the deck (m) and the head's pivot height on the robot (at scale 1). */
const RAIL_H = 1.26;
const HEAD_Y = 2.45;

const GREEN = new THREE.Color(0.25, 2.6, 0.7);
const RED = new THREE.Color(2.8, 0.25, 0.2);
const AMBER = new THREE.Color(2.6, 1.6, 0.2);
const _c = new THREE.Color();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** A ribbon over a run of samples between lateral offsets d0..d1 (left to right), `lift` above the samples; V = metres / repeat. */
function band(ss: TrackSample[], d0: number, d1: number, lift: number, repeat: number, h0 = lift, h1 = lift): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let dist = 0;
  ss.forEach((p, i) => {
    if (i > 0) dist += Math.hypot(p.x - ss[i - 1].x, p.y - ss[i - 1].y, p.z - ss[i - 1].z);
    pos.push(p.x + p.rx * d0, p.y + h0, p.z + p.rz * d0, p.x + p.rx * d1, p.y + h1, p.z + p.rz * d1);
    uv.push(0, dist / repeat, 1, dist / repeat);
    if (i > 0) {
      const k = (i - 1) * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A vertical strip along the samples at lateral offset `d` from height h0 to h1 above them (uv: across, metres / repeat). */
function vband(ss: TrackSample[], d: number, h0: number, h1: number, repeat = 4): THREE.BufferGeometry {
  return band(ss, d, d, 0, repeat, h0, h1);
}

/** A rectangular rail (w wide, th thick) along the samples at lateral offset d and height h (no uv). */
function rail(ss: TrackSample[], d: number, h: number, w: number, th: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const ring = [[-w / 2, th / 2], [w / 2, th / 2], [w / 2, -th / 2], [-w / 2, -th / 2]];
  ss.forEach((p, i) => {
    for (const [dd, hh] of ring) pos.push(p.x + p.rx * (d + dd), p.y + h + hh, p.z + p.rz * (d + dd));
    if (i > 0) {
      for (let f = 0; f < 4; f++) {
        const a = (i - 1) * 4 + f;
        const b = (i - 1) * 4 + ((f + 1) % 4);
        idx.push(a, b, a + 4, b, b + 4, a + 4);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.deleteAttribute('uv');
  return g;
}

/** Split `ss` into runs of consecutive samples where `pred` holds (runs of 2 or more). */
function runsOf(ss: TrackSample[], pred: (p: TrackSample) => boolean): TrackSample[][] {
  const out: TrackSample[][] = [];
  let cur: TrackSample[] = [];
  for (const p of ss) {
    if (pred(p)) cur.push(p);
    else {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/**
 * Metal steps: 8 per texture (32 px each: a yellow leading edge, a bright ribbed tread, a dark riser), fine ribs along the lane.
 * It repeats STEP_ACROSS times across the lane.
 */
function stepsTexture(): THREE.CanvasTexture {
  const t = canvasTex(256, 256, (g) => {
    for (let k = 0; k < 8; k++) {
      const y = k * 32;
      const grd = g.createLinearGradient(0, y, 0, y + 32);
      grd.addColorStop(0, '#eef1f5');
      grd.addColorStop(0.8, '#b7bec7');
      grd.addColorStop(1, '#8a929c');
      g.fillStyle = grd;
      g.fillRect(0, y, 256, 32);
      g.fillStyle = '#f5c518'; // yellow leading edge
      g.fillRect(0, y, 256, 3);
      g.fillStyle = 'rgba(32,38,46,0.62)'; // riser shadow
      g.fillRect(0, y + 28, 256, 4);
    }
    g.fillStyle = 'rgba(60,68,78,0.28)';
    for (let x = 0; x < 256; x += 64) g.fillRect(x + 28, 0, 8, 256); // a few broad ribs along the lane
  });
  t.repeat.set(STEP_ACROSS, 1);
  return t;
}

/** The step relief for the bump map: each tread rises slightly and ends in a sharp drop (the riser). */
function stepsBump(): THREE.CanvasTexture {
  const t = canvasTex(256, 256, (g) => {
    for (let k = 0; k < 8; k++) {
      const y = k * 32;
      const grd = g.createLinearGradient(0, y, 0, y + 28);
      grd.addColorStop(0, '#909090');
      grd.addColorStop(1, '#ffffff');
      g.fillStyle = grd;
      g.fillRect(0, y, 256, 28);
      g.fillStyle = '#202020';
      g.fillRect(0, y + 28, 256, 4);
    }
  });
  t.colorSpace = THREE.NoColorSpace;
  t.repeat.set(STEP_ACROSS, 1);
  return t;
}

/** One glowing chevron pointing to +V (along the lane), on transparent black (drawn additively). */
function arrowTexture(): THREE.CanvasTexture {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#fff';
    g.lineWidth = 16;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // V coordinates grow upward in the texture image's flipped space: the tip at the top of the canvas = +V.
    g.beginPath();
    g.moveTo(24, 92);
    g.lineTo(64, 40);
    g.lineTo(104, 92);
    g.stroke();
  });
}

/** The yellow comb plate (grooves along the lane). */
function combTexture(): THREE.CanvasTexture {
  const t = canvasTex(128, 32, (g) => {
    g.fillStyle = '#f5c518';
    g.fillRect(0, 0, 128, 32);
    g.fillStyle = '#7a5d08';
    for (let x = 0; x < 128; x += 8) g.fillRect(x + 4, 0, 3, 32);
    g.fillStyle = '#a8820d';
    g.fillRect(0, 0, 128, 3);
  });
  t.repeat.set(16, 1);
  return t;
}

/** Truss panel: brushed aluminium with cross bracing, rivets and a teal stripe (6 m x 3 m per repeat). */
function trussTexture(): THREE.CanvasTexture {
  return canvasTex(256, 128, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, '#dfe5eb');
    grd.addColorStop(1, '#aeb7c1');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#5b6672';
    g.lineWidth = 5;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(i * 64, 8);
      g.lineTo(i * 64 + 64, 120);
      g.moveTo(i * 64 + 64, 8);
      g.lineTo(i * 64, 120);
      g.stroke();
    }
    g.fillStyle = '#14b8a6';
    g.fillRect(0, 56, 256, 10);
    g.fillStyle = '#3a434d';
    g.fillRect(0, 0, 256, 6);
    g.fillRect(0, 122, 256, 6);
    g.fillStyle = '#eef2f5';
    for (let i = 0; i < 8; i++) {
      g.beginPath();
      g.arc(i * 32 + 16, 16, 2.5, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** The overhead sign's face: dark panel with three big chevrons (down), the same flipped (up), or two bars (stopped). */
function signTexture(kind: 'down' | 'up' | 'stop'): THREE.CanvasTexture {
  return canvasTex(
    384,
    112,
    (g) => {
      g.fillStyle = '#0a1220';
      g.fillRect(0, 0, 384, 112);
      g.strokeStyle = '#ffffff';
      g.fillStyle = '#ffffff';
      g.lineWidth = 16;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      if (kind === 'stop') {
        g.fillRect(40, 30, 304, 16);
        g.fillRect(40, 66, 304, 16);
        return;
      }
      for (let i = 0; i < 3; i++) {
        const x = 64 + i * 128;
        g.beginPath();
        if (kind === 'down') {
          g.moveTo(x - 38, 32);
          g.lineTo(x, 80);
          g.lineTo(x + 38, 32);
        } else {
          g.moveTo(x - 38, 80);
          g.lineTo(x, 32);
          g.lineTo(x + 38, 80);
        }
        g.stroke();
      }
    },
    false,
  );
}

// ---------------------------------------------------------------------------------------------
// The guide robot
// ---------------------------------------------------------------------------------------------

type Face = 'smile' | 'joy' | 'shrug' | 'wow';

/** Draw the robot's screen face for an expression, a blink and where the eyes look (-1 left .. 1 right). */
function drawFace(g: CanvasRenderingContext2D, face: Face, blink: boolean, look: number): void {
  const cyan = '#5df2ff';
  g.fillStyle = '#08141e';
  g.fillRect(0, 0, 256, 160);
  g.shadowColor = cyan;
  g.shadowBlur = 14;
  g.strokeStyle = cyan;
  g.fillStyle = cyan;
  g.lineWidth = 9;
  g.lineCap = 'round';
  const ex = [84, 172];
  for (const x of ex) {
    g.beginPath();
    if (blink || face === 'shrug') {
      g.moveTo(x - 20, 62 + (face === 'shrug' && x > 128 ? -5 : 0));
      g.lineTo(x + 20, 62);
      g.stroke();
    } else if (face === 'joy') {
      g.arc(x, 70, 20, Math.PI * 1.1, Math.PI * 1.9); // happy ^ ^ eyes
      g.stroke();
    } else {
      const ry = face === 'wow' ? 34 : 28;
      g.ellipse(x, 62, face === 'wow' ? 27 : 22, ry, 0, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      g.fillStyle = '#08141e';
      g.beginPath();
      g.arc(x + look * 8, 62 + (face === 'wow' ? 2 : 0), 10, 0, Math.PI * 2); // pupil
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(x + look * 8 - 4, 56, 4, 0, Math.PI * 2); // sparkle
      g.fill();
      g.shadowBlur = 14;
      g.fillStyle = cyan;
    }
  }
  g.beginPath();
  if (face === 'joy') {
    g.arc(128, 100, 34, 0.05 * Math.PI, 0.95 * Math.PI);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,120,170,0.8)';
    for (const x of [48, 208]) {
      g.beginPath();
      g.ellipse(x, 96, 14, 8, 0, 0, Math.PI * 2);
      g.fill();
    }
  } else if (face === 'wow') {
    g.arc(128, 112, 14, 0, Math.PI * 2);
    g.stroke();
  } else if (face === 'shrug') {
    g.moveTo(88, 112);
    g.bezierCurveTo(108, 98, 118, 126, 140, 112);
    g.bezierCurveTo(150, 106, 160, 110, 168, 112);
    g.stroke();
  } else {
    g.arc(128, 96, 36, 0.2 * Math.PI, 0.8 * Math.PI); // smile
    g.stroke();
  }
  g.shadowBlur = 0;
}

/** The robot's body parts (at scale 1, standing on y = 0, facing +z): stand, egg body with sash, badge. */
function robotBody(): THREE.BufferGeometry {
  const white = new THREE.Color('#f7f7f4');
  const teal = new THREE.Color('#14b8a6');
  const dark = new THREE.Color('#1d2733');
  const parts: THREE.BufferGeometry[] = [];
  // Wheel base and a short neck of a stand.
  parts.push(paint(new THREE.CylinderGeometry(0.55, 0.65, 0.35, 16).deleteAttribute('uv').translate(0, 0.18, 0), () => _c.copy(dark)));
  parts.push(paint(new THREE.CylinderGeometry(0.18, 0.22, 0.4, 10).deleteAttribute('uv').translate(0, 0.5, 0), () => _c.set('#9aa3ad')));
  // Rounded body (an egg) with a teal sash across it and a name-badge star.
  parts.push(paint(blobGeo(3, 4, 0.0, 1, noise3).applyMatrix4(matrix(0, 1.35, 0, 0.62, 0.72, 0.55)), (p) => (Math.abs(p.y - 1.35 - 0.35 * p.x) < 0.09 ? _c.copy(teal) : _c.copy(white))));
  parts.push(boxPart(-0.25, 1.62, 0.5, 0.16, 0.16, 0.05, new THREE.Color(2.4, 2, 0.4), 0, 1));
  return merge(parts);
}

/** The head (pivot at its centre): a white rounded cube with a dark visor, teal ear discs, an antenna with a ball. */
function robotHead(): THREE.BufferGeometry {
  const white = new THREE.Color('#f7f7f4');
  const teal = new THREE.Color('#14b8a6');
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(blobGeo(3, 6, 0.0, 1, noise3).applyMatrix4(matrix(0, 0, 0, 0.55, 0.45, 0.5)), (p) => (p.z > 0.26 && Math.abs(p.y) < 0.3 && Math.abs(p.x) < 0.44 ? _c.set('#1d2733') : _c.copy(white))));
  for (const s of [-1, 1]) parts.push(paint(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 12).deleteAttribute('uv').rotateZ(Math.PI / 2).translate(s * 0.56, 0, 0), () => _c.copy(teal)));
  parts.push(paint(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 6).deleteAttribute('uv').translate(0, 0.6, 0), () => _c.set('#9aa3ad')));
  parts.push(paint(blobGeo(1, 2, 0, 1, noise3).applyMatrix4(matrix(0, 0.8, 0, 0.1)), () => _c.copy(teal)));
  return merge(parts);
}

/** The screen: a slightly curved plane that hugs the front of the head's ellipsoid. */
function robotScreen(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(0.62, 0.4, 10, 6);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, 0.5 * Math.sqrt(Math.max(0.05, 1 - (x / 0.55) ** 2 - (y / 0.45) ** 2)) + 0.012);
  }
  g.computeVertexNormals();
  return g;
}

/** An upper arm (from the shoulder at the origin along -y): a teal sleeve and a white joint ball at the elbow end. */
function robotUpperArm(): THREE.BufferGeometry {
  return merge([
    paint(new THREE.CylinderGeometry(0.11, 0.1, 0.55, 10).deleteAttribute('uv').translate(0, -0.27, 0), () => _c.set('#14b8a6')),
    paint(blobGeo(1, 9, 0, 1, noise3).applyMatrix4(matrix(0, 0, 0, 0.16)), () => _c.set('#f7f7f4')),
  ]);
}

/** A forearm (from the elbow at the origin along -y): a white sleeve and a round glove. */
function robotForearm(): THREE.BufferGeometry {
  return merge([
    paint(new THREE.CylinderGeometry(0.1, 0.09, 0.45, 10).deleteAttribute('uv').translate(0, -0.23, 0), () => _c.set('#f7f7f4')),
    paint(blobGeo(2, 8, 0, 1, noise3).applyMatrix4(matrix(0, -0.55, 0, 0.18)), () => _c.set('#f7f7f4')),
    paint(blobGeo(1, 11, 0, 1, noise3).applyMatrix4(matrix(0, 0, 0, 0.12)), () => _c.set('#14b8a6')),
  ]);
}

interface RobotRig {
  group: THREE.Group;
  head: THREE.Group;
  /** Shoulders (left = the robot's -x side) and elbows. */
  shoulders: [THREE.Group, THREE.Group];
  elbows: [THREE.Group, THREE.Group];
  face: { tex: THREE.CanvasTexture; ctx: CanvasRenderingContext2D; key: string };
  /** Smoothed state. */
  yaw: number;
  elbowAngle: [number, number];
}

export class EscalatorView {
  private readonly items: {
    h: Escalator;
    steps: THREE.MeshStandardMaterial[];
    arrows: THREE.MeshBasicMaterial[];
    strips: THREE.MeshBasicMaterial[];
    signs: { mat: THREE.MeshBasicMaterial; kind: 'down' | 'up' | 'stop' | '' }[];
    /** The guide robot (null at a pair without one: direction lights and signs only). */
    rig: RobotRig | null;
  }[] = [];
  private readonly root = new THREE.Group();
  private readonly signTex = { down: signTexture('down'), up: signTexture('up'), stop: signTexture('stop') };
  private lastTime = Number.NaN;

  constructor(
    private readonly scene: THREE.Scene,
    hazards: Hazard[],
    _quality: QualitySettings,
  ) {
    const robotMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 });
    const truss = new THREE.MeshStandardMaterial({ map: trussTexture(), roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide });
    const rubber = new THREE.MeshStandardMaterial({ color: '#15171b', roughness: 0.55, metalness: 0.1 });
    const steel = new THREE.MeshStandardMaterial({ color: '#8a949f', roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide });
    const apronMat = new THREE.MeshStandardMaterial({ color: '#55606b', roughness: 0.4, metalness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const edgeMat = new THREE.MeshBasicMaterial({ color: '#f5c518', polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const combMat = new THREE.MeshStandardMaterial({ map: combTexture(), roughness: 0.5, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const housingMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.5 });
    for (const hz of hazards) {
      const h = hz as Escalator;
      const track = h.track;
      const outer = track.def.width / 2 + track.def.offroadWidth;
      const lanes: TrackSample[][] = [[], []];
      for (const p of track.samples) if (track.deltaS(h.s0, p.s) >= 0 && track.deltaS(p.s, h.s1) >= 0) lanes[0].push(p);
      lanes[1] = track.branches[h.branchRoute - 1].samples.slice(h.b0, h.b1 + 1);
      const steps: THREE.MeshStandardMaterial[] = [];
      const arrows: THREE.MeshBasicMaterial[] = [];
      const strips: THREE.MeshBasicMaterial[] = [];
      const signs: { mat: THREE.MeshBasicMaterial; kind: 'down' | 'up' | 'stop' | '' }[] = [];
      const panels: THREE.BufferGeometry[] = [];
      const edges: THREE.BufferGeometry[] = [];
      const aprons: THREE.BufferGeometry[] = [];
      const combs: THREE.BufferGeometry[] = [];
      const rails: THREE.BufferGeometry[] = [];
      const skirts: THREE.BufferGeometry[] = [];
      const housings: THREE.BufferGeometry[] = [];
      for (const ss of lanes) {
        const hw = ss[0].width / 2;
        const map = stepsTexture();
        const sm = new THREE.MeshStandardMaterial({ map, bumpMap: stepsBump(), bumpScale: 0.6, roughness: 0.32, metalness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        steps.push(sm);
        this.root.add(new THREE.Mesh(band(ss, -hw, hw, 0.06, STEP_REPEAT), sm));
        const am = new THREE.MeshBasicMaterial({ map: arrowTexture(), color: GREEN.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
        am.map!.center.set(0.5, 0.5);
        arrows.push(am);
        this.root.add(new THREE.Mesh(band(ss, -3.2, 3.2, 0.09, ARROW_REPEAT), am));
        const lm = new THREE.MeshBasicMaterial({ color: GREEN.clone() });
        strips.push(lm);
        const lights: THREE.BufferGeometry[] = []; // this lane's state lights (they share its colour material)

        // Aprons between the steps and the rails (brushed steel with a yellow safety line), comb plates at both ends.
        for (const side of [-1, 1]) {
          const a = side < 0 ? [-outer, -hw] : [hw, outer];
          aprons.push(paintless(band(ss, a[0], a[1], 0.07, 6)));
          edges.push(paintless(band(ss, side < 0 ? -hw - 0.14 : hw, side < 0 ? -hw : hw + 0.14, 0.075, 6)));
        }
        for (const [first, second, dirSign] of [[ss[0], ss[1], 1], [ss[ss.length - 1], ss[ss.length - 2], -1]] as const) {
          const t = new THREE.Vector3(second.x - first.x, second.y - first.y, second.z - first.z).normalize();
          const len = 1.3;
          const corner = (d: number, k: number) => [first.x + first.rx * d + t.x * k * len, first.y + 0.08 + t.y * k * len, first.z + first.rz * d + t.z * k * len];
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute([...corner(-hw, 0), ...corner(hw, 0), ...corner(-hw, 1), ...corner(hw, 1)], 3));
          g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
          g.setIndex([0, 1, 2, 1, 3, 2]);
          g.computeVertexNormals();
          combs.push(g);
          // The lane's light bar across the comb plate (at the top end: where karts get on).
          if (dirSign > 0) {
            const bar = new THREE.BufferGeometry();
            const c2 = (d: number, k: number) => [first.x + first.rx * d + t.x * k, first.y + 0.1 + t.y * k, first.z + first.rz * d + t.z * k];
            bar.setAttribute('position', new THREE.Float32BufferAttribute([...c2(-hw, 0.45), ...c2(hw, 0.45), ...c2(-hw, 0.85), ...c2(hw, 0.85)], 3));
            bar.setIndex([0, 1, 2, 1, 3, 2]);
            bar.computeVertexNormals();
            lights.push(bar);
          }
        }

        // Balustrades on the sides that have a railing: hand rail, skirt and the light strips.
        let wallSide = 0;
        for (const side of [-1, 1] as const) {
          const wall = (p: TrackSample) => (side < 0 ? p.wallLeft : p.wallRight);
          wallSide += ss.filter(wall).length * side;
          for (const run of runsOf(ss, wall)) {
            rails.push(rail(run, side * (outer - 0.02), RAIL_H, 0.24, 0.13));
            skirts.push(paintless(vband(run, side * (outer - 0.1), 0, 0.42)));
            lights.push(paintless(vband(run, side * (outer - 0.12), 0.12, 0.3)));
            lights.push(paintless(vband(run, side * (outer - 0.12), 1.02, 1.12)));
            // Posts every ~4 m (chrome) holding the glass.
            const stride = Math.max(1, Math.round(4 / track.spacing));
            run.forEach((p, i) => {
              if (i % stride === 0) rails.push(boxPartPlain(p.x + p.rx * side * (outer - 0.02), p.y + 0.62, p.z + p.rz * side * (outer - 0.02), 0.12, 1.24, 0.12));
            });
          }
        }

        // Truss panels from the lane edges down to the ground floor, and the belly under the lane.
        for (const side of [-1, 1]) {
          const d = side * (outer + 0.05);
          const pos: number[] = [];
          const uv: number[] = [];
          const idx: number[] = [];
          let dist = 0;
          ss.forEach((p, i) => {
            if (i > 0) dist += Math.hypot(p.x - ss[i - 1].x, p.z - ss[i - 1].z);
            pos.push(p.x + p.rx * d, p.y - 0.05, p.z + p.rz * d, p.x + p.rx * d, 0, p.z + p.rz * d);
            uv.push(dist / 6, 1, dist / 6, 1 - (p.y + 0.05) / 3);
            if (i > 0) idx.push((i - 1) * 2, (i - 1) * 2 + 1, i * 2, (i - 1) * 2 + 1, i * 2 + 1, i * 2);
          });
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
          g.setIndex(idx);
          g.computeVertexNormals();
          panels.push(g);
        }
        panels.push(band(ss, -outer, outer, -0.12, 6));
        this.root.add(new THREE.Mesh(mergeGeometries(lights)!, lm));

        // The overhead sign on a post at the outer rail, hung over the lane's near half, facing the karts coming up to the top end.
        const side = wallSide >= 0 ? 1 : -1;
        const p0 = ss[0];
        const back = new THREE.Vector3(-p0.tx, 0, -p0.tz).normalize();
        const postD = side * (outer + 0.7);
        const at = (d: number, y: number, k = 0) => new THREE.Vector3(p0.x + p0.rx * d + back.x * (2.5 + k), p0.y + y, p0.z + p0.rz * d + back.z * (2.5 + k));
        const rot = Math.atan2(back.x, back.z);
        const post = at(postD, 4.4);
        housings.push(boxPart(post.x, post.y, post.z, 0.5, 8.8, 0.5, new THREE.Color('#cfd6dd'), rot));
        const sc = at(postD - side * 4.5, 8.7);
        housings.push(boxPart(sc.x, sc.y, sc.z, 9.4, 0.4, 0.4, new THREE.Color('#cfd6dd'), rot));
        const hc = at(postD - side * 4.5, 6.9);
        housings.push(boxPart(hc.x, hc.y, hc.z, 8.2, 2.6, 0.3, new THREE.Color('#1c2430'), rot));
        const face = at(postD - side * 4.5, 6.9, 0.17);
        const sg = new THREE.PlaneGeometry(7.7, 2.25);
        const sMat = new THREE.MeshBasicMaterial({ map: this.signTex.down, color: GREEN.clone() });
        const sm2 = new THREE.Mesh(sg, sMat);
        sm2.position.copy(face);
        sm2.rotation.y = rot;
        this.root.add(sm2);
        signs.push({ mat: sMat, kind: '' });
      }
      const addMesh = (list: THREE.BufferGeometry[], mat: THREE.Material, shadow = false) => {
        if (!list.length) return;
        const m = new THREE.Mesh(mergeGeometries(list)!, mat);
        m.castShadow = shadow;
        m.receiveShadow = true;
        this.root.add(m);
      };
      addMesh(aprons, apronMat);
      addMesh(edges, edgeMat);
      addMesh(combs, combMat);
      addMesh(rails, rubber);
      addMesh(skirts, steel);
      // The robot's pillar (an information column) between the lanes, with the truss panels (a pair without a robot has none).
      const m = h.mascot(0);
      if (h.hasMascot) panels.push(new THREE.CylinderGeometry(1.1, 1.3, m.y, 16, 1).translate(m.x, m.y / 2, m.z));
      addMesh(panels, truss, true);
      if (housings.length) this.root.add(new THREE.Mesh(merge(housings), housingMat));

      // The guide robot.
      this.items.push({ h, steps, arrows, strips, signs, rig: h.hasMascot ? this.buildRobot(m, robotMat) : null });
    }
    scene.add(this.root);
  }

  /** Build the robot standing at the mascot's spot. */
  private buildRobot(m: { x: number; y: number; z: number; heading: number }, robotMat: THREE.Material): RobotRig {
    const group = new THREE.Group();
    group.position.set(m.x, m.y, m.z);
    group.rotation.y = m.heading;
    group.scale.setScalar(ROBOT_SCALE);
    const body = new THREE.Mesh(robotBody(), robotMat);
    body.castShadow = true;
    group.add(body);
    // The head turns on its own pivot.
    const head = new THREE.Group();
    head.position.y = HEAD_Y;
    const skull = new THREE.Mesh(robotHead(), robotMat);
    skull.castShadow = true;
    head.add(skull);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 160;
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    drawFace(ctx, 'smile', false, 0);
    head.add(new THREE.Mesh(robotScreen(), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.35, 1.35, 1.35) })));
    group.add(head);
    // Jointed arms.
    const upper = robotUpperArm();
    const fore = robotForearm();
    const shoulders: THREE.Group[] = [];
    const elbows: THREE.Group[] = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.62, 1.78, 0);
      const up = new THREE.Mesh(upper, robotMat);
      up.castShadow = true;
      const el = new THREE.Group();
      el.position.y = -0.55;
      const fo = new THREE.Mesh(fore, robotMat);
      fo.castShadow = true;
      el.add(fo);
      sh.add(up, el);
      group.add(sh);
      shoulders.push(sh);
      elbows.push(el);
    }
    this.root.add(group);
    return { group, head, shoulders: shoulders as [THREE.Group, THREE.Group], elbows: elbows as [THREE.Group, THREE.Group], face: { tex, ctx, key: 'smile00' }, yaw: 0, elbowAngle: [0, 0] };
  }

  update(time: number, focus?: readonly { x: number; z: number }[]): void {
    const dt = Number.isFinite(this.lastTime) ? Math.min(0.1, Math.max(0, time - this.lastTime)) : 0;
    this.lastTime = time;
    for (const it of this.items) {
      const pose = it.h.pose(time) as EscalatorPose;
      const blink = pose.phase === 'warn' && Math.sin(time * 18) > 0 ? 0.25 : 1;
      for (const lane of [0, 1] as const) {
        // Steps scroll with the belt (texture V grows along the lane: moving forward = sampling further back).
        const off = -pose.travel[lane] / STEP_REPEAT;
        it.steps[lane].map!.offset.y = off;
        if (it.steps[lane].bumpMap) it.steps[lane].bumpMap!.offset.y = off;
        const dir = pose.dirs[lane];
        const arrow = it.arrows[lane];
        arrow.map!.rotation = dir < 0 ? Math.PI : 0;
        arrow.map!.offset.y = (dir < 0 ? 1 : -1) * ((time * 0.8) % 1);
        const color = dir > 0 ? GREEN : dir < 0 ? RED : AMBER;
        arrow.color.copy(color).multiplyScalar(dir === 0 ? 0 : 0.7 * blink);
        it.strips[lane].color.copy(color).multiplyScalar(blink);
        // The overhead sign: chevrons down / up or two bars, in the lane's colour.
        const sign = it.signs[lane];
        // (With the traffic = the way the road goes: down, or up at the entrance.)
        const kind = dir === 0 ? 'stop' : (dir > 0) !== it.h.rising ? 'down' : 'up';
        if (sign.kind !== kind) {
          sign.kind = kind;
          sign.mat.map = this.signTex[kind];
          sign.mat.needsUpdate = true;
        }
        sign.mat.color.copy(color).multiplyScalar(blink * 0.9);
      }
      if (it.rig) this.poseRobot(it.rig, it.h, time, dt, focus);
    }
  }

  /** Face the nearest kart, show an expression, point at the good lane (or shrug), wave before a change; everything eases. */
  private poseRobot(rig: RobotRig, h: Escalator, time: number, dt: number, focus?: readonly { x: number; z: number }[]): void {
    const m = h.mascot(time);
    const ease = 1 - Math.exp(-dt * 7);
    const wantArm: [THREE.Quaternion, THREE.Quaternion] = [new THREE.Quaternion(), new THREE.Quaternion()];
    const wantElbow: [number, number] = [0, 0];
    wantArm[0].setFromAxisAngle(Z, -0.22); // rest: arms slightly out from the body
    wantArm[1].setFromAxisAngle(Z, 0.22);
    let face: Face = 'smile';
    let look = 0;
    if (m.target) {
      // The target direction in the robot's own frame (it faces +z).
      const c = Math.cos(-m.heading);
      const s = Math.sin(-m.heading);
      const dx = m.target.x - m.x;
      const dz = m.target.z - m.z;
      _v.set(dx * c + dz * s, 1.2, -dx * s + dz * c).normalize();
      const arm = _v.x >= 0 ? 1 : 0;
      wantArm[arm].setFromUnitVectors(DOWN, _v);
      look = _v.x >= 0 ? 1 : -1;
    } else {
      // Both stopped: a shrug, both arms out, forearms up, palms open.
      wantArm[0].setFromAxisAngle(Z, -1.15);
      wantArm[1].setFromAxisAngle(Z, 1.15);
      wantElbow[0] = -1.0;
      wantElbow[1] = 1.0;
      face = 'shrug';
    }
    if (m.wave) {
      // Wave at the camera with the arm that is not pointing (both when nobody points): up and out, the forearm swinging.
      const free = m.target ? (wantArm[1].angleTo(_q.identity()) > 0.5 ? 0 : 1) : 1;
      const side = free === 1 ? 1 : -1;
      wantArm[free].setFromEuler(new THREE.Euler(-0.25, 0, side * 2.45));
      wantElbow[free] = side * (0.55 * Math.sin(time * 11));
      face = 'joy';
    }
    for (const i of [0, 1] as const) {
      rig.shoulders[i].quaternion.slerp(wantArm[i], ease);
      rig.elbowAngle[i] += (wantElbow[i] - rig.elbowAngle[i]) * (wantElbow[i] === 0 || !m.wave ? ease : 1 - Math.exp(-dt * 30));
      rig.elbows[i].rotation.z = rig.elbowAngle[i];
    }
    // The head follows the nearest kart (within 90 m) and scans slowly when nobody is near.
    let yawWant = Math.sin(time * 0.5) * 0.45;
    let nearest = Infinity;
    if (focus) {
      for (const f of focus) {
        const d = Math.hypot(f.x - m.x, f.z - m.z);
        if (d < nearest && d < 90) {
          nearest = d;
          let a = Math.atan2(f.x - m.x, f.z - m.z) - m.heading;
          a = Math.atan2(Math.sin(a), Math.cos(a));
          yawWant = Math.max(-1.15, Math.min(1.15, a));
        }
      }
    }
    if (nearest < 14 && !m.wave && m.target) face = 'wow';
    rig.yaw += (yawWant - rig.yaw) * (1 - Math.exp(-dt * 6));
    rig.head.rotation.y = rig.yaw;
    rig.head.rotation.x = m.target ? 0.1 + 0.05 * Math.sin(time * 3) : -0.04;
    rig.head.rotation.z = face === 'shrug' ? 0.1 : 0.03 * Math.sin(time * 1.3);
    // Expression (redrawn only when it changes): a blink for 0.14 s every ~4 s.
    const blinking = (time % 4.1) < 0.14;
    const key = `${face}${blinking ? 1 : 0}${look}`;
    if (key !== rig.face.key) {
      rig.face.key = key;
      drawFace(rig.face.ctx, face, blinking, look);
      rig.face.tex.needsUpdate = true;
    }
    // A little bob (a happy bounce while waving).
    rig.group.position.y = m.y + (m.wave ? 0.18 * Math.abs(Math.sin(time * 6)) : 0.06 * Math.sin(time * 3));
  }

  setQuality(_q: QualitySettings): void {}

  dispose(): void {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }
}

/** Strip the UVs (merge needs matching attributes) - the light strips have no texture. */
function paintless(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  return g;
}

/** A plain (unpainted, no uv) box part for the chrome posts (centre x, y, z; size w, h, d). */
function boxPartPlain(x: number, y: number, z: number, w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  g.deleteAttribute('uv');
  return g;
}
