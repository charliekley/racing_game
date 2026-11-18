import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TRACKS } from '../track';
import { groundPose } from '../sim/items/groundPose';
import type { ItemEntity } from '../sim/items/types';
import { Track } from '../sim/track';
import { buildEntityMesh, updateEntityMesh } from './itemMeshes';
import { buildPeelGeometry } from './peelModel';

interface Spot {
  track: Track;
  name: string;
  x: number;
  z: number;
  heading: number;
  index: number;
  pitch: number;
  roll: number;
}

/** Walk every track and keep the most banked, the steepest and a flat spot of the main road. */
function findSpots(): { banked: Spot; steep: Spot; flat: Spot } {
  let banked: Spot | null = null;
  let steep: Spot | null = null;
  let flat: Spot | null = null;
  for (const def of TRACKS) {
    const track = new Track(def);
    const hw = def.width / 2;
    for (let s = 0; s < track.length; s += 3) {
      for (const lat of [-hw + 1.5, 0, hw - 1.5]) {
        const p = track.pointAt(s, lat);
        if (track.inGap(s)) continue;
        // Skip ramp lips and landing edges: the height jumps there, so no flat object could ever lie on them.
        const hh = (d: number) => track.sample(p.x + Math.sin(p.heading) * d, p.z + Math.cos(p.heading) * d, p.index)?.height ?? NaN;
        if (!(Math.abs(hh(1.5) + hh(-1.5) - 2 * hh(0)) < 0.15) || !(Math.abs(hh(3) + hh(-3) - 2 * hh(0)) < 0.4)) continue;
        const pose = groundPose(track, p.x, p.z, p.heading, p.index, p.y);
        const spot: Spot = { track, name: def.name, x: p.x, z: p.z, heading: p.heading, index: p.index, pitch: pose.pitch, roll: pose.roll };
        if (!banked || Math.abs(spot.roll) > Math.abs(banked.roll)) banked = spot;
        if (!steep || Math.abs(spot.pitch) > Math.abs(steep.pitch)) steep = spot;
        if (!flat && Math.abs(spot.pitch) < 0.001 && Math.abs(spot.roll) < 0.001) flat = spot;
      }
    }
  }
  return { banked: banked!, steep: steep!, flat: flat! };
}

const spots = findSpots();

/** Put a peel mesh on `spot` exactly as the game does and return how it sits against the ground. */
function restOn(spot: Spot) {
  const pose = groundPose(spot.track, spot.x, spot.z, spot.heading, spot.index, 0);
  const ent: ItemEntity = {
    uid: 1,
    kind: 'slick',
    x: spot.x,
    y: pose.y,
    z: spot.z,
    heading: spot.heading,
    pitch: pose.pitch,
    roll: pose.roll,
    owner: 0,
    trailing: false,
  };
  const mesh = buildEntityMesh('slick');
  updateEntityMesh(mesh, ent, 3);
  mesh.updateMatrixWorld(true);
  const pos = (mesh.getObjectByProperty('isMesh', true) as THREE.Mesh).geometry.getAttribute('position');
  const v = new THREE.Vector3();
  let lowestGap = Infinity;
  let deepest = Infinity; // most negative gap: how far the model dips below the ground
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4((mesh.getObjectByProperty('isMesh', true) as THREE.Mesh).matrixWorld);
    const ground = spot.track.sample(v.x, v.z, spot.index)?.height ?? pose.y;
    lowestGap = Math.min(lowestGap, v.y - ground);
    deepest = Math.min(deepest, v.y - ground);
  }
  return { lowestGap, deepest, pose };
}

describe('the Peel rests on the ground', () => {
  it('the model itself sits on y = 0 and is a single draw call', () => {
    const geo = buildPeelGeometry();
    geo.computeBoundingBox();
    expect(geo.boundingBox!.min.y).toBeGreaterThan(-0.005);
    expect(geo.boundingBox!.min.y).toBeLessThan(0.06);
    expect(geo.boundingBox!.max.y).toBeLessThan(0.7);
    expect(Math.max(geo.boundingBox!.max.x, geo.boundingBox!.max.z)).toBeLessThan(1.3);
    let meshes = 0;
    buildEntityMesh('slick').traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    expect(meshes).toBe(1);
  });

  it('the test tracks really contain banked and hilly road (otherwise the checks below prove nothing)', () => {
    expect(Math.abs(spots.banked.roll)).toBeGreaterThan(0.05);
    expect(Math.abs(spots.steep.pitch)).toBeGreaterThan(0.08);
  });

  for (const which of ['flat', 'banked', 'steep'] as const) {
    it(`on a ${which} spot the model neither sinks into the ground nor floats above it`, () => {
      const spot = spots[which];
      const r = restOn(spot);
      // Never more than 3 cm below the ground (road meshes are triangles, our samples are points).
      expect(r.deepest, `${spot.name} ${which}: dips ${r.deepest}`).toBeGreaterThan(-0.03);
      // Touches down: the lowest point is within a few cm of the ground.
      expect(r.lowestGap).toBeLessThan(0.07);
    });
  }

  it('is tilted with the slope: the banked spot rolls, the steep spot pitches', () => {
    expect(Math.abs(restOn(spots.banked).pose.roll)).toBeGreaterThan(0.05);
    expect(Math.abs(restOn(spots.steep).pose.pitch)).toBeGreaterThan(0.08);
  });
});
