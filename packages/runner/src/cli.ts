#!/usr/bin/env node
// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { basename, delimiter, dirname, join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import {
  adapters, cliInvocation, createSimAdapter, hydratePathFromLoginShell, probeAll, profileEnv, profilesDir, SIM_STATUS, which, type ProfileStatus,
} from "@offsite/harness";
import { api } from "../../../convex/_generated/api.js";
import { convexBackend, readable } from "./backend.ts";
import { configFile, defaultName, deployment, isProduction, readConfig, type Deployment, type RunnerConfig } from "./config.ts";
import { login } from "./login.ts";
import { Runner } from "./runs.ts";
import { claimHome, install, installed, logFile, releaseHome, runningPid, uninstall } from "./service.ts";
import { onShutdown } from "./shutdown.ts";
import { canCrew, probeLine, Screen, statusLine, style } from "./ui.ts";

/** Running the TypeScript itself means a checkout of the repo (`pnpm runner`); the published CLI is bundled. */
const checkout = import.meta.url.endsWith(".ts");
// package.json is one folder up from both src/cli.ts and dist/offsite.mjs.
const VERSION = (() => { try { return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version; } catch { return "dev"; } })();

/** How the person ran this, for the hints we print. */
function invocation(): string {
  if (checkout) return "pnpm runner";
  const script = process.argv[1] ?? "";
  if (/[\\/]_npx[\\/]/.test(script) || process.env["npm_command"] === "exec") return "npx offsite-agents";
  // A global install runs through its bin link (offsite or offsite-agents) in a folder on PATH.
  const base = basename(script);
  const onPath = (process.env["PATH"] ?? "").split(delimiter).includes(dirname(script));
  return (base === "offsite" || base === "offsite-agents") && onPath ? base : "npx offsite-agents";
}
const me = invocation();

const HELP = `${style.bold("Offsite Agents")}: run your Offsite crew on this machine, on your own Claude Code and Codex.

  ${me}                      pair this machine if it isn't yet, then take on work
  ${me} --sim                the same with a scripted crew: no CLI, no spending
  ${me} login                pair this machine with your ship (opens the browser)
  ${me} start                take on work (pairs first, if needed)
  ${me} status               paired? running? signed in to Claude Code and Codex?
  ${me} install              keep it running in the background, starting at login (--dry-run shows how)
  ${me} uninstall            stop running it in the background
  ${me} logout               forget this machine's pairing
  ${me} probe                what is installed and signed in here
  ${me} profile add <claude|codex> <name>   another account on this machine

Options
  --url <convex url>   pair with another deployment (a dev or self-hosted one); also OFFSITE_URL
  --name <name>        what to call this machine (default: its computer name)
  --no-open            print the approval link instead of opening the browser
  --speed <x>, --concurrency <n>   sim speed, and runs at once (default 6)

Offsite keeps its pairing in ~/.offsite (OFFSITE_HOME moves it). https://offsiteagents.app`;

const argv = process.argv.slice(2);
const first = argv[0];
const cmd = !first || first.startsWith("-")
  ? (argv.includes("--help") || argv.includes("-h") ? "help" : argv.includes("--version") || argv.includes("-v") ? "version" : "start")
  : first;
const flag = (f: string) => argv.includes(f);
const opt = (f: string) => {
  const i = argv.indexOf(f);
  if (i >= 0) return argv[i + 1];
  return argv.find((a) => a.startsWith(`${f}=`))?.slice(f.length + 1);
};
const die = (message: string): never => { console.error(message); process.exit(1); };
/** Someone is there to approve a code: a terminal, and not the background service. */
const interactive = !!(process.stdin.isTTY || process.stdout.isTTY) && !process.env["OFFSITE_SERVICE"];

/** "macOS 26.4", "Linux", "Windows": shown on the approval page next to the machine's name. */
function osLabel(): string {
  if (process.platform === "darwin") {
    try { return `macOS ${execFileSync("/usr/bin/sw_vers", ["-productVersion"], { encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "ignore"] }).trim()}`; } catch { return "macOS"; }
  }
  return ({ linux: "Linux", win32: "Windows", freebsd: "FreeBSD" } as Record<string, string>)[process.platform] ?? process.platform;
}

/** Opens the approval page. False when we can't (no browser, or asked not to). */
function openBrowser(url: string): boolean {
  if (flag("--no-open") || process.env["OFFSITE_NO_BROWSER"]) return false;
  if (process.platform === "linux" && !process.env["DISPLAY"] && !process.env["WAYLAND_DISPLAY"]) return false;
  const [bin, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const child = spawn(bin as string, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch { return false; }
}

const where = (): Deployment => deployment(opt("--url"), { checkout });
const shipLabel = (convexUrl: string) => (isProduction(convexUrl) ? "offsiteagents.app" : convexUrl);

function header(config?: { name: string; convexUrl: string }) {
  const bits = [`${style.bold("Offsite Agents")} ${style.dim(`v${VERSION}`)}`];
  if (config) bits.push(config.name);
  if (config && !isProduction(config.convexUrl)) bits.push(style.dim(config.convexUrl));
  console.log(bits.join(" · "));
}

function pair(d: Deployment, starting: boolean): Promise<RunnerConfig> {
  return login({ convexUrl: d.convexUrl, siteUrl: d.siteUrl, name: opt("--name") ?? defaultName(), os: osLabel(), starting, command: me, open: openBrowser });
}

const disconnected = (e: unknown) => /not paired|disconnected/i.test(readable(e));

async function probeHere(): Promise<ProfileStatus[]> {
  await hydratePathFromLoginShell();
  return probeAll();
}

// ---- commands ----

async function cmdLogin() {
  header();
  const d = where();
  const before = await readConfig();
  if (before) console.log(style.dim(`This replaces the pairing as "${before.name}" with ${shipLabel(before.convexUrl)}.`));
  await pair(d, false);
}

async function cmdStatus() {
  header();
  const config = await readConfig();
  const pid = await runningPid();
  const row = (k: string, v: string) => console.log(`  ${k.padEnd(11)}${v}`);
  if (!config) row("Paired", `no. Run \`${me}\` to pair this machine.`);
  else {
    row("Paired", `as "${config.name}" with ${shipLabel(config.convexUrl)}`);
    const client = new ConvexHttpClient(config.convexUrl);
    try {
      await client.query(api.runner.work, { token: config.token });
      row("Ship", `${style.green("✓")} reachable, and this machine's pairing is good`);
    } catch (e) {
      row("Ship", disconnected(e) ? `${style.red("✗")} this machine was disconnected. Run \`${me} login\`.` : `${style.amber("?")} can't reach it: ${readable(e)}`);
    }
  }
  row("Running", pid ? `yes (pid ${pid})` : "no");
  row("At login", installed() ? `yes. Logs: ${logFile()}` : `no. \`${me} install\` keeps it running.`);
  console.log("");
  for (const s of await probeHere()) console.log(`  ${probeLine(s)}${s.installed && s.version ? style.dim(`  v${s.version}`) : ""}`);
}

async function cmdLogout() {
  await rm(configFile(), { force: true });
  console.log("This machine is no longer paired. Disconnect it in the app too, to revoke its token.");
  if (installed()) console.log(`It still starts at login; \`${me} uninstall\` stops that.`);
}

async function cmdInstall() {
  if (flag("--dry-run")) {
    const r = await install(me, { dryRun: true });
    console.log(r.ok ? `${style.dim(`Would write ${r.where}:`)}\n\n${r.text}` : r.instructions);
    return;
  }
  let config = await readConfig();
  if (!config) {
    if (!interactive) die(`Pair this machine first: \`${me} login\`.`);
    header();
    config = await pair(where(), true);
  }
  const r = await install(me);
  if (!r.ok) { console.log(r.instructions); return; }
  console.log(`${style.green("✓")} Offsite now runs in the background on "${config.name}" and starts when you log in.`);
  console.log(style.dim(`  ${r.where}\n  Logs: ${r.log}\n  Stop it with \`${me} uninstall\`.`));
}

async function cmdUninstall() {
  const had = await uninstall();
  console.log(had ? `${style.green("✓")} Offsite no longer runs in the background. Your pairing stays; \`${me}\` starts it by hand.` : "Offsite wasn't set up to run in the background here.");
}

async function cmdProbe() {
  for (const s of await probeHere()) console.log(`${probeLine(s)}${s.installed && s.version ? style.dim(`  v${s.version}`) : ""}`);
}

function cmdProfile() {
  const [, sub, harness, name] = argv;
  if (sub !== "add" || (harness !== "claude" && harness !== "codex") || !name || !/^[\w.-]{1,40}$/.test(name)) die(`Usage: ${me} profile add <claude|codex> <name>`);
  const h = harness as "claude" | "codex";
  void (async () => {
    await hydratePathFromLoginShell();
    const bin = (await which(h)) ?? die(`Install ${h} first.`);
    const dir = join(profilesDir(h), name!);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    console.log(`Signing in a new ${h} account into ${dir}. Crew members with profile "${name}" will use it.`);
    const command = cliInvocation(bin, h === "codex" ? ["login"] : ["auth", "login"], profileEnv(h, { configDir: dir }));
    const child = spawn(command.bin, command.args, { env: command.env, stdio: "inherit" });
    child.on("exit", (code) => process.exit(code ?? 1));
    child.on("error", (e) => die(e.message));
  })();
}

async function cmdStart() {
  const sim = flag("--sim");
  const d = where();
  let config = await readConfig();
  if (config && d.explicit && d.convexUrl !== config.convexUrl) {
    console.log(`Paired with ${shipLabel(config.convexUrl)}, but you asked for ${shipLabel(d.convexUrl)}; pairing again.`);
    config = null;
  }
  let shown = false;
  if (!config) {
    if (!interactive) { console.log(`This machine isn't paired yet. Run \`${me}\` in a terminal to pair it.`); process.exit(0); }
    header();
    shown = true;
    config = await pair(d, true);
    console.log("");
  }
  const other = await claimHome();
  if (other) die(`Offsite is already running on this machine (pid ${other})${installed() ? ", in the background" : ""}. \`${me} status\` says more.`);
  process.on("exit", releaseHome);

  const screen = new Screen();
  if (interactive) screen.setStatus(style.dim(sim ? "Starting the sim crew…" : "Checking your Claude Code and Codex logins…"));
  const speed = Number(opt("--speed") ?? process.env["OFFSITE_SIM_SPEED"] ?? 1) || 1;
  const runnerAdapters = { ...adapters, sim: createSimAdapter({ seed: Number(opt("--seed") ?? Date.now() % 100_000), timeScale: 1 / speed }) };

  // The sim answers at once; real CLIs take a few seconds to probe, so with the sim they report on the next check-in.
  let probe: ProfileStatus[] = [{ ...SIM_STATUS, profile: null }];
  const reprobe = async () => { probe = [...(sim ? [{ ...SIM_STATUS, profile: null }] : []), ...(await probeHere())]; };
  if (!sim) await reprobe();

  let backend = convexBackend(config.convexUrl, config.token);
  let hello: { machineId: string; owner: { name: string } };
  try { hello = await backend.hello(probe, true); }
  catch (e) {
    if (!disconnected(e)) { screen.clear(); die(`Couldn't reach your ship: ${readable(e)}${isProduction(config.convexUrl) ? "" : `\n(${config.convexUrl})`}`); }
    await backend.close().catch(() => {});
    await rm(configFile(), { force: true });
    if (!interactive) { console.log(`This machine was disconnected from its ship. Run \`${me}\` in a terminal to pair it again.`); process.exit(0); }
    screen.clear();
    console.log("This machine was disconnected from its ship. Pairing it again.");
    shown = true;
    config = await pair(d.explicit ? d : { convexUrl: config.convexUrl, siteUrl: config.siteUrl, explicit: false }, true);
    backend = convexBackend(config.convexUrl, config.token);
    hello = await backend.hello(probe, true).catch((e2: unknown) => die(readable(e2)));
  }

  screen.clear();
  if (!shown) header(config);
  for (const s of probe) console.log(`  ${probeLine(s)}`);
  if (!sim && !canCrew(probe)) {
    console.log(style.amber(`\n  Nothing here can crew yet. Install and sign in to Claude Code or Codex; Offsite checks again every few minutes.`));
  }
  console.log("");
  if (sim) void reprobe().then(() => backend.hello(probe)).catch(() => {});

  const runner = new Runner({ backend, adapters: runnerAdapters, sim, concurrency: Number(opt("--concurrency") ?? 6) || 6, captain: hello.owner.name, log: screen.log });
  runner.start();
  let online = true;
  let revoked = false;
  const draw = () => screen.setStatus(revoked
    ? `${style.red("✗")} This machine was disconnected from your ship. Ctrl-C, then run \`${me}\` to pair it again.`
    : statusLine({ captain: hello.owner.name, working: runner.active.length, online, sim }));
  draw();
  if (!interactive) screen.log(`up on "${config.name}" for ${hello.owner.name}; waiting for work`);
  const drawing = setInterval(draw, 1000);

  const heartbeat = setInterval(() => void backend.hello(probe).then(
    () => { if (!online) screen.log("back in touch with the ship"); online = true; revoked = false; },
    (e) => {
      if (disconnected(e)) { if (!revoked) screen.log(`disconnected: ${readable(e)}`); revoked = true; return; }
      if (online) screen.log(`check-in failed: ${readable(e)}`);
      online = false;
    },
  ), 30_000);
  const probing = setInterval(() => void reprobe().catch(() => {}), 5 * 60_000);
  const shutdown = onShutdown({
    landRuns: () => { clearInterval(drawing); screen.end(); return runner.stop(); },
    bye: async () => { clearInterval(heartbeat); clearInterval(probing); await backend.close(); },
    exit: (code) => { releaseHome(); process.exit(code); },
    log: (m) => console.log(style.dim(m)),
  });
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

const COMMANDS: Record<string, () => unknown> = {
  help: () => console.log(HELP),
  version: () => console.log(VERSION),
  login: cmdLogin,
  start: cmdStart,
  status: cmdStatus,
  logout: cmdLogout,
  install: cmdInstall,
  uninstall: cmdUninstall,
  probe: cmdProbe,
  profile: cmdProfile,
};

const command = COMMANDS[cmd];
if (!command) die(`Unknown command "${cmd}".\n\n${HELP}`);
try {
  await command!();
  if (cmd !== "start" && cmd !== "profile") process.exit(0);
} catch (e) {
  die(readable(e));
}
