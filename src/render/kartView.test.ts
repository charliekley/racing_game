/**
 * Smoke test for the kart's visual effects. Three.js scene objects work
 * without a browser/GPU, so we can check the effect logic in Node.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createKart } from '../sim/kart';
import { KartView } from './kartView';
import { GameFx } from './fx/gameFx';
import { QUALITY_PRESETS } from './scene';

function setup() {
  const scene = new THREE.Scene();
  const view = new KartView(scene, '#e63946');
  const kart = createKart(0, 0, 0);
  kart.speed = 20;
  return { scene, view, kart };
}

describe('KartView effects', () => {
  it('feeds drift sparks to the shared particle system only while drifting', () => {
    const { scene, view, kart } = setup();
    const fx = new GameFx(scene, QUALITY_PRESETS[0]);
    view.update(kart, kart, 1, 1 / 60);
    fx.update(1 / 60);
    expect(fx.glow.alive).toBe(0);
    kart.driftDir = 1;
    kart.driftTier = 1;
    for (let i = 0; i < 5; i++) view.update(kart, kart, 1, 1 / 60);
    fx.update(1 / 60);
    expect(fx.glow.alive).toBeGreaterThan(0);
    fx.dispose();
  });

  it('shows boost flames only while boosting', () => {
    const { view, kart } = setup();
    // Flames are children of the model's exhaust markers.
    const flames = () => view.model.exhausts.flatMap((m) => m.children).filter((c) => c instanceof THREE.Group);
    expect(flames().length).toBeGreaterThan(0);
    view.update(kart, kart, 1, 1 / 60);
    expect(flames().every((f) => !f.visible)).toBe(true);
    kart.boostTime = 1;
    view.update(kart, kart, 1, 1 / 60);
    expect(flames().some((f) => f.visible)).toBe(true);
  });

  it('shows the carrier drone above the kart during a respawn', () => {
    const { scene, view, kart } = setup();
    kart.respawnTime = 1;
    view.update(kart, kart, 1, 1 / 60);
    const drone = scene.children.find((o) => o instanceof THREE.Group && o !== view.model.root && o.visible);
    expect(drone).toBeDefined();
    expect(drone!.position.y).toBeGreaterThan(kart.pos.y + 1);
  });
});
