import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { INVITE_TTL_MS, MAX_MEMBERS } from "@offsite/contracts";
import { currentUser, fail, randomCode, requireOffice, requireUser, roleOn } from "./lib";

// Invite links: the captain makes one (/join/<token>), a friend opens it, signs in and comes aboard as a member. One
// live link per ship; a new one replaces the last. Links last INVITE_TTL_MS and can be revoked.

const live = (i: Doc<"invites"> | null, now = Date.now()) => !!i && i.revokedAt === null && i.expiresAt > now;

/** The ship's live link, for its captain: { token, expiresAt } or null. */
export const current = query({
  args: { officeId: v.id("offices") },
  handler: async (ctx, { officeId }) => {
    await requireOffice(ctx, officeId);
    const latest = await ctx.db.query("invites").withIndex("by_office", (q) => q.eq("officeId", officeId)).order("desc").first();
    return latest && live(latest) ? { token: latest.token, createdAt: latest.createdAt, expiresAt: latest.expiresAt, used: latest.used } : null;
  },
});

/** A fresh link (the last one stops working). */
export const create = mutation({
  args: { officeId: v.id("offices") },
  handler: async (ctx, { officeId }) => {
    const { user } = await requireOffice(ctx, officeId);
    const now = Date.now();
    for (const old of await ctx.db.query("invites").withIndex("by_office", (q) => q.eq("officeId", officeId)).collect()) {
      if (old.revokedAt === null) await ctx.db.patch(old._id, { revokedAt: now });
    }
    // 26 characters from 32: 130 bits, not something anyone guesses.
    const token = randomCode(26);
    await ctx.db.insert("invites", { officeId, token, createdBy: user._id, createdAt: now, expiresAt: now + INVITE_TTL_MS, revokedAt: null, used: 0 });
    return { token, expiresAt: now + INVITE_TTL_MS };
  },
});

/** Stop the live link working. Friends already aboard stay. */
export const revoke = mutation({
  args: { officeId: v.id("offices") },
  handler: async (ctx, { officeId }) => {
    await requireOffice(ctx, officeId);
    const now = Date.now();
    for (const i of await ctx.db.query("invites").withIndex("by_office", (q) => q.eq("officeId", officeId)).collect()) {
      if (i.revokedAt === null) await ctx.db.patch(i._id, { revokedAt: now });
    }
  },
});

/**
 * What a link leads to, for the join page, signed in or not: the ship's name and its captain, or why it doesn't work.
 * Holding the link is what lets you see this much.
 */
export const peek = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const invite = await ctx.db.query("invites").withIndex("by_token", (q) => q.eq("token", token.trim().toUpperCase())).unique();
    if (!invite) return { ok: false as const, reason: "unknown" as const };
    if (invite.revokedAt !== null) return { ok: false as const, reason: "revoked" as const };
    if (invite.expiresAt <= Date.now()) return { ok: false as const, reason: "expired" as const };
    const office = await ctx.db.get(invite.officeId);
    if (!office) return { ok: false as const, reason: "unknown" as const };
    const owner = await ctx.db.get(office.ownerId);
    const me = await currentUser(ctx);
    const role = me ? await roleOn(ctx, office, me._id) : null;
    return {
      ok: true as const,
      officeId: office._id,
      ship: office.name,
      world: office.world,
      captain: { name: owner?.name ?? "Captain", avatar: owner?.avatar ?? null, look: owner?.look ?? null },
      expiresAt: invite.expiresAt,
      /** You're already aboard (as its captain, or a friend). */
      role,
    };
  },
});

/** Come aboard with a link: you join the ship as a member and it's the ship you board. Opening your own link just boards it. */
export const accept = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await requireUser(ctx);
    const invite = await ctx.db.query("invites").withIndex("by_token", (q) => q.eq("token", token.trim().toUpperCase())).unique();
    if (!invite) fail("That invite link doesn't work. Ask for a new one.");
    if (invite!.revokedAt !== null) fail("That invite link was turned off. Ask the captain for a new one.");
    if (invite!.expiresAt <= Date.now()) fail("That invite link has expired. Ask the captain for a new one.");
    const office = await ctx.db.get(invite!.officeId);
    if (!office) fail("That ship is gone");
    const role = await roleOn(ctx, office!, user._id);
    if (!role) {
      const aboard = await ctx.db.query("members").withIndex("by_office", (q) => q.eq("officeId", office!._id)).collect();
      if (aboard.length >= MAX_MEMBERS) fail(`${office!.name} is full: ${MAX_MEMBERS} friends are aboard already.`);
      await ctx.db.insert("members", { officeId: office!._id, userId: user._id, invitedBy: invite!.createdBy, inviteId: invite!._id, joinedAt: Date.now() });
      await ctx.db.patch(invite!._id, { used: invite!.used + 1 });
    }
    await ctx.db.patch(user._id, { aboardId: office!._id });
    return { officeId: office!._id, ship: office!.name, role: role ?? ("member" as const), joined: !role };
  },
});
