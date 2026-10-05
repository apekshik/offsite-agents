// Two-bone IK for an arm: puts a palm on a point (a laptop's keys, a box's side, the cheek) for
// any body's proportions, so a long-armed giant and a short-armed kid both reach the same keys.
// Works in the chest's frame, where the shoulder joint hangs; bones rest pointing down (-y).

import * as THREE from "three";

const DOWN = new THREE.Vector3(0, -1, 0);
const _d = new THREE.Vector3(), _e = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3();
const _E = new THREE.Vector3(), _T = new THREE.Vector3(), _qU = new THREE.Quaternion(), _qF = new THREE.Quaternion(), _inv = new THREE.Quaternion();

/**
 * Bends upper arm and forearm so the palm (forearm length F past the elbow) reaches target.
 * shoulder, target and pole (which way the elbow points) are in the upper arm's parent frame.
 * Blends with whatever the bones held by w (0..1).
 */
export function solveArm(
  upper: THREE.Object3D, fore: THREE.Object3D,
  shoulder: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3,
  U: number, F: number, w: number,
) {
  if (w <= 0) return;
  const d = _d.subVectors(target, shoulder);
  let L = d.length();
  if (L < 1e-5) return;
  d.divideScalar(L);
  L = Math.min(U + F - 1e-3, Math.max(Math.abs(U - F) + 1e-3, L));
  const cosA = (U * U + L * L - F * F) / (2 * U * L);
  const a = Math.acos(Math.max(-1, Math.min(1, cosA)));
  // The elbow swings out of the shoulder-to-hand line toward the pole.
  const e = _e.copy(pole).addScaledVector(d, -pole.dot(d));
  if (e.lengthSq() < 1e-8) e.set(0, 0, -1).addScaledVector(d, d.z);
  e.normalize();
  _u.copy(d).multiplyScalar(Math.cos(a)).addScaledVector(e, Math.sin(a)).normalize();
  _E.copy(shoulder).addScaledVector(_u, U);
  _T.copy(shoulder).addScaledVector(d, L);
  _qU.setFromUnitVectors(DOWN, _u);
  _f.subVectors(_T, _E).normalize().applyQuaternion(_inv.copy(_qU).invert());
  _qF.setFromUnitVectors(DOWN, _f);
  if (w >= 1) {
    upper.quaternion.copy(_qU);
    fore.quaternion.copy(_qF);
  } else {
    upper.quaternion.slerp(_qU, w);
    fore.quaternion.slerp(_qF, w);
  }
}
