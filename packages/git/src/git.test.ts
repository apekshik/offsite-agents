import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  allocatePort, commitAll, commitsAhead, conflictMarkers, ensureComputerDir, ensureTaskWorktree, ensureThreadBranch, ensureThreadWorktree, finishThread,
  landTask, prepareConflict, releasePort, runSetup, syncTask, taskBranchName, taskDiff, taskWorktreePath, threadBranchName, threadRepoWorktreePath,
  threadViewRef, threadWorktreePath,
} from "./index.ts";

const run = promisify(execFile);
const sh = (cwd: string, ...args: string[]) => run("git", args, { cwd }).then((r) => r.stdout.trim());

let root: string;
let repo: string;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "offsite-git-"));
  // Isolate from the person's own git config: a known identity, no signing, no hooks.
  await writeFile(join(root, "gitconfig"), "[user]\n\tname = Captain\n\temail = captain@example.com\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n");
  for (const [k, v] of Object.entries({ GIT_CONFIG_GLOBAL: join(root, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", OFFSITE_HOME: join(root, "home") })) { saved[k] = process.env[k]; process.env[k] = v; }
});
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true });
});

let n = 0;
beforeEach(async () => {
  repo = join(root, `repo${++n}`);
  await mkdir(repo, { recursive: true });
  await sh(repo, "init", "-q");
  await writeFile(join(repo, "README.md"), "# App\n\nline one\nline two\n");
  await writeFile(join(repo, "app.ts"), "export const a = 1;\n");
  await sh(repo, "add", "-A");
  await sh(repo, "commit", "-q", "-m", "seed");
});

/** A thread with a branch, the computer's worktree, and a worktree per task key. */
async function thread(keys: string[], id = `thread-${String(n).padStart(6, "0")}`) {
  const threadBranch = threadBranchName("Add dark mode to the settings page", id);
  await ensureThreadBranch(repo, threadBranch, "main");
  const threadWt = (await ensureThreadWorktree(repo, threadRepoWorktreePath("office1", id, "app"), threadBranch)).path;
  const tasks: Record<string, { branch: string; wt: string }> = {};
  for (const key of keys) {
    const branch = taskBranchName(threadBranch, key);
    tasks[key] = { branch, wt: (await ensureTaskWorktree(repo, taskWorktreePath("office1", id, key), branch, threadBranch)).path };
  }
  return { threadBranch, threadWt, tasks };
}
const land = (t: Awaited<ReturnType<typeof thread>>, key: string, author = "Juniper") =>
  landTask({ repo, threadBranch: t.threadBranch, taskBranch: t.tasks[key]!.branch, worktree: t.tasks[key]!.wt, message: `Do ${key}`, author, threadWorktree: t.threadWt });

describe("branches and worktrees", () => {
  it("names the thread branch and places each worktree under the office and thread", async () => {
    const t = await thread(["theme"], "k57abc123XYZ789");
    expect(t.threadBranch).toBe("offsite/add-dark-mode-to-the-settings-page-xyz789");
    expect(t.tasks["theme"]!.branch).toBe("offsite/add-dark-mode-to-the-settings-page-xyz789-theme");
    expect(t.tasks["theme"]!.wt).toBe(join(root, "home", "worktrees", "office1", "xyz789", "theme"));
    expect(t.threadWt).toBe(join(root, "home", "worktrees", "office1", "xyz789", "_thread", "app"));
    expect(await sh(t.tasks["theme"]!.wt, "rev-parse", "--abbrev-ref", "HEAD")).toBe(t.tasks["theme"]!.branch);
    // The computer's worktree is detached, so the branch is free to move.
    expect(await sh(t.threadWt, "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");
    // Reusing a task's worktree keeps what is there.
    await writeFile(join(t.tasks["theme"]!.wt, "wip.txt"), "x");
    expect((await ensureTaskWorktree(repo, t.tasks["theme"]!.wt, t.tasks["theme"]!.branch, t.threadBranch)).created).toBe(false);
    expect(await readFile(join(t.tasks["theme"]!.wt, "wip.txt"), "utf8")).toBe("x");
  });

  it("commits everything as the crew member, with the captain's email", async () => {
    const t = await thread(["theme"]);
    const wt = t.tasks["theme"]!.wt;
    expect((await commitAll(wt, "nothing", "Juniper")).committed).toBe(false);
    await writeFile(join(wt, "theme.ts"), "export type Theme = 'light' | 'dark';\n");
    expect((await commitAll(wt, "Add Theme", "Juniper")).committed).toBe(true);
    expect(await sh(wt, "log", "-1", "--format=%an <%ae>|%cn|%s")).toBe("Juniper (Offsite) <captain@example.com>|Captain|Add Theme");
  });
});

describe("landing", () => {
  it("lands two tasks one at a time as one commit each, and refreshes the computer's view", async () => {
    const t = await thread(["theme", "toggle"]);
    await writeFile(join(t.tasks["theme"]!.wt, "theme.ts"), "export type Theme = 'light' | 'dark';\n");
    await commitAll(t.tasks["theme"]!.wt, "wip 1", "Juniper");
    await writeFile(join(t.tasks["theme"]!.wt, "theme2.ts"), "export const x = 1;\n");
    await writeFile(join(t.tasks["toggle"]!.wt, "toggle.ts"), "export const toggle = () => {};\n");
    const [a, b] = await Promise.all([land(t, "theme", "Juniper"), land(t, "toggle", "Otis")]);
    expect(a).toMatchObject({ ok: true, empty: false });
    expect(b).toMatchObject({ ok: true, empty: false });
    const log = await sh(repo, "log", "--format=%an|%s", `refs/heads/${t.threadBranch}`);
    expect(log.split("\n")).toEqual(["Otis (Offsite)|Do toggle", "Juniper (Offsite)|Do theme", "Captain|seed"]);
    expect(await sh(repo, "log", "-1", "--format=%b", `refs/heads/${t.threadBranch}`)).toBe(`Offsite-Task: ${t.tasks["toggle"]!.branch}`);
    expect((await stat(join(t.threadWt, "toggle.ts"))).isFile()).toBe(true);
    expect((await stat(join(t.threadWt, "theme2.ts"))).isFile()).toBe(true);
    // main is untouched.
    expect(await sh(repo, "log", "--format=%s", "main")).toBe("seed");
  });

  it("lands nothing for a task that changed nothing", async () => {
    const t = await thread(["noop"]);
    expect(await land(t, "noop")).toMatchObject({ ok: true, empty: true });
  });

  it("hands back a conflict with the rebase undone, then lands once the crew member resolves it", async () => {
    const t = await thread(["one", "two"]);
    await writeFile(join(t.tasks["one"]!.wt, "README.md"), "# App\n\nline one\nline two\n- from one\n");
    await writeFile(join(t.tasks["two"]!.wt, "README.md"), "# App\n\nline one\nline two\n- from two\n");
    expect(await land(t, "one")).toMatchObject({ ok: true });
    const conflict = await land(t, "two", "Otis");
    expect(conflict).toEqual({ ok: false, conflict: ["README.md"] });
    const two = t.tasks["two"]!.wt;
    expect(await sh(two, "status", "--porcelain")).toBe("");
    expect(await readFile(join(two, "README.md"), "utf8")).toContain("- from two");

    // The ship leaves the markers; the crew member resolves them; the ship lands again.
    expect(await prepareConflict(two, t.threadBranch, "Otis")).toEqual(["README.md"]);
    expect(await conflictMarkers(two, ["README.md"])).toEqual(["README.md"]);
    await writeFile(join(two, "README.md"), "# App\n\nline one\nline two\n- from one\n- from two\n");
    expect(await conflictMarkers(two, ["README.md"])).toEqual([]);
    expect(await land(t, "two", "Otis")).toMatchObject({ ok: true, empty: false });
    expect(await sh(repo, "show", `refs/heads/${t.threadBranch}:README.md`)).toBe("# App\n\nline one\nline two\n- from one\n- from two");
    expect((await sh(repo, "log", "--format=%s", `refs/heads/${t.threadBranch}`)).split("\n")).toEqual(["Do two", "Do one", "seed"]);
  });

  it("fast-forwards the thread branch where the captain has it checked out", async () => {
    const t = await thread(["theme"]);
    await sh(repo, "checkout", "-q", t.threadBranch);
    await writeFile(join(t.tasks["theme"]!.wt, "theme.ts"), "x\n");
    expect(await land(t, "theme")).toMatchObject({ ok: true });
    expect(await readFile(join(repo, "theme.ts"), "utf8")).toBe("x\n");
    expect(await sh(repo, "status", "--porcelain")).toBe("");
  });
});

describe("sync_with_team", () => {
  it("brings in what landed, keeping the work in progress", async () => {
    const t = await thread(["one", "two"]);
    await writeFile(join(t.tasks["one"]!.wt, "one.ts"), "1\n");
    await land(t, "one");
    await writeFile(join(t.tasks["two"]!.wt, "two.ts"), "2\n");
    expect(await syncTask({ repo, worktree: t.tasks["two"]!.wt, threadBranch: t.threadBranch, author: "Otis" })).toEqual({ ok: true, upToDate: false, brought: 1 });
    expect(await readFile(join(t.tasks["two"]!.wt, "one.ts"), "utf8")).toBe("1\n");
    expect(await readFile(join(t.tasks["two"]!.wt, "two.ts"), "utf8")).toBe("2\n");
    expect(await syncTask({ repo, worktree: t.tasks["two"]!.wt, threadBranch: t.threadBranch, author: "Otis" })).toEqual({ ok: true, upToDate: true, brought: 0 });
    // The WIP commit folds into the one landed commit.
    expect(await land(t, "two", "Otis")).toMatchObject({ ok: true });
    expect((await sh(repo, "log", "--format=%s", `refs/heads/${t.threadBranch}`)).split("\n")).toEqual(["Do two", "Do one", "seed"]);
  });

  it("leaves conflict markers for the agent when teammates' work overlaps", async () => {
    const t = await thread(["one", "two"]);
    await writeFile(join(t.tasks["one"]!.wt, "app.ts"), "export const a = 2;\n");
    await land(t, "one");
    await writeFile(join(t.tasks["two"]!.wt, "app.ts"), "export const a = 3;\n");
    const r = await syncTask({ repo, worktree: t.tasks["two"]!.wt, threadBranch: t.threadBranch, author: "Otis" });
    expect(r).toEqual({ ok: false, conflict: ["app.ts"] });
    expect(await readFile(join(t.tasks["two"]!.wt, "app.ts"), "utf8")).toMatch(/^<<<<<<< /m);
    await writeFile(join(t.tasks["two"]!.wt, "app.ts"), "export const a = 3;\n");
    expect(await land(t, "two", "Otis")).toMatchObject({ ok: true });
    expect(await sh(repo, "show", `refs/heads/${t.threadBranch}:app.ts`)).toBe("export const a = 3;");
  });
});

describe("review diffs", () => {
  it("shows a task's change before and after it lands", async () => {
    const t = await thread(["theme", "other"]);
    await writeFile(join(t.tasks["theme"]!.wt, "theme.ts"), "a\nb\n");
    await commitAll(t.tasks["theme"]!.wt, "wip", "Juniper");
    const before = await taskDiff(repo, t.threadBranch, t.tasks["theme"]!.branch);
    expect(before).toMatchObject({ landed: false, stat: { files: 1, add: 2, del: 0 } });
    await land(t, "theme");
    await writeFile(join(t.tasks["other"]!.wt, "other.ts"), "c\n");
    await land(t, "other");
    const after = await taskDiff(repo, t.threadBranch, t.tasks["theme"]!.branch);
    expect(after.landed).toBe(true);
    expect(after.stat.changed).toEqual([{ path: "theme.ts", add: 2, del: 0 }]);
    expect(after.diff).toContain("+a");
    expect(after.diff).not.toContain("other.ts");
  });
});

describe("finishing a thread", () => {
  it("leaves the branch when there is no remote, and pushes to one that is not GitHub", async () => {
    const t = await thread(["x"]);
    expect(await finishThread({ repo, branch: t.threadBranch, base: "main", title: "T", body: "B" })).toMatchObject({ pushed: false, prUrl: null, message: expect.stringContaining("no remote") });
    const bare = join(root, `bare${n}.git`);
    await run("git", ["init", "-q", "--bare", bare]);
    await sh(repo, "remote", "add", "origin", bare);
    const r = await finishThread({ repo, branch: t.threadBranch, base: "main", title: "T", body: "B" });
    expect(r).toMatchObject({ pushed: true, prUrl: null });
    expect(await sh(bare, "rev-parse", t.threadBranch)).toBe(await sh(repo, "rev-parse", t.threadBranch));
  });
});

describe("a thread across two repos", () => {
  it("keeps one branch name in each, side by side in the computer's folder, landing per repo", async () => {
    const web = repo;
    const api = join(root, `api${n}`);
    await mkdir(api, { recursive: true });
    await sh(api, "init", "-q");
    await writeFile(join(api, "server.ts"), "export const routes = [];\n");
    await sh(api, "add", "-A");
    await sh(api, "commit", "-q", "-m", "api seed");
    const id = "thread-two-repos";
    const branch = threadBranchName("Health endpoint and badge", id);
    // A computer folder from before repos was itself a worktree: it is moved aside.
    const legacy = threadWorktreePath("office1", id);
    await ensureThreadWorktree(web, legacy, "main");
    const dir = await ensureComputerDir(legacy);
    expect(dir).toBe(legacy);
    await expect(stat(join(dir, ".git"))).rejects.toThrow();

    // Before any task starts in a repo, the computer sees its default branch there.
    expect(await threadViewRef(api, branch, "main")).toBe(await sh(api, "rev-parse", "main"));
    const views: Record<string, string> = {};
    for (const [name, r] of [["web", web], ["api", api]] as const) views[name] = (await ensureThreadWorktree(r, threadRepoWorktreePath("office1", id, name), await threadViewRef(r, branch, "main"))).path;
    expect(views["api"]).toBe(join(dir, "api"));
    expect(await readFile(join(dir, "api", "server.ts"), "utf8")).toContain("routes");
    expect(await readFile(join(dir, "web", "app.ts"), "utf8")).toContain("a = 1");

    // The API's task starts first: the thread branch is made in that repo only.
    await ensureThreadBranch(api, branch, "main");
    expect(await threadViewRef(web, branch, "main")).not.toBe(branch);
    const apiTask = { branch: taskBranchName(branch, "health-api"), wt: (await ensureTaskWorktree(api, taskWorktreePath("office1", id, "health-api"), taskBranchName(branch, "health-api"), branch)).path };
    await writeFile(join(apiTask.wt, "health.ts"), "export const health = () => 'ok';\n");
    // Then the web's, on the same branch name in its own repo; both land at once.
    await ensureThreadBranch(web, branch, "main");
    const webTask = { branch: taskBranchName(branch, "health-ui"), wt: (await ensureTaskWorktree(web, taskWorktreePath("office1", id, "health-ui"), taskBranchName(branch, "health-ui"), branch)).path };
    await writeFile(join(webTask.wt, "badge.ts"), "export const badge = 'ok';\n");
    const [a, w] = await Promise.all([
      landTask({ repo: api, threadBranch: branch, taskBranch: apiTask.branch, worktree: apiTask.wt, message: "Health endpoint", author: "Juniper", threadWorktree: views["api"] }),
      landTask({ repo: web, threadBranch: branch, taskBranch: webTask.branch, worktree: webTask.wt, message: "Health badge", author: "Otis", threadWorktree: views["web"] }),
    ]);
    expect(a.ok && w.ok).toBe(true);
    expect(await sh(api, "log", "--format=%s", branch)).toBe("Health endpoint\napi seed");
    expect(await sh(web, "log", "--format=%s", branch)).toBe("Health badge\nseed");
    // Each view follows its own repo's thread branch.
    expect(await readFile(join(dir, "api", "health.ts"), "utf8")).toContain("ok");
    expect(await readFile(join(dir, "web", "badge.ts"), "utf8")).toContain("ok");
    expect(await commitsAhead(api, branch, "main")).toBe(1);
    expect(await commitsAhead(web, "offsite/never-made", "main")).toBe(0);
    // Review diffs stay within the task's repo.
    expect((await taskDiff(api, branch, apiTask.branch)).stat.changed.map((c) => c.path)).toEqual(["health.ts"]);
    expect((await taskDiff(web, branch, apiTask.branch)).landed).toBe(false);
  });
});

describe("setup and ports", () => {
  it("runs the setup command in the worktree, and reports a failure without throwing", async () => {
    const t = await thread(["x"]);
    const ok = await runSetup(t.tasks["x"]!.wt, "echo installed > setup.txt && echo done");
    expect(ok).toMatchObject({ ok: true, timedOut: false, output: "done" });
    expect(await readFile(join(t.tasks["x"]!.wt, "setup.txt"), "utf8")).toBe("installed\n");
    expect(await runSetup(t.tasks["x"]!.wt, "echo broken >&2; exit 3")).toMatchObject({ ok: false, output: "broken" });
    const slow = await runSetup(t.tasks["x"]!.wt, "sleep 5", { timeoutMs: 200 });
    expect(slow).toMatchObject({ ok: false, timedOut: true });
    expect(slow.ms).toBeLessThan(3000);
  });

  it("hands each task its own port", async () => {
    const [a, b] = await Promise.all([allocatePort(), allocatePort()]);
    expect(a).not.toBe(b);
    releasePort(a); releasePort(b);
  });
});
