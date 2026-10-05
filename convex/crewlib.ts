import { ARRIVAL, AVATAR_PARTS, DEFAULT_AVATAR, LIMITS, freshName, handleFor, isLive, type AvatarSpec, type RunState } from "@offsite/contracts";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { fail } from "./lib";

type Ctx = QueryCtx | MutationCtx;

// Who is aboard, who is free, and hiring. Shared by the app's mutations and the computer's tools.

const SKIN = ["#f1d2b8", "#e8b894", "#d39b72", "#b57a53", "#8d5a3b", "#5f3b26"];
const HAIR = ["#2b1d14", "#5a3a22", "#a8692f", "#d9b45b", "#1d1d22", "#b9bcc0", "#c2432e"];
const CLOTHES = ["#f4f1ea", "#3d6fd4", "#e85d75", "#2dd4bf", "#ffb84d", "#7c5cff", "#1d2a44", "#5cc26b", "#ff7a45", "#e9e2cf"];

/** A small seeded random, so the same seed always makes the same person. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

/** A fresh, plausible crew member. The app's customizer and the kit's presets can replace it. */
export function randomAvatar(seed: number): AvatarSpec {
  const r = rng(seed);
  return {
    ...DEFAULT_AVATAR,
    hair: pick(r, AVATAR_PARTS.hair),
    head: pick(r, ["box", "round", "box", "round", "cat"] as const),
    face: pick(r, ["dots", "smile", "dots", "smile", "visor"] as const),
    build: pick(r, AVATAR_PARTS.build),
    skin: pick(r, SKIN),
    hairColor: pick(r, HAIR),
    top: pick(r, CLOTHES),
    bottom: pick(r, ["#2a2f3d", "#1d2a44", "#e9e2cf", "#3b3b3b", "#4a6fa5"]),
    accent: pick(r, CLOTHES),
    height: Math.round((0.92 + r() * 0.16) * 100) / 100,
    bulk: Math.round((0.9 + r() * 0.25) * 100) / 100,
  };
}

export async function crewOf(ctx: Ctx, officeId: Id<"offices">): Promise<Doc<"crew">[]> {
  const all = await ctx.db.query("crew").withIndex("by_office", (q) => q.eq("officeId", officeId)).collect();
  return all.filter((c) => c.dismissedAt === null);
}

export async function computerOf(ctx: Ctx, officeId: Id<"offices">): Promise<Doc<"crew">> {
  const crew = await crewOf(ctx, officeId);
  return crew.find((c) => c.role === "computer") ?? fail("This ship has no computer");
}

export async function crewByHandle(ctx: Ctx, officeId: Id<"offices">, handle: string): Promise<Doc<"crew">> {
  const h = handle.replace(/^@/, "").toLowerCase();
  const c = await ctx.db.query("crew").withIndex("by_office_handle", (q) => q.eq("officeId", officeId).eq("handle", h)).first();
  if (!c || c.dismissedAt !== null) {
    const names = (await crewOf(ctx, officeId)).filter((x) => x.role === "crew").map((x) => x.handle).join(", ");
    fail(`Nobody aboard is called "${handle}". Crew: ${names || "none yet"}`);
  }
  return c!;
}

/** Their live run, if any. */
export async function liveRunOf(ctx: Ctx, crewId: Id<"crew">): Promise<Doc<"runs"> | null> {
  const recent = await ctx.db.query("runs").withIndex("by_crew", (q) => q.eq("crewId", crewId)).order("desc").take(8);
  return recent.find((r) => isLive(r.state as RunState)) ?? null;
}

/**
 * Crew with nothing on: no live run and no task waiting on them. Longest idle first, so work spreads
 * around the deck instead of landing on the same person every time.
 */
export async function freeCrew(ctx: Ctx, officeId: Id<"offices">, reserved: Set<string> = new Set()): Promise<Doc<"crew">[]> {
  const crew = (await crewOf(ctx, officeId)).filter((c) => c.role === "crew" && !reserved.has(c._id));
  const free: { c: Doc<"crew">; since: number }[] = [];
  for (const c of crew) {
    if (await liveRunOf(ctx, c._id)) continue;
    const pending = await ctx.db.query("tasks").withIndex("by_assignee", (q) => q.eq("assignee", c._id)).collect();
    if (pending.some((t) => t.state === "todo" || t.state === "doing" || t.state === "review")) continue;
    const last = await ctx.db.query("runs").withIndex("by_crew", (q) => q.eq("crewId", c._id)).order("desc").first();
    free.push({ c, since: last?.endedAt ?? c.arrivesAt });
  }
  return free.sort((a, b) => a.since - b.since).map((f) => f.c);
}

/**
 * Bring someone aboard. They arrive by helicopter: hires close together share one flight, so a
 * burst of hiring is one helicopter dropping off a few people.
 */
export async function hire(
  ctx: MutationCtx,
  office: Doc<"offices">,
  opts: { name?: string | undefined; harness?: "claude" | "codex" | "sim" | undefined; specialty?: string | undefined; avatar?: unknown; look?: unknown; aboard?: boolean },
): Promise<Doc<"crew">> {
  const crew = await crewOf(ctx, office._id);
  if (crew.filter((c) => c.role === "crew").length >= LIMITS.maxCrew) fail(`The ship is full: ${LIMITS.maxCrew} crew aboard. Give work to someone free instead.`);
  const now = Date.now();
  const seed = Math.floor(now % 100_000) + crew.length * 7919;
  const name = (opts.name?.replace(/[\u0000-\u001f<>@]/g, "").trim().slice(0, LIMITS.nameChars)) || freshName(crew.map((c) => c.name), seed);
  let handle = handleFor(name);
  const taken = new Set(crew.map((c) => c.handle));
  for (let n = 2; taken.has(handle); n++) handle = `${handleFor(name)}-${n}`;
  let arrivesAt = now;
  if (!opts.aboard) {
    // Share a flight still on its way in.
    const inbound = crew.map((c) => c.arrivesAt).filter((t) => t - now > 5_000).sort((a, b) => a - b)[0];
    arrivesAt = inbound ?? now + ARRIVAL.approachMs;
  }
  const id = await ctx.db.insert("crew", {
    officeId: office._id,
    role: "crew",
    name,
    handle,
    avatar: opts.avatar ?? randomAvatar(seed),
    look: opts.look ?? null,
    specialty: opts.specialty?.slice(0, 200) ?? null,
    harness: opts.harness ?? office.defaultHarness,
    model: null,
    effort: "medium",
    profile: null,
    hiredAt: now,
    arrivesAt,
    dismissedAt: null,
  });
  return (await ctx.db.get(id))!;
}
