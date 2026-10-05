import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  changesAt, ensureTaskWorktree, ensureThreadBranch, landTask, parseChanges, taskBranchName, taskChanges, taskStats, taskWorktreePath, threadBranchName,
  threadChanges,
} from "./index.ts";

const run = promisify(execFile);
const sh = (cwd: string, ...args: string[]) => run("git", args, { cwd }).then((r) => r.stdout.trim());

let root: string;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "offsite-review-"));
  await writeFile(join(root, "gitconfig"), "[user]\n\tname = Captain\n\temail = captain@example.com\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n");
  for (const [k, v] of Object.entries({ GIT_CONFIG_GLOBAL: join(root, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", OFFSITE_HOME: join(root, "home") })) { saved[k] = process.env[k]; process.env[k] = v; }
});
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true });
});

async function repoNamed(name: string, files: Record<string, string>) {
  const repo = join(root, name);
  await mkdir(repo, { recursive: true });
  await sh(repo, "init", "-q");
  for (const [f, text] of Object.entries(files)) await writeFile(join(repo, f), text);
  await sh(repo, "add", "-A");
  await sh(repo, "commit", "-q", "-m", "seed");
  return repo;
}

/** A task in `repo` on the thread's branch: write files in its worktree, then land it. */
async function task(repo: string, threadId: string, threadBranch: string, key: string, files: Record<string, string>, land = true) {
  await ensureThreadBranch(repo, threadBranch, "main");
  const branch = taskBranchName(threadBranch, key);
  const { path: wt } = await ensureTaskWorktree(repo, taskWorktreePath(`office-${threadId}`, threadId, key), branch, threadBranch);
  for (const [f, text] of Object.entries(files)) await writeFile(join(wt, f), text);
  if (land) {
    const r = await landTask({ repo, threadBranch, taskBranch: branch, worktree: wt, message: `Do ${key}`, author: "Marlo" });
    expect(r.ok).toBe(true);
  } else {
    await sh(wt, "add", "-A");
    await sh(wt, "commit", "-q", "-m", "wip");
  }
  return branch;
}

describe("parseChanges", () => {
  it("joins name-status and numstat, with renames and binary files", () => {
    const names = ["M", "a.ts", "A", "b.ts", "R087", "old.md", "new.md", "D", "gone.png", ""].join("\0");
    const nums = ["3\t1\ta.ts", "5\t0\tb.ts", "2\t2\t", "old.md", "new.md", "-\t-\tgone.png", ""].join("\0");
    expect(parseChanges(names, nums)).toEqual([
      { path: "a.ts", oldPath: null, status: "modified", added: 3, removed: 1, binary: false },
      { path: "b.ts", oldPath: null, status: "added", added: 5, removed: 0, binary: false },
      { path: "new.md", oldPath: "old.md", status: "renamed", added: 2, removed: 2, binary: false },
      { path: "gone.png", oldPath: null, status: "deleted", added: 0, removed: 0, binary: true },
    ]);
  });
});

describe("a thread's changes, per repo", () => {
  it("diffs each repo's thread branch against where it left main, and each task by its landed commit", async () => {
    const threadId = "k57thread000001";
    const threadBranch = threadBranchName("Add a counter page", threadId);
    const web = await repoNamed("web", { "index.html": "<h1>Hi</h1>\n", "app.ts": "export const a = 1;\n" });
    const api = await repoNamed("api", { "server.ts": "listen();\n" });

    // Main moves on after the thread starts: that must not show as the thread's change.
    const page = await task(web, threadId, threadBranch, "page", { "counter.ts": "let n = 0;\nexport const up = () => ++n;\n", "app.ts": "export const a = 2;\n" });
    await writeFile(join(web, "README.md"), "# Web\n");
    await sh(web, "add", "-A");
    await sh(web, "commit", "-q", "-m", "captain's own work on main");
    const style = await task(web, threadId, threadBranch, "style", { "counter.css": "button { color: cyan; }\n" });
    const route = await task(api, threadId, threadBranch, "route", { "counter.ts": "export const route = '/count';\n" });

    const w = (await threadChanges({ repo: web, threadBranch, defaultBranch: "main" }))!;
    expect(w.files.map((f) => `${f.status} ${f.path} +${f.added} -${f.removed}`)).toEqual([
      "modified app.ts +1 -1", "added counter.css +1 -0", "added counter.ts +2 -0",
    ]);
    expect(w.stats).toEqual({ added: 4, removed: 1, files: 3 });
    expect(w.sha).toBe(await sh(web, "rev-parse", threadBranch));
    expect(w.patch).toContain("+export const up = () => ++n;");
    expect(w.patch).not.toContain("README");
    expect(w.truncated).toBe(false);

    const a = (await threadChanges({ repo: api, threadBranch, defaultBranch: "main" }))!;
    expect(a.files.map((f) => f.path)).toEqual(["counter.ts"]);
    expect(a.patch).not.toContain("counter.css");

    // One task: only its own commit, even with a teammate's landed after it.
    const p = (await taskChanges({ repo: web, threadBranch, taskBranch: page }))!;
    expect(p.files.map((f) => f.path)).toEqual(["app.ts", "counter.ts"]);
    expect(p.stats).toEqual({ added: 3, removed: 1, files: 2 });
    expect(p.sha).toBe(await changesAt({ repo: web, threadBranch, taskBranch: page }));
    expect(await taskStats({ repo: web, threadBranch, taskBranch: page })).toEqual({ added: 3, removed: 1, files: 2 });
    const s = (await taskChanges({ repo: web, threadBranch, taskBranch: style }))!;
    expect(s.files.map((f) => f.path)).toEqual(["counter.css"]);
    expect((await taskChanges({ repo: api, threadBranch, taskBranch: route }))!.stats.files).toBe(1);

    // A thread with no branch in a repo has no changes there; a task not landed yet shows its branch's work.
    expect(await threadChanges({ repo: api, threadBranch: "offsite/nothing-here", defaultBranch: "main" })).toBeNull();
    const wip = await task(web, threadId, threadBranch, "wip", { "draft.md": "half done\n" }, false);
    const d = (await taskChanges({ repo: web, threadBranch, taskBranch: wip }))!;
    expect(d.files.map((f) => f.path)).toEqual(["draft.md"]);
    expect(d.sha).toBe(await sh(web, "rev-parse", wip));
  });

  it("cuts a big diff and says so", async () => {
    const threadId = "k57thread000002";
    const threadBranch = threadBranchName("Big", threadId);
    const repo = await repoNamed("big", { "a.txt": "a\n" });
    await task(repo, threadId, threadBranch, "big", { "big.txt": Array.from({ length: 4000 }, (_, i) => `line ${i}`).join("\n") + "\n" });
    const r = (await threadChanges({ repo, threadBranch, defaultBranch: "main", maxChars: 5000 }))!;
    expect(r.truncated).toBe(true);
    expect(r.patch.length).toBeLessThanOrEqual(5000);
    expect(r.stats.added).toBe(4000);
  });
});
