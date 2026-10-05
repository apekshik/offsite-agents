import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireThread } from "./lib";
import { repoOfTask, reposOf } from "./repolib";

/** A thread's tasks in the order the computer planned them, each with its repo's name. */
export const list = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const { office } = await requireThread(ctx, threadId);
    const repos = await reposOf(ctx, office);
    const tasks = await ctx.db.query("tasks").withIndex("by_thread", (q) => q.eq("threadId", threadId)).collect();
    // `repo`: the name of the repo it is in (null if that repo was taken off the ship).
    return tasks.sort((a, b) => a.createdAt - b.createdAt).map((t) => ({ ...t, repo: repoOfTask(t, repos)?.name ?? null }));
  },
});
