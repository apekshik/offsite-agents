import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import type { DiffResult } from "@offsite/contracts";
import { which } from "@offsite/harness";
import {
  changesAt, expandHome, openRepo, taskBranchName, taskChanges, taskWorktreePath, threadChanges, threadRepoWorktreePath,
} from "@offsite/git";

// The captain reading the crew's work: diffs the app asked for (computed here, where the repo is) and "Open in editor".
// Both arrive in diffs.work; neither touches a branch or a worktree's files.

interface Where {
  officeId: string;
  threadId: string;
  /** The thread's branch name (the same in each repo); null before any task started. */
  threadBranch: string | null;
  repo: { name: string; path: string; defaultBranch: string };
  task: { key: string; branch: string | null } | null;
}
export interface DiffJob extends Where { diffId: string; knownSha: string | null }
export interface EditorJob extends Where { requestId: string }
export interface ReviewWork { diffs: DiffJob[]; editors: EditorJob[] }
export type DiffAnswer = { result: DiffResult } | { unchanged: true } | { error: string };

/** What the review worker needs from the ship (convex/diffs.ts). */
export interface ReviewBackend {
  watch(onWork: (w: ReviewWork) => void, onError?: (e: Error) => void): () => void;
  put(diffId: string, answer: DiffAnswer): Promise<void>;
  editorDone(requestId: string, ok: boolean, result: string): Promise<void>;
}

const exists = (p: string) => stat(p).then(() => true, () => false);
const readable = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);

/** Compute one diff: a task's changes or a thread's in one repo. Skips the work when the branch hasn't moved. */
export async function computeDiff(job: DiffJob): Promise<DiffAnswer> {
  if (!job.threadBranch) return { error: "No work has started on this thread yet, so there is nothing to show." };
  let repo: string;
  try { repo = await openRepo(expandHome(job.repo.path)); }
  catch (e) { return { error: `The repo "${job.repo.name}" isn't readable on this machine: ${readable(e)}` }; }
  const taskBranch = job.task ? job.task.branch ?? taskBranchName(job.threadBranch, job.task.key) : null;
  if (job.knownSha && (await changesAt({ repo, threadBranch: job.threadBranch, taskBranch }).catch(() => null)) === job.knownSha) return { unchanged: true };
  const result = taskBranch
    ? await taskChanges({ repo, threadBranch: job.threadBranch, taskBranch })
    : await threadChanges({ repo, threadBranch: job.threadBranch, defaultBranch: job.repo.defaultBranch });
  if (!result) return { error: taskBranch ? `The task's branch ${taskBranch} isn't in ${job.repo.name} on this machine.` : `The branch ${job.threadBranch} isn't in ${job.repo.name} on this machine yet.` };
  return { result };
}

/** The folder to open: the task's worktree, else the thread's branch for that repo (the computer's view of it), else the checkout. */
export async function folderFor(job: Where): Promise<{ path: string; what: string }> {
  if (job.task) {
    const wt = taskWorktreePath(job.officeId, job.threadId, job.task.key);
    if (await exists(wt)) return { path: wt, what: "the task's worktree" };
  }
  const view = threadRepoWorktreePath(job.officeId, job.threadId, job.repo.name);
  if (job.threadBranch && (await exists(view))) return { path: view, what: `the thread's branch in ${job.repo.name}` };
  return { path: expandHome(job.repo.path), what: `the ${job.repo.name} checkout` };
}

/** Open a folder in the captain's editor: $OFFSITE_EDITOR, VS Code or Cursor when on PATH, else the system's opener. */
export async function openInEditor(path: string): Promise<string> {
  const own = process.env["OFFSITE_EDITOR"]?.trim();
  const found = own ? own : (await which("code")) ? "code" : (await which("cursor")) ? "cursor" : null;
  const bin = found ?? (process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, [path], { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
  const name: Record<string, string> = { code: "VS Code", cursor: "Cursor", open: "Finder", "xdg-open": "your file manager", explorer: "Explorer" };
  return name[bin] ?? bin;
}

export interface ReviewsOptions {
  backend: ReviewBackend;
  log?: (line: string) => void;
  /** For tests: what opening a folder does. */
  open?: (path: string) => Promise<string>;
}

/** Answers diffs.work: each job once, a few at a time. */
export class Reviews {
  private readonly o: ReviewsOptions;
  private readonly busy = new Set<string>();
  private readonly done = new Map<string, number>();
  private unsubscribe: (() => void) | null = null;
  private running: Promise<unknown>[] = [];

  constructor(o: ReviewsOptions) { this.o = o; }
  private log(line: string) { (this.o.log ?? ((l: string) => console.log(l)))(line); }

  start() {
    this.unsubscribe = this.o.backend.watch((w) => this.onWork(w), (e) => this.log(`review subscription: ${readable(e)}`));
  }

  async stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    await Promise.allSettled(this.running);
  }

  /** Resolves once every job taken so far has been answered. */
  idle(): Promise<void> { return Promise.allSettled(this.running).then(() => {}); }

  private take(id: string): boolean {
    // A job stays in the list until the ship has our answer; don't do it twice meanwhile.
    if (this.busy.has(id) || (this.done.get(id) ?? 0) > Date.now()) return false;
    this.busy.add(id);
    return true;
  }
  private track(id: string, p: Promise<unknown>) {
    const run = p.catch((e) => this.log(`review ${id.slice(-6)}: ${readable(e)}`)).finally(() => {
      this.busy.delete(id);
      this.done.set(id, Date.now() + 5000);
      this.running = this.running.filter((x) => x !== run);
    });
    this.running.push(run);
  }

  onWork(w: ReviewWork) {
    for (const job of w.diffs.slice(0, 4)) {
      if (!this.take(job.diffId)) continue;
      this.track(job.diffId, (async () => {
        const answer = await computeDiff(job).catch((e): DiffAnswer => ({ error: readable(e) }));
        await this.o.backend.put(job.diffId, answer);
        const what = job.task ? `task ${job.task.key}` : `thread in ${job.repo.name}`;
        this.log("result" in answer ? `diff for ${what}: +${answer.result.stats.added} -${answer.result.stats.removed} in ${answer.result.stats.files} files` : "unchanged" in answer ? `diff for ${what}: unchanged` : `diff for ${what}: ${answer.error}`);
      })());
    }
    for (const job of w.editors) {
      if (!this.take(job.requestId)) continue;
      this.track(job.requestId, (async () => {
        const { path, what } = await folderFor(job);
        try {
          const app = await (this.o.open ?? openInEditor)(path);
          await this.o.backend.editorDone(job.requestId, true, `Opened ${what} in ${app}.`);
          this.log(`opened ${path} in ${app}`);
        } catch (e) {
          await this.o.backend.editorDone(job.requestId, false, `Couldn't open ${what}: ${readable(e)}`);
        }
      })());
    }
  }
}
