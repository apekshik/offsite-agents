import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ACTIVITY_LABEL, crewActivity, isLive, type RunState } from "@offsite/contracts";
import { fail, requireMachine, requireOwnRun } from "./lib";
import { crewByHandle, crewOf, freeCrew, hire, liveRunOf } from "./crewlib";
import { post, resolveTask, tick } from "./flow";
import { harness } from "./schema";

// The ship's computer's tools (contracts COMPUTER_TOOLS), and ask_captain for everyone. The runner
// calls these on the agent's behalf; messages say what went wrong in words the agent can act on.

type Ctx = QueryCtx | MutationCtx;

async function liveRun(ctx: Ctx, token: string, runId: Id<"runs">) {
  const machine = await requireMachine(ctx, token);
  const run = await requireOwnRun(ctx, machine, runId);
  if (!isLive(run.state as RunState)) fail("This run has ended");
  const office = (await ctx.db.get(run.officeId))!;
  return { machine, run, office };
}

async function computerRun(ctx: Ctx, token: string, runId: Id<"runs">) {
  const r = await liveRun(ctx, token, runId);
  if (r.run.kind !== "computer" || !r.run.threadId) fail("Only the ship's computer has this tool");
  const thread = (await ctx.db.get(r.run.threadId!))!;
  return { ...r, thread };
}

async function activityOf(ctx: Ctx, c: Doc<"crew">, now: number, open: Doc<"questions">[]) {
  const recent = await ctx.db.query("runs").withIndex("by_crew", (q) => q.eq("crewId", c._id)).order("desc").take(6);
  const live = recent.find((r) => isLive(r.state as RunState)) ?? null;
  const ended = recent.find((r) => !isLive(r.state as RunState) && r.endedAt !== null) ?? null;
  return crewActivity({
    now,
    arrivesAt: c.arrivesAt,
    live: live && { state: live.state as RunState },
    openItem: live?.step ? { kind: live.step.kind } : null,
    asking: open.some((q) => q.crewId === c._id),
    lastEnded: ended && { state: ended.state as RunState, endedAt: ended.endedAt! },
  });
}

export const crewStatus = query({
  args: { token: v.string(), runId: v.id("runs") },
  handler: async (ctx, { token, runId }) => {
    const { run, thread } = await computerRun(ctx, token, runId);
    const crew = (await crewOf(ctx, run.officeId)).filter((c) => c.role === "crew");
    const open = await ctx.db.query("questions").withIndex("by_office_open", (q) => q.eq("officeId", run.officeId).eq("answeredAt", null)).collect();
    const now = Date.now();
    const tasks = (await ctx.db.query("tasks").withIndex("by_thread", (q) => q.eq("threadId", thread._id)).collect()).sort((a, b) => a.createdAt - b.createdAt);
    return {
      thread: { title: thread.title, state: thread.state, branch: thread.branch, prUrl: thread.prUrl },
      crew: await Promise.all(crew.map(async (c) => {
        const live = await liveRunOf(ctx, c._id);
        const task = live?.taskId ? await ctx.db.get(live.taskId) : null;
        return { handle: c.handle, name: c.name, harness: c.harness, specialty: c.specialty, activity: ACTIVITY_LABEL[await activityOf(ctx, c, now, open)], task: task?.title ?? null };
      })),
      tasks: tasks.map((t) => ({
        id: t._id, key: t.key, title: t.title, state: t.state,
        assignee: t.assignee ? crew.find((c) => c._id === t.assignee)?.handle ?? null : null,
        dependsOn: t.dependsOn.map((id) => tasks.find((x) => x._id === id)?.key ?? id),
      })),
    };
  },
});

export const planTasks = mutation({
  args: {
    token: v.string(),
    runId: v.id("runs"),
    tasks: v.array(v.object({
      key: v.string(),
      title: v.string(),
      brief: v.string(),
      dependsOn: v.optional(v.array(v.string())),
      assignee: v.optional(v.string()),
    })),
  },
  handler: async (ctx, { token, runId, tasks }) => {
    const { run, thread } = await computerRun(ctx, token, runId);
    if (!tasks.length) fail("Plan at least one task");
    if (tasks.length > 8) fail("At most 8 tasks per plan; split the work into fewer, larger tasks");
    const existing = await ctx.db.query("tasks").withIndex("by_thread", (q) => q.eq("threadId", thread._id)).collect();
    const keys = new Map<string, Id<"tasks">>(existing.map((t) => [t.key, t._id]));
    const fresh = new Set<string>();
    for (const t of tasks) {
      if (!/^[a-z0-9-]{1,32}$/.test(t.key)) fail(`Task key "${t.key}": use 1-32 lowercase letters, digits and dashes`);
      if (fresh.has(t.key) || keys.has(t.key)) fail(`Task key "${t.key}" is already used in this thread`);
      fresh.add(t.key);
    }
    // Resolve assignees before writing anything, so a typo leaves no half-made plan.
    const assignees = new Map<string, Id<"crew"> | null>();
    for (const t of tasks) {
      const a = (t.assignee ?? "any").trim();
      assignees.set(t.key, a === "any" || a === "" ? null : (await crewByHandle(ctx, run.officeId, a))._id);
    }
    const now = Date.now();
    for (const [i, t] of tasks.entries()) {
      const id = await ctx.db.insert("tasks", {
        threadId: thread._id, officeId: run.officeId, key: t.key, title: t.title.trim().slice(0, 120), brief: t.brief.trim().slice(0, 4000),
        dependsOn: [], assignee: assignees.get(t.key) ?? null, state: "todo", branch: null, report: null, notes: null, createdAt: now + i, landedAt: null,
      });
      keys.set(t.key, id);
    }
    for (const t of tasks) {
      const deps = (t.dependsOn ?? []).map((k) => keys.get(k) ?? fail(`Task "${t.key}" depends on "${k}", which is not a task in this thread`));
      if ((t.dependsOn ?? []).includes(t.key)) fail(`Task "${t.key}" can't depend on itself`);
      await ctx.db.patch(keys.get(t.key)!, { dependsOn: deps as Id<"tasks">[] });
    }
    await post(ctx, thread._id, {
      author: { kind: "crew", crewId: run.crewId },
      kind: "plan",
      text: tasks.map((t, i) => `${i + 1}. ${t.title}`).join("\n"),
      runId,
    });
    await ctx.db.patch(thread._id, { state: "working" });
    await tick(ctx, run.officeId);
    const crew = await crewOf(ctx, run.officeId);
    return Promise.all(tasks.map(async (t) => {
      const row = (await ctx.db.get(keys.get(t.key)!))!;
      const who = crew.find((c) => c._id === row.assignee);
      return { key: t.key, taskId: row._id, assignee: who ? `@${who.handle}` : null, state: row.state };
    }));
  },
});

export const assignTask = mutation({
  args: { token: v.string(), runId: v.id("runs"), task: v.string(), crew: v.optional(v.string()) },
  handler: async (ctx, { token, runId, task: ref, crew: handle }) => {
    const { run, office, thread } = await computerRun(ctx, token, runId);
    const task = await resolveTask(ctx, thread._id, ref);
    if (task.state !== "todo") fail(`"${task.key}" is ${task.state}; only a todo task can be reassigned`);
    let who: Doc<"crew">;
    let hired = false;
    if (handle) who = await crewByHandle(ctx, run.officeId, handle);
    else {
      const free = await freeCrew(ctx, run.officeId);
      if (free[0]) who = free[0];
      else { who = await hire(ctx, office, {}); hired = true; }
    }
    await ctx.db.patch(task._id, { assignee: who._id });
    await tick(ctx, run.officeId);
    return { taskId: task._id, crew: { handle: who.handle, name: who.name, hired } };
  },
});

export const hireCrew = mutation({
  args: { token: v.string(), runId: v.id("runs"), name: v.optional(v.string()), harness: v.optional(harness), specialty: v.optional(v.string()) },
  handler: async (ctx, { token, runId, name, harness, specialty }) => {
    const { office, thread, run } = await computerRun(ctx, token, runId);
    const c = await hire(ctx, office, { name, harness, specialty });
    await post(ctx, thread._id, { author: { kind: "system" }, kind: "system", text: `${c.name} is on the way by helicopter.`, runId: run._id });
    return { handle: c.handle, name: c.name, arrivesAt: c.arrivesAt };
  },
});

export const messageCrew = mutation({
  args: { token: v.string(), runId: v.id("runs"), crew: v.string(), text: v.string() },
  handler: async (ctx, { token, runId, crew: handle, text }) => {
    const { run } = await computerRun(ctx, token, runId);
    const who = await crewByHandle(ctx, run.officeId, handle);
    const live = await liveRunOf(ctx, who._id);
    const body = `From the computer: ${text.trim().slice(0, 4000)}`;
    await ctx.db.insert("inbox", { crewId: who._id, runId: live && live.state !== "queued" ? live._id : null, text: body, deliveredAt: null, createdAt: Date.now() });
    return { delivered: live ? "to their live run" : "with their next task" };
  },
});

/** Anyone can ask the captain. The answer arrives in runner.work as an answer to this run. */
export const askCaptain = mutation({
  args: { token: v.string(), runId: v.id("runs"), question: v.string(), options: v.optional(v.array(v.string())) },
  handler: async (ctx, { token, runId, question, options }) => {
    const { run } = await liveRun(ctx, token, runId);
    const requestId = `ask-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const questionId = await ctx.db.insert("questions", {
      officeId: run.officeId, threadId: run.threadId, runId, crewId: run.crewId, requestId, kind: "input",
      prompt: question.trim().slice(0, 1000), options: options?.slice(0, 6).map((o) => o.slice(0, 120)) ?? null,
      answer: null, answeredAt: null, deliveredAt: null, createdAt: Date.now(),
    });
    return { questionId, requestId };
  },
});

export const reviewTask = query({
  args: { token: v.string(), runId: v.id("runs"), task: v.string() },
  handler: async (ctx, { token, runId, task: ref }) => {
    const { thread } = await computerRun(ctx, token, runId);
    const task = await resolveTask(ctx, thread._id, ref);
    const crew = task.assignee ? await ctx.db.get(task.assignee) : null;
    return {
      id: task._id, key: task.key, title: task.title, brief: task.brief, state: task.state, branch: task.branch, report: task.report,
      crew: crew && { handle: crew.handle, name: crew.name }, threadBranch: thread.branch,
    };
  },
});

export const sendBack = mutation({
  args: { token: v.string(), runId: v.id("runs"), task: v.string(), notes: v.string() },
  handler: async (ctx, { token, runId, task: ref, notes }) => {
    const { run, thread } = await computerRun(ctx, token, runId);
    const task = await resolveTask(ctx, thread._id, ref);
    if (!["landed", "failed", "cancelled"].includes(task.state)) fail(`"${task.key}" is ${task.state}; send it back once it has finished`);
    await ctx.db.patch(task._id, { state: "todo", notes: notes.trim().slice(0, 4000), report: null, landedAt: null });
    await tick(ctx, run.officeId);
    const crew = task.assignee ? await ctx.db.get(task.assignee) : null;
    return { taskId: task._id, crew: crew ? `@${crew.handle}` : null };
  },
});

export const finishThread = mutation({
  args: { token: v.string(), runId: v.id("runs"), title: v.string(), summary: v.string(), prUrl: v.union(v.string(), v.null()) },
  handler: async (ctx, { token, runId, title, summary, prUrl }) => {
    const { run, thread } = await computerRun(ctx, token, runId);
    if (thread.state === "done") fail(`This thread is already finished${thread.prUrl ? ` (${thread.prUrl})` : ""}. Tell the captain instead.`);
    const tasks = await ctx.db.query("tasks").withIndex("by_thread", (q) => q.eq("threadId", thread._id)).collect();
    const unfinished = tasks.filter((t) => t.state === "todo" || t.state === "doing" || t.state === "review");
    if (unfinished.length) fail(`Not every task has landed: ${unfinished.map((t) => `${t.key} (${t.state})`).join(", ")}`);
    await ctx.db.patch(thread._id, { state: "done", prUrl });
    const where = prUrl ? `Pull request: ${prUrl}` : thread.branch ? `It's on the branch ${thread.branch}.` : "";
    await post(ctx, thread._id, { author: { kind: "system" }, kind: "system", text: `${title.trim().slice(0, 120)}\n\n${summary.trim().slice(0, 4000)}\n\n${where}`.trim(), runId: run._id });
  },
});
