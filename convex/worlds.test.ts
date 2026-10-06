/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
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

describe("moving a ship to another world", () => {
  /** Alice's OASIS on the yacht: a machine, a repo, a thread, Maya aboard, a hire on the way in, both on deck. */
  async function oasis() {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ tokenIdentifier: "dev|alice", name: "alice" });
    const maya = t.withIdentity({ tokenIdentifier: "dev|maya", name: "maya" });
    await alice.mutation(api.users.ensure, {});
    await maya.mutation(api.users.ensure, {});
    const officeId = await alice.mutation(api.offices.create, { name: "OASIS", world: "yacht" });
    const { deviceCode, userCode } = await t.mutation(internal.machines.startCode, { name: "Mac", hostname: "mac.local" });
    const approved = await alice.mutation(api.machines.approve, { userCode });
    if (!approved.ok) throw new Error(approved.error);
    await t.mutation(internal.machines.pollCode, { deviceCode });
    await alice.mutation(api.repos.add, { officeId, machineId: approved.machineId, path: "~/code/web", defaultBranch: "main" });
    const invite = await alice.mutation(api.invites.create, { officeId });
    await maya.mutation(api.invites.accept, { token: invite.token });
    await alice.mutation(api.threads.create, { officeId, text: "Add a dark mode toggle" });
    const hireId = await alice.mutation(api.crew.hire, { officeId, name: "Ezra" });
    await alice.mutation(api.presence.join, { officeId, peerId: "alicepeer1", pos: [2, 9, 33], facing: 0, act: "walk" });
    await maya.mutation(api.presence.join, { officeId, peerId: "mayapeer01", pos: [3, 9, 33], facing: 0, act: "walk" });
    return { t, alice, maya, officeId, hireId };
  }

  /** Everything that should come along, as the captain reads it. */
  async function everything({ alice, officeId }: Awaited<ReturnType<typeof oasis>>) {
    return {
      crew: await alice.query(api.crew.list, { officeId }),
      threads: (await alice.query(api.threads.list, { officeId })).map((x) => ({ _id: x._id, title: x.title, state: x.state })),
      repos: await alice.query(api.repos.list, { officeId }),
      members: (await alice.query(api.members.list, { officeId })).members,
      machines: (await alice.query(api.machines.mine, {})).map((m) => m._id),
    };
  }

  it("lets the captain move it to the moon, and back, with everything aboard", async () => {
    const p = await oasis();
    const { t, alice, maya, officeId, hireId } = p;
    const before = await everything(p);
    expect(before.crew.length).toBeGreaterThan(1);
    expect(before.threads).toHaveLength(1);
    expect(before.repos).toHaveLength(1);
    expect(before.members).toHaveLength(1);
    expect(before.machines).toHaveLength(1);

    const at = Date.now();
    expect(await alice.mutation(api.offices.relocate, { officeId, world: "moon-base" })).toEqual({ world: "moon-base" });
    const office = await alice.query(api.offices.get, { officeId });
    expect(office.world).toBe("moon-base");
    expect(office.relocatedAt).toBeGreaterThanOrEqual(at);
    expect((await maya.query(api.world.snapshot, { officeId }))?.office.world).toBe("moon-base");
    // The crew, the threads, the repos, the machine and the friends aboard are as they were. Ezra, still on the way
    // in, keeps his time: the moon's lander brings him instead of the helicopter.
    expect(await everything(p)).toEqual(before);
    expect((await alice.query(api.crew.list, { officeId })).find((c) => c._id === hireId)!.arrivesAt).toBeGreaterThan(Date.now());
    // Nobody keeps a position from the yacht.
    expect(await alice.query(api.presence.here, { officeId })).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("presence").collect())).toEqual([]);

    await alice.mutation(api.offices.relocate, { officeId, world: "yacht" });
    expect((await alice.query(api.offices.get, { officeId })).world).toBe("yacht");
    expect(await everything(p)).toEqual(before);
  });

  it("is the captain's alone", async () => {
    const { t, maya, officeId } = await oasis();
    await expect(maya.mutation(api.offices.relocate, { officeId, world: "moon-base" })).rejects.toThrow(/Only the captain/);
    const eve = t.withIdentity({ tokenIdentifier: "dev|eve", name: "eve" });
    await eve.mutation(api.users.ensure, {});
    await expect(eve.mutation(api.offices.relocate, { officeId, world: "moon-base" })).rejects.toThrow(/No such ship/);
    expect((await maya.query(api.offices.get, { officeId })).world).toBe("yacht");
  });

  it("refuses a world that isn't built yet, one that doesn't exist, and the one it's in", async () => {
    const { alice, officeId } = await oasis();
    await expect(alice.mutation(api.offices.relocate, { officeId, world: "airship" })).rejects.toThrow(/No world called "airship"/);
    await expect(alice.mutation(api.offices.relocate, { officeId, world: "atlantis" })).rejects.toThrow(/No world called "atlantis"/);
    await expect(alice.mutation(api.offices.relocate, { officeId, world: "yacht" })).rejects.toThrow(/already there/);
    const office = await alice.query(api.offices.get, { officeId });
    expect(office.world).toBe("yacht");
    expect(office.relocatedAt).toBeUndefined();
    // A refused move leaves everyone where they stand.
    expect(await alice.query(api.presence.here, { officeId })).toHaveLength(2);
  });
});
