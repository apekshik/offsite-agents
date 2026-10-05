import { z } from "zod";

// Finding the captain's repos on a paired machine, so adding one is a pick rather than a typed path. The app asks
// (convex/folders.ts), the runner on that machine looks (packages/runner folders.ts) and writes back what it found,
// and the answer is deleted after FOLDER_LIMITS.ttlMs. Two kinds: a scan of the usual places for git repos, and one
// level of folders under a path (Browse). Folder names only, never file names; remotes never carry credentials.

/** A ship holds at most this many repos (convex/repolib.ts enforces it; the picker shows the room left). */
export const MAX_REPOS = 12;

export const FOLDER_LIMITS = {
  /** A scan stops looking after this long and answers with what it found. */
  scanMs: 3_000,
  /** At most this many repos in a scan. */
  repos: 300,
  /** How deep a scan looks under each root (a root's own children are depth 1). */
  depth: 3,
  /** At most this many folders in one Browse listing. */
  folders: 500,
  /** Answers are deleted this long after they were asked for. */
  ttlMs: 10 * 60_000,
} as const;

/** Where a scan looks, under the home folder. The home folder itself is looked at one level deep. */
export const SCAN_ROOTS = [
  "Developer", "code", "Code", "src", "Projects", "projects", "GitHub", "Documents/GitHub", "repos", "workspace", "dev", "Sites",
] as const;

/** A repo's origin, as `owner/repo` on its host. Never a URL: no user, password or token can be in it. */
export const RepoRemote = z.object({
  /** "github.com", "gitlab.com", or another git host's name. */
  host: z.string().max(200),
  /** "owner/repo" (GitLab subgroups: "group/sub/repo"). */
  slug: z.string().max(300),
});
export type RepoRemote = z.infer<typeof RepoRemote>;

/** A git repo found on the machine. */
export const FoundRepo = z.object({
  /** The folder's name. */
  name: z.string().max(200),
  /** Where it is, with `~` for the home folder when it is under it: "~/Developer/web". */
  path: z.string().max(1000),
  /** The checked-out branch; null when HEAD is detached. */
  branch: z.string().max(200).nullable(),
  /** origin/HEAD when set, else main or master when there, else the current branch. */
  defaultBranch: z.string().max(200).nullable(),
  remote: RepoRemote.nullable(),
  /** The last commit's time (ms), null for a repo with no commits. */
  lastCommitAt: z.number().nullable(),
  /** What a new worktree needs, from the lockfile: "pnpm install". Null when nothing (or nothing known). */
  setupCommand: z.string().max(100).nullable(),
});
export type FoundRepo = z.infer<typeof FoundRepo>;

export const ScanResult = z.object({
  kind: z.literal("scan"),
  /** The home folder, absolute: lets the app tell `~/x` and `/Users/me/x` apart from another folder. */
  home: z.string().max(500),
  /** Most recently changed first. */
  repos: z.array(FoundRepo).max(FOLDER_LIMITS.repos),
  /** It stopped at FOLDER_LIMITS.repos. */
  truncated: z.boolean(),
  /** It stopped at FOLDER_LIMITS.scanMs, before it had looked everywhere. */
  timedOut: z.boolean(),
  /** The roots that were there and looked in, as `~/Developer`. */
  roots: z.array(z.string().max(500)).max(40),
});
export type ScanResult = z.infer<typeof ScanResult>;

/** One folder in a Browse listing. `repo` is set when it is a git repo. */
export const FolderEntry = z.object({
  name: z.string().max(300),
  path: z.string().max(1000),
  repo: FoundRepo.nullable(),
});
export type FolderEntry = z.infer<typeof FolderEntry>;

export const BrowseResult = z.object({
  kind: z.literal("browse"),
  home: z.string().max(500),
  /** The folder listed, with `~` when under home. */
  path: z.string().max(1000),
  /** Its parent, when that is under home too (above home, the captain types a path). */
  parent: z.string().max(1000).nullable(),
  /** The folder itself, when it is a git repo. */
  repo: FoundRepo.nullable(),
  /** Its subfolders, hidden ones left out, by name. */
  folders: z.array(FolderEntry).max(FOLDER_LIMITS.folders),
  truncated: z.boolean(),
});
export type BrowseResult = z.infer<typeof BrowseResult>;

export const FolderResult = z.discriminatedUnion("kind", [ScanResult, BrowseResult]);
export type FolderResult = z.infer<typeof FolderResult>;

/** "~/Developer/web" for "/Users/me/Developer/web" when home is "/Users/me"; other paths as they are. */
export function tildePath(path: string, home: string): string {
  const h = home.replace(/[\\/]+$/, "");
  if (!h) return path;
  if (path === h) return "~";
  if (path.startsWith(h + "/") || path.startsWith(h + "\\")) return "~" + path.slice(h.length);
  return path;
}
