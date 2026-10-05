import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { LIMITS } from "@offsite/contracts";
import { autoTitle, fail, requireOffice, requireThread } from "./lib";
import { post, queueComputer } from "./flow";
import { repoOfTask, reposOf } from "./repolib";
import type { Doc } from "./_generated/dataModel";

function sumDiffs(tasks: Doc<"tasks">[]): { added: number; removed: number; files: number } | null {
  const sized = tasks.filter((t) => t.state === "landed" && t.diff);
  if (!sized.length) return null;
  return sized.reduce((s, t) => ({ added: s.added + t.diff!.added, removed: s.removed + t.diff!.removed, files: s.files + t.diff!.files }), { added: 0, removed: 0, files: 0 });
}

/** Threads on this ship, most recent first, with who is on them and what waits on you. */
export const list = query({
  args: { officeId: v.id("offices") },
  handler: async (ctx, { officeId }) => {
    const { office } = await requireOffice(ctx, officeId);
    const repos = await reposOf(ctx, office);
    const nameOf = (id: string | null | undefined) => repos.find((r) => r._id === id)?.name ?? null;
    const threads = await ctx.db.query("threads").withIndex("by_office", (q) => q.eq("officeId", officeId)).order("desc").take(100);
    const open = await ctx.db.query("questions").withIndex("by_office_open", (q) => q.eq("officeId", officeId).eq("answeredAt", null)).collect();
    return Promise.all(threads.filter((t) => t.state !== "archived").map(async (t) => {
      const tasks = await ctx.db.query("tasks").withIndex("by_thread", (q) => q.eq("threadId", t._id)).collect();
      const crewIds = [...new Set(tasks.map((x) => x.assignee).filter((x) => x !== null))];
      const touched = new Set(tasks.map((x) => repoOfTask(x, repos)?.name).filter((x): x is string => !!x));
      // Threads finished before repos have only prUrl: that was the first repo's.
      const prs = t.prs ? t.prs.map((p) => ({ repo: nameOf(p.repoId), url: p.url, branch: p.branch }))
        : t.prUrl ? [{ repo: repos[0]?.name ?? null, url: t.prUrl as string | null, branch: t.branch ?? "" }] : [];
      return {
        _id: t._id,
        title: t.title,
        state: t.state,
        branch: t.branch,
        prUrl: t.prUrl,
        /** The repos its tasks are in, in the ship's order. */
        repos: repos.map((r) => r.name).filter((n) => touched.has(n)),
        /** One per repo, once the thread is finished. */
        prs,
        createdAt: t.createdAt,
        lastMessageAt: t.lastMessageAt,
        crewIds,
        tasks: { total: tasks.length, landed: tasks.filter((x) => x.state === "landed").length },
        /** The landed tasks' sizes added up ("+38 −2 · 2 files"); null until one has a recorded size. Files touched by two tasks count twice. */
        diff: sumDiffs(tasks),
        openQuestions: open.filter((q) => q.threadId === t._id).length,
      };
    }));
  },
});

export const get = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => (await requireThread(ctx, threadId)).thread,
});

function clean(text: string): string {
  const t = text.trim();
  if (!t) fail("Say something");
  return t.slice(0, LIMITS.messageChars);
}

/** Start a thread: your words go to Computah, which starts on it. */
export const create = mutation({
  args: { officeId: v.id("offices"), text: v.string() },
  handler: async (ctx, { officeId, text }) => {
    await requireOffice(ctx, officeId);
    const body = clean(text);
    const now = Date.now();
    const threadId = await ctx.db.insert("threads", {
      officeId, title: autoTitle(body), state: "open", branch: null, prUrl: null, createdAt: now, lastMessageAt: now,
    });
    await post(ctx, threadId, { author: { kind: "captain" }, kind: "text", text: body });
    await queueComputer(ctx, (await ctx.db.get(threadId))!, body);
    return threadId;
  },
});

/** Say more in a thread. Reaches Computah's live turn, or starts a new one. */
export const send = mutation({
  args: { threadId: v.id("threads"), text: v.string() },
  handler: async (ctx, { threadId, text }) => {
    const { thread } = await requireThread(ctx, threadId);
    const body = clean(text);
    await post(ctx, threadId, { author: { kind: "captain" }, kind: "text", text: body });
    if (thread.state === "done" || thread.state === "archived") await ctx.db.patch(threadId, { state: "open" });
    await queueComputer(ctx, (await ctx.db.get(threadId))!, `The captain says: ${body}`);
  },
});

export const rename = mutation({
  args: { threadId: v.id("threads"), title: v.string() },
  handler: async (ctx, { threadId, title }) => {
    await requireThread(ctx, threadId);
    const t = title.trim().slice(0, LIMITS.titleChars);
    if (!t) fail("A title, please");
    await ctx.db.patch(threadId, { title: t });
  },
});

export const archive = mutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    await requireThread(ctx, threadId);
    await ctx.db.patch(threadId, { state: "archived" });
  },
});
