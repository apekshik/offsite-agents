// The base as it is being built: the piles of geometry, the colliders, the walking graph and the
// slots, and, as plain data, everything the build's second half turns into meshes and lights
// (screens, glows, lamps, moving things). Building the layout touches no materials and no
// canvas, so tests can build it without a browser (layout.ts).

import * as THREE from "three";
import type { Interactable } from "@offsite/kit";
import type { MatKey } from "./mats.ts";
import { Colliders, Pile, Plan, Props, spaced, type Frame, type P2, type Prefab } from "./kit.ts";

/**
 * A point of light with a soft glow that reads from far off. `mode`: "always"; "night" (after
 * dark); "busy" (after dark, or when the crew are at work); "blink" (a slow on and off, the masts'
 * beacons); "strobe" (a double flash).
 */
export interface Halo { x: number; y: number; z: number; color: string; size: number; mode: "always" | "night" | "busy" | "blink" | "strobe" }

/** A screen the app (or the base itself) paints: a plane facing +z in its own frame. */
export interface ScreenSpot {
  id: string;
  w: number; h: number;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  /** desk: a crew member's monitor; board: shows the ship (the helm, the wall); code: just scrolls code. */
  kind: "desk" | "board" | "code";
  brightness?: number;
}

/** A real light in a room after dark, warm and shadowless, so people in it are lit. */
export interface RoomLight { x: number; y: number; z: number; intensity: number; distance: number; color?: string; busy?: number; always?: boolean }

export interface Base {
  /** Outdoors: casts shadows. */
  pile: Pile<MatKey>;
  /** Indoors, out of the sun: merged like `pile`, casting no shadows. */
  inner: Pile<MatKey>;
  col: Colliders;
  plan: Plan;
  props: Props<MatKey>;
  innerProps: Props<MatKey>;
  screens: ScreenSpot[];
  halos: Halo[];
  rooms: RoomLight[];
  /** Pools of light on the ground under lamps after dark: where, and how wide. */
  pools: { x: number; y: number; z: number; r: number; k?: number }[];
  interactables: Interactable[];
  /** Nav nodes to link wherever they can see each other on foot (checked against the colliders at the end). */
  open: { ids: string[]; reach: number }[];
  /** Anything else the second half of the build needs (paths for moving things), by name. */
  marks: Map<string, THREE.Vector3[]>;
}

export function newBase(): Base {
  return {
    pile: new Pile<MatKey>(), inner: new Pile<MatKey>(), col: new Colliders(), plan: new Plan(),
    props: new Props<MatKey>(), innerProps: new Props<MatKey>(),
    screens: [], halos: [], rooms: [], pools: [], interactables: [], open: [], marks: new Map(),
  };
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * A workstation: a desk and its stool (instanced), the desk as a collider, its monitor as a
 * screen the app paints, and a "desk" slot on the stool facing the screen. The desk stands at
 * (x, y, z) with its user's side toward `yaw`.
 */
export function workstation(s: Base, id: string, x: number, y: number, z: number, yaw: number, o: { nav?: string; tags?: string[] }, d: { desk: Prefab<MatKey>; stool: Prefab<MatKey>; w: number; dd: number; h: number; screen: { y: number; z: number; w: number; h: number } }) {
  s.innerProps.put(d.desk, x, y, z, yaw);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const cx = x + fx * 0.72, cz = z + fz * 0.72;
  s.innerProps.put(d.stool, cx, y, cz, yaw);
  s.col.obox(x, y + d.h / 2, z, d.w, d.h, d.dd, yaw);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const sz = d.screen.z + 0.003;
  s.screens.push({ id, kind: "desk", w: d.screen.w, h: d.screen.h, pos: new THREE.Vector3(x + fx * sz, y + d.screen.y, z + fz * sz), quat: q });
  s.plan.slot("desk", id, [cx, y, cz], yaw + Math.PI, { seat: 0.47, tags: o.tags ?? ["indoors"], ...(o.nav ? { nav: o.nav } : {}) });
}

/** A hole in a facade, in its own (x, y): a round viewport, or an arched door from y0 up. */
export type Hole = { port: [number, number, number] } | { door: [number, number, number, number] };

function holePath(h: Hole): THREE.Vector2[] {
  if ("port" in h) {
    const [cx, cy, r] = h.port;
    return Array.from({ length: 20 }, (_, i) => new THREE.Vector2(cx + r * Math.cos((-i / 20) * Math.PI * 2), cy + r * Math.sin((-i / 20) * Math.PI * 2)));
  }
  const [cx, y0, w, ht] = h.door, spring = ht - w / 2;
  const pts = [new THREE.Vector2(cx - w / 2, y0), new THREE.Vector2(cx - w / 2, y0 + spring)];
  for (let i = 1; i < 12; i++) { const t = Math.PI - (i / 12) * Math.PI; pts.push(new THREE.Vector2(cx + (w / 2) * Math.cos(t), y0 + spring + (w / 2) * Math.sin(t))); }
  pts.push(new THREE.Vector2(cx + w / 2, y0 + spring), new THREE.Vector2(cx + w / 2, y0));
  return pts;
}

/**
 * The front of a building dug into a riser, in the building's frame: its outside face (facing the
 * crater) round `outline` (local x, y) with holes cut for viewports and doors, its inside face
 * `thick` behind it, glass in the viewports and dark rings round them. Returns the faces' holes.
 */
export function facade(s: Base, f: Frame, o: { outline: P2[]; holes: Hole[]; thick: number; outMat: MatKey; inMat: MatKey | null; inY?: [number, number]; glass?: MatKey }) {
  const outShape = new THREE.Shape(o.outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of o.holes) outShape.holes.push(new THREE.Path(holePath(h)));
  const outside = new THREE.ShapeGeometry(outShape, 10);
  outside.deleteAttribute("uv");
  // ShapeGeometry faces +z (into the hill): the outside face is turned to face the crater.
  s.pile.add(o.outMat, f.geom(flipped(outside)));
  if (o.inMat) {
    const [y0, y1] = o.inY ?? [Math.min(...o.outline.map((p) => p[1])), Math.max(...o.outline.map((p) => p[1]))];
    const xs = o.outline.map((p) => p[0]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const inShape = new THREE.Shape([new THREE.Vector2(x0, y0), new THREE.Vector2(x1, y0), new THREE.Vector2(x1, y1), new THREE.Vector2(x0, y1)]);
    for (const h of o.holes) inShape.holes.push(new THREE.Path(holePath(h)));
    const inside = new THREE.ShapeGeometry(inShape, 10).translate(0, 0, o.thick);
    inside.deleteAttribute("uv");
    s.inner.add(o.inMat, f.geom(inside));
  }
  for (const h of o.holes) {
    if (!("port" in h)) continue;
    const [cx, cy, r] = h.port;
    const tube = new THREE.CylinderGeometry(r, r, o.thick, 20, 1, true).rotateX(Math.PI / 2).translate(cx, cy, o.thick / 2);
    tube.deleteAttribute("uv");
    s.pile.add("dark", f.geom(flipped(tube)));
    const rim = new THREE.TorusGeometry(r + 0.08, 0.09, 6, 22).translate(cx, cy, -0.04);
    rim.deleteAttribute("uv");
    s.pile.add("dark", f.geom(rim));
    if (o.glass) {
      const pane = new THREE.CircleGeometry(r, 20).translate(cx, cy, o.thick * 0.4);
      pane.deleteAttribute("uv");
      s.pile.add(o.glass, f.geom(pane));
    }
  }
}

function flipped(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const I = g.index!;
  for (let i = 0; i < I.count; i += 3) { const t = I.getX(i + 1); I.setX(i + 1, I.getX(i + 2)); I.setX(i + 2, t); }
  const n = g.attributes.normal;
  if (n) for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

/** Links a building's door node to the road in front of it (its few nearest road nodes, wherever they can be walked to). */
export function joinRoad(s: Base, id: string, prefix: string, n = 4) {
  const p = s.plan.at(id);
  const near = [...s.plan.nodes.entries()]
    .filter(([k, q]) => k.startsWith(prefix) && Math.abs(q[1] - p[1]) < 1)
    .sort((a, b) => Math.hypot(a[1][0] - p[0], a[1][2] - p[2]) - Math.hypot(b[1][0] - p[0], b[1][2] - p[2]))
    .slice(0, n)
    .map(([k]) => k);
  s.open.push({ ids: [id, ...near], reach: 16 });
}

/** An orange safety rail along a polyline: posts, a top rail and a mid rail. */
export function rail(pile: Pile<MatKey>, col: Colliders | null, run: P2[], y: number, { h = 1.05, every = 1.8, mat = "orange" as MatKey } = {}) {
  if (run.length < 2) return;
  for (let i = 0; i + 1 < run.length; i++) {
    const [x0, z0] = run[i]!, [x1, z1] = run[i + 1]!;
    pile.rod(mat, V(x0, y + h, z0), V(x1, y + h, z1), 0.04, 6);
    pile.rod(mat, V(x0, y + h * 0.5, z0), V(x1, y + h * 0.5, z1), 0.025, 5);
  }
  for (const p of [...spaced(run, every, 0.01), { x: run[run.length - 1]![0], z: run[run.length - 1]![1] }]) pile.rod(mat, V(p.x, y, p.z), V(p.x, y + h, p.z), 0.035, 6);
  col?.wall(run, y, y + h + 0.1, 0.12);
}

/**
 * A straight flight of steps from (x, yLow, zLow) to (x, yHigh, zHigh) between x0 and x1 (in
 * a frame given by `at`, which maps local (x, z) to the world): blocky printed steps, an orange
 * rail each side, a wedge for the colliders and a nav node off each end.
 */
export function steps(s: Base, o: {
  id: string; x0: number; x1: number; zLow: number; yLow: number; zHigh: number; yHigh: number;
  at: (x: number, z: number) => P2; inside?: boolean; rails?: [boolean, boolean];
}): { low: string; high: string } {
  const pile = o.inside === false ? s.pile : s.inner;
  const rise = o.yHigh - o.yLow, run = o.zHigh - o.zLow;
  const n = Math.max(2, Math.round(rise / 0.19)), h = rise / n, t = run / n;
  const xa = Math.min(o.x0, o.x1), xb = Math.max(o.x0, o.x1), xc = (xa + xb) / 2;
  const quad = (pts: P2[], y0: number, y1: number, mat: MatKey) => {
    // A box between local corners, as world geometry.
    const [a, b, c, d] = pts.map(([x, z]) => o.at(x, z)) as [P2, P2, P2, P2];
    const g = new THREE.BufferGeometry();
    const P = [a, b, c, d];
    const pos: number[] = [];
    const tri = (p: number[], q: number[], r: number[]) => pos.push(...p, ...q, ...r);
    const top = P.map(([x, z]) => [x, y1, z]), bot = P.map(([x, z]) => [x, y0, z]);
    tri(top[0]!, top[2]!, top[1]!); tri(top[0]!, top[3]!, top[2]!);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      tri(bot[i]!, top[j]!, top[i]!); tri(bot[i]!, bot[j]!, top[j]!);
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    // Wind consistently outward whichever way the frame turns.
    g.computeVertexNormals();
    const nrm = g.attributes.normal!, cen = new THREE.Vector3();
    P.forEach(([x, z]) => cen.add(V(x, (y0 + y1) / 2, z)));
    cen.divideScalar(4);
    const p = g.attributes.position!;
    for (let i = 0; i < p.count; i += 3) {
      const m = V((p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3);
      const nn = V(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      if (nn.dot(m.sub(cen)) < 0) {
        for (const k of [0, 1, 2]) nrm.setXYZ(i + k, -nrm.getX(i + k), -nrm.getY(i + k), -nrm.getZ(i + k));
        const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
        p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
        p.setXYZ(i + 2, x, y, z);
      }
    }
    pile.add(mat, g);
  };
  for (let k = 1; k <= n; k++) {
    const za = o.zLow + (k - 1) * t, zb = o.zLow + k * t, top = o.yLow + k * h;
    quad([[xa, za], [xb, za], [xb, zb + Math.sign(t) * 0.02], [xa, zb + Math.sign(t) * 0.02]], o.yLow, top, k % 2 ? "floor" : "floor");
    // A thin amber nosing on each step, lit at night.
    const [nx0, nz0] = o.at(xa + 0.15, za), [nx1, nz1] = o.at(xb - 0.15, za);
    pile.rod("amber", V(nx0, top + 0.012, nz0), V(nx1, top + 0.012, nz1), 0.015, 4);
  }
  // The rails, and the wedge the captain walks on.
  const rails = o.rails ?? [true, true];
  [[xa - 0.05, rails[0]], [xb + 0.05, rails[1]]].forEach(([x, on]) => {
    if (!on) return;
    const xx = x as number;
    const a = o.at(xx, o.zLow), b = o.at(xx, o.zHigh);
    for (const hh of [0.95, 0.5]) pile.rod("orange", V(a[0], o.yLow + hh, a[1]), V(b[0], o.yHigh + hh, b[1]), hh > 0.9 ? 0.04 : 0.025, 6);
    for (let k = 0; k <= 3; k++) {
      const u = k / 3, z = o.zLow + run * u, y = o.yLow + rise * u;
      const p = o.at(xx, z);
      pile.rod("orange", V(p[0], y, p[1]), V(p[0], y + 0.95, p[1]), 0.035, 6);
    }
    // A barrier along the side above the slope.
    const za = o.zLow + Math.sign(run) * 0.6, zb = o.zHigh - Math.sign(run) * 0.3;
    const pa = o.at(xx, za), pb = o.at(xx, zb);
    const ya = o.yLow + (rise * 0.6) / Math.abs(run), yb = o.yHigh - (rise * 0.3) / Math.abs(run);
    const g = new THREE.BufferGeometry();
    const w = 0.06;
    const side = [o.at(xx - w, za), o.at(xx + w, za), o.at(xx + w, zb), o.at(xx - w, zb)];
    g.setAttribute("position", new THREE.Float32BufferAttribute([
      side[0]![0], ya, side[0]![1], side[1]![0], ya, side[1]![1], side[2]![0], yb, side[2]![1], side[3]![0], yb, side[3]![1],
      side[0]![0], ya + 1.05, side[0]![1], side[1]![0], ya + 1.05, side[1]![1], side[2]![0], yb + 1.05, side[2]![1], side[3]![0], yb + 1.05, side[3]![1],
    ], 3));
    g.setIndex([0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
    s.col.add(g);
    void pa; void pb;
  });
  const wedge = new THREE.BufferGeometry();
  const c = [o.at(xa, o.zLow), o.at(xb, o.zLow), o.at(xa, o.zHigh), o.at(xb, o.zHigh)];
  wedge.setAttribute("position", new THREE.Float32BufferAttribute([
    c[0]![0], o.yLow, c[0]![1], c[1]![0], o.yLow, c[1]![1], c[2]![0], o.yLow, c[2]![1], c[3]![0], o.yLow, c[3]![1],
    c[2]![0], o.yHigh, c[2]![1], c[3]![0], o.yHigh, c[3]![1],
  ], 3));
  wedge.setIndex([0, 4, 2, 1, 3, 5, 0, 1, 5, 0, 5, 4, 2, 4, 5, 2, 5, 3, 0, 2, 3, 0, 3, 1]);
  s.col.add(wedge);
  const lowP = o.at(xc, o.zLow - Math.sign(run) * 0.9), highP = o.at(xc, o.zHigh + Math.sign(run) * 0.9);
  const low = s.plan.node(`${o.id}:low`, lowP[0], o.yLow, lowP[1]);
  const high = s.plan.node(`${o.id}:high`, highP[0], o.yHigh, highP[1]);
  s.plan.link(low, high);
  return { low, high };
}
