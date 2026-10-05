import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { DEFAULT_AVATAR } from "@offsite/contracts";
import { currentUser, fail, requireUser } from "./lib";

/** You, or null until users.ensure has made your row (right after signing in). */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const u = await currentUser(ctx);
    return u ? { _id: u._id, name: u.name, email: u.email, avatar: u.avatar, look: u.look } : null;
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
    // The captain's hat is a designed look the app adds in the customizer; the default figure starts plain.
    return ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email: identity.email ?? null,
      avatar: { ...DEFAULT_AVATAR, top: "#f4f1ea", bottom: "#1d2a44", accent: "#c9a24a" },
      look: null,
      createdAt: Date.now(),
    });
  },
});

export const setAvatar = mutation({
  args: { avatar: v.any(), look: v.optional(v.union(v.any(), v.null())) },
  handler: async (ctx, { avatar, look }) => {
    const user = await requireUser(ctx);
    if (JSON.stringify(look ?? null).length > 16_000) fail("That look is too big");
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
