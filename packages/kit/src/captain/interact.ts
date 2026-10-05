// What the captain can use or click: the nearest interactable within reach and roughly in view
// (the helm, a door, the helicopter), and the crew member under the cursor or the crosshair.

import * as THREE from "three";
import type { Interactable } from "../world.ts";

/**
 * The best interactable to offer from `from` (the captain's chest) looking along `forward` (flat):
 * within its radius, and within `maxAngle` of the view unless right next to it.
 */
export function nearestInteractable(list: readonly Interactable[], from: THREE.Vector3, forward: THREE.Vector3, maxAngle = 1.15): Interactable | null {
  let best: Interactable | null = null, bestScore = Infinity;
  const to = new THREE.Vector3();
  for (const it of list) {
    to.subVectors(it.at, from);
    const d = to.length();
    if (d > it.radius) continue;
    to.y = 0;
    const flat = to.length();
    const angle = flat > 1e-3 ? Math.acos(Math.max(-1, Math.min(1, to.dot(forward) / flat))) : 0;
    if (angle > maxAngle && d > 0.9) continue;
    const score = d / it.radius + angle * 0.6;
    if (score < bestScore) { bestScore = score; best = it; }
  }
  return best;
}

const raycaster = new THREE.Raycaster();

/**
 * Which of `objects` is under ndc (-1..1; the crosshair is 0, 0). Hits on any descendant count
 * for the object it belongs to. Null when none.
 */
export function pick(ndc: THREE.Vector2, camera: THREE.Camera, objects: readonly THREE.Object3D[], far = 80): THREE.Object3D | null {
  raycaster.setFromCamera(ndc, camera);
  raycaster.far = far;
  const hits = raycaster.intersectObjects(objects as THREE.Object3D[], true);
  const roots = new Set(objects);
  for (const h of hits) {
    if (!visibleUp(h.object)) continue;
    for (let o: THREE.Object3D | null = h.object; o; o = o.parent) if (roots.has(o)) return o;
  }
  return null;
}

function visibleUp(o: THREE.Object3D | null) {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}
