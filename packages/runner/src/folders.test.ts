import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { cleanRemote, Folders, listFolders, scanRepos, setupFor, type FolderAnswer, type FolderBackend, type FolderWork } from "./folders.ts";

const run = promisify(execFile);
const sh = (cwd: string, args: string[], env: Record<string, string> = {}) =>
  run("git", args, { cwd, env: { ...process.env, ...env } }).then((r) => r.stdout.trim());

let root: string, home: string;
const saved: Record<string, string | undefined> = {};

/** A repo at `dir` (under home) with an optional commit at `at` (seconds), remote and files. */
async function repo(dir: string, o: { at?: number; remote?: string; files?: string[]; branch?: string } = {}) {
  const path = join(home, dir);
  await mkdir(path, { recursive: true });
  await sh(path, ["init", "-q", "-b", o.branch ?? "main"]);
  for (const f of o.files ?? []) await writeFile(join(path, f), "");
  if (o.remote) await sh(path, ["remote", "add", "origin", o.remote]);
  if (o.at) {
    await writeFile(join(path, "README.md"), dir);
    await sh(path, ["add", "-A"]);
    const date = `${o.at} +0000`;
    await sh(path, ["commit", "-q", "-m", "seed"], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  }
  return path;
}

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "offsite-folders-")));
  home = join(root, "home");
  await writeFile(join(root, "gitconfig"), "[user]\n\tname = Captain\n\temail = captain@example.com\n[commit]\n\tgpgsign = false\n");
  for (const [k, v] of Object.entries({ GIT_CONFIG_GLOBAL: join(root, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", OFFSITE_HOME: join(home, "offsite-home") })) { saved[k] = process.env[k]; process.env[k] = v; }

  // Found: in a root, nested in plain folders (3 deep), right in home, and in ~/Documents/GitHub.
  await repo("Developer/web", { at: 1_700_000_300, remote: "https://alice:ghp_SECRETtoken123@github.com/alice/web.git", files: ["pnpm-lock.yaml", "package.json"] });
  await repo("Developer/org/team/api", { at: 1_700_000_200, remote: "git@gitlab.com:group/sub/api.git", files: ["yarn.lock"] });
  await repo("solo", { at: 1_700_000_100, files: ["uv.lock"] });
  await repo("Documents/GitHub/desk", { at: 1_700_000_050, remote: "ssh://git@github.com:22/alice/desk.git", files: ["Cargo.toml"] });
  // A repo whose origin/HEAD names its default branch, checked out on a feature branch.
  const trunk = await repo("Developer/trunky", { at: 1_700_000_400, branch: "trunk", remote: "https://example.com/team/trunky" });
  await sh(trunk, ["checkout", "-q", "-b", "feature"]);
  await sh(trunk, ["update-ref", "refs/remotes/origin/trunk", "HEAD"]);
  await sh(trunk, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk"]);
  // master and no remote; and one with no commits yet.
  const old = await repo("Developer/old", { at: 1_699_000_000, branch: "master" });
  await sh(old, ["checkout", "-q", "--detach"]);
  await repo("Developer/fresh", { branch: "dev", files: ["bun.lock"] });

  // Not found: too deep, inside a repo, in node_modules, hidden, in Library, Offsite's own folder.
  await repo("Developer/a/b/c/deep", { at: 1_700_000_000 });
  await repo("Developer/web/packages/inner", { at: 1_700_000_000 });
  await repo("Developer/site/node_modules/pkg", { at: 1_700_000_000 });
  await repo("Developer/.hidden/secret", { at: 1_700_000_000 });
  await repo("Library/Developer/xcode-thing", { at: 1_700_000_000 });
  await repo("offsite-home/worktrees/o1/t1/task", { at: 1_700_000_000 });
  await mkdir(join(home, "Developer/site/src"), { recursive: true });
  await writeFile(join(home, "Developer/notes.txt"), "a file, not a folder");

  // A symlink loop, a second name for a root, and a link to a repo already found: each looked at once.
  await symlink(join(home, "Developer"), join(home, "Developer/org/loop"));
  await symlink(join(home, "Developer"), join(home, "code"));
  await symlink(join(home, "Developer/org/team/api"), join(home, "Developer/api-link"));
});

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true });
});

describe("cleanRemote", () => {
  it("keeps host and owner/repo, and never a user, password or token", () => {
    expect(cleanRemote("https://alice:ghp_abc@github.com/alice/web.git")).toEqual({ host: "github.com", slug: "alice/web" });
    expect(cleanRemote("https://x-access-token:tok@github.com/alice/web")).toEqual({ host: "github.com", slug: "alice/web" });
    expect(cleanRemote("git@github.com:alice/web.git")).toEqual({ host: "github.com", slug: "alice/web" });
    expect(cleanRemote("ssh://git@github.com:22/alice/web.git/")).toEqual({ host: "github.com", slug: "alice/web" });
    expect(cleanRemote("https://oauth2:glpat-xyz@gitlab.com/group/sub/api.git")).toEqual({ host: "gitlab.com", slug: "group/sub/api" });
    expect(cleanRemote("https://gitlab.com/group/api/-/tree/main")).toEqual({ host: "gitlab.com", slug: "group/api" });
    expect(cleanRemote("https://www.github.com/alice/web?token=abc#x")).toEqual({ host: "github.com", slug: "alice/web" });
    expect(cleanRemote("user:pass@bitbucket.org:team/repo.git")).toEqual({ host: "bitbucket.org", slug: "team/repo" });
    expect(cleanRemote("/srv/git/web.git")).toBeNull();
    expect(cleanRemote("file:///srv/git/web.git")).toBeNull();
    expect(cleanRemote("C:\\code\\web")).toBeNull();
    expect(cleanRemote("../web")).toBeNull();
    expect(cleanRemote("https://github.com/only-owner")).toBeNull();
  });
});

describe("setupFor", () => {
  it("picks the install command from the lockfile", () => {
    expect(setupFor(["package.json", "pnpm-lock.yaml"])).toBe("pnpm install");
    expect(setupFor(["yarn.lock", "package.json"])).toBe("yarn");
    expect(setupFor(["package-lock.json"])).toBe("npm install");
    expect(setupFor(["bun.lockb"])).toBe("bun install");
    expect(setupFor(["bun.lock"])).toBe("bun install");
    expect(setupFor(["uv.lock", "pyproject.toml"])).toBe("uv sync");
    expect(setupFor(["Cargo.toml", "Cargo.lock"])).toBeNull();
    expect(setupFor(["go.mod"])).toBeNull();
    expect(setupFor([])).toBeNull();
  });
});

describe("scanRepos", () => {
  it("finds repos in the usual places, most recent first, with their facts", async () => {
    const r = await scanRepos({ home });
    expect(r.kind).toBe("scan");
    expect(r.home).toBe(home);
    expect(r.truncated).toBe(false);
    expect(r.timedOut).toBe(false);
    expect(r.roots).toEqual(["~/Developer", "~/Documents/GitHub"]);
    expect(r.repos.map((x) => x.path)).toEqual([
      "~/Developer/trunky", "~/Developer/web", "~/Developer/org/team/api", "~/solo", "~/Documents/GitHub/desk", "~/Developer/old", "~/Developer/fresh",
    ]);
    const by = Object.fromEntries(r.repos.map((x) => [x.name, x]));
    expect(by["web"]).toEqual({
      name: "web", path: "~/Developer/web", branch: "main", defaultBranch: "main",
      remote: { host: "github.com", slug: "alice/web" }, lastCommitAt: 1_700_000_300_000, setupCommand: "pnpm install",
    });
    expect(by["api"]).toMatchObject({ remote: { host: "gitlab.com", slug: "group/sub/api" }, setupCommand: "yarn" });
    expect(by["trunky"]).toMatchObject({ branch: "feature", defaultBranch: "trunk", remote: { host: "example.com", slug: "team/trunky" }, setupCommand: null });
    expect(by["old"]).toMatchObject({ branch: null, defaultBranch: "master", remote: null });
    expect(by["fresh"]).toMatchObject({ branch: "dev", defaultBranch: "dev", lastCommitAt: null, setupCommand: "bun install" });
    expect(by["solo"]).toMatchObject({ setupCommand: "uv sync" });
    expect(by["desk"]).toMatchObject({ remote: { host: "github.com", slug: "alice/desk" }, setupCommand: null });
    // The credential in web's remote URL never comes back, anywhere.
    expect(JSON.stringify(r)).not.toMatch(/SECRET|ghp_|alice:/);
  });

  it("stops at the repo cap and at the time limit", async () => {
    const capped = await scanRepos({ home, max: 2 });
    expect(capped.repos).toHaveLength(2);
    expect(capped.truncated).toBe(true);
    const rushed = await scanRepos({ home, ms: 0 });
    expect(rushed.timedOut).toBe(true);
  });
});

describe("listFolders", () => {
  it("lists one folder's subfolders, marks repos, and leaves out files and hidden folders", async () => {
    const top = await listFolders({ path: "~", typed: false, home });
    expect(top).toMatchObject({ kind: "browse", path: "~", parent: null, repo: null, truncated: false });
    expect(top.folders.map((f) => f.name)).toEqual(["code", "Developer", "Documents", "Library", "offsite-home", "solo"]);
    expect(top.folders.find((f) => f.name === "solo")!.repo).toMatchObject({ path: "~/solo", setupCommand: "uv sync" });

    const dev = await listFolders({ path: "~/Developer", typed: false, home });
    expect(dev.parent).toBe("~");
    expect(dev.folders.map((f) => [f.name, !!f.repo])).toEqual([
      ["a", false], ["api-link", true], ["fresh", true], ["old", true], ["org", false], ["site", false], ["trunky", true], ["web", true],
    ]);
    expect(JSON.stringify(dev)).not.toMatch(/notes\.txt|\.hidden|SECRET/);

    const web = await listFolders({ path: "~/Developer/web", typed: false, home });
    expect(web.repo).toMatchObject({ name: "web", path: "~/Developer/web", defaultBranch: "main" });
    expect(web.folders.map((f) => f.name)).toEqual(["packages"]);
  });

  it("stays in home unless the path was typed, and says plainly what's wrong", async () => {
    await expect(listFolders({ path: root, typed: false, home })).rejects.toThrow(/stays in your home folder/);
    await expect(listFolders({ path: "~/../..", typed: false, home })).rejects.toThrow(/stays in your home folder/);
    await expect(listFolders({ path: "Developer", typed: true, home })).rejects.toThrow(/full path/);
    const outside = await listFolders({ path: root, typed: true, home });
    expect(outside).toMatchObject({ path: root, parent: null });
    expect(outside.folders.map((f) => f.name)).toEqual(["home"]);
    await expect(listFolders({ path: "~/nope", typed: false, home })).rejects.toThrow("There's no folder at ~/nope on this machine.");
    await expect(listFolders({ path: "~/Developer/notes.txt", typed: false, home })).rejects.toThrow("~/Developer/notes.txt is a file, not a folder.");
  });
});

/** folders.work in memory: requests stay listed until answered, like the ship. */
class FakeFolders implements FolderBackend {
  work: FolderWork = { requests: [] };
  answers = new Map<string, FolderAnswer>();
  private listener: ((w: FolderWork) => void) | null = null;
  watch(on: (w: FolderWork) => void) { this.listener = on; on(this.work); return () => { this.listener = null; }; }
  push(w: FolderWork) { this.work = w; this.listener?.(w); }
  async put(requestId: string, answer: FolderAnswer) {
    this.answers.set(requestId, answer);
    this.push({ requests: this.work.requests.filter((r) => r.requestId !== requestId) });
  }
}

describe("the folder worker", () => {
  it("answers each request once: a scan, a listing, and a refusal", async () => {
    const backend = new FakeFolders();
    const lines: string[] = [];
    const worker = new Folders({ backend, home, log: (l) => lines.push(l) });
    worker.start();
    const requests = [
      { requestId: "s1", kind: "scan" as const, path: null, typed: false },
      { requestId: "b1", kind: "browse" as const, path: "~/Developer", typed: false },
      { requestId: "b2", kind: "browse" as const, path: "/etc", typed: false },
    ];
    backend.push({ requests });
    backend.push({ requests }); // the same list again, before any answer: nothing is done twice
    await worker.idle();
    await worker.stop();
    const scan = backend.answers.get("s1")!;
    expect("result" in scan && scan.result.kind === "scan" && scan.result.repos.length).toBe(7);
    const list = backend.answers.get("b1")!;
    expect("result" in list && list.result.kind === "browse" && list.result.path).toBe("~/Developer");
    expect(backend.answers.get("b2")).toEqual({ error: "Browse stays in your home folder. Type a path to look somewhere else." });
    expect(lines.filter((l) => l.startsWith("found 7 repos"))).toHaveLength(1);
  });
});
