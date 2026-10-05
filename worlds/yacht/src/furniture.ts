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
  // A status strip under the front edge: dark at rest, cyan when the ship is busy (mats.ts).
  p.box("status", -w / 2 + 0.06, h - 0.07, d / 2 - 0.03, w / 2 - 0.06, h - 0.045, d / 2 - 0.01);
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
  // The canopy is its own material ("brolly"): it sways a little in the breeze (mats.ts).
  const cone = new THREE.ConeGeometry(1.75, 0.5, 8, 1, true).translate(0, 2.55, 0);
  cone.deleteAttribute("uv");
  p.add("brolly", cone);
  const under = new THREE.ConeGeometry(1.74, 0.49, 8, 1, true).translate(0, 2.54, 0);
  p.add("brolly", flipCopy(under));
  p.cyl("brolly", 0, 2.78, 0, 0.12, 0.12, 8, 0.05);
  // The valance round the rim.
  const rim = new THREE.CylinderGeometry(1.75, 1.75, 0.16, 8, 1, true).translate(0, 2.22, 0);
  rim.deleteAttribute("uv");
  p.add("brolly", rim);
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

// ---------- below decks ----------

/** A flat disc (a weight plate, a wheel, a gauge face): radius r, thickness t, centred on c, its axis along `axis`. */
function disc(p: Pile<MatKey>, mat: MatKey, c: THREE.Vector3, axis: "x" | "y" | "z", r: number, t: number, seg = 14) {
  const g = new THREE.CylinderGeometry(r, r, t, seg);
  g.deleteAttribute("uv");
  if (axis === "x") g.rotateZ(Math.PI / 2);
  if (axis === "z") g.rotateX(Math.PI / 2);
  p.add(mat, g.translate(c.x, c.y, c.z));
}

/** A treadmill: the runner faces +z, the console at that end. */
export const TREADMILL = { belt: 0.2 };
export const treadmill: Prefab<MatKey> = prefab("treadmill", (p) => {
  p.box("dark", -0.42, 0, -0.95, 0.42, 0.14, 0.78);
  p.box("pad", -0.3, 0.14, -0.9, 0.3, 0.2, 0.72);
  for (const sx of [-1, 1]) {
    p.box("steel", sx * 0.36 - 0.04, 0.14, -0.9, sx * 0.36 + 0.04, 0.21, 0.72);
    p.rod("steel", V(sx * 0.36, 0.14, 0.72), V(sx * 0.33, 1.22, 0.84), 0.032, 8);
    p.rod("steel", V(sx * 0.35, 1.02, 0.3), V(sx * 0.34, 1.12, 0.8), 0.022, 6);
  }
  p.obox("dark", 0, 1.28, 0.86, 0.72, 0.34, 0.08, 0, -0.55);
  p.obox("glowBlue", 0, 1.3, 0.82, 0.46, 0.2, 0.012, 0, -0.55);
});

/** A weight bench along z (the lifter lies with their head at -z) under a barbell on its rack. */
export const weightBench: Prefab<MatKey> = prefab("weightBench", (p) => {
  soft(p, "seat", 0, 0.44, 0.05, 0.32, 0.1, 1.25);
  for (const z of [-0.45, 0.5]) p.box("dark", -0.18, 0, z - 0.04, 0.18, 0.39, z + 0.04);
  p.box("dark", -0.05, 0.02, -0.5, 0.05, 0.08, 0.55);
  for (const sx of [-1, 1]) {
    p.rod("steel", V(sx * 0.52, 0, -0.62), V(sx * 0.52, 1.22, -0.62), 0.035, 8);
    p.box("dark", sx * 0.52 - 0.18, 0, -0.66, sx * 0.52 + 0.18, 0.04, -0.58);
    p.box("steel", sx * 0.52 - 0.02, 1.0, -0.62, sx * 0.52 + 0.02, 1.04, -0.5);
  }
  p.rod("chrome", V(-1.0, 1.08, -0.56), V(1.0, 1.08, -0.56), 0.016, 8);
  for (const sx of [-1, 1]) for (const [x, r] of [[0.74, 0.22], [0.8, 0.17]] as const) disc(p, "dark", V(sx * x, 1.08, -0.56), "x", r, 0.05, 16);
});

/** A two-tier rack of dumbbells, 1.6 m along x, facing +z. */
export const dumbbellRack: Prefab<MatKey> = prefab("dumbbellRack", (p) => {
  for (const sx of [-1, 1]) {
    p.box("dark", sx * 0.78 - 0.03, 0, -0.25, sx * 0.78 + 0.03, 0.85, -0.19);
    p.box("dark", sx * 0.78 - 0.03, 0, 0.19, sx * 0.78 + 0.03, 0.55, 0.25);
  }
  p.obox("steel", 0, 0.5, 0.05, 1.6, 0.03, 0.42, 0, 0.35);
  p.obox("steel", 0, 0.8, -0.12, 1.6, 0.03, 0.3, 0, 0.35);
  for (let i = 0; i < 6; i++) {
    const x = -0.62 + i * 0.25, s = 0.06 + i * 0.008;
    for (const [y, z] of [[0.57, 0.07], [0.86, -0.1]] as const) {
      for (const dx of [-0.07, 0.07]) disc(p, "dark", V(x + dx, y, z), "x", s, 0.05, 10);
      p.rod("chrome", V(x - 0.05, y, z), V(x + 0.05, y, z), 0.012, 5);
    }
  }
});

/** A bean bag: a slumped round cushion, sat in facing +z. */
export const BEANBAG = { seat: 0.34 };
function beanBag(name: string, mat: MatKey): Prefab<MatKey> {
  return prefab(name, (p) => {
    const body = new THREE.SphereGeometry(0.5, 16, 10).scale(1, 0.55, 1).translate(0, 0.26, 0.02);
    body.deleteAttribute("uv");
    p.add(mat, body);
    const back = new THREE.SphereGeometry(0.42, 14, 8).scale(1.05, 0.95, 0.55).translate(0, 0.48, -0.26);
    back.deleteAttribute("uv");
    p.add(mat, back);
  });
}
export const beanBagBlue = beanBag("beanBagBlue", "accent");
export const beanBagWhite = beanBag("beanBagWhite", "cushion");
export const beanBagGrey = beanBag("beanBagGrey", "seat");

/** A server rack, 0.6 m wide, its front (where the lights blink) facing +z. */
export const RACK = { w: 0.6, d: 1.0, h: 2.2 };
export const rack: Prefab<MatKey> = prefab("rack", (p) => {
  const { w, d, h } = RACK;
  p.box("dark", -w / 2, 0, -d / 2, w / 2, h, d / 2);
  p.box("frame", -w / 2 - 0.005, 0.06, d / 2 - 0.02, -w / 2 + 0.04, h - 0.04, d / 2 + 0.012);
  p.box("frame", w / 2 - 0.04, 0.06, d / 2 - 0.02, w / 2 + 0.005, h - 0.04, d / 2 + 0.012);
  p.box("frame", -w / 2, h - 0.12, d / 2 - 0.02, w / 2, h - 0.04, d / 2 + 0.012);
  // Server faces: slots of grille between the uprights.
  for (let k = 0; k < 9; k++) {
    const y = 0.18 + k * 0.215;
    p.box("frame", -w / 2 + 0.05, y, d / 2 - 0.01, w / 2 - 0.05, y + 0.16, d / 2 + 0.004);
    p.box("dark", w / 2 - 0.2, y + 0.03, d / 2 + 0.004, w / 2 - 0.07, y + 0.13, d / 2 + 0.008);
  }
});

/** An espresso machine on a counter, facing +z. */
export const coffeeMachine: Prefab<MatKey> = prefab("coffeeMachine", (p) => {
  p.box("steel", -0.3, 0, -0.22, 0.3, 0.42, 0.18);
  p.box("dark", -0.31, 0.42, -0.23, 0.31, 0.47, 0.19);
  for (const x of [-0.13, 0.13]) {
    p.cyl("chrome", x, 0.24, 0.2, 0.045, 0.08, 10);
    p.box("dark", x - 0.012, 0.22, 0.24, x + 0.012, 0.25, 0.34);
    p.cyl("white", x, 0.04, 0.21, 0.035, 0.08, 10, 0.042);
  }
  p.box("dark", -0.26, 0, 0.14, 0.26, 0.03, 0.3);
  p.box("glowBlue", -0.08, 0.34, 0.181, 0.08, 0.39, 0.185);
  p.rod("chrome", V(0.27, 0.3, 0.18), V(0.33, 0.16, 0.26), 0.008, 5);
  for (let i = 0; i < 4; i++) p.cyl("white", -0.24 + i * 0.16, 0.47, -0.05, 0.04, 0.07, 10, 0.045);
});

/**
 * A small planing hull, nose to +z, keel on y = 0: length L, beam B, depth H. Its topsides and
 * its bottom (below the chine) separately, and a deck across the top.
 */
function boatHull(L: number, B: number, H: number) {
  const N = 18;
  const st: { z: number; k: number; cy: number; cw: number; sy: number; w: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N; // 0 at the bow
    const w = (B / 2) * (u < 0.42 ? Math.pow(Math.sin(((u / 0.42) * Math.PI) / 2), 0.65) : 1) * (1 - 0.06 * u);
    const rise = H * 0.75 * Math.pow(Math.max(0, 0.36 - u) / 0.36, 1.8);
    st.push({ z: L / 2 - u * L, k: rise, cy: H * 0.33 + rise * 0.55, cw: w * 0.9, sy: H + 0.12 * Math.pow(1 - u, 2), w: Math.max(w, 0.001) });
  }
  const sides: number[] = [], bottom: number[] = [], deck: number[] = [];
  const quad = (out: number[], a: number[], b: number[], c: number[], d: number[], want: THREE.Vector3) => {
    const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), C = new THREE.Vector3(...c);
    const n = new THREE.Vector3().subVectors(Bv, A).cross(new THREE.Vector3().subVectors(C, A));
    if (n.dot(want) >= 0) out.push(...a, ...b, ...c, ...a, ...c, ...d);
    else out.push(...a, ...c, ...b, ...a, ...d, ...c);
  };
  for (let i = 0; i < N; i++) {
    const p = st[i]!, q = st[i + 1]!;
    for (const sx of [-1, 1]) {
      quad(sides, [sx * p.cw, p.cy, p.z], [sx * q.cw, q.cy, q.z], [sx * q.w, q.sy, q.z], [sx * p.w, p.sy, p.z], new THREE.Vector3(sx, 0.2, 0));
      quad(bottom, [0, p.k, p.z], [0, q.k, q.z], [sx * q.cw, q.cy, q.z], [sx * p.cw, p.cy, p.z], new THREE.Vector3(sx * 0.3, -1, 0));
    }
    quad(deck, [-p.w, p.sy, p.z], [p.w, p.sy, p.z], [q.w, q.sy, q.z], [-q.w, q.sy, q.z], new THREE.Vector3(0, 1, 0));
  }
  // The transom.
  const t = st[N]!;
  quad(sides, [-t.w, t.sy, t.z], [t.w, t.sy, t.z], [t.cw, t.cy, t.z], [-t.cw, t.cy, t.z], new THREE.Vector3(0, 0, -1));
  quad(bottom, [-t.cw, t.cy, t.z], [t.cw, t.cy, t.z], [0, t.k, t.z], [0, t.k, t.z], new THREE.Vector3(0, 0, -1));
  const geo = (arr: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    return g;
  };
  return { sides: geo(sides), bottom: geo(bottom), deck: geo(deck), sheer: st.map((s) => ({ z: s.z, y: s.sy, w: s.w })) };
}

/** A jet ski on its dolly: nose to +z, 3.2 m long. */
export const jetSki: Prefab<MatKey> = prefab("jetSki", (p) => {
  const lift = 0.32;
  const h = boatHull(3.1, 1.12, 0.48);
  const m = new THREE.Matrix4().makeTranslation(0, lift, 0);
  p.add("white", h.sides, m);
  p.add("navy", h.bottom, m);
  p.add("white", h.deck, m);
  // The seat, the steering column and bars, a red flash down each side.
  soft(p, "navy", 0, lift + 0.62, -0.35, 0.42, 0.2, 1.3);
  p.obox("white", 0, lift + 0.66, 0.5, 0.5, 0.32, 0.5, 0, -0.5);
  p.rod("dark", V(-0.36, lift + 0.86, 0.55), V(0.36, lift + 0.86, 0.55), 0.02, 6);
  for (const sx of [-1, 1]) p.obox("red", sx * 0.55, lift + 0.36, 0.2, 0.02, 0.07, 1.6, 0, 0, 0);
  // The dolly.
  for (const sx of [-1, 1]) {
    p.box("dark", sx * 0.32 - 0.04, 0.16, -1.2, sx * 0.32 + 0.04, 0.24, 1.1);
    for (const z of [-0.9, 0.8]) disc(p, "dark", V(sx * 0.42, 0.11, z), "x", 0.11, 0.07, 12);
  }
  p.box("dark", -0.36, 0.16, -0.05, 0.36, 0.22, 0.05);
});

/** The tender: a 7.6 m chase boat on a cradle, nose to +z. */
export const tender: Prefab<MatKey> = prefab("tender", (p) => {
  const lift = 0.45;
  const h = boatHull(7.6, 2.7, 1.05);
  const m = new THREE.Matrix4().makeTranslation(0, lift, 0);
  p.add("white", h.sides, m);
  p.add("navy", h.bottom, m);
  p.add("teak", h.deck, m);
  // A white gunwale cap and a chrome rail round the sheer.
  const sh = h.sheer;
  for (let i = 0; i + 1 < sh.length; i++) {
    const a = sh[i]!, b = sh[i + 1]!;
    for (const sx of [-1, 1]) {
      p.rod("white", V(sx * a.w * 0.97, lift + a.y + 0.02, a.z), V(sx * b.w * 0.97, lift + b.y + 0.02, b.z), 0.06, 6);
      if (i < 9) p.rod("chrome", V(sx * a.w * 0.93, lift + a.y + 0.32, a.z), V(sx * b.w * 0.93, lift + b.y + 0.32, b.z), 0.02, 6);
    }
  }
  const top = lift + 1.07;
  // The console with its windscreen, seats aft, a sunpad on the bow.
  p.box("white", -0.55, top, -0.6, 0.55, top + 0.9, 0.3);
  p.obox("darkGlass", 0, top + 1.08, 0.36, 1.0, 0.42, 0.04, 0, -0.5);
  p.box("dark", -0.3, top + 0.9, -0.55, 0.3, top + 0.93, 0.1);
  soft(p, "cushion", 0, top + 0.3, -1.9, 2.1, 0.5, 0.75);
  soft(p, "cushion", 0, top + 0.7, -2.25, 2.1, 0.5, 0.18, -0.15);
  soft(p, "cushion", 0, top + 0.28, -0.95, 0.9, 0.5, 0.6);
  soft(p, "cushion", 0, top + 0.22, 2.0, 1.6, 0.12, 1.5);
  soft(p, "accent", 0.3, top + 0.33, 2.3, 0.4, 0.1, 0.25);
  // The cradle.
  for (const z of [-2.4, 0, 2.2]) {
    p.box("dark", -1.05, 0, z - 0.1, 1.05, 0.12, z + 0.1);
    for (const sx of [-1, 1]) p.obox("pad", sx * 0.62, 0.32, z, 0.12, 0.42, 0.22, 0, 0, sx * 0.5);
  }
  p.box("dark", -0.06, 0, -3.0, 0.06, 0.12, 2.8);
});

/** A bar back: shelves of bottles against a wall, 3 m along x, facing +z. */
export const barBack: Prefab<MatKey> = prefab("barBack", (p) => {
  p.box("wood", -1.5, 0, -0.25, 1.5, 0.95, 0.25);
  p.box("white", -1.52, 0.95, -0.27, 1.52, 1.0, 0.27);
  for (const y of [1.45, 1.95]) {
    p.box("wood", -1.5, y, -0.25, 1.5, y + 0.04, 0.0);
    for (let i = 0; i < 14; i++) p.cyl("bottle", -1.35 + i * 0.21, y + 0.04, -0.12, 0.045, 0.28 - (i % 3) * 0.05, 6, 0.03);
  }
  p.box("cove", -1.45, 2.38, -0.25, 1.45, 2.42, -0.05);
});
