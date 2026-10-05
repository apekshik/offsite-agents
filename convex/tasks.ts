import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireThread } from "./lib";

/** A thread's tasks in the order the computer planned them. */
export const list = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    await requireThread(ctx, threadId);
    const tasks = await ctx.db.query("tasks").withIndex("by_thread", (q) => q.eq("threadId", threadId)).collect();
    return tasks.sort((a, b) => a.createdAt - b.createdAt);
  },
});
