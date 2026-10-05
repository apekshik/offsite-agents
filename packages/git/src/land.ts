import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { git, gitOk, identity, revParse } from "./git.ts";
import { checkedOutAt, refreshThreadWorktree } from "./worktrees.ts";

// Landing: each task's work goes onto the thread's branch one task at a time, as one commit, rebased onto whatever
// landed before it. A conflict is handed back (rebase aborted, nothing half-done) so the crew member who wrote the
// work resolves it in their own worktree.

/**
 * One queue per key in this process. Keyed `<repo>#<thread branch>`: landings and syncs on a thread never interleave
 * within a repo, while the same thread's work in another repo lands alongside.
 */
const queues = new Map<string, Promise<unknown>>();
export function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(key, next);
  void next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
  return next;
}

/** Files git reports as unmerged in a worktree. */
const unmerged = (wt: string) => git(["diff", "--name-only", "--diff-filter=U"], wt).then((s) => s.split("\n").filter(Boolean), () => [] as string[]);
const inMerge = (wt: string) => revParse("MERGE_HEAD", wt).then(Boolean);
async function inRebase(wt: string): Promise<boolean> {
  for (const dir of ["rebase-merge", "rebase-apply"]) {
    const p = await git(["rev-parse", "--git-path", dir], wt).catch(() => "");
    if (p && (await stat(isAbsolute(p) ? p : join(wt, p)).then(() => true, () => false))) return true;
  }
  return false;
}

/**
 * Commit everything in the worktree, by the crew member. A run always ends with this, whatever happened, so no work
 * is left only in a folder. Hooks are skipped: these are the ship's mechanical commits, and a hook that fails or waits
 * would strand the work; the pull request's checks still run.
 */
export async function commitAll(wt: string, message: string, author: string): Promise<{ committed: boolean; sha: string | null }> {
  if (await inRebase(wt)) await git(["rebase", "--abort"], wt).catch(() => {});
  await git(["add", "-A"], wt);
  const dirty = !!(await git(["status", "--porcelain"], wt));
  const merging = await inMerge(wt);
  if (!dirty && !merging) return { committed: false, sha: await revParse("HEAD", wt) };
  const id = await identity(wt, author);
  await git(["commit", "--no-verify", "--allow-empty", "-m", message, `--author=${id.author}`], wt, { env: id.env });
  return { committed: true, sha: await revParse("HEAD", wt) };
}

/** Files that still hold conflict markers, of those given. */
export async function conflictMarkers(wt: string, files: string[]): Promise<string[]> {
  const left: string[] = [];
  for (const f of files) {
    const text = await readFile(join(wt, f), "utf8").catch(() => "");
    if (/^(<<<<<<<|>>>>>>>) /m.test(text)) left.push(f);
  }
  return left;
}

export type LandResult = { ok: true; sha: string; empty: boolean } | { ok: false; conflict: string[] };

export interface LandInput {
  repo: string;
  threadBranch: string;
  taskBranch: string;
  /** The task's worktree, on taskBranch. Anything uncommitted is committed first. */
  worktree: string;
  /** The landed commit's message. A trailer naming the task branch is added, so review_task can find it later. */
  message: string;
  /** The crew member's name; the commit is "<name> (Offsite)". */
  author: string;
  /** The computer's worktree, refreshed to the new tip. */
  threadWorktree?: string;
}

export const taskTrailer = (taskBranch: string) => `Offsite-Task: ${taskBranch}`;

/**
 * Land a task: squash its work since it last met the thread branch into one commit, rebase that onto the thread
 * branch's tip, and fast-forward the thread branch to it. Serialized per thread and repo. On a conflict the rebase is aborted
 * and the files are returned; the task branch keeps its (squashed) work.
 */
export function landTask(input: LandInput): Promise<LandResult> {
  return serialized(`${input.repo}#${input.threadBranch}`, () => land(input));
}

async function land({ repo, threadBranch, taskBranch, worktree, message, author, threadWorktree }: LandInput): Promise<LandResult> {
  await commitAll(worktree, message, author);
  const tip = await revParse(`refs/heads/${threadBranch}`, repo);
  if (!tip) throw new Error(`The thread branch ${threadBranch} is gone`);
  const head = await revParse("HEAD", worktree);
  if (!head) throw new Error(`${worktree} has no commits`);
  const base = await git(["merge-base", head, tip], worktree);
  if (await gitOk(["diff", "--quiet", base, head], worktree)) return { ok: true, sha: tip, empty: true };
  const id = await identity(worktree, author);

  // One commit per task: the history reads as the plan did, and a later rebase replays a single change.
  await git(["reset", "--soft", base], worktree);
  await git(["commit", "--no-verify", "-m", `${message.trim()}\n\n${taskTrailer(taskBranch)}`, `--author=${id.author}`], worktree, { env: id.env });

  if (base !== tip) {
    const rebased = await git(["rebase", tip], worktree, { env: id.env }).then(() => true, () => false);
    if (!rebased) {
      const files = await unmerged(worktree);
      await git(["rebase", "--abort"], worktree).catch(() => {});
      return { ok: false, conflict: files.length ? files : ["(unknown files)"] };
    }
  }
  const sha = (await revParse("HEAD", worktree))!;
  await advance(repo, threadBranch, tip, sha);
  if (threadWorktree) await refreshThreadWorktree(threadWorktree, threadBranch).catch(() => {});
  return { ok: true, sha, empty: false };
}

/** Move a branch forward from `from` to `to`. Where it is checked out (the captain's own checkout, say), as a fast-forward there. */
async function advance(repo: string, branch: string, from: string, to: string): Promise<void> {
  const at = await checkedOutAt(repo, branch);
  if (at) await git(["merge", "--ff-only", to], at);
  else await git(["update-ref", `refs/heads/${branch}`, to, from], repo);
}

/**
 * Leave a conflict for the crew member to resolve: merge the thread branch into the task's worktree without
 * committing, so the conflicted files hold markers. Returns them ([] when it merged cleanly, then committed).
 */
export async function prepareConflict(worktree: string, threadBranch: string, author: string): Promise<string[]> {
  const id = await identity(worktree, author);
  const clean = await git(["merge", "--no-ff", "--no-commit", threadBranch], worktree, { env: id.env }).then(() => true, () => false);
  if (clean) {
    if (await inMerge(worktree)) await git(["commit", "--no-verify", "--no-edit", `--author=${id.author}`], worktree, { env: id.env });
    return [];
  }
  return unmerged(worktree);
}

export type SyncResult = { ok: true; upToDate: boolean; brought: number } | { ok: false; conflict: string[] };

/**
 * sync_with_team: bring what teammates landed into a task's worktree. Commits the work in progress, then rebases it
 * onto the thread branch's tip. On a conflict the rebase is undone and a merge left in its place with markers in the
 * conflicted files, for the agent to resolve where it stands.
 */
export function syncTask(input: { repo: string; worktree: string; threadBranch: string; author: string }): Promise<SyncResult> {
  return serialized(`${input.repo}#${input.threadBranch}`, async () => {
    const { worktree, threadBranch, author } = input;
    if (await inMerge(worktree)) {
      const left = await conflictMarkers(worktree, await unmerged(worktree));
      if (left.length) return { ok: false, conflict: left };
    }
    await commitAll(worktree, "Work in progress (synced with the team)", author);
    const tip = await revParse(`refs/heads/${threadBranch}`, worktree);
    if (!tip) throw new Error(`The thread branch ${threadBranch} is gone`);
    const base = await git(["merge-base", "HEAD", tip], worktree);
    if (base === tip) return { ok: true, upToDate: true, brought: 0 };
    const brought = Number(await git(["rev-list", "--count", `${base}..${tip}`], worktree)) || 0;
    const id = await identity(worktree, author);
    if (await git(["rebase", tip], worktree, { env: id.env }).then(() => true, () => false)) return { ok: true, upToDate: false, brought };
    await git(["rebase", "--abort"], worktree).catch(() => {});
    const files = await prepareConflict(worktree, threadBranch, author);
    return files.length ? { ok: false, conflict: files } : { ok: true, upToDate: false, brought };
  });
}

export interface DiffStat { files: number; add: number; del: number; changed: { path: string; add: number; del: number }[] }
const numstat = (out: string): DiffStat => {
  const per = new Map<string, { add: number; del: number }>();
  for (const line of out.split("\n").filter(Boolean)) {
    const [a, d, ...p] = line.split("\t");
    const path = p.join("\t");
    const prev = per.get(path) ?? { add: 0, del: 0 };
    per.set(path, { add: prev.add + (Number(a) || 0), del: prev.del + (Number(d) || 0) });
  }
  const changed = [...per.entries()].map(([path, s]) => ({ path, ...s }));
  return { files: changed.length, add: changed.reduce((n, c) => n + c.add, 0), del: changed.reduce((n, c) => n + c.del, 0), changed };
};

/**
 * What a task changed, for review_task. Once landed: the commits on the thread branch that carry its trailer. Before:
 * its branch against the thread branch. The diff is cut at `maxChars`.
 */
export async function taskDiff(repo: string, threadBranch: string, taskBranch: string, maxChars = 60_000): Promise<{ landed: boolean; stat: DiffStat; diff: string; truncated: boolean }> {
  const landedShas = (await git(["log", "--format=%H", "--max-count=500", `--grep=^${taskTrailer(taskBranch).replace(/[.*[\]\\^$]/g, "\\$&")}$`, `refs/heads/${threadBranch}`], repo).catch(() => "")).split("\n").filter(Boolean).reverse();
  let stat: DiffStat, diff: string;
  if (landedShas.length) {
    const shows = await Promise.all(landedShas.map((sha) => git(["show", "--format=", "--patch", sha], repo)));
    const stats = await Promise.all(landedShas.map((sha) => git(["show", "--format=", "--numstat", sha], repo)));
    stat = numstat(stats.join("\n")); diff = shows.join("\n");
  } else {
    if (!(await revParse(`refs/heads/${taskBranch}`, repo))) return { landed: false, stat: numstat(""), diff: "", truncated: false };
    const range = `refs/heads/${threadBranch}...refs/heads/${taskBranch}`;
    stat = numstat(await git(["diff", "--numstat", range], repo)); diff = await git(["diff", range], repo);
  }
  const truncated = diff.length > maxChars;
  return { landed: landedShas.length > 0, stat, diff: truncated ? diff.slice(0, maxChars) + `\n… (${diff.length - maxChars} more characters)` : diff, truncated };
}
