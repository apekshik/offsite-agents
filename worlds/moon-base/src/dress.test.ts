import { describe, expect, it } from "vitest";
import { DEFAULT_AVATAR } from "@offsite/contracts";
import { buildLayout } from "./layout.ts";
import { dress, indoors } from "./dress.ts";

const { layout } = buildLayout();
const slot = (id: string) => layout.slots.find((s) => s.id === id)!;

describe("what crew wear on the moon base", () => {
  it("knows indoors from out", () => {
    for (const id of ["desk-01", "desk-22", "cafe-stool-1", "helm", "sling-1", "garage-1a", "greenhouse-2", "court-3", "lookout-chair-1"]) expect([id, indoors(slot(id).pos)]).toEqual([id, true]);
    for (const id of ["crew-spawn-1", "rig-desk-w", "pit-ice-1", "landing-pad"]) expect([id, indoors(slot(id).pos)]).toEqual([id, false]);
  });

  it("puts them in coveralls indoors and a suit outdoors, keeping their own head indoors", () => {
    const look = { meta: { base: { hair: "long" as const } }, pieces: [
      { bone: "head" as const, shape: "box" as const, pos: [0, 0, 0] as [number, number, number], size: [0.1, 0.1, 0.1] as [number, number, number], color: "#ff0000" },
      { bone: "chest" as const, shape: "box" as const, pos: [0, 0, 0] as [number, number, number], size: [0.1, 0.1, 0.1] as [number, number, number], color: "#00ff00" },
    ] };
    const inside = dress(DEFAULT_AVATAR, look, slot("desk-01").pos);
    expect(inside.outfit).toBe("coveralls");
    expect(inside.look!.pieces.some((p) => p.color === "#ff0000")).toBe(true);
    expect(inside.look!.pieces.some((p) => p.color === "#00ff00")).toBe(false);
    const outside = dress(DEFAULT_AVATAR, null, slot("crew-spawn-1").pos);
    expect(outside.outfit).toBe("suit");
    expect(outside.spec.outfit).toBe("astronaut");
  });
});
