import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { COMPUTER_NAME } from "@offsite/contracts";
import { fail, requireOffice, requireUser } from "./lib";
import { hire } from "./crewlib";
import { harness } from "./schema";

/** Your ships, newest first. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx).catch(() => null);
    if (!user) return [];
    const offices = await ctx.db.query("offices").withIndex("by_owner", (q) => q.eq("ownerId", user._id)).collect();
    return offices.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const get = query({
  args: { officeId: v.id("offices") },
  handler: async (ctx, { officeId }) => {
    const { office } = await requireOffice(ctx, officeId);
    const machine = office.repo ? await ctx.db.get(office.repo.machineId) : null;
    return { ...office, machine: machine ? { _id: machine._id, name: machine.name, lastSeenAt: machine.lastSeenAt } : null };
  },
});

const WORLDS = ["yacht"];

/** A new ship: the computer at the helm and a starting crew already aboard. */
export const create = mutation({
  args: { name: v.string(), world: v.string(), defaultHarness: v.optional(harness) },
  handler: async (ctx, { name, world, defaultHarness }) => {
    const user = await requireUser(ctx);
    const clean = name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);
    if (!clean) fail("Name your ship");
    if (!WORLDS.includes(world)) fail(`No world called "${world}"`);
    const now = Date.now();
    const officeId = await ctx.db.insert("offices", {
      ownerId: user._id,
      name: clean,
      world,
      repo: null,
      setupCommand: null,
      defaultHarness: defaultHarness ?? "claude",
      createdAt: now,
    });
    await ctx.db.insert("crew", {
      officeId,
      role: "computer",
      name: COMPUTER_NAME,
      handle: "computer",
      avatar: null,
      look: null,
      specialty: null,
      harness: defaultHarness ?? "claude",
      model: null,
      effort: "high",
      profile: null,
      hiredAt: now,
      arrivesAt: now,
      dismissedAt: null,
    });
    const office = (await ctx.db.get(officeId))!;
    for (let i = 0; i < 3; i++) await hire(ctx, office, { aboard: true });
    return officeId;
  },
});

/** Which project the crew works on: a git checkout on one of your machines. */
export const setRepo = mutation({
  args: { officeId: v.id("offices"), machineId: v.id("machines"), path: v.string(), defaultBranch: v.string() },
  handler: async (ctx, { officeId, machineId, path, defaultBranch }) => {
    const { user } = await requireOffice(ctx, officeId);
    const machine = await ctx.db.get(machineId);
    if (!machine || machine.ownerId !== user._id || machine.revokedAt) fail("That machine is not yours");
    const p = path.trim();
    if (!p.startsWith("/") && !p.startsWith("~") && !/^[a-z]:[\\/]/i.test(p)) fail("Give the project's full path on that machine, e.g. ~/code/my-app");
    const branch = defaultBranch.trim() || "main";
    if (!/^[\w./-]{1,100}$/.test(branch)) fail("That branch name looks wrong");
    await ctx.db.patch(officeId, { repo: { machineId, path: p, defaultBranch: branch } });
  },
});

export const update = mutation({
  args: {
    officeId: v.id("offices"),
    name: v.optional(v.string()),
    setupCommand: v.optional(v.union(v.string(), v.null())),
    defaultHarness: v.optional(harness),
  },
  handler: async (ctx, { officeId, name, setupCommand, defaultHarness }) => {
    await requireOffice(ctx, officeId);
    const patch: Record<string, unknown> = {};
    if (name !== undefined) {
      const clean = name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);
      if (!clean) fail("Name your ship");
      patch["name"] = clean;
    }
    if (setupCommand !== undefined) patch["setupCommand"] = setupCommand?.trim().slice(0, 300) || null;
    if (defaultHarness !== undefined) patch["defaultHarness"] = defaultHarness;
    await ctx.db.patch(officeId, patch);
  },
});
