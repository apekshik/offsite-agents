import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { COMPUTER_HANDLE, COMPUTER_HANDLE_ALIASES, COMPUTER_NAME, LIMITS } from "@offsite/contracts";
import { capJson, fail, requireCrew, requireOffice } from "./lib";
import { crewOf, hire as hireCrew, liveRunOf } from "./crewlib";
import { harness } from "./schema";

/** Everyone aboard, Computah included (role "computer"). */
export const list = query({
  args: { officeId: v.id("offices") },
  handler: async (ctx, { officeId }) => {
    await requireOffice(ctx, officeId);
    return crewOf(ctx, officeId);
  },
});

/** Bring someone aboard by hand. They arrive by helicopter. */
export const hire = mutation({
  args: {
    officeId: v.id("offices"),
    name: v.optional(v.string()),
    harness: v.optional(harness),
    avatar: v.optional(v.any()),
    specialty: v.optional(v.string()),
  },
  handler: async (ctx, { officeId, name, harness, avatar, specialty }) => {
    const { office } = await requireOffice(ctx, officeId);
    capJson(avatar, LIMITS.lookBytes, "avatar");
    return (await hireCrew(ctx, office, { name, harness, avatar, specialty }))._id;
  },
});

const effort = v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("max"));

export const update = mutation({
  args: {
    crewId: v.id("crew"),
    name: v.optional(v.string()),
    avatar: v.optional(v.any()),
    look: v.optional(v.union(v.any(), v.null())),
    specialty: v.optional(v.union(v.string(), v.null())),
    harness: v.optional(harness),
    model: v.optional(v.union(v.string(), v.null())),
    effort: v.optional(effort),
    profile: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { crewId, ...fields }) => {
    const { crew } = await requireCrew(ctx, crewId);
    const patch: Record<string, unknown> = {};
    if (fields.name !== undefined) {
      const clean = fields.name.replace(/[\u0000-\u001f<>@]/g, "").trim().slice(0, LIMITS.nameChars);
      if (!clean) fail("A name, please");
      if (crew.role === "computer") fail(`${COMPUTER_NAME} keeps its name`);
      patch["name"] = clean; // the handle stays: Computah and threads already know it
    }
    capJson(fields.look, LIMITS.lookBytes, "look");
    capJson(fields.avatar, LIMITS.lookBytes, "avatar");
    if ((fields.model?.length ?? 0) > 100 || (fields.profile?.length ?? 0) > 300) fail("That model or profile name is too long");
    for (const k of ["avatar", "look", "harness", "model", "effort", "profile"] as const) if (fields[k] !== undefined) patch[k] = fields[k];
    if (fields.specialty !== undefined) patch["specialty"] = fields.specialty?.trim().slice(0, 200) || null;
    await ctx.db.patch(crewId, patch);
  },
});

/** Send someone home. Not while they are working. */
export const dismiss = mutation({
  args: { crewId: v.id("crew") },
  handler: async (ctx, { crewId }) => {
    const { crew } = await requireCrew(ctx, crewId);
    if (crew.role === "computer") fail(`The ship needs ${COMPUTER_NAME}`);
    if (await liveRunOf(ctx, crewId)) fail(`${crew.name} is in the middle of something. Stop their run first.`);
    const pending = await ctx.db.query("tasks").withIndex("by_assignee", (q) => q.eq("assignee", crewId)).collect();
    for (const t of pending) if (t.state === "todo") await ctx.db.patch(t._id, { assignee: null });
    await ctx.db.patch(crewId, { dismissedAt: Date.now() });
  },
});

/** Design a look from a description, on your own machine and subscription. Arrives as crew.look. */
export const describeLook = mutation({
  args: { crewId: v.id("crew"), prompt: v.string() },
  handler: async (ctx, { crewId, prompt }) => {
    const { crew } = await requireCrew(ctx, crewId);
    const text = prompt.trim().slice(0, 1000);
    if (!text) fail("Describe the look");
    if (await liveRunOf(ctx, crewId)) fail(`${crew.name} is busy; try when they are free`);
    return ctx.db.insert("runs", {
      officeId: crew.officeId,
      threadId: null,
      taskId: null,
      crewId,
      kind: "look",
      state: "queued",
      machineId: null,
      prompt: text,
      worktree: null,
      step: null,
      lastStep: null,
      error: null,
      interruptRequestedAt: null,
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
    });
  },
});

/**
 * Once, after the orchestrator became Computah: every ship's "Computer" row takes the new name and
 * the @computah handle (@computer still reaches it). Safe to run again.
 *   npx convex run crew:renameComputer
 */
export const renameComputer = internalMutation({
  args: {},
  handler: async (ctx) => {
    let seen = 0, renamed = 0;
    for (const c of await ctx.db.query("crew").collect()) {
      if (c.role !== "computer") continue;
      seen += 1;
      const patch: { name?: string; handle?: string } = {};
      if (c.name !== COMPUTER_NAME) patch.name = COMPUTER_NAME;
      if (c.handle !== COMPUTER_HANDLE && COMPUTER_HANDLE_ALIASES.includes(c.handle)) {
        const clash = await ctx.db.query("crew").withIndex("by_office_handle", (q) => q.eq("officeId", c.officeId).eq("handle", COMPUTER_HANDLE)).first();
        if (!clash) patch.handle = COMPUTER_HANDLE;
      }
      if (Object.keys(patch).length) { await ctx.db.patch(c._id, patch); renamed += 1; }
    }
    return { computers: seen, renamed };
  },
});
