/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");

type T = ReturnType<typeof convexTest>;
type Captain = ReturnType<T["withIdentity"]>;

async function pair(t: T, captain: Captain, name = "Mac") {
  const { deviceCode, userCode } = await t.mutation(internal.machines.startCode, { name, hostname: `${name.toLowerCase()}.local` });
  const approved = await captain.mutation(api.machines.approve, { userCode });
  if (!approved.ok) throw new Error(approved.error);
  const { machineId } = approved;
  const poll = await t.mutation(internal.machines.pollCode, { deviceCode }) as { status: string; token: string };
  return { machineId, token: poll.token };
}

/** A ship with a repo, a thread planned into one task, and that task's run landed with its size. */
async function landedTask() {
  const t = convexTest(schema, modules);
  const captain = t.withIdentity({ tokenIdentifier: "dev|alice", name: "alice" });
  await captain.mutation(api.users.ensure, {});
  const officeId = await captain.mutation(api.offices.create, { name: "Sea Legs", world: "yacht" });
  const { machineId, token } = await pair(t, captain);
  await captain.mutation(api.repos.add, { officeId, machineId, path: "~/code/web", defaultBranch: "main" });
  const threadId = await captain.mutation(api.threads.create, { officeId, text: "Add a counter page" });

  const computer = (await t.query(api.runner.work, { token })).queued[0]!;
  await t.mutation(api.runner.claim, { token, runId: computer.runId });
  await t.mutation(api.runner.started, { token, runId: computer.runId, worktree: "/w/_thread", threadBranch: "offsite/counter-abc123" });
  await t.mutation(api.tools.planTasks, { token, runId: computer.runId, tasks: [{ key: "page", title: "Counter page", brief: "Add it", dependsOn: [], assignee: "any" }] });
  await t.mutation(api.runner.finish, { token, runId: computer.runId, outcome: "landed" });

  const run = (await t.query(api.runner.work, { token })).queued[0]!;
  const ctx = (await t.mutation(api.runner.claim, { token, runId: run.runId }))!;
  await t.mutation(api.runner.started, { token, runId: run.runId, worktree: "/w/page", taskBranch: "offsite/counter-abc123-page" });
  await t.mutation(api.runner.landing, { token, runId: run.runId });
  await t.mutation(api.runner.finish, { token, runId: run.runId, outcome: "landed", report: "Done.", diff: { added: 10, removed: 0, files: 1 } });
  return { t, captain, officeId, machineId, token, threadId, taskId: ctx.task!.id as Id<"tasks"> };
}

const result = (sha: string) => ({
  sha, base: "b0", stats: { added: 10, removed: 0, files: 1 },
  files: [{ path: "counter.ts", oldPath: null, status: "added", added: 10, removed: 0, binary: false }],
  patch: "diff --git a/counter.ts b/counter.ts\n+let n = 0;\n", truncated: false,
});

describe("diffs", () => {
  it("records a landed task's size and shows its package until the captain opens it", async () => {
    const { captain, officeId, threadId, taskId } = await landedTask();
    const tasks = await captain.query(api.tasks.list, { threadId });
    expect(tasks[0]!.diff).toEqual({ added: 10, removed: 0, files: 1 });
    const threads = await captain.query(api.threads.list, { officeId });
    expect(threads[0]!.diff).toEqual({ added: 10, removed: 0, files: 1 });
    const snap = await captain.query(api.world.snapshot, { officeId });
    const worker = snap.crew.find((c) => c.lastEnded?.taskId === taskId)!;
    expect(worker.lastEnded?.diff).toEqual({ added: 10, removed: 0, files: 1 });

    let boxes = await captain.query(api.diffs.deliveries, { officeId });
    expect(boxes).toEqual([expect.objectContaining({ taskId, threadId, title: "Counter page", crewName: worker.name, seen: false })]);
    await captain.mutation(api.diffs.seen, { taskId });
    boxes = await captain.query(api.diffs.deliveries, { officeId });
    expect(boxes[0]!.seen).toBe(true);
  });

  it("asks the repo's machine for a thread's diff, caches it by sha, and recomputes once something lands", async () => {
    const { t, captain, threadId, token } = await landedTask();
    // Nothing is computed until someone asks.
    expect((await t.query(api.diffs.work, { token })).diffs).toEqual([]);
    await captain.mutation(api.diffs.request, { threadId });
    let view = await captain.query(api.diffs.get, { threadId });
    expect(view.repos).toEqual([expect.objectContaining({ repo: expect.objectContaining({ name: "web" }), machine: { name: "Mac", online: true } })]);
    expect(view.repos[0]!.diff?.state).toBe("pending");

    let work = await t.query(api.diffs.work, { token });
    expect(work.diffs).toEqual([expect.objectContaining({ threadBranch: "offsite/counter-abc123", task: null, knownSha: null, repo: { name: "web", path: "~/code/web", defaultBranch: "main" } })]);
    await t.mutation(api.diffs.put, { token, diffId: work.diffs[0]!.diffId, result: result("s1") });
    view = await captain.query(api.diffs.get, { threadId });
    expect(view.repos[0]!.diff).toEqual(expect.objectContaining({ state: "ready", sha: "s1", stats: { added: 10, removed: 0, files: 1 }, truncated: false }));
    expect(view.repos[0]!.diff?.files[0]?.path).toBe("counter.ts");

    // Asking again with nothing new landed: the cached diff stands.
    await captain.mutation(api.diffs.request, { threadId });
    expect((await t.query(api.diffs.work, { token })).diffs).toEqual([]);

    // Something landed since: pending again, with the sha it was computed at so the runner can skip unchanged work.
    await t.run(async (ctx) => {
      const tasks = await ctx.db.query("tasks").collect();
      await ctx.db.patch(tasks[0]!._id, { landedAt: Date.now() + 1000 });
    });
    await captain.mutation(api.diffs.request, { threadId });
    work = await t.query(api.diffs.work, { token });
    expect(work.diffs[0]!.knownSha).toBe("s1");
    // While it refreshes, the last result is still there to show.
    expect((await captain.query(api.diffs.get, { threadId })).repos[0]!.diff).toEqual(expect.objectContaining({ state: "pending", sha: "s1" }));
    await t.mutation(api.diffs.put, { token, diffId: work.diffs[0]!.diffId, unchanged: true });
    expect((await captain.query(api.diffs.get, { threadId })).repos[0]!.diff?.state).toBe("ready");
  });

  it("computes one task's changes, fills in its size, and reports failures", async () => {
    const { t, captain, threadId, taskId, token } = await landedTask();
    await t.run(async (ctx) => { await ctx.db.patch(taskId, { diff: null }); });
    await captain.mutation(api.diffs.request, { threadId, taskId });
    const [job] = (await t.query(api.diffs.work, { token })).diffs;
    expect(job!.task).toEqual({ key: "page", branch: "offsite/counter-abc123-page" });
    await expect(t.mutation(api.diffs.put, { token, diffId: job!.diffId, result: { ...result("s2"), stats: "lots" } })).rejects.toThrow(/doesn't fit/);
    await t.mutation(api.diffs.put, { token, diffId: job!.diffId, result: result("s2") });
    const view = await captain.query(api.diffs.get, { threadId, taskId });
    expect(view.task).toEqual(expect.objectContaining({ title: "Counter page", diff: { added: 10, removed: 0, files: 1 } }));
    expect(view.repos[0]!.diff?.sha).toBe("s2");
    // The thread's own diff is a separate row.
    expect((await captain.query(api.diffs.get, { threadId })).repos[0]!.diff).toBeNull();

    await captain.mutation(api.diffs.request, { threadId });
    const [threadJob] = (await t.query(api.diffs.work, { token })).diffs;
    await t.mutation(api.diffs.put, { token, diffId: threadJob!.diffId, error: "The thread branch is gone" });
    expect((await captain.query(api.diffs.get, { threadId })).repos[0]!.diff).toEqual(expect.objectContaining({ state: "failed", error: "The thread branch is gone" }));
  });

  it("is the owner's only, says when the machine is offline, and relays Open in editor", async () => {
    const { t, captain, threadId, taskId, token, machineId } = await landedTask();
    const stranger = t.withIdentity({ tokenIdentifier: "dev|mallory", name: "mallory" });
    await stranger.mutation(api.users.ensure, {});
    await expect(stranger.query(api.diffs.get, { threadId })).rejects.toThrow(/No such ship/);
    await expect(stranger.mutation(api.diffs.request, { threadId })).rejects.toThrow(/No such ship/);
    await expect(stranger.mutation(api.diffs.seen, { taskId })).rejects.toThrow(/No such ship/);
    await expect(stranger.query(api.diffs.deliveries, { officeId: (await t.run((ctx) => ctx.db.get(threadId)))!.officeId })).rejects.toThrow(/No such ship/);

    // Another of the captain's machines can't answer for this one.
    const other = await pair(t, captain, "Laptop");
    await captain.mutation(api.diffs.request, { threadId });
    const [job] = (await t.query(api.diffs.work, { token })).diffs;
    expect((await t.query(api.diffs.work, { token: other.token })).diffs).toEqual([]);
    await expect(t.mutation(api.diffs.put, { token: other.token, diffId: job!.diffId, result: result("x") })).rejects.toThrow(/isn't this machine's/);

    const requestId = await captain.mutation(api.diffs.openEditor, { threadId, taskId });
    const { editors } = await t.query(api.diffs.work, { token });
    expect(editors).toEqual([expect.objectContaining({ requestId, task: { key: "page", branch: "offsite/counter-abc123-page" }, repo: expect.objectContaining({ name: "web" }) })]);
    await t.mutation(api.diffs.editorDone, { token, requestId, ok: true, result: "Opened it in Cursor" });
    expect(await captain.query(api.diffs.editorRequest, { requestId })).toEqual(expect.objectContaining({ ok: true, result: "Opened it in Cursor" }));
    expect((await t.query(api.diffs.work, { token })).editors).toEqual([]);

    // The machine goes quiet: the diff waits there, and the editor can't be opened.
    await t.run(async (ctx) => { await ctx.db.patch(machineId, { lastSeenAt: Date.now() - 10 * 60_000 }); });
    expect((await captain.query(api.diffs.get, { threadId })).repos[0]!.machine).toEqual({ name: "Mac", online: false });
    await expect(captain.mutation(api.diffs.openEditor, { threadId })).rejects.toThrow(/Mac is offline/);
  });
});
