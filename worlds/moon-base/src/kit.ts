// The builder's kit, after the yacht's (worlds/yacht/src/kit.ts): everything static lands in one
// pile per material and is merged into a single mesh each; repeated pieces (habs, crates, desks,
// solar panels, path lights) are instanced; what the captain walks on and bumps into is a
// separate, invisible, low-poly collision mesh; and the walking graph and slots are collected as
// the base is built. Polar helpers on top, since a crater is round.

import * as THREE from "three";
import { mergeInto } from "@offsite/kit";
import type { NavGraph, Slot, SlotKind, Vec3, WorldLayout } from "@offsite/contracts";

export type P2 = [number, number]; // (x, z)

// ---------- the crater's compass ----------
// North is -z (the far side of the crater in the masterplan), east is +x. An angle `a` (radians)
// runs clockwise from north, as on a map.

/** The point at angle a (from north, clockwise) and radius r. */
export const polar = (a: number, r: number): P2 => [Math.sin(a) * r, -Math.cos(a) * r];
/** The angle (from north, clockwise) of a point. */
export const angleOf = (x: number, z: number) => Math.atan2(x, -z);
/** Yaw (0 faces +z) that looks in toward the crater's centre from angle a. */
export const inward = (a: number) => -a;
/** Yaw that looks along the ring, the way the angle grows (clockwise from above). */
export const along = (a: number) => Math.PI / 2 - a;
export const deg = (d: number) => (d * Math.PI) / 180;

/**
 * A building's own frame on the map: origin (cx, cz), `out` the map direction at angle a (away
 * from the crater's centre, for one facing the crater), `right` along its front, clockwise round
 * the crater. Local x runs right, local z runs out. (Seen from above with north up, that frame is
 * mirrored, which is why boxes go through `box` and faces through world coordinates.)
 */
export class Frame {
  readonly cx: number;
  readonly cz: number;
  readonly a: number;
  readonly out: P2;
  readonly right: P2;
  constructor(cx: number, cz: number, a: number) {
    this.cx = cx;
    this.cz = cz;
    this.a = a;
    this.out = [Math.sin(a), -Math.cos(a)];
    this.right = [Math.cos(a), Math.sin(a)];
  }
  /** A local point on the map. */
  at(x: number, z: number): P2 {
    return [this.cx + this.right[0] * x + this.out[0] * z, this.cz + this.right[1] * x + this.out[1] * z];
  }
  v(x: number, y: number, z: number): THREE.Vector3 {
    const [wx, wz] = this.at(x, z);
    return new THREE.Vector3(wx, y, wz);
  }
  /** The world yaw (0 faces +z) of a body facing local yaw ly (0 faces local +z, out; π/2 faces right). */
  yaw(ly = 0): number { return Math.PI - (this.a + ly); }
  /** The world yaw of a local direction. */
  dir(lx: number, lz: number): number { return this.yaw(Math.atan2(lx, lz)); }
  /** A box between local corners (y is world height). */
  box<K extends string>(pile: Pile<K>, mat: K, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const [cx, cz] = this.at((x0 + x1) / 2, (z0 + z1) / 2);
    pile.obox(mat, cx, (y0 + y1) / 2, cz, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), -this.a);
  }
  /** The same box as a collider. */
  cbox(col: Colliders, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const [cx, cz] = this.at((x0 + x1) / 2, (z0 + z1) / 2);
    col.obox(cx, (y0 + y1) / 2, cz, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), -this.a);
  }
  /** A local polyline on the map. */
  run(pts: P2[]): P2[] { return pts.map(([x, z]) => this.at(x, z)); }
  /** A geometry made in local coordinates (x right, y up, z out), moved onto the map. */
  geom(g: THREE.BufferGeometry): THREE.BufferGeometry {
    const out = g.index ? g.clone() : g.clone();
    const p = out.attributes.position!;
    for (let i = 0; i < p.count; i++) {
      const [x, z] = this.at(p.getX(i), p.getZ(i));
      p.setXYZ(i, x, p.getY(i), z);
    }
    const n = out.attributes.normal;
    if (n) for (let i = 0; i < n.count; i++) {
      const nx = n.getX(i), nz = n.getZ(i);
      n.setXYZ(i, this.right[0] * nx + this.out[0] * nz, n.getY(i), this.right[1] * nx + this.out[1] * nz);
    }
    // The frame is a mirror image of the map's: every face turns over, so wind them back.
    if (out.index) {
      const I = out.index;
      for (let i = 0; i < I.count; i += 3) { const t = I.getX(i + 1); I.setX(i + 1, I.getX(i + 2)); I.setX(i + 2, t); }
    } else {
      for (let i = 0; i < p.count; i += 3) {
        const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
        p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
        p.setXYZ(i + 2, x, y, z);
        if (n) {
          const a = n.getX(i + 1), b = n.getY(i + 1), c = n.getZ(i + 1);
          n.setXYZ(i + 1, n.getX(i + 2), n.getY(i + 2), n.getZ(i + 2));
          n.setXYZ(i + 2, a, b, c);
        }
      }
    }
    return out;
  }
}

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
  rod(mat: K, a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6, open = true): this {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    if (len < 1e-4) return this;
    _q.setFromUnitVectors(UP, d.divideScalar(len));
    _m.compose(a, _q, _s.set(r, len, r));
    return this.add(mat, unitCylinder(seg, 1, open), _m);
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
      mesh.name = `base:${k}`;
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

/**
 * Winds every triangle of an indexed geometry to face away from `inside(centroid)` (the middle of
 * a dome, the spine of a tunnel), then recomputes its normals.
 */
export function faceOut(g: THREE.BufferGeometry, inside: (c: THREE.Vector3) => THREE.Vector3): THREE.BufferGeometry {
  const p = g.attributes.position!, I = g.index!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
  for (let i = 0; i < I.count; i += 3) {
    a.fromBufferAttribute(p, I.getX(i)); b.fromBufferAttribute(p, I.getX(i + 1)); c.fromBufferAttribute(p, I.getX(i + 2));
    m.copy(a).add(b).add(c).divideScalar(3);
    n.subVectors(b, a).cross(c.clone().sub(a));
    if (n.dot(m.clone().sub(inside(m))) < 0) { const t = I.getX(i + 1); I.setX(i + 1, I.getX(i + 2)); I.setX(i + 2, t); }
  }
  g.computeVertexNormals();
  return g;
}

/** Turns a geometry inside out: reversed winding and normals. */
export function flip(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.index) {
    const idx = g.index;
    for (let i = 0; i < idx.count; i += 3) {
      const b = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, b);
    }
  } else {
    const p = g.attributes.position!;
    for (let i = 0; i < p.count; i += 3) {
      const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
      p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
      p.setXYZ(i + 2, x, y, z);
    }
  }
  const n = g.attributes.normal;
  if (n) for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

/**
 * A vertical band along a polyline from y0 to y1, facing to the right of the direction of travel
 * (from above, with north up and east right), or left with `left`. Closed: back to the start.
 */
export function band(points: P2[], y0: number, y1: number, { closed = false, left = false }: { closed?: boolean; left?: boolean } = {}): THREE.BufferGeometry {
  const pts = closed ? [...points, points[0]!] : points;
  const pos: number[] = [], nor: number[] = [], index: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, z0] = pts[i]!, [x1, z1] = pts[i + 1]!;
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
    // The right of travel in (x, z), looking down with -z up the page: (-dz, dx).
    let nx = -dz / l, nz = dx / l;
    if (left) { nx = -nx; nz = -nz; }
    const b = pos.length / 3;
    pos.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0);
    for (let k = 0; k < 4; k++) nor.push(nx, 0, nz);
    // Wind so the front faces (nx, nz): (b, b+1, b+2) faces the right of travel when y1 > y0.
    const right = (x1 - x0) * nz - (z1 - z0) * nx > 0;
    if (right === y1 > y0) index.push(b, b + 1, b + 2, b, b + 2, b + 3);
    else index.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(index);
  return g;
}

/** Points along a polyline every `every` metres (posts, lights, viewports). */
export function spaced(points: P2[], every: number, offset = every / 2): { x: number; z: number; dx: number; dz: number }[] {
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

/** A circle's (or an arc's) points round (cx, cz), from angle a0 to a1 (map angles, radians). */
export function arc(cx: number, cz: number, r: number, a0: number, a1: number, step = 0.06): P2[] {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / step));
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const [x, z] = polar(a0 + ((a1 - a0) * i) / n, r);
    out.push([cx + x, cz + z]);
  }
  return out;
}

// ---------- collision ----------

export class Colliders {
  private pile = new Pile<"c">();

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) { this.pile.box("c", x0, y0, z0, x1, y1, z1); }
  obox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry = 0, rx = 0) { this.pile.obox("c", cx, cy, cz, sx, sy, sz, ry, rx); }
  cyl(x: number, y0: number, z: number, r: number, h: number, seg = 12) { this.pile.cyl("c", x, y0, z, r, h, seg); }
  /** A wall along a polyline, `t` thick. */
  wall(points: P2[], y0: number, y1: number, t = 0.2) {
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
    g.deleteAttribute("normal");
    this.pile.add("c", g);
  }
  add(g: THREE.BufferGeometry, m?: THREE.Matrix4) {
    const c = g.clone();
    for (const name of Object.keys(c.attributes)) if (name !== "position") c.deleteAttribute(name);
    this.pile.add("c", c, m);
  }

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
  has(id: string) { return this.nodes.has(id); }
  at(id: string): Vec3 {
    const p = this.nodes.get(id);
    if (!p) throw new Error(`no nav node ${id}`);
    return p;
  }
  /** Joins nodes in a chain: a-b, b-c, ... */
  link(...ids: string[]) {
    for (let i = 0; i + 1 < ids.length; i++) {
      const a = ids[i]!, b = ids[i + 1]!;
      if (!this.nodes.has(a) || !this.nodes.has(b)) throw new Error(`nav edge ${a}-${b}: no such node`);
      if (a === b) continue;
      if (!this.edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a))) this.edges.push([a, b]);
    }
  }
  /** Drops an edge (one a later piece found blocked). */
  unlink(a: string, b: string) {
    this.edges = this.edges.filter(([p, q]) => !((p === a && q === b) || (p === b && q === a)));
  }
  /** The nearest node to (x, z) on the floor at height y (within 1.6 m), optionally among ids with a prefix. */
  nearest(x: number, y: number, z: number, prefix = ""): string {
    let best = "", bestD = Infinity;
    for (const [id, p] of this.nodes) {
      if (prefix && !id.startsWith(prefix)) continue;
      if (Math.abs(p[1] - y) > 1.6) continue;
      const d = Math.hypot(p[0] - x, p[2] - z);
      if (d < bestD) { bestD = d; best = id; }
    }
    if (!best) throw new Error(`no nav node near ${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)} ${prefix}`);
    return best;
  }
  slot(kind: SlotKind, id: string, pos: Vec3, facing: number, opt: { seat?: number; tags?: string[]; nav?: string } = {}) {
    if (this.slots.some((s) => s.id === id)) throw new Error(`slot ${id} twice`);
    const slot: Slot = { id, kind, pos: [round(pos[0]), round(pos[1]), round(pos[2])], facing: round(facing, 4), nav: opt.nav ?? "" };
    if (opt.seat !== undefined) slot.seat = round(opt.seat);
    if (opt.tags) slot.tags = opt.tags;
    this.slots.push(slot);
    this.pending.push({ slot, near: opt.nav });
  }
  /** Gives every slot without a nav node the nearest one on its own floor. */
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

export const round = (v: number, k = 3) => Math.round(v * 10 ** k) / 10 ** k;

/** Yaw (0 faces +z) that looks along (dx, dz). */
export const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);

// ---------- instanced pieces ----------

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
  put(p: Prefab<K>, x: number, y: number, z: number, yaw = 0, scale: number | THREE.Vector3 = 1): this {
    let list = this.placed.get(p);
    if (!list) this.placed.set(p, (list = []));
    const s = typeof scale === "number" ? new THREE.Vector3(scale, scale, scale) : scale;
    list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), s));
    return this;
  }
  count(p: Prefab<K>) { return this.placed.get(p)?.length ?? 0; }
  /** Every placement, for the colliders or a test. */
  each(fn: (p: Prefab<K>, m: THREE.Matrix4) => void) { for (const [p, list] of this.placed) for (const m of list) fn(p, m); }

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
