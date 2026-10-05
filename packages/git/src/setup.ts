import { spawn } from "node:child_process";
import { createServer } from "node:net";

export interface SetupResult { ok: boolean; output: string; ms: number; timedOut: boolean }

/**
 * The office's setupCommand ("pnpm install"), once, in a new worktree. Bounded by a timeout, and never fatal: a
 * failure is reported, and the crew member starts anyway (often they can fix what broke it).
 */
export function runSetup(cwd: string, command: string, opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<SetupResult> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, env: { ...process.env, CI: "1", ...opts.env }, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    let output = "";
    const keep = (d: Buffer) => { output = (output + d.toString()).slice(-8000); };
    child.stdout.on("data", keep); child.stderr.on("data", keep);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // The whole process group, so `pnpm install`'s children go too.
      try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }, timeoutMs);
    const done = (ok: boolean, extra = "") => { clearTimeout(timer); resolve({ ok: ok && !timedOut, output: (output + extra).trim().slice(-4000), ms: Date.now() - started, timedOut }); };
    child.on("error", (e) => done(false, `\n${e.message}`));
    child.on("exit", (code) => done(code === 0, timedOut ? `\n(timed out after ${Math.round(timeoutMs / 1000)}s)` : ""));
  });
}

const held = new Set<number>();
const free = (port: number) => new Promise<boolean>((res) => {
  const s = createServer();
  s.once("error", () => res(false));
  s.listen(port, "127.0.0.1", () => s.close(() => res(true)));
});

/** A port no other task on this machine is using, for the task's dev server (PORT). Release it when the run ends. */
export async function allocatePort(from = 4100, to = 4999): Promise<number> {
  for (let p = from; p <= to; p++) {
    if (held.has(p)) continue;
    held.add(p);
    if (await free(p)) return p;
    held.delete(p);
  }
  throw new Error(`No free port between ${from} and ${to}`);
}
export const releasePort = (port: number) => { held.delete(port); };
