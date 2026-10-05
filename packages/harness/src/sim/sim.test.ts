import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMPUTER_TOOLS, CREW_TOOLS, Look, type RunEvent } from "@offsite/contracts";
import type { OffsiteTool, Session, StartSession } from "../adapter.ts";
import { createSimAdapter, keepBoth, partsOf, planFor, simLookLines } from "./index.ts";
import { rng } from "./random.ts";

const roots: string[] = [];
const sessions: Session[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.stop();
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});

async function repo(key = "theme-types") {
  const root = await mkdtemp(join(tmpdir(), "offsite-sim-")); roots.push(root);
  const cwd = join(root, key);
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(join(cwd, "README.md"), "# App\n\nA small app with a theme.\n");
  await writeFile(join(cwd, "src", "theme.ts"), "export const theme = 'light';\n");
  return cwd;
}

const toolsFrom = (specs: Record<string, { name: string; description: string; args: OffsiteTool["args"] }>, impl: Record<string, (a: Record<string, unknown>) => Promise<string>>): OffsiteTool[] =>
  Object.values(specs).map((s) => ({ ...s, run: impl[s.name] ?? (async () => "ok") }));

async function start(patch: Partial<StartSession>, seed = 7) {
  const adapter = createSimAdapter({ seed, timeScale: 0 });
  const session = await adapter.start({
    kind: "task", crew: { name: "Juniper", handle: "juniper", role: "crew", model: null, effort: "high" },
    cwd: "/tmp/none", resumeCursor: null, systemPrompt: "", tools: [], ...patch,
  });
  sessions.push(session);
  const events: RunEvent[] = [];
  const turns: { done: number } = { done: 0 };
  void (async () => { for await (const e of session.events) { events.push(e); if (e.type === "turn.completed") turns.done += 1; } })();
  const until = async (n: number) => { await vi.waitFor(() => expect(turns.done).toBeGreaterThanOrEqual(n), { timeout: 5000, interval: 5 }); };
  return { session, events, until };
}

describe("the sim crew on a task", () => {
  it("looks around, makes a real change in its worktree, runs the tests and reports", async () => {
    const cwd = await repo();
    const { session, events, until } = await start({ cwd, tools: toolsFrom(CREW_TOOLS, {}) }, 3);
    await session.send("Add a Theme type with light and dark variants.");
    await until(1);
    const kinds = events.filter((e) => e.type === "item.started").map((e) => (e as { kind: string }).kind);
    expect(kinds).toEqual(expect.arrayContaining(["read", "search", "write", "bash"]));
    expect(await readFile(join(cwd, "crew-notes", "theme-types.md"), "utf8")).toMatch(/^# Add a Theme type/);
    const final = events.find((e) => e.type === "content.final") as { text: string };
    expect(final.text).toMatch(/Done: Add a Theme type/);
    expect(events.filter((e) => e.type === "content.delta").length).toBeGreaterThan(5);
    expect(events[0]).toEqual({ type: "session.started", resumeCursor: expect.objectContaining({ sim: expect.any(String) }) });
  });

  it("replays exactly from the same seed", async () => {
    const shape = async () => {
      const cwd = await repo();
      const { session, events, until } = await start({ cwd }, 11);
      await session.send("Add a Theme type with light and dark variants.");
      await until(1);
      return events.map((e) => (e.type === "item.started" ? `${e.kind}:${e.summary}` : e.type === "request.opened" ? "ask" : null)).filter(Boolean);
    };
    expect(await shape()).toEqual(await shape());
  });

  it("asks the captain about one task in four, and waits for the answer", async () => {
    let asked = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const cwd = await repo(`t${seed}`);
      const { session, events, until } = await start({ cwd }, seed);
      await session.send("Tidy the theme module.");
      await vi.waitFor(() => expect(events.some((e) => e.type === "turn.completed" || e.type === "request.opened")).toBe(true), { timeout: 5000, interval: 5 });
      const req = events.find((e) => e.type === "request.opened") as { requestId: string } | undefined;
      if (req) {
        asked += 1;
        await new Promise((r) => setTimeout(r, 20));
        expect(events.some((e) => e.type === "turn.completed")).toBe(false);
        await session.respond(req.requestId, "deny");
      }
      await until(1);
    }
    expect(asked).toBeGreaterThanOrEqual(3);
    expect(asked).toBeLessThanOrEqual(12);
  });

  it("resolves conflict markers it is steered about, keeping both sides", async () => {
    const cwd = await repo();
    const { session, until } = await start({ cwd }, 5);
    await session.send("Add a line to the README.");
    await until(1);
    await writeFile(join(cwd, "README.md"), "# App\n<<<<<<< HEAD\n- mine\n=======\n- theirs\n>>>>>>> offsite/x\n");
    await session.send("Merge conflict: README.md has conflict markers. Resolve them.");
    await until(2);
    expect(await readFile(join(cwd, "README.md"), "utf8")).toBe("# App\n- mine\n- theirs\n");
  });

  it("stops mid-step when interrupted, and still completes the turn", async () => {
    const cwd = await repo();
    const adapter = createSimAdapter({ seed: 1, timeScale: 1 });
    const session = await adapter.start({ kind: "task", crew: { name: "J", handle: "j", role: "crew", model: null, effort: "low" }, cwd, resumeCursor: null, systemPrompt: "", tools: [] });
    sessions.push(session);
    const events: RunEvent[] = [];
    void (async () => { for await (const e of session.events) events.push(e); })();
    await session.send("Do something long.");
    await new Promise((r) => setTimeout(r, 50));
    await session.interrupt();
    await vi.waitFor(() => expect(events.some((e) => e.type === "turn.completed")).toBe(true), { timeout: 2000 });
  });
});

describe("the sim computer", () => {
  it("plans one task for a short ask, and a shared-types task first when the ask has parts", () => {
    expect(planFor("Add dark mode to the settings page", new Set())).toHaveLength(1);
    expect(partsOf("Add an invoices API endpoint and a page that lists the invoices")).toEqual(["Add an invoices API endpoint", "a page that lists the invoices"]);
    const plan = planFor("Add an invoices API endpoint and a page that lists the invoices", new Set());
    expect(plan.map((t) => t.dependsOn.length)).toEqual([0, 1, 1]);
    expect(plan[0]!.title).toBe("Shared types and interfaces");
    for (const t of plan) expect(t.key).toMatch(/^[a-z0-9-]{1,32}$/);
    expect(new Set(plan.map((t) => t.key)).size).toBe(3);
  });

  it("with several repos, plans a task per repo the ask names, the API first, and puts the rest in the named or first repo", () => {
    const repos = ["web", "api"];
    const plan = planFor("Add a health endpoint to the api, then show a status badge in web", new Set(), repos);
    expect(plan.map((t) => [t.title, t.repo, t.dependsOn])).toEqual([
      ["Add a health endpoint to the api", "api", []],
      ["Show a status badge in web", "web", [plan[0]!.key]],
    ]);
    // The serving repo lands first even when the ask names it second.
    expect(planFor("Show the status in web and add the endpoint to the api", new Set(), repos).map((t) => t.repo)).toEqual(["api", "web"]);
    expect(planFor("Fix the flaky login test in api", new Set(), repos).map((t) => t.repo)).toEqual(["api"]);
    expect(planFor("Add an invoices endpoint and a page that lists the invoices", new Set(), repos).map((t) => t.repo)).toEqual(["web", "web", "web"]);
    expect(planFor("Fix the typo", new Set(), ["app"])[0]!.repo).toBeUndefined();
  });

  it("plans through the real tools, then reviews and finishes once everything has landed", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    let tasks: { id: string; key: string; title: string; state: string; assignee: string | null }[] = [];
    const tools = toolsFrom(COMPUTER_TOOLS, {
      crew_status: async () => JSON.stringify({ crew: [], tasks }),
      plan_tasks: async (a) => {
        calls.push({ name: "plan_tasks", args: a });
        tasks = (a["tasks"] as { key: string; title: string }[]).map((t, i) => ({ id: `t${i}`, key: t.key, title: t.title, state: i ? "todo" : "doing", assignee: "wren" }));
        return JSON.stringify(tasks.map((t) => ({ key: t.key, taskId: t.id, assignee: "@wren", state: t.state })));
      },
      review_task: async (a) => { calls.push({ name: "review_task", args: a }); return JSON.stringify({ stat: { files: 1, add: 3, del: 0 } }); },
      finish_thread: async (a) => { calls.push({ name: "finish_thread", args: a }); return "Opened https://github.com/acme/app/pull/7"; },
    });
    const { session, events, until } = await start({ kind: "computer", crew: { name: "Computer", handle: "computer", role: "computer", model: null, effort: "high" }, tools });
    await session.send("Add an invoices API endpoint and a page that lists the invoices");
    await until(1);
    expect(calls.map((c) => c.name)).toEqual(["plan_tasks"]);
    expect((calls[0]!.args["tasks"] as unknown[]).length).toBe(3);
    expect((events.filter((e) => e.type === "content.final").at(-1) as { text: string }).text).toMatch(/splits cleanly/);

    tasks = tasks.map((t) => ({ ...t, state: "landed" }));
    await session.send("@wren landed \"Shared types\" (shared) on the thread's branch. 3 of 3 tasks have landed.");
    await until(2);
    expect(calls.map((c) => c.name)).toEqual(["plan_tasks", "review_task", "review_task", "review_task", "finish_thread"]);
    expect((events.filter((e) => e.type === "content.final").at(-1) as { text: string }).text).toMatch(/pull\/7/);
  });
});

describe("the sim's look", () => {
  it("is a valid Look once assembled", () => {
    const lines = simLookLines(rng(1), "sunglasses and a sun hat").map((l) => JSON.parse(l) as Record<string, unknown>);
    const meta = lines.find((l) => l["t"] === "meta")!;
    const pieces = lines.filter((l) => l["t"] === "piece").map(({ t: _t, ...p }) => p);
    expect(Look.safeParse({ meta: { name: meta["name"], base: meta["base"], hide: meta["hide"] }, pieces }).success).toBe(true);
  });
  it("keeps both sides of a conflict", () => {
    expect(keepBoth("a\n<<<<<<< HEAD\nb\n||||||| base\nx\n=======\nc\n>>>>>>> other\nd\n")).toBe("a\nb\nc\nd\n");
  });
});
