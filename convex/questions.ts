import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { fail, requireAboard } from "./lib";
import { post } from "./flow";

/**
 * What waits on people aboard, oldest first, with who is asking and whom it is for (`askedOf`: a user, or null for
 * anyone). Anyone aboard sees them all.
 */
export const open = query({
  args: { officeId: v.id("offices") },
  handler: async (ctx, { officeId }) => {
    const { office } = await requireAboard(ctx, officeId);
    const rows = await ctx.db.query("questions").withIndex("by_office_open", (q) => q.eq("officeId", officeId).eq("answeredAt", null)).collect();
    return Promise.all(rows.sort((a, b) => a.createdAt - b.createdAt).map(async (q) => {
      const crew = await ctx.db.get(q.crewId);
      return { ...q, askedOf: q.askedOf === undefined ? office.ownerId : q.askedOf, crewName: crew?.name ?? "Someone", crewHandle: crew?.handle ?? null };
    }));
  },
});

/**
 * Answer an agent. The first answer wins. A permission (approval) is about the captain's machine, so only the captain
 * gives it; anyone aboard may answer a question.
 */
export const answer = mutation({
  args: { questionId: v.id("questions"), answer: v.string() },
  handler: async (ctx, { questionId, answer }) => {
    const q = await ctx.db.get(questionId);
    if (!q) return fail("No such question");
    const { user, role } = await requireAboard(ctx, q.officeId);
    if (q.kind === "approval" && role !== "owner") fail("Only the captain can allow that: it runs on their machine");
    if (q.answeredAt !== null) fail("Already answered");
    const text = answer.trim().slice(0, 4000);
    if (!text) fail("Answer with something");
    await ctx.db.patch(questionId, { answer: text, answeredAt: Date.now(), answeredBy: user._id });
    if (q.threadId) {
      const crew = await ctx.db.get(q.crewId);
      await post(ctx, q.threadId, { author: { kind: "captain", userId: user._id }, kind: "text", text: `${crew ? `@${crew.handle} ` : ""}${text}` });
    }
  },
});
