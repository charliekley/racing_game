/**
 * Clearance tests: no driver part may poke into the kart, for every one of the 12 characters on every one of
 * the 4 bodies, at rest, at the extreme poses of the driver rig (steering, leaning, looking back over the
 * shoulder, boost, arms up, spin-out...) and during the 12 pick animations of the selection screen.
 *
 * If one of these fails after you change a head, a tail, a roll cage or the seat: the message names the combo,
 * the pose, which driver part and which kart part overlap, how deep (m) and where (body space). Fix the
 * geometry (smaller head or tail, wider cage, seat further back...), do not raise the tolerance.
 *
 * Set CLR_OUT=file.txt (and optionally CLR_STYLE=0..3) to also write a report of the worst overlaps, even
 * small ones, while tuning.
 */
import { describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { CHARACTERS } from '../../shared/characters';
import { KART_STYLES } from '../kartModel';
import { SampleGrid, mutualOverlap, sampleTriangles, transformSamples } from './clearance';
import { CLEARANCE_TOLERANCE, checkCombo, type Hit } from './clearanceCheck';

describe('overlap measuring (the tool itself)', () => {
  const sphere = (r: number, at: [number, number, number]) => {
    const g = new THREE.SphereGeometry(r, 24, 16);
    return transformSamples(
      sampleTriangles(g.getAttribute('position').array as Float32Array, g.index!.array, 0.02),
      new THREE.Matrix4().makeTranslation(...at),
    );
  };

  it('measures how deep one ball sits inside another, and 0 when they are apart', () => {
    const kart = new SampleGrid().add(sphere(0.3, [0, 0, 0]));
    // Centres 0.5 apart, radii 0.3 and 0.2: they overlap by 0.3 + 0.2 - 0.5 = 0 -> just touching.
    expect(mutualOverlap(sphere(0.2, [0.55, 0, 0]), kart).depth).toBeLessThan(0.005);
    // Move it 0.06 closer: about 6 cm of overlap.
    const o = mutualOverlap(sphere(0.2, [0.44, 0, 0]), kart);
    expect(o.depth).toBeGreaterThan(0.04);
    expect(o.depth).toBeLessThan(0.09);
  });

  it('sees a thin bar that pierces a ball (kart points inside the driver)', () => {
    const bar = new THREE.CylinderGeometry(0.02, 0.02, 1, 8, 8);
    const kart = new SampleGrid().add(
      transformSamples(sampleTriangles(bar.getAttribute('position').array as Float32Array, bar.index!.array, 0.02), new THREE.Matrix4()),
    );
    expect(mutualOverlap(sphere(0.2, [0, 0, 0]), kart).depth).toBeGreaterThan(0.015);
  });
});

describe('driver clearance in every kart', () => {
  const report = process.env.CLR_OUT;
  const only = process.env.CLR_STYLE === undefined ? undefined : Number(process.env.CLR_STYLE);

  // One test per body (8 characters each). Slow-ish (about 10 s each): everything is measured, not sampled.
  KART_STYLES.forEach((style, s) => {
    it.skipIf(only !== undefined && only !== s)(
      `${style.name}: no head, torso, tail or arm pokes into the kart (all 12 characters, driving poses and pick moves)`,
      () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5); // the rig's wobble phase starts random: keep it repeatable
        const lines: string[] = [];
        const bad: string[] = [];
        for (let c = 0; c < CHARACTERS.length; c++) {
          const hits: Hit[] = checkCombo(s, c, { picks: true });
          for (const h of hits) {
            const text = `${style.id} / ${CHARACTERS[c].name}: ${h.part} overlaps ${h.hit} by ${(h.depth * 100).toFixed(1)} cm at (${h.at.map((v) => v.toFixed(2)).join(', ')}) in pose "${h.pose}"`;
            if (h.depth > CLEARANCE_TOLERANCE) bad.push(text);
            if (h.depth > 0.006) lines.push(text);
          }
        }
        if (report) writeFileSync(report, lines.join('\n'));
        expect(bad, bad.join('\n')).toEqual([]);
      },
      120000,
    );
  });
});
