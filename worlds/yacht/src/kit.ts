// The shipwright's kit: how the yacht is put together. Everything static lands in one pile per
// material and is merged into a single mesh each (a handful of draw calls for the whole ship);
// furniture is instanced; what the captain walks on and bumps into is a separate, invisible,
// low-poly collision mesh; and the walking graph and slots are collected as the decks are built.

import * as THREE from "three";
import { mergeInto } from "@offsite/kit";
import type { NavGraph, Slot, SlotKind, Vec3, WorldLayout } from "@offsite/contracts";

export type P2 = [number, number]; // (x, z)

// ---------- geometry piles ----------

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const cylinders = new Map<string, THREE.BufferGeometry>();
function unitCylinder(seg: number, top = 1, open = false): THREE.BufferGeometry {
  const key = `${seg}|${top}|${open}`;
  let g = cylinders.get(key);
  if (!g) cylinders.set(key, (g = new THREE.CylinderGeometry(top, 1, 1, seg, 1, open).translate(0, 0.5, 0)));
  return g;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Pile<K extends string = string> {
  parts = new Map<K, { geometry: THREE.BufferGeometry; matrix?: THREE.Matrix4 }[]>();

  add(mat: K, geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4): this {
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push({ geometry, matrix: matrix?.clone() });
    return this;
  }
  /** An axis-aligned box from its corners. */
  box(mat: K, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
    _m.compose(_p.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), _q.identity(), _s.set(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)));
    return this.add(mat, UNIT_BOX, _m);
  }
  /** A box by its centre and size, turned ry about y (then rx, rz). */
  obox(mat: K, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0): this {
    _m.compose(_p.set(cx, cy, cz), _q.setFromEuler(_e.set(rx, ry, rz, "YXZ")), _s.set(sx, sy, sz));
    return this.add(mat, UNIT_BOX, _m);
  }
  /** A vertical cylinder standing on (x, y0, z). */
  cyl(mat: K, x: number, y0: number, z: number, r: number, h: number, seg = 12, rTop = r): this {
    _m.compose(_p.set(x, y0, z), _q.identity(), _s.set(r, h, r));
    return this.add(mat, unitCylinder(seg, rTop / r), _m);
  }
  /** A round bar from a to b. */
  rod(mat: K, a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6): this {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    if (len < 1e-4) return this;
    _q.setFromUnitVectors(UP, d.divideScalar(len));
    _m.compose(a, _q, _s.set(r, len, r));
    return this.add(mat, unitCylinder(seg, 1, true), _m);
  }
  /** Merges each material's pile into one geometry, in place. */
  geometries(): Map<K, THREE.BufferGeometry> {
    const out = new Map<K, THREE.BufferGeometry>();
    for (const [k, list] of this.parts) out.set(k, mergeInto(list));
    return out;
  }
  /** One mesh per material. */
  build(mats: Record<K, THREE.Material>, shadows: (k: K) => { cast: boolean; receive: boolean } = () => ({ cast: true, receive: true })): THREE.Group {
    const g = new THREE.Group();
    for (const [k, geo] of this.geometries()) {
      const mesh = new THREE.Mesh(geo, mats[k]);
      mesh.name = `ship:${k}`;
      const s = shadows(k);
      mesh.castShadow = s.cast;
      mesh.receiveShadow = s.receive;
      g.add(mesh);
    }
    return g;
  }
}

// ---------- surfaces from outlines ----------

/** A flat polygon at height y, facing up (or down). */
export function cap(points: P2[], y: number, down = false, holes: P2[][] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
  const g = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, y, 0);
  g.deleteAttribute("uv");
  return down ? flip(g) : g;
}

/** Turns a geometry inside out: reversed winding and normals. */
export function flip(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const idx = g.index!;
  for (let i = 0; i < idx.count; i += 3) {
    const b = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, b);
  }
  const n = g.attributes.normal!;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

const signedArea = (pts: P2[]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i]!, [x1, z1] = pts[(i + 1) % pts.length]!;
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
};

/**
 * A vertical band along a polyline from y0 to y1, facing outward from a closed outline (or to
 * the right of the direction of travel, for an open one; `inward` flips it). Corners sharper than
 * ~35° get their own normals; gentler ones are smoothed.
 */
export function band(points: P2[], y0: number, y1: number, { closed = true, inward = false, y1At }: { closed?: boolean; inward?: boolean; y1At?: (x: number, z: number) => number } = {}): THREE.BufferGeometry {
  const n = points.length, segs = closed ? n : n - 1;
  let sign = closed ? (signedArea(points) > 0 ? 1 : -1) : 1;
  if (inward) sign = -sign;
  const segN: P2[] = [];
  for (let i = 0; i < segs; i++) {
    const [x0, z0] = points[i]!, [x1, z1] = points[(i + 1) % n]!;
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
    // (dz, -dx) is the right-hand normal of travel in (x, z).
    segN.push([(sign * dz) / l, (sign * -dx) / l]);
  }
  const pos: number[] = [], nor: number[] = [], index: number[] = [];
  const vertNormal = (i: number, seg: number): P2 => {
    const a = segN[seg]!;
    const otherSeg = i === seg ? seg - 1 : seg + 1;
    const os = closed ? (otherSeg + segs) % segs : otherSeg;
    if (os < 0 || os >= segs) return a;
    const b = segN[os]!;
    if (a[0] * b[0] + a[1] * b[1] < 0.82) return a;
    const x = a[0] + b[0], z = a[1] + b[1], l = Math.hypot(x, z) || 1;
    return [x / l, z / l];
  };
  for (let s = 0; s < segs; s++) {
    const i0 = s, i1 = (s + 1) % n;
    const p0 = points[i0]!, p1 = points[i1]!;
    const n0 = vertNormal(i0, s), n1 = vertNormal(s + 1, s);
    const t0 = y1At ? y1At(p0[0], p0[1]) : y1, t1 = y1At ? y1At(p1[0], p1[1]) : y1;
    const b = pos.length / 3;
    pos.push(p0[0], y0, p0[1], p1[0], y0, p1[1], p1[0], t1, p1[1], p0[0], t0, p0[1]);
    nor.push(n0[0], 0, n0[1], n1[0], 0, n1[1], n1[0], 0, n1[1], n0[0], 0, n0[1]);
    // Wind so the face points along the normal: (b, b+1, b+2) faces the left of travel.
    const ex = p1[0] - p0[0], ez = p1[1] - p0[1];
    if (-ez * segN[s]![0] + ex * segN[s]![1] > 0) index.push(b, b + 1, b + 2, b, b + 2, b + 3);
    else index.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(index);
  return g;
}

// ---------- deck outlines ----------

export interface Outline {
  zF: number; // front (toward the bow)
  zA: number; // aft
  w: number; // half-width along the straight part
  rf?: number; nf?: number; // length and squareness of the rounded front
  ra?: number; na?: number; // and of the rounded aft end
  /** Overrides the half-width along the straight part (a deck that follows the hull). */
  hw?: (z: number) => number;
  /** Bites out of a side, for a stair coming up through the deck: [side, z0, z1, x to cut back to]. */
  notches?: [1 | -1, number, number, number][];
}

/** The outline's half-width at z on a side (+1 starboard, -1 port), before notches. */
export function halfWidth(o: Outline, z: number): number {
  const rf = o.rf ?? 0, ra = o.ra ?? 0;
  let w = o.hw ? o.hw(z) : o.w;
  if (rf > 0 && z < o.zF + rf) {
    const t = Math.min(1, (o.zF + rf - z) / rf), n = o.nf ?? 2;
    w *= Math.pow(Math.max(0, 1 - Math.pow(t, n)), 1 / n);
  }
  if (ra > 0 && z > o.zA - ra) {
    const t = Math.min(1, (z - (o.zA - ra)) / ra), n = o.na ?? 2;
    w *= Math.pow(Math.max(0, 1 - Math.pow(t, n)), 1 / n);
  }
  return Math.max(0, w);
}

function sideWidth(o: Outline, z: number, side: 1 | -1): number {
  let w = halfWidth(o, z);
  for (const [s, z0, z1, inner] of o.notches ?? []) if (s === side && z >= z0 - 1e-6 && z <= z1 + 1e-6) w = Math.min(w, inner);
  return w;
}

/** Samples along z: fine at rounded ends, and exactly at every notch's ends. */
function zSamples(o: Outline, step = 0.5): number[] {
  const zs = new Set<number>();
  const add = (z: number) => zs.add(Math.round(z * 1000) / 1000);
  const rf = o.rf ?? 0, ra = o.ra ?? 0;
  const capN = 16;
  for (let i = 0; i <= capN; i++) {
    if (rf > 0) add(o.zF + rf * (1 - Math.cos((i / capN) * Math.PI / 2)));
    if (ra > 0) add(o.zA - ra * (1 - Math.cos((i / capN) * Math.PI / 2)));
  }
  for (let z = o.zF; z <= o.zA; z += step) add(z);
  add(o.zF); add(o.zA);
  for (const [, z0, z1] of o.notches ?? []) { add(z0 - 0.001); add(z0); add(z1); add(z1 + 0.001); }
  return [...zs].filter((z) => z >= o.zF && z <= o.zA).sort((a, b) => a - b);
}

/** The closed outline: down the starboard side from the front, back up the port side. */
export function outline(o: Outline, step = 0.5): P2[] {
  const zs = zSamples(o, step);
  const pts: P2[] = [];
  for (const z of zs) {
    const w = sideWidth(o, z, 1);
    pts.push([w, z]);
  }
  for (let i = zs.length - 1; i >= 0; i--) {
    const z = zs[i]!, w = sideWidth(o, z, -1);
    pts.push([-w, z]);
  }
  // Drop repeats where both sides meet at the ends.
  return pts.filter((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4;
  });
}

/** Moves every point of an outline in (or out) along the bisector of its edges. */
export function inset(points: P2[], d: number): P2[] {
  const n = points.length, sign = signedArea(points) > 0 ? 1 : -1;
  return points.map((p, i) => {
    const a = points[(i - 1 + n) % n]!, b = points[(i + 1) % n]!;
    const t: P2 = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(t[0], t[1]) || 1;
    // Left-hand normal of travel points inward for a counter-clockwise (positive area) outline.
    return [p[0] + (sign * -t[1] / l) * d, p[1] + (sign * t[0] / l) * d];
  });
}

/** Splits a closed outline into runs of edges, leaving out edges whose middle is in a gap. */
export function runs(points: P2[], keep: (x: number, z: number) => boolean, closed = true): P2[][] {
  const out: P2[][] = [];
  let cur: P2[] = [];
  const n = points.length, segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = points[i]!, b = points[(i + 1) % n]!;
    if (keep((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) {
      if (!cur.length) cur.push(a);
      cur.push(b);
    } else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  // A closed outline's last run may continue into its first.
  if (closed && out.length > 1) {
    const first = out[0]!, last = out[out.length - 1]!;
    const lp = last[last.length - 1]!, fp = first[0]!;
    if (lp[0] === fp[0] && lp[1] === fp[1]) { out[0] = [...last, ...first.slice(1)]; out.pop(); }
  }
  return out;
}

/** Points along a polyline every `every` metres (for posts, lights, rail slots). */
export function along(points: P2[], every: number, offset = every / 2): { x: number; z: number; dx: number; dz: number }[] {
  const out: { x: number; z: number; dx: number; dz: number }[] = [];
  let next = offset;
  let s = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, z0] = points[i]!, [x1, z1] = points[i + 1]!;
    const l = Math.hypot(x1 - x0, z1 - z0);
    while (next <= s + l) {
      const t = (next - s) / l;
      out.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, dx: (x1 - x0) / l, dz: (z1 - z0) / l });
      next += every;
    }
    s += l;
  }
  return out;
}

export const length = (pts: P2[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]), 0);

// ---------- collision ----------

export class Colliders {
  private pile = new Pile<"c">();

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) { this.pile.box("c", x0, y0, z0, x1, y1, z1); }
  obox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry = 0, rx = 0) { this.pile.obox("c", cx, cy, cz, sx, sy, sz, ry, rx); }
  /** A wall along a polyline (a rail, a glass wall), `t` thick. */
  wall(points: P2[], y0: number, y1: number, t = 0.12) {
    for (let i = 0; i + 1 < points.length; i++) {
      const [x0, z0] = points[i]!, [x1, z1] = points[i + 1]!;
      const l = Math.hypot(x1 - x0, z1 - z0);
      if (l < 1e-3) continue;
      this.obox((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, t, y1 - y0, l + t, Math.atan2(x1 - x0, z1 - z0));
    }
  }
  /** A floor: the outline extruded down from its walking surface. */
  floor(points: P2[], y: number, thick = 0.3, holes: P2[][] = []) {
    const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
    for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
    const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2).translate(0, y - thick, 0);
    g.deleteAttribute("uv");
    this.pile.add("c", g);
  }
  /** A ramp under a stair: x from x0 to x1, rising from (zLow, yLow) to (zHigh, yHigh). */
  ramp(x0: number, x1: number, zLow: number, yLow: number, zHigh: number, yHigh: number, thick = 0.3) {
    const dz = zHigh - zLow, dy = yHigh - yLow, l = Math.hypot(dz, dy);
    const ang = Math.atan2(dy, Math.abs(dz)) * (dz < 0 ? 1 : -1);
    _m.compose(
      _p.set((x0 + x1) / 2, (yLow + yHigh) / 2 - (thick / 2) * Math.cos(ang), (zLow + zHigh) / 2 - (thick / 2) * Math.sin(ang)),
      _q.setFromEuler(_e.set(ang, 0, 0)),
      _s.set(Math.abs(x1 - x0), thick, l + 0.1),
    );
    this.pile.add("c", UNIT_BOX, _m);
  }
  add(g: THREE.BufferGeometry, m?: THREE.Matrix4) { this.pile.add("c", g, m); }

  mesh(): THREE.Mesh {
    const geo = this.pile.geometries().get("c") ?? new THREE.BufferGeometry();
    geo.deleteAttribute("normal");
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
    mesh.name = "colliders";
    mesh.updateMatrixWorld(true);
    return mesh;
  }
}

// ---------- the walking graph and slots ----------

export class Plan {
  nodes = new Map<string, Vec3>();
  edges: [string, string][] = [];
  slots: Slot[] = [];
  private pending: { slot: Slot; near?: string }[] = [];

  node(id: string, x: number, y: number, z: number): string {
    if (this.nodes.has(id)) throw new Error(`nav node ${id} twice`);
    this.nodes.set(id, [round(x), round(y), round(z)]);
    return id;
  }
  /** Joins nodes in a chain: a-b, b-c, ... */
  link(...ids: string[]) {
    for (let i = 0; i + 1 < ids.length; i++) {
      const a = ids[i]!, b = ids[i + 1]!;
      if (!this.nodes.has(a) || !this.nodes.has(b)) throw new Error(`nav edge ${a}-${b}: no such node`);
      if (!this.edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a))) this.edges.push([a, b]);
    }
  }
  slot(kind: SlotKind, id: string, pos: Vec3, facing: number, opt: { seat?: number; tags?: string[]; nav?: string } = {}) {
    const slot: Slot = { id, kind, pos: [round(pos[0]), round(pos[1]), round(pos[2])], facing: round(facing, 4), nav: opt.nav ?? "" };
    if (opt.seat !== undefined) slot.seat = round(opt.seat);
    if (opt.tags) slot.tags = opt.tags;
    this.slots.push(slot);
    this.pending.push({ slot, near: opt.nav });
  }
  /** Gives every slot without a nav node the nearest one on its own deck. */
  finish(): WorldLayout {
    const nodes = [...this.nodes.entries()];
    for (const { slot, near } of this.pending) {
      if (near) continue;
      let best = "", bestD = Infinity;
      for (const [id, p] of nodes) {
        const dy = Math.abs(p[1] - slot.pos[1]);
        const d = Math.hypot(p[0] - slot.pos[0], p[2] - slot.pos[2]) + (dy > 1.6 ? 1000 + dy * 10 : dy);
        if (d < bestD) { bestD = d; best = id; }
      }
      slot.nav = best;
    }
    const nav: NavGraph = { nodes: nodes.map(([id, pos]) => ({ id, pos })), edges: this.edges };
    return { slots: this.slots, nav };
  }
}

const round = (v: number, k = 3) => Math.round(v * 10 ** k) / 10 ** k;

/** Yaw (0 faces +z) that looks along (dx, dz). */
export const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);

// ---------- instanced furniture ----------

export interface Prefab<K extends string> {
  name: string;
  parts: Map<K, THREE.BufferGeometry>;
}

/** Builds a prefab in its own frame (standing on y = 0, facing +z). */
export function prefab<K extends string>(name: string, make: (p: Pile<K>) => void): Prefab<K> {
  const p = new Pile<K>();
  make(p);
  return { name, parts: p.geometries() };
}

export class Props<K extends string> {
  private placed = new Map<Prefab<K>, THREE.Matrix4[]>();

  /** Puts a prefab at (x, y, z), turned to face `yaw` (0 faces +z). */
  put(p: Prefab<K>, x: number, y: number, z: number, yaw = 0, scale = 1): this {
    let list = this.placed.get(p);
    if (!list) this.placed.set(p, (list = []));
    list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(scale, scale, scale)));
    return this;
  }
  count(p: Prefab<K>) { return this.placed.get(p)?.length ?? 0; }

  build(mats: Record<K, THREE.Material>, shadows: (k: K) => boolean = () => true): THREE.Group {
    const g = new THREE.Group();
    for (const [p, list] of this.placed) {
      for (const [k, geo] of p.parts) {
        const mesh = new THREE.InstancedMesh(geo, mats[k], list.length);
        list.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.name = `${p.name}:${k}`;
        mesh.castShadow = shadows(k);
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        g.add(mesh);
      }
    }
    return g;
  }
}
