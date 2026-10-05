import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LIMITS, type Slot } from "@offsite/contracts";
import { buildLayout, reachable, walkable } from "./layout.ts";

// The base's layout, checked the way the world viewer's nav check does (apps/web/dev/world.ts):
// the walking graph is one piece, every edge can be walked, every slot can be reached and sits
// clear of the colliders, and there are desks enough for a full crew.

const built = buildLayout();
const { layout, collision } = built;
const at = new Map(layout.nav.nodes.map((n) => [n.id, n.pos]));

function component(start: string): Set<string> {
  const adj = new Map<string, string[]>(layout.nav.nodes.map((n) => [n.id, []]));
  for (const [a, b] of layout.nav.edges) { adj.get(a)!.push(b); adj.get(b)!.push(a); }
  const seen = new Set([start]), queue = [start];
  while (queue.length) for (const n of adj.get(queue.shift()!)!) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  return seen;
}

describe("the moon base's layout", () => {
  it("builds in reasonable time", () => {
    console.info(`[moon] layout in ${built.report.ms.toFixed(0)} ms: ${layout.nav.nodes.length} nodes, ${layout.nav.edges.length} edges (${built.report.linked} linked by sight), ${layout.slots.length} slots; dropped ${built.report.dropped.length} nodes`);
    console.info(`[moon] dropped: ${built.report.dropped.join(", ")}`);
    expect(built.report.ms).toBeLessThan(15_000);
  });

  it("has one walking graph that reaches every node", () => {
    const spawn = layout.slots.find((s) => s.kind === "captain-spawn")!;
    const seen = component(spawn.nav);
    const lost = layout.nav.nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
    expect(lost).toEqual([]);
  });

  it("can walk every edge of the graph", () => {
    const blocked = layout.nav.edges.filter(([a, b]) => !walkable(collision, at.get(a)!, at.get(b)!, { margin: 0.12 })).map(([a, b]) => `${a} — ${b}`);
    expect(blocked).toEqual([]);
  });

  it("reaches every slot from its node", () => {
    const bad = layout.slots.filter((s) => !at.has(s.nav) || !reachable(collision, at.get(s.nav)!, s)).map((s) => `${s.id} (${s.nav})`);
    expect(bad).toEqual([]);
  });

  it("keeps every slot clear of the colliders and on a floor", () => {
    const bad: string[] = [];
    const p = new THREE.Vector3();
    for (const s of layout.slots) {
      const f = collision.floorBelow(s.pos[0], s.pos[1] + (s.seat !== undefined ? 0.06 : 0.5), s.pos[2], 1.2);
      if (f === null || Math.abs(f - s.pos[1]) > 0.12) { bad.push(`${s.id}: floor ${f?.toFixed(2)} vs ${s.pos[1]}`); continue; }
      // Seated slots sit in their furniture: check the body above the seat; standing ones from the knees.
      p.set(s.pos[0], f + (s.seat ?? 0), s.pos[2]);
      const push = collision.resolveCapsule(p, 0.22, s.seat !== undefined ? 1.0 : 1.6);
      if (push.length() > 0.04) bad.push(`${s.id}: pushed ${push.length().toFixed(2)} m`);
    }
    expect(bad).toEqual([]);
  });

  it("has a desk for every crew member, and then some", () => {
    const desks = layout.slots.filter((s) => s.kind === "desk");
    expect(desks.length).toBeGreaterThanOrEqual(LIMITS.maxCrew * 2);
    // All of them in the work hall.
    expect(desks.every((d) => d.tags?.includes("work-hall"))).toBe(true);
  });

  it("has what the app needs: the console, Computah, the drop-off, the pad, spawns", () => {
    const kinds = new Set(layout.slots.map((s) => s.kind));
    for (const k of ["helm", "computer", "dropoff", "helipad", "crew-spawn", "captain-spawn"] as const) expect(kinds.has(k)).toBe(true);
    expect(built.interactables.some((i) => i.id === "helm")).toBe(true);
  });

  it("has somewhere to be off duty for a full crew, and only the work hall's seats take work", () => {
    const idle = layout.slots.filter((s) => ["bar-stool", "hammock", "rail", "deck-chair", "gym", "workshop"].includes(s.kind));
    expect(idle.length).toBeGreaterThan(LIMITS.maxCrew * 3);
    // Seats the director could hand out for work (lounger, deck chair, hammock) are in the work hall, or marked leisure.
    const workable = (s: Slot) => ["lounger", "deck-chair", "hammock"].includes(s.kind) && !s.tags?.includes("leisure");
    expect(layout.slots.filter(workable).every((s) => s.tags?.includes("work-hall"))).toBe(true);
  });

  it("gives every slot a unique id and every desk a screen", () => {
    const ids = layout.slots.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const screens = new Set(built.base.screens.map((s) => s.id));
    for (const d of layout.slots.filter((s) => s.kind === "desk")) expect(screens.has(d.id)).toBe(true);
  });
});
