import { expect, it } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProfileStatus } from "@offsite/harness";
import { RUNNER_SPEC } from "@offsite/contracts";
import { deployment, PRODUCTION } from "./config.ts";
import { launchdPlist, serviceLabel, startCommand, systemdUnit } from "./service.ts";
import { canCrew, probeLine, statusLine } from "./ui.ts";

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

it("pairs with offsiteagents.app unless --url or OFFSITE_URL says otherwise", () => {
  expect(deployment(undefined, { env: {} })).toEqual({ ...{ convexUrl: PRODUCTION.convexUrl, siteUrl: PRODUCTION.siteUrl }, explicit: false });
  expect(deployment(undefined, { env: { OFFSITE_URL: "https://dev-1.convex.cloud/" } }))
    .toEqual({ convexUrl: "https://dev-1.convex.cloud", siteUrl: "https://dev-1.convex.site", explicit: true });
  expect(deployment("https://flag-2.convex.cloud", { env: { OFFSITE_URL: "https://dev-1.convex.cloud" } }).convexUrl).toBe("https://flag-2.convex.cloud");
  // The older name still works, and a self-hosted backend can say where its HTTP actions are.
  expect(deployment(undefined, { env: { OFFSITE_CONVEX_URL: "https://old-3.convex.cloud" } }).siteUrl).toBe("https://old-3.convex.site");
  expect(deployment(undefined, { env: { OFFSITE_URL: "https://convex.example.com", OFFSITE_SITE_URL: "https://site.example.com" } }).siteUrl).toBe("https://site.example.com");
});

const status = (over: Partial<ProfileStatus>): ProfileStatus => ({
  harness: "claude", profile: null, installed: true, version: "2.1.0", auth: "authenticated", email: "captain@example.com", plan: "Claude Max", models: [], message: null, ...over,
});

it("shows each login as a checklist line with the plan, never the email", () => {
  const lines = [
    status({}),
    status({ harness: "codex", plan: "ChatGPT Pro" }),
    status({ harness: "codex", auth: "unauthenticated", plan: null }),
    status({ harness: "claude", installed: false, auth: "unknown", plan: null, email: null }),
    status({ profile: "work", plan: null }),
  ].map((s) => plain(probeLine(s)));
  expect(lines[0]).toMatch(/^✓ Claude Code\s+Claude Max$/);
  expect(lines[1]).toMatch(/^✓ Codex\s+ChatGPT Pro$/);
  expect(lines[2]).toMatch(/^✗ Codex\s+not signed in {2}run `codex login`$/);
  expect(lines[3]).toMatch(/^– Claude Code\s+not installed$/);
  expect(lines[4]).toMatch(/^✓ Claude Code \(work\)\s+signed in$/);
  expect(lines.join("\n")).not.toContain("@");
  expect(canCrew([status({ auth: "unauthenticated" }), status({ installed: false })])).toBe(false);
  expect(canCrew([status({ auth: "unauthenticated" }), status({ harness: "codex" })])).toBe(true);
});

it("says in one line what the runner is doing", () => {
  expect(plain(statusLine({ captain: "Ada", working: 0, online: true }))).toBe("● Aboard for Ada · waiting for work · Ctrl-C to stop");
  expect(plain(statusLine({ captain: "Ada", working: 2, online: true, sim: true }))).toBe("● Aboard for Ada with the sim crew · 2 runs at work · Ctrl-C to stop");
  expect(plain(statusLine({ captain: "Ada", working: 1, online: false }))).toMatch(/^○ Can't reach/);
});

it("starts the background service through npx when run through npx, else this same script", () => {
  const npxRun = startCommand({ execPath: "/opt/node/bin/node", execArgv: [], script: "/Users/a/.npm/_npx/abc/node_modules/offsite-agents/dist/offsite.mjs", npx: "/opt/node/lib/npx-cli.js" });
  expect(npxRun).toEqual(["/opt/node/bin/node", "/opt/node/lib/npx-cli.js", "--yes", RUNNER_SPEC, "start"]);
  // The same spec captains ran: the site's tarball for now, the npm package later.
  const fromUrl = { execPath: "/n", execArgv: [], script: "/Users/a/.npm/_npx/abc/node_modules/offsite-agents/dist/offsite.mjs", npx: "/npx" };
  expect(startCommand(fromUrl, "https://offsiteagents.app/offsite-agents.tgz")).toEqual(["/n", "/npx", "--yes", "https://offsiteagents.app/offsite-agents.tgz", "start"]);
  expect(startCommand(fromUrl, "offsite-agents")).toEqual(["/n", "/npx", "--yes", "offsite-agents", "start"]);
  const global = startCommand({ execPath: "/opt/node/bin/node", execArgv: [], script: "/opt/node/lib/node_modules/offsite-agents/dist/offsite.mjs", npx: "/opt/node/lib/npx-cli.js" });
  expect(global).toEqual(["/opt/node/bin/node", "/opt/node/lib/node_modules/offsite-agents/dist/offsite.mjs", "start"]);
  const checkout = startCommand({ execPath: "/n", execArgv: ["--experimental-strip-types"], script: "/repo/packages/runner/src/cli.ts", npx: null });
  expect(checkout).toEqual(["/n", "--experimental-strip-types", "/repo/packages/runner/src/cli.ts", "start"]);
});

it("gives each OFFSITE_HOME its own service, and writes a LaunchAgent and a systemd unit that restart only on a crash", () => {
  expect(serviceLabel(join(homedir(), ".offsite"))).toBe("app.offsiteagents.runner");
  expect(serviceLabel("/tmp/other")).toMatch(/^app\.offsiteagents\.runner\.[0-9a-f]{8}$/);
  const args = ["/opt/node/bin/node", "/x/offsite.mjs", "start"];
  const plist = launchdPlist({ label: "app.offsiteagents.runner", args, env: { PATH: "/opt/node/bin:/usr/bin", OFFSITE_SERVICE: "1" }, log: "/Users/a/.offsite/logs/runner.log", cwd: "/Users/a" });
  expect(plist).toContain("<string>/x/offsite.mjs</string>");
  expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/);
  expect(plist).toContain("<key>StandardOutPath</key>\n  <string>/Users/a/.offsite/logs/runner.log</string>");
  const unit = systemdUnit({ args: [...args.slice(0, 2), "my dir", "start"], env: { PATH: "/usr/bin" }, log: "/home/a/.offsite/logs/runner.log", cwd: "/home/a" });
  expect(unit).toContain('ExecStart=/opt/node/bin/node /x/offsite.mjs "my dir" start');
  expect(unit).toContain("Restart=on-failure");
  expect(unit).toContain("StandardOutput=append:/home/a/.offsite/logs/runner.log");
});
