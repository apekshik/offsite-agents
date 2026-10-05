import { describe, expect, it } from "vitest";
import { LANDING_KEYS, loopSeconds, poseAt, type Key } from "./path.ts";

const dist = (a: number[], b: number[]) => Math.hypot(...a.map((x, i) => x - b[i]!));

describe("the landing camera", () => {
  it("starts on the hero key and passes through every key", () => {
    let t = 0;
    for (const k of LANDING_KEYS) {
      const p = poseAt(t);
      expect(dist(p.pos, k.pos)).toBeLessThan(1e-9);
      expect(dist(p.at, k.at)).toBeLessThan(1e-9);
      expect(p.fov).toBeCloseTo(k.fov, 9);
      t += k.hold;
    }
  });

  it("loops without a seam", () => {
    const T = loopSeconds();
    expect(dist(poseAt(T).pos, poseAt(0).pos)).toBeLessThan(1e-9);
    expect(dist(poseAt(T + 3.2).pos, poseAt(3.2).pos)).toBeLessThan(1e-9);
    expect(dist(poseAt(-1).pos, poseAt(T - 1).pos)).toBeLessThan(1e-9);
  });

  it("moves smoothly: no jumps in position or speed anywhere on the loop", () => {
    const T = loopSeconds(), dt = 1 / 60;
    let worstJump = 0, worstAccel = 0;
    for (let t = 0; t < T; t += dt) {
      const a = poseAt(t - dt).pos, b = poseAt(t).pos, c = poseAt(t + dt).pos;
      worstJump = Math.max(worstJump, dist(a, b));
      // Change in velocity over one frame (m/s per frame): small everywhere, keys included.
      const v1 = b.map((x, i) => (x - a[i]!) / dt), v2 = c.map((x, i) => (x - b[i]!) / dt);
      worstAccel = Math.max(worstAccel, dist(v1, v2));
    }
    // Under ~15 m/s, so a calm drift, and no kinks.
    expect(worstJump / dt).toBeLessThan(15);
    expect(worstAccel).toBeLessThan(0.2);
  });

  it("works for any set of keys", () => {
    const keys: Key[] = [
      { pos: [0, 0, 0], at: [0, 0, 1], fov: 50, hold: 2 },
      { pos: [10, 0, 0], at: [0, 0, 1], fov: 40, hold: 4 },
    ];
    expect(poseAt(1, keys).pos[0]).toBeGreaterThan(0);
    expect(poseAt(1, keys).pos[0]).toBeLessThan(10);
    expect(poseAt(6, keys).pos[0]).toBeCloseTo(0, 9);
  });
});
