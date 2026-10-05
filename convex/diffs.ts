import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { DiffResult } from "@offsite/contracts";
import { fail, ONLINE_MS, requireMachine, requireOffice, requireThread } from "./lib";
import { ensureRepos, repoOfTask, reposOf } from "./repolib";

// The crew's work, for the captain to read: a task's changes, or a thread's in each repo it touched. The app asks
// (request), a row waits as "pending", the runner on the machine holding the repo computes it from git (work → put),
// and the app reads it (get). Rows are cached by the sha they were computed at: asking again refreshes a row only when
// something landed since, or the task is still under way, and the runner skips the work when the branch hasn't moved.
// "Open in editor" goes the same way: a request the runner on that machine carries out.

type Ctx = QueryCtx | MutationCtx;

/** The repos a diff covers: a task's own, or every repo with a task of the thread's that has (or had) a branch. */
async function targets(ctx: MutationCtx, office: Doc<"offices">, thread: Doc<"threads">, task: Doc<"tasks"> | null) {
  const repos = await ensureRepos(ctx, office);
  if (task) {
    const r = repoOfTask(task, repos);
    if (!r) fail("That task's repo was taken off the ship");
    return [{ repo: r!, tasks: [task] }];
  }
  const tasks = await ctx.db.query("tasks").withIndex("by_thread", (q) => q.eq("threadId", thread._id)).collect();
  return repos
    .map((repo) => ({ repo, tasks: tasks.filter((t) => repoOfTask(t, repos)?._id === repo._id) }))
    .filter((x) => x.tasks.some((t) => t.branch || t.state === "landed"));
}

async function taskIn(ctx: Ctx, threadId: Id<"threads">, taskId: Id<"tasks"> | undefined) {
  if (!taskId) return null;
  const task = await ctx.db.get(taskId);
  if (!task || task.threadId !== threadId) fail("No such task in this thread");
  return task!;
}

const rowsFor = (ctx: Ctx, threadId: Id<"threads">, taskId: Id<"tasks"> | null) =>
  ctx.db.query("diffs").withIndex("by_thread", (q) => q.eq("threadId", threadId).eq("taskId", taskId)).collect();

/** Ask for a task's changes, or (no taskId) the thread's in each repo. Cheap to call on every open. */
export const request = mutation({
  args: { threadId: v.id("threads"), taskId: v.optional(v.id("tasks")) },
  handler: async (ctx, { threadId, taskId }) => {
    const { office, thread } = await requireThread(ctx, threadId);
    const task = await taskIn(ctx, threadId, taskId);
    const rows = await rowsFor(ctx, threadId, task?._id ?? null);
    const now = Date.now();
    for (const { repo, tasks } of await targets(ctx, office, thread, task)) {
      const row = rows.find((r) => r.repoId === repo._id);
      // Anything still under way can move at any time; landed work moves only when something lands again.
      const moving = tasks.some((t) => t.state === "doing" || t.state === "review");
      const lastLanding = Math.max(0, ...tasks.map((t) => t.landedAt ?? 0));
      const fresh = row && row.machineId === repo.machineId && (
        (row.state === "ready" && !moving && (row.computedAt ?? 0) >= lastLanding) ||
        (row.state === "pending" && now - row.requestedAt < 60_000)
      );
      if (fresh) continue;
      if (row) await ctx.db.patch(row._id, { state: "pending", requestedAt: now, machineId: repo.machineId, error: null });
      else {
        await ctx.db.insert("diffs", {
          officeId: office._id, threadId, taskId: task?._id ?? null, repoId: repo._id, machineId: repo.machineId, state: "pending",
          requestedAt: now, computedAt: null, sha: null, base: null, stats: null, files: [], patch: "", truncated: false, error: null,
        });
      }
    }
  },
});

/** A task's changes, or the thread's per repo, with each repo's machine (offline: the diff waits there). Owner only. */
export const get = query({
  args: { threadId: v.id("threads"), taskId: v.optional(v.id("tasks")) },
  handler: async (ctx, { threadId, taskId }) => {
    const { office, thread } = await requireThread(ctx, threadId);
    const task = await taskIn(ctx, threadId, taskId);
    const repos = await reposOf(ctx, office);
    const rows = await rowsFor(ctx, threadId, task?._id ?? null);
    const now = Date.now();
    const crew = task?.assignee ? await ctx.db.get(task.assignee) : null;
    const tasks = task ? [task] : await ctx.db.query("tasks").withIndex("by_thread", (q) => q.eq("threadId", threadId)).collect();
    const parts = await Promise.all(repos.filter((r) => r._id).map(async (repo) => {
      const row = rows.find((r) => r.repoId === repo._id) ?? null;
      const mine = tasks.filter((t) => repoOfTask(t, repos)?._id === repo._id);
      if (!row && !mine.some((t) => t.branch || t.state === "landed")) return null;
      const machine = await ctx.db.get(repo.machineId);
      return {
        repo: { _id: repo._id!, name: repo.name, defaultBranch: repo.defaultBranch },
        machine: machine ? { name: machine.name, online: now - machine.lastSeenAt < ONLINE_MS } : null,
        diff: row && {
          state: row.state, requestedAt: row.requestedAt, computedAt: row.computedAt, sha: row.sha, base: row.base,
          stats: row.stats, files: row.files as DiffResult["files"], patch: row.patch, truncated: row.truncated, error: row.error,
        },
      };
    }));
    const prs = thread.prs?.map((p) => ({ repo: repos.find((r) => r._id === p.repoId)?.name ?? null, url: p.url })) ?? (thread.prUrl ? [{ repo: repos[0]?.name ?? null, url: thread.prUrl }] : []);
    return {
      thread: { _id: thread._id, title: thread.title, branch: thread.branch, state: thread.state, prs, lastLandedAt: Math.max(0, ...tasks.map((t) => t.landedAt ?? 0)) },
      task: task && { _id: task._id, key: task.key, title: task.title, state: task.state, branch: task.branch, diff: task.diff ?? null, landedAt: task.landedAt },
      crew: crew && { _id: crew._id, name: crew.name, avatar: crew.avatar, look: crew.look },
      repos: parts.filter((p) => p !== null),
    };
  },
});

/** The captain opened a task's changes (or a whole thread's: every task in it): their packages leave the drop-off. */
export const seen = mutation({
  args: { taskId: v.optional(v.id("tasks")), threadId: v.optional(v.id("threads")) },
  handler: async (ctx, { taskId, threadId }) => {
    const now = Date.now();
    if (taskId) {
      const task = await ctx.db.get(taskId);
      if (!task) fail("No such task");
      await requireOffice(ctx, task!.officeId);
      if (!task!.seenAt) await ctx.db.patch(taskId, { seenAt: now });
    }
    if (threadId) {
      await requireThread(ctx, threadId);
      const tasks = await ctx.db.query("tasks").withIndex("by_thread", (q) => q.eq("threadId", threadId)).collect();
      for (const t of tasks) if (t.state === "landed" && !t.seenAt) await ctx.db.patch(t._id, { seenAt: now });
    }
  },
});

/**
 * Recent deliveries for the world: landed tasks, newest first, with who did them, their size and whether the captain
 * has opened them. The drop-off shows a package for each unseen one; a desk offers its crew member's latest.
 */
export const deliveries = query({
  args: { officeId: v.id("offices") },
  handler: async (ctx, { officeId }) => {
    await requireOffice(ctx, officeId);
    const landed = await ctx.db.query("tasks").withIndex("by_office_state", (q) => q.eq("officeId", officeId).eq("state", "landed")).collect();
    const recent = landed.sort((a, b) => (b.landedAt ?? 0) - (a.landedAt ?? 0)).slice(0, 40);
    const names = new Map<string, string>();
    for (const t of recent) if (t.assignee && !names.has(t.assignee)) names.set(t.assignee, (await ctx.db.get(t.assignee))?.name ?? "Someone");
    return recent.map((t) => ({
      taskId: t._id, threadId: t.threadId, title: t.title, crewId: t.assignee, crewName: t.assignee ? names.get(t.assignee)! : "Someone",
      landedAt: t.landedAt ?? t.createdAt, diff: t.diff ?? null, seen: !!t.seenAt,
    }));
  },
});

/** Open the work in the captain's editor, on the machine holding the repo: a task's worktree, or the thread's branch. */
export const openEditor = mutation({
  args: { threadId: v.id("threads"), taskId: v.optional(v.id("tasks")), repoId: v.optional(v.id("repos")) },
  handler: async (ctx, { threadId, taskId, repoId }) => {
    const { office, thread } = await requireThread(ctx, threadId);
    const task = await taskIn(ctx, threadId, taskId);
    const all = await targets(ctx, office, thread, task);
    const target = (repoId ? all.find((x) => x.repo._id === repoId) : all[0]) ?? fail("There is nothing to open yet: no work has started in that repo");
    const machine = await ctx.db.get(target.repo.machineId);
    if (!machine || machine.revokedAt) fail("The machine holding that repo isn't connected any more");
    const now = Date.now();
    if (now - machine!.lastSeenAt > ONLINE_MS) fail(`${machine!.name} is offline; the work lives there. Start \`offsite\` on it and try again.`);
    return ctx.db.insert("editorRequests", {
      officeId: office._id, threadId, taskId: task?._id ?? null, repoId: target.repo._id, machineId: machine!._id, createdAt: now, doneAt: null, result: null, ok: null,
    });
  },
});

/** How an "Open in editor" went. */
export const editorRequest = query({
  args: { requestId: v.id("editorRequests") },
  handler: async (ctx, { requestId }) => {
    const r = await ctx.db.get(requestId);
    if (!r) return null;
    await requireOffice(ctx, r.officeId);
    return { doneAt: r.doneAt, ok: r.ok, result: r.result };
  },
});

// ---- the runner's side ----

/** Diffs to compute and folders to open on this machine. The runner subscribes to it. */
export const work = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const machine = await requireMachine(ctx, token);
    const pending = await ctx.db.query("diffs").withIndex("by_machine", (q) => q.eq("machineId", machine._id).eq("state", "pending")).take(20);
    const opens = await ctx.db.query("editorRequests").withIndex("by_machine", (q) => q.eq("machineId", machine._id).eq("doneAt", null)).take(10);
    const where = async (row: { threadId: Id<"threads">; taskId: Id<"tasks"> | null; repoId: Id<"repos"> }) => {
      const [thread, task, repo] = await Promise.all([ctx.db.get(row.threadId), row.taskId ? ctx.db.get(row.taskId) : null, ctx.db.get(row.repoId)]);
      if (!thread || !repo || repo.removedAt !== null) return null;
      return {
        officeId: thread.officeId, threadId: thread._id, threadBranch: thread.branch,
        repo: { name: repo.name, path: repo.path, defaultBranch: repo.defaultBranch },
        task: task && { key: task.key, branch: task.branch },
      };
    };
    const diffs = [];
    for (const d of pending) {
      const at = await where(d);
      if (at) diffs.push({ diffId: d._id, knownSha: d.computedAt ? d.sha : null, ...at });
    }
    const editors = [];
    for (const r of opens) {
      if (Date.now() - r.createdAt > 5 * 60_000) continue;
      const at = await where(r);
      if (at) editors.push({ requestId: r._id, ...at });
    }
    return { diffs, editors };
  },
});

async function ownDiff(ctx: MutationCtx, token: string, diffId: Id<"diffs">) {
  const machine = await requireMachine(ctx, token);
  const row = await ctx.db.get(diffId);
  if (!row || row.machineId !== machine._id) fail("That diff isn't this machine's to compute");
  return row!;
}

/** A computed diff, or (unchanged) the sha it was last computed at still stands, or why it couldn't be computed. */
export const put = mutation({
  args: { token: v.string(), diffId: v.id("diffs"), result: v.optional(v.any()), unchanged: v.optional(v.boolean()), error: v.optional(v.string()) },
  handler: async (ctx, { token, diffId, result, unchanged, error }) => {
    const row = await ownDiff(ctx, token, diffId);
    const now = Date.now();
    if (error !== undefined) {
      await ctx.db.patch(diffId, { state: "failed", computedAt: now, error: error.slice(0, 500) });
      return;
    }
    if (unchanged) {
      if (row.computedAt === null) fail("Nothing was computed for that diff yet; send the result");
      await ctx.db.patch(diffId, { state: "ready", computedAt: now, error: null });
      return;
    }
    const parsed = DiffResult.safeParse(result);
    if (!parsed.success) fail(`That diff doesn't fit the format: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message ?? ""}`.trim());
    const d = parsed.data!;
    await ctx.db.patch(diffId, { state: "ready", computedAt: now, sha: d.sha, base: d.base, stats: d.stats, files: d.files, patch: d.patch, truncated: d.truncated, error: null });
    // Fill in a landed task's size when its run didn't record one (runners from before).
    if (row.taskId) {
      const task = await ctx.db.get(row.taskId);
      if (task?.state === "landed" && !task.diff) await ctx.db.patch(task._id, { diff: d.stats });
    }
  },
});

/** The runner opened the folder (or couldn't). */
export const editorDone = mutation({
  args: { token: v.string(), requestId: v.id("editorRequests"), ok: v.boolean(), result: v.string() },
  handler: async (ctx, { token, requestId, ok, result }) => {
    const machine = await requireMachine(ctx, token);
    const r = await ctx.db.get(requestId);
    if (!r || r.machineId !== machine._id) fail("That request isn't this machine's");
    await ctx.db.patch(requestId, { doneAt: Date.now(), ok, result: result.slice(0, 300) });
  },
});
