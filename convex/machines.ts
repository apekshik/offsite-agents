import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { fail, ONLINE_MS, randomCode, randomToken, requireUser, sha256 } from "./lib";

// Pairing a machine by device code: the runner shows a code, the signed-in captain approves it in
// the app, and the runner's next poll gets its token (once). Adapted from Beam (MIT).

const CODE_TTL = 15 * 60_000;

/** Your machines, with whether each has checked in lately and what it found. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx).catch(() => null);
    if (!user) return [];
    const rows = await ctx.db.query("machines").withIndex("by_owner", (q) => q.eq("ownerId", user._id)).collect();
    const now = Date.now();
    return rows.filter((m) => !m.revokedAt).map((m) => ({
      _id: m._id, name: m.name, hostname: m.hostname, lastSeenAt: m.lastSeenAt, online: now - m.lastSeenAt < ONLINE_MS, probe: m.probe,
    }));
  },
});

/** What the runner asking with this code said it is, for the approval screen. */
export const pending = query({
  args: { userCode: v.string() },
  handler: async (ctx, { userCode }) => {
    await requireUser(ctx);
    const row = await ctx.db.query("deviceCodes").withIndex("by_user_code", (q) => q.eq("userCode", userCode.trim().toUpperCase())).first();
    if (!row || row.status !== "pending" || row.expiresAt < Date.now()) return null;
    return { name: row.name, hostname: row.hostname };
  },
});

export const approve = mutation({
  args: { userCode: v.string() },
  handler: async (ctx, { userCode }) => {
    const user = await requireUser(ctx);
    const row = await ctx.db.query("deviceCodes").withIndex("by_user_code", (q) => q.eq("userCode", userCode.trim().toUpperCase())).first();
    if (!row || row.status !== "pending" || row.expiresAt < Date.now()) fail("That code has expired or was already used. Run `offsite login` again.");
    const token = randomToken("ofr_");
    const now = Date.now();
    const machineId = await ctx.db.insert("machines", {
      ownerId: user._id, name: row!.name, hostname: row!.hostname, tokenHash: await sha256(token), lastSeenAt: now, probe: [], createdAt: now, revokedAt: null,
    });
    await ctx.db.patch(row!._id, { status: "approved", ownerId: user._id, token });
    return { machineId, name: row!.name };
  },
});

export const deny = mutation({
  args: { userCode: v.string() },
  handler: async (ctx, { userCode }) => {
    await requireUser(ctx);
    const row = await ctx.db.query("deviceCodes").withIndex("by_user_code", (q) => q.eq("userCode", userCode.trim().toUpperCase())).first();
    if (row && row.status === "pending") await ctx.db.patch(row._id, { status: "denied" });
  },
});

/** Disconnect a machine. Its runner stops being able to do anything. */
export const revoke = mutation({
  args: { machineId: v.id("machines") },
  handler: async (ctx, { machineId }) => {
    const user = await requireUser(ctx);
    const m = await ctx.db.get(machineId);
    if (!m || m.ownerId !== user._id) fail("That machine is not yours");
    await ctx.db.patch(machineId, { revokedAt: Date.now() });
  },
});

// ---- the runner's side, over HTTP (convex/http.ts) ----

export const startCode = internalMutation({
  args: { name: v.string(), hostname: v.string() },
  handler: async (ctx, { name, hostname }) => {
    const deviceCode = randomToken("ofd_");
    const userCode = `${randomCode(4)}-${randomCode(4)}`;
    await ctx.db.insert("deviceCodes", {
      deviceCode, userCode, name: name.slice(0, 60) || "My machine", hostname: hostname.slice(0, 60), status: "pending", ownerId: null, token: null, expiresAt: Date.now() + CODE_TTL,
    });
    return { deviceCode, userCode, expiresIn: CODE_TTL / 1000 };
  },
});

/** The token, handed out once; the row goes when it has been. */
export const pollCode = internalMutation({
  args: { deviceCode: v.string() },
  handler: async (ctx, { deviceCode }) => {
    const row = await ctx.db.query("deviceCodes").withIndex("by_device", (q) => q.eq("deviceCode", deviceCode)).first();
    if (!row) return { status: "expired" as const };
    if (row.expiresAt < Date.now() && row.status === "pending") { await ctx.db.delete(row._id); return { status: "expired" as const }; }
    if (row.status === "denied") { await ctx.db.delete(row._id); return { status: "denied" as const }; }
    if (row.status === "approved" && row.token) { await ctx.db.delete(row._id); return { status: "approved" as const, token: row.token }; }
    return { status: "pending" as const };
  },
});
