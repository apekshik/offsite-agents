import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { RUNNER_SPEC } from "@offsite/contracts";
import { offsiteHome, pidFileFor } from "./config.ts";

// Keeping `offsite start` running at login: a LaunchAgent on macOS, a systemd user unit on Linux. Each OFFSITE_HOME
// gets its own, so a second runner on the same computer (or a test) never replaces the first's.

const run = promisify(execFile);
const DEFAULT_HOME = () => join(homedir(), ".offsite");

export const logDir = () => join(offsiteHome(), "logs");
export const logFile = () => join(logDir(), "runner.log");

/** "app.offsiteagents.runner", plus a short hash of OFFSITE_HOME when it isn't ~/.offsite. */
export function serviceLabel(home = offsiteHome()): string {
  return home === DEFAULT_HOME() ? "app.offsiteagents.runner" : `app.offsiteagents.runner.${createHash("sha256").update(home).digest("hex").slice(0, 8)}`;
}

export const plistPath = (label = serviceLabel()) => join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
export const unitName = (label = serviceLabel()) => `${label.replace(/^app\.offsiteagents\.runner/, "offsite-agents")}.service`;
export const unitPath = (label = serviceLabel()) => join(process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"), "systemd", "user", unitName(label));

/**
 * How the service starts the runner. Run through npx, the copy in npx's cache isn't somewhere to point a service at,
 * so it runs `npx --yes <RUNNER_SPEC> start` (which also picks up new versions); otherwise this same script.
 */
export function startCommand(p: { execPath: string; execArgv: string[]; script: string; npx: string | null }, spec = RUNNER_SPEC): string[] {
  if (p.npx && /[\\/]_npx[\\/]/.test(p.script)) return [p.execPath, p.npx, "--yes", spec, "start"];
  return [p.execPath, ...p.execArgv, p.script, "start"];
}

export function thisStartCommand(): string[] {
  const npxCli = [join(dirname(process.execPath), "npx"), join(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npx-cli.js")].find((p) => existsSync(p));
  let script = process.argv[1] ?? "";
  try { script = realpathSync(script); } catch { /* keep it as given */ }
  return startCommand({ execPath: process.execPath, execArgv: process.execArgv, script, npx: npxCli ? realpathSync(npxCli) : null });
}

/** A PATH for the service: node's own folder first (npx needs it), then the usual places CLIs live. */
export function servicePath(execPath = process.execPath): string {
  const dirs = [dirname(execPath), join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  return [...new Set(dirs)].join(":");
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The LaunchAgent. It restarts the runner if it crashes, not when it exits cleanly (say, unpaired). */
export function launchdPlist(p: { label: string; args: string[]; env: Record<string, string>; log: string; cwd: string }): string {
  const strings = (xs: string[]) => xs.map((x) => `    <string>${xml(x)}</string>`).join("\n");
  const env = Object.entries(p.env).map(([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(p.label)}</string>
  <key>ProgramArguments</key>
  <array>
${strings(p.args)}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>WorkingDirectory</key>
  <string>${xml(p.cwd)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>${xml(p.log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(p.log)}</string>
</dict>
</plist>
`;
}

const quote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, "\\$1")}"`);

/** The systemd user unit. Same restart rule as the LaunchAgent. */
export function systemdUnit(p: { args: string[]; env: Record<string, string>; log: string; cwd: string }): string {
  return `[Unit]
Description=Offsite Agents runner: your crew, on this machine
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${p.args.map(quote).join(" ")}
WorkingDirectory=${p.cwd}
${Object.entries(p.env).map(([k, v]) => `Environment=${quote(`${k}=${v}`)}`).join("\n")}
Restart=on-failure
RestartSec=30
StandardOutput=append:${p.log}
StandardError=append:${p.log}

[Install]
WantedBy=default.target
`;
}

/** What the service carries over from this shell: where Offsite keeps its things, if not ~/.offsite. */
function serviceEnv(): Record<string, string> {
  // USER matters: Claude Code finds its login in the keychain by it (launchd sets it too; this is belt and braces).
  const user = userInfo().username;
  const env: Record<string, string> = { PATH: servicePath(), USER: user, LOGNAME: user, OFFSITE_SERVICE: "1" };
  if (process.env["SHELL"]) env["SHELL"] = process.env["SHELL"];
  if (process.env["OFFSITE_HOME"]) env["OFFSITE_HOME"] = offsiteHome();
  return env;
}

export type InstallResult = { ok: true; where: string; log: string; text: string } | { ok: false; instructions: string };

/** Sets up the service and starts it. `dryRun`: only say what it would write, and where. */
export async function install(command: string, opts: { dryRun?: boolean } = {}): Promise<InstallResult> {
  const args = thisStartCommand();
  if (process.platform === "darwin") {
    const label = serviceLabel();
    const file = plistPath(label);
    const text = launchdPlist({ label, args, env: serviceEnv(), log: logFile(), cwd: homedir() });
    if (opts.dryRun) return { ok: true, where: file, log: logFile(), text };
    await mkdir(logDir(), { recursive: true, mode: 0o700 });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text, { mode: 0o644 });
    const domain = `gui/${process.getuid?.() ?? 501}`;
    await run("launchctl", ["bootout", `${domain}/${label}`]).catch(() => {});
    await run("launchctl", ["bootstrap", domain, file]);
    return { ok: true, where: file, log: logFile(), text };
  }
  if (process.platform === "linux") {
    const file = unitPath();
    const text = systemdUnit({ args, env: serviceEnv(), log: logFile(), cwd: homedir() });
    if (opts.dryRun) return { ok: true, where: file, log: logFile(), text };
    await mkdir(logDir(), { recursive: true, mode: 0o700 });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
    await run("systemctl", ["--user", "daemon-reload"]);
    await run("systemctl", ["--user", "enable", "--now", unitName()]);
    return { ok: true, where: file, log: logFile(), text };
  }
  return {
    ok: false,
    instructions: process.platform === "win32"
      ? `Starting at login isn't automatic on Windows yet. Keep \`${command}\` running in a terminal, or add it to Task Scheduler:\n  schtasks /Create /SC ONLOGON /TN "Offsite Agents" /TR "npx --yes ${RUNNER_SPEC} start"`
      : `Starting at login isn't automatic on ${process.platform} yet. Keep \`${command}\` running, with your system's service manager or in a terminal.`,
  };
}

/** Stops the service and removes it. False when there was none. */
export async function uninstall(): Promise<boolean> {
  if (process.platform === "darwin") {
    const label = serviceLabel();
    const file = plistPath(label);
    await run("launchctl", ["bootout", `gui/${process.getuid?.() ?? 501}/${label}`]).catch(() => {});
    if (!existsSync(file)) return false;
    await rm(file, { force: true });
    return true;
  }
  if (process.platform === "linux") {
    const file = unitPath();
    if (!existsSync(file)) return false;
    await run("systemctl", ["--user", "disable", "--now", unitName()]).catch(() => {});
    await rm(file, { force: true });
    await run("systemctl", ["--user", "daemon-reload"]).catch(() => {});
    return true;
  }
  return false;
}

/** Whether a service is set up for this OFFSITE_HOME. */
export function installed(): boolean {
  if (process.platform === "darwin") return existsSync(plistPath());
  if (process.platform === "linux") return existsSync(unitPath());
  return false;
}

// ---- one runner per OFFSITE_HOME ----

// One per deployment (see config.ts): the sim crew on a dev deployment and the real crew can run side by side.
const pidFile = () => pidFileFor();

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };

/** The pid of another runner already working from this OFFSITE_HOME, or null. */
export async function runningPid(): Promise<number | null> {
  const pid = Number((await readFile(pidFile(), "utf8").catch(() => "")).trim());
  return pid && pid !== process.pid && alive(pid) ? pid : null;
}

/**
 * Claim this OFFSITE_HOME for this process. Two runners with one token would each fail the other's runs when they
 * start, so the second one refuses instead. Returns the other's pid when it is taken.
 */
export async function claimHome(): Promise<number | null> {
  const other = await runningPid();
  if (other) return other;
  await mkdir(offsiteHome(), { recursive: true, mode: 0o700 });
  await writeFile(pidFile(), `${process.pid}\n`);
  return null;
}

/** Synchronous, so it can run in an exit handler. */
export function releaseHome(): void {
  try { if (Number(readFileSync(pidFile(), "utf8").trim()) === process.pid) rmSync(pidFile(), { force: true }); } catch { /* not ours, or gone */ }
}
