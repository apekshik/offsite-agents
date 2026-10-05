// The pieces the decks are made of: slabs, deckhouses, balustrades, stairs, lights. Each puts its
// geometry in the ship's piles and, where it matters, its walls and floors in the colliders.

import * as THREE from "three";
import { SLAB } from "./dims.ts";
import type { MatKey, Mats } from "./mats.ts";
import { along, band, cap, Colliders, outline, Pile, Plan, Props, type Outline, type P2 } from "./kit.ts";

export interface Ship {
  pile: Pile<MatKey>;
  col: Colliders;
  plan: Plan;
  props: Props<MatKey>;
  materials: Mats;
  /** Meshes drawn on their own: screens, decals, things that move. */
  extra: THREE.Object3D[];
  /** Called every frame: dt seconds, t world seconds. */
  tick: ((dt: number, t: number, now: number) => void)[];
}

export interface SlabOptions {
  top?: MatKey;
  edge?: MatKey;
  under?: MatKey;
  thick?: number;
  collide?: boolean;
  /** Skip the underside (it's hidden). */
  noUnder?: boolean;
  holes?: P2[][];
}

/** A deck: walking surface on top, a white fascia round the edge, a ceiling underneath. */
export function slab(s: Ship, o: Outline | P2[], y: number, { top = "teak", edge = "white", under = "under", thick = SLAB, collide = true, noUnder = false, holes = [] }: SlabOptions = {}): P2[] {
  const pts = Array.isArray(o) ? o : outline(o);
  s.pile.add(top, cap(pts, y, false, holes));
  if (!noUnder) s.pile.add(under, cap(pts, y - thick, true, holes));
  s.pile.add(edge, band(pts, y - thick, y));
  for (const h of holes) s.pile.add(edge, band(h, y - thick, y, { inward: true }));
  if (collide) s.col.floor(pts, y, 0.3, holes);
  return pts;
}

export interface HouseOptions {
  /** The window band: from, to (heights), or null for a plain wall. */
  glass?: [number, number] | null;
  glassMat?: MatKey;
  wallMat?: MatKey;
  /** Vertical frames in the glass every this many metres. */
  mullion?: number;
  /** Leaves out walls whose middle is here (doorways). */
  open?: (x: number, z: number) => boolean;
  collide?: boolean;
}

/** A deckhouse's walls round an outline: white below and above a band of tinted glass. */
export function house(s: Ship, pts: P2[], y0: number, y1: number, { glass = [y0 + 0.75, y1 - 0.45], glassMat = "darkGlass", wallMat = "white", mullion = 2.6, open, collide = true }: HouseOptions = {}) {
  const pieces = open ? runsOf(pts, (x, z) => !open(x, z)) : [pts];
  for (const run of pieces) {
    const closed = !open;
    if (glass) {
      if (glass[0] > y0) s.pile.add(wallMat, band(run, y0, glass[0], { closed }));
      s.pile.add(glassMat, band(run, glass[0], glass[1], { closed }));
      if (glass[1] < y1) s.pile.add(wallMat, band(run, glass[1], y1, { closed }));
      const line = closed ? [...run, run[0]!] : run;
      for (const m of along(line, mullion, mullion / 2)) s.pile.obox(wallMat, m.x, (glass[0] + glass[1]) / 2, m.z, 0.09, glass[1] - glass[0], 0.09, Math.atan2(m.dx, m.dz));
    } else {
      s.pile.add(wallMat, band(run, y0, y1, { closed }));
    }
    if (collide) s.col.wall(closed ? [...run, run[0]!] : run, y0, y1, 0.2);
  }
}

function runsOf(pts: P2[], keep: (x: number, z: number) => boolean): P2[][] {
  const out: P2[][] = [];
  let cur: P2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    if (keep((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) {
      if (!cur.length) cur.push(a);
      cur.push(b);
    } else if (cur.length) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  if (out.length > 1) {
    const f = out[0]!, l = out[out.length - 1]!;
    const lp = l[l.length - 1]!, fp = f[0]!;
    if (lp[0] === fp[0] && lp[1] === fp[1]) { out[0] = [...l, ...f.slice(1)]; out.pop(); }
  }
  return out;
}

/** A glass balustrade along an open polyline: panes, a chrome cap rail, posts. */
export function balustrade(s: Ship, run: P2[], y: number, { collide = true, h = 1.05 } = {}) {
  if (run.length < 2) return;
  s.pile.add("rail", band(run, y + 0.06, y + h - 0.06, { closed: false }));
  for (let i = 0; i + 1 < run.length; i++) {
    const [x0, z0] = run[i]!, [x1, z1] = run[i + 1]!;
    s.pile.rod("chrome", new THREE.Vector3(x0, y + h, z0), new THREE.Vector3(x1, y + h, z1), 0.032, 6);
  }
  for (const p of along(run, 1.7, 0.02)) s.pile.rod("chrome", new THREE.Vector3(p.x, y, p.z), new THREE.Vector3(p.x, y + h, p.z), 0.024, 6);
  const end = run[run.length - 1]!;
  s.pile.rod("chrome", new THREE.Vector3(end[0], y, end[1]), new THREE.Vector3(end[0], y + h, end[1]), 0.024, 6);
  if (collide) s.col.wall(run, y, y + h + 0.1, 0.1);
}

/** Open chrome railing (the foredeck's): stanchions and three rails. */
export function chromeRail(s: Ship, run: P2[], y: number, { collide = true } = {}) {
  if (run.length < 2) return;
  for (let i = 0; i + 1 < run.length; i++) {
    const [x0, z0] = run[i]!, [x1, z1] = run[i + 1]!;
    for (const [h, r] of [[0.38, 0.016], [0.72, 0.016], [1.06, 0.03]] as const)
      s.pile.rod("chrome", new THREE.Vector3(x0, y + h, z0), new THREE.Vector3(x1, y + h, z1), r, 6);
  }
  for (const p of [...along(run, 1.5, 0.02), { x: run[run.length - 1]![0], z: run[run.length - 1]![1] }])
    s.pile.rod("chrome", new THREE.Vector3(p.x, y, p.z), new THREE.Vector3(p.x, y + 1.06, p.z), 0.026, 6);
  if (collide) s.col.wall(run, y, y + 1.15, 0.1);
}

export interface StairOptions {
  id: string;
  /** Across the flight. */
  x0: number; x1: number;
  /** Bottom of the flight (z, floor height) and top. */
  zLow: number; yLow: number; zHigh: number; yHigh: number;
  /** Sides with a wall rather than an open rail: [-x side, +x side]. */
  walls?: [boolean, boolean];
  /** Leave out a side's rail entirely (it runs against a wall already there). */
  bare?: [boolean, boolean];
}

/**
 * A straight flight of teak steps between two decks, built in: each step a solid block down to
 * the deck, so there's no hollow under the flight, smooth white cheeks over the step ends, glass
 * above them and a chrome handrail. The captain walks a wedge-shaped solid whose top is the slope;
 * the walking graph gets a node off each end.
 */
export function stairs(s: Ship, o: StairOptions): { low: string; high: string } {
  const { x0, x1, zLow, yLow, zHigh, yHigh } = o;
  const rise = yHigh - yLow, run = Math.abs(zHigh - zLow), dir = Math.sign(zHigh - zLow);
  const n = Math.max(2, Math.round(rise / 0.19)), h = rise / n, t = run / n;
  const xa = Math.min(x0, x1), xb = Math.max(x0, x1), xc = (xa + xb) / 2;
  for (let k = 1; k <= n; k++) {
    const za = zLow + dir * (k - 1) * t, zb = zLow + dir * k * t, top = yLow + k * h;
    s.pile.box("teak", xa, top - 0.05, Math.min(za, zb) - 0.03, xb, top, Math.max(za, zb));
    s.pile.box("white", xa, yLow, Math.min(za, zb), xb, top - 0.05, Math.max(za, zb));
    s.pile.box("lamp", xa + 0.1, top - 0.08, za - 0.01, xb - 0.1, top - 0.06, za + 0.01);
  }
  // The sides: a white cheek over the step ends, glass above it, a chrome handrail on posts.
  const cheek = 0.16, rail = 1.0;
  for (const [i, x, out] of [[0, xa - 0.04, -1], [1, xb + 0.04, 1]] as const) {
    if (o.bare?.[i]) continue;
    const wall = o.walls?.[i] ?? false;
    const side = new THREE.Shape([
      new THREE.Vector2(zLow, yLow), new THREE.Vector2(zHigh, yLow), new THREE.Vector2(zHigh, yHigh + cheek), new THREE.Vector2(zLow, yLow + cheek),
    ]);
    const g = new THREE.ShapeGeometry(side);
    g.deleteAttribute("uv");
    // The shape lies in (z, y); stand it in the plane x = const, facing out.
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, out, x, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
    // That turn mirrors the starboard-facing cheek: wind it back so its front faces out.
    if (out > 0) {
      const idx = g.index!;
      for (let j = 0; j < idx.count; j += 3) { const b = idx.getX(j + 1); idx.setX(j + 1, idx.getX(j + 2)); idx.setX(j + 2, b); }
    }
    s.pile.add("white", g);
    const a = new THREE.Vector3(x, yLow + rail, zLow), b = new THREE.Vector3(x, yHigh + rail, zHigh);
    if (!wall) {
      const pos = [x, yLow + cheek, zLow, x, yHigh + cheek, zHigh, x, yHigh + rail - 0.06, zHigh, x, yLow + rail - 0.06, zLow];
      const gl = new THREE.BufferGeometry();
      gl.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      gl.setAttribute("normal", new THREE.Float32BufferAttribute([out, 0, 0, out, 0, 0, out, 0, 0, out, 0, 0], 3));
      gl.setIndex([0, 1, 2, 0, 2, 3]);
      s.pile.add("rail", gl);
      for (let k = 0; k <= 4; k++) {
        const p = a.clone().lerp(b, k / 4);
        s.pile.rod("chrome", new THREE.Vector3(x, p.y - rail + cheek, p.z), p, 0.022, 6);
      }
    }
    s.pile.rod("chrome", a, b, 0.032, 8);
    // Its collider, a barrier along the side above the slope, stops short of the ends so it never
    // pokes out into the deck either side.
    const za = zLow + dir * 0.8, zb = zHigh - dir * 0.3;
    s.col.ramp(x - 0.06, x + 0.06, za, yLow + (rise * 0.8) / run + 1.05, zb, yHigh - (rise * 0.3) / run + 1.05, 0.8);
  }
  // What the captain walks on: a solid wedge from the deck up to the slope, closed underneath.
  const wedge = new THREE.BufferGeometry();
  wedge.setAttribute("position", new THREE.Float32BufferAttribute([
    xa, yLow, zLow, xb, yLow, zLow, xa, yLow, zHigh, xb, yLow, zHigh, xa, yHigh, zHigh, xb, yHigh, zHigh,
  ], 3));
  wedge.setIndex([0, 4, 2, 1, 3, 5, 0, 1, 5, 0, 5, 4, 2, 4, 5, 2, 5, 3, 0, 2, 3, 0, 3, 1]);
  s.col.add(wedge);
  const low = s.plan.node(`${o.id}:low`, xc, yLow, zLow - dir * 0.9);
  const high = s.plan.node(`${o.id}:high`, xc, yHigh, zHigh + dir * 0.9);
  s.plan.link(low, high);
  return { low, high };
}

/** Small round lights under a deck's edge, lit at night. */
export function downlights(s: Ship, run: P2[], y: number, every = 3.2) {
  for (const p of along(run, every)) s.pile.cyl("lamp", p.x, y - 0.02, p.z, 0.09, 0.02, 10);
}
