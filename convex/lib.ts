import { ConvexError } from "convex/values";
import { runnerCommand } from "@offsite/contracts";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

/**
 * Production Convex tells a client only "Server Error" for a thrown Error; a ConvexError keeps its
 * message. The runner relays these to agents, who need the reason to act on it.
 */
export const fail = (message: string): never => { throw new ConvexError(message); };

/** The signed-in person's user row, or null before users.ensure has run. */
export async function currentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
}

/** Free-form JSON the app stores as given (avatars, looks) stays small. */
export function capJson(value: unknown, maxBytes: number, what: string): void {
  if (value !== undefined && JSON.stringify(value ?? null).length > maxBytes) fail(`That ${what} is too big`);
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  return (await currentUser(ctx)) ?? fail("Sign in first");
}

// Who may do what on a ship. The owner (the captain) does everything. A member (a friend the owner invited) reads
// everything and talks in threads; the machines, repos, crew, settings and invites stay the owner's. A ship anyone else
// asks about is "No such ship", whether or not it exists.

/** The owner, or a friend aboard. */
export type Role = "owner" | "member";

/** Is this person aboard this ship, and as what? Null when they aren't. */
export async function roleOn(ctx: Ctx, office: Doc<"offices">, userId: Id<"users">): Promise<Role | null> {
  if (office.ownerId === userId) return "owner";
  const row = await ctx.db.query("members").withIndex("by_office_user", (q) => q.eq("officeId", office._id).eq("userId", userId)).unique();
  return row ? "member" : null;
}

/** The ship, for its owner only: machines, repos, crew, settings, invites. */
export async function requireOffice(ctx: Ctx, officeId: Id<"offices">): Promise<{ user: Doc<"users">; office: Doc<"offices"> }> {
  const user = await requireUser(ctx);
  const office = await ctx.db.get(officeId);
  if (!office || office.ownerId !== user._id) {
    // A member asking for something that is the owner's: say so, rather than pretend the ship isn't there.
    if (office && (await roleOn(ctx, office, user._id))) fail("Only the captain can do that on this ship");
    fail("No such ship");
  }
  return { user, office: office! };
}

/** The ship, for anyone aboard: its owner or a member. Reading it, and talking to Computah. */
export async function requireAboard(ctx: Ctx, officeId: Id<"offices">): Promise<{ user: Doc<"users">; office: Doc<"offices">; role: Role }> {
  const user = await requireUser(ctx);
  const office = await ctx.db.get(officeId);
  const role = office ? await roleOn(ctx, office, user._id) : null;
  if (!office || !role) fail("No such ship");
  return { user, office: office!, role: role! };
}

/** A thread, for its ship's owner only. */
export async function requireThread(ctx: Ctx, threadId: Id<"threads">) {
  const thread = await ctx.db.get(threadId);
  if (!thread) fail("No such thread");
  const { user, office } = await requireOffice(ctx, thread!.officeId);
  return { user, office, thread: thread! };
}

/** A thread, for anyone aboard its ship. */
export async function requireThreadAboard(ctx: Ctx, threadId: Id<"threads">) {
  const thread = await ctx.db.get(threadId);
  if (!thread) fail("No such thread");
  const { user, office, role } = await requireAboard(ctx, thread!.officeId);
  return { user, office, role, thread: thread! };
}

/** A crew member, for their ship's owner only. */
export async function requireCrew(ctx: Ctx, crewId: Id<"crew">) {
  const crew = await ctx.db.get(crewId);
  if (!crew) fail("No such crew member");
  const { user, office } = await requireOffice(ctx, crew!.officeId);
  return { user, office, crew: crew! };
}

/** Members may start threads and talk to Computah unless the owner turned that off. */
export function requireCanAsk(office: Doc<"offices">, role: Role): void {
  if (role === "member" && office.membersCanAsk === false) fail("The captain has turned off asking Computah for friends aboard");
}

/** How a person aboard is named to Computah and in the thread. */
export async function personName(ctx: Ctx, userId: Id<"users"> | undefined | null): Promise<string> {
  const u = userId ? await ctx.db.get(userId) : null;
  return u?.name ?? "Someone";
}

// ---- machine tokens ----

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function randomCode(len: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(buf, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
export function randomToken(prefix: string): string {
  const buf = crypto.getRandomValues(new Uint8Array(32));
  return prefix + Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * At most `max` calls per `windowMs` for `key`, counted in a fixed window: false once the window is full. Convex sees
 * no trustworthy client IP (forwarding headers can be forged), so keys are global or per user.
 */
export async function limit(ctx: MutationCtx, key: string, max: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const row = await ctx.db.query("rateLimits").withIndex("by_key", (q) => q.eq("key", key)).unique();
  if (!row) { await ctx.db.insert("rateLimits", { key, windowStart: now, count: 1 }); return true; }
  if (now - row.windowStart >= windowMs) { await ctx.db.patch(row._id, { windowStart: now, count: 1 }); return true; }
  if (row.count >= max) return false;
  await ctx.db.patch(row._id, { count: row.count + 1 });
  return true;
}

/** The machine a runner token belongs to. Every runner-facing function starts here. */
export async function requireMachine(ctx: Ctx, token: string): Promise<Doc<"machines">> {
  const hash = await sha256(token);
  const machine = await ctx.db.query("machines").withIndex("by_hash", (q) => q.eq("tokenHash", hash)).unique();
  if (!machine || machine.revokedAt) fail(`This machine is not paired, or was disconnected. Run \`${runnerCommand("login")}\` again.`);
  return machine!;
}

/** A run this machine claimed, still live. */
export async function requireOwnRun(ctx: Ctx, machine: Doc<"machines">, runId: Id<"runs">): Promise<Doc<"runs">> {
  const run = await ctx.db.get(runId);
  if (!run || run.machineId !== machine._id) fail("This run is not this machine's");
  return run!;
}

/** "Fix the flaky login test" from what the captain typed. */
export function autoTitle(text: string): string {
  const words = text.replace(/`/g, "").trim().split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
  const t = (words || "Untitled").replace(/[.,;:!?]+$/, "");
  return t.length > 60 ? t.slice(0, 60).replace(/\s+\S*$/, "") + "…" : t;
}

export const ONLINE_MS = 90_000;
