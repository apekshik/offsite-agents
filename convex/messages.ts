import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireThreadAboard } from "./lib";

/** A thread's messages, oldest first (the latest 300). The computer's replies grow while they stream. */
export const list = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    await requireThreadAboard(ctx, threadId);
    const rows = await ctx.db.query("messages").withIndex("by_thread", (q) => q.eq("threadId", threadId)).order("desc").take(300);
    return rows.reverse();
  },
});
