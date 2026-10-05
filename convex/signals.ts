import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { fail, requireUser } from "./lib";

// WebRTC signaling between people on the same ship's deck: offers, answers and ICE candidates dropped in each other's
// mailbox and deleted once read. Movement (and later voice) then flows between the browsers. Adapted from Ready Player
// One (github.com/apekshik/ready-player-one, convex/signals.ts), with one change: both ends must be on deck on the same
// ship, and only the tab a peer id belongs to reads its mailbox (SDP and candidates carry network addresses).

const KINDS = new Set(["offer", "answer", "ice", "bye"]);

/** Your presence row, if it is this peer id. */
async function ownPeer(ctx: QueryCtx, userId: Id<"users">, peerId: string) {
  const row = await ctx.db.query("presence").withIndex("by_user", (q) => q.eq("userId", userId)).first();
  return row && row.peerId === peerId ? row : null;
}

export const send = mutation({
  args: { from: v.string(), to: v.string(), kind: v.string(), data: v.string() },
  handler: async (ctx, { from, to, kind, data }) => {
    const user = await requireUser(ctx);
    if (!KINDS.has(kind)) fail("Not a signal");
    if (data.length > 20_000) fail("That signal is too big");
    const me = await ownPeer(ctx, user._id, from);
    if (!me) return { sent: false };
    const them = await ctx.db.query("presence").withIndex("by_peer", (q) => q.eq("peerId", to)).first();
    if (!them || them.officeId !== me.officeId) return { sent: false };
    await ctx.db.insert("signals", { officeId: me.officeId, from, to, kind, data, at: Date.now() });
    return { sent: true };
  },
});

/** Your tab's mailbox. */
export const inbox = query({
  args: { peerId: v.string() },
  handler: async (ctx, { peerId }) => {
    const user = await requireUser(ctx);
    if (!(await ownPeer(ctx, user._id, peerId))) return [];
    const rows = await ctx.db.query("signals").withIndex("by_to", (q) => q.eq("to", peerId)).take(100);
    return rows.map((r) => ({ id: r._id, from: r.from, kind: r.kind, data: r.data }));
  },
});

/** Read: delete them. */
export const ack = mutation({
  args: { peerId: v.string(), ids: v.array(v.id("signals")) },
  handler: async (ctx, { peerId, ids }) => {
    const user = await requireUser(ctx);
    if (!(await ownPeer(ctx, user._id, peerId))) return;
    for (const id of ids.slice(0, 200)) {
      const s = await ctx.db.get(id);
      if (s && s.to === peerId) await ctx.db.delete(id);
    }
  },
});
