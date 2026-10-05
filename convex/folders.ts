import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { FOLDER_LIMITS, FolderResult } from "@offsite/contracts";
import { fail, limit, ONLINE_MS, requireMachine, requireUser } from "./lib";

// Finding repos to add, on one of the captain's machines: a scan of the usual places for git repos, or one level of
// folders under a path (Browse). The app asks (scan, browse), a row waits as "pending", the runner on that machine
// looks (work → put), and the app reads it (get). Only the owner reads a row, and each is deleted FOLDER_LIMITS.ttlMs
// after it was asked for (a scheduled delete, and the sweep in crons.ts as a backstop). Asking is rate limited per
// captain; asking again within a few seconds reuses the answer in hand rather than counting.

export const FOLDERS = {
  /** Scans per captain per window (a scan walks a few thousand folders). */
  scans: 12,
  /** Browse listings per captain per window (one folder each, so many more). */
  browses: 150,
  windowMs: 10 * 60_000,
  /** An answer this fresh is reused rather than asked for again. */
  reuseMs: 60_000,
  /** A request still pending this long after it was asked is asked again. */
  pendingMs: 30_000,
  /** The runner is offered requests at most this old. */
  offerMs: 2 * 60_000,
} as const;

async function ownOnlineMachine(ctx: MutationCtx, user: Doc<"users">, machineId: Id<"machines">) {
  const machine = await ctx.db.get(machineId);
  if (!machine || machine.ownerId !== user._id || machine.revokedAt) fail("That machine is not yours");
  if (Date.now() - machine!.lastSeenAt > ONLINE_MS) fail(`${machine!.name} is offline; start the runner on it to see its folders`);
  return machine!;
}

/** "~", "~/Developer", or (typed) an absolute path. No `..`: walking up is the parent link's job. */
function checkBrowsePath(path: string, typed: boolean): string {
  const p = path.trim().replace(/(.)[\\/]+$/, "$1").slice(0, 1000);
  if (p.split(/[\\/]/).includes("..")) fail("Give the folder's full path, without ..");
  if (p === "~" || p.startsWith("~/")) return p;
  if (!typed) fail("Browse starts in your home folder (~)");
  if (!p.startsWith("/") && !/^[a-z]:[\\/]/i.test(p)) fail("Give the folder's full path, e.g. ~/code or /srv/code");
  return p;
}

async function ask(ctx: MutationCtx, row: Omit<Doc<"folderRequests">, "_id" | "_creationTime">): Promise<Id<"folderRequests">> {
  const id = await ctx.db.insert("folderRequests", row);
  await ctx.scheduler.runAt(row.expiresAt, internal.folders.expire, { requestId: id });
  return id;
}

const fresh = (r: Doc<"folderRequests">, now: number) =>
  (r.state === "pending" && now - r.requestedAt < FOLDERS.pendingMs) || (r.state !== "pending" && now - (r.answeredAt ?? 0) < FOLDERS.reuseMs);

/** Look for git repos in the usual places on a machine. Returns the request to watch with `get`. `again` skips a recent answer. */
export const scan = mutation({
  args: { machineId: v.id("machines"), again: v.optional(v.boolean()) },
  handler: async (ctx, { machineId, again }) => {
    const user = await requireUser(ctx);
    await ownOnlineMachine(ctx, user, machineId);
    const now = Date.now();
    const mine = await ctx.db.query("folderRequests").withIndex("by_owner", (q) => q.eq("ownerId", user._id).eq("machineId", machineId).eq("kind", "scan")).collect();
    const latest = mine.filter((r) => r.expiresAt > now).sort((a, b) => b.requestedAt - a.requestedAt)[0];
    if (latest && (latest.state === "pending" ? now - latest.requestedAt < FOLDERS.pendingMs : !again && fresh(latest, now))) return latest._id;
    if (!(await limit(ctx, `folder-scan:${user._id}`, FOLDERS.scans, FOLDERS.windowMs))) {
      if (latest) return latest._id;
      fail("That's a lot of looking. Wait a few minutes, or browse or type a path.");
    }
    return ask(ctx, {
      ownerId: user._id, machineId, kind: "scan", path: null, typed: false, state: "pending",
      requestedAt: now, answeredAt: null, expiresAt: now + FOLDER_LIMITS.ttlMs, result: null, error: null,
    });
  },
});

/** List the folders in one folder on a machine. `typed`: the captain typed the path, so it may be outside home. */
export const browse = mutation({
  args: { machineId: v.id("machines"), path: v.optional(v.string()), typed: v.optional(v.boolean()) },
  handler: async (ctx, { machineId, path, typed = false }) => {
    const user = await requireUser(ctx);
    await ownOnlineMachine(ctx, user, machineId);
    const where = checkBrowsePath(path ?? "~", typed);
    const now = Date.now();
    const mine = await ctx.db.query("folderRequests").withIndex("by_owner", (q) => q.eq("ownerId", user._id).eq("machineId", machineId).eq("kind", "browse")).collect();
    const same = mine.filter((r) => r.path === where && r.expiresAt > now && fresh(r, now)).sort((a, b) => b.requestedAt - a.requestedAt)[0];
    if (same) return same._id;
    if (!(await limit(ctx, `folder-browse:${user._id}`, FOLDERS.browses, FOLDERS.windowMs))) fail("That's a lot of browsing. Wait a few minutes, or type the path.");
    return ask(ctx, {
      ownerId: user._id, machineId, kind: "browse", path: where, typed, state: "pending",
      requestedAt: now, answeredAt: null, expiresAt: now + FOLDER_LIMITS.ttlMs, result: null, error: null,
    });
  },
});

/** A scan or a listing: pending, ready with what the runner found, or failed with why. Null once it has expired. Owner only. */
export const get = query({
  args: { requestId: v.id("folderRequests") },
  handler: async (ctx, { requestId }) => {
    const user = await requireUser(ctx);
    const r = await ctx.db.get(requestId);
    if (!r || r.ownerId !== user._id || r.expiresAt <= Date.now()) return null;
    return {
      _id: r._id, kind: r.kind, path: r.path, state: r.state, requestedAt: r.requestedAt, answeredAt: r.answeredAt,
      result: r.result as FolderResult | null, error: r.error,
    };
  },
});

// ---- the runner's side ----

/** Scans and listings asked of this machine. The runner subscribes to it. */
export const work = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const machine = await requireMachine(ctx, token);
    const pending = await ctx.db.query("folderRequests").withIndex("by_machine", (q) => q.eq("machineId", machine._id).eq("state", "pending")).take(20);
    const now = Date.now();
    return {
      requests: pending.filter((r) => now - r.requestedAt < FOLDERS.offerMs).map((r) => ({ requestId: r._id, kind: r.kind, path: r.path, typed: r.typed })),
    };
  },
});

/** What the runner found (a contracts FolderResult of the request's kind), or why it couldn't look. */
export const put = mutation({
  args: { token: v.string(), requestId: v.id("folderRequests"), result: v.optional(v.any()), error: v.optional(v.string()) },
  handler: async (ctx, { token, requestId, result, error }) => {
    const machine = await requireMachine(ctx, token);
    const row = await ctx.db.get(requestId);
    // Expired (deleted) while the runner looked: nothing to write, and nothing wrong.
    if (!row) return { kept: false };
    if (row.machineId !== machine._id) fail("That request isn't this machine's");
    const now = Date.now();
    if (error !== undefined) {
      await ctx.db.patch(requestId, { state: "failed", answeredAt: now, error: error.slice(0, 500), result: null });
      return { kept: true };
    }
    const parsed = FolderResult.safeParse(result);
    if (!parsed.success) fail(`That answer doesn't fit the format: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message ?? ""}`.trim());
    if (parsed.data!.kind !== row.kind) fail(`That request is a ${row.kind}, not a ${parsed.data!.kind}`);
    await ctx.db.patch(requestId, { state: "ready", answeredAt: now, result: parsed.data, error: null });
    return { kept: true };
  },
});

// ---- expiry ----

/** Scheduled for each request at its expiry. */
export const expire = internalMutation({
  args: { requestId: v.id("folderRequests") },
  handler: async (ctx, { requestId }) => {
    if (await ctx.db.get(requestId)) await ctx.db.delete(requestId);
  },
});

/** Every few minutes (crons.ts): anything past its expiry that a scheduled delete missed. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db.query("folderRequests").withIndex("by_expires", (q) => q.lte("expiresAt", Date.now())).take(500);
    for (const r of old) await ctx.db.delete(r._id);
    return { deleted: old.length };
  },
});

/** A disconnected machine's answers go with it. */
export async function forgetMachine(ctx: MutationCtx, machineId: Id<"machines">) {
  for (const state of ["pending", "ready", "failed"] as const) {
    const rows = await ctx.db.query("folderRequests").withIndex("by_machine", (q) => q.eq("machineId", machineId).eq("state", state)).collect();
    for (const r of rows) await ctx.db.delete(r._id);
  }
}
