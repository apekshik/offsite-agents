// Paths over a world's walking graph (contracts world.ts NavGraph): nodes, and undirected edges
// between nodes that can see each other on foot. A* with straight-line distance; graphs are a
// few hundred nodes at most, so a sorted open list is plenty.

import * as THREE from "three";
import type { NavGraph, NavNode, Slot, Vec3 } from "@offsite/contracts";

type P3 = Vec3 | THREE.Vector3;
const xyz = (p: P3): [number, number, number] => (Array.isArray(p) ? p : [p.x, p.y, p.z]);
const v3 = (p: P3) => new THREE.Vector3(...xyz(p));

interface Index { byId: Map<string, NavNode>; next: Map<string, { id: string; cost: number }[]> }
const indexes = new WeakMap<NavGraph, Index>();

// Built once per graph object (worlds hand over a graph and leave it alone).
function index(g: NavGraph): Index {
  let ix = indexes.get(g);
  if (ix) return ix;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const next = new Map<string, { id: string; cost: number }[]>();
  for (const n of g.nodes) next.set(n.id, []);
  for (const [a, b] of g.edges) {
    const na = byId.get(a), nb = byId.get(b);
    if (!na || !nb) continue;
    const cost = dist(na.pos, nb.pos);
    next.get(a)!.push({ id: b, cost });
    next.get(b)!.push({ id: a, cost });
  }
  ix = { byId, next };
  indexes.set(g, ix);
  return ix;
}

function dist(a: P3, b: P3) {
  const [ax, ay, az] = xyz(a), [bx, by, bz] = xyz(b);
  return Math.hypot(ax - bx, ay - by, az - bz);
}

/** The node nearest p. Height counts triple, so someone on a deck never picks a node on the deck below. */
export function nearestNode(g: NavGraph, p: P3): NavNode | null {
  const [x, y, z] = xyz(p);
  let best: NavNode | null = null, bestD = Infinity;
  for (const n of g.nodes) {
    const d = (n.pos[0] - x) ** 2 + (n.pos[2] - z) ** 2 + (3 * (n.pos[1] - y)) ** 2;
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

/** Node ids from `from` to `to`, both included; null when they aren't connected. */
export function findPath(g: NavGraph, from: string, to: string): string[] | null {
  const { byId, next } = index(g);
  const goal = byId.get(to);
  if (!byId.has(from) || !goal) return null;
  if (from === to) return [from];
  const gScore = new Map<string, number>([[from, 0]]);
  const came = new Map<string, string>();
  const open: { id: string; f: number }[] = [{ id: from, f: dist(byId.get(from)!.pos, goal.pos) }];
  const closed = new Set<string>();
  while (open.length) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift()!.id;
    if (cur === to) {
      const path = [cur];
      for (let c = cur; came.has(c);) { c = came.get(c)!; path.push(c); }
      return path.reverse();
    }
    if (closed.has(cur)) continue;
    closed.add(cur);
    for (const { id, cost } of next.get(cur) ?? []) {
      if (closed.has(id)) continue;
      const g2 = gScore.get(cur)! + cost;
      if (g2 < (gScore.get(id) ?? Infinity)) {
        gScore.set(id, g2);
        came.set(id, cur);
        open.push({ id, f: g2 + dist(byId.get(id)!.pos, goal.pos) });
      }
    }
  }
  return null;
}

// Waypoints from p along the graph from its nearest node to goalNode. Skips the first node when p
// is already partway along the first edge, so nobody doubles back to a node behind them.
function along(g: NavGraph, p: P3, goalNode: string): THREE.Vector3[] {
  const { byId } = index(g);
  const start = nearestNode(g, p);
  if (!start) return [];
  const ids = findPath(g, start.id, goalNode) ?? [start.id];
  const pts = ids.map((id) => v3(byId.get(id)!.pos));
  const here = v3(p);
  if (pts.length >= 2) {
    const a = pts[0]!, b = pts[1]!, ab = b.clone().sub(a), t = here.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq());
    const off = a.clone().addScaledVector(ab, Math.min(1, Math.max(0, t))).distanceTo(here);
    if (t > 0 && t < 1 && off < 1.2) pts.shift();
  }
  if (pts.length && pts[0]!.distanceTo(here) < 0.15) pts.shift();
  return pts;
}

/** Waypoints from `from` to a slot: the nearest node, the graph to the slot's node, then the slot itself. */
export function routeTo(g: NavGraph, from: P3, to: Slot): THREE.Vector3[] {
  const pts = along(g, from, to.nav);
  pts.push(v3(to.pos));
  return pts;
}

/** Waypoints from `from` to any point: along the graph to the node nearest it, then straight there. */
export function routeToPoint(g: NavGraph, from: P3, to: P3): THREE.Vector3[] {
  const goal = nearestNode(g, to);
  const pts = goal ? along(g, from, goal.id) : [];
  // Close enough to walk straight there: skip the graph.
  if (goal && dist(from, to) < dist(from, goal.pos) && Math.abs(xyz(from)[1] - xyz(to)[1]) < 0.3) pts.length = 0;
  pts.push(v3(to));
  return pts;
}

/** Length of a route, metres. */
export function routeLength(from: P3, pts: THREE.Vector3[]) {
  let d = 0, prev = v3(from);
  for (const p of pts) { d += prev.distanceTo(p); prev = p; }
  return d;
}
