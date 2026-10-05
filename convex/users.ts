import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { capJson, currentUser, fail, requireAboard, requireUser } from "./lib";

/** You, or null until users.ensure has made your row (right after signing in). */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const u = await currentUser(ctx);
    // aboardId: the ship they last went aboard (theirs or one they joined), if they chose one.
    return u ? { _id: u._id, name: u.name, email: u.email, avatar: u.avatar, look: u.look, aboardId: u.aboardId ?? null } : null;
  },
});

/** Make (or find) the signed-in person's row. Safe to call on every sign-in. */
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return fail("Sign in first");
    const existing = await currentUser(ctx);
    if (existing) return existing._id;
    const name = (identity.givenName || identity.name || identity.nickname || identity.email?.split("@")[0] || "Captain").slice(0, 20);
    // No avatar yet: the world dresses you as the captain (the kit's CAPTAIN_PRESET) until you make your own.
    return ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email: identity.email ?? null,
      avatar: null,
      look: null,
      createdAt: Date.now(),
    });
  },
});

/** Go aboard one of your ships, or one you joined (the ship switcher). Null: your newest own ship. */
export const board = mutation({
  args: { officeId: v.union(v.id("offices"), v.null()) },
  handler: async (ctx, { officeId }) => {
    const user = officeId ? (await requireAboard(ctx, officeId)).user : await requireUser(ctx);
    await ctx.db.patch(user._id, { aboardId: officeId });
  },
});

export const setAvatar = mutation({
  args: { avatar: v.any(), look: v.optional(v.union(v.any(), v.null())) },
  handler: async (ctx, { avatar, look }) => {
    const user = await requireUser(ctx);
    capJson(avatar, 16_000, "avatar");
    capJson(look, 16_000, "look");
    await ctx.db.patch(user._id, { avatar, ...(look !== undefined ? { look } : {}) });
  },
});

export const setName = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const user = await requireUser(ctx);
    const clean = name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 20);
    if (!clean) fail("A name, please");
    await ctx.db.patch(user._id, { name: clean });
  },
});
