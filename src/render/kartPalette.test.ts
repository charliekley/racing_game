/** Karts are painted from the character's palette (not the player's slot colour). Runs without a GPU. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHARACTERS, KART_BODIES, paletteFor } from '../shared/characters';
import { buildKartModel } from './kartModel';
import { KartView } from './kartView';

const mesh = (root: THREE.Object3D, name: string) => {
  let found: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh && o.name === name) found = o as THREE.Mesh;
  });
  return found as THREE.Mesh | null;
};
const hexOf = (m: THREE.Mesh) => (m.material as THREE.MeshStandardMaterial).color.getHex();

describe('kart paint from palettes', () => {
  it('paints body and trim from the palette and ignores the colour argument', () => {
    for (let c = 0; c < CHARACTERS.length; c++) {
      const pal = paletteFor(c);
      const model = buildKartModel('#ff00ff', 0, c, 'low', pal);
      expect(hexOf(mesh(model.root, 'kart-paint')!)).toBe(new THREE.Color(pal.body).getHex());
      expect(hexOf(mesh(model.root, 'kart-accent')!)).toBe(new THREE.Color(pal.trim).getHex());
    }
  });

  it('without a palette the body is the given colour (as before)', () => {
    const model = buildKartModel('#33aa55', 1, 3, 'low');
    expect(hexOf(mesh(model.root, 'kart-paint')!)).toBe(new THREE.Color('#33aa55').getHex());
  });

  it('gives every character different wheels, and shares them between karts of one palette', () => {
    const geo = (c: number, k = 0) => buildKartModel('#000', k, c, 'low', paletteFor(c)).wheels[0].geometry;
    expect(geo(0)).toBe(geo(0));
    expect(geo(0)).not.toBe(geo(1));
    // The default (no palette) wheels are a different geometry again.
    expect(buildKartModel('#000', 0, 0, 'low').wheels[0].geometry).not.toBe(geo(0));
  });

  it('works for every body style (distinct shapes keep their own geometry)', () => {
    const geos = KART_BODIES.map((_, k) => mesh(buildKartModel('#000', k, 3, 'low', paletteFor(3)).root, 'kart-paint')!.geometry);
    expect(new Set(geos).size).toBe(KART_BODIES.length);
  });

  it('KartView with a loadout uses the character palette; the slot colour is only a fallback', () => {
    const scene = new THREE.Scene();
    const withLoadout = new KartView(scene, '#ff00ff', { character: 6, kart: 2 });
    expect(hexOf(mesh(withLoadout.model.root, 'kart-paint')!)).toBe(new THREE.Color(paletteFor(6).body).getHex());
    const without = new KartView(scene, '#ff00ff');
    expect(hexOf(mesh(without.model.root, 'kart-paint')!)).toBe(new THREE.Color('#ff00ff').getHex());
  });
});
