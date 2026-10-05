// Reference furniture, built from FIT (acts.ts): the shapes the poses are fitted to. Origin is
// the slot's point (the floor under the hips); the person faces +z. The dev pages use these; a
// world can use them as they are, or check its own furniture against them.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { FIT } from "./acts.ts";

const mats = () => ({
  teak: new THREE.MeshStandardMaterial({ color: "#b7804f", roughness: 0.7 }),
  cushion: new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.9 }),
  chrome: new THREE.MeshStandardMaterial({ color: "#d6dbe2", roughness: 0.22, metalness: 0.9 }),
  dark: new THREE.MeshStandardMaterial({ color: "#2a2f3a", roughness: 0.5 }),
  fabric: new THREE.MeshStandardMaterial({ color: "#f3efe4", roughness: 0.95, side: THREE.DoubleSide }),
  rope: new THREE.MeshStandardMaterial({ color: "#e9dcc0", roughness: 1 }),
});

function box(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, r = 0.02) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) * 0.99), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}
function cyl(parent: THREE.Object3D, mat: THREE.Material, r: number, h: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** A chair: seat at FIT.chair.seat. */
export function chair(seat: number = FIT.chair.seat, M = mats()) {
  const g = new THREE.Group();
  box(g, M.cushion, 0.48, 0.07, 0.46, 0, seat - 0.035, 0.02, 0.03);
  box(g, M.dark, 0.46, 0.03, 0.44, 0, seat - 0.085, 0.02);
  cyl(g, M.chrome, 0.025, seat - 0.1, 0, (seat - 0.1) / 2, 0);
  box(g, M.chrome, 0.5, 0.025, 0.06, 0, 0.012, 0, 0.01).rotation.y = 0.6;
  box(g, M.chrome, 0.5, 0.025, 0.06, 0, 0.012, 0, 0.01).rotation.y = -0.6;
  const back = box(g, M.cushion, 0.46, 0.42, 0.06, 0, seat + 0.25, -0.22, 0.03);
  back.rotation.x = -0.12;
  return g;
}

/** A desk with its chair: the top FIT.desk.above over the seat. */
export function desk(seat: number = FIT.desk.seat, M = mats()) {
  const g = chair(seat, M);
  const top = seat + FIT.desk.above;
  box(g, M.teak, 1.3, 0.04, 0.68, 0, top - 0.02, 0.6, 0.01);
  for (const x of [-0.6, 0.6]) box(g, M.chrome, 0.05, top - 0.04, 0.6, x, (top - 0.04) / 2, 0.6, 0.01);
  return g;
}

/** A low armchair for a laptop on the lap. */
export function deckChair(seat: number = FIT.deckChair.seat, M = mats()) {
  const g = new THREE.Group();
  box(g, M.teak, 0.66, 0.06, 0.62, 0, seat - 0.12, 0.03, 0.02);
  box(g, M.cushion, 0.58, 0.09, 0.56, 0, seat - 0.045, 0.04, 0.04);
  for (const s of [-1, 1]) {
    box(g, M.teak, 0.07, seat + 0.18, 0.66, s * 0.33, (seat + 0.18) / 2, 0.02, 0.02);
  }
  const back = box(g, M.cushion, 0.58, 0.5, 0.1, 0, seat + 0.2, -0.27, 0.04);
  back.rotation.x = -0.28;
  return g;
}

/** A sun lounger: the backrest at FIT.lounger.back from vertical, passing FIT.lounger.behind behind the hip point. */
export function lounger(M = mats()) {
  const { seat, back: r, behind } = FIT.lounger;
  const g = new THREE.Group();
  // Where the backrest's surface meets the seat (the hip point is at seat + 0.1).
  const u = new THREE.Vector3(0, Math.cos(r), -Math.sin(r)), n = new THREE.Vector3(0, -Math.sin(r), -Math.cos(r));
  const p0 = new THREE.Vector3(0, seat + 0.1, 0).addScaledVector(n, behind);
  const t0 = (seat - p0.y) / u.y;
  const hinge = p0.clone().addScaledVector(u, t0);
  box(g, M.teak, 0.72, 0.08, 1.95, 0, seat - 0.13, 0.32, 0.02);
  box(g, M.cushion, 0.66, 0.08, 1.3, 0, seat - 0.04, hinge.z + 0.65, 0.04);
  const len = 0.8;
  const backrest = new THREE.Group();
  backrest.position.copy(hinge);
  backrest.rotation.x = -r;
  g.add(backrest);
  box(backrest, M.cushion, 0.66, len, 0.08, 0, len / 2, -0.04, 0.04);
  box(backrest, M.teak, 0.7, len, 0.04, 0, len / 2, -0.1, 0.01);
  // A rolled towel under the knees and one as a pillow, as on the sun deck.
  const towel = new THREE.MeshStandardMaterial({ color: "#3d6fd4", roughness: 0.95 });
  const pillow = cyl(backrest, towel, 0.06, 0.5, 0, len - 0.12, 0.03);
  pillow.rotation.z = Math.PI / 2;
  for (const x of [-0.3, 0.3]) for (const z of [-0.5, 1.2]) box(g, M.teak, 0.06, seat - 0.17, 0.06, x, (seat - 0.17) / 2, z, 0.01);
  return g;
}

/** A hammock slung between two posts, its low point FIT.hammock.seat under the hips. */
export function hammock(M = mats()) {
  const { seat } = FIT.hammock;
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(0.9, 2.3, 10, 24);
  const pos = geo.attributes["position"]!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = -pos.getY(i);
    // A sling: low under the hips, rising toward both ends and the sides.
    const zz = z - 0.12;
    pos.setXYZ(i, x * (0.75 + 0.25 * Math.min(1, Math.abs(zz) / 1.1)), seat - 0.04 + 0.3 * zz * zz + 0.28 * x * x, z);
  }
  geo.computeVertexNormals();
  const sling = new THREE.Mesh(geo, M.fabric);
  sling.castShadow = sling.receiveShadow = true;
  g.add(sling);
  const ends = [-1.15, 1.15];
  for (const z of ends) {
    const y = seat - 0.04 + 0.3 * (z - 0.12) ** 2;
    const bar = cyl(g, M.teak, 0.02, 0.85, 0, y, z);
    bar.rotation.z = Math.PI / 2;
    const post = Math.sign(z) * 1.75;
    cyl(g, M.chrome, 0.045, 1.5, 0, 0.75, post);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 5), M.rope);
    const a = new THREE.Vector3(0, y, z), b = new THREE.Vector3(0, 1.35, post);
    rope.position.copy(a).add(b).multiplyScalar(0.5);
    rope.scale.y = a.distanceTo(b);
    rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.add(rope);
  }
  return g;
}

/** A bar stool: seat at FIT.stool.seat. */
export function barStool(M = mats()) {
  const { seat } = FIT.stool;
  const g = new THREE.Group();
  cyl(g, M.cushion, 0.2, 0.07, 0, seat - 0.035, 0);
  cyl(g, M.chrome, 0.03, seat - 0.07, 0, (seat - 0.07) / 2, 0);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 6, 24), M.chrome);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.3;
  g.add(ring);
  cyl(g, M.chrome, 0.2, 0.02, 0, 0.01, 0);
  return g;
}

/** A length of rail along x, its top FIT.rail.height high: chrome posts and glass. */
export function rail(length = 2, M = mats()) {
  const g = new THREE.Group();
  const h = FIT.rail.height;
  const top = cyl(g, M.chrome, 0.03, length, 0, h, 0);
  top.rotation.z = Math.PI / 2;
  for (let x = -length / 2; x <= length / 2 + 1e-6; x += 1) cyl(g, M.chrome, 0.025, h, x, h / 2, 0);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(length, h - 0.15, 0.015), new THREE.MeshStandardMaterial({ color: "#bfe6f2", roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false }));
  glass.position.y = (h - 0.15) / 2 + 0.05;
  g.add(glass);
  return g;
}

/** A sun umbrella. */
export function umbrella(M = mats()) {
  const g = new THREE.Group();
  cyl(g, M.teak, 0.025, 2.4, 0, 1.2, 0);
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.42, 10, 1, true), new THREE.MeshStandardMaterial({ color: "#f7f5ef", roughness: 0.9, side: THREE.DoubleSide }));
  canopy.position.y = 2.32;
  canopy.castShadow = true;
  g.add(canopy);
  return g;
}

/** Pool water: a translucent slab whose top is at y = 0 (a swimmer's slot sits on it). */
export function poolWater(w = 3, d = 3) {
  const g = new THREE.Group();
  const water = new THREE.Mesh(new THREE.BoxGeometry(w, 1.4, d), new THREE.MeshStandardMaterial({ color: "#2fc4d9", roughness: 0.08, transparent: true, opacity: 0.55, depthWrite: false }));
  water.position.y = -0.7;
  water.renderOrder = 3;
  g.add(water);
  // The tank: a tiled floor and walls up to the waterline.
  const tile = new THREE.MeshStandardMaterial({ color: "#e8f6f8", roughness: 0.6 });
  for (const [sx, sy, sz, x, y, z] of [[w + 0.3, 0.1, d + 0.3, 0, -1.45, 0], [0.15, 1.6, d + 0.3, -w / 2 - 0.075, -0.7, 0], [0.15, 1.6, d + 0.3, w / 2 + 0.075, -0.7, 0], [w, 1.6, 0.15, 0, -0.7, -d / 2 - 0.075], [w, 1.6, 0.15, 0, -0.7, d / 2 + 0.075]] as const) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), tile);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}
