import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
  FOLDER_LIMITS, SCAN_ROOTS, tildePath,
  type BrowseResult, type FolderEntry, type FolderResult, type FoundRepo, type RepoRemote, type ScanResult,
} from "@offsite/contracts";
import { git } from "@offsite/git";
import { offsiteHome } from "./config.ts";

// Finding the captain's repos so adding one is a pick, not a typed path (convex/folders.ts). A scan walks the usual
// places for git repos; Browse lists one folder's subfolders. Both only read: folder names (never file names), and a
// few read-only git commands per repo with short timeouts and nothing that reaches the network or runs the repo's own
// code (no hooks, no fsmonitor, no signature checks, no lazy fetches). A remote comes back as host and owner/repo,
// so a credential in its URL never leaves this machine.

export type FolderAnswer = { result: FolderResult } | { error: string };
export interface FolderJob { requestId: string; kind: "scan" | "browse"; path: string | null; typed: boolean }
export interface FolderWork { requests: FolderJob[] }

/** What the folder worker needs from the ship (convex/folders.ts). */
export interface FolderBackend {
  watch(onWork: (w: FolderWork) => void, onError?: (e: Error) => void): () => void;
  put(requestId: string, answer: FolderAnswer): Promise<void>;
}

/** Never scanned into: dependency trees, and macOS's own. Hidden folders (".git", ".offsite"…) are skipped by their dot. */
const SKIP = new Set(["node_modules", "Library", "__pycache__", "venv"]);
/**
 * Folders in the home folder that macOS guards with a permission prompt: a scan doesn't look inside them (Documents
 * is reached only through ~/Documents/GitHub), so it never makes the runner ask. Browse opens them when asked to.
 */
const GUARDED = new Set(["Desktop", "Documents", "Downloads", "Library", "Movies", "Music", "Pictures", "Public", "Applications"]);

// Read-only git, with nothing configured in the repo able to run a program or fetch: see the note at the top.
const SAFE_ENV = { GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_PAGER: "cat" };
const SAFE_CONFIG = ["-c", "core.fsmonitor=false", "-c", "log.showSignature=false", "-c", "core.hooksPath=/dev/null"];
const GIT_MS = 1500;
const quietGit = (args: string[], cwd: string) =>
  git([...SAFE_CONFIG, ...args], cwd, { env: SAFE_ENV, timeoutMs: GIT_MS }).catch(() => null);

const isDir = (p: string) => stat(p).then((s) => s.isDirectory(), () => false);
const exists = (p: string) => stat(p).then(() => true, () => false);
const inode = async (p: string) => { try { const s = await stat(p); return s.isDirectory() ? `${s.dev}:${s.ino}` : null; } catch { return null; } };

/** host and owner/repo from a remote URL, or null for a local path or anything unrecognisable. Never the user, password or token. */
export function cleanRemote(url: string): RepoRemote | null {
  const u = url.trim();
  if (!u) return null;
  let host: string, path: string;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
    let parsed: URL;
    try { parsed = new URL(u); } catch { return null; }
    if (parsed.protocol === "file:" || !parsed.hostname) return null;
    host = parsed.hostname;
    path = parsed.pathname;
  } else {
    // scp-like: [user@]host:owner/repo.git. A Windows drive ("C:\…") or a plain path is local.
    const scp = /^(?:[^@/\s]+@)?([^:/\s@]+):(?!\/\/)(.+)$/.exec(u);
    if (!scp || /^[a-z]$/i.test(scp[1]!)) return null;
    host = scp[1]!;
    path = scp[2]!;
  }
  host = host.toLowerCase().replace(/^www\./, "");
  const parts = path.replace(/[?#].*$/, "").split("/").filter(Boolean);
  const last = parts.length - 1;
  if (last >= 0) parts[last] = parts[last]!.replace(/\.git$/i, "");
  // GitLab paths can be group/subgroup/repo; anything after "/-/" is a page, not the repo.
  const dash = parts.indexOf("-");
  const segs = (dash >= 0 ? parts.slice(0, dash) : parts).slice(0, host.includes("gitlab") ? 6 : host === "github.com" ? 2 : 4);
  if (segs.length < 2 || !segs.every((s) => /^[\w.~-]{1,100}$/.test(s))) return null;
  return { host, slug: segs.join("/") };
}

/** What a new worktree needs, from the lockfile in the repo's top folder. */
export function setupFor(files: Iterable<string>): string | null {
  const has = new Set(files);
  if (has.has("pnpm-lock.yaml")) return "pnpm install";
  if (has.has("bun.lockb") || has.has("bun.lock")) return "bun install";
  if (has.has("yarn.lock")) return "yarn";
  if (has.has("package-lock.json") || has.has("npm-shrinkwrap.json")) return "npm install";
  if (has.has("uv.lock")) return "uv sync";
  if (has.has("poetry.lock")) return "poetry install";
  if (has.has("Pipfile.lock")) return "pipenv install";
  if (has.has("Gemfile.lock")) return "bundle install";
  if (has.has("composer.lock")) return "composer install";
  if (has.has("mix.lock")) return "mix deps.get";
  if (has.has("package.json")) return "npm install";
  // Cargo, Go and the rest fetch what they need on the first build.
  return null;
}

/** A repo's branch, default branch, origin, last commit and setup command, from git and its file names. */
export async function repoFacts(dir: string): Promise<Omit<FoundRepo, "name" | "path">> {
  const [head, refs, url, last, files] = await Promise.all([
    quietGit(["symbolic-ref", "-q", "--short", "HEAD"], dir),
    quietGit(["for-each-ref", "--format=%(refname) %(symref)", "refs/remotes/origin/HEAD", "refs/heads/main", "refs/heads/master"], dir),
    quietGit(["config", "--get", "remote.origin.url"], dir),
    quietGit(["log", "-1", "--no-show-signature", "--format=%ct"], dir),
    readdir(dir).catch(() => [] as string[]),
  ]);
  const branch = head?.trim() || null;
  const lines = (refs ?? "").split("\n").map((l) => l.trim().split(" "));
  const originHead = lines.find(([r]) => r === "refs/remotes/origin/HEAD")?.[1]?.replace(/^refs\/remotes\/origin\//, "") || null;
  const local = (b: string) => lines.some(([r]) => r === `refs/heads/${b}`);
  const defaultBranch = originHead ?? (local("main") ? "main" : local("master") ? "master" : branch);
  const at = Number(last?.trim());
  return {
    branch: branch?.slice(0, 200) ?? null,
    defaultBranch: defaultBranch?.slice(0, 200) ?? null,
    remote: url ? cleanRemote(url) : null,
    lastCommitAt: Number.isFinite(at) && at > 0 ? at * 1000 : null,
    setupCommand: setupFor(files),
  };
}

const NO_FACTS = { branch: null, defaultBranch: null, remote: null, lastCommitAt: null, setupCommand: null };

/** Runs at most `n` at once. */
function pool(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((r) => waiting.push(r));
    active++;
    try { return await fn(); } finally { active--; waiting.shift()?.(); }
  };
}

/** Resolves with `p`, or with `fallback` once `ms` has passed. */
const within = <T,>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), Math.max(0, ms)).unref?.())]);

export interface ScanOptions {
  home?: string;
  roots?: readonly string[];
  ms?: number;
  max?: number;
  depth?: number;
}

/**
 * Git repos in the usual places (SCAN_ROOTS under home, up to FOLDER_LIMITS.depth deep, plus home's own folders),
 * most recently changed first. Doesn't look inside a repo, a hidden folder, node_modules, Library or Offsite's own
 * folder; follows a symlinked folder once (a loop ends where it started). Stops at `max` repos or after `ms`.
 */
export async function scanRepos(o: ScanOptions = {}): Promise<ScanResult> {
  const home = resolve(o.home ?? homedir());
  const ms = o.ms ?? FOLDER_LIMITS.scanMs;
  const max = o.max ?? FOLDER_LIMITS.repos;
  const maxDepth = o.depth ?? FOLDER_LIMITS.depth;
  const deadline = Date.now() + ms;
  const seen = new Set<string>();
  const own = await inode(offsiteHome());
  if (own) seen.add(own);
  const homeId = await inode(home);
  if (homeId) seen.add(homeId);

  const found: { name: string; path: string; facts: Promise<Omit<FoundRepo, "name" | "path">> }[] = [];
  const gitPool = pool(8);
  let truncated = false, timedOut = false;
  const record = (dir: string, name: string) => {
    if (found.length >= max) { truncated = true; return; }
    found.push({ name, path: tildePath(dir, home), facts: gitPool(() => repoFacts(dir)).catch(() => NO_FACTS) });
  };

  // The roots that are there (a symlinked root counts; two names for one folder count once).
  const roots: string[] = [];
  for (const r of o.roots ?? SCAN_ROOTS) {
    const dir = join(home, r);
    const id = await inode(dir);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    roots.push(dir);
  }

  // Home's own folders, one level: a repo kept right in home.
  const homeEntries = await readdir(home, { withFileTypes: true }).catch(() => []);
  for (const e of homeEntries) {
    if (e.name.startsWith(".") || SKIP.has(e.name) || GUARDED.has(e.name)) continue;
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const dir = join(home, e.name);
    if (roots.includes(dir)) continue;
    if (await exists(join(dir, ".git"))) {
      const id = await inode(dir);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      record(dir, e.name);
    }
  }

  // Each root, breadth first, so the shallow repos are found before time runs out. Symlinked folders wait until the
  // plain folders are done, so a repo is listed where it really is rather than by a link to it.
  const queue: { dir: string; depth: number }[] = roots.map((dir) => ({ dir, depth: 0 }));
  const links: { dir: string; name: string; depth: number }[] = [];
  const walkPool = pool(16);
  const consider = async (dir: string, name: string, depth: number) => {
    if (Date.now() > deadline) { timedOut = true; return; }
    const id = await inode(dir);
    if (!id || seen.has(id)) return;
    seen.add(id);
    if (await exists(join(dir, ".git"))) record(dir, name);
    else if (depth < maxDepth) queue.push({ dir, depth });
  };
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (Date.now() > deadline) { timedOut = true; return; }
    if (found.length >= max) { truncated = true; return; }
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const next: Promise<void>[] = [];
    for (const e of entries) {
      if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
      const child = join(dir, e.name);
      if (e.isSymbolicLink()) links.push({ dir: child, name: e.name, depth: depth + 1 });
      else if (e.isDirectory()) next.push(walkPool(() => consider(child, e.name, depth + 1)));
    }
    await Promise.all(next);
  };
  const stop = () => {
    if (Date.now() > deadline) { if (queue.length || links.length) timedOut = true; return true; }
    if (found.length >= max) { if (queue.length || links.length) truncated = true; return true; }
    return false;
  };
  while ((queue.length || links.length) && !stop()) {
    if (queue.length) {
      const level = queue.splice(0, queue.length);
      await Promise.all(level.map(({ dir, depth }) => visit(dir, depth)));
    } else {
      const level = links.splice(0, links.length);
      await Promise.all(level.map((l) => walkPool(() => consider(l.dir, l.name, l.depth))));
    }
  }

  // Git facts were gathered as repos turned up; give the last ones a moment, then answer with what there is.
  const repos: FoundRepo[] = await Promise.all(found.map(async (f) => ({
    name: f.name.slice(0, 200), path: f.path,
    ...(await within(f.facts, deadline + 1500 - Date.now(), NO_FACTS)),
  })));
  repos.sort((a, b) => (b.lastCommitAt ?? 0) - (a.lastCommitAt ?? 0) || a.name.localeCompare(b.name));
  return {
    kind: "scan", home, truncated, timedOut,
    repos: repos.filter((r) => r.path.length <= 1000),
    roots: roots.map((r) => tildePath(r, home)),
  };
}

/** A folder the app named ("~", "~/x", or a typed absolute path) as an absolute path, with a readable refusal. */
export function resolveBrowsePath(path: string, typed: boolean, home: string): string {
  const p = path.trim();
  const expanded = p === "~" ? home : p.startsWith("~/") ? join(home, p.slice(2)) : p;
  if (!isAbsolute(expanded)) throw new Error(`Give the folder's full path, e.g. ~/code (not "${p}").`);
  const abs = resolve(expanded);
  const inside = abs === home || abs.startsWith(home.endsWith(sep) ? home : home + sep);
  if (!inside && !typed) throw new Error("Browse stays in your home folder. Type a path to look somewhere else.");
  return abs;
}

/** One folder's subfolders (hidden ones left out), each marked when it is a git repo. Never file names. */
export async function listFolders(o: { path: string; typed: boolean; home?: string }): Promise<BrowseResult> {
  const home = resolve(o.home ?? homedir());
  const abs = resolveBrowsePath(o.path, o.typed, home);
  const shown = tildePath(abs, home);
  const st = await stat(abs).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") throw new Error(`There's no folder at ${shown} on this machine.`);
    if (e.code === "EACCES" || e.code === "EPERM") throw new Error(`This machine won't let the runner read ${shown}.`);
    throw e;
  });
  if (!st.isDirectory()) throw new Error(`${shown} is a file, not a folder.`);
  const entries = await readdir(abs, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "EACCES" || e.code === "EPERM") throw new Error(`This machine won't let the runner read ${shown}.`);
    throw e;
  });
  const atHome = abs === home;
  const names: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory() || (e.isSymbolicLink() && (await isDir(join(abs, e.name))))) names.push(e.name);
  }
  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
  const truncated = names.length > FOLDER_LIMITS.folders;
  const deadline = Date.now() + FOLDER_LIMITS.scanMs;
  const gitPool = pool(8);
  const factsFor = (dir: string) => within(gitPool(() => repoFacts(dir)).catch(() => NO_FACTS), deadline - Date.now(), NO_FACTS);
  const folders: FolderEntry[] = await Promise.all(names.slice(0, FOLDER_LIMITS.folders).map(async (name) => {
    const dir = join(abs, name);
    // Asking whether a guarded folder (Documents…) is a repo would make macOS prompt; it never is one.
    const repo = !(atHome && GUARDED.has(name)) && (await exists(join(dir, ".git")));
    const path = tildePath(dir, home);
    return { name: name.slice(0, 300), path, repo: repo ? { name: name.slice(0, 200), path, ...(await factsFor(dir)) } : null };
  }));
  const parent = abs === home || !(abs.startsWith(home + sep)) ? null : tildePath(dirname(abs), home);
  const self = !atHome && (await exists(join(abs, ".git"))) ? { name: abs.split(sep).at(-1)!.slice(0, 200), path: shown, ...(await factsFor(abs)) } : null;
  return { kind: "browse", home, path: shown, parent, repo: self, folders: folders.filter((f) => f.path.length <= 1000), truncated };
}

const readable = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);

export interface FoldersOptions {
  backend: FolderBackend;
  log?: (line: string) => void;
  /** For tests: where home is. */
  home?: string;
}

/** Answers folders.work: each request once, one scan and a few listings at a time. */
export class Folders {
  private readonly o: FoldersOptions;
  private readonly busy = new Set<string>();
  private readonly done = new Map<string, number>();
  private readonly scans = pool(1);
  private readonly lists = pool(3);
  private running: Promise<unknown>[] = [];
  private unsubscribe: (() => void) | null = null;

  constructor(o: FoldersOptions) { this.o = o; }
  private log(line: string) { (this.o.log ?? ((l: string) => console.log(l)))(line); }

  start() {
    this.unsubscribe = this.o.backend.watch((w) => this.onWork(w), (e) => this.log(`folder subscription: ${readable(e)}`));
  }
  async stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    await Promise.allSettled(this.running);
  }
  idle(): Promise<void> { return Promise.allSettled(this.running).then(() => {}); }

  onWork(w: FolderWork) {
    for (const job of w.requests) {
      // A request stays listed until the ship has the answer; don't look twice meanwhile.
      if (this.busy.has(job.requestId) || (this.done.get(job.requestId) ?? 0) > Date.now()) continue;
      this.busy.add(job.requestId);
      const run = (job.kind === "scan" ? this.scans : this.lists)(async () => {
        const started = Date.now();
        const answer: FolderAnswer = await (job.kind === "scan" ? scanRepos({ ...(this.o.home ? { home: this.o.home } : {}) }) : listFolders({ path: job.path ?? "~", typed: job.typed, ...(this.o.home ? { home: this.o.home } : {}) }))
          .then((result) => ({ result }), (e) => ({ error: readable(e) }));
        await this.o.backend.put(job.requestId, answer);
        const took = `${((Date.now() - started) / 1000).toFixed(1)}s`;
        if ("error" in answer) this.log(`${job.kind === "scan" ? "repo scan" : `listing ${job.path}`}: ${answer.error}`);
        else if (answer.result.kind === "scan") this.log(`found ${answer.result.repos.length} repos in ${took}${answer.result.timedOut ? " (stopped looking at the time limit)" : ""}`);
        else this.log(`listed ${answer.result.path}: ${answer.result.folders.length} folders`);
      }).catch((e) => this.log(`folders ${job.requestId.slice(-6)}: ${readable(e)}`)).finally(() => {
        this.busy.delete(job.requestId);
        this.done.set(job.requestId, Date.now() + 5000);
        this.running = this.running.filter((x) => x !== run);
      });
      this.running.push(run);
    }
  }
}
