// Furniture, each built once in its own frame and instanced wherever it stands. Clean, chunky
// shapes, after the concept art: white cushions on teak, chrome, white planters with palms.
// Each notes which way it faces and where a body goes on it.

import * as THREE from "three";
import type { MatKey } from "./mats.ts";
import { prefab, type Pile, type Prefab } from "./kit.ts";

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A box with softly rounded edges (cushions, mattresses). */
function soft(p: Pile<MatKey>, mat: MatKey, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rx = 0, ry = 0) {
  const r = Math.min(sx, sy, sz) * 0.32;
  const g = roundedBox(sx, sy, sz, r);
  const m = new THREE.Matrix4().compose(V(cx, cy, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0, "YXZ")), V(1, 1, 1));
  p.add(mat, g, m);
}

const rounded = new Map<string, THREE.BufferGeometry>();
function roundedBox(sx: number, sy: number, sz: number, r: number): THREE.BufferGeometry {
  const key = [sx, sy, sz, r].map((v) => v.toFixed(3)).join("|");
  let g = rounded.get(key);
  if (g) return g;
  // A box whose vertices are pushed onto a smaller box's rounded shell.
  g = new THREE.BoxGeometry(sx, sy, sz, 4, 2, 4);
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

/** A desk for one: the user sits at +z facing -z; the monitor's stand is here, its screen is drawn apart. */
export const DESK = { w: 1.5, d: 0.76, h: 0.74, screen: { y: 1.12, z: -0.2, w: 0.62, h: 0.36 } };
export const desk: Prefab<MatKey> = prefab("desk", (p) => {
  const { w, d, h } = DESK;
  p.box("deskTop", -w / 2, h - 0.04, -d / 2, w / 2, h, d / 2);
  for (const sx of [-1, 1]) p.box("white", sx * (w / 2 - 0.03) - 0.025, 0, -d / 2 + 0.04, sx * (w / 2 - 0.03) + 0.025, h - 0.04, d / 2 - 0.04);
  p.box("white", -w / 2 + 0.05, 0.3, -d / 2 + 0.02, w / 2 - 0.05, h - 0.06, -d / 2 + 0.05); // modesty panel
  // Monitor: stand, arm and the bezel round the screen (the screen itself is its own mesh).
  const s = DESK.screen;
  p.box("dark", -0.12, h, s.z - 0.1, 0.12, h + 0.015, s.z + 0.06);
  p.box("dark", -0.025, h, s.z - 0.04, 0.025, s.y - 0.05, s.z - 0.01);
  p.box("dark", -s.w / 2 - 0.02, s.y - s.h / 2 - 0.02, s.z - 0.035, s.w / 2 + 0.02, s.y + s.h / 2 + 0.02, s.z - 0.005);
  p.box("dark", -0.22, h, 0.08, 0.22, h + 0.015, 0.22); // keyboard
  p.box("white", 0.3, h, 0.1, 0.36, h + 0.02, 0.2); // mouse
});

/** An office chair: seat 0.47 up, the user faces -z (backrest at +z). */
export const officeChair: Prefab<MatKey> = prefab("officeChair", (p) => {
  soft(p, "seat", 0, 0.47, 0, 0.5, 0.09, 0.48);
  soft(p, "seat", 0, 0.82, 0.24, 0.46, 0.56, 0.08, -0.12);
  p.cyl("chrome", 0, 0.08, 0, 0.03, 0.36, 8);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    p.rod("dark", V(0, 0.08, 0), V(Math.sin(a) * 0.3, 0.05, Math.cos(a) * 0.3), 0.022, 5);
  }
  for (const sx of [-1, 1]) p.box("dark", sx * 0.27 - 0.02, 0.55, -0.1, sx * 0.27 + 0.02, 0.66, 0.18);
});

/** A sun lounger, head (raised back) at -z, feet at +z: the body lies facing +z, hips at z = -0.1, 0.4 up. */
export const LOUNGER = { hips: -0.1, seat: 0.4 };
export const lounger: Prefab<MatKey> = prefab("lounger", (p) => {
  p.box("wood", -0.36, 0.14, -0.95, 0.36, 0.26, 1.0);
  for (const [x, z] of [[-0.3, -0.85], [0.3, -0.85], [-0.3, 0.9], [0.3, 0.9]] as const) p.box("wood", x - 0.04, 0, z - 0.04, x + 0.04, 0.14, z + 0.04);
  soft(p, "cushion", 0, 0.32, 0.25, 0.7, 0.12, 1.45);
  // The back, raised about 40 degrees.
  soft(p, "cushion", 0, 0.52, -0.68, 0.7, 0.12, 0.68, -0.7);
  p.box("wood", -0.36, 0.26, -1.0, 0.36, 0.3, -0.55);
  soft(p, "accent", 0, 0.4, 0.82, 0.5, 0.1, 0.22); // a rolled towel at the foot
});

/** A white market umbrella: pole at the origin, canopy 2.5 m up. */
export const umbrella: Prefab<MatKey> = prefab("umbrella", (p) => {
  p.cyl("wood", 0, 0, 0, 0.03, 2.55, 8);
  p.cyl("white", 0, 0, 0, 0.28, 0.06, 16, 0.22);
  const cone = new THREE.ConeGeometry(1.75, 0.5, 8, 1, true).translate(0, 2.55, 0);
  cone.deleteAttribute("uv");
  p.add("cushion", cone);
  const under = new THREE.ConeGeometry(1.74, 0.49, 8, 1, true).translate(0, 2.54, 0);
  p.add("cushion", flipCopy(under));
  p.cyl("cushion", 0, 2.78, 0, 0.12, 0.12, 8, 0.05);
  // The valance round the rim.
  const rim = new THREE.CylinderGeometry(1.75, 1.75, 0.16, 8, 1, true).translate(0, 2.22, 0);
  rim.deleteAttribute("uv");
  p.add("cushion", rim);
});

function flipCopy(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const c = g.clone();
  c.deleteAttribute("uv");
  const idx = c.index!;
  for (let i = 0; i < idx.count; i += 3) { const b = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, b); }
  const n = c.attributes.normal!;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return c;
}

/** A low deck chair: seat 0.38 up, faces +z, back reclined behind. */
export const deckChair: Prefab<MatKey> = prefab("deckChair", (p) => {
  p.box("wood", -0.36, 0.18, -0.35, 0.36, 0.26, 0.4);
  for (const [x, z] of [[-0.32, -0.3], [0.32, -0.3], [-0.32, 0.35], [0.32, 0.35]] as const) p.box("wood", x - 0.035, 0, z - 0.035, x + 0.035, 0.18, z + 0.035);
  soft(p, "cushion", 0, 0.32, 0.03, 0.64, 0.12, 0.66);
  soft(p, "cushion", 0, 0.62, -0.4, 0.64, 0.5, 0.12, -0.35);
  for (const sx of [-1, 1]) p.box("wood", sx * 0.38 - 0.03, 0.26, -0.3, sx * 0.38 + 0.03, 0.52, 0.35);
});

/** A bar stool: chrome post, white round seat 0.76 up. */
export const barStool: Prefab<MatKey> = prefab("barStool", (p) => {
  p.cyl("chrome", 0, 0, 0, 0.2, 0.03, 16);
  p.cyl("chrome", 0, 0.03, 0, 0.035, 0.68, 8);
  const ring = new THREE.TorusGeometry(0.17, 0.012, 5, 16).rotateX(Math.PI / 2).translate(0, 0.32, 0);
  ring.deleteAttribute("uv");
  p.add("chrome", ring);
  p.cyl("cushion", 0, 0.7, 0, 0.2, 0.08, 16, 0.19);
});

/**
 * A hammock on its own stainless stand: lies along z, 3.4 m between the stand's ends, sagging to
 * 0.55 up in the middle. The body lies along +z.
 */
export const HAMMOCK = { seat: 0.6 };
export const hammock: Prefab<MatKey> = prefab("hammock", (p) => {
  const L = 1.7, n = 10, W = 0.75;
  // The cloth: a sagging, curled sheet between two spreader bars.
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
  p.add("sail", cloth);
  for (const sz of [-1, 1]) {
    p.box("wood", -W / 2 - 0.04, 0.95, sz * L * 0.78 - 0.025, W / 2 + 0.04, 1.0, sz * L * 0.78 + 0.025);
    // Cords up to the stand.
    for (const sx of [-1, 1]) p.rod("cushion", V(sx * W / 2, 0.97, sz * L * 0.78), V(0, 1.45, sz * L), 0.008, 3);
    p.rod("chrome", V(0, 0, sz * (L + 0.25)), V(0, 1.5, sz * L), 0.035, 8);
  }
  p.rod("chrome", V(0, 0.03, -L - 0.25), V(0, 0.03, L + 0.25), 0.035, 8);
  for (const sz of [-1, 1]) p.box("chrome", -0.35, 0, sz * (L + 0.25) - 0.03, 0.35, 0.05, sz * (L + 0.25) + 0.03);
});

/** A lounge sofa, 2.2 m wide (x): seat 0.42 up, faces +z, back at -z. */
export const sofa: Prefab<MatKey> = prefab("sofa", (p) => {
  p.box("wood", -1.12, 0.06, -0.45, 1.12, 0.26, 0.45);
  soft(p, "cushion", 0, 0.34, 0.08, 2.0, 0.16, 0.72);
  soft(p, "cushion", 0, 0.62, -0.36, 2.2, 0.5, 0.2);
  for (const sx of [-1, 1]) soft(p, "cushion", sx * 1.04, 0.45, 0.0, 0.16, 0.38, 0.88);
  soft(p, "accent", -0.6, 0.58, -0.18, 0.4, 0.36, 0.12, -0.3);
  soft(p, "cushion", 0.55, 0.58, -0.18, 0.4, 0.36, 0.12, -0.3);
});

/** An armchair: seat 0.42 up, faces +z. */
export const armchair: Prefab<MatKey> = prefab("armchair", (p) => {
  p.box("wood", -0.45, 0.06, -0.42, 0.45, 0.26, 0.42);
  soft(p, "cushion", 0, 0.34, 0.06, 0.74, 0.16, 0.7);
  soft(p, "cushion", 0, 0.62, -0.34, 0.9, 0.5, 0.2);
  for (const sx of [-1, 1]) soft(p, "cushion", sx * 0.4, 0.45, 0.0, 0.14, 0.36, 0.84);
});

export const coffeeTable: Prefab<MatKey> = prefab("coffeeTable", (p) => {
  p.box("wood", -0.6, 0.34, -0.32, 0.6, 0.4, 0.32);
  p.box("wood", -0.55, 0, -0.27, 0.55, 0.06, 0.27);
  p.box("wood", -0.5, 0.06, -0.22, 0.5, 0.34, 0.22);
});

export const sideTable: Prefab<MatKey> = prefab("sideTable", (p) => {
  p.cyl("wood", 0, 0.42, 0, 0.24, 0.04, 16);
  p.cyl("chrome", 0, 0, 0, 0.025, 0.42, 6);
  p.cyl("chrome", 0, 0, 0, 0.16, 0.02, 12);
});

/** A round café table with its chair pair (chairs at ±x facing in). */
export const cafeTable: Prefab<MatKey> = prefab("cafeTable", (p) => {
  p.cyl("deskTop", 0, 0.72, 0, 0.45, 0.04, 20);
  p.cyl("chrome", 0, 0, 0, 0.03, 0.72, 8);
  p.cyl("chrome", 0, 0, 0, 0.22, 0.02, 12);
});

/** A dining chair: seat 0.46 up, faces +z. */
export const chair: Prefab<MatKey> = prefab("chair", (p) => {
  soft(p, "cushion", 0, 0.46, 0, 0.46, 0.08, 0.44);
  soft(p, "cushion", 0, 0.78, -0.22, 0.44, 0.48, 0.07, 0.08);
  for (const [x, z] of [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]] as const) p.box("wood", x - 0.02, 0, z - 0.02, x + 0.02, 0.42, z + 0.02);
});

/** A white planter with a palm: fronds arching out from a short trunk. */
export const palm: Prefab<MatKey> = prefab("palm", (p) => {
  p.box("pot", -0.3, 0, -0.3, 0.3, 0.62, 0.3);
  // The soil sits a touch proud of the pot's top: sharing that face would z-fight.
  p.box("soil", -0.26, 0.6, -0.26, 0.26, 0.635, 0.26);
  p.cyl("wood", 0, 0.58, 0, 0.06, 0.55, 6, 0.045);
  const frond = (len: number, droop: number) => {
    // A leaf: a strip arching up and out along +z, wider in the middle, folded along its spine.
    const pos: number[] = [], index: number[] = [];
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const u = i / n, w = 0.16 * Math.sin(Math.PI * Math.min(1, u * 1.15)) + 0.01;
      const z = u * len, y = Math.sin(u * Math.PI * 0.75) * 0.4 - droop * u * u;
      pos.push(-w, y - w * 0.4, z, 0, y, z, w, y - w * 0.4, z);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 3;
      index.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  };
  const leaves = 9;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + (i % 2) * 0.3, tilt = i % 3 === 0 ? -0.9 : -0.35;
    const m = new THREE.Matrix4().compose(V(0, 1.1, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, a, 0, "YXZ")), V(1, 1, 1));
    p.add("leaf", frond(0.85 + (i % 3) * 0.15, 0.5 + (i % 2) * 0.2), m);
  }
});

/** A small potted plant for desks and ledges: a round white pot and a spray of leaves. */
export const shrub: Prefab<MatKey> = prefab("shrub", (p) => {
  p.cyl("pot", 0, 0, 0, 0.22, 0.42, 16, 0.26);
  // The soil sits a touch proud of the pot's top: sharing that face would z-fight.
  p.cyl("soil", 0, 0.4, 0, 0.235, 0.035, 16);
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (i % 3) * 0.4, len = 0.4 + (i % 4) * 0.08;
    // A leaf: a pointed oval, arching out from the middle of the pot.
    const pos: number[] = [], index: number[] = [];
    const m = 5;
    for (let j = 0; j <= m; j++) {
      const u = j / m, w = 0.075 * Math.sin(Math.PI * u) + 0.004;
      const z = u * len, y = Math.sin(u * Math.PI * 0.6) * 0.32 - 0.12 * u * u;
      pos.push(-w, y, z, w, y, z);
    }
    for (let j = 0; j < m; j++) { const k = j * 2; index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    const tilt = -0.25 - (i % 3) * 0.25;
    p.add("leaf", g, new THREE.Matrix4().compose(V(0, 0.42, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, a, 0, "YXZ")), V(1, 1, 1)));
  }
});

/** The captain's chair at the helm: faces +z (here, the windows), seat 0.62 up. */
export const helmChair: Prefab<MatKey> = prefab("helmChair", (p) => {
  p.cyl("chrome", 0, 0, 0, 0.28, 0.05, 16);
  p.cyl("chrome", 0, 0.05, 0, 0.06, 0.5, 10);
  soft(p, "seat", 0, 0.62, 0, 0.62, 0.14, 0.6);
  soft(p, "seat", 0, 1.08, -0.28, 0.6, 0.8, 0.14, 0.1);
  for (const sx of [-1, 1]) soft(p, "seat", sx * 0.33, 0.8, -0.02, 0.1, 0.1, 0.5);
});
