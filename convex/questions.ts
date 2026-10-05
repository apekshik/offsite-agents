import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { fail, requireOffice } from "./lib";
import { post } from "./flow";

/** What waits on you across the ship, oldest first, with who is asking. */
export const open = query({
  args: { officeId: v.id("offices") },
  handler: async (ctx, { officeId }) => {
    await requireOffice(ctx, officeId);
    const rows = await ctx.db.query("questions").withIndex("by_office_open", (q) => q.eq("officeId", officeId).eq("answeredAt", null)).collect();
    return Promise.all(rows.sort((a, b) => a.createdAt - b.createdAt).map(async (q) => {
      const crew = await ctx.db.get(q.crewId);
      return { ...q, crewName: crew?.name ?? "Someone", crewHandle: crew?.handle ?? null };
    }));
  },
});

/** Answer an agent. The first answer wins. */
export const answer = mutation({
  args: { questionId: v.id("questions"), answer: v.string() },
  handler: async (ctx, { questionId, answer }) => {
    const q = await ctx.db.get(questionId);
    if (!q) return fail("No such question");
    await requireOffice(ctx, q.officeId);
    if (q.answeredAt !== null) fail("Already answered");
    const text = answer.trim().slice(0, 4000);
    if (!text) fail("Answer with something");
    await ctx.db.patch(questionId, { answer: text, answeredAt: Date.now() });
    if (q.threadId) {
      const crew = await ctx.db.get(q.crewId);
      await post(ctx, q.threadId, { author: { kind: "captain" }, kind: "text", text: `${crew ? `@${crew.handle} ` : ""}${text}` });
    }
  },
});
