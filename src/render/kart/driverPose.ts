/**
 * Puts a pick-animation pose (see pickAnim.ts) onto a kart's driver pieces. Shared by the selection stage
 * (which plays it every frame) and the clearance test (which plays it at many moments and checks that the
 * driver never pokes into the kart).
 */
import * as THREE from 'three';
import type { KartModel } from '../kartModel';
import type { PickPose } from './pickAnim';

/**
 * Add `p` on top of the sitting pose the driver rig has just written.
 *  - breath: small idle squash (added to the pose's own squash)
 *  - sway:   small idle torso roll (rad)
 *  - lookOffset: how far the turntable is turned away from the camera; the head counter-turns to keep looking at it
 */
export function applyPickPose(m: KartModel, p: PickPose, breath: number, sway: number, lookOffset: number): void {
  const d = m.driver;
  // A roll cage roof leaves no room to stretch tall either.
  const sq = m.liftLimit < Infinity ? Math.min(p.squash + breath, 0.03) : p.squash + breath;
  d.position.y += Math.min(p.lift, m.liftLimit); // a roll cage roof stops the hop
  // A caged kart (roll cage roof) has no room for a somersault: stay upright instead.
  const pitch = m.liftLimit < Infinity ? 0 : p.pitch;
  d.rotation.x = pitch;
  // Flip about the middle of the body, not the hips, so the head does not dive into the seat.
  const cy = 0.55 * d.scale.y;
  d.position.y += cy * (1 - Math.cos(pitch));
  d.position.z -= cy * Math.sin(pitch);
  d.rotation.y = Math.abs(p.yaw) < 1.5 ? p.yaw * m.twistScale : p.yaw; // (a full spin is left alone)
  d.rotation.z = p.roll;
  d.scale.set(d.scale.x * (1 - sq * 0.5), d.scale.y * (1 + sq), d.scale.z * (1 - sq * 0.5));
  m.torso.rotation.x += p.torsoPitch;
  m.torso.rotation.y += p.torsoYaw * m.twistScale;
  m.torso.rotation.z += p.torsoRoll + sway;
  // The head follows the camera while the turntable swings, plus the move's own head motion.
  m.head.rotation.x += p.headPitch;
  m.head.rotation.y += p.headYaw - THREE.MathUtils.clamp(lookOffset, -0.8, 0.8) * 0.7;
  m.head.rotation.z += p.headRoll;
}
