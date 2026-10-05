// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { execFile } from "node:child_process";
import { git } from "./git.ts";

/** The person's own `gh`, with their own login. Offsite holds no GitHub token. */
function gh(args: string[], cwd: string): Promise<string> {
  return new Promise((res, rej) => {
    execFile("gh", args, { cwd, env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" }, timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) rej(new Error(String(stderr || err.message).trim().split("\n").slice(-2).join(" ")));
      else res(String(stdout).trim());
    });
  });
}

/** owner/name when the repo's origin is on GitHub. */
export async function githubRepo(repo: string): Promise<string | null> {
  const url = await git(["remote", "get-url", "origin"], repo).catch(() => "");
  return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url)?.[1] ?? null;
}

export interface FinishResult {
  pushed: boolean;
  prUrl: string | null;
  /** What happened, in a sentence the computer can pass on. */
  message: string;
}

/**
 * Finish a thread: push its branch and open one pull request, when the repo has a GitHub remote and `gh` is signed in.
 * Otherwise the branch stays where it is, and the message says so. An existing PR for the branch is reused.
 */
export async function finishThread(input: { repo: string; branch: string; base: string; title: string; body: string }): Promise<FinishResult> {
  const { repo, branch, base, title, body } = input;
  const origin = await git(["remote", "get-url", "origin"], repo).catch(() => null);
  if (!origin) return { pushed: false, prUrl: null, message: `This repo has no remote, so the work stays on the local branch ${branch}.` };
  try {
    await git(["push", "-u", "origin", `refs/heads/${branch}:refs/heads/${branch}`], repo, { timeoutMs: 180_000 });
  } catch (e) {
    return { pushed: false, prUrl: null, message: `Could not push ${branch}: ${(e as Error).message}. The work is on the local branch ${branch}.` };
  }
  const slug = await githubRepo(repo);
  if (!slug) return { pushed: true, prUrl: null, message: `Pushed ${branch} to origin. It isn't a GitHub remote, so open the pull request there.` };
  const signedIn = await gh(["auth", "status", "--hostname", "github.com"], repo).then(() => true, () => false);
  if (!signedIn) return { pushed: true, prUrl: null, message: `Pushed ${branch}. \`gh\` isn't signed in on this machine, so no pull request was opened: https://github.com/${slug}/compare/${base}...${encodeURIComponent(branch)}?expand=1` };
  const existing = await gh(["pr", "list", "--repo", slug, "--head", branch, "--state", "open", "--json", "url", "--limit", "1"], repo).then((s) => (JSON.parse(s) as { url: string }[])[0]?.url ?? null, () => null);
  if (existing) return { pushed: true, prUrl: existing, message: `Pushed ${branch}; its pull request is ${existing}.` };
  try {
    const out = await gh(["pr", "create", "--repo", slug, "--head", branch, "--base", base, "--title", title, "--body", body], repo);
    const url = out.match(/https:\/\/\S+/)?.[0] ?? null;
    return { pushed: true, prUrl: url, message: url ? `Opened ${url}.` : `Pushed ${branch}; gh said: ${out}` };
  } catch (e) {
    return { pushed: true, prUrl: null, message: `Pushed ${branch}, but the pull request failed: ${(e as Error).message}` };
  }
}
