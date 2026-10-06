/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");

describe("the worlds a ship can be made in", () => {
  it("makes a ship on the moon base, as on the yacht", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ tokenIdentifier: "dev|alice", name: "alice" });
    await alice.mutation(api.users.ensure, {});
    const officeId = await alice.mutation(api.offices.create, { name: "Tranquility", world: "moon-base" });
    const snap = await alice.query(api.world.snapshot, { officeId });
    expect(snap?.office.world).toBe("moon-base");
    expect(snap?.crew.some((c) => c.role === "computer")).toBe(true);
  });

  it("refuses a world that isn't built yet", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ tokenIdentifier: "dev|alice", name: "alice" });
    await alice.mutation(api.users.ensure, {});
    await expect(alice.mutation(api.offices.create, { name: "Zeppelin", world: "airship" })).rejects.toThrow(/No world called/);
  });
});
