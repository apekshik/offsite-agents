import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { drawAt, type Snap } from "./people.ts";

const snap = (at: number, x: number, v = 3): Snap => ({ at, p: new THREE.Vector3(x, 0, 0), r: 0, v, a: "walk" });

describe("drawing someone between their samples", () => {
  it("draws a little in the past, between the two samples around that moment", () => {
    // 15 a second, walking 3 m/s along x.
    const s = [0, 66, 133, 200, 266].map((at) => snap(at, (at / 1000) * 3));
    const d = drawAt(s, 66, 266)!;
    // 66 ms between samples: drawn ~136 ms back, at x ≈ 0.39.
    expect(d.p.x).toBeCloseTo(((266 - (66 * 1.6 + 30)) / 1000) * 3, 2);
    expect(d.v).toBe(3);
  });

  it("waits longer behind slower samples (the fallback through Convex)", () => {
    const fast = drawAt([0, 66, 133].map((at) => snap(at, at)), 66, 133)!;
    const slow = drawAt([0, 200, 400].map((at) => snap(at, at)), 200, 400)!;
    expect(133 - fast.p.x).toBeLessThan(400 - slow.p.x);
    expect(400 - slow.p.x).toBeLessThanOrEqual(450);
  });

  it("carries them on for a moment when samples stop, then stands them still", () => {
    const s = [snap(0, 0), snap(100, 0.3)];
    const soon = drawAt([...s], 100, 100 + 190 + 100)!;
    expect(soon.p.x).toBeGreaterThan(0.3);
    const later = drawAt([...s], 100, 5000)!;
    expect(later.p.x).toBeCloseTo(0.3 + 0.75, 5);
    expect(later.v).toBe(0);
  });

  it("turns the short way round", () => {
    const s: Snap[] = [{ ...snap(0, 0), r: Math.PI - 0.1 }, { ...snap(100, 0), r: -Math.PI + 0.1 }];
    const d = drawAt(s, 100, 50 + 190)!;
    expect(Math.abs(Math.abs(d.r) - Math.PI)).toBeLessThan(0.11);
  });
});
