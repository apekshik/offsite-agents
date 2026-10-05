import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { fail, limit, ONLINE_MS, randomCode, randomToken, requireUser, sha256 } from "./lib";

// Pairing a machine by device code: the runner shows a code, the signed-in captain approves it in
// the app, and the runner's next poll gets its token (once). Adapted from Beam (MIT).

const CODE_TTL = 15 * 60_000;
/**
 * Anyone can ask for a code (the runner has no session), so new codes are capped across everyone, and so are codes
 * waiting at once. A user code is 8 characters from 32 (40 bits), and a captain gets a few misses before lookups pause.
 */
export const PAIRING = { startsPerMinute: 60, maxPending: 2_000, missesPerUser: 10, missWindowMs: 10 * 60_000 } as const;
export const BUSY = "Too many machines are pairing right now. Try again in a minute.";

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

type Found = { ok: true; row: Doc<"deviceCodes"> } | { ok: false; error: string };

/**
 * The code a captain typed, still waiting. A miss counts against them: past PAIRING.missesPerUser in a window, every
 * lookup fails until it passes, so nobody can walk the code space to pair someone else's machine to their own ship.
 * Lookups are mutations for this reason (a query can't count); they return misses rather than throw, so the count sticks.
 */
async function findCode(ctx: MutationCtx, user: Doc<"users">, userCode: string): Promise<Found> {
  const key = `pair-miss:${user._id}`;
  const spent = await ctx.db.query("rateLimits").withIndex("by_key", (q) => q.eq("key", key)).unique();
  const tooMany = { ok: false as const, error: "Too many codes that didn't match. Wait ten minutes, then run `npx offsite-agents` again for a fresh one." };
  if (spent && Date.now() - spent.windowStart < PAIRING.missWindowMs && spent.count >= PAIRING.missesPerUser) return tooMany;
  const row = await ctx.db.query("deviceCodes").withIndex("by_user_code", (q) => q.eq("userCode", userCode.trim().toUpperCase())).first();
  if (row && row.status === "pending" && row.expiresAt >= Date.now()) return { ok: true, row };
  if (!(await limit(ctx, key, PAIRING.missesPerUser, PAIRING.missWindowMs))) return tooMany;
  return { ok: false, error: "No machine is waiting with that code. Codes last 15 minutes; run `npx offsite-agents` again for a new one." };
}

/** What the runner asking with this code said it is, for the approval screen. */
export const lookup = mutation({
  args: { userCode: v.string() },
  handler: async (ctx, { userCode }) => {
    const found = await findCode(ctx, await requireUser(ctx), userCode);
    return found.ok ? { ok: true as const, name: found.row.name, hostname: found.row.hostname, os: found.row.os ?? null } : found;
  },
});

/** Pair the machine waiting with this code to your account. `ok: false` says why not. */
export const approve = mutation({
  args: { userCode: v.string() },
  handler: async (ctx, { userCode }) => {
    const user = await requireUser(ctx);
    const found = await findCode(ctx, user, userCode);
    if (!found.ok) return found;
    const { row } = found;
    const token = randomToken("ofr_");
    const now = Date.now();
    const machineId = await ctx.db.insert("machines", {
      ownerId: user._id, name: row.name, hostname: row.hostname, tokenHash: await sha256(token), lastSeenAt: now, probe: [], createdAt: now, revokedAt: null,
    });
    await ctx.db.patch(row._id, { status: "approved", ownerId: user._id, token });
    return { ok: true as const, machineId, name: row.name };
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
  args: { name: v.string(), hostname: v.string(), os: v.optional(v.string()) },
  handler: async (ctx, { name, hostname, os }) => {
    // Refusing writes nothing, so throwing is fine here; http.ts answers 429.
    if (!(await limit(ctx, "device-start", PAIRING.startsPerMinute, 60_000))) fail(BUSY);
    const waiting = await ctx.db.query("deviceCodes").withIndex("by_expires", (q) => q.gt("expiresAt", Date.now())).take(PAIRING.maxPending);
    if (waiting.length >= PAIRING.maxPending) fail(BUSY);
    const deviceCode = randomToken("ofd_");
    const userCode = `${randomCode(4)}-${randomCode(4)}`;
    await ctx.db.insert("deviceCodes", {
      deviceCode, userCode, name: name.slice(0, 60) || "My machine", hostname: hostname.slice(0, 60), ...(os ? { os: os.slice(0, 40) } : {}), status: "pending", ownerId: null, token: null, expiresAt: Date.now() + CODE_TTL,
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

/** Hourly (crons.ts): codes past their time, approved or not (an approved one holds a token until polled), and spent rate-limit windows. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const codes = await ctx.db.query("deviceCodes").withIndex("by_expires", (q) => q.lt("expiresAt", now - 5 * 60_000)).take(500);
    for (const c of codes) await ctx.db.delete(c._id);
    const windows = await ctx.db.query("rateLimits").withIndex("by_window", (q) => q.lt("windowStart", now - 60 * 60_000)).take(500);
    for (const w of windows) await ctx.db.delete(w._id);
    return { codes: codes.length, windows: windows.length };
  },
});
