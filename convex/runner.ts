import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { LIMITS, Look, RunEvent, isLive, type RunState } from "@offsite/contracts";
import { fail, requireMachine, requireOwnRun } from "./lib";
import { crewOf, liveRunOf } from "./crewlib";
import { closeStream, post, queueComputer, tick } from "./flow";
import { computerMachine, ensureRepos, repoOfTask, reposOf } from "./repolib";
import { changeStats } from "./schema";

// What `offsite` (packages/runner) calls. Every function takes the machine's token. See
// docs/runner-api.md. Errors are ConvexErrors with a reason an agent can act on.

const LIVE_HERE = ["starting", "working", "landing"] as const;

/** Check in: the machine is alive, and here is what its harnesses look like. */
export const hello = mutation({
  args: { token: v.string(), probe: v.any(), fresh: v.optional(v.boolean()) },
  handler: async (ctx, { token, probe, fresh }) => {
    const machine = await requireMachine(ctx, token);
    await ctx.db.patch(machine._id, { lastSeenAt: Date.now(), ...(probe ? { probe } : {}) });
    if (fresh) {
      // A runner that just started holds no sessions: whatever it had claimed before is gone.
      for (const state of LIVE_HERE) {
        const runs = await ctx.db.query("runs").withIndex("by_machine", (q) => q.eq("machineId", machine._id).eq("state", state)).collect();
        for (const run of runs) await endRun(ctx, run, "failed", "The runner stopped before this finished", null);
      }
    }
    const owner = await ctx.db.get(machine.ownerId);
    return { machineId: machine._id, owner: { name: owner?.name ?? "Captain" } };
  },
});

/** Subscribe to this: runs to claim, and what the live ones need (stops, messages, answers). */
export const work = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const machine = await requireMachine(ctx, token);
    const offices = await ctx.db.query("offices").withIndex("by_owner", (q) => q.eq("ownerId", machine.ownerId)).collect();
    const queued: { runId: Id<"runs">; kind: Doc<"runs">["kind"]; crewId: Id<"crew">; createdAt: number }[] = [];
    for (const office of offices) {
      const runs = await ctx.db.query("runs").withIndex("by_office_state", (q) => q.eq("officeId", office._id).eq("state", "queued")).collect();
      if (!runs.length) continue;
      const repos = await reposOf(ctx, office);
      for (const r of runs) {
        // A look runs anywhere; the computer where the first repo is; a task where its repo is.
        const task = r.kind === "task" && r.taskId ? await ctx.db.get(r.taskId) : null;
        const at = r.kind === "look" ? machine._id : r.kind === "computer" ? computerMachine(repos) : task ? repoOfTask(task, repos)?.machineId : null;
        if (at === machine._id) queued.push({ runId: r._id, kind: r.kind, crewId: r.crewId, createdAt: r.createdAt });
      }
    }
    const live = [];
    for (const state of LIVE_HERE) {
      const runs = await ctx.db.query("runs").withIndex("by_machine", (q) => q.eq("machineId", machine._id).eq("state", state)).collect();
      for (const run of runs) {
        const inbox = (await ctx.db.query("inbox").withIndex("by_crew", (q) => q.eq("crewId", run.crewId).eq("deliveredAt", null)).collect())
          .filter((m) => m.runId === run._id);
        const answers = (await ctx.db.query("questions").withIndex("by_run", (q) => q.eq("runId", run._id)).collect())
          .filter((q) => q.answeredAt !== null && q.deliveredAt === null);
        live.push({
          runId: run._id,
          state: run.state,
          interruptRequested: run.interruptRequestedAt !== null,
          inbox: inbox.map((m) => ({ id: m._id, text: m.text })),
          answers: answers.map((q) => ({ questionId: q._id, requestId: q.requestId, answer: q.answer! })),
        });
      }
    }
    return { machineId: machine._id, queued: queued.sort((a, b) => a.createdAt - b.createdAt), live };
  },
});

async function renderTranscript(ctx: QueryCtx, thread: Doc<"threads">, crew: Doc<"crew">[]): Promise<string> {
  const messages = (await ctx.db.query("messages").withIndex("by_thread", (q) => q.eq("threadId", thread._id)).order("desc").take(40)).reverse();
  const nameOf = (id: Id<"crew">) => crew.find((c) => c._id === id)?.name ?? "Someone";
  return messages.map((m) => {
    const who = m.author.kind === "captain" ? "Captain" : m.author.kind === "crew" ? nameOf(m.author.crewId) : "Ship";
    const label = m.kind === "report" ? `${who} (report)` : who;
    return `${label}: ${m.text.length > 1500 ? `${m.text.slice(0, 1500)}…` : m.text}`;
  }).join("\n\n");
}

async function rosterText(ctx: QueryCtx, crew: Doc<"crew">[]): Promise<string> {
  const now = Date.now();
  const lines = [];
  for (const c of crew.filter((x) => x.role === "crew")) {
    const live = await liveRunOf(ctx, c._id);
    const task = live?.taskId ? await ctx.db.get(live.taskId) : null;
    const doing = now < c.arrivesAt ? "arriving by helicopter" : task ? `working on "${task.title}"` : live ? "busy" : "free";
    lines.push(`- @${c.handle} (${c.name}, ${c.harness}${c.specialty ? `, ${c.specialty}` : ""}): ${doing}`);
  }
  return lines.join("\n") || "- nobody yet (assign with \"any\" and someone is hired)";
}

async function tasksText(ctx: QueryCtx, threadId: Id<"threads">, crew: Doc<"crew">[], repos: Doc<"repos">[]): Promise<string> {
  const tasks = (await ctx.db.query("tasks").withIndex("by_thread", (q) => q.eq("threadId", threadId)).collect()).sort((a, b) => a.createdAt - b.createdAt);
  const handle = (id: Id<"crew"> | null) => (id ? `@${crew.find((c) => c._id === id)?.handle ?? "?"}` : "unassigned");
  const where = (t: Doc<"tasks">) => (repos.length > 1 ? ` in ${repoOfTask(t, repos)?.name ?? "a removed repo"}` : "");
  return tasks.map((t) => `- [${t.state}] ${t.key}: ${t.title}${where(t)} (${handle(t.assignee)})${t.report ? `\n  report: ${t.report.slice(0, 600)}` : ""}`).join("\n") || "- none yet";
}

/** Take a queued run. Null when it is gone or someone else took it. */
export const claim = mutation({
  args: { token: v.string(), runId: v.id("runs") },
  handler: async (ctx, { token, runId }) => {
    const machine = await requireMachine(ctx, token);
    const run = await ctx.db.get(runId);
    if (!run || run.state !== "queued") return null;
    const office = await ctx.db.get(run.officeId);
    if (!office || office.ownerId !== machine.ownerId) fail("That run is not on one of your ships");
    const repos = await ensureRepos(ctx, office!);
    const task = run.taskId ? await ctx.db.get(run.taskId) : null;
    // The run's repo: the task's, or for the computer the first (where it works).
    const repo = run.kind === "task" ? (task ? repoOfTask(task, repos) : null) : repos[0] ?? null;
    if (run.kind === "task" && !repo) fail("That task's repo was taken off the ship");
    if (run.kind !== "look" && repo && repo.machineId !== machine._id) fail(`That ship's repo "${repo.name}" is on another machine`);
    if (run.kind === "computer" && !repo) fail("That ship has no repo yet");
    const now = Date.now();
    await ctx.db.patch(runId, { state: "starting", machineId: machine._id, startedAt: now });
    const crewMember = (await ctx.db.get(run.crewId))!;
    const crew = await crewOf(ctx, run.officeId);
    const thread = run.threadId ? await ctx.db.get(run.threadId) : null;
    const machineNames = new Map<string, string>();
    for (const r of repos) if (!machineNames.has(r.machineId)) machineNames.set(r.machineId, (await ctx.db.get(r.machineId))?.name ?? "another machine");

    // Resume the same harness session when this crew member worked this thread (or task) here before.
    let resumeCursor: unknown = null;
    if (run.kind !== "look") {
      const sessions = await ctx.db.query("sessions").withIndex("by_crew_scope", (q) => q.eq("crewId", run.crewId).eq("threadId", run.threadId).eq("taskId", run.taskId)).collect();
      resumeCursor = sessions.find((s) => s.machineId === machine._id)?.cursor ?? null;
    }

    // Messages left for them while they had no run.
    let prompt = run.prompt;
    const waiting = (await ctx.db.query("inbox").withIndex("by_crew", (q) => q.eq("crewId", run.crewId).eq("deliveredAt", null)).collect()).filter((m) => m.runId === null);
    if (waiting.length) {
      prompt += `\n\nMessages for you:\n${waiting.map((m) => `- ${m.text}`).join("\n")}`;
      for (const m of waiting) await ctx.db.patch(m._id, { deliveredAt: now, runId });
    }

    let context = "";
    if (run.kind === "computer" && thread) {
      context = [
        `Ship: ${office!.name}. Thread: "${thread.title}".`,
        `Repos:\n${repos.map((r) => `- ${r.name}: ${r.path} (default branch ${r.defaultBranch})${r.machineId === machine._id ? "" : `, on ${machineNames.get(r.machineId)}: you can't read it from here, but you can plan tasks in it`}`).join("\n")}`,
        `Crew aboard:\n${await rosterText(ctx, crew)}`,
        `Tasks in this thread:\n${await tasksText(ctx, thread._id, crew, repos)}`,
        `The thread so far:\n${await renderTranscript(ctx, thread, crew)}`,
      ].join("\n\n");
    } else if (run.kind === "task" && thread && task) {
      const first = await ctx.db.query("messages").withIndex("by_thread", (q) => q.eq("threadId", thread._id)).first();
      const tasks = await ctx.db.query("tasks").withIndex("by_thread", (q) => q.eq("threadId", thread._id)).collect();
      const landed = tasks.filter((t) => t.state === "landed" && t._id !== task._id);
      const many = repos.length > 1;
      const inRepo = (t: Doc<"tasks">) => (many ? ` in ${repoOfTask(t, repos)?.name ?? "another repo"}` : "");
      context = [
        `Ship: ${office!.name}. Thread: "${thread.title}". The captain asked: ${first?.text.slice(0, 2000) ?? thread.title}`,
        many ? `This ship has ${repos.length} repos (${repos.map((r) => r.name).join(", ")}). Your task is in ${repo!.name}; teammates may be changing the others at the same time.` : "",
        landed.length
          ? `Teammates have already landed on the thread's branch:\n${landed.map((t) => `- "${t.title}"${inRepo(t)} (${crew.find((c) => c._id === t.assignee)?.name ?? "someone"}): ${t.report?.slice(0, 500) ?? ""}`).join("\n")}`
          : "Nothing has landed on the thread's branch yet.",
      ].filter(Boolean).join("\n\n");
    }

    return {
      run: { id: run._id, kind: run.kind, prompt },
      office: {
        id: office!._id,
        name: office!.name,
        /** Every repo on the ship; `here` is whether it is on the claiming machine. */
        repos: repos.map((r) => ({ id: r._id, name: r.name, path: r.path, defaultBranch: r.defaultBranch, setupCommand: r.setupCommand, here: r.machineId === machine._id })),
        // The run's repo, for runners from before repos.
        repoPath: repo?.path ?? null,
        defaultBranch: repo?.defaultBranch ?? "main",
        setupCommand: repo?.setupCommand ?? null,
      },
      crew: {
        id: crewMember._id,
        name: crewMember.name,
        handle: crewMember.handle,
        role: crewMember.role,
        harness: crewMember.harness,
        model: crewMember.model,
        effort: crewMember.effort,
        profile: crewMember.profile,
        specialty: crewMember.specialty,
      },
      thread: thread && { id: thread._id, title: thread.title, branch: thread.branch },
      task: task && {
        id: task._id,
        key: task.key,
        title: task.title,
        brief: task.brief,
        notes: task.notes,
        branch: task.branch,
        /** The name of the repo it is in (office.repos). */
        repo: repo?.name ?? null,
        dependsOn: await Promise.all(task.dependsOn.map(async (id) => {
          const d = await ctx.db.get(id);
          return { key: d?.key ?? "?", title: d?.title ?? "?", state: d?.state ?? "cancelled" };
        })),
      },
      resumeCursor,
      context,
    };
  },
});

export const started = mutation({
  args: { token: v.string(), runId: v.id("runs"), worktree: v.string(), threadBranch: v.optional(v.string()), taskBranch: v.optional(v.string()) },
  handler: async (ctx, { token, runId, worktree, threadBranch, taskBranch }) => {
    const machine = await requireMachine(ctx, token);
    const run = await requireOwnRun(ctx, machine, runId);
    if (!isLive(run.state as RunState)) return;
    await ctx.db.patch(runId, { state: "working", worktree });
    if (run.threadId && threadBranch) {
      const thread = await ctx.db.get(run.threadId);
      if (thread && !thread.branch) await ctx.db.patch(thread._id, { branch: threadBranch });
    }
    if (run.taskId && taskBranch) await ctx.db.patch(run.taskId, { branch: taskBranch });
  },
});

/** The computer's words go into the thread as they stream; a tool step closes the paragraph. */
async function appendReply(ctx: MutationCtx, run: Doc<"runs">, text: string, final: boolean) {
  if (!run.threadId || run.kind !== "computer") return;
  const mine = await ctx.db.query("messages").withIndex("by_run", (q) => q.eq("runId", run._id)).collect();
  const open = mine.filter((m) => m.streaming).at(-1);
  if (open) {
    await ctx.db.patch(open._id, { text: final ? text : open.text + text, streaming: !final });
    await ctx.db.patch(run.threadId, { lastMessageAt: Date.now() });
  } else if (text.trim()) {
    await post(ctx, run.threadId, { author: { kind: "crew", crewId: run.crewId }, kind: "text", text, runId: run._id, streaming: !final });
  }
}

/** Normalized events, in order. Keeps the reply, the current step, questions and the session up to date. */
export const events = mutation({
  args: { token: v.string(), runId: v.id("runs"), events: v.array(v.any()) },
  handler: async (ctx, { token, runId, events }) => {
    const machine = await requireMachine(ctx, token);
    let run = await requireOwnRun(ctx, machine, runId);
    if (events.length > LIMITS.eventsPerBatch) fail(`At most ${LIMITS.eventsPerBatch} events per call`);
    const last = await ctx.db.query("runEvents").withIndex("by_run", (q) => q.eq("runId", runId)).order("desc").first();
    let seq = last?.seq ?? 0;
    const now = Date.now();
    for (const raw of events) {
      const parsed = RunEvent.safeParse(raw);
      if (!parsed.success) fail(`Not a run event: ${JSON.stringify(raw).slice(0, 200)}`);
      const e = parsed.data!;
      await ctx.db.insert("runEvents", { runId, seq: ++seq, at: now, event: e });
      switch (e.type) {
        case "session.started": {
          const existing = await ctx.db.query("sessions").withIndex("by_crew_scope", (q) => q.eq("crewId", run.crewId).eq("threadId", run.threadId).eq("taskId", run.taskId)).collect();
          const mine = existing.find((s) => s.machineId === machine._id);
          if (mine) await ctx.db.patch(mine._id, { cursor: e.resumeCursor, updatedAt: now });
          else await ctx.db.insert("sessions", { crewId: run.crewId, threadId: run.threadId, taskId: run.taskId, machineId: machine._id, cursor: e.resumeCursor, updatedAt: now });
          break;
        }
        case "content.delta":
          await appendReply(ctx, run, e.delta, false);
          break;
        case "content.final":
          await appendReply(ctx, run, e.text, true);
          break;
        case "item.started":
          await closeStream(ctx, runId);
          await ctx.db.patch(runId, { step: { itemId: e.itemId, kind: e.kind, summary: e.summary.slice(0, 200), since: now } });
          break;
        case "item.completed":
          await ctx.db.patch(runId, { ...(run.step?.itemId === e.itemId ? { step: null } : {}), lastStep: e.summary.slice(0, 200) });
          break;
        case "request.opened":
          await ctx.db.insert("questions", {
            officeId: run.officeId, threadId: run.threadId, runId, crewId: run.crewId, requestId: e.requestId, kind: e.kind,
            prompt: e.prompt.slice(0, 2000), options: e.options, answer: null, answeredAt: null, deliveredAt: null, createdAt: now,
          });
          break;
        case "request.resolved": {
          const qs = await ctx.db.query("questions").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
          const q = qs.find((x) => x.requestId === e.requestId);
          if (q) await ctx.db.patch(q._id, { deliveredAt: q.deliveredAt ?? now, answeredAt: q.answeredAt ?? now, answer: q.answer ?? e.decision });
          break;
        }
        case "turn.completed":
          await closeStream(ctx, runId);
          break;
        case "error":
          if (e.fatal) await ctx.db.patch(runId, { error: e.message.slice(0, 1000) });
          break;
        default:
          break;
      }
      run = (await ctx.db.get(runId))!;
    }
  },
});

/** Messages and answers the runner handed to the agent. */
export const delivered = mutation({
  args: { token: v.string(), inboxIds: v.optional(v.array(v.id("inbox"))), questionIds: v.optional(v.array(v.id("questions"))) },
  handler: async (ctx, { token, inboxIds, questionIds }) => {
    await requireMachine(ctx, token);
    const now = Date.now();
    for (const id of inboxIds ?? []) await ctx.db.patch(id, { deliveredAt: now });
    for (const id of questionIds ?? []) await ctx.db.patch(id, { deliveredAt: now });
  },
});

/** The agent is done; its work is being landed on the thread's branch. */
export const landing = mutation({
  args: { token: v.string(), runId: v.id("runs") },
  handler: async (ctx, { token, runId }) => {
    const machine = await requireMachine(ctx, token);
    const run = await requireOwnRun(ctx, machine, runId);
    if (!isLive(run.state as RunState)) return;
    await ctx.db.patch(runId, { state: "landing", step: null });
    if (run.taskId) await ctx.db.patch(run.taskId, { state: "review" });
  },
});

async function endRun(ctx: MutationCtx, run: Doc<"runs">, outcome: "landed" | "failed" | "interrupted", error: string | null, report: string | null, diff: Doc<"tasks">["diff"] = null) {
  const now = Date.now();
  await ctx.db.patch(run._id, { state: outcome, endedAt: now, step: null, error: error ?? run.error });
  await closeStream(ctx, run._id);
  // A question nobody answered dies with its run.
  for (const q of await ctx.db.query("questions").withIndex("by_run", (q) => q.eq("runId", run._id)).collect()) {
    if (q.answeredAt === null) await ctx.db.patch(q._id, { answeredAt: now, deliveredAt: now, answer: "" });
  }
  const thread = run.threadId ? await ctx.db.get(run.threadId) : null;
  const crew = await ctx.db.get(run.crewId);
  if (run.kind === "task" && run.taskId && thread && crew) {
    const task = (await ctx.db.get(run.taskId))!;
    const tasks = await ctx.db.query("tasks").withIndex("by_thread", (q) => q.eq("threadId", thread._id)).collect();
    const office = (await ctx.db.get(run.officeId))!;
    const repos = await reposOf(ctx, office);
    const where = repos.length > 1 ? ` in ${repoOfTask(task, repos)?.name ?? "its repo"}` : "";
    if (outcome === "landed") {
      // A fresh delivery: its package goes back on the counter until the captain opens it.
      await ctx.db.patch(task._id, { state: "landed", landedAt: now, report: report ?? task.report, diff: diff ?? task.diff ?? null, seenAt: null });
      await post(ctx, thread._id, { author: { kind: "crew", crewId: crew._id }, kind: "report", text: report?.trim() || "Done.", runId: run._id, taskId: task._id });
      const done = tasks.filter((t) => t.state === "landed" || t._id === task._id).length;
      await queueComputer(ctx, thread, `@${crew.handle} landed "${task.title}" (${task.key}) on the thread's branch${where}. ${done} of ${tasks.length} tasks have landed.\nTheir report: ${report?.trim() || "(none)"}`);
    } else if (outcome === "failed") {
      await ctx.db.patch(task._id, { state: "failed", report: report ?? error });
      await post(ctx, thread._id, { author: { kind: "crew", crewId: crew._id }, kind: "report", text: `I couldn't finish "${task.title}". ${report?.trim() || error || ""}`.trim(), runId: run._id, taskId: task._id });
      await queueComputer(ctx, thread, `@${crew.handle} could not finish "${task.title}" (${task.key}): ${error ?? report ?? "no reason given"}. Decide what to do: send_back with notes, plan a different task, or tell the captain.`);
    } else {
      await ctx.db.patch(task._id, { state: "cancelled" });
      await post(ctx, thread._id, { author: { kind: "system" }, kind: "system", text: `The captain stopped ${crew.name}'s work on "${task.title}".`, taskId: task._id });
      await queueComputer(ctx, thread, `The captain stopped @${crew.handle}'s work on "${task.title}" (${task.key}). Check with the captain before redoing it.`);
    }
  }
  if (run.kind === "computer" && thread) {
    // Anything sent to this turn after it stopped listening starts the next one.
    const missed = (await ctx.db.query("inbox").withIndex("by_crew", (q) => q.eq("crewId", run.crewId).eq("deliveredAt", null)).collect()).filter((m) => m.runId === run._id);
    for (const m of missed) await ctx.db.patch(m._id, { deliveredAt: now });
    if (missed.length && outcome !== "interrupted") await queueComputer(ctx, thread, missed.map((m) => m.text).join("\n\n"));
    if (outcome === "failed" && error) await post(ctx, thread._id, { author: { kind: "system" }, kind: "system", text: `The computer stopped: ${error}` });
  }
  await tick(ctx, run.officeId);
}

/** The run is over. For a task, "landed" means committed and landed on the thread's branch. */
export const finish = mutation({
  args: {
    token: v.string(),
    runId: v.id("runs"),
    outcome: v.union(v.literal("landed"), v.literal("failed"), v.literal("interrupted")),
    error: v.optional(v.string()),
    report: v.optional(v.string()),
    /** A landed task's size: what its landed commits changed. */
    diff: v.optional(changeStats),
  },
  handler: async (ctx, { token, runId, outcome, error, report, diff }) => {
    const machine = await requireMachine(ctx, token);
    const run = await requireOwnRun(ctx, machine, runId);
    if (!isLive(run.state as RunState)) return;
    await endRun(ctx, run, outcome, error?.slice(0, 1000) ?? null, report?.slice(0, 8000) ?? null, diff ?? null);
  },
});

/** A designed look for the run's crew member. */
export const lookResult = mutation({
  args: { token: v.string(), runId: v.id("runs"), look: v.any() },
  handler: async (ctx, { token, runId, look }) => {
    const machine = await requireMachine(ctx, token);
    const run = await requireOwnRun(ctx, machine, runId);
    if (run.kind !== "look") fail("Not a look run");
    const parsed = Look.safeParse(look);
    if (!parsed.success) fail(`That look doesn't fit the format: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    if (JSON.stringify(look).length > LIMITS.lookBytes) fail("That look is too big");
    await ctx.db.patch(run.crewId, { look });
  },
});

