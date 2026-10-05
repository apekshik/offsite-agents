// The base's layout, built without a browser: every piece's geometry in its piles, the colliders,
// the walking graph and the slots. The graph is finished here against the colliders: nodes that
// landed inside something are dropped, nodes in the same open space are linked wherever a body
// can walk straight between them, and each slot gets the nearest node it can be walked to from.

import * as THREE from "three";
import { Collision, type Interactable } from "@offsite/kit";
import type { Slot, Vec3, WorldLayout } from "@offsite/contracts";
import { newBase, type Base } from "./parts.ts";
import { buildCrater } from "./crater.ts";
import { buildTerraces } from "./terraces.ts";
import { buildHub, hubSlots } from "./hub.ts";
import { buildWorkHall } from "./workhall.ts";
import { buildQuarters } from "./quarters.ts";
import { buildGarage } from "./garage.ts";
import { buildGreenhouse } from "./greenhouse.ts";
import { buildSports } from "./sports.ts";
import { buildLookout } from "./lookout.ts";
import { buildRig } from "./rig.ts";
import { buildFloor, buildPads, buildViewpoints } from "./floor.ts";

export interface MoonLayout {
  base: Base;
  layout: WorldLayout;
  colliders: THREE.Mesh;
  collision: Collision;
  interactables: Interactable[];
  /** What finishing the graph found: nodes dropped, links made. */
  report: { dropped: string[]; linked: number; ms: number };
}

const RADIUS = 0.3;

/** Whether a body can walk straight from a to b: floor all the way, no step too tall, nothing in the way. */
export function walkable(col: Collision, a: Vec3, b: Vec3, o: { margin?: number; stopShort?: number } = {}): boolean {
  const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz);
  const stop = o.stopShort ?? 0;
  const n = Math.max(1, Math.ceil((len - stop) / 0.5));
  const ux = len > 1e-6 ? dx / len : 0, uz = len > 1e-6 ? dz / len : 0;
  const side = o.margin ?? RADIUS * 0.9;
  let prev = a[1];
  const flat = Math.abs(a[1] - b[1]) < 0.05;
  const p0 = new THREE.Vector3(), dir = new THREE.Vector3();
  let allFlat = true;
  for (let i = 1; i <= n; i++) {
    const s = Math.min(len - stop, (i / n) * (len - stop)) / Math.max(len, 1e-6);
    const x = a[0] + dx * s, z = a[2] + dz * s, y = a[1] + (b[1] - a[1]) * s;
    const f = col.floorBelow(x, y + 0.9, z, 1.9);
    if (f === null || Math.abs(f - y) > 0.6 || Math.abs(f - prev) > 0.45) return false;
    if (Math.abs(f - a[1]) > 0.05) allFlat = false;
    if (!flat || !allFlat) {
      // Sloped: check each short stretch.
      for (const h of [0.55, 1.5]) {
        p0.set(x - ux * (len / n), prev + h, z - uz * (len / n));
        dir.set(ux * (len / n), f - prev, uz * (len / n));
        const l = dir.length();
        if (col.raycast(p0, dir.normalize(), l)) return false;
      }
    }
    prev = f;
  }
  if (flat && allFlat) {
    // Flat: a few long rays, down the middle and either side at knee height, and at the head.
    const reach = len - stop;
    if (reach < 1e-3) return true;
    dir.set(ux, 0, uz);
    for (const [off, h] of [[0, 0.55], [side, 0.55], [-side, 0.55], [0, 1.5]] as const) {
      p0.set(a[0] - uz * off, a[1] + h, a[2] + ux * off);
      if (col.raycast(p0, dir, reach)) return false;
    }
  }
  return true;
}

export function buildLayout(): MoonLayout {
  const t0 = performance.now();
  const s = newBase();
  buildCrater(s);
  buildTerraces(s);
  const interactables = buildHub(s);
  buildWorkHall(s);
  buildQuarters(s);
  buildGarage(s);
  buildGreenhouse(s);
  buildSports(s);
  buildLookout(s);
  buildPads(s);
  buildRig(s);
  buildFloor(s);
  buildViewpoints(s);
  hubSlots(s);

  const colliders = s.col.mesh();
  const col = new Collision().add(colliders).build();
  const plan = s.plan;

  // Drop nodes that landed on something (or off any floor).
  const dropped: string[] = [];
  const pos = new THREE.Vector3();
  for (const [id, p] of [...plan.nodes]) {
    const f = col.floorBelow(p[0], p[1] + 0.5, p[2], 1.1);
    pos.set(p[0], f ?? p[1], p[2]);
    const push = f === null ? null : col.resolveCapsule(pos, RADIUS - 0.05, 1.7);
    if (f === null || Math.abs(f - p[1]) > 0.3 || (push && push.length() > 0.05)) {
      dropped.push(id);
      plan.nodes.delete(id);
    }
  }
  plan.edges = plan.edges.filter(([a, b]) => plan.nodes.has(a) && plan.nodes.has(b));

  // Link nodes in each open space wherever they can see each other on foot, and any two close
  // nodes anywhere (a porch's node and the road in front of it).
  const has = (a: string, b: string) => edgeSet.has(a < b ? `${a}|${b}` : `${b}|${a}`);
  const edgeSet = new Set(plan.edges.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)));
  let linked = 0;
  const tryLink = (a: string, b: string, reach: number) => {
    if (a === b || has(a, b)) return;
    const p = plan.nodes.get(a), q = plan.nodes.get(b);
    if (!p || !q) return;
    if (Math.hypot(p[0] - q[0], p[2] - q[2]) > reach || Math.abs(p[1] - q[1]) > reach * 0.25 + 0.5) return;
    if (!walkable(col, p, q)) return;
    plan.link(a, b);
    edgeSet.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    linked++;
  };
  for (const g of s.open) {
    const ids = g.ids.filter((id) => plan.nodes.has(id));
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) tryLink(ids[i]!, ids[j]!, g.reach);
  }
  const all = [...plan.nodes.keys()];
  const cell = 7, grid = new Map<string, string[]>();
  for (const id of all) {
    const p = plan.nodes.get(id)!;
    const k = `${Math.floor(p[0] / cell)},${Math.floor(p[2] / cell)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(id);
  }
  for (const id of all) {
    const p = plan.nodes.get(id)!;
    const cx = Math.floor(p[0] / cell), cz = Math.floor(p[2] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const other of grid.get(`${cx + dx},${cz + dz}`) ?? []) if (other > id) tryLink(id, other, 6.5);
    }
  }

  // Each slot without a node of its own gets the nearest it can be walked to from.
  const layout = plan.finish();
  for (const slot of layout.slots) {
    if (slot.nav && plan.nodes.has(slot.nav) && reachable(col, plan.nodes.get(slot.nav)!, slot)) continue;
    const near = [...plan.nodes.entries()]
      .filter(([, p]) => Math.abs(p[1] - slot.pos[1]) < 1.6)
      .map(([id, p]) => ({ id, p, d: Math.hypot(p[0] - slot.pos[0], p[2] - slot.pos[2]) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 12);
    const ok = near.find((n) => reachable(col, n.p, slot));
    slot.nav = (ok ?? near[0])?.id ?? slot.nav;
  }
  return { base: s, layout, colliders, collision: col, interactables, report: { dropped, linked, ms: performance.now() - t0 } };
}

/** Whether a body can walk from a node to a slot (the last half metre is into its seat, which may be in the furniture). */
export function reachable(col: Collision, from: Vec3, slot: Slot): boolean {
  return walkable(col, from, slot.pos, { stopShort: 0.55, margin: 0.18 });
}
