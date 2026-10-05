import { capPatch, DIFF_LIMITS, type ChangedFile, type ChangeStats, type DiffResult, type FileStatus } from "@offsite/contracts";
import { git, revParse } from "./git.ts";
import { taskTrailer } from "./land.ts";
import { resolveBase } from "./worktrees.ts";

// What the captain reviews: a task's changes, or everything a thread changed in one repo, as a file list with counts
// and a unified diff (capped). Read-only: nothing here moves a branch or touches a worktree.

const STATUS: Record<string, FileStatus> = { A: "added", D: "deleted", M: "modified", R: "renamed", C: "copied", T: "typechange" };

/** `git diff --name-status -z` and `--numstat -z` for the same range, joined into one list. */
export function parseChanges(nameStatus: string, numstat: string): ChangedFile[] {
  const out = new Map<string, ChangedFile>();
  const ns = nameStatus.split("\0");
  for (let i = 0; i < ns.length;) {
    const code = ns[i++];
    if (!code) continue;
    const status = STATUS[code[0]!] ?? "modified";
    const two = status === "renamed" || status === "copied";
    const oldPath = two ? ns[i++]! : null;
    const path = ns[i++]!;
    out.set(path, { path, oldPath, status, added: 0, removed: 0, binary: false });
  }
  // numstat -z: "a\td\tpath\0", or for a rename "a\td\t\0old\0new\0". Binary files count "-".
  const nu = numstat.split("\0");
  for (let i = 0; i < nu.length;) {
    const line = nu[i++];
    if (!line) continue;
    const [a, d, p = ""] = line.split("\t");
    let path = p;
    if (!p) { i++; path = nu[i++] ?? ""; }
    const f = out.get(path) ?? { path, oldPath: null, status: "modified" as FileStatus, added: 0, removed: 0, binary: false };
    if (a === "-" || d === "-") f.binary = true;
    else { f.added += Number(a) || 0; f.removed += Number(d) || 0; }
    out.set(path, f);
  }
  return [...out.values()];
}

export function statsOf(files: ChangedFile[]): ChangeStats {
  return { added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0), files: files.length };
}

/** Several changes to the same files, one after another (a task landed twice): one row per file, counts summed. */
function mergeChanges(lists: ChangedFile[][]): ChangedFile[] {
  const out = new Map<string, ChangedFile>();
  for (const list of lists) {
    for (const f of list) {
      const was = out.get(f.path);
      if (!was) { out.set(f.path, { ...f }); continue; }
      was.added += f.added; was.removed += f.removed; was.binary ||= f.binary;
      if (was.status === "added" && f.status === "deleted") out.delete(f.path);
      else if (was.status !== "added") was.status = f.status;
    }
  }
  return [...out.values()];
}

const DIFF_FLAGS = ["-M", "--no-color", "--no-ext-diff"];

async function range(repo: string, from: string, to: string, withPatch = true): Promise<{ files: ChangedFile[]; patch: string }> {
  const [names, nums, patch] = await Promise.all([
    git(["diff", ...DIFF_FLAGS, "--name-status", "-z", from, to], repo),
    git(["diff", ...DIFF_FLAGS, "--numstat", "-z", from, to], repo),
    withPatch ? git(["diff", ...DIFF_FLAGS, from, to], repo) : Promise.resolve(""),
  ]);
  return { files: parseChanges(names, nums), patch };
}

function result(sha: string, base: string | null, files: ChangedFile[], patch: string, maxChars: number): DiffResult {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const capped = capPatch(patch, maxChars);
  return { sha, base, stats: statsOf(sorted), files: sorted.slice(0, DIFF_LIMITS.files), patch: capped.patch, truncated: capped.truncated || sorted.length > DIFF_LIMITS.files };
}

/** The commits on the thread branch that carry a task's trailer (oldest first): what it landed. */
export async function landedCommits(repo: string, threadBranch: string, taskBranch: string): Promise<string[]> {
  if (!(await revParse(`refs/heads/${threadBranch}`, repo))) return [];
  const grep = `^${taskTrailer(taskBranch).replace(/[.*[\]\\^$+?(){}|]/g, "\\$&")}$`;
  const out = await git(["log", "--format=%H", "--max-count=500", "--extended-regexp", `--grep=${grep}`, `refs/heads/${threadBranch}`], repo).catch(() => "");
  return out.split("\n").filter(Boolean).reverse();
}

/**
 * What a task changed. Once landed: the commits on the thread branch carrying its trailer, each against its parent
 * (computed at the last of them). Before: its branch against where it left the thread branch. Null when it has neither.
 */
export async function taskChanges(o: { repo: string; threadBranch: string; taskBranch: string; maxChars?: number }): Promise<DiffResult | null> {
  const max = o.maxChars ?? DIFF_LIMITS.patchChars;
  const landed = await landedCommits(o.repo, o.threadBranch, o.taskBranch);
  if (landed.length) {
    const parts = await Promise.all(landed.map((sha) => range(o.repo, `${sha}^`, sha)));
    const base = await revParse(`${landed[0]}^`, o.repo);
    return result(landed.at(-1)!, base, mergeChanges(parts.map((p) => p.files)), parts.map((p) => p.patch).filter(Boolean).join("\n"), max);
  }
  const tip = await revParse(`refs/heads/${o.taskBranch}`, o.repo);
  if (!tip) return null;
  const threadTip = await revParse(`refs/heads/${o.threadBranch}`, o.repo);
  const base = threadTip ? await git(["merge-base", threadTip, tip], o.repo) : `${tip}^`;
  const r = await range(o.repo, base, tip);
  return result(tip, base, r.files, r.patch, max);
}

/** A landed task's size ("+38 −2 · 2 files"), recorded when it lands. Null when nothing of it is on the thread branch. */
export async function taskStats(o: { repo: string; threadBranch: string; taskBranch: string }): Promise<ChangeStats | null> {
  const landed = await landedCommits(o.repo, o.threadBranch, o.taskBranch);
  if (!landed.length) return null;
  const parts = await Promise.all(landed.map((sha) => range(o.repo, `${sha}^`, sha, false)));
  return statsOf(mergeChanges(parts.map((p) => p.files)));
}

/** Everything a thread changed in one repo: its branch against where it left the default branch. Null before the branch exists. */
export async function threadChanges(o: { repo: string; threadBranch: string; defaultBranch: string; maxChars?: number }): Promise<DiffResult | null> {
  const tip = await revParse(`refs/heads/${o.threadBranch}`, o.repo);
  if (!tip) return null;
  const main = await resolveBase(o.repo, o.defaultBranch);
  const base = await git(["merge-base", main, tip], o.repo);
  const r = await range(o.repo, base, tip);
  return result(tip, base, r.files, r.patch, o.maxChars ?? DIFF_LIMITS.patchChars);
}

/** The sha a diff would be computed at now, to skip the work when nothing moved. */
export async function changesAt(o: { repo: string; threadBranch: string; taskBranch?: string | null }): Promise<string | null> {
  if (o.taskBranch) {
    const landed = await landedCommits(o.repo, o.threadBranch, o.taskBranch);
    return landed.at(-1) ?? (await revParse(`refs/heads/${o.taskBranch}`, o.repo));
  }
  return revParse(`refs/heads/${o.threadBranch}`, o.repo);
}
