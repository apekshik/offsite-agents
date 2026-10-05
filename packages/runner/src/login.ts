// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { hostname } from "node:os";
import { z } from "zod";
import { writeConfig, type RunnerConfig } from "./config.ts";

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
 * Device-code pairing. The runner never opens a browser and never sees the captain's sign-in: it prints a code, the
 * captain approves it in the app, and the next poll hands over this machine's token (once).
 */
export async function login(opts: {
  convexUrl: string; siteUrl: string; name: string;
  /** Pairing as part of `offsite start`, which carries straight on: don't tell them to run it. */
  starting?: boolean;
  log?: (s: string) => void; sleep?: (ms: number) => Promise<void>;
}): Promise<RunnerConfig> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const start = Start.parse(await post(`${opts.siteUrl}/device/start`, { name: opts.name, hostname: hostname() }));
  log(`\nConnect this machine to your ship. In Offsite, approve the code:\n\n    ${start.userCode}\n\nor open ${start.verifyUrl}\n`);
  const deadline = Date.now() + start.expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(Math.max(1, start.interval) * 1000);
    const r = Poll.parse(await post(`${opts.siteUrl}/device/poll`, { deviceCode: start.deviceCode }).catch(() => ({ status: "pending" })));
    if (r.status === "approved" && r.token) {
      const config = { convexUrl: opts.convexUrl, siteUrl: opts.siteUrl, token: r.token, name: opts.name };
      await writeConfig(config);
      log(opts.starting ? `Paired as "${opts.name}".` : `Paired as "${opts.name}". Run \`offsite start\` to take on work.`);
      return config;
    }
    if (r.status === "denied") throw new Error("The captain declined this machine.");
    if (r.status === "expired") break;
  }
  throw new Error("The code expired. Run `offsite login` again.");
}
