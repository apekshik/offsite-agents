/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");

async function aboard() {
  const t = convexTest(schema, modules);
  const captain = t.withIdentity({ tokenIdentifier: "dev|alice", name: "alice" });
  await captain.mutation(api.users.ensure, {});
  const officeId = await captain.mutation(api.offices.create, { name: "Sea Legs", world: "yacht" });
  // Pair a machine the way `offsite login` does.
  const { deviceCode, userCode } = await t.mutation(internal.machines.startCode, { name: "Mac", hostname: "mac.local" });
  const { machineId } = await captain.mutation(api.machines.approve, { userCode });
  const poll = await t.mutation(internal.machines.pollCode, { deviceCode }) as { status: string; token: string };
  expect(poll.status).toBe("approved");
  await captain.mutation(api.offices.setRepo, { officeId, machineId, path: "~/code/app", defaultBranch: "main" });
  return { t, captain, officeId, token: poll.token };
}

describe("a thread from request to pull request", () => {
  it("plans, hands out, lands and finishes", async () => {
    const { t, captain, officeId, token } = await aboard();
    const crew = await captain.query(api.crew.list, { officeId });
    expect(crew.filter((c) => c.role === "crew")).toHaveLength(3);
    expect(crew.find((c) => c.role === "computer")?.handle).toBe("computer");

    const threadId = await captain.mutation(api.threads.create, { officeId, text: "Add dark mode to the settings page" });
    let work = await t.query(api.runner.work, { token });
    expect(work.queued).toHaveLength(1);
    const ctx = await t.mutation(api.runner.claim, { token, runId: work.queued[0]!.runId });
    expect(ctx?.crew.role).toBe("computer");
    expect(ctx?.context).toContain("Add dark mode");
    const computerRun = ctx!.run.id;
    await t.mutation(api.runner.started, { token, runId: computerRun, worktree: "/tmp/w/_thread", threadBranch: "offsite/add-dark-mode-abc123" });
    await t.mutation(api.runner.events, { token, runId: computerRun, events: [{ type: "content.delta", delta: "Two parts: " }, { type: "content.delta", delta: "types, then UI." }] });

    const plan = await t.mutation(api.tools.planTasks, {
      token, runId: computerRun,
      tasks: [
        { key: "theme-types", title: "Theme types", brief: "Add a Theme type", dependsOn: [], assignee: "any" },
        { key: "settings-ui", title: "Settings toggle", brief: "Add the toggle", dependsOn: ["theme-types"], assignee: "any" },
      ],
    });
    expect(plan[0]!.state).toBe("doing");
    expect(plan[1]!.state).toBe("todo");
    const messages = await captain.query(api.messages.list, { threadId });
    expect(messages.map((m) => m.kind)).toEqual(["text", "text", "plan"]);
    expect(messages[1]!.text).toBe("Two parts: types, then UI.");

    await t.mutation(api.runner.finish, { token, runId: computerRun, outcome: "landed" });
    work = await t.query(api.runner.work, { token });
    expect(work.queued).toHaveLength(1);
    const taskCtx = await t.mutation(api.runner.claim, { token, runId: work.queued[0]!.runId });
    expect(taskCtx?.task?.key).toBe("theme-types");
    const taskRun = taskCtx!.run.id;
    await t.mutation(api.runner.started, { token, runId: taskRun, worktree: "/tmp/w/theme-types", taskBranch: "offsite/add-dark-mode-abc123-theme-types" });
    await t.mutation(api.runner.events, { token, runId: taskRun, events: [{ type: "item.started", itemId: "i1", kind: "edit", summary: "Edit src/theme.ts" }] });

    const snap = await captain.query(api.world.snapshot, { officeId });
    const worker = snap.crew.find((c) => c.live?.runId === taskRun)!;
    expect(worker.live?.step?.summary).toBe("Edit src/theme.ts");
    expect(worker.live?.taskTitle).toBe("Theme types");

    // An approval in the middle of the task.
    await t.mutation(api.runner.events, { token, runId: taskRun, events: [{ type: "request.opened", requestId: "r1", kind: "approval", prompt: "Run pnpm install?", options: ["allow", "deny"] }] });
    const [q] = await captain.query(api.questions.open, { officeId });
    await captain.mutation(api.questions.answer, { questionId: q!._id, answer: "allow" });
    work = await t.query(api.runner.work, { token });
    expect(work.live.find((l) => l.runId === taskRun)?.answers[0]?.answer).toBe("allow");

    await t.mutation(api.runner.landing, { token, runId: taskRun });
    await t.mutation(api.runner.finish, { token, runId: taskRun, outcome: "landed", report: "Added Theme." });
    let tasks = await captain.query(api.tasks.list, { threadId });
    expect(tasks.map((x) => x.state)).toEqual(["landed", "doing"]);

    // The computer was woken, and the dependent task started.
    work = await t.query(api.runner.work, { token });
    expect(work.queued.map((x) => x.kind).sort()).toEqual(["computer", "task"]);
    for (const qd of work.queued) {
      const c = await t.mutation(api.runner.claim, { token, runId: qd.runId });
      if (qd.kind === "task") {
        expect(c?.context).toContain("Theme types");
        await t.mutation(api.runner.finish, { token, runId: qd.runId, outcome: "landed", report: "Toggle added." });
      } else {
        expect(c?.run.prompt).toContain("landed \"Theme types\"");
        await t.mutation(api.runner.finish, { token, runId: qd.runId, outcome: "landed" });
      }
    }
    tasks = await captain.query(api.tasks.list, { threadId });
    expect(tasks.every((x) => x.state === "landed")).toBe(true);

    work = await t.query(api.runner.work, { token });
    const last = await t.mutation(api.runner.claim, { token, runId: work.queued[0]!.runId });
    await t.mutation(api.tools.finishThread, { token, runId: last!.run.id, title: "Dark mode", summary: "Theme types and a toggle.", prUrl: "https://github.com/x/y/pull/1" });
    const thread = await captain.query(api.threads.get, { threadId });
    expect(thread.state).toBe("done");
    expect(thread.prUrl).toContain("/pull/1");
  });

  it("hires by helicopter when nobody is free", async () => {
    const { t, captain, officeId, token } = await aboard();
    await captain.mutation(api.threads.create, { officeId, text: "Four things at once" });
    const work = await t.query(api.runner.work, { token });
    const c = await t.mutation(api.runner.claim, { token, runId: work.queued[0]!.runId });
    const plan = await t.mutation(api.tools.planTasks, {
      token, runId: c!.run.id,
      tasks: ["a", "b", "c", "d"].map((k) => ({ key: k, title: k, brief: k })),
    });
    expect(plan.every((p) => p.state === "doing")).toBe(true);
    const crew = (await captain.query(api.crew.list, { officeId })).filter((x) => x.role === "crew");
    expect(crew).toHaveLength(4);
    const newcomer = crew.sort((a, b) => b.hiredAt - a.hiredAt)[0]!;
    expect(newcomer.arrivesAt).toBeGreaterThan(newcomer.hiredAt);
  });

  it("refuses a plan with an unknown crew member, leaving nothing behind", async () => {
    const { t, captain, officeId, token } = await aboard();
    const threadId = await captain.mutation(api.threads.create, { officeId, text: "Do it" });
    const work = await t.query(api.runner.work, { token });
    const c = await t.mutation(api.runner.claim, { token, runId: work.queued[0]!.runId });
    await expect(t.mutation(api.tools.planTasks, { token, runId: c!.run.id, tasks: [{ key: "x", title: "x", brief: "x", assignee: "nobody" }] }))
      .rejects.toThrow(/Nobody aboard is called "nobody"/);
    expect(await captain.query(api.tasks.list, { threadId })).toHaveLength(0);
  });

  it("steers the computer's live turn with the captain's next message", async () => {
    const { t, captain, officeId, token } = await aboard();
    const threadId = await captain.mutation(api.threads.create, { officeId, text: "Start" });
    const work = await t.query(api.runner.work, { token });
    const c = await t.mutation(api.runner.claim, { token, runId: work.queued[0]!.runId });
    await t.mutation(api.runner.started, { token, runId: c!.run.id, worktree: "/tmp/x" });
    await captain.mutation(api.threads.send, { threadId, text: "Actually, use blue" });
    const live = (await t.query(api.runner.work, { token })).live.find((l) => l.runId === c!.run.id)!;
    expect(live.inbox[0]?.text).toContain("Actually, use blue");
  });
});
