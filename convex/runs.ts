import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { isLive, type RunState } from "@offsite/contracts";
import { fail, requireOffice } from "./lib";
import { closeStream, tick } from "./flow";

/** One run's events, in order (the latest 500): the Watch view of a crew member's work. */
export const events = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return [];
    await requireOffice(ctx, run.officeId);
    const rows = await ctx.db.query("runEvents").withIndex("by_run", (q) => q.eq("runId", runId)).order("desc").take(500);
    return rows.reverse().map((r) => ({ seq: r.seq, at: r.at, event: r.event }));
  },
});

/** The runs in a thread, newest first. */
export const forThread = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread) return [];
    await requireOffice(ctx, thread.officeId);
    const runs = await ctx.db.query("runs").withIndex("by_thread", (q) => q.eq("threadId", threadId)).collect();
    return runs.sort((a, b) => b.createdAt - a.createdAt).map(({ prompt: _p, ...r }) => r);
  },
});

/** Stop a run. Whatever it changed is still committed. */
export const interrupt = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return fail("No such run");
    await requireOffice(ctx, run.officeId);
    if (!isLive(run.state as RunState)) return;
    if (run.state === "queued") {
      // Nobody picked it up yet: just don't.
      await ctx.db.patch(runId, { state: "interrupted", endedAt: Date.now() });
      await closeStream(ctx, runId);
      if (run.taskId) await ctx.db.patch(run.taskId, { state: "cancelled" });
      await tick(ctx, run.officeId);
      return;
    }
    await ctx.db.patch(runId, { interruptRequestedAt: Date.now() });
  },
});
