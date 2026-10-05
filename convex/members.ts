import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { fail, requireAboard, requireOffice, requireUser } from "./lib";

// Friends aboard: who is on a ship besides its owner, leaving, and being asked to leave. Invites (invites.ts) bring
// them aboard. A member reads everything and talks to Computah; the work runs on the owner's machines.

/** Everyone a ship has aboard (whether or not they're on deck right now): the captain, then friends by when they joined. */
export const list = query({
  args: { officeId: v.id("offices") },
  handler: async (ctx, { officeId }) => {
    const { user, office, role } = await requireAboard(ctx, officeId);
    const owner = await ctx.db.get(office.ownerId);
    const rows = await ctx.db.query("members").withIndex("by_office", (q) => q.eq("officeId", officeId)).collect();
    const members = await Promise.all(rows.sort((a, b) => a.joinedAt - b.joinedAt).map(async (m) => {
      const u = await ctx.db.get(m.userId);
      return { userId: m.userId, name: u?.name ?? "Someone", avatar: u?.avatar ?? null, look: u?.look ?? null, joinedAt: m.joinedAt };
    }));
    return {
      /** You. */
      me: user._id,
      /** Yours on this ship: "owner" (the captain) or "member". */
      role,
      owner: { userId: office.ownerId, name: owner?.name ?? "Captain", avatar: owner?.avatar ?? null, look: owner?.look ?? null },
      members,
      membersCanAsk: office.membersCanAsk !== false,
    };
  },
});

/** Take someone off the ship: their row, where they stood on deck, and the ship as the one they board next. */
async function dropMember(ctx: MutationCtx, office: Doc<"offices">, userId: Id<"users">) {
  const row = await ctx.db.query("members").withIndex("by_office_user", (q) => q.eq("officeId", office._id).eq("userId", userId)).unique();
  if (!row) return false;
  await ctx.db.delete(row._id);
  const here = await ctx.db.query("presence").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  for (const p of here) if (p.officeId === office._id) await ctx.db.delete(p._id);
  const u = await ctx.db.get(userId);
  if (u?.aboardId === office._id) await ctx.db.patch(userId, { aboardId: null });
  return true;
}

/** The captain asks a friend to leave. */
export const remove = mutation({
  args: { officeId: v.id("offices"), userId: v.id("users") },
  handler: async (ctx, { officeId, userId }) => {
    const { office } = await requireOffice(ctx, officeId);
    if (userId === office.ownerId) fail("The captain stays with their ship");
    if (!(await dropMember(ctx, office, userId))) fail("They aren't aboard");
  },
});

/** Leave a ship you joined. (The captain can't leave their own ship.) */
export const leave = mutation({
  args: { officeId: v.id("offices") },
  handler: async (ctx, { officeId }) => {
    const { user, office, role } = await requireAboard(ctx, officeId);
    if (role === "owner") fail("It's your ship: you can't leave it");
    await dropMember(ctx, office, user._id);
  },
});

/** The ships you joined (not your own: offices.mine), newest first, with whose each is. */
export const joined = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx).catch(() => null);
    if (!user) return [];
    const rows = await ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    const out = [];
    for (const m of rows) {
      const office = await ctx.db.get(m.officeId);
      if (!office) continue;
      const owner = await ctx.db.get(office.ownerId);
      out.push({ _id: office._id, name: office.name, world: office.world, owner: owner?.name ?? "Captain", joinedAt: m.joinedAt });
    }
    return out.sort((a, b) => b.joinedAt - a.joinedAt);
  },
});
