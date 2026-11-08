import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyTheme, createScene } from './scene';

const meadow = { sky: '#3f8fe0', horizon: '#cfeaff', grass: '#5fae4a' };
const desert = { sky: '#d9803a', horizon: '#f6d9a8', grass: '#c9a45a' };

describe('applyTheme', () => {
  it('re-colors sky, fog, background and ambient light in place', () => {
    const { scene } = createScene(meadow);
    const lightsBefore = scene.children.length;
    applyTheme(scene, desert);

    expect(scene.children.length).toBe(lightsBefore); // nothing rebuilt
    expect((scene.background as THREE.Color).getHexString()).toBe(new THREE.Color(desert.horizon).getHexString());
    expect(scene.fog!.color.getHexString()).toBe(new THREE.Color(desert.horizon).getHexString());

    const dome = scene.children.find((o) => (o as THREE.Mesh).material instanceof THREE.ShaderMaterial) as THREE.Mesh;
    const u = (dome.material as THREE.ShaderMaterial).uniforms;
    expect(u.top.value.getHexString()).toBe(new THREE.Color(desert.sky).getHexString());
    expect(u.horizon.value.getHexString()).toBe(new THREE.Color(desert.horizon).getHexString());

    const hemi = scene.children.find((o) => o instanceof THREE.HemisphereLight) as THREE.HemisphereLight;
    expect(hemi.groundColor.getHexString()).toBe(new THREE.Color(desert.grass).multiplyScalar(0.55).getHexString());
  });
});
