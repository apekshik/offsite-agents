import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { NavGraph, Slot } from "@offsite/contracts";
import { Autopilot, type AutopilotGoal, type PilotStep } from "./autopilot.ts";
import { findRoute } from "../nav/astar.ts";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const angle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));

/** A body that does what the autopilot says: walks its heading at pace × 3.2 m/s, turns to face. */
function run(pilot: Autopilot, o: { pos?: THREE.Vector3; facing?: number; seconds?: number; move?: (t: number) => void; frozen?: boolean } = {}) {
  const pos = o.pos ?? v(0, 0, 0);
  let facing = o.facing ?? 0;
  const dt = 1 / 60;
  let t = 0;
  let last: PilotStep = { status: "walking", heading: null, pace: 0, face: null };
  const log: { t: number; step: PilotStep; pos: THREE.Vector3 }[] = [];
  while (t < (o.seconds ?? 60) && !pilot.done) {
    o.move?.(t);
    last = pilot.step(dt, pos, facing);
    if (last.heading !== null && !o.frozen) {
      pos.x += Math.sin(last.heading) * 3.2 * last.pace * dt;
      pos.z += Math.cos(last.heading) * 3.2 * last.pace * dt;
      facing = last.heading;
    }
    if (last.face !== null) facing += Math.atan2(Math.sin(last.face - facing), Math.cos(last.face - facing)) * Math.min(1, dt * 9);
    log.push({ t, step: last, pos: pos.clone() });
    t += dt;
  }
  return { pos, facing, last, log, t };
}

describe("Autopilot", () => {
  it("walks the route onto a spot and turns the way the spot faces", () => {
    const pilot = new Autopilot({
      target: () => v(6, 0, 4),
      route: (_from, to) => [v(0, 0, 4), to],
      stopShort: 0,
      face: Math.PI,
    });
    const { pos, facing, last } = run(pilot);
    expect(last.status).toBe("arrived");
    expect(pos.distanceTo(v(6, 0, 4))).toBeLessThan(0.15);
    expect(angle(facing, Math.PI)).toBeLessThan(0.07);
    expect(pilot.plans).toBe(1);
  });

  it("follows the corner rather than cutting straight across", () => {
    const pilot = new Autopilot({ target: () => v(6, 0, 4), route: (_f, to) => [v(0, 0, 4), to], face: 0 });
    const { log } = run(pilot);
    // Up the first leg (x stays near 0) until close to the corner.
    const early = log.filter((e) => e.pos.z < 3);
    expect(early.length).toBeGreaterThan(10);
    for (const e of early) expect(Math.abs(e.pos.x)).toBeLessThan(0.05);
  });

  it("stops short of someone and turns to face them", () => {
    const them = v(0, 0, 10);
    const pilot = new Autopilot({ target: () => them, route: (_f, to) => [to], stopShort: 1.2 });
    const { pos, facing, last } = run(pilot, { facing: Math.PI });
    expect(last.status).toBe("arrived");
    const d = Math.hypot(them.x - pos.x, them.z - pos.z);
    expect(d).toBeGreaterThan(1.1);
    expect(d).toBeLessThan(1.3);
    expect(angle(facing, 0)).toBeLessThan(0.07);
  });

  it("slows for the last step in", () => {
    const pilot = new Autopilot({ target: () => v(0, 0, 8), route: (_f, to) => [to] });
    const { log } = run(pilot);
    const walking = log.filter((e) => e.step.status === "walking");
    expect(walking[0]!.step.pace).toBe(1);
    expect(walking[walking.length - 1]!.step.pace).toBeLessThan(0.4);
  });

  it("re-targets someone on the move, re-planning at most every half second", () => {
    const them = v(0, 0, 12);
    const plannedAt: number[] = [];
    let now = 0;
    const pilot = new Autopilot({
      target: () => them,
      route: (_f, to) => { plannedAt.push(now); return [to]; },
      stopShort: 1.2,
    });
    // They stroll off sideways at 1.4 m/s for four seconds, then stop.
    const { pos, last } = run(pilot, { move: (t) => { now = t; if (t < 4) them.x = 1.4 * t; } });
    expect(last.status).toBe("arrived");
    expect(plannedAt.length).toBeGreaterThan(2);
    for (let i = 1; i < plannedAt.length; i++) expect(plannedAt[i]! - plannedAt[i - 1]!).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(Math.hypot(them.x - pos.x, them.z - pos.z)).toBeLessThan(1.3);
  });

  it("doesn't re-plan for someone who barely moves", () => {
    const them = v(0, 0, 10);
    const pilot = new Autopilot({ target: () => them, route: (_f, to) => [to], stopShort: 1.2 });
    run(pilot, { move: (t) => { them.x = Math.sin(t * 3) * 0.2; } });
    expect(pilot.plans).toBe(1);
  });

  it("says when there's no way there", () => {
    const pilot = new Autopilot({ target: () => v(5, 0, 5), route: () => null });
    const { last } = run(pilot);
    expect(last.status).toBe("failed");
    expect(last.reason).toBe("unreachable");
  });

  it("gives up when the target is gone", () => {
    let there = true;
    const pilot = new Autopilot({ target: () => (there ? v(0, 0, 20) : null), route: (_f, to) => [to], stopShort: 1.2 });
    const { last } = run(pilot, { move: (t) => { if (t > 1) there = false; } });
    expect(last.status).toBe("failed");
    expect(last.reason).toBe("gone");
  });

  it("re-plans when held up, then gives up if it stays stuck", () => {
    const pilot = new Autopilot({ target: () => v(0, 0, 20), route: (_f, to) => [to], stopShort: 0 });
    const { last } = run(pilot, { frozen: true });
    expect(last.status).toBe("failed");
    expect(last.reason).toBe("stuck");
    expect(pilot.plans).toBe(3);
  });

  it("held up right beside someone: close enough", () => {
    const pilot = new Autopilot({ target: () => v(0, 0, 2.2), route: (_f, to) => [to], stopShort: 1.2 });
    const { last } = run(pilot, { frozen: true });
    expect(last.status).toBe("arrived");
  });

  it("doesn't count a waypoint on the deck above as reached by standing under it", () => {
    // The route climbs: a stair foot at (0,0,4), the landing above it at (0,3,4.2), then along the upper deck.
    const goal: AutopilotGoal = { target: () => v(0, 3, 9), route: () => [v(0, 0, 4), v(0, 3, 4.2), v(0, 3, 9)] };
    const pilot = new Autopilot(goal);
    const pos = v(0, 0, 0);
    // Walk to under the landing.
    for (let i = 0; i < 200; i++) {
      const s = pilot.step(1 / 60, pos, 0);
      if (s.heading === null) break;
      pos.x += Math.sin(s.heading) * 3.2 * s.pace / 60;
      pos.z += Math.cos(s.heading) * 3.2 * s.pace / 60;
      if (pos.z > 4.2) break;
    }
    // Still heading for the landing: its y is 3 m up.
    expect(pilot.points[0]!.y).toBe(3);
  });
});

describe("findRoute", () => {
  const g: NavGraph = {
    nodes: [
      { id: "a", pos: [0, 0, 0] }, { id: "b", pos: [0, 0, 10] }, { id: "c", pos: [10, 0, 10] },
      { id: "island", pos: [50, 0, 50] },
    ],
    edges: [["a", "b"], ["b", "c"]],
  };
  const helm: Slot = { id: "helm", kind: "helm", pos: [10, 0, 11], facing: Math.PI, nav: "c" };

  it("routes to a slot over the graph, ending on the slot", () => {
    const r = findRoute(g, [0, 0, -1], helm)!;
    expect(r.map((p) => [p.x, p.z])).toEqual([[0, 0], [0, 10], [10, 10], [10, 11]]);
  });

  it("routes to a point", () => {
    const r = findRoute(g, [0, 0, 1], [9, 0, 10])!;
    expect(r[r.length - 1]!.toArray()).toEqual([9, 0, 10]);
  });

  it("is null when the graph doesn't join them, or there's no graph", () => {
    expect(findRoute(g, [0, 0, 0], [50, 0, 51])).toBeNull();
    expect(findRoute({ nodes: [], edges: [] }, [0, 0, 0], helm)).toBeNull();
    expect(findRoute(g, [0, 0, 0], { ...helm, nav: "missing" })).toBeNull();
  });
});
