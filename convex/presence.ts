import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { PRESENCE, PersonAct } from "@offsite/contracts";
import { fail, requireAboard, requireUser } from "./lib";

// Who is walking the decks of a ship right now. Adapted from Ready Player One (github.com/apekshik/ready-player-one,
// convex/presence.ts): one row per person, a heartbeat, a sweep for whoever stopped beating, and a second tab taking
// over from the first. Movement itself goes peer to peer (apps/web/src/game/net.ts); the row is the roster and the
// fallback position (written ~5 times a second while a peer-to-peer link isn't up).

const num = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function cleanPos(p: number[]): number[] {
  if (!Array.isArray(p) || p.length !== 3 || !p.every(num)) return [0, 0, 0];
  return p.map((n) => round2(clamp(n, -5000, 5000)));
}
const cleanFacing = (r: number) => (num(r) ? round2(Math.atan2(Math.sin(r), Math.cos(r))) : 0);
const cleanAct = (a: string) => (PersonAct.safeParse(a).success ? a : "walk");
function checkPeer(peerId: string) {
  if (!/^[a-z0-9]{8,40}$/.test(peerId)) fail("That peer id doesn't look right");
  return peerId;
}

const where = { pos: v.array(v.number()), facing: v.number(), act: v.string() };

/** Come on deck (or take over from your older tab, or from another ship you were on). */
export const join = mutation({
  args: { officeId: v.id("offices"), peerId: v.string(), ...where },
  handler: async (ctx, { officeId, peerId, pos, facing, act }) => {
    const { user } = await requireAboard(ctx, officeId);
    const now = Date.now();
    const rows = await ctx.db.query("presence").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    const doc = { officeId, userId: user._id, peerId: checkPeer(peerId), pos: cleanPos(pos), facing: cleanFacing(facing), act: cleanAct(act), at: now };
    const [mine, ...extra] = rows;
    for (const r of extra) await ctx.db.delete(r._id);
    if (mine) await ctx.db.patch(mine._id, { ...doc, joinedAt: mine.officeId === officeId && now - mine.at < PRESENCE.staleMs ? mine.joinedAt : now });
    else await ctx.db.insert("presence", { ...doc, joinedAt: now });
    return { now };
  },
});

async function mineFor(ctx: MutationCtx, userId: Id<"users">): Promise<Doc<"presence"> | null> {
  return ctx.db.query("presence").withIndex("by_user", (q) => q.eq("userId", userId)).first();
}

/**
 * Still here, and where: a heartbeat every few seconds, or ~5 a second while a peer-to-peer link to someone isn't up.
 * `replaced` when another tab took over (or you were taken off the ship): this one should stop.
 */
export const beat = mutation({
  args: { officeId: v.id("offices"), peerId: v.string(), ...where },
  handler: async (ctx, { officeId, peerId, pos, facing, act }) => {
    const user = await requireUser(ctx);
    const row = await mineFor(ctx, user._id);
    if (!row || row.peerId !== peerId || row.officeId !== officeId) return { now: Date.now(), replaced: true };
    await ctx.db.patch(row._id, { pos: cleanPos(pos), facing: cleanFacing(facing), act: cleanAct(act), at: Date.now() });
    return { now: Date.now(), replaced: false };
  },
});

/** Off the deck (closing the tab, leaving the ship). */
export const leave = mutation({
  args: { peerId: v.string() },
  handler: async (ctx, { peerId }) => {
    const user = await requireUser(ctx);
    const row = await mineFor(ctx, user._id);
    if (row && row.peerId === peerId) await ctx.db.delete(row._id);
  },
});

/**
 * Everyone on deck on this ship (you included), for anyone aboard: who, their look, their tab's peer id for WebRTC,
 * and their last known position (exact while they're on the fallback, a few seconds old otherwise).
 */
export const here = query({
  args: { officeId: v.id("offices") },
  handler: async (ctx, { officeId }) => {
    const { office } = await requireAboard(ctx, officeId);
    const now = Date.now();
    const rows = await ctx.db.query("presence").withIndex("by_office", (q) => q.eq("officeId", officeId)).collect();
    const out = [];
    for (const p of rows) {
      if (now - p.at > PRESENCE.staleMs) continue;
      const u = await ctx.db.get(p.userId);
      if (!u) continue;
      out.push({
        userId: p.userId, name: u.name, avatar: u.avatar ?? null, look: u.look ?? null, owner: p.userId === office.ownerId,
        peerId: p.peerId, pos: p.pos, facing: p.facing, act: p.act, joinedAt: p.joinedAt, at: p.at,
      });
    }
    return out.sort((a, b) => a.joinedAt - b.joinedAt);
  },
});

/** Every 15 s (crons.ts): whoever stopped beating has left, and signaling nobody read is thrown away. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db.query("presence").withIndex("by_at", (q) => q.lt("at", now - PRESENCE.staleMs)).take(200);
    for (const p of stale) await ctx.db.delete(p._id);
    const old = await ctx.db.query("signals").withIndex("by_at", (q) => q.lt("at", now - 120_000)).take(500);
    for (const s of old) await ctx.db.delete(s._id);
    return { presence: stale.length, signals: old.length };
  },
});
