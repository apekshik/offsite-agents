/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");

type T = ReturnType<typeof convexTest>;
type Captain = ReturnType<T["withIdentity"]>;

/** Pair a machine the way `offsite login` does. */
async function pair(t: T, captain: Captain, name = "Mac") {
  const { deviceCode, userCode } = await t.mutation(internal.machines.startCode, { name, hostname: `${name.toLowerCase()}.local` });
  const { machineId } = await captain.mutation(api.machines.approve, { userCode });
  const poll = await t.mutation(internal.machines.pollCode, { deviceCode }) as { status: string; token: string };
  expect(poll.status).toBe("approved");
  return { machineId, token: poll.token };
}

async function aboard() {
  const t = convexTest(schema, modules);
  const captain = t.withIdentity({ tokenIdentifier: "dev|alice", name: "alice" });
  await captain.mutation(api.users.ensure, {});
  const officeId = await captain.mutation(api.offices.create, { name: "Sea Legs", world: "yacht" });
  const { machineId, token } = await pair(t, captain);
  await captain.mutation(api.offices.setRepo, { officeId, machineId, path: "~/code/app", defaultBranch: "main" });
  return { t, captain, officeId, token, machineId };
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
    expect(taskCtx?.task?.repo).toBe("app");
    expect(taskCtx?.office.repoPath).toBe("~/code/app");
    expect(taskCtx?.office.repos).toEqual([expect.objectContaining({ name: "app", path: "~/code/app", defaultBranch: "main", here: true })]);
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

describe("a ship with several repos", () => {
  it("plans across repos with a dependency, runs each on its repo's machine, and finishes with a pull request per repo", async () => {
    const { t, captain, officeId, token } = await aboard();
    // The API lives on a second machine.
    const linux = await pair(t, captain, "Linux");
    const apiRepo = await captain.mutation(api.repos.add, { officeId, machineId: linux.machineId, path: "~/code/api/", defaultBranch: "trunk", setupCommand: "pnpm install" });
    await expect(captain.mutation(api.repos.add, { officeId, machineId: linux.machineId, path: "~/code/api/", defaultBranch: "main" })).rejects.toThrow(/already on this ship/);
    const repos = await captain.query(api.repos.list, { officeId });
    expect(repos.map((r) => [r.name, r.defaultBranch, r.setupCommand, r.machine?.name])).toEqual([["app", "main", null, "Mac"], ["api", "trunk", "pnpm install", "Linux"]]);

    const threadId = await captain.mutation(api.threads.create, { officeId, text: "Add a health endpoint and show it in the app" });
    // The computer works where the first repo is.
    expect((await t.query(api.runner.work, { token: linux.token })).queued).toHaveLength(0);
    const work = await t.query(api.runner.work, { token });
    const c = await t.mutation(api.runner.claim, { token, runId: work.queued[0]!.runId });
    expect(c?.office.repos.map((r) => [r.name, r.here])).toEqual([["app", true], ["api", false]]);
    expect(c?.context).toMatch(/- api: ~\/code\/api\/ \(default branch trunk\), on Linux/);
    const runId = c!.run.id;

    await expect(t.mutation(api.tools.planTasks, { token, runId, tasks: [{ key: "x", title: "x", brief: "x" }] })).rejects.toThrow(/needs a repo: this ship has 2 \(app, api\)/);
    await expect(t.mutation(api.tools.planTasks, { token, runId, tasks: [{ key: "x", title: "x", brief: "x", repo: "server" }] })).rejects.toThrow(/No repo called "server". Repos: app, api/);
    const plan = await t.mutation(api.tools.planTasks, {
      token, runId,
      tasks: [
        { key: "health-api", title: "Health endpoint", brief: "GET /health", repo: "api" },
        { key: "health-ui", title: "Health badge", brief: "Call /health", repo: "App", dependsOn: ["health-api"] },
      ],
    });
    expect(plan.map((p) => [p.key, p.repo, p.state])).toEqual([["health-api", "api", "doing"], ["health-ui", "app", "todo"]]);
    const status = await t.query(api.tools.crewStatus, { token, runId });
    expect(status.repos).toEqual([{ name: "app", defaultBranch: "main", here: true }, { name: "api", defaultBranch: "trunk", here: false }]);
    expect(status.tasks.map((x) => x.repo)).toEqual(["api", "app"]);
    expect((await captain.query(api.messages.list, { threadId })).at(-1)?.text).toBe("1. Health endpoint (api)\n2. Health badge (app)");
    await t.mutation(api.runner.finish, { token, runId, outcome: "landed" });

    // The API task is the Linux machine's, not the Mac's.
    expect((await t.query(api.runner.work, { token })).queued).toHaveLength(0);
    const linuxWork = await t.query(api.runner.work, { token: linux.token });
    expect(linuxWork.queued).toHaveLength(1);
    await expect(t.mutation(api.runner.claim, { token, runId: linuxWork.queued[0]!.runId })).rejects.toThrow(/"api" is on another machine/);
    const apiCtx = await t.mutation(api.runner.claim, { token: linux.token, runId: linuxWork.queued[0]!.runId });
    expect(apiCtx?.task?.repo).toBe("api");
    expect([apiCtx?.office.repoPath, apiCtx?.office.defaultBranch, apiCtx?.office.setupCommand]).toEqual(["~/code/api/", "trunk", "pnpm install"]);
    expect(apiCtx?.context).toContain("Your task is in api");
    await t.mutation(api.runner.started, { token: linux.token, runId: apiCtx!.run.id, worktree: "/tmp/w/health-api", threadBranch: "offsite/health-abc123", taskBranch: "offsite/health-abc123-health-api" });
    const snap = await captain.query(api.world.snapshot, { officeId });
    expect(snap.office.repos).toEqual(["app", "api"]);
    expect(snap.crew.find((x) => x.live?.runId === apiCtx!.run.id)?.live?.repo).toBe("api");
    // Not while its work is under way.
    await expect(captain.mutation(api.repos.remove, { repoId: apiRepo })).rejects.toThrow(/still planned or under way/);
    await t.mutation(api.runner.finish, { token: linux.token, runId: apiCtx!.run.id, outcome: "landed", report: "Added /health." });

    // The UI task starts on the Mac, and the computer hears where it landed.
    let mac = await t.query(api.runner.work, { token });
    expect(mac.queued.map((q) => q.kind).sort()).toEqual(["computer", "task"]);
    for (const q of mac.queued) {
      const x = await t.mutation(api.runner.claim, { token, runId: q.runId });
      if (q.kind === "computer") expect(x?.run.prompt).toContain("on the thread's branch in api");
      else expect(x?.task?.repo).toBe("app");
      await t.mutation(api.runner.finish, { token, runId: q.runId, outcome: "landed", report: "Badge added." });
    }
    mac = await t.query(api.runner.work, { token });
    const last = await t.mutation(api.runner.claim, { token, runId: mac.queued[0]!.runId });
    expect((await t.query(api.tools.reviewTask, { token, runId: last!.run.id, task: "health-api" })).repo).toBe("api");
    await t.mutation(api.tools.finishThread, {
      token, runId: last!.run.id, title: "Health", summary: "An endpoint and a badge.",
      prs: [{ repo: "api", url: "https://github.com/x/api/pull/7", branch: "offsite/health-abc123" }, { repo: "app", url: null, branch: "offsite/health-abc123" }],
    });
    const thread = await captain.query(api.threads.get, { threadId });
    expect(thread.state).toBe("done");
    expect(thread.prUrl).toBe("https://github.com/x/api/pull/7");
    const row = (await captain.query(api.threads.list, { officeId })).find((x) => x._id === threadId)!;
    expect(row.repos).toEqual(["app", "api"]);
    expect(row.prs).toEqual([{ repo: "api", url: "https://github.com/x/api/pull/7", branch: "offsite/health-abc123" }, { repo: "app", url: null, branch: "offsite/health-abc123" }]);
    expect((await captain.query(api.messages.list, { threadId })).at(-1)?.text).toContain("Pull requests:\n- api: https://github.com/x/api/pull/7\n- app: on the branch offsite/health-abc123");
    expect((await captain.query(api.tasks.list, { threadId })).map((x) => x.repo)).toEqual(["api", "app"]);

    // Done now: the repo can go, and a one-repo ship needs no repo names in plans again.
    await captain.mutation(api.repos.remove, { repoId: apiRepo });
    expect((await captain.query(api.repos.list, { officeId })).map((r) => r.name)).toEqual(["app"]);
  });

  it("keeps a ship from before repos working, and migrates it", async () => {
    const { t, captain, officeId, token, machineId } = await aboard();
    // A ship as it was: the project on the office itself, no repos rows.
    await t.run(async (ctx) => {
      for (const r of await ctx.db.query("repos").collect()) await ctx.db.delete(r._id);
      await ctx.db.patch(officeId, { repo: { machineId, path: "~/code/legacy-app", defaultBranch: "main" }, setupCommand: "npm ci" });
    });
    const before = await captain.query(api.repos.list, { officeId });
    expect(before.map((r) => [r._id, r.name, r.setupCommand])).toEqual([[null, "legacy-app", "npm ci"]]);
    expect((await captain.query(api.offices.get, { officeId })).repos).toHaveLength(1);
    // The runner still finds its work, and claiming migrates it.
    const threadId = await captain.mutation(api.threads.create, { officeId, text: "Fix it" });
    const work = await t.query(api.runner.work, { token });
    const c = await t.mutation(api.runner.claim, { token, runId: work.queued[0]!.runId });
    expect(c?.office.repoPath).toBe("~/code/legacy-app");
    await t.mutation(api.tools.planTasks, { token, runId: c!.run.id, tasks: [{ key: "fix", title: "Fix", brief: "Fix it" }] });
    const [task] = await captain.query(api.tasks.list, { threadId });
    expect(task?.repo).toBe("legacy-app");
    expect(await t.mutation(internal.repos.migrate, {})).toEqual({ offices: 1, made: 0 });
    const after = await captain.query(api.repos.list, { officeId });
    expect(after.map((r) => [r.name, r.setupCommand, r._id === task?.repoId])).toEqual([["legacy-app", "npm ci", true]]);
  });
});
