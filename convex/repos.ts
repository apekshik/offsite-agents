import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { fail, requireAboard, requireOffice } from "./lib";
import { checkBranch, checkName, checkPath, cleanSetup, ensureRepos, freshName, MAX_REPOS, migrateOffice, repoOfTask, reposOf } from "./repolib";

// The projects a ship's crew works on: git checkouts on your machines, any number of them. Each task is in one repo;
// a thread's work lands on one branch name in every repo it touches.

/** This ship's repos, oldest first (the first is where the computer works), with their machine. */
export const list = query({
  args: { officeId: v.id("offices") },
  handler: async (ctx, { officeId }) => {
    const { office, role } = await requireAboard(ctx, officeId);
    const repos = await reposOf(ctx, office);
    return Promise.all(repos.map(async (r) => {
      const m = await ctx.db.get(r.machineId);
      // A friend aboard sees the names, not where they sit on the captain's machine.
      return { ...r, ...(role === "owner" ? {} : { path: "", setupCommand: null }), machine: m ? { _id: m._id, name: m.name, lastSeenAt: m.lastSeenAt } : null };
    }));
  },
});

async function ownMachine(ctx: MutationCtx, user: Doc<"users">, machineId: Id<"machines">) {
  const machine = await ctx.db.get(machineId);
  if (!machine || machine.ownerId !== user._id || machine.revokedAt) fail("That machine is not yours");
}

/** Add a repo. Shared with offices.setRepo. */
export async function addRepo(
  ctx: MutationCtx,
  user: Doc<"users">,
  office: Doc<"offices">,
  a: { machineId: Id<"machines">; path: string; name?: string | undefined; defaultBranch: string; setupCommand?: string | null | undefined },
): Promise<Id<"repos">> {
  await ownMachine(ctx, user, a.machineId);
  const repos = await ensureRepos(ctx, office);
  if (repos.length >= MAX_REPOS) fail(`A ship holds at most ${MAX_REPOS} repos`);
  const path = checkPath(a.path);
  const same = repos.find((r) => r.machineId === a.machineId && r.path === path);
  if (same) fail(`That folder is already on this ship, as "${same.name}"`);
  return ctx.db.insert("repos", {
    officeId: office._id,
    name: freshName(repos, a.name, path),
    machineId: a.machineId,
    path,
    defaultBranch: checkBranch(a.defaultBranch),
    setupCommand: cleanSetup(a.setupCommand),
    createdAt: Date.now(),
    removedAt: null,
  });
}

export const add = mutation({
  args: {
    officeId: v.id("offices"),
    machineId: v.id("machines"),
    path: v.string(),
    name: v.optional(v.string()),
    defaultBranch: v.string(),
    setupCommand: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { officeId, ...a }) => {
    const { user, office } = await requireOffice(ctx, officeId);
    return addRepo(ctx, user, office, a);
  },
});

/**
 * Add several repos at once (picked from a scan or Browse), all or none. Each is named after its folder, with -2, -3…
 * when that name is taken. Returns their names, in order.
 */
export const addMany = mutation({
  args: {
    officeId: v.id("offices"),
    repos: v.array(v.object({
      machineId: v.id("machines"),
      path: v.string(),
      defaultBranch: v.string(),
      setupCommand: v.optional(v.union(v.string(), v.null())),
    })),
  },
  handler: async (ctx, { officeId, repos }) => {
    const { user, office } = await requireOffice(ctx, officeId);
    if (!repos.length) fail("Pick a repo to add");
    const have = (await ensureRepos(ctx, office)).length;
    if (have + repos.length > MAX_REPOS) fail(`A ship holds at most ${MAX_REPOS} repos; there's room for ${Math.max(0, MAX_REPOS - have)} more`);
    const names: string[] = [];
    for (const r of repos) {
      const id = await addRepo(ctx, user, office, r);
      names.push((await ctx.db.get(id))!.name);
    }
    return names;
  },
});

/** Tasks in this repo that are planned or under way. */
async function activeTasks(ctx: MutationCtx, office: Doc<"offices">, repo: Doc<"repos">): Promise<Doc<"tasks">[]> {
  const repos = await ensureRepos(ctx, office);
  const out: Doc<"tasks">[] = [];
  for (const state of ["todo", "doing", "review"] as const) {
    const tasks = await ctx.db.query("tasks").withIndex("by_office_state", (q) => q.eq("officeId", office._id).eq("state", state)).collect();
    out.push(...tasks.filter((t) => repoOfTask(t, repos)?._id === repo._id));
  }
  return out;
}

async function requireRepo(ctx: MutationCtx, repoId: Id<"repos">) {
  const repo = await ctx.db.get(repoId);
  if (!repo || repo.removedAt !== null) fail("No such repo");
  const { user, office } = await requireOffice(ctx, repo!.officeId);
  return { user, office, repo: repo! };
}

export const update = mutation({
  args: {
    repoId: v.id("repos"),
    name: v.optional(v.string()),
    machineId: v.optional(v.id("machines")),
    path: v.optional(v.string()),
    defaultBranch: v.optional(v.string()),
    setupCommand: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { repoId, ...a }) => {
    const { user, office, repo } = await requireRepo(ctx, repoId);
    const repos = await ensureRepos(ctx, office);
    const patch: Partial<Doc<"repos">> = {};
    if (a.name !== undefined && a.name.trim().toLowerCase() !== repo.name) {
      const n = checkName(a.name);
      if (repos.some((r) => r._id !== repoId && r.name === n)) fail(`There is already a repo called "${n}" on this ship`);
      patch.name = n;
    }
    const moving = (a.machineId !== undefined && a.machineId !== repo.machineId) || (a.path !== undefined && checkPath(a.path) !== repo.path);
    if (moving) {
      const busy = (await activeTasks(ctx, office, repo)).filter((t) => t.state !== "todo");
      if (busy.length) fail(`Crew are working in "${repo.name}" (${busy.map((t) => t.title).join(", ")}). Move it once they have finished.`);
      if (a.machineId !== undefined) { await ownMachine(ctx, user, a.machineId); patch.machineId = a.machineId; }
      if (a.path !== undefined) patch.path = checkPath(a.path);
      const m = patch.machineId ?? repo.machineId, p = patch.path ?? repo.path;
      const same = repos.find((r) => r._id !== repoId && r.machineId === m && r.path === p);
      if (same) fail(`That folder is already on this ship, as "${same.name}"`);
    }
    if (a.defaultBranch !== undefined) patch.defaultBranch = checkBranch(a.defaultBranch);
    if (a.setupCommand !== undefined) patch.setupCommand = cleanSetup(a.setupCommand);
    await ctx.db.patch(repoId, patch);
  },
});

/** Take a repo off the ship. Not while tasks in it are planned or under way. Its branches and worktrees stay on the machine. */
export const remove = mutation({
  args: { repoId: v.id("repos") },
  handler: async (ctx, { repoId }) => {
    const { office, repo } = await requireRepo(ctx, repoId);
    const active = await activeTasks(ctx, office, repo);
    if (active.length) fail(`Tasks in "${repo.name}" are still planned or under way (${active.map((t) => t.title).join(", ")}). Remove it once they are done or stopped.`);
    await ctx.db.patch(repoId, { removedAt: Date.now() });
  },
});

/** Once, after deploying repos: every office's legacy `repo` becomes a repos row. Safe to run again. */
export const migrate = internalMutation({
  args: {},
  handler: async (ctx) => {
    let made = 0, offices = 0;
    for (const office of await ctx.db.query("offices").collect()) {
      offices += 1;
      if (await migrateOffice(ctx, office)) made += 1;
    }
    return { offices, made };
  },
});
