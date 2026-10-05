import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { LIMITS } from "@offsite/contracts";
import { autoTitle, fail, requireAboard, requireCanAsk, requireThread, requireThreadAboard } from "./lib";
import { post, queueComputer, spokenBy } from "./flow";
import { repoOfTask, reposOf } from "./repolib";
import type { Doc } from "./_generated/dataModel";

function sumDiffs(tasks: Doc<"tasks">[]): { added: number; removed: number; files: number } | null {
  const sized = tasks.filter((t) => t.state === "landed" && t.diff);
  if (!sized.length) return null;
  return sized.reduce((s, t) => ({ added: s.added + t.diff!.added, removed: s.removed + t.diff!.removed, files: s.files + t.diff!.files }), { added: 0, removed: 0, files: 0 });
}

/** Threads on this ship, most recent first, with who is on them and what waits on you. Anyone aboard. */
export const list = query({
  args: { officeId: v.id("offices") },
  handler: async (ctx, { officeId }) => {
    const { office } = await requireAboard(ctx, officeId);
    const names = new Map<string, string>();
    const nameOfUser = async (id: Doc<"users">["_id"]) => {
      if (!names.has(id)) names.set(id, (await ctx.db.get(id))?.name ?? "Someone");
      return names.get(id)!;
    };
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
        /** Who started it: the captain or a friend aboard. Null on threads from before friends (the captain's). */
        startedBy: t.startedBy ? { userId: t.startedBy, name: await nameOfUser(t.startedBy), owner: t.startedBy === office.ownerId } : null,
      };
    }));
  },
});

export const get = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => (await requireThreadAboard(ctx, threadId)).thread,
});

function clean(text: string): string {
  const t = text.trim();
  if (!t) fail("Say something");
  return t.slice(0, LIMITS.messageChars);
}

/**
 * Start a thread: your words go to Computah, which starts on it. Anyone aboard (a friend, unless the captain turned that
 * off); the work runs on the captain's machines either way.
 */
export const create = mutation({
  args: { officeId: v.id("offices"), text: v.string() },
  handler: async (ctx, { officeId, text }) => {
    const { user, office, role } = await requireAboard(ctx, officeId);
    requireCanAsk(office, role);
    const body = clean(text);
    const now = Date.now();
    const threadId = await ctx.db.insert("threads", {
      officeId, title: autoTitle(body), state: "open", branch: null, prUrl: null, createdAt: now, lastMessageAt: now, startedBy: user._id,
    });
    await post(ctx, threadId, { author: { kind: "captain", userId: user._id }, kind: "text", text: body });
    // Alone aboard, the captain's words go as they are; with friends aboard, Computah hears who asked.
    const who = await spokenBy(ctx, office, user._id);
    await queueComputer(ctx, (await ctx.db.get(threadId))!, who ? `${who} asks: ${body}` : body);
    return threadId;
  },
});

/** Say more in a thread. Reaches Computah's live turn, or starts a new one. Anyone aboard, as for create. */
export const send = mutation({
  args: { threadId: v.id("threads"), text: v.string() },
  handler: async (ctx, { threadId, text }) => {
    const { thread, user, office, role } = await requireThreadAboard(ctx, threadId);
    requireCanAsk(office, role);
    const body = clean(text);
    await post(ctx, threadId, { author: { kind: "captain", userId: user._id }, kind: "text", text: body });
    if (thread.state === "done" || thread.state === "archived") await ctx.db.patch(threadId, { state: "open" });
    const who = await spokenBy(ctx, office, user._id);
    await queueComputer(ctx, (await ctx.db.get(threadId))!, `${who ?? "The captain"} says: ${body}`);
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
