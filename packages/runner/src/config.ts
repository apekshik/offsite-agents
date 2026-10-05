// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir, hostname, platform } from "node:os";
import { dirname, join } from "node:path";

/** What `offsite login` saves: where the ship's backend is, and this machine's token. Mode 600. */
export interface RunnerConfig { convexUrl: string; siteUrl: string; token: string; name: string }

export const offsiteHome = () => process.env["OFFSITE_HOME"] ?? join(homedir(), ".offsite");
export const configFile = () => join(offsiteHome(), "runner.json");

export async function readConfig(): Promise<RunnerConfig | null> {
  try {
    const c = JSON.parse(await readFile(configFile(), "utf8")) as Partial<RunnerConfig>;
    return c.convexUrl && c.token ? { convexUrl: c.convexUrl, siteUrl: c.siteUrl ?? siteFor(c.convexUrl), token: c.token, name: c.name ?? defaultName() } : null;
  } catch { return null; }
}

export async function writeConfig(c: RunnerConfig): Promise<void> {
  await mkdir(offsiteHome(), { recursive: true, mode: 0o700 });
  const tmp = `${configFile()}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, configFile());
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

/** The deployment to pair with: --url, then OFFSITE_CONVEX_URL, then CONVEX_URL from the repo's .env.local. */
export function deployment(flagUrl?: string): { convexUrl: string; siteUrl: string } | null {
  const env = envLocal();
  const convexUrl = flagUrl ?? process.env["OFFSITE_CONVEX_URL"] ?? env["CONVEX_URL"] ?? env["VITE_CONVEX_URL"];
  if (!convexUrl) return null;
  const site = flagUrl || process.env["OFFSITE_CONVEX_URL"] ? siteFor(convexUrl) : env["CONVEX_SITE_URL"] ?? siteFor(convexUrl);
  return { convexUrl: convexUrl.replace(/\/$/, ""), siteUrl: site.replace(/\/$/, "") };
}

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
