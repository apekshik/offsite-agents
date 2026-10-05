import { describe, expect, it } from "vitest";
import { DEFAULT_SURFACE, MAX_PACKAGES, packageSpots } from "./dropoff.ts";

const slot = { pos: [-3.65, 10, -24] as [number, number, number], facing: 0 };
const ids = (n: number) => Array.from({ length: n }, (_, i) => `task${i}`);

describe("packageSpots", () => {
  it("lines packages up on the surface in front of the drop-off, newest in the middle", () => {
    const { spots, more } = packageSpots(slot, ids(3));
    expect(more).toBeNull();
    expect(spots).toHaveLength(3);
    for (const s of spots) {
      expect(s.z).toBeCloseTo(-24 + DEFAULT_SURFACE.forward); // facing 0 is +z: in front of where they stand
      expect(s.y).toBeGreaterThan(10 + DEFAULT_SURFACE.height);
    }
    expect(spots[0]!.x).toBeCloseTo(-3.65);
    expect(spots[1]!.x).toBeGreaterThan(-3.65);
    expect(spots[2]!.x).toBeLessThan(-3.65);
    // All within the surface's length.
    for (const s of spots) expect(Math.abs(s.x + 3.65)).toBeLessThan(DEFAULT_SURFACE.width / 2);
  });

  it("caps the line and puts a +N past the end", () => {
    const { spots, more } = packageSpots(slot, ids(MAX_PACKAGES + 3));
    expect(spots).toHaveLength(MAX_PACKAGES);
    expect(more).not.toBeNull();
    expect(Math.abs(more!.x + 3.65)).toBeGreaterThan(Math.max(...spots.map((s) => Math.abs(s.x + 3.65))));
  });

  it("follows the slot's facing", () => {
    const { spots } = packageSpots({ pos: [0, 0, 0], facing: Math.PI / 2 }, ids(1));
    expect(spots[0]!.x).toBeCloseTo(DEFAULT_SURFACE.forward); // facing +x
    expect(spots[0]!.z).toBeCloseTo(0);
  });
});
