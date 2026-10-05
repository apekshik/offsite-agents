// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { COMPUTER_TOOLS, type RunEvent } from "@offsite/contracts";
import type { StartSession } from "../adapter.ts";
import { CodexSession, toolSchema, type Rpc } from "./session.ts";

class FakeRpc implements Rpc {
  notifications: Rpc["notifications"] = [];
  requests: Rpc["requests"] = [];
  exit!: (code: number | null) => void;
  exited = new Promise<number | null>((resolve) => { this.exit = resolve; });
  notify = vi.fn(); respond = vi.fn(); reject = vi.fn(); kill = vi.fn(() => this.exit(0));
  turns = 0;
  request = vi.fn(async (method: string, _params?: unknown): Promise<unknown> => {
    if (method === "model/list") return { data: [{ id: "gpt-5.6", model: "gpt-5.6", displayName: "GPT-5.6", isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }, { reasoningEffort: "xhigh" }] }], nextCursor: null };
    if (method === "thread/start" || method === "thread/resume") return { thread: { id: "thread" } };
    if (method === "turn/start") {
      const turn = { id: `t${++this.turns}`, status: "inProgress" };
      this.emit("turn/started", { turn });
      return { turn };
    }
    return {};
  }) as Rpc["request"] & ReturnType<typeof vi.fn>;
  emit(method: string, params: Record<string, unknown>) { for (const fn of this.notifications) fn(method, { threadId: "thread", ...params }); }
  ask(id: string | number, method: string, params: Record<string, unknown>) { for (const fn of this.requests) fn(id, method, { threadId: "thread", ...params }); }
  done(id = `t${this.turns}`, status = "completed") { this.emit("turn/completed", { turn: { id, status } }); }
}

const input = (patch: Partial<StartSession> = {}): StartSession => ({
  kind: "task", crew: { name: "Otis", handle: "otis", role: "crew", model: null, effort: "max" },
  cwd: "/tmp/offsite-test", resumeCursor: null, systemPrompt: "You are Otis.", tools: [], ...patch,
});
const sessions: CodexSession[] = [];
afterEach(async () => { for (const session of sessions.splice(0)) await session.stop(); });
async function setup(patch: Partial<StartSession> = {}) {
  const rpc = new FakeRpc();
  const session = await CodexSession.start(input(patch), rpc);
  sessions.push(session);
  const events: RunEvent[] = [];
  void (async () => { for await (const event of session.events) events.push(event); })();
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
  return { rpc, session, events, tick };
}

describe("Codex app-server adapter", () => {
  it("starts on the CLI's default model at its best effort, in the worktree, with Offsite's prompt and tools", async () => {
    const tool = { name: "sync_with_team", description: "Sync", args: {}, run: vi.fn(async () => "ok") };
    const { rpc, session } = await setup({ tools: [tool] });
    expect(rpc.request).toHaveBeenCalledWith("thread/start", expect.objectContaining({ model: "gpt-5.6", cwd: "/tmp/offsite-test", developerInstructions: "You are Otis.", approvalPolicy: "on-request", sandbox: "workspace-write", dynamicTools: [expect.objectContaining({ type: "function", name: "sync_with_team" })] }));
    await session.send("hello");
    expect(rpc.request).toHaveBeenCalledWith("turn/start", expect.objectContaining({ effort: "xhigh", sandboxPolicy: expect.objectContaining({ type: "workspaceWrite", writableRoots: ["/tmp/offsite-test"], networkAccess: true }) }));
    expect(session.resumeCursor()).toMatchObject({ threadId: "thread", toolsHash: expect.any(String) });
  });

  it("keeps the computer read-only", async () => {
    const { rpc, session } = await setup({ kind: "computer", crew: { name: "Computah", handle: "computah", role: "computer", model: "GPT-5.6", effort: "high" } });
    expect(rpc.request).toHaveBeenCalledWith("thread/start", expect.objectContaining({ approvalPolicy: "never", sandbox: "read-only" }));
    await session.send("plan");
    expect(rpc.request).toHaveBeenCalledWith("turn/start", expect.objectContaining({ sandboxPolicy: { type: "readOnly", networkAccess: false } }));
  });

  it("describes plan_tasks' arguments so defaults stay optional", () => {
    const schema = toolSchema(COMPUTER_TOOLS.plan_tasks.args) as unknown as { properties: { tasks: { items: { required: string[] } } } };
    expect(schema.properties.tasks.items.required).toEqual(["key", "title", "brief"]);
  });

  it("resumes a thread whose tools are unchanged, and starts fresh when they changed", async () => {
    const tool = { name: "x", description: "x", args: { a: z.string() }, run: async () => "ok" };
    const first = await setup({ tools: [tool] });
    const cursor = first.session.resumeCursor();
    const same = await setup({ tools: [tool], resumeCursor: cursor });
    expect(same.rpc.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread" }));
    const changed = await setup({ tools: [{ ...tool, args: { a: z.number() } }], resumeCursor: cursor });
    expect(changed.rpc.request).toHaveBeenCalledWith("thread/start", expect.anything());
  });

  it("makes one reply per turn and one completion per queued steer", async () => {
    const { rpc, session, events, tick } = await setup();
    await session.send("first"); await tick();
    await session.send("second");
    expect(rpc.turns).toBe(1);
    rpc.emit("item/agentMessage/delta", { itemId: "msg-a", delta: "Hi" });
    rpc.emit("item/completed", { item: { type: "agentMessage", id: "msg-a", text: "Hi!" } });
    rpc.emit("item/started", { item: { type: "commandExecution", id: "cmd", command: "pnpm test" } });
    rpc.emit("item/completed", { item: { type: "commandExecution", id: "cmd", command: "pnpm test", status: "completed", exitCode: 0, aggregatedOutput: "ok", durationMs: 12 } });
    rpc.emit("item/completed", { item: { type: "dynamicToolCall", id: "dyn", tool: "plan_tasks", arguments: { tasks: [{}] }, status: "completed", success: true } });
    rpc.done(); await tick(); expect(rpc.turns).toBe(2);
    rpc.done(); await tick();
    expect(events.filter((e) => e.type === "turn.completed")).toHaveLength(2);
    expect(events).toContainEqual({ type: "steer.received", text: "second" });
    expect(events).toContainEqual({ type: "content.delta", delta: "Hi" });
    expect(events).toContainEqual({ type: "content.final", text: "Hi!" });
    expect(events).toContainEqual({ type: "item.completed", itemId: "cmd", summary: "pnpm test", detail: "ok", ok: true, ms: 12 });
    expect(events).toContainEqual({ type: "item.started", itemId: "dyn", kind: "offsite", summary: "Plan one task" });
  });

  it("validates Offsite tool arguments and returns successes and failures to Codex", async () => {
    const tool = { name: "message_crew", description: "msg", args: { crew: z.string(), text: z.string() }, run: vi.fn(async ({ crew }: Record<string, unknown>) => `Sent to ${crew}`) };
    const { rpc, tick } = await setup({ tools: [tool] });
    rpc.ask(1, "item/tool/call", { tool: "message_crew", arguments: { crew: "wren", text: "hi" } }); await tick();
    expect(rpc.respond).toHaveBeenCalledWith(1, { contentItems: [{ type: "inputText", text: "Sent to wren" }], success: true });
    rpc.ask(2, "item/tool/call", { tool: "message_crew", arguments: { crew: 1 } }); await tick();
    expect(rpc.respond).toHaveBeenCalledWith(2, expect.objectContaining({ success: false }));
    expect(tool.run).toHaveBeenCalledTimes(1);
  });

  it("accepts edits inside the worktree and asks the captain for commands and anything beyond", async () => {
    const { rpc, session, events, tick } = await setup();
    rpc.emit("item/started", { item: { type: "fileChange", id: "in", changes: [{ path: "/tmp/offsite-test/src/a.ts", diff: "+a" }] } });
    rpc.ask(1, "item/fileChange/requestApproval", { itemId: "in" });
    rpc.emit("item/started", { item: { type: "fileChange", id: "out", changes: [{ path: "/etc/hosts", diff: "+b" }] } });
    rpc.ask(2, "item/fileChange/requestApproval", { itemId: "out" });
    rpc.ask("cmd", "item/commandExecution/requestApproval", { command: "pnpm install", availableDecisions: ["accept", "acceptForSession", "decline"] });
    await tick();
    expect(rpc.respond).toHaveBeenCalledWith(1, { decision: "accept" });
    expect(events.filter((e) => e.type === "request.opened")).toHaveLength(2);
    await session.respond("rpc:string:cmd", "always");
    await session.respond("rpc:string:cmd", "deny");
    expect(rpc.respond).toHaveBeenCalledWith("cmd", { decision: "acceptForSession" });
    expect(rpc.respond).not.toHaveBeenCalledWith("cmd", { decision: "decline" });
    expect(events).toContainEqual({ type: "request.resolved", requestId: "rpc:string:cmd", decision: "always" });
  });

  it("routes Codex's own questions to the captain, but never a secret", async () => {
    const { rpc, session, events, tick } = await setup();
    rpc.ask(7, "item/tool/requestUserInput", { questions: [{ id: "q", question: "Which page?" }] }); await tick();
    expect(events).toContainEqual(expect.objectContaining({ type: "request.opened", kind: "input", prompt: "Which page?" }));
    await session.respond("rpc:number:7:q", "Settings");
    expect(rpc.respond).toHaveBeenCalledWith(7, { answers: { q: { answers: ["Settings"] } } });
    rpc.ask(8, "item/tool/requestUserInput", { questions: [{ id: "k", question: "API key?", isSecret: true }] }); await tick();
    expect(rpc.respond).toHaveBeenCalledWith(8, { answers: {} });
  });

  it("interrupts the current turn without launching queued work", async () => {
    const { rpc, session, tick } = await setup();
    await session.send("first"); await tick();
    await session.send("second");
    await session.interrupt(); rpc.done("t1", "interrupted"); await tick();
    expect(rpc.request).toHaveBeenCalledWith("turn/interrupt", { threadId: "thread", turnId: "t1" });
    expect(rpc.turns).toBe(1);
  });

  it("reports retries without ending the run, but fails on process exit", async () => {
    const { rpc, events, tick } = await setup();
    rpc.emit("error", { error: { message: "retrying" }, willRetry: true }); await tick();
    expect(events).toContainEqual({ type: "status", message: "retrying", until: null });
    rpc.exit(1); await tick();
    expect(events).toContainEqual(expect.objectContaining({ type: "error", fatal: true }));
    expect(rpc.kill).toHaveBeenCalledOnce();
  });
});
