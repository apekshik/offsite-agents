// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** A git command that failed, with what git said. */
export class GitError extends Error {
  readonly stderr: string;
  readonly code: number | null;
  constructor(args: string[], stderr: string, code: number | null) {
    super(`git ${args.slice(0, 3).join(" ")} failed: ${stderr.trim().split("\n").slice(-3).join(" ") || `exit ${code}`}`);
    this.stderr = stderr; this.code = code;
  }
}

// Never let git stop and wait for a person: no credential prompts, no editors.
const QUIET = { GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true", GIT_MERGE_AUTOEDIT: "no" };

export function git(args: string[], cwd: string, opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<string> {
  return new Promise((res, rej) => {
    execFile("git", args, { cwd, env: { ...process.env, ...QUIET, ...opts.env }, maxBuffer: 64 * 1024 * 1024, timeout: opts.timeoutMs ?? 120_000 }, (err, stdout, stderr) => {
      if (err) rej(new GitError(args, String(stderr || err.message), typeof err.code === "number" ? err.code : null));
      else res(String(stdout).replace(/\n$/, ""));
    });
  });
}
/** The same, but true/false for commands whose exit code is the answer. */
export const gitOk = (args: string[], cwd: string) => git(args, cwd).then(() => true, () => false);

/** "~/code/app" → an absolute path. */
export function expandHome(p: string): string {
  const t = p.trim();
  if (t === "~") return homedir();
  if (t.startsWith("~/")) return join(homedir(), t.slice(2));
  return isAbsolute(t) ? t : resolve(t);
}

/** The sha a ref points at, or null. */
export const revParse = (ref: string, cwd: string) => git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd).then((s) => s || null, () => null);

/**
 * Who a crew member's commits are by: "Juniper (Offsite)", with the captain's own email so the work shows as theirs
 * (their machine, their subscription). Without a git identity on this machine, Offsite's own stands in.
 */
export async function identity(cwd: string, name: string): Promise<{ author: string; env: NodeJS.ProcessEnv }> {
  const [user, email] = await Promise.all([git(["config", "user.name"], cwd).catch(() => ""), git(["config", "user.email"], cwd).catch(() => "")]);
  const mail = email || "crew@offsite.local";
  const author = `${name.replace(/[<>\n]/g, "").trim() || "Crew"} (Offsite)`;
  return {
    author: `${author} <${mail}>`,
    env: user && email ? {} : { GIT_COMMITTER_NAME: "Offsite", GIT_COMMITTER_EMAIL: mail },
  };
}
