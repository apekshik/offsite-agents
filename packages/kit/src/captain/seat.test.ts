import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { Slot } from "@offsite/contracts";
import { captainSeat, standSpot, standSpots } from "./seat.ts";

const slot = (kind: Slot["kind"], facing = 0, pos: Slot["pos"] = [10, 2, 30]): Slot => ({ id: `${kind}-1`, kind, pos, facing, seat: 0.6, nav: "n" });
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe("captain seats", () => {
  it("offers hammocks, loungers and deck chairs, each with the crew's pose there", () => {
    expect(captainSeat(slot("hammock"))).toMatchObject({ act: "hammock-rest", label: "Lie in the hammock", lie: true });
    expect(captainSeat(slot("lounger"))?.act).toBe("sunbathe");
    expect(captainSeat(slot("deck-chair"))).toMatchObject({ act: "sofa", lie: false });
    expect(captainSeat(slot("desk"))).toBeNull();
    expect(captainSeat(slot("helm"))).toBeNull();
  });

  it("gets up out of a hammock beside it, on the side you got in from", () => {
    const seat = captainSeat(slot("hammock"))!;
    // Lying along +z: the sides are ±x.
    const fromOutboard = standSpots(seat, v(11.2, 2, 30.3));
    expect(fromOutboard[0]!.x).toBeCloseTo(10.85);
    expect(fromOutboard[0]!.z).toBeCloseTo(30);
    expect(fromOutboard[1]!.x).toBeCloseTo(9.15);
    const fromInboard = standSpots(seat, v(8.9, 2, 29.5));
    expect(fromInboard[0]!.x).toBeCloseTo(9.15);
    // Never off the ends (the stand's posts), and where you were comes last.
    expect(fromInboard.every((p) => Math.abs(p.z - 30) < 1e-6 || p.equals(v(8.9, 2, 29.5)))).toBe(true);
    expect(fromInboard.at(-1)).toEqual(v(8.9, 2, 29.5));
    expect(fromInboard.every((p) => p.y === 2)).toBe(true);
  });

  it("turns with the seat", () => {
    // Facing +x: the sides are ±z.
    const seat = captainSeat(slot("hammock", Math.PI / 2))!;
    const [first] = standSpots(seat, v(10, 2, 33));
    expect(first!.x).toBeCloseTo(10);
    expect(first!.z).toBeCloseTo(30.85);
  });

  it("stands up in front of a chair first", () => {
    const seat = captainSeat(slot("deck-chair"))!;
    const spots = standSpots(seat, null);
    expect(spots[0]!.x).toBeCloseTo(10);
    expect(spots[0]!.z).toBeCloseTo(30.85);
  });

  it("takes the first clear spot: past a wall on one side, further out past a palm", () => {
    const seat = captainSeat(slot("hammock"))!;
    const from = v(11.2, 2, 30);
    // Glass along x < 9.5, a palm right beside the hammock on the outboard side.
    const clear = (p: THREE.Vector3) => p.x > 9.5 && !(p.x > 10.6 && p.x < 11.0);
    const at = standSpot(seat, from, clear)!;
    expect(at.x).toBeCloseTo(11.1);
    expect(at.z).toBeCloseTo(30);
    // Nowhere clear but where you were.
    expect(standSpot(seat, from, (p) => p.equals(from))).toEqual(from);
    expect(standSpot(seat, null, () => false)).toBeNull();
  });
});
