/**
 * Draws Palm Plaza's escalators and the guide robot (the rules live in sim/hazards/escalator.ts).
 *
 *  - the STEPS: a ribbon of grooved metal steps over the moving part of each lane. Its texture scrolls by exactly the
 *    belt's travel (`pose.travel`, the integral of the belt speed), so the steps move at the belt's real speed and
 *    direction, slow down and reverse smoothly when the timetable changes.
 *  - ARROWS: a row of glowing chevrons down the middle of each lane, pointing the way the belt moves (hidden while stopped).
 *  - LIGHT STRIPS along both edges of each lane: GREEN = it runs with you (down), RED = against you, AMBER = stopped;
 *    they blink during the few seconds before a change.
 *  - side cladding under the lanes and a tall information pillar between them for the robot to stand on.
 *  - the GUIDE ROBOT (an original design: a friendly rounded mall-staff robot with a screen face, a teal sash, a little
 *    antenna and a wheel base): it points with one arm at the lane that runs with the traffic (`Escalator.mascot`), shrugs
 *    when both are stopped, and waves at the camera just before the escalators change.
 *
 * Draw calls: steps 2, arrows 2, strips 2, cladding + pillar 1, robot 4.
 */
import * as THREE from 'three';
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
/** Size of the robot (it is a giant, statue-sized robot: easy to read from a kart). */
const ROBOT_SCALE = 1.7;

const GREEN = new THREE.Color(0.25, 2.6, 0.7);
const RED = new THREE.Color(2.8, 0.25, 0.2);
const AMBER = new THREE.Color(2.6, 1.6, 0.2);
const _c = new THREE.Color();
const _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

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

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Grooved aluminium steps: 8 steps per texture, a yellow safety edge on each, darker grooves along the lane. */
function stepsTexture(): THREE.CanvasTexture {
  return canvasTex(256, 256, (g) => {
    for (let k = 0; k < 8; k++) {
      const y = k * 32;
      const grd = g.createLinearGradient(0, y, 0, y + 32);
      grd.addColorStop(0, '#c9ced4');
      grd.addColorStop(1, '#8e959d');
      g.fillStyle = grd;
      g.fillRect(0, y, 256, 32);
      g.fillStyle = '#f2c230';
      g.fillRect(0, y + 28, 256, 4);
    }
    g.fillStyle = 'rgba(40,45,52,0.45)';
    for (let x = 4; x < 256; x += 8) g.fillRect(x, 0, 2, 256);
    // Yellow side margins (the comb plates).
    g.fillStyle = '#f2c230';
    g.fillRect(0, 0, 10, 256);
    g.fillRect(246, 0, 10, 256);
  });
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

/** The guide robot's body parts (at scale 1, standing on y = 0, facing +z): body, head, sash, base, antenna. */
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
  // Head: a white rounded cube with a dark screen on the front (the eyes and smile glow on it, see `face`).
  parts.push(paint(blobGeo(3, 6, 0.0, 1, noise3).applyMatrix4(matrix(0, 2.45, 0, 0.55, 0.45, 0.5)), (p) => (p.z > 0.28 && Math.abs(p.y - 2.45) < 0.3 && Math.abs(p.x) < 0.42 ? _c.copy(dark) : _c.copy(white))));
  // Ear discs and the antenna with a teal ball.
  for (const s of [-1, 1]) parts.push(paint(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 12).deleteAttribute('uv').rotateZ(Math.PI / 2).translate(s * 0.56, 2.45, 0), () => _c.copy(teal)));
  parts.push(paint(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 6).deleteAttribute('uv').translate(0, 3.05, 0), () => _c.set('#9aa3ad')));
  parts.push(paint(blobGeo(1, 2, 0, 1, noise3).applyMatrix4(matrix(0, 3.25, 0, 0.1)), () => _c.copy(teal)));
  return merge(parts);
}

/** The glowing face: two eyes and a smile (built at the head's front, scale 1). */
function robotFace(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const glow = new THREE.Color(0.6, 2.4, 2.6);
  for (const s of [-1, 1]) parts.push(paint(blobGeo(1, 3, 0, 1, noise3).applyMatrix4(matrix(s * 0.17, 2.52, 0.5, 0.075, 0.1, 0.04)), () => _c.copy(glow)));
  for (let k = 0; k <= 6; k++) {
    const a = Math.PI * (0.15 + 0.7 * (k / 6));
    parts.push(boxPart(Math.cos(a) * 0.18, 2.42 - Math.sin(a) * 0.09, 0.5, 0.05, 0.04, 0.03, glow, 0, 1));
  }
  return merge(parts);
}

/** One arm, hanging from the shoulder at the origin along -y: upper arm, forearm, a round white glove. */
function robotArm(): THREE.BufferGeometry {
  const white = new THREE.Color('#f7f7f4');
  const teal = new THREE.Color('#14b8a6');
  return merge([
    paint(new THREE.CylinderGeometry(0.11, 0.1, 0.9, 10).deleteAttribute('uv').translate(0, -0.45, 0), () => _c.copy(teal)),
    paint(blobGeo(2, 8, 0, 1, noise3).applyMatrix4(matrix(0, -1.0, 0, 0.19)), () => _c.copy(white)),
    paint(blobGeo(1, 9, 0, 1, noise3).applyMatrix4(matrix(0, 0, 0, 0.16)), () => _c.copy(white)),
  ]);
}

export class EscalatorView {
  private readonly items: {
    h: Escalator;
    steps: THREE.MeshStandardMaterial[];
    arrows: THREE.MeshBasicMaterial[];
    strips: THREE.MeshBasicMaterial[];
    robot: THREE.Group;
    arms: [THREE.Mesh, THREE.Mesh];
  }[] = [];
  private readonly root = new THREE.Group();

  constructor(
    private readonly scene: THREE.Scene,
    hazards: Hazard[],
    _quality: QualitySettings,
  ) {
    const robotMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 });
    const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const clad = new THREE.MeshStandardMaterial({ color: '#e9edf1', roughness: 0.35, metalness: 0.4, side: THREE.DoubleSide });
    for (const hz of hazards) {
      const h = hz as Escalator;
      const track = h.track;
      const lanes: TrackSample[][] = [[], []];
      for (const p of track.samples) if (track.deltaS(h.s0, p.s) >= 0 && track.deltaS(p.s, h.s1) >= 0) lanes[0].push(p);
      lanes[1] = track.branches[h.branchRoute - 1].samples.slice(h.b0, h.b1 + 1);
      const steps: THREE.MeshStandardMaterial[] = [];
      const arrows: THREE.MeshBasicMaterial[] = [];
      const strips: THREE.MeshBasicMaterial[] = [];
      const cladding: THREE.BufferGeometry[] = [];
      for (const ss of lanes) {
        const hw = ss[0].width / 2;
        const map = stepsTexture();
        const sm = new THREE.MeshStandardMaterial({ map, roughness: 0.35, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        steps.push(sm);
        this.root.add(new THREE.Mesh(band(ss, -hw, hw, 0.06, STEP_REPEAT), sm));
        const am = new THREE.MeshBasicMaterial({ map: arrowTexture(), color: GREEN.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
        am.map!.center.set(0.5, 0.5);
        arrows.push(am);
        this.root.add(new THREE.Mesh(band(ss, -2.2, 2.2, 0.09, ARROW_REPEAT), am));
        const lm = new THREE.MeshBasicMaterial({ color: GREEN.clone() });
        strips.push(lm);
        const e = hw + 1.1;
        this.root.add(new THREE.Mesh(merge([paintless(band(ss, -e, -e + 0.25, 0.5, 4, 0.08, 0.5)), paintless(band(ss, e - 0.25, e, 0.5, 4, 0.5, 0.08))]), lm));
        // Side cladding from the lane edges down to the ground floor.
        for (const side of [-1, 1]) {
          const d = side * (hw + 2.05);
          const pos: number[] = [];
          const idx: number[] = [];
          ss.forEach((p, i) => {
            pos.push(p.x + p.rx * d, p.y - 0.05, p.z + p.rz * d, p.x + p.rx * d, 0, p.z + p.rz * d);
            if (i > 0) idx.push((i - 1) * 2, (i - 1) * 2 + 1, i * 2, (i - 1) * 2 + 1, i * 2 + 1, i * 2);
          });
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          g.setIndex(idx);
          g.computeVertexNormals();
          cladding.push(g);
        }
      }
      // The robot's pillar (an information column) between the lanes.
      const m = h.mascot(0);
      const pillar = new THREE.CylinderGeometry(1.1, 1.3, m.y, 16, 1).translate(m.x, m.y / 2, m.z);
      pillar.deleteAttribute('uv');
      cladding.push(pillar);
      for (const g of cladding) if (g.getAttribute('uv')) g.deleteAttribute('uv');
      this.root.add(new THREE.Mesh(mergeSimple(cladding), clad));

      // The guide robot.
      const robot = new THREE.Group();
      robot.position.set(m.x, m.y, m.z);
      robot.rotation.y = m.heading;
      robot.scale.setScalar(ROBOT_SCALE);
      const body = new THREE.Mesh(robotBody(), robotMat);
      body.castShadow = true;
      const head = new THREE.Mesh(robotFace(), glowMat);
      robot.add(body, head);
      const arms: THREE.Mesh[] = [];
      for (const s of [-1, 1]) {
        const arm = new THREE.Mesh(robotArm(), robotMat);
        arm.position.set(s * 0.62, 1.78, 0);
        arm.castShadow = true;
        robot.add(arm);
        arms.push(arm);
      }
      this.root.add(robot);
      this.items.push({ h, steps, arrows, strips, robot, arms: arms as [THREE.Mesh, THREE.Mesh] });
    }
    scene.add(this.root);
  }

  update(time: number): void {
    for (const it of this.items) {
      const pose = it.h.pose(time) as EscalatorPose;
      const blink = pose.phase === 'warn' && Math.sin(time * 18) > 0 ? 0.25 : 1;
      for (const lane of [0, 1] as const) {
        // Steps scroll with the belt (texture V grows along the lane: moving forward = sampling further back).
        it.steps[lane].map!.offset.y = -pose.travel[lane] / STEP_REPEAT;
        const dir = pose.dirs[lane];
        const arrow = it.arrows[lane];
        arrow.map!.rotation = dir < 0 ? Math.PI : 0;
        arrow.map!.offset.y = (dir < 0 ? 1 : -1) * ((time * 0.8) % 1);
        arrow.color.copy(dir > 0 ? GREEN : dir < 0 ? RED : AMBER).multiplyScalar(dir === 0 ? 0 : 0.7 * blink);
        it.strips[lane].color.copy(dir > 0 ? GREEN : dir < 0 ? RED : AMBER).multiplyScalar(blink);
      }
      this.poseRobot(it, time);
    }
  }

  /** Point at the good lane (or shrug), wave before a change; smooth the arms toward where they should be. */
  private poseRobot(it: (typeof this.items)[number], time: number): void {
    const m = it.h.mascot(time);
    const [left, right] = it.arms; // left = the robot's -x side
    const want: [THREE.Quaternion, THREE.Quaternion] = [new THREE.Quaternion(), new THREE.Quaternion()];
    // Rest: arms slightly out from the body.
    want[0].setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.25);
    want[1].setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.25);
    if (m.target) {
      // The target direction in the robot's own frame (it faces +z).
      const dx = m.target.x - m.x;
      const dz = m.target.z - m.z;
      const c = Math.cos(-m.heading);
      const s = Math.sin(-m.heading);
      const local = new THREE.Vector3(dx * c + dz * s, 1.2, -dx * s + dz * c).normalize();
      const arm = local.x >= 0 ? 1 : 0;
      want[arm].setFromUnitVectors(DOWN, local);
    } else {
      // Both stopped: a shrug, both arms out, palms up.
      want[0].setFromAxisAngle(new THREE.Vector3(0, 0, 1), -1.1);
      want[1].setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.1);
    }
    if (m.wave) {
      // Wave at the camera with the arm that is not pointing (both when nobody points).
      const free = m.target ? (want[1].angleTo(new THREE.Quaternion()) > 0.5 ? 0 : 1) : 1;
      const side = free === 1 ? 1 : -1;
      _q.setFromEuler(new THREE.Euler(-0.3, 0, side * (2.5 + 0.45 * Math.sin(time * 12))));
      want[free].copy(_q);
    }
    const k = 0.15;
    left.quaternion.slerp(want[0], k);
    right.quaternion.slerp(want[1], k);
    // A little bob (a happy bounce while waving).
    it.robot.position.y = m.y + (m.wave ? 0.18 * Math.abs(Math.sin(time * 6)) : 0.06 * Math.sin(time * 3));
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

/** Merge plain geometries (position + normal [+ index]). */
function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  for (const p of out) if (!p.getAttribute('normal')) p.computeVertexNormals();
  let n = 0;
  for (const p of out) n += p.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const p of out) {
    pos.set(p.getAttribute('position').array as Float32Array, o * 3);
    nor.set(p.getAttribute('normal').array as Float32Array, o * 3);
    o += p.getAttribute('position').count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}
