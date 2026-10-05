import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Look, type RunEvent } from "@offsite/contracts";
import { adapters, AsyncQueue, createSimAdapter, keepBoth, SimSession, type HarnessAdapter, type Session, type SimScript, type StartSession } from "@offsite/harness";
import { FakeShip } from "./fakeShip.ts";
import { Runner } from "./runs.ts";

const run = promisify(execFile);
const sh = (cwd: string, ...args: string[]) => run("git", args, { cwd }).then((r) => r.stdout.trim());

let root: string;
let repo: string;
const saved: Record<string, string | undefined> = {};
const logs: string[] = [];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "offsite-runner-"));
  await writeFile(join(root, "gitconfig"), "[user]\n\tname = Captain\n\temail = captain@example.com\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n");
  for (const [k, v] of Object.entries({ GIT_CONFIG_GLOBAL: join(root, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", OFFSITE_HOME: join(root, "home") })) { saved[k] = process.env[k]; process.env[k] = v; }
});
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true });
});

let n = 0;
beforeEach(async () => {
  logs.length = 0;
  repo = join(root, `repo${++n}`);
  await mkdir(join(repo, "src"), { recursive: true });
  await sh(repo, "init", "-q");
  await writeFile(join(repo, "README.md"), "# Invoices app\n\nLists invoices.\n");
  await writeFile(join(repo, "src", "invoices.ts"), "export const invoices = [];\n");
  await sh(repo, "add", "-A");
  await sh(repo, "commit", "-q", "-m", "seed");
});

const simOnly = (adapter: HarnessAdapter) => ({ ...adapters, sim: adapter });
function start(ship: FakeShip, adapter: HarnessAdapter = createSimAdapter({ seed: 4, timeScale: 0 }), extra: Partial<ConstructorParameters<typeof Runner>[0]> = {}) {
  const runner = new Runner({ backend: ship, adapters: simOnly(adapter), sim: true, captain: "Ada", log: (l) => logs.push(l), ...extra });
  runner.start();
  return runner;
}
const ended = (ship: FakeShip) => ship.runs.every((r) => ["landed", "failed", "interrupted"].includes(r.state));
const settled = (ship: FakeShip, until: () => boolean, timeout = 20_000) => vi.waitFor(() => { if (!until()) throw new Error(`waiting… ${logs.slice(-3).join(" | ")}`); }, { timeout, interval: 20 });

describe("a thread from request to pull request, on the sim crew", () => {
  it("plans, lands every task on the thread branch one commit each, reviews and finishes", async () => {
    const ship = new FakeShip(repo);
    ship.autoAnswer = () => "allow";
    const runner = start(ship);
    const thread = ship.createThread("Add an invoices API endpoint and a page that lists the invoices");
    await settled(ship, () => thread.state === "done" && ended(ship));
    await runner.stop(1000);

    expect(ship.calls.filter((c) => c === "planTasks")).toHaveLength(1);
    expect(ship.tasks.map((t) => t.state)).toEqual(["landed", "landed", "landed"]);
    expect(ship.calls.filter((c) => c === "reviewTask")).toHaveLength(3);
    expect(thread.finished?.title).toBeTruthy();
    expect(thread.prUrl).toBeNull();
    // One commit per task on offsite/<slug>-<id6>, authored by the crew member; main untouched.
    expect(thread.branch).toMatch(/^offsite\/add-an-invoices-api-endpoint-and-[a-z0-9]{6}$/);
    const log = (await sh(repo, "log", "--format=%an|%s", thread.branch!)).split("\n");
    expect(log).toHaveLength(4);
    expect(log.at(-1)).toBe("Captain|seed");
    expect(log.slice(0, 3).every((l) => / \(Offsite\)\|/.test(l))).toBe(true);
    expect(await sh(repo, "log", "--format=%s", "main")).toBe("seed");
    for (const t of ship.tasks) expect(await sh(repo, "show", `${thread.branch}:crew-notes/${t.key}.md`)).toContain("#");
    // Task branches were recorded; every run ended well, and the crew reported.
    expect(ship.tasks.every((t) => t.branch?.startsWith(`${thread.branch}-`))).toBe(true);
    // Landed task branches aren't left checked out in their worktrees (no "+" in `git branch`).
    for (const t of ship.tasks) expect(await run("git", ["branch", "--list", t.branch!], { cwd: repo }).then((r) => r.stdout)).toBe(`  ${t.branch}\n`);
    expect(ship.runs.every((r) => r.state === "landed")).toBe(true);
    expect(ship.tasks.every((t) => t.report && /Done/.test(t.report))).toBe(true);
    // Each landed task's size was recorded: its notes file, added.
    expect(ship.tasks.every((t) => t.diff && t.diff.files >= 1 && t.diff.added >= 1)).toBe(true);
    // Events reached the ship normalized, deltas coalesced, never more than 200 a call.
    const all = [...ship.eventLog.values()].flat();
    expect(all.some((e) => e.type === "item.started" && e.kind === "edit" || e.type === "item.started" && e.kind === "write")).toBe(true);
    expect(ship.batches.every((b) => b.length <= 200)).toBe(true);
    for (const b of ship.batches) for (let i = 1; i < b.length; i++) expect(b[i - 1]!.type === "content.delta" && b[i]!.type === "content.delta").toBe(false);
  }, 30_000);

  it("runs the office's setup command once in each new task worktree", async () => {
    const ship = new FakeShip(repo, { setupCommand: "echo ready > .setup-done" });
    const runner = start(ship);
    const thread = ship.createThread("Fix the typo in the README");
    await settled(ship, () => thread.state === "done" && ended(ship));
    await runner.stop(1000);
    const taskRun = ship.runs.find((r) => r.kind === "task")!;
    expect(await readFile(join(taskRun.worktree!, ".setup-done"), "utf8")).toBe("ready\n");
    const events = ship.eventLog.get(taskRun.id)!;
    expect(events).toContainEqual(expect.objectContaining({ type: "item.started", itemId: "setup", kind: "bash", summary: "echo ready > .setup-done" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "item.completed", itemId: "setup", ok: true }));
  }, 30_000);
});

describe("a ship with two repos", () => {
  it("plans a task in each, lands each on the thread branch in its own repo, and finishes with one entry per repo", async () => {
    const api = join(root, `api${n}`);
    await mkdir(api, { recursive: true });
    await sh(api, "init", "-q");
    await writeFile(join(api, "README.md"), "# Invoices API\n");
    await sh(api, "add", "-A");
    await sh(api, "commit", "-q", "-m", "api seed");
    const ship = new FakeShip([{ name: "web", path: repo }, { name: "api", path: api, setupCommand: "echo api > .setup-done" }]);
    ship.autoAnswer = () => "allow";
    const runner = start(ship);
    const thread = ship.createThread("Add a health endpoint to the api, then show a status badge in web");
    await settled(ship, () => thread.state === "done" && ended(ship));
    await runner.stop(1000);

    expect(ship.tasks.map((t) => [t.repo, t.state])).toEqual([["api", "landed"], ["web", "landed"]]);
    expect(ship.tasks[1]!.dependsOn).toEqual([ship.tasks[0]!.id]);
    // One branch name, made in each repo, one commit on each; the defaults untouched.
    const branch = thread.branch!;
    expect((await sh(api, "log", "--format=%s", branch)).split("\n")).toHaveLength(2);
    expect((await sh(repo, "log", "--format=%s", branch)).split("\n")).toHaveLength(2);
    expect(await sh(api, "log", "--format=%s", "main")).toBe("api seed");
    expect(await sh(api, "show", `${branch}:crew-notes/${ship.tasks[0]!.key}.md`)).toContain("#");
    expect(await sh(repo, "show", `${branch}:crew-notes/${ship.tasks[1]!.key}.md`)).toContain("#");
    // Each task worked in its own repo, with that repo's setup command.
    const runs = ship.runs.filter((r) => r.kind === "task");
    expect(await realpath(await sh(runs[0]!.worktree!, "rev-parse", "--path-format=absolute", "--git-common-dir"))).toBe(await realpath(join(api, ".git")));
    expect(await readFile(join(runs[0]!.worktree!, ".setup-done"), "utf8")).toBe("api\n");
    await expect(readFile(join(runs[1]!.worktree!, ".setup-done"), "utf8")).rejects.toThrow();
    // The computer worked from a folder holding both repos at the thread's branch.
    const computer = ship.runs.find((r) => r.kind === "computer")!.worktree!;
    expect(computer.endsWith("_thread")).toBe(true);
    expect(await sh(join(computer, "api"), "rev-parse", "HEAD")).toBe(await sh(api, "rev-parse", branch));
    expect(await sh(join(computer, "web"), "rev-parse", "HEAD")).toBe(await sh(repo, "rev-parse", branch));
    // No remotes: each repo's work stays on its branch, one entry per repo.
    expect(thread.prs).toEqual([{ repo: "web", url: null, branch }, { repo: "api", url: null, branch }]);
    expect(ship.calls.filter((c) => c === "reviewTask")).toHaveLength(2);
  }, 30_000);

  it("refuses a plan without repos on a two-repo ship, with the names", async () => {
    const ship = new FakeShip([{ name: "web", path: repo }, { name: "api", path: repo }]);
    const errors: string[] = [];
    const runner = start(ship, {
      kind: "sim",
      probe: async () => ({ harness: "sim", installed: true, version: null, auth: "authenticated", email: null, plan: null, models: [], message: null }),
      start: async (input) => new SimSession(input, async (ctx) => {
        try { await ctx.tool("plan_tasks", { tasks: [{ key: "x", title: "X", brief: "x" }] }); } catch (e) { errors.push((e as Error).message); }
      }, { seed: 1, timeScale: 0 }),
    });
    ship.createThread("Do a thing");
    await settled(ship, () => ended(ship) && ship.runs.length > 0);
    await runner.stop(1000);
    expect(errors.join(" ")).toMatch(/needs a repo: this ship has 2 \(web, api\)/);
  }, 30_000);
});

/** A crew that always writes the same line of the README, and resolves conflicts by keeping both sides. */
const clashing: SimScript = async (ctx) => {
  if (/conflict markers/i.test(ctx.text)) {
    const readme = join(ctx.cwd, "README.md");
    await ctx.step("edit", "Edit README.md", [0, 0], async () => { await writeFile(readme, keepBoth(await readFile(readme, "utf8"))); return {}; });
    await ctx.say("Kept both lines.");
    return;
  }
  await ctx.step("edit", "Edit README.md", [0, 0], async () => {
    await writeFile(join(ctx.cwd, "README.md"), `# Invoices app\n\nLists invoices.\n- ${ctx.crew.name} was here\n`);
    return {};
  });
  await ctx.say(`Done: ${ctx.crew.name}'s line.`);
};
/** Scripted crew members, with a computer that plans the given task keys side by side, then finishes. */
const scripted = (script: SimScript, keys = ["left", "right"]): HarnessAdapter => ({
  kind: "sim",
  probe: async () => ({ harness: "sim", installed: true, version: null, auth: "authenticated", email: null, plan: null, models: [], message: null }),
  start: async (input) => new SimSession(input, input.crew.role === "computer" ? planning(keys) : script, { seed: 1, timeScale: 0 }),
});
const planning = (keys: string[]): SimScript => async (ctx) => {
  const status = JSON.parse(await ctx.tool("crew_status", {})) as { tasks: { key: string; state: string }[] };
  if (!status.tasks.length) {
    await ctx.tool("plan_tasks", { tasks: keys.map((key) => ({ key, title: key.charAt(0).toUpperCase() + key.slice(1), brief: "Add your line" })) });
  } else if (status.tasks.every((t) => t.state === "landed")) {
    await ctx.tool("finish_thread", { title: "Done", summary: "Everyone's work" });
  }
};

describe("landing through a conflict", () => {
  it("steers the same crew member to resolve it, then lands both", async () => {
    const ship = new FakeShip(repo);
    const runner = start(ship, scripted(clashing));
    const thread = ship.createThread("Both of you, add a line to the README");
    await settled(ship, () => thread.state === "done" && ended(ship));
    await runner.stop(1000);
    const readme = await sh(repo, "show", `${thread.branch}:README.md`);
    expect(readme).toContain("- Juniper was here");
    expect(readme).toContain("- Otis was here");
    expect(readme).not.toMatch(/<<<<<<<|>>>>>>>/);
    // Exactly one of them was asked to resolve it: a second turn in the same session, then it landed.
    const turns = ship.runs.filter((r) => r.kind === "task").map((r) => (ship.eventLog.get(r.id) ?? []).filter((e) => e.type === "turn.started").length);
    expect(turns.sort()).toEqual([1, 2]);
    expect((await sh(repo, "log", "--format=%s", thread.branch!)).split("\n").sort()).toEqual(["Left", "Right", "seed"]);
  }, 30_000);
});

describe("talking to a working crew member", () => {
  it("waits on ask_captain until the captain answers, and hands harness approvals back by request id", async () => {
    const asking: SimScript = async (ctx) => {
      const answer = await ctx.tool("ask_captain", { question: "Blue or green?", options: ["blue", "green"] });
      const approval = await ctx.ask("approval", "Run: git push", ["allow", "deny"]);
      await writeFile(join(ctx.cwd, "color.txt"), `${answer}\n${approval}\n`);
      await ctx.say("Done.");
    };
    const ship = new FakeShip(repo);
    const runner = start(ship, scripted(asking, ["colour"]));
    const thread = ship.createThread("Pick a colour");
    await settled(ship, () => ship.questions.length === 1);
    const ask = ship.questions[0]!;
    expect(ask.prompt).toBe("Blue or green?");
    await new Promise((r) => setTimeout(r, 50));
    expect(ship.runs.find((r) => r.kind === "task")!.state).toBe("working");
    ship.answer(ask.id, "blue");
    await settled(ship, () => ship.questions.length === 2);
    ship.answer(ship.questions[1]!.id, "deny");
    await settled(ship, () => thread.state === "done" && ended(ship));
    await runner.stop(1000);
    const task = ship.tasks[0]!;
    expect(await sh(repo, "show", `${thread.branch}:color.txt`)).toBe("The captain answered: blue\ndeny");
    expect(ship.questions.every((q) => q.delivered)).toBe(true);
    expect(task.state).toBe("landed");
  }, 30_000);

  it("keeps an answer that arrives before ask_captain starts waiting", async () => {
    const ship = new FakeShip(repo, { crew: ["Juniper"] });
    ship.autoAnswer = () => "green";
    const runner = start(ship, scripted(async (ctx) => {
      await writeFile(join(ctx.cwd, "colour.txt"), await ctx.tool("ask_captain", { question: "Colour?" }));
    }, ["quick"]));
    const thread = ship.createThread("Quick question");
    await settled(ship, () => thread.state === "done" && ended(ship));
    await runner.stop(1000);
    expect(await sh(repo, "show", `${thread.branch}:colour.txt`)).toBe("The captain answered: green");
  }, 30_000);

  it("delivers the computer's message to a live run as a steer", async () => {
    const ship = new FakeShip(repo, { crew: ["Juniper"] });
    const runner = start(ship, scripted(async (ctx) => {
      if (ctx.first) {
        await writeFile(join(ctx.cwd, "first.txt"), "1\n");
        await ship.tools.messageCrew("computer-run", "juniper", "the API landed, sync_with_team");
        await ctx.think(0, 0);
        return;
      }
      await writeFile(join(ctx.cwd, "second.txt"), ctx.text);
    }, ["small"]));
    const thread = ship.createThread("Something small");
    await settled(ship, () => thread.state === "done" && ended(ship));
    await runner.stop(1000);
    expect(await sh(repo, "show", `${thread.branch}:second.txt`)).toBe("From the computer: the API landed, sync_with_team");
    expect(ship.inbox.every((m) => m.delivered)).toBe(true);
  }, 30_000);
});

describe("the reply", () => {
  it("sends only the closing paragraph with content.final; earlier ones were their own messages", async () => {
    const ship = new FakeShip(repo, { crew: ["Juniper"] });
    const runner = start(ship, scripted(async (ctx) => {
      await ctx.say("Looking around first.");
      await ctx.step("read", "Read README.md", [0, 0]);
      await ctx.say("Done: one line.");
    }, ["one"]));
    const thread = ship.createThread("One small thing");
    await settled(ship, () => thread.state === "done" && ended(ship));
    await runner.stop(1000);
    const taskRun = ship.runs.find((r) => r.kind === "task")!;
    const finals = ship.eventLog.get(taskRun.id)!.filter((e) => e.type === "content.final");
    expect(finals).toEqual([{ type: "content.final", text: "Done: one line." }]);
    expect(ship.tasks[0]!.report).toBe("Done: one line.");
  }, 30_000);
});

/** Arlo's run from the first real end-to-end run (Codex, dark mode), as the ship got it: three turns, two of them steers. */
const ARLO = JSON.parse(readFileSync(new URL("./fixtures/arlo-steered.json", import.meta.url), "utf8")) as RunEvent[];

/**
 * Replays a recorded run the way its harness emits it: one turn per send, a send during a turn queued behind it as a
 * steer. Codex sends a content.final with the whole turn's text as each message ends; Claude Code one, at the turn's
 * end. Where the recording received a steer, `steer` sends the same message through the ship.
 */
function replay(input: StartSession, recorded: RunEvent[], shape: "codex" | "claude", steer: (text: string) => Promise<unknown>): Session {
  const events = new AsyncQueue<RunEvent>();
  const sends: string[] = [];
  let waiter = () => {};
  const sent = (n: number) => new Promise<void>((resolve) => { const check = () => { if (sends.length >= n) resolve(); else waiter = check; }; check(); });
  let stopped = false;
  void (async () => {
    await sent(1);
    await writeFile(join(input.cwd, "theme.js"), "export const theme = 'dark';\n");
    let turn = 0, text = "";
    for (const e of recorded) {
      if (stopped) return;
      if (e.type === "turn.started") { await sent(++turn); text = ""; }
      if (e.type === "steer.received") { const before = sends.length; await steer(e.text.replace(/^From the computer: /, "")); await sent(before + 1); continue; }
      if (e.type === "content.delta") text += e.delta;
      if (e.type === "content.final") { if (shape === "codex") events.push({ type: "content.final", text }); continue; }
      if (e.type === "turn.completed" && shape === "claude" && text) events.push({ type: "content.final", text });
      events.push(e);
    }
  })();
  return {
    events,
    async send(text) { if (sends.length) events.push({ type: "steer.received", text }); sends.push(text); waiter(); },
    async interrupt() {}, async respond() {},
    async stop() { stopped = true; events.close(); },
    resumeCursor: () => null,
  };
}

describe("a crew member's report", () => {
  it.each(["codex", "claude"] as const)("keeps the main account from before a steer, with the replies after it (Arlo's run, %s)", async (shape) => {
    const ship = new FakeShip(repo, { crew: ["Arlo"] });
    const computer: SimScript = async (ctx) => {
      const status = JSON.parse(await ctx.tool("crew_status", {})) as { tasks: { key: string; state: string }[] };
      if (!status.tasks.length) await ctx.tool("plan_tasks", { tasks: [{ key: "dark-mode", title: "Add a site-wide dark mode toggle", brief: "Dark mode" }] });
      else if (status.tasks.every((t) => t.state === "landed")) {
        await ctx.tool("finish_thread", { title: "Add dark mode", summary: "## Dark mode\n- A toggle in the header.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n" });
      }
    };
    const runner = start(ship, {
      kind: "sim",
      probe: async () => ({ harness: "sim", installed: true, version: null, auth: "authenticated", email: null, plan: null, models: [], message: null }),
      start: async (input) => input.crew.role === "computer"
        ? new SimSession(input, computer, { seed: 1, timeScale: 0 })
        : replay(input, ARLO, shape, (text) => ship.tools.messageCrew("computer-run", "arlo", text)),
    });
    const thread = ship.createThread("Add a dark mode toggle for the whole site");
    await settled(ship, () => thread.state === "done" && ended(ship));
    await runner.stop(1000);

    const main = "Implemented shared dark mode in `src/theme.js`, `src/style.css`, and `src/main.js`";
    const accent = "Added `--accent-fg`: white in light mode, navy `#0b1a3a` in dark mode.";
    const last = "Added the identical no-flash script to counter.html’s head, before the stylesheet.";
    const report = ship.tasks[0]!.report!;
    expect(report.startsWith(main)).toBe(true);
    expect(report.indexOf(accent)).toBeGreaterThan(0);
    expect(report.indexOf(last)).toBeGreaterThan(report.indexOf(accent));
    expect(ship.runs.find((r) => r.kind === "task")!.report).toBe(report);
    // The landed commit carries the whole account too, under the task's title.
    const message = await sh(repo, "log", "-1", "--format=%B", thread.branch!);
    expect(message.startsWith(`Add a site-wide dark mode toggle\n\n${main}`)).toBe(true);
    expect(message).toContain(last);
    expect(message).toMatch(/\nOffsite-Task: \S+-dark-mode$/);
    // The steers reached Arlo, and the computer's summary lost Claude Code's footer.
    expect((ship.eventLog.get(ship.runs.find((r) => r.kind === "task")!.id) ?? []).filter((e) => e.type === "steer.received")).toHaveLength(2);
    expect(thread.finished?.summary).toBe("## Dark mode\n- A toggle in the header.");
  }, 30_000);
});

describe("stopping", () => {
  const slow: SimScript = async (ctx) => {
    await writeFile(join(ctx.cwd, "half.txt"), "half done\n");
    await ctx.step("bash", "pnpm test", [30, 30]);
  };
  const slowAdapter = (): HarnessAdapter => {
    const base = scripted(slow);
    return { ...base, start: async (input) => input.crew.role === "computer" ? base.start(input) : new SimSession(input, slow, { seed: 1, timeScale: 1 }) };
  };

  it("commits an interrupted task's work on its own branch, without landing it", async () => {
    const ship = new FakeShip(repo);
    const runner = start(ship, slowAdapter());
    const thread = ship.createThread("Something long");
    await settled(ship, () => ship.runs.some((r) => r.kind === "task" && r.state === "working"));
    const taskRun = ship.runs.find((r) => r.kind === "task")!;
    await settled(ship, () => (ship.eventLog.get(taskRun.id) ?? []).some((e) => e.type === "item.started"));
    ship.requestInterrupt(taskRun.id);
    await settled(ship, () => taskRun.state === "interrupted");
    await runner.stop(1000);
    const task = ship.tasks[0]!;
    expect(task.state).toBe("cancelled");
    expect(await sh(repo, "show", `${task.branch}:half.txt`)).toBe("half done");
    expect(await sh(repo, "log", "--format=%s", thread.branch!)).toBe("seed");
  }, 30_000);

  it("on shutdown, stops working runs with their work committed, and claims nothing more", async () => {
    const ship = new FakeShip(repo);
    const runner = start(ship, slowAdapter());
    ship.createThread("Something long");
    await settled(ship, () => ship.runs.some((r) => r.kind === "task" && r.state === "working"));
    const taskRun = ship.runs.find((r) => r.kind === "task")!;
    await settled(ship, () => (ship.eventLog.get(taskRun.id) ?? []).some((e) => e.type === "item.started"));
    expect(await runner.stop(5000)).toEqual([]);
    expect(taskRun.state).toBe("failed");
    expect(taskRun.error).toMatch(/shut down/);
    expect(await sh(repo, "show", `${ship.tasks[0]!.branch}:half.txt`)).toBe("half done");
    // Its failure woke the computer, and a new thread came in: neither is claimed by a runner that has stopped.
    ship.createThread("Another");
    await new Promise((r) => setTimeout(r, 100));
    expect(ship.runs.filter((r) => r.state === "queued")).toHaveLength(2);
    expect(ship.runs.some((r) => r.state === "starting" || r.state === "working")).toBe(false);
  }, 30_000);
});

describe("designing a look", () => {
  it("parses the designer's JSON Lines into a valid Look and saves it", async () => {
    const ship = new FakeShip(repo);
    const runner = start(ship);
    const look = ship.queueLook(ship.crew[1]!.id, "sunglasses and a sun hat");
    await settled(ship, () => look.state !== "queued" && look.state !== "starting" && look.state !== "working");
    await runner.stop(1000);
    expect(look.state).toBe("landed");
    expect(Look.safeParse(ship.looks.get(look.id)).success).toBe(true);
    expect(look.report).toMatch(/hat/i);
  }, 30_000);

  it("retries once with the reason, then fails", async () => {
    let tries = 0;
    const ship = new FakeShip(repo);
    const runner = start(ship, scripted(async (ctx) => { tries += 1; await ctx.say('{"t":"meta","name":"x"}\n{"t":"piece","bone":"tail"}'); }));
    const look = ship.queueLook(ship.crew[1]!.id, "a dragon");
    await settled(ship, () => look.state === "failed");
    await runner.stop(1000);
    expect(tries).toBe(2);
    expect(look.error).toMatch(/didn't fit the format/);
    expect((ship.eventLog.get(look.id) ?? []).filter((e) => e.type === "turn.started")).toHaveLength(2);
  }, 30_000);
});
