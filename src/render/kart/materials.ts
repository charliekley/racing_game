/**
 * Kart materials.
 *
 * Three.js concept: a "PBR" (physically based) material describes a surface by
 * its colour, ROUGHNESS (0 = mirror, 1 = chalk) and METALNESS (0 = paint/plastic,
 * 1 = bare metal). Lights and, later, an environment map (a picture of the
 * surroundings that shiny surfaces reflect) do the rest.
 *
 * Only three materials are needed per kart, which keeps draw calls low:
 *  - paint   : glossy clear-coated car paint in the player's colour
 *  - accent  : a lighter tint of the same colour (stripes, wing, fenders)
 *  - detail  : ONE shared material for everything else (rubber, chrome, seat,
 *              lamps, the whole driver...). Colour, roughness, metalness and
 *              glow are stored PER VERTEX (see `Surf` in geo.ts), and a tiny
 *              shader patch reads them. So chrome and rubber can live in the
 *              same mesh.
 */
import * as THREE from 'three';

let detailMat: THREE.MeshStandardMaterial | null = null;

/** The shared vertex-coloured material (colour = `color` attribute, roughness/metal/glow = `surf`). */
export function getDetailMaterial(): THREE.MeshStandardMaterial {
  if (detailMat) return detailMat;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 1 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 surf;\nvarying vec3 vSurf;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = surf;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurf;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSurf.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurf.y;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vSurf.z;');
  };
  m.customProgramCacheKey = () => 'kart-detail-v1';
  detailMat = m;
  return m;
}

export interface PaintMaterials {
  paint: THREE.Material;
  accent: THREE.Material;
}

const paintCache = new Map<string, PaintMaterials>();

/** Player-colour materials, cached per colour and detail level (Low skips the clear coat). */
export function getPaintMaterials(colorHex: string, high: boolean): PaintMaterials {
  const key = `${colorHex}|${high ? 1 : 0}`;
  let mats = paintCache.get(key);
  if (mats) return mats;
  const base = new THREE.Color(colorHex);
  const light = base.clone().lerp(new THREE.Color('#ffffff'), 0.4);
  if (high) {
    mats = {
      paint: new THREE.MeshPhysicalMaterial({ color: base, roughness: 0.34, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08 }),
      accent: new THREE.MeshPhysicalMaterial({ color: light, roughness: 0.4, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.15 }),
    };
  } else {
    mats = {
      paint: new THREE.MeshStandardMaterial({ color: base, roughness: 0.4, metalness: 0.1 }),
      accent: new THREE.MeshStandardMaterial({ color: light, roughness: 0.45, metalness: 0.05 }),
    };
  }
  paintCache.set(key, mats);
  return mats;
}

/** Fixed colour palette for non-player parts (sRGB hex; vertex colours convert to linear). */
export const PAL = {
  tyre: '#1b1c21',
  rubber: '#2a2c33',
  black: '#17181d',
  dark: '#23252c',
  seat: '#2c2f3a',
  steel: '#aeb5c2',
  chrome: '#e4e8f0',
  brass: '#d9a93a',
  white: '#f4f4f0',
  lampWhite: '#fff1c2',
  lampRed: '#ff3b2f',
  glassDark: '#16233a',
  mustard: '#e2b23a',
  red: '#d9433b',
  blue: '#3c7ed9',
} as const;
