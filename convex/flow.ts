import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { computerOf, freeCrew, hire, liveRunOf } from "./crewlib";
import { fail } from "./lib";

// How work moves: the computer's turns, tasks starting when they can, and waking the computer
// when something it handed out comes back. All plain functions, run inside the calling mutation,
// so a change and its consequences commit together.

/**
 * Send the computer something in a thread: the captain's words, or a note that work came back.
 * Joins its live turn there if it has one; otherwise starts a new turn.
 */
export async function queueComputer(ctx: MutationCtx, thread: Doc<"threads">, prompt: string): Promise<void> {
  const computer = await computerOf(ctx, thread.officeId);
  const runs = await ctx.db.query("runs").withIndex("by_thread", (q) => q.eq("threadId", thread._id)).collect();
  const live = runs.find((r) => r.crewId === computer._id && ["queued", "starting", "working"].includes(r.state));
  if (live?.state === "queued") {
    // Not started yet: fold it into the turn that is about to start.
    await ctx.db.patch(live._id, { prompt: `${live.prompt}\n\n${prompt}` });
    return;
  }
  if (live) {
    await ctx.db.insert("inbox", { crewId: computer._id, runId: live._id, text: prompt, deliveredAt: null, createdAt: Date.now() });
    return;
  }
  await ctx.db.insert("runs", {
    officeId: thread.officeId,
    threadId: thread._id,
    taskId: null,
    crewId: computer._id,
    kind: "computer",
    state: "queued",
    machineId: null,
    prompt,
    worktree: null,
    step: null,
    lastStep: null,
    error: null,
    interruptRequestedAt: null,
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
  });
}

/** A task id, or a key the computer gave it in this thread. */
export async function resolveTask(ctx: QueryCtx | MutationCtx, threadId: Id<"threads">, ref: string): Promise<Doc<"tasks">> {
  const tasks = await ctx.db.query("tasks").withIndex("by_thread", (q) => q.eq("threadId", threadId)).collect();
  const t = tasks.find((x) => x._id === ref || x.key === ref);
  if (!t) fail(`No task "${ref}" in this thread. Tasks: ${tasks.map((x) => x.key).join(", ") || "none yet"}`);
  return t!;
}

function taskPrompt(task: Doc<"tasks">): string {
  return task.notes ? `${task.brief}\n\nNotes from the computer on your last attempt:\n${task.notes}` : task.brief;
}

/**
 * Start whatever can start: a todo task whose dependencies have all landed, given to its crew
 * member (or whoever is free, hiring when nobody is) once they have nothing running.
 */
export async function tick(ctx: MutationCtx, officeId: Id<"offices">): Promise<void> {
  const office = await ctx.db.get(officeId);
  if (!office) return;
  const todo = (await ctx.db.query("tasks").withIndex("by_office_state", (q) => q.eq("officeId", officeId).eq("state", "todo")).collect())
    .sort((a, b) => a.createdAt - b.createdAt);
  const busy = new Set<string>();
  for (const task of todo) {
    const deps = await Promise.all(task.dependsOn.map((id) => ctx.db.get(id)));
    if (deps.some((d) => !d || d.state !== "landed")) continue;
    let assignee = task.assignee ? await ctx.db.get(task.assignee) : null;
    if (assignee && assignee.dismissedAt !== null) assignee = null;
    if (!assignee) {
      const free = await freeCrew(ctx, officeId, busy);
      assignee = free[0] ?? (await hire(ctx, office, {}));
      await ctx.db.patch(task._id, { assignee: assignee._id });
    }
    if (busy.has(assignee._id) || (await liveRunOf(ctx, assignee._id))) continue;
    busy.add(assignee._id);
    await ctx.db.patch(task._id, { state: "doing" });
    await ctx.db.insert("runs", {
      officeId,
      threadId: task.threadId,
      taskId: task._id,
      crewId: assignee._id,
      kind: "task",
      state: "queued",
      machineId: null,
      prompt: taskPrompt(task),
      worktree: null,
      step: null,
      lastStep: null,
      error: null,
      interruptRequestedAt: null,
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
    });
    const thread = await ctx.db.get(task.threadId);
    if (thread && thread.state === "open") await ctx.db.patch(thread._id, { state: "working" });
  }
}

/** Post into a thread. */
export async function post(
  ctx: MutationCtx,
  threadId: Id<"threads">,
  m: { author: Doc<"messages">["author"]; kind: Doc<"messages">["kind"]; text: string; runId?: Id<"runs"> | null; taskId?: Id<"tasks"> | null; streaming?: boolean },
): Promise<Id<"messages">> {
  const now = Date.now();
  await ctx.db.patch(threadId, { lastMessageAt: now });
  return ctx.db.insert("messages", {
    threadId,
    author: m.author,
    kind: m.kind,
    text: m.text,
    runId: m.runId ?? null,
    taskId: m.taskId ?? null,
    streaming: m.streaming ?? false,
    createdAt: now,
  });
}

/** Close a run's streaming reply, so the next words start a new message. */
export async function closeStream(ctx: MutationCtx, runId: Id<"runs">): Promise<void> {
  const open = await ctx.db.query("messages").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
  for (const m of open) if (m.streaming) await ctx.db.patch(m._id, { streaming: false });
}
