// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir, hostname, platform } from "node:os";
import { dirname, join } from "node:path";

/** What pairing saves: where the ship's backend is, and this machine's token. Mode 600. */
export interface RunnerConfig { convexUrl: string; siteUrl: string; token: string; name: string }

export const offsiteHome = () => process.env["OFFSITE_HOME"] ?? join(homedir(), ".offsite");

// A machine can be paired with several deployments at once (Offsite's own, and a contributor's dev deployment for the
// sim crew), each with its own token and its own runner. So the pairing and the pid file are kept per deployment:
// runner.json and runner.pid for Offsite's own, runner.<deployment>.json and .pid for any other.
let active: string = "";
/** Which deployment this process works for; the CLI sets it once it knows. Defaults to Offsite's own. */
export const useDeployment = (convexUrl: string) => { active = convexUrl.replace(/\/$/, ""); };
const suffix = (convexUrl = active) => !convexUrl || isProduction(convexUrl) ? "" : `.${new URL(convexUrl).hostname.split(".")[0]!.replace(/[^\w-]/g, "")}`;
export const configFile = (convexUrl?: string) => join(offsiteHome(), `runner${suffix(convexUrl)}.json`);
export const pidFileFor = (convexUrl?: string) => join(offsiteHome(), `runner${suffix(convexUrl)}.pid`);

async function parse(file: string): Promise<RunnerConfig | null> {
  try {
    const c = JSON.parse(await readFile(file, "utf8")) as Partial<RunnerConfig>;
    return c.convexUrl && c.token ? { convexUrl: c.convexUrl.replace(/\/$/, ""), siteUrl: c.siteUrl ?? siteFor(c.convexUrl), token: c.token, name: c.name ?? defaultName() } : null;
  } catch { return null; }
}

/** This machine's pairing with the active deployment, or null. */
export async function readConfig(): Promise<RunnerConfig | null> {
  const target = active || PRODUCTION.convexUrl;
  const own = await parse(configFile(target));
  if (own) return own.convexUrl === target ? own : null;
  // Before pairings were kept per deployment, runner.json held whichever came last. Move one that belongs to another
  // deployment to its own file, so Offsite's own never picks up a dev pairing (and the dev one keeps working).
  const legacy = await parse(configFile(PRODUCTION.convexUrl));
  if (legacy && !isProduction(legacy.convexUrl)) {
    await rename(configFile(PRODUCTION.convexUrl), configFile(legacy.convexUrl)).catch(() => {});
    return legacy.convexUrl === target ? legacy : null;
  }
  return null;
}

export async function writeConfig(c: RunnerConfig): Promise<void> {
  await mkdir(offsiteHome(), { recursive: true, mode: 0o700 });
  const file = configFile(c.convexUrl);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, file);
}

/** Convex serves HTTP actions (the pairing routes) on .convex.site next to the .convex.cloud API. */
export const siteFor = (convexUrl: string) => convexUrl.replace(/\.convex\.cloud\/?$/, ".convex.site");

/** KEY=value lines from the nearest .env.local above `from`: how `pnpm runner` inside the repo finds the dev deployment. */
export function envLocal(from = process.cwd()): Record<string, string> {
  for (let dir = from; ; dir = dirname(dir)) {
    const file = join(dir, ".env.local");
    if (existsSync(file)) {
      const out: Record<string, string> = {};
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*([^#\n]*?)\s*(?:#.*)?$/.exec(line);
        if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
      }
      return out;
    }
    if (dirname(dir) === dir) return {};
  }
}

/** Offsite's hosted ship: what the published CLI (RUNNER_COMMAND in @offsite/contracts) pairs with unless told otherwise. */
export const PRODUCTION = { convexUrl: "https://adamant-shrimp-822.convex.cloud", siteUrl: "https://adamant-shrimp-822.convex.site", appUrl: "https://offsiteagents.app" } as const;

export interface Deployment {
  convexUrl: string;
  siteUrl: string;
  /** Asked for by name (--url, OFFSITE_URL), rather than the default: a saved pairing with another deployment gives way. */
  explicit: boolean;
}

/**
 * The deployment to pair with: --url, then OFFSITE_URL (or the older OFFSITE_CONVEX_URL), then, only when running from
 * a checkout (`pnpm runner`, `pnpm sim`), CONVEX_URL from the repo's .env.local (the dev deployment), then Offsite's own.
 * The published CLI never reads .env.local: a project's own CONVEX_URL is not a ship.
 */
export function deployment(flagUrl?: string, opts: { checkout?: boolean; env?: Record<string, string | undefined> } = {}): Deployment {
  const env = opts.env ?? process.env;
  const named = flagUrl || env["OFFSITE_URL"] || env["OFFSITE_CONVEX_URL"];
  if (named) {
    const convexUrl = named.replace(/\/$/, "");
    return { convexUrl, siteUrl: (env["OFFSITE_SITE_URL"] || siteFor(convexUrl)).replace(/\/$/, ""), explicit: true };
  }
  if (opts.checkout) {
    const local = envLocal();
    const convexUrl = local["CONVEX_URL"] ?? local["VITE_CONVEX_URL"];
    if (convexUrl) return { convexUrl: convexUrl.replace(/\/$/, ""), siteUrl: (local["CONVEX_SITE_URL"] ?? siteFor(convexUrl)).replace(/\/$/, ""), explicit: false };
  }
  return { convexUrl: PRODUCTION.convexUrl, siteUrl: PRODUCTION.siteUrl, explicit: false };
}

export const isProduction = (convexUrl: string) => convexUrl.replace(/\/$/, "") === PRODUCTION.convexUrl;

/** The machine's human name: macOS's Computer Name, or the hostname. */
export function defaultName(): string {
  if (platform() === "darwin") {
    try {
      const name = execFileSync("/usr/sbin/scutil", ["--get", "ComputerName"], { encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (name) return name.slice(0, 60);
    } catch { /* Headless hosts may not have a Computer Name. */ }
  }
  return hostname().replace(/\.local$/, "").slice(0, 60) || "My computer";
}
