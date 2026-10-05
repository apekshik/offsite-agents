#!/usr/bin/env node
// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  adapters, cliInvocation, createSimAdapter, hydratePathFromLoginShell, probeAll, profileEnv, profilesDir, SIM_STATUS, which, type ProfileStatus,
} from "@offsite/harness";
import { convexBackend, readable } from "./backend.ts";
import { configFile, defaultName, deployment, readConfig, type RunnerConfig } from "./config.ts";
import { login } from "./login.ts";
import { Runner } from "./runs.ts";
import { onShutdown } from "./shutdown.ts";

const HELP = `offsite: run your Offsite crew on this machine, on your own Claude Code and Codex.

  offsite login [--url <convex url>] [--name <machine name>]   pair this machine with your ship
  offsite start [--sim] [--speed <x>] [--concurrency <n>]       take on work (--sim: a scripted crew, no CLI, no spending)
  offsite probe                                                  what is installed and signed in here
  offsite profile add <claude|codex> <name>                      another account on this machine
  offsite logout                                                 forget this machine's pairing

The deployment comes from --url, OFFSITE_CONVEX_URL, or CONVEX_URL in the repo's .env.local.`;

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "help";
const flag = (f: string) => argv.includes(f);
const opt = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const die = (message: string): never => { console.error(message); process.exit(1); };

const line = (s: ProfileStatus) =>
  `${(s.harness + (s.profile ? `:${s.profile}` : "")).padEnd(14)} ${(s.installed ? `v${s.version ?? "?"}` : "missing").padEnd(10)} ${s.auth.padEnd(16)} ${[s.plan, s.email].filter(Boolean).join(" · ")}${s.message ? `  (${s.message})` : ""}`;

async function pair(): Promise<RunnerConfig> {
  const where = deployment(opt("--url")) ?? die("Which ship? Pass --url https://<deployment>.convex.cloud, set OFFSITE_CONVEX_URL, or run from the Offsite repo (its .env.local has CONVEX_URL).");
  return login({ ...where, name: opt("--name") ?? defaultName() });
}

if (cmd === "help" || cmd === "--help" || cmd === "-h") { console.log(HELP); process.exit(0); }

if (cmd === "login") {
  try { await pair(); process.exit(0); } catch (e) { die((e as Error).message); }
}

if (cmd === "logout") {
  await rm(configFile(), { force: true });
  console.log("This machine is no longer paired. Disconnect it in the app too, to revoke its token.");
  process.exit(0);
}

if (cmd === "probe") {
  await hydratePathFromLoginShell();
  for (const s of await probeAll()) console.log(line(s));
  process.exit(0);
}

if (cmd === "profile") {
  const [, sub, harness, name] = argv;
  if (sub !== "add" || (harness !== "claude" && harness !== "codex") || !name || !/^[\w.-]{1,40}$/.test(name)) die("Usage: offsite profile add <claude|codex> <name>");
  const h = harness as "claude" | "codex";
  await hydratePathFromLoginShell();
  const bin = (await which(h)) ?? die(`Install ${h} first.`);
  const dir = join(profilesDir(h), name!);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  console.log(`Signing in a new ${h} account into ${dir}. Crew members with profile "${name}" will use it.`);
  const command = cliInvocation(bin, h === "codex" ? ["login"] : ["auth", "login"], profileEnv(h, { configDir: dir }));
  const child = spawn(command.bin, command.args, { env: command.env, stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 1));
  child.on("error", (e) => die(e.message));
}

if (cmd === "start") {
  const sim = flag("--sim");
  let config = await readConfig();
  const wanted = deployment(opt("--url"));
  if (!config || (opt("--url") && wanted && wanted.convexUrl !== config.convexUrl)) {
    console.log(config ? "That's a different ship; pairing again." : "This machine isn't paired yet.");
    config = await pair().catch((e: Error) => die(e.message));
  }
  const backend = convexBackend(config.convexUrl, config.token);
  const speed = Number(opt("--speed") ?? process.env["OFFSITE_SIM_SPEED"] ?? 1) || 1;
  const runnerAdapters = { ...adapters, sim: createSimAdapter({ seed: Number(opt("--seed") ?? Date.now() % 100_000), timeScale: 1 / speed }) };

  // The sim answers at once; real CLIs take a few seconds to probe, so they report on the next check-in.
  let probe: ProfileStatus[] = [{ ...SIM_STATUS, profile: null }];
  const reprobe = async () => {
    await hydratePathFromLoginShell();
    probe = [...(sim ? [{ ...SIM_STATUS, profile: null }] : []), ...(await probeAll())];
  };
  if (!sim) await reprobe();
  let hello: { machineId: string; owner: { name: string } };
  try { hello = await backend.hello(probe, true); }
  catch (e) { die(`${readable(e)}${/paired|disconnected/i.test(readable(e)) ? "" : `\n(${config.convexUrl})`}`); throw e; }

  console.log(`offsite is up on "${config.name}" for ${hello!.owner.name}${sim ? ", with the sim crew (no CLI, no spending)" : ""}.`);
  for (const s of probe) console.log("  " + line(s));
  if (sim) void reprobe().then(() => backend.hello(probe)).catch(() => {});

  const runner = new Runner({ backend, adapters: runnerAdapters, sim, concurrency: Number(opt("--concurrency") ?? 6) || 6, captain: hello!.owner.name });
  runner.start();
  console.log("Waiting for work. Ctrl-C stops the crew and commits their work.");

  const heartbeat = setInterval(() => void backend.hello(probe).catch((e) => console.error(`check-in failed: ${readable(e)}`)), 30_000);
  const probing = setInterval(() => void reprobe().catch(() => {}), 5 * 60_000);
  const shutdown = onShutdown({
    landRuns: () => runner.stop(),
    bye: async () => { clearInterval(heartbeat); clearInterval(probing); await backend.close(); },
    exit: (code) => process.exit(code),
  });
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

if (!["help", "--help", "-h", "login", "logout", "probe", "profile", "start"].includes(cmd)) die(`Unknown command "${cmd}".\n\n${HELP}`);
