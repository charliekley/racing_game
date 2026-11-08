/**
 * One driving session on the host: owns the sim World, the Three.js scene and
 * the fixed-step loop. M2 = free drive on the test oval with a single chase
 * camera (press C to follow a different player). Split-screen comes in M4.
 */
import * as THREE from 'three';
import { colorHex } from '../shared/colors';
import { SIM_DT } from '../sim/config';
import { TEST_OVAL, TestGround } from '../sim/ground';
import { FixedStepLoop } from '../sim/loop';
import { World } from '../sim/world';
import { ChaseCamera } from '../render/chaseCamera';
import { KartView } from '../render/kartView';
import { createRenderer, createScene, followWithSun } from '../render/scene';
import { buildTestGround } from '../render/testGroundView';
import type { PlayerManager } from './playerManager';

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private sun: THREE.DirectionalLight;
  private world = new World(new TestGround());
  private views = new Map<number, KartView>();
  private chase = new ChaseCamera();
  private loop: FixedStepLoop;
  private followIndex = 0;
  private hud: HTMLElement;

  constructor(
    private readonly container: HTMLElement,
    private readonly players: PlayerManager,
  ) {
    this.renderer = createRenderer(container);
    const parts = createScene();
    this.scene = parts.scene;
    this.sun = parts.sun;
    buildTestGround(this.scene);

    this.loop = new FixedStepLoop(() => this.world.tick((slot) => this.players.inputFor(slot)), SIM_DT);

    this.hud = document.createElement('div');
    this.hud.className = 'drive-hud';
    container.appendChild(this.hud);

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC' && this.views.size > 0) {
        this.followIndex = (this.followIndex + 1) % this.views.size;
        this.chase.snap();
      }
    });
    this.resize();
  }

  /** (Re)start with a kart for each occupied slot, lined up on the start straight. */
  start(slots: number[]): void {
    for (const v of this.views.values()) v.dispose(this.scene);
    this.views.clear();
    this.world = new World(new TestGround());
    slots.forEach((slot, i) => {
      const x = TEST_OVAL.radius + (i % 2 === 0 ? 3.5 : -3.5);
      const z = -6 - Math.floor(i / 2) * 7 - (i % 2) * 3;
      this.world.addKart(slot, { x, z, heading: 0 }); // heading 0 = facing +z along the straight
      const color = this.players.slots.slots[slot]?.color ?? slot;
      this.views.set(slot, new KartView(this.scene, colorHex(color)));
    });
    this.followIndex = 0;
    this.chase.snap();
    this.loop.reset();
    this.resize();
  }

  /** Called every animation frame while driving. */
  frame(dt: number): void {
    const alpha = this.loop.advance(dt);
    for (const [slot, view] of this.views) {
      view.update(this.world.prevKarts.get(slot)!, this.world.karts.get(slot)!, alpha, dt);
    }
    const followSlot = [...this.views.keys()][this.followIndex];
    const view = followSlot === undefined ? undefined : this.views.get(followSlot);
    if (view) {
      this.chase.update(view.pose, dt);
      followWithSun(this.sun, view.pose.x, view.pose.z);
      this.updateHud(followSlot!, view);
    }
    this.renderer.render(this.scene, this.chase.camera);
  }

  private updateHud(slot: number, view: KartView): void {
    const kart = this.world.karts.get(slot)!;
    const p = this.players.slots.slots[slot];
    const input = this.players.inputFor(slot);
    const kmh = Math.round(Math.abs(view.pose.speed) * 3.6);
    const steerPct = Math.round(input.steer * 100);
    this.hud.innerHTML = `
      <div class="hud-speed"><b>${kmh}</b> km/h</div>
      <div class="hud-line"></div>
      <div class="hud-line">steer ${steerPct >= 0 ? '+' : ''}${steerPct}% · ${kart.surface === 'road' ? 'road' : 'GRASS'}${kart.grounded ? '' : ' · airborne'}</div>
      <div class="hud-help">C: switch camera (${this.views.size} kart${this.views.size > 1 ? 's' : ''}) · Esc: back to lobby</div>`;
    // Player name via textContent (it comes from a phone).
    (this.hud.children[1] as HTMLElement).textContent = p ? `Following P${slot + 1} · ${p.name}` : '';
    this.hud.style.setProperty('--slot-color', colorHex(p?.color ?? 0));
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.chase.setAspect(w / h);
  }
}
