// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { hostname } from "node:os";
import { z } from "zod";
import { RUNNER_COMMAND } from "@offsite/contracts";
import { writeConfig, type RunnerConfig } from "./config.ts";
import { style } from "./ui.ts";

const Start = z.object({ deviceCode: z.string(), userCode: z.string(), verifyUrl: z.string(), interval: z.number().default(2.5), expiresIn: z.number().default(900) });
const Poll = z.object({ status: z.enum(["pending", "approved", "denied", "expired"]), token: z.string().optional() });

async function post(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text();
    let reason = text.slice(0, 200);
    try { reason = String((JSON.parse(text) as { error?: unknown }).error ?? reason); } catch { /* not JSON */ }
    throw new Error(res.status === 429 ? reason : `${url} answered ${res.status}: ${reason}`);
  }
  return res.json();
}

/**
 * The approval page for a code: the app's /pair, on whichever app the deployment says it serves (its verifyUrl's
 * origin). Deployments from before /pair answer with `/?connect=CODE`; this points those at /pair too.
 */
export function pairLink(verifyUrl: string, userCode: string): string {
  try {
    const u = new URL(verifyUrl);
    return `${u.origin}/pair?code=${encodeURIComponent(userCode)}`;
  } catch { return verifyUrl; }
}

/**
 * Device-code pairing. The runner never sees the captain's sign-in: it prints a code and opens the app's approval page
 * (/pair?code=), the captain approves it there, and the next poll hands over this machine's token (once).
 */
export async function login(opts: {
  convexUrl: string; siteUrl: string; name: string;
  /** What this machine runs on ("macOS 26.4"), for the approval page. */
  os?: string;
  /** Pairing on the way to taking work, which carries straight on: don't tell them to start it. */
  starting?: boolean;
  /** How to run the CLI again, for the hints: RUNNER_COMMAND (`npx <spec>`), "pnpm runner". */
  command?: string;
  /** Open the approval page in a browser; false when it couldn't. Left out: only print the link. */
  open?: (url: string) => boolean | Promise<boolean>;
  log?: (s: string) => void; sleep?: (ms: number) => Promise<void>;
}): Promise<RunnerConfig> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const command = opts.command ?? RUNNER_COMMAND;
  const start = Start.parse(await post(`${opts.siteUrl}/device/start`, { name: opts.name, hostname: hostname(), ...(opts.os ? { os: opts.os } : {}) }));
  const link = pairLink(start.verifyUrl, start.userCode);
  const opened = opts.open ? await Promise.resolve(opts.open(link)).catch(() => false) : false;
  log(`\nConnect this machine to your ship. Your code is\n\n    ${style.bold(start.userCode)}\n`);
  log(opened
    ? `Approve it in the browser tab that just opened. If none did, open:\n  ${link}\n`
    : `Approve it here:\n  ${link}\n`);
  log(style.dim("Waiting for approval…"));
  const deadline = Date.now() + start.expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(Math.max(1, start.interval) * 1000);
    const r = Poll.parse(await post(`${opts.siteUrl}/device/poll`, { deviceCode: start.deviceCode }).catch(() => ({ status: "pending" })));
    if (r.status === "approved" && r.token) {
      const config = { convexUrl: opts.convexUrl, siteUrl: opts.siteUrl, token: r.token, name: opts.name };
      await writeConfig(config);
      log(opts.starting ? `${style.green("✓")} Paired as "${opts.name}".` : `${style.green("✓")} Paired as "${opts.name}". Run \`${command}\` to take on work.`);
      return config;
    }
    if (r.status === "denied") throw new Error("That code was turned down in the browser, so this machine isn't paired.");
    if (r.status === "expired") break;
  }
  throw new Error(`The code expired. Run \`${command}\` again for a new one.`);
}
