// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { mkdir, realpath, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { git, gitOk, revParse } from "./git.ts";

export const offsiteHome = () => process.env["OFFSITE_HOME"] ?? join(homedir(), ".offsite");

/** Lowercase kebab-case, at most 40 characters, cut at a word boundary when there is one. */
export function slug(s: string, max = 40): string {
  const kebab = s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (kebab.length > max ? kebab.slice(0, max + 1).replace(/-[^-]*$/, "").slice(0, max) : kebab) || "thread";
}
/** The last six characters of an id, lowercased: enough to tell threads apart. */
export const id6 = (id: string) => id.slice(-6).toLowerCase();

/** offsite/<thread-slug>-<id6>: where every task of a thread lands. */
export const threadBranchName = (title: string, threadId: string) => `offsite/${slug(title)}-${id6(threadId)}`;
/** offsite/<thread-slug>-<id6>-<key>: one task's own branch (a sibling name, so both refs can exist). */
export const taskBranchName = (threadBranch: string, key: string) => `${threadBranch}-${key}`;

/** ~/.offsite/worktrees/<officeId>/<threadId6>: a thread's worktrees, one folder per task and _thread for the computer. */
export const threadDir = (officeId: string, threadId: string) => join(offsiteHome(), "worktrees", officeId, id6(threadId));
export const taskWorktreePath = (officeId: string, threadId: string, key: string) => join(threadDir(officeId, threadId), key);
export const threadWorktreePath = (officeId: string, threadId: string) => join(threadDir(officeId, threadId), "_thread");

const exists = (p: string) => stat(p).then(() => true, () => false);

/** The shared .git directory behind a checkout or worktree. */
const commonDir = async (path: string) => realpath(resolve(path, await git(["rev-parse", "--git-common-dir"], path)));

/**
 * True when `path` is a worktree of `repo`. A folder left from another project (the ship's repo was changed) is moved
 * aside rather than reused or deleted.
 */
async function ownWorktree(repo: string, path: string): Promise<boolean> {
  if (!(await exists(path))) return false;
  const [mine, theirs] = await Promise.all([commonDir(repo), commonDir(path).catch(() => null)]);
  if (theirs === mine && (await exists(join(path, ".git")))) return true;
  await rename(path, `${path}.moved-${Date.now()}`);
  return false;
}

/** The project's checkout, checked: a readable error for a path that is not a git repo with commits. */
export async function openRepo(path: string): Promise<string> {
  if (!(await exists(path))) throw new Error(`The ship's project folder ${path} does not exist on this machine.`);
  const top = await git(["rev-parse", "--show-toplevel"], path).catch(() => null);
  if (!top) throw new Error(`${path} is not a git repository. Run \`git init\` there and make a first commit.`);
  return top;
}

/** The base a new thread branch starts from: the local default branch, else origin's, else HEAD. */
export async function resolveBase(repo: string, defaultBranch: string): Promise<string> {
  for (const ref of [`refs/heads/${defaultBranch}`, `refs/remotes/origin/${defaultBranch}`, "HEAD"]) {
    const sha = await revParse(ref, repo);
    if (sha) return sha;
  }
  throw new Error(`${repo} has no commits yet, and no ${defaultBranch} branch. Make a first commit there.`);
}

/** The thread's branch, created from the office's default branch the first time. Returns its tip. */
export async function ensureThreadBranch(repo: string, branch: string, defaultBranch: string): Promise<string> {
  const have = await revParse(`refs/heads/${branch}`, repo);
  if (have) return have;
  const base = await resolveBase(repo, defaultBranch);
  await git(["branch", branch, base], repo);
  return base;
}

/** Where `branch` is checked out, if anywhere (a worktree path). */
export async function checkedOutAt(repo: string, branch: string): Promise<string | null> {
  const list = await git(["worktree", "list", "--porcelain"], repo);
  let path: string | null = null;
  for (const line of list.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice(9);
    else if (line === `branch refs/heads/${branch}` && path) return path;
  }
  return null;
}

/**
 * The computer's view of the thread: a worktree at the thread branch's tip, detached so the branch itself is free to
 * move when tasks land. Read-mostly: refreshing it discards anything written there.
 */
export async function ensureThreadWorktree(repo: string, path: string, branch: string): Promise<{ path: string; created: boolean }> {
  if (await ownWorktree(repo, path)) {
    await git(["checkout", "--detach", "--force", branch], path);
    return { path, created: false };
  }
  await mkdir(dirname(path), { recursive: true });
  // A worktree folder deleted by hand stays registered and blocks `worktree add` until pruned.
  await git(["worktree", "prune"], repo);
  await git(["worktree", "add", "--detach", path, branch], repo);
  return { path, created: true };
}

/** Bring the thread worktree up to the branch's tip after something landed. Leaves it alone if it is gone. */
export async function refreshThreadWorktree(path: string, branch: string): Promise<void> {
  if (await exists(join(path, ".git"))) await git(["checkout", "--detach", "--force", branch], path);
}

/**
 * A task's worktree on its own branch, created from the thread branch's tip the first time. A task sent back reuses
 * its worktree and branch as they were.
 */
export async function ensureTaskWorktree(repo: string, path: string, branch: string, from: string): Promise<{ path: string; created: boolean }> {
  if (await ownWorktree(repo, path)) {
    const current = await git(["rev-parse", "--abbrev-ref", "HEAD"], path).catch(() => "");
    if (current !== branch) await git(["checkout", branch], path);
    return { path, created: false };
  }
  await mkdir(dirname(path), { recursive: true });
  await git(["worktree", "prune"], repo);
  if (await revParse(`refs/heads/${branch}`, repo)) await git(["worktree", "add", path, branch], repo);
  else await git(["worktree", "add", "-b", branch, path, from], repo);
  return { path, created: true };
}

/** Remove a worktree Offsite made (the branch stays). */
export async function removeWorktree(repo: string, path: string): Promise<void> {
  if (await gitOk(["worktree", "remove", "--force", path], repo)) return;
  await git(["worktree", "prune"], repo).catch(() => {});
}
