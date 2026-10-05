import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { MAX_REPOS } from "@offsite/contracts";
import { fail } from "./lib";

export { MAX_REPOS };

type Ctx = QueryCtx | MutationCtx;

// An office's repos: the projects its crew works on, each a git checkout on one of the captain's machines. Shared by
// the app's mutations, the runner's API and the computer's tools.

/** A repo as everything else reads it. `_id` is null only for an office not yet migrated (its legacy `repo`). */
export interface RepoView {
  _id: Id<"repos"> | null;
  officeId: Id<"offices">;
  name: string;
  machineId: Id<"machines">;
  path: string;
  defaultBranch: string;
  setupCommand: string | null;
  createdAt: number;
}

const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** "web", from "~/code/My Web App/" → "my-web-app". */
export function nameFromPath(path: string): string {
  const last = path.trim().replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? "";
  return cleanName(last) || "repo";
}

/** Lowercase letters, digits and dashes, at most 32. */
export function cleanName(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");
}

export function checkName(name: string): string {
  const n = name.trim().toLowerCase();
  if (!NAME.test(n)) fail(`Repo name "${name}": use 1-32 lowercase letters, digits and dashes, e.g. "web" or "api"`);
  return n;
}

export function checkPath(path: string): string {
  const p = path.trim();
  if (!p.startsWith("/") && !p.startsWith("~") && !/^[a-z]:[\\/]/i.test(p)) fail("Give the project's full path on that machine, e.g. ~/code/my-app");
  return p.slice(0, 500);
}

export function checkBranch(branch: string): string {
  const b = branch.trim() || "main";
  if (!/^[\w./-]{1,100}$/.test(b)) fail("That branch name looks wrong");
  return b;
}

export const cleanSetup = (s: string | null | undefined) => s?.trim().slice(0, 300) || null;

/** The office's repos, oldest first (the first is where the computer works). Falls back to the legacy `repo` before migration. */
export async function reposOf(ctx: Ctx, office: Doc<"offices">): Promise<RepoView[]> {
  const rows = await ctx.db.query("repos").withIndex("by_office", (q) => q.eq("officeId", office._id)).collect();
  if (!rows.length && office.repo) {
    return [{
      _id: null, officeId: office._id, name: nameFromPath(office.repo.path), machineId: office.repo.machineId, path: office.repo.path,
      defaultBranch: office.repo.defaultBranch, setupCommand: office.setupCommand ?? null, createdAt: office.createdAt,
    }];
  }
  return rows.filter((r) => r.removedAt === null).sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * The office's repos as rows, migrating the legacy `repo` into one the first time (repos.migrate does every office at
 * once; this keeps anything from breaking before it has run).
 */
export async function ensureRepos(ctx: MutationCtx, office: Doc<"offices">): Promise<Doc<"repos">[]> {
  await migrateOffice(ctx, office);
  const rows = await ctx.db.query("repos").withIndex("by_office", (q) => q.eq("officeId", office._id)).collect();
  return rows.filter((r) => r.removedAt === null).sort((a, b) => a.createdAt - b.createdAt);
}

/** One repos row from an office's legacy `repo`, once. Returns whether it made one. */
export async function migrateOffice(ctx: MutationCtx, office: Doc<"offices">): Promise<boolean> {
  if (!office.repo) return false;
  const any = await ctx.db.query("repos").withIndex("by_office", (q) => q.eq("officeId", office._id)).first();
  if (any) return false;
  await ctx.db.insert("repos", {
    officeId: office._id, name: nameFromPath(office.repo.path), machineId: office.repo.machineId, path: office.repo.path,
    defaultBranch: office.repo.defaultBranch, setupCommand: office.setupCommand ?? null, createdAt: office.createdAt, removedAt: null,
  });
  return true;
}

/** The repo a task is in: its own, or (from before repos) the office's first. */
export function repoOfTask<R extends { _id: Id<"repos"> | null }>(task: Doc<"tasks">, repos: R[]): R | null {
  if (task.repoId) return repos.find((r) => r._id === task.repoId) ?? null;
  return repos[0] ?? null;
}

/** The machine the computer works on: the one holding the office's first repo. */
export const computerMachine = (repos: RepoView[]): Id<"machines"> | null => repos[0]?.machineId ?? null;

/** A repo by name, with a readable error listing the office's repos. */
export function repoByName<R extends { name: string }>(repos: R[], name: string): R {
  const n = name.trim().toLowerCase();
  return repos.find((r) => r.name === n) ?? fail(`No repo called "${name}". Repos: ${repos.map((r) => r.name).join(", ") || "none yet"}`);
}

/** The repo a new task goes in: the named one, or the only one. */
export function repoForPlan<R extends { name: string }>(repos: R[], name: string | undefined, key: string): R {
  if (!repos.length) fail("This ship has no repo yet. The captain adds one in the app (the phone's Ship tab).");
  if (name?.trim()) return repoByName(repos, name);
  if (repos.length > 1) fail(`Task "${key}" needs a repo: this ship has ${repos.length} (${repos.map((r) => r.name).join(", ")}). Put each task in the repo it changes.`);
  return repos[0]!;
}

/** A unique name for a new repo: the given one, or the folder's, with -2, -3… when the folder's is taken. */
export function freshName(repos: { name: string }[], wanted: string | undefined, path: string): string {
  const taken = new Set(repos.map((r) => r.name));
  if (wanted?.trim()) {
    const n = checkName(wanted);
    if (taken.has(n)) fail(`There is already a repo called "${n}" on this ship`);
    return n;
  }
  const base = nameFromPath(path).slice(0, 29);
  let n = base;
  for (let i = 2; taken.has(n); i++) n = `${base}-${i}`;
  return n;
}
