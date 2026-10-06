import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { COMPUTER_HANDLE, COMPUTER_NAME } from "@offsite/contracts";
import { fail, requireAboard, requireOffice, requireUser } from "./lib";
import { ARRIVES_BY, crewOf, hire } from "./crewlib";

/** How many crew a new ship starts with. */
export const STARTING_CREW = 7;
import { harness } from "./schema";
import { checkBranch, checkPath, cleanSetup, computerMachine, ensureRepos, reposOf } from "./repolib";
import { addRepo } from "./repos";

/** Your ships, newest first, with how many repos each has. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx).catch(() => null);
    if (!user) return [];
    const offices = await ctx.db.query("offices").withIndex("by_owner", (q) => q.eq("ownerId", user._id)).collect();
    const out = await Promise.all(offices.map(async (o) => ({ ...o, repoCount: (await reposOf(ctx, o)).length })));
    return out.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** A ship, for anyone aboard. `role` is yours on it: "owner" (the captain) or "member" (a friend aboard). */
export const get = query({
  args: { officeId: v.id("offices") },
  handler: async (ctx, { officeId }) => {
    const { office, role } = await requireAboard(ctx, officeId);
    const { repo: _legacyRepo, setupCommand: _legacySetup, ...rest } = office;
    const repos = await reposOf(ctx, office);
    const at = computerMachine(repos);
    const machine = at ? await ctx.db.get(at) : null;
    const owner = await ctx.db.get(office.ownerId);
    return {
      ...rest,
      role,
      /** The captain: whose machines and subscriptions the crew run on. */
      owner: { _id: office.ownerId, name: owner?.name ?? "Captain" },
      /** Friends aboard may start threads and talk to Computah. */
      membersCanAsk: office.membersCanAsk !== false,
      // Where each repo sits on the captain's machine is the captain's to see: friends get the names.
      repos: repos.map((r) => ({ _id: r._id, name: r.name, machineId: r.machineId, path: role === "owner" ? r.path : "", defaultBranch: r.defaultBranch, setupCommand: role === "owner" ? r.setupCommand : null })),
      /** The machine Computah works on: the one holding the first repo. */
      machine: machine ? { _id: machine._id, name: machine.name, lastSeenAt: machine.lastSeenAt } : null,
    };
  },
});

/** The worlds a ship can be made in (apps/web/src/worlds.ts lists them for the picker). */
const WORLDS = Object.keys(ARRIVES_BY);

/** A new ship: Computah at the helm and a starting crew already aboard. */
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
      defaultHarness: defaultHarness ?? "claude",
      createdAt: now,
    });
    await ctx.db.insert("crew", {
      officeId,
      role: "computer",
      name: COMPUTER_NAME,
      handle: COMPUTER_HANDLE,
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
    await ctx.db.patch(user._id, { aboardId: officeId });
    const office = (await ctx.db.get(officeId))!;
    // A full first crew, so the deck is lively from the start: seven aboard, all free.
    for (let i = 0; i < STARTING_CREW; i++) await hire(ctx, office, { aboard: true });
    return officeId;
  },
});

/**
 * From before repos (repos.add is the way now): the repo on that path, added, or updated when the ship already has
 * it (on any machine).
 */
export const setRepo = mutation({
  args: { officeId: v.id("offices"), machineId: v.id("machines"), path: v.string(), defaultBranch: v.string() },
  handler: async (ctx, { officeId, machineId, path, defaultBranch }) => {
    const { user, office } = await requireOffice(ctx, officeId);
    const p = checkPath(path);
    const repos = await ensureRepos(ctx, office);
    const same = repos.find((r) => r.path === p);
    if (!same) return addRepo(ctx, user, office, { machineId, path: p, defaultBranch });
    const machine = await ctx.db.get(machineId);
    if (!machine || machine.ownerId !== user._id || machine.revokedAt) fail("That machine is not yours");
    await ctx.db.patch(same._id, { machineId, defaultBranch: checkBranch(defaultBranch) });
    return same._id;
  },
});

export const update = mutation({
  args: {
    officeId: v.id("offices"),
    name: v.optional(v.string()),
    setupCommand: v.optional(v.union(v.string(), v.null())),
    defaultHarness: v.optional(harness),
    /** Friends aboard may start threads and talk to Computah (on by default). */
    membersCanAsk: v.optional(v.boolean()),
  },
  handler: async (ctx, { officeId, name, setupCommand, defaultHarness, membersCanAsk }) => {
    await requireOffice(ctx, officeId);
    const patch: Record<string, unknown> = {};
    if (name !== undefined) {
      const clean = name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);
      if (!clean) fail("Name your ship");
      patch["name"] = clean;
    }
    if (setupCommand !== undefined) {
      // From before repos: the setup command of the first repo (repos.update sets any repo's).
      const [first] = await ensureRepos(ctx, (await ctx.db.get(officeId))!);
      if (first) await ctx.db.patch(first._id, { setupCommand: cleanSetup(setupCommand) });
    }
    if (defaultHarness !== undefined) patch["defaultHarness"] = defaultHarness;
    if (membersCanAsk !== undefined) patch["membersCanAsk"] = membersCanAsk;
    await ctx.db.patch(officeId, patch);
  },
});

/**
 * Move the ship to another world. Everything comes along (crew, threads, repos, machines, friends aboard, history):
 * only `world` changes, and `relocatedAt` says when, so everyone aboard sees the arrival. Nothing else stored means a
 * place in a world: where crew sit is the app's to decide each time it builds one, and the words for a world (how
 * crew arrive) are read from `world` when they're said. Crew still on their way keep their time and come in by the new
 * world's vehicle. Crew at work keep working (runs are on the captain's machine); they take desks in the new world.
 */
export const relocate = mutation({
  args: { officeId: v.id("offices"), world: v.string() },
  handler: async (ctx, { officeId, world }) => {
    const { office } = await requireOffice(ctx, officeId);
    if (!WORLDS.includes(world)) fail(`No world called "${world}" to move to`);
    if (office.world === world) fail(`${office.name} is already there`);
    await ctx.db.patch(officeId, { world, relocatedAt: Date.now() });
    // Positions on deck were in the old world: drop them, so nobody is drawn inside a wall of the new one. Each tab
    // rebuilds the world and comes back on deck at its spawn (apps/web/src/net).
    const onDeck = await ctx.db.query("presence").withIndex("by_office", (q) => q.eq("officeId", officeId)).collect();
    for (const p of onDeck) await ctx.db.delete(p._id);
    return { world };
  },
});

/**
 * Bring a ship that started smaller up to `to` crew (STARTING_CREW by default). The newcomers fly in by helicopter like
 * any hire. Run from the CLI: npx convex run offices:topUpCrew '{"officeId":"…"}'.
 */
export const topUpCrew = internalMutation({
  args: { officeId: v.id("offices"), to: v.optional(v.number()) },
  handler: async (ctx, { officeId, to }) => {
    const office = await ctx.db.get(officeId);
    if (!office) fail("No such ship.");
    const have = (await crewOf(ctx, officeId)).filter((c) => c.role === "crew").length;
    const added: string[] = [];
    for (let i = have; i < (to ?? STARTING_CREW); i++) added.push((await hire(ctx, office!, {})).name);
    return { had: have, added };
  },
});
