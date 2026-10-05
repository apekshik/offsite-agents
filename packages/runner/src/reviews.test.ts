import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ensureTaskWorktree, ensureThreadBranch, landTask, taskBranchName, taskWorktreePath, threadBranchName } from "@offsite/git";
import { Reviews, type DiffAnswer, type ReviewBackend, type ReviewWork } from "./reviews.ts";

const run = promisify(execFile);
const sh = (cwd: string, ...args: string[]) => run("git", args, { cwd }).then((r) => r.stdout.trim());

let root: string;
const saved: Record<string, string | undefined> = {};
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "offsite-reviews-"));
  await writeFile(join(root, "gitconfig"), "[user]\n\tname = Captain\n\temail = captain@example.com\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n");
  for (const [k, v] of Object.entries({ GIT_CONFIG_GLOBAL: join(root, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", OFFSITE_HOME: join(root, "home") })) { saved[k] = process.env[k]; process.env[k] = v; }
});
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true });
});

/** diffs.work in memory: jobs stay listed until answered, like the ship. */
class FakeReviews implements ReviewBackend {
  work: ReviewWork = { diffs: [], editors: [] };
  answers = new Map<string, DiffAnswer>();
  opened = new Map<string, { ok: boolean; result: string }>();
  private listener: ((w: ReviewWork) => void) | null = null;
  watch(on: (w: ReviewWork) => void) { this.listener = on; on(this.work); return () => { this.listener = null; }; }
  push(w: Partial<ReviewWork>) { this.work = { ...this.work, ...w }; this.listener?.(this.work); }
  async put(diffId: string, answer: DiffAnswer) {
    this.answers.set(diffId, answer);
    this.push({ diffs: this.work.diffs.filter((d) => d.diffId !== diffId) });
  }
  async editorDone(requestId: string, ok: boolean, result: string) {
    this.opened.set(requestId, { ok, result });
    this.push({ editors: this.work.editors.filter((d) => d.requestId !== requestId) });
  }
}

describe("the review worker", () => {
  it("computes a thread's diff and a task's, skips unchanged work, explains what it can't do, and opens folders", async () => {
    const repo = join(root, "web");
    await mkdir(repo, { recursive: true });
    await sh(repo, "init", "-q");
    await writeFile(join(repo, "index.html"), "<h1>Hi</h1>\n");
    await sh(repo, "add", "-A");
    await sh(repo, "commit", "-q", "-m", "seed");
    const officeId = "office1", threadId = "k57thread00abc1";
    const threadBranch = threadBranchName("Add a counter", threadId);
    await ensureThreadBranch(repo, threadBranch, "main");
    const taskBranch = taskBranchName(threadBranch, "page");
    const { path: wt } = await ensureTaskWorktree(repo, taskWorktreePath(officeId, threadId, "page"), taskBranch, threadBranch);
    await writeFile(join(wt, "counter.ts"), "let n = 0;\n");
    expect((await landTask({ repo, threadBranch, taskBranch, worktree: wt, message: "Counter", author: "Marlo" })).ok).toBe(true);

    const ship = new FakeReviews();
    const opened: string[] = [];
    const reviews = new Reviews({ backend: ship, log: () => {}, open: async (p) => { opened.push(p); return "Cursor"; } });
    reviews.start();
    const where = { officeId, threadId, threadBranch, repo: { name: "web", path: repo, defaultBranch: "main" } };
    ship.push({
      diffs: [
        { diffId: "d-thread", knownSha: null, task: null, ...where },
        { diffId: "d-task", knownSha: null, task: { key: "page", branch: taskBranch }, ...where },
        { diffId: "d-none", knownSha: null, task: null, ...where, threadBranch: null },
        { diffId: "d-gone", knownSha: null, task: null, ...where, repo: { name: "api", path: join(root, "nowhere"), defaultBranch: "main" } },
      ],
      editors: [{ requestId: "e1", task: { key: "page", branch: taskBranch }, ...where }],
    });
    await reviews.idle();

    const thread = ship.answers.get("d-thread")!;
    expect("result" in thread && thread.result.stats).toEqual({ added: 1, removed: 0, files: 1 });
    const sha = "result" in thread ? thread.result.sha : "";
    expect(sha).toBe(await sh(repo, "rev-parse", threadBranch));
    const task = ship.answers.get("d-task")!;
    expect("result" in task && task.result.files.map((f) => f.path)).toEqual(["counter.ts"]);
    expect(ship.answers.get("d-none")).toEqual({ error: expect.stringMatching(/No work has started/) });
    expect(ship.answers.get("d-gone")).toEqual({ error: expect.stringMatching(/isn't readable on this machine/) });
    expect(opened).toEqual([taskWorktreePath(officeId, threadId, "page")]);
    expect(ship.opened.get("e1")).toEqual({ ok: true, result: "Opened the task's worktree in Cursor." });

    // Asked again with nothing moved: no recompute.
    ship.push({ diffs: [{ diffId: "d-again", knownSha: sha, task: null, ...where }] });
    await reviews.idle();
    expect(ship.answers.get("d-again")).toEqual({ unchanged: true });
    await reviews.stop();
  });
});
