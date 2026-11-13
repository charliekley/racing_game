/**
 * A small "postcard" picture of a track, rendered with the real 3D scene (terrain, road, scenery,
 * sky and lighting) from an elevated three-quarter viewpoint. Used on the phone track cards and the
 * TV lobby.
 *
 * One WebGL renderer is created on first use and reused for every track; each shot builds the
 * track's scene, draws it once, copies the pixels into a small 2D canvas and then disposes the scene
 * again, so GPU memory does not pile up. `close()` frees the renderer itself (call it when the last
 * shot is done; it is recreated automatically if you shoot again).
 */
import * as THREE from 'three';
import { Track } from '../sim/track';
import type { TrackDef } from '../track';
import { disposeObject } from './dispose';
import { applyTheme, createScene, followWithSun, TONE_MAPPING } from './scene';
import { TrackView } from './trackView';

/** Picture size in CSS pixels (the 3D render is 2x this, then scaled down = free anti-aliasing). */
export const SHOT_W = 208;
export const SHOT_H = 120;

/**
 * Where the camera looks. `at` = fraction of the lap (0 = start line), `ahead` = how far (m) the
 * focus point is along the road from there; `back` / `side` / `up` = camera offset from the focus
 * (m, behind the direction of travel, to the right, above). Tracks not listed use DEFAULT_VIEW:
 * the start line seen from behind-right and above.
 */
interface ShotView {
  at: number;
  ahead: number;
  back: number;
  side: number;
  up: number;
  fov: number;
}
const DEFAULT_VIEW: ShotView = { at: 0, ahead: 40, back: 90, side: 65, up: 62, fov: 42 };
/** Per-track viewpoints: the start line, or a signature feature where that is more recognisable. */
const VIEWS: Record<string, Partial<ShotView>> = {};

export class TrackShooter {
  private renderer: THREE.WebGLRenderer | null = null;
  private target: HTMLCanvasElement | null = null;

  /** Render `def` and return the picture as a canvas (SHOT_W x SHOT_H). */
  shoot(def: TrackDef): HTMLCanvasElement {
    const renderer = this.ensureRenderer();
    const track = new Track(def);
    const { scene, sun } = createScene(def.theme);
    applyTheme(scene, def.theme, renderer, 64); // sky, fog, lights and a small reflection map
    const view = new TrackView(track);
    view.update(1.5); // freeze the animated bits (flags, boost arrows) at a pleasant moment
    scene.add(view.group);

    // Camera: look at a point of the road, from behind-right and above.
    const v: ShotView = { ...DEFAULT_VIEW, ...VIEWS[def.name] };
    const s = (v.at * track.length + v.ahead + track.length) % track.length;
    const p = track.pointAt(s);
    const smp = track.samples[p.index];
    const focus = new THREE.Vector3(p.x, p.y + 1, p.z);
    const cam = new THREE.PerspectiveCamera(v.fov, SHOT_W / SHOT_H, 1, 3000);
    cam.position.set(
      focus.x - smp.tx * v.back + smp.rx * v.side,
      focus.y + v.up,
      focus.z - smp.tz * v.back + smp.rz * v.side,
    );
    cam.lookAt(focus);

    sun.shadow.mapSize.set(1024, 1024);
    // One shadow map framed on the picture (the sun's box follows the focus point).
    followWithSun(sun, focus.x, focus.z, 110);
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, cam);

    // Copy into a small 2D canvas (scaling 2x -> 1x smooths the edges).
    const out = (this.target ??= document.createElement('canvas'));
    out.width = SHOT_W;
    out.height = SHOT_H;
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(renderer.domElement, 0, 0, SHOT_W, SHOT_H);

    // Free everything this shot made.
    scene.remove(view.group);
    disposeObject(view.group);
    disposeObject(scene);
    (scene.userData.envTarget as THREE.WebGLRenderTarget | undefined)?.dispose();
    sun.shadow.map?.dispose();
    sun.dispose();
    return out;
  }

  private ensureRenderer(): THREE.WebGLRenderer {
    if (this.renderer) return this.renderer;
    // Not added to the page: an off-screen canvas. preserveDrawingBuffer lets us copy it after render().
    const r = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.setSize(SHOT_W * 2, SHOT_H * 2, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = TONE_MAPPING;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false;
    return (this.renderer = r);
  }

  /** Release the renderer and its GL context (the cached pictures stay valid). */
  close(): void {
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
  }
}
