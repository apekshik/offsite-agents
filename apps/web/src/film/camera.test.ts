import { describe, expect, it } from "vitest";
import { damp, dolly, ease, orbit, spline, type Ease, type Vec3 } from "./camera.ts";

const close = (a: Vec3, b: Vec3, d = 1e-6) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i]!, -Math.log10(d)));

describe("ease", () => {
  const kinds: Ease[] = ["linear", "in", "out", "inOut", "gentle"];
  it.each(kinds)("%s starts at 0, ends at 1 and never goes back", (k) => {
    expect(ease(0, k)).toBeCloseTo(0);
    expect(ease(1, k)).toBeCloseTo(1);
    let last = -1;
    for (let i = 0; i <= 200; i++) {
      const v = ease(i / 200, k);
      expect(v).toBeGreaterThanOrEqual(last - 1e-12);
      last = v;
    }
  });

  it("gentle has no jump in speed (no jolt in a dolly)", () => {
    let prev = ease(1 / 1000, "gentle") - ease(0, "gentle");
    for (let i = 1; i < 1000; i++) {
      const step = ease((i + 1) / 1000, "gentle") - ease(i / 1000, "gentle");
      expect(Math.abs(step - prev)).toBeLessThan(2e-5);
      prev = step;
    }
  });
});

describe("spline", () => {
  const pts: Vec3[] = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 5]];
  it("starts and ends on the end points", () => {
    close(spline(pts, 0), pts[0]!);
    close(spline(pts, 1), pts[3]!);
  });
  it("moves at an even speed", () => {
    const steps: number[] = [];
    let prev = spline(pts, 0);
    for (let i = 1; i <= 120; i++) {
      const p = spline(pts, i / 120);
      steps.push(Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]));
      prev = p;
    }
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    for (const s of steps) expect(Math.abs(s - mean) / mean).toBeLessThan(0.15);
  });
});

describe("moves", () => {
  it("a dolly goes from its first pose to its last", () => {
    const a = { pos: [0, 5, 0] as Vec3, at: [0, 0, 10] as Vec3, fov: 40 }, b = { pos: [10, 5, 0] as Vec3, at: [10, 0, 10] as Vec3, fov: 60 };
    expect(dolly([a, b], 0)).toEqual({ pos: a.pos, at: a.at, fov: 40 });
    const end = dolly([a, b], 1);
    close(end.pos, b.pos);
    expect(end.fov).toBeCloseTo(60);
  });

  it("an orbit keeps its radius and height", () => {
    for (const u of [0, 0.3, 1]) {
      const p = orbit([1, 2, 3], { from: 0, to: 90, radius: 5, height: 2 }, u);
      expect(Math.hypot(p.pos[0] - 1, p.pos[2] - 3)).toBeCloseTo(5);
      expect(p.pos[1]).toBeCloseTo(4);
      expect(p.at).toEqual([1, 2, 3]);
    }
  });

  it("damping closes half the gap in one half-life, whatever the frame rate", () => {
    let a: Vec3 = [0, 0, 0];
    for (let i = 0; i < 60; i++) a = damp(a, [10, 0, 0], 1, 1 / 60);
    let b: Vec3 = [0, 0, 0];
    for (let i = 0; i < 30; i++) b = damp(b, [10, 0, 0], 1, 1 / 30);
    expect(a[0]).toBeCloseTo(5, 6);
    expect(b[0]).toBeCloseTo(5, 6);
  });
});
