// The base's pieces, each built once in its own frame (standing on y = 0, facing +z) and
// instanced wherever it stands: hab shells, crates, desks, stools, lounge blocks, planters,
// lockers and suits, solar panels, tanks, masts, rovers. Chunky and clean, after the concept
// art: white structures, orange equipment, grey printed regolith. Each notes where a body goes.

import * as THREE from "three";
import type { MatKey } from "./mats.ts";
import { HAB } from "./dims.ts";
import { prefab, type Pile, type Prefab } from "./kit.ts";

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const rounded = new Map<string, THREE.BufferGeometry>();
/** A box whose edges are rounded off (cushions, cases, the lander's panels). */
export function roundedBox(sx: number, sy: number, sz: number, r: number): THREE.BufferGeometry {
  const key = [sx, sy, sz, r].map((v) => v.toFixed(3)).join("|");
  let g = rounded.get(key);
  if (g) return g;
  g = new THREE.BoxGeometry(sx, sy, sz, 4, 3, 4);
  const pos = g.attributes.position!, v = new THREE.Vector3(), c = new THREE.Vector3();
  const hx = sx / 2 - r, hy = sy / 2 - r, hz = sz / 2 - r;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(THREE.MathUtils.clamp(v.x, -hx, hx), THREE.MathUtils.clamp(v.y, -hy, hy), THREE.MathUtils.clamp(v.z, -hz, hz));
    const d = v.clone().sub(c);
    if (d.lengthSq() > 1e-8) v.copy(c).add(d.normalize().multiplyScalar(r));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  rounded.set(key, g);
  return g;
}

/** A rounded box by its centre and size, turned ry about y and rx about x. */
export function soft(p: Pile<MatKey>, mat: MatKey, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, r?: number) {
  const g = roundedBox(sx, sy, sz, r ?? Math.min(sx, sy, sz) * 0.22);
  p.add(mat, g, new THREE.Matrix4().compose(V(cx, cy, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0, "YXZ")), V(1, 1, 1)));
}

/** A disc (a wheel, a viewport, a gauge): radius r, thickness t, centred on c, its axis along `axis`. */
export function disc(p: Pile<MatKey>, mat: MatKey, c: THREE.Vector3, axis: "x" | "y" | "z", r: number, t: number, seg = 16) {
  const g = new THREE.CylinderGeometry(r, r, t, seg);
  g.deleteAttribute("uv");
  if (axis === "x") g.rotateZ(Math.PI / 2);
  if (axis === "z") g.rotateX(Math.PI / 2);
  p.add(mat, g.translate(c.x, c.y, c.z));
}

/** A ring (a torus) round c, lying across `axis`. */
export function ring(p: Pile<MatKey>, mat: MatKey, c: THREE.Vector3, axis: "x" | "y" | "z", r: number, tube: number, seg = 24) {
  const g = new THREE.TorusGeometry(r, tube, 6, seg);
  g.deleteAttribute("uv");
  if (axis === "y") g.rotateX(Math.PI / 2);
  if (axis === "x") g.rotateY(Math.PI / 2);
  p.add(mat, g.translate(c.x, c.y, c.z));
}

/** An arch's outline, x from -w/2 to w/2: straight sides to `spring`, then a half ellipse to `h`. */
function archShape(w: number, spring: number, h: number, seg = 14): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [new THREE.Vector2(w / 2, 0), new THREE.Vector2(w / 2, spring)];
  for (let i = 1; i < seg; i++) {
    const t = (i / seg) * Math.PI;
    pts.push(new THREE.Vector2((w / 2) * Math.cos(t), spring + (h - spring) * Math.sin(t)));
  }
  pts.push(new THREE.Vector2(-w / 2, spring), new THREE.Vector2(-w / 2, 0));
  return pts;
}

/** A flat arch-shaped panel facing +z at z, with holes. */
function archPanel(w: number, spring: number, h: number, z: number, holes: THREE.Vector2[][] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(archShape(w, spring, h));
  for (const hole of holes) shape.holes.push(new THREE.Path(hole));
  const g = new THREE.ShapeGeometry(shape, 8).translate(0, 0, z);
  g.deleteAttribute("uv");
  return g;
}

const circle = (cx: number, cy: number, r: number, n = 20) => Array.from({ length: n }, (_, i) => new THREE.Vector2(cx + r * Math.cos((i / n) * Math.PI * 2), cy + r * Math.sin((i / n) * Math.PI * 2)));

/** The vault of an arch extruded along z from z0 to z1: its curved outside (or inside, flipped). */
function vault(w: number, spring: number, h: number, z0: number, z1: number, inside = false, seg = 16): THREE.BufferGeometry {
  const prof = archShape(w, spring, h, seg).slice(1, -1); // without the floor corners
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let i = 0; i < prof.length; i++) {
    const p = prof[i]!;
    // The normal of an ellipse (or a side) at this point.
    let nx: number, ny: number;
    if (p.y <= spring + 1e-6) { nx = Math.sign(p.x); ny = 0; }
    else { nx = p.x / ((w / 2) * (w / 2)); ny = (p.y - spring) / ((h - spring) * (h - spring)); }
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    if (inside) { nx = -nx; ny = -ny; }
    pos.push(p.x, p.y, z0, p.x, p.y, z1);
    nor.push(nx, ny, 0, nx, ny, 0);
  }
  // Add the bottom of the sides.
  const first = prof[0]!, last = prof[prof.length - 1]!;
  const b = pos.length / 3;
  pos.push(first.x, 0, z0, first.x, 0, z1, last.x, 0, z0, last.x, 0, z1);
  const sx = inside ? -1 : 1;
  nor.push(sx, 0, 0, sx, 0, 0, -sx, 0, 0, -sx, 0, 0);
  for (let i = 0; i + 1 < prof.length; i++) {
    const p = i * 2, q = p + 2;
    idx.push(p, q, q + 1, p, q + 1, p + 1);
  }
  idx.push(b, 0, 1, b, 1, b + 1);
  const e = (prof.length - 1) * 2;
  idx.push(e, b + 2, b + 3, e, b + 3, e + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  // Wind to agree with the normals.
  const P = g.attributes.position!, N = g.attributes.normal!, I = g.index!;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), F = new THREE.Vector3(), M = new THREE.Vector3();
  for (let i = 0; i < I.count; i += 3) {
    A.fromBufferAttribute(P, I.getX(i)); B.fromBufferAttribute(P, I.getX(i + 1)); C.fromBufferAttribute(P, I.getX(i + 2));
    F.subVectors(B, A).cross(C.sub(A));
    M.fromBufferAttribute(N, I.getX(i));
    if (F.dot(M) < 0) { const t = I.getX(i + 1); I.setX(i + 1, I.getX(i + 2)); I.setX(i + 2, t); }
  }
  return g;
}

/** Flips a geometry's facing (winding and normals), in place. */
function turned(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const I = g.index!;
  for (let i = 0; i < I.count; i += 3) { const t = I.getX(i + 1); I.setX(i + 1, I.getX(i + 2)); I.setX(i + 2, t); }
  const n = g.attributes.normal;
  if (n) for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

// ---------- habs ----------

/**
 * A hab: a half-buried printed vault HAB.w wide, its back in the terrace wall, its front (+z) an
 * arch round a white end wall with an arched airlock door glowing amber and a small round
 * viewport either side. The origin is the middle of its footprint.
 */
export const HAB_FRONT = HAB.d / 2;
export const hab: Prefab<MatKey> = prefab("hab", (p) => {
  const w = HAB.w, h = HAB.h, back = -HAB.d / 2 - 0.8, front = HAB.d / 2;
  const iw = w * 0.74, ih = h * 0.8, spring = 1.2, inset = 0.55;
  p.add("printed", vault(w, spring, h, back, front));
  // The arch's front face: a thick printed ring.
  p.add("printed", archPanel(w, spring, h, front, [archShape(iw, spring * 0.9, ih).reverse()]));
  p.add("printed", vault(iw, spring * 0.9, ih, front - inset, front, true));
  // The end wall, white, with the door and the viewports cut into it.
  const door = [...archShape(1.5, 1.6, 2.45)].reverse().map((v) => new THREE.Vector2(v.x, v.y + 0.05));
  const ports = [circle(-2.05, 2.05, 0.45), circle(2.05, 2.05, 0.45)].map((c) => c.reverse());
  p.add("white", archPanel(iw, spring * 0.9, ih, front - inset, [door, ...ports]));
  // The door: an orange-trimmed frame round warm light.
  p.add("amber", archPanel(1.5, 1.6, 2.45, front - inset - 0.08).translate(0, 0.05, 0));
  p.box("white", -0.95, 0, front - inset - 0.02, -0.75, 2.2, front - inset + 0.2);
  p.box("white", 0.75, 0, front - inset - 0.02, 0.95, 2.2, front - inset + 0.2);
  p.box("orange", -0.97, 2.2, front - inset - 0.02, 0.97, 2.6, front - inset + 0.22);
  p.box("dark", -0.25, 2.3, front - inset + 0.22, 0.25, 2.45, front - inset + 0.24);
  // Viewports: glowing glass in a dark ring.
  for (const sx of [-1, 1]) {
    disc(p, "viewport", V(sx * 2.05, 2.05, front - inset - 0.04), "z", 0.46, 0.04, 18);
    ring(p, "dark", V(sx * 2.05, 2.05, front - inset + 0.02), "z", 0.5, 0.08, 18);
  }
  // A vent and a little antenna on the roof, an orange crate by the door.
  p.box("white", 1.2, h - 0.15, -1.0, 2.0, h + 0.35, -0.2);
  p.rod("steel", V(-1.6, h - 0.2, -1.2), V(-1.6, h + 1.6, -1.2), 0.03, 5);
  soft(p, "crate", 2.6, 0.32, front + 0.55, 0.9, 0.62, 0.62, 0.15);
});

/** A wider hab front for buildings dug into a riser (the work hall, the quarters, the garage): an arched airlock porch. */
export const PORCH = { w: 3.4, d: 2.6, h: 3.3 };
export const porch: Prefab<MatKey> = prefab("porch", (p) => {
  const { w, d, h } = PORCH;
  p.add("printed", vault(w, 1.6, h, -0.2, d));
  p.add("printed", archPanel(w, 1.6, h, d, [archShape(w - 0.9, 1.5, h - 0.5).reverse()]));
  p.add("printed", vault(w - 0.9, 1.5, h - 0.5, -0.2, d, true));
  p.box("orange", -(w - 0.9) / 2, h - 0.75, d - 0.1, (w - 0.9) / 2, h - 0.55, d + 0.05);
  p.box("amber", -0.9, h - 0.62, d - 0.12, 0.9, h - 0.58, d - 0.08);
  for (const sx of [-1, 1]) {
    p.box("white", sx * ((w - 0.9) / 2) - 0.12, 0, d - 0.15, sx * ((w - 0.9) / 2) + 0.12, 1.6, d + 0.05);
    p.box("amber", sx * ((w - 0.9) / 2) - 0.03, 0.4, d + 0.05, sx * ((w - 0.9) / 2) + 0.03, 1.4, d + 0.07);
  }
});

// ---------- small things outdoors ----------

/** A path light: a short printed post with an amber head, lit at night. */
export const pathLight: Prefab<MatKey> = prefab("pathLight", (p) => {
  p.box("printed", -0.13, 0, -0.13, 0.13, 0.42, 0.13);
  p.box("dark", -0.1, 0.42, -0.1, 0.1, 0.5, 0.1);
  p.box("lamp", -0.09, 0.5, -0.09, 0.09, 0.62, 0.09);
  p.box("dark", -0.11, 0.62, -0.11, 0.11, 0.66, 0.11);
});

/** An orange hard case, 0.9 × 0.62 × 0.62, with dark bands and latches. */
export const crate: Prefab<MatKey> = prefab("crate", (p) => {
  soft(p, "crate", 0, 0.31, 0, 0.9, 0.62, 0.62, 0, 0, 0.06);
  for (const sx of [-0.3, 0.3]) p.box("dark", sx - 0.04, 0.0, -0.32, sx + 0.04, 0.62, 0.32);
  p.box("dark", -0.18, 0.62, -0.05, 0.18, 0.66, 0.05);
  for (const sx of [-0.2, 0.2]) p.box("steel", sx - 0.04, 0.4, 0.31, sx + 0.04, 0.5, 0.33);
});
/** A big case, 1.3 × 0.85 × 0.85. */
export const bigCrate: Prefab<MatKey> = prefab("bigCrate", (p) => {
  soft(p, "crate", 0, 0.43, 0, 1.3, 0.85, 0.85, 0, 0, 0.08);
  for (const sx of [-0.45, 0.45]) p.box("dark", sx - 0.05, 0.0, -0.44, sx + 0.05, 0.86, 0.44);
  p.box("white", -0.3, 0.86, -0.25, 0.3, 0.9, 0.25);
});
/** A grey cargo box, white-banded. */
export const greyBox: Prefab<MatKey> = prefab("greyBox", (p) => {
  soft(p, "cushion", 0, 0.45, 0, 1.0, 0.9, 1.0, 0, 0, 0.06);
  p.box("white", -0.51, 0.62, -0.51, 0.51, 0.7, 0.51);
});

/** A boulder (three shapes): a lumpy icosahedron of rock. */
function boulder(name: string, seed: number): Prefab<MatKey> {
  return prefab(name, (p) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const pos = g.attributes.position!, v = new THREE.Vector3();
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const bumps = Array.from({ length: 6 }, () => [new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), 0.12 + rnd() * 0.2] as const);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      let k = 1;
      for (const [d, a] of bumps) k += a * Math.max(0, v.dot(d)) ** 2 - a * 0.3;
      v.multiplyScalar(k);
      v.y = v.y * 0.62 + 0.35;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.deleteAttribute("uv");
    g.computeVertexNormals();
    p.add("rock", g.index ? g.toNonIndexed() : g);
  });
}
export const rocks = [boulder("rockA", 11), boulder("rockB", 29), boulder("rockC", 47)];

/** A solar panel on its post: 3.6 × 1.8, tilted back toward the sun (its face toward +z). */
export const solarPanel: Prefab<MatKey> = prefab("solarPanel", (p) => {
  p.cyl("steel", 0, 0, 0, 0.09, 1.25, 8);
  p.box("orange", -0.3, 1.15, -0.12, 0.3, 1.35, 0.12);
  const panel = new THREE.BoxGeometry(3.6, 0.06, 1.8);
  panel.deleteAttribute("uv");
  const m = new THREE.Matrix4().compose(V(0, 1.45, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0, 0)), V(1, 1, 1));
  p.add("solar", panel, m);
  const frame = new THREE.BoxGeometry(3.7, 0.05, 1.9);
  frame.deleteAttribute("uv");
  p.add("white", frame, new THREE.Matrix4().compose(V(0, 1.41, -0.02), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0, 0)), V(1, 1, 1)));
});

/** A tall white storage tank with orange bands and a domed top. */
export const tank: Prefab<MatKey> = prefab("tank", (p) => {
  p.cyl("white", 0, 0, 0, 1.4, 7.0, 20);
  const top = new THREE.SphereGeometry(1.4, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 7.0, 0);
  top.deleteAttribute("uv");
  p.add("white", top);
  for (const y of [1.2, 4.6]) p.cyl("orange", 0, y, 0, 1.43, 0.35, 20);
  p.cyl("dark", 0, 0, 0, 1.5, 0.25, 20);
  p.rod("steel", V(1.42, 0.3, 0), V(1.42, 7.0, 0), 0.04, 5);
  p.box("lamp", 1.38, 6.2, -0.15, 1.5, 6.4, 0.15);
});

/** A radiator: a tall thin white fin array on legs, 3 m wide. */
export const radiator: Prefab<MatKey> = prefab("radiator", (p) => {
  for (const sx of [-1.4, 1.4]) p.box("steel", sx - 0.06, 0, -0.06, sx + 0.06, 1.0, 0.06);
  p.box("white", -1.5, 1.0, -0.08, 1.5, 6.4, 0.08);
  for (let i = 0; i < 9; i++) p.box("white", -1.5 + 0.18 + i * 0.33, 1.0, -0.3, -1.5 + 0.24 + i * 0.33, 6.4, 0.3);
  p.box("orange", -1.55, 6.4, -0.32, 1.55, 6.55, 0.32);
});

/** A comms mast: a lattice tower, a red beacon on top (the beacon's glow is a halo at MAST_TOP). */
export const MAST_TOP = 11.6;
export const mast: Prefab<MatKey> = prefab("mast", (p) => {
  const h = MAST_TOP - 0.4, s = 0.35;
  const legs = [V(-s, 0, -s), V(s, 0, -s), V(s, 0, s), V(-s, 0, s)];
  for (const l of legs) p.rod("white", l, V(l.x * 0.35, h, l.z * 0.35), 0.05, 5);
  for (let y = 0.8; y < h; y += 1.6) {
    const k = 1 - (y / h) * 0.65;
    for (let i = 0; i < 4; i++) {
      const a = legs[i]!, b = legs[(i + 1) % 4]!;
      p.rod("white", V(a.x * k, y, a.z * k), V(b.x * k, y, b.z * k), 0.025, 4);
    }
  }
  p.rod("steel", V(0, h, 0), V(0, MAST_TOP + 0.2, 0), 0.04, 5);
  p.cyl("red", 0, MAST_TOP - 0.05, 0, 0.12, 0.22, 8);
  for (const y of [h * 0.55, h * 0.8]) p.box("white", -0.6, y, -0.05, 0.6, y + 0.4, 0.05);
  p.box("printed", -0.8, 0, -0.8, 0.8, 0.3, 0.8);
});

/** A dish on a pedestal, looking up toward +z. */
export const dish: Prefab<MatKey> = prefab("dish", (p) => {
  p.box("printed", -0.9, 0, -0.9, 0.9, 0.4, 0.9);
  p.cyl("white", 0, 0.4, 0, 0.25, 1.6, 10);
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) { const r = (i / 10) * 1.9; pts.push(new THREE.Vector2(r, r * r * 0.14)); }
  const bowl = new THREE.LatheGeometry(pts, 24);
  bowl.deleteAttribute("uv");
  const m = new THREE.Matrix4().compose(V(0, 2.3, 0.1), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.95, 0, 0)), V(1, 1, 1));
  p.add("white", bowl, m);
  const back = bowl.clone();
  p.add("white", turned(back), m);
  p.rod("steel", V(0, 2.3, 0.1), V(0, 3.2, 1.0), 0.03, 4);
  p.box("dark", -0.12, 3.1, 0.9, 0.12, 3.3, 1.1);
});

// ---------- rovers ----------

/** A six-wheeled rover's body and wheels, nose to +z, 5.2 m long. Wheels separately so a moving rover can turn them. */
export const ROVER = { len: 5.2, wheelR: 0.55, axles: [-1.7, 0, 1.7], track: 1.25 };
export function roverBody(p: Pile<MatKey>) {
  const lift = 0.75;
  soft(p, "white", 0, lift + 0.45, -0.3, 2.3, 0.9, 4.4, 0, 0, 0.15);
  // The cab up front, windows dark, lamps on its nose.
  soft(p, "white", 0, lift + 1.35, 1.0, 2.1, 1.05, 1.9, 0, 0, 0.18);
  p.box("dark", -0.95, lift + 1.2, 1.96, 0.95, lift + 1.7, 1.99);
  for (const sx of [-1, 1]) p.box("dark", sx * 1.05, lift + 1.25, 0.3, sx * 1.07, lift + 1.7, 1.7);
  for (const sx of [-0.75, 0.75]) p.box("lamp", sx - 0.18, lift + 0.6, 1.88, sx + 0.18, lift + 0.78, 1.93);
  // Orange side panels and a rack of cases on the back.
  for (const sx of [-1, 1]) p.box("orange", sx * 1.16 - 0.03, lift + 0.2, -2.2, sx * 1.16 + 0.03, lift + 0.75, 1.2);
  p.box("orange", -1.0, lift + 0.9, -2.3, 1.0, lift + 1.0, -0.3);
  soft(p, "crate", -0.45, lift + 1.3, -1.3, 0.8, 0.6, 1.4, 0, 0, 0.06);
  soft(p, "cushion", 0.5, lift + 1.25, -1.5, 0.8, 0.5, 1.0, 0, 0, 0.06);
  p.rod("steel", V(0.8, lift + 1.9, 0.6), V(0.8, lift + 2.7, 0.6), 0.025, 4);
  // The chassis and the wheels' arms.
  p.box("dark", -0.9, lift - 0.25, -2.2, 0.9, lift, 2.0);
  for (const z of ROVER.axles) for (const sx of [-1, 1]) p.rod("steel", V(sx * 0.8, lift - 0.1, z), V(sx * ROVER.track, ROVER.wheelR, z), 0.06, 5);
}
export function roverWheel(p: Pile<MatKey>, x = 0, y = ROVER.wheelR, z = 0) {
  disc(p, "rubber", V(x, y, z), "x", ROVER.wheelR, 0.42, 16);
  disc(p, "steel", V(x + Math.sign(x || 1) * 0.22, y, z), "x", ROVER.wheelR * 0.5, 0.04, 10);
  // Chunky treads: blocks round the rim, so it shows when it turns.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    p.obox("rubber", x, y + Math.cos(a) * ROVER.wheelR, z + Math.sin(a) * ROVER.wheelR, 0.44, 0.1, 0.16, 0, a);
  }
}
export const rover: Prefab<MatKey> = prefab("rover", (p) => {
  roverBody(p);
  for (const z of ROVER.axles) for (const sx of [-1, 1]) roverWheel(p, sx * ROVER.track, ROVER.wheelR, z);
});

// ---------- inside ----------

/** A desk for one: the user sits at +z facing -z; the monitor's screen is its own mesh (DESK.screen). */
export const DESK = { w: 1.5, d: 0.76, h: 0.74, screen: { y: 1.12, z: -0.2, w: 0.62, h: 0.36 } };
export const desk: Prefab<MatKey> = prefab("desk", (p) => {
  const { w, d, h } = DESK;
  soft(p, "white", 0, h - 0.025, 0, w, 0.05, d, 0, 0, 0.02);
  // A grey pedestal of drawers with an orange front, and a slim leg at the other end.
  p.box("cushion", -w / 2 + 0.04, 0, -d / 2 + 0.05, -w / 2 + 0.46, h - 0.05, d / 2 - 0.06);
  p.box("orange", -w / 2 + 0.07, 0.08, d / 2 - 0.065, -w / 2 + 0.43, h - 0.1, d / 2 - 0.05);
  p.box("dark", -w / 2 + 0.2, 0.42, d / 2 - 0.05, -w / 2 + 0.3, 0.45, d / 2 - 0.03);
  p.box("white", w / 2 - 0.1, 0, -d / 2 + 0.06, w / 2 - 0.04, h - 0.05, d / 2 - 0.06);
  p.box("cushion", -w / 2 + 0.46, 0.3, -d / 2 + 0.04, w / 2 - 0.1, h - 0.06, -d / 2 + 0.07);
  // The monitor: a stand, an arm, a bezel (the screen is drawn apart).
  const s = DESK.screen;
  p.box("dark", -0.12, h, s.z - 0.1, 0.12, h + 0.015, s.z + 0.06);
  p.box("dark", -0.025, h, s.z - 0.04, 0.025, s.y - 0.05, s.z - 0.01);
  p.box("dark", -s.w / 2 - 0.025, s.y - s.h / 2 - 0.025, s.z - 0.035, s.w / 2 + 0.025, s.y + s.h / 2 + 0.025, s.z - 0.005);
  // A second, smaller screen to the side (dark: a status panel), the keyboard, a mug.
  p.obox("dark", 0.55, h + 0.2, -0.2, 0.3, 0.38, 0.03, -0.45);
  p.obox("glowBlue", 0.55, h + 0.22, -0.18, 0.24, 0.28, 0.01, -0.45);
  p.box("dark", -0.22, h, 0.08, 0.22, h + 0.015, 0.22);
  p.cyl("orange", -0.52, h, 0.12, 0.045, 0.1, 10);
  // A status strip under the front edge: dark at rest, cyan when the base is busy (mats.ts).
  p.box("status", -w / 2 + 0.06, h - 0.07, d / 2 - 0.03, w / 2 - 0.06, h - 0.045, d / 2 - 0.01);
});

/** A stool: a grey case with an orange cushion, seat 0.47 up. The sitter faces -z (like the desk's user). */
export const stool: Prefab<MatKey> = prefab("stool", (p) => {
  soft(p, "cushion", 0, 0.2, 0, 0.46, 0.4, 0.42, 0, 0, 0.04);
  soft(p, "seat", 0, 0.43, 0, 0.48, 0.08, 0.44, 0, 0, 0.03);
  p.box("dark", -0.235, 0.12, -0.12, -0.225, 0.3, 0.12);
});

/** A bar stool: a white post and an orange seat 0.76 up. */
export const barStool: Prefab<MatKey> = prefab("barStool", (p) => {
  p.cyl("white", 0, 0, 0, 0.22, 0.04, 16);
  p.cyl("steel", 0, 0.04, 0, 0.04, 0.66, 8);
  ring(p, "steel", V(0, 0.3, 0), "y", 0.17, 0.012, 16);
  p.cyl("seat", 0, 0.68, 0, 0.21, 0.08, 16, 0.2);
});

/** A lounge block: a grey base and an orange cushion, seat 0.42 up, back at -z, 0.9 wide. */
export const loungeSeat: Prefab<MatKey> = prefab("loungeSeat", (p) => {
  soft(p, "cushion", 0, 0.16, 0, 0.9, 0.32, 0.86, 0, 0, 0.05);
  soft(p, "seat", 0, 0.37, 0.05, 0.86, 0.12, 0.74, 0, 0, 0.05);
  soft(p, "cushion", 0, 0.62, -0.36, 0.9, 0.56, 0.16, 0, -0.1, 0.06);
  p.box("amber", -0.43, 0.02, 0.43, 0.43, 0.05, 0.45);
});
/** A lounge corner block (no seat): a planter end to a run of seats. */
export const loungeEnd: Prefab<MatKey> = prefab("loungeEnd", (p) => {
  soft(p, "cushion", 0, 0.28, 0, 0.6, 0.56, 0.86, 0, 0, 0.05);
  p.box("soil", -0.24, 0.56, -0.36, 0.24, 0.58, 0.36);
  for (let i = 0; i < 5; i++) {
    const g = new THREE.IcosahedronGeometry(0.17, 0);
    g.deleteAttribute("uv");
    p.add("leaf", g.translate(((i % 2) - 0.5) * 0.24, 0.66 + (i % 3) * 0.05, -0.3 + i * 0.15));
  }
});

/** A low round table. */
export const lowTable: Prefab<MatKey> = prefab("lowTable", (p) => {
  p.cyl("white", 0, 0, 0, 0.35, 0.36, 16, 0.3);
  p.cyl("white", 0, 0.36, 0, 0.62, 0.05, 24);
  ring(p, "amber", V(0, 0.385, 0), "y", 0.62, 0.012, 24);
});

/** A chess table: a board on a white pedestal. */
export const chessTable: Prefab<MatKey> = prefab("chessTable", (p) => {
  p.cyl("white", 0, 0, 0, 0.18, 0.7, 12, 0.12);
  soft(p, "white", 0, 0.72, 0, 0.82, 0.05, 0.82, 0, 0, 0.02);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    p.box((i + j) % 2 ? "dark" : "white", -0.32 + i * 0.08, 0.745, -0.32 + j * 0.08, -0.24 + i * 0.08, 0.752, -0.24 + j * 0.08);
  }
  // A few pieces in play.
  for (const [i, j, c] of [[1, 1, "white"], [3, 2, "white"], [4, 1, "white"], [6, 0, "white"], [2, 6, "dark"], [4, 5, "dark"], [5, 6, "dark"], [3, 7, "dark"]] as const) {
    p.cyl(c, -0.28 + i * 0.08, 0.752, -0.28 + j * 0.08, 0.025, 0.06 + ((i + j) % 3) * 0.02, 8, 0.015);
  }
});

/** A planter: a white box of greens, 1.6 m long. */
export const planter: Prefab<MatKey> = prefab("planter", (p) => {
  soft(p, "white", 0, 0.35, 0, 1.6, 0.7, 0.6, 0, 0, 0.05);
  p.box("orange", -0.81, 0.08, -0.31, 0.81, 0.16, 0.31);
  p.box("soil", -0.74, 0.69, -0.25, 0.74, 0.71, 0.25);
  for (let i = 0; i < 9; i++) {
    const g = new THREE.IcosahedronGeometry(0.2 + (i % 3) * 0.04, 0);
    g.deleteAttribute("uv");
    p.add("leaf", g.translate(-0.65 + i * 0.16, 0.8 + ((i * 7) % 3) * 0.05, ((i % 2) - 0.5) * 0.22));
  }
});
/** A tall potted plant. */
export const bigPlant: Prefab<MatKey> = prefab("bigPlant", (p) => {
  p.cyl("white", 0, 0, 0, 0.32, 0.6, 14, 0.36);
  p.cyl("soil", 0, 0.58, 0, 0.33, 0.04, 14);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, r = 0.18 + (i % 2) * 0.12;
    const g = new THREE.IcosahedronGeometry(0.26, 0);
    g.deleteAttribute("uv");
    p.add("leaf", g.translate(Math.cos(a) * r, 0.9 + (i % 3) * 0.28, Math.sin(a) * r));
  }
});

/** A bank of lockers, 2 m wide, grey with orange stripes. */
export const lockers: Prefab<MatKey> = prefab("lockers", (p) => {
  p.box("cushion", -1.0, 0, -0.3, 1.0, 2.1, 0.3);
  for (let i = 0; i < 4; i++) {
    const x = -0.75 + i * 0.5;
    p.box("white", x - 0.22, 0.08, 0.3, x + 0.22, 2.0, 0.32);
    p.box("orange", x - 0.22, 1.5, 0.32, x + 0.22, 1.56, 0.33);
    p.box("dark", x + 0.14, 1.0, 0.32, x + 0.18, 1.2, 0.34);
  }
});

/** A spacesuit on its stand: white, an orange pack, a round helmet with a dark visor. */
export const suit: Prefab<MatKey> = prefab("suit", (p) => {
  p.box("dark", -0.35, 0, -0.3, 0.35, 0.06, 0.3);
  p.rod("steel", V(0, 0.06, -0.22), V(0, 1.9, -0.22), 0.025, 5);
  for (const sx of [-1, 1]) soft(p, "white", sx * 0.12, 0.45, 0, 0.18, 0.8, 0.22, 0, 0, 0.06);
  soft(p, "white", 0, 1.18, 0, 0.52, 0.7, 0.32, 0, 0, 0.1);
  soft(p, "orange", 0, 1.2, -0.22, 0.42, 0.55, 0.16, 0, 0, 0.05);
  for (const sx of [-1, 1]) soft(p, "white", sx * 0.33, 1.1, 0.02, 0.15, 0.6, 0.17, 0, 0, 0.06);
  const helmet = new THREE.SphereGeometry(0.21, 16, 12).translate(0, 1.72, 0);
  helmet.deleteAttribute("uv");
  p.add("white", helmet);
  const visor = new THREE.SphereGeometry(0.19, 16, 10, -Math.PI / 2.4, Math.PI / 1.2, Math.PI / 3.2, Math.PI / 3).translate(0, 1.73, 0.03);
  visor.deleteAttribute("uv");
  p.add("dark", visor);
});

/**
 * A sleep sling: a fabric sling between two orange A-frames, lying along z, sagging to 0.55 up in
 * the middle like the yacht's hammock (the same pose fits it). The body lies along +z.
 */
export const SLING = { seat: 0.6 };
export const sling: Prefab<MatKey> = prefab("sling", (p) => {
  const L = 1.7, n = 10, W = 0.78;
  const pos: number[] = [], index: number[] = [];
  for (let i = 0; i <= n; i++) {
    const z = -L * 0.78 + (2 * L * 0.78 * i) / n, u = z / (L * 0.78);
    for (let j = 0; j <= 4; j++) {
      const x = -W / 2 + (W * j) / 4, v = (x / (W / 2)) ** 2;
      pos.push(x * (1 - 0.15 * (1 - u * u)), 0.55 + 0.42 * u * u + 0.12 * v * (1 - u * u), z);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) {
    const a = i * 5 + j, b = a + 1, c = a + 5, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  const cloth = new THREE.BufferGeometry();
  cloth.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  cloth.setIndex(index);
  cloth.computeVertexNormals();
  p.add("cushion", cloth);
  p.add("cushion", turned(cloth.clone()));
  for (const sz of [-1, 1]) {
    p.box("white", -W / 2 - 0.04, 0.95, sz * L * 0.78 - 0.025, W / 2 + 0.04, 1.0, sz * L * 0.78 + 0.025);
    for (const sx of [-1, 1]) {
      p.rod("orange", V(sx * 0.45, 0, sz * (L + 0.2)), V(0, 1.5, sz * L), 0.04, 6);
      p.rod("steel", V(sx * W / 2, 0.97, sz * L * 0.78), V(0, 1.45, sz * L), 0.008, 3);
    }
  }
  p.rod("orange", V(0, 1.45, -L), V(0, 1.45, L), 0.03, 6);
  soft(p, "seat", 0, 0.72, -L * 0.62, 0.42, 0.12, 0.26, 0, 0.3, 0.05); // a pillow
});

/** A grow shelf: three tiers of trays of greens, 2 m long along x, pink grow lights under each tier; the front is +z. */
export const growShelf: Prefab<MatKey> = prefab("growShelf", (p) => {
  for (const x of [-0.98, 0.98]) for (const z of [-0.3, 0.3]) p.box("white", x - 0.03, 0, z - 0.03, x + 0.03, 2.3, z + 0.03);
  for (let t = 0; t < 3; t++) {
    const y = 0.45 + t * 0.68;
    p.box("white", -1.0, y, -0.32, 1.0, y + 0.06, 0.32);
    p.box("orange", -1.0, y + 0.06, 0.3, 1.0, y + 0.14, 0.33);
    p.box("grow", -0.92, y + 0.6, -0.12, 0.92, y + 0.62, 0.12);
    for (let i = 0; i < 9; i++) {
      const g = new THREE.IcosahedronGeometry(0.11 + ((i + t) % 3) * 0.02, 0);
      g.deleteAttribute("uv");
      p.add("leaf", g.scale(1, 0.7, 1).translate(-0.85 + i * 0.21, y + 0.18, ((i % 2) - 0.5) * 0.24));
    }
  }
  p.cyl("tank", 0.85, 0, -0.1, 0.12, 0.42, 10);
});

/** A lookout chair: a white shell with orange cushions, seat 0.42 up, facing +z. */
export const lookChair: Prefab<MatKey> = prefab("lookChair", (p) => {
  soft(p, "white", 0, 0.2, 0, 0.82, 0.4, 0.8, 0, 0, 0.12);
  soft(p, "seat", 0, 0.38, 0.04, 0.66, 0.12, 0.66, 0, 0, 0.05);
  soft(p, "white", 0, 0.68, -0.38, 0.82, 0.7, 0.14, 0, -0.18, 0.06);
  soft(p, "seat", 0, 0.7, -0.29, 0.64, 0.5, 0.08, 0, -0.18, 0.03);
  for (const sx of [-1, 1]) soft(p, "white", sx * 0.4, 0.5, 0, 0.1, 0.24, 0.76, 0, 0, 0.04);
});

/** A bench of the sports dome's stands, 3 m along x, seat 0.45, facing +z. */
export const bench: Prefab<MatKey> = prefab("bench", (p) => {
  soft(p, "white", 0, 0.2, 0, 3.0, 0.4, 0.55, 0, 0, 0.05);
  soft(p, "seat", 0, 0.42, 0.02, 2.96, 0.06, 0.5, 0, 0, 0.02);
});

/** A basketball hoop on a post: the ring 3.05 m up, 1.2 m out (+z) from the post. */
export const HOOP = { y: 3.05, out: 1.2 };
export const hoop: Prefab<MatKey> = prefab("hoop", (p) => {
  p.box("printed", -0.4, 0, -0.4, 0.4, 0.4, 0.4);
  p.box("white", -0.12, 0.4, -0.12, 0.12, 3.4, 0.12);
  p.box("white", -0.1, 3.0, 0.0, 0.1, 3.15, 0.95);
  soft(p, "white", 0, 3.55, 0.95, 1.8, 1.05, 0.05, 0, 0, 0.02);
  for (const [x0, y0, x1, y1] of [[-0.9, 3.03, 0.9, 3.07], [-0.9, 4.03, 0.9, 4.07], [-0.9, 3.03, -0.86, 4.07], [0.86, 3.03, 0.9, 4.07]] as const) p.box("courtLine", x0, y0, 0.97, x1, y1, 0.99);
  p.box("orange", -0.3, 3.2, 0.97, 0.3, 3.5, 0.99);
  ring(p, "orange", V(0, HOOP.y, HOOP.out), "y", 0.23, 0.018, 20);
  const net = new THREE.CylinderGeometry(0.23, 0.15, 0.4, 12, 1, true).translate(0, HOOP.y - 0.2, HOOP.out);
  net.deleteAttribute("uv");
  p.add("white", net);
  p.add("white", turned(net.clone()));
});

/** A coffee machine for the cafe counter, facing +z. */
export const coffeeMachine: Prefab<MatKey> = prefab("coffeeMachine", (p) => {
  p.box("steel", -0.3, 0, -0.22, 0.3, 0.42, 0.18);
  p.box("orange", -0.31, 0.42, -0.23, 0.31, 0.47, 0.19);
  for (const x of [-0.13, 0.13]) {
    p.cyl("dark", x, 0.24, 0.2, 0.045, 0.08, 10);
    p.cyl("white", x, 0.04, 0.21, 0.035, 0.08, 10, 0.042);
  }
  p.box("glowBlue", -0.08, 0.34, 0.181, 0.08, 0.39, 0.185);
});
