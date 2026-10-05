// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { afterEach, describe, expect, it, vi } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { RunEvent } from "@offsite/contracts";
import type { Session, StartSession } from "../adapter.ts";
import { AsyncQueue } from "../queue.ts";
import { claudeAdapter } from "./index.ts";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn(), createSdkMcpServer: vi.fn(() => ({})), tool: vi.fn((name: string) => ({ name })) }));
vi.mock("../path.ts", () => ({ which: vi.fn(async () => "/test/claude") }));
vi.mock("../version.ts", async (original) => ({ ...(await original<typeof import("../version.ts")>()), cliVersion: vi.fn(async () => "2.1.0") }));

const sessions: Session[] = [];
afterEach(async () => { for (const session of sessions.splice(0)) await session.stop(); vi.clearAllMocks(); });

const input = (patch: Partial<StartSession> = {}): StartSession => ({
  kind: "task", crew: { name: "Juniper", handle: "juniper", role: "crew", model: null, effort: "high" },
  cwd: "/tmp/offsite-test", resumeCursor: null, systemPrompt: "You are Juniper.", tools: [], ...patch,
});

async function setup(patch: Partial<StartSession> = {}) {
  const stream = new AsyncQueue<never>();
  vi.mocked(query).mockReturnValue(Object.assign(stream, { interrupt: vi.fn(), close: () => stream.close() }) as unknown as ReturnType<typeof query>);
  const session = await claudeAdapter.start(input(patch));
  sessions.push(session);
  const options = vi.mocked(query).mock.calls.at(-1)![0].options!;
  const events: RunEvent[] = [];
  void (async () => { for await (const event of session.events) events.push(event); })();
  const check = (name: string, toolInput: Record<string, unknown>, requestId: string) => options.canUseTool!(name, toolInput, { requestId, signal: new AbortController().signal, toolUseID: requestId });
  const sent = vi.mocked(query).mock.calls.at(-1)![0].prompt as AsyncIterable<{ uuid: string; message: { content: string } }>;
  return { session, options, events, check, stream, sent: sent[Symbol.asyncIterator]() };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Claude Code sessions", () => {
  it("runs the captain's own claude with Offsite's prompt, the crew member's effort and its tools", async () => {
    const tool = { name: "sync_with_team", description: "Sync", args: {}, run: vi.fn(async () => "ok") };
    const { options } = await setup({ tools: [tool], env: { PORT: "4110" }, resumeCursor: { sessionId: "prev" } });
    expect(options.pathToClaudeCodeExecutable).toBe("/test/claude");
    expect(options.systemPrompt).toEqual({ type: "preset", preset: "claude_code", append: "You are Juniper." });
    expect(options.effort).toBe("high");
    expect(options.model).toBeUndefined();
    expect(options.resume).toBe("prev");
    expect(options.env?.["PORT"]).toBe("4110");
    expect(Object.keys(options.mcpServers ?? {})).toEqual(["offsite"]);
    expect(options.disallowedTools).toEqual(["AskUserQuestion"]);
    // The captain's own settings load, with Claude Code's attribution footers turned off over them.
    expect(options.settingSources).toEqual(["user", "project"]);
    expect(options.settings).toEqual({ attribution: { commit: "", pr: "", sessionUrl: false }, includeCoAuthoredBy: false });
  });

  it("keeps the computer from editing", async () => {
    const { options } = await setup({ kind: "computer", crew: { name: "Computah", handle: "computah", role: "computer", model: "claude-opus-5-5", effort: "max" } });
    expect(options.disallowedTools).toEqual(expect.arrayContaining(["Edit", "Write", "AskUserQuestion"]));
    expect(options.model).toBe("claude-opus-5-5");
  });

  it("lets routine work through and asks the captain before going beyond the worktree", async () => {
    const { session, events, check } = await setup();
    expect(await check("Bash", { command: "pnpm test" }, "a")).toEqual({ behavior: "allow", updatedInput: { command: "pnpm test" } });
    expect(await check("Edit", { file_path: "/tmp/offsite-test/src/x.ts" }, "b")).toMatchObject({ behavior: "allow" });
    const push = check("Bash", { command: "git push origin main" }, "c");
    await settle();
    expect(events).toContainEqual({ type: "request.opened", requestId: "c", kind: "approval", prompt: "Run: git push origin main", options: ["allow", "always", "deny"] });
    await session.respond("c", "deny");
    expect(await push).toMatchObject({ behavior: "deny" });
    expect(events).toContainEqual({ type: "request.resolved", requestId: "c", decision: "deny" });
    // "always" remembers the same prompt for the rest of the session.
    const outside = check("Write", { file_path: "/etc/motd" }, "d");
    await settle();
    await session.respond("d", "always");
    expect(await outside).toMatchObject({ behavior: "allow" });
    expect(await check("Write", { file_path: "/etc/motd" }, "e")).toMatchObject({ behavior: "allow" });
    expect(events.filter((e) => e.type === "request.opened")).toHaveLength(2);
  });

  it("streams text, steps and the final reply without a run id", async () => {
    const { session, events, stream, sent } = await setup();
    await session.send("Do the task");
    expect((await sent.next()).value.message.content).toBe("Do the task");
    stream.push({ type: "system", subtype: "init", session_id: "s1" } as never);
    stream.push({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "Reading" } } } as never);
    stream.push({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/tmp/offsite-test/README.md" } }] } } as never);
    stream.push({ type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "hello" }] } } as never);
    stream.push({ type: "result", subtype: "success", result: "", num_turns: 1 } as never);
    await settle();
    expect(events.map((e) => e.type)).toEqual(["turn.started", "session.started", "content.delta", "item.started", "item.completed", "content.final", "turn.completed"]);
    expect(events).toContainEqual({ type: "item.started", itemId: "t1", kind: "read", summary: "Read README.md" });
    expect(events).toContainEqual({ type: "content.final", text: "Reading" });
    expect(session.resumeCursor()).toEqual({ sessionId: "s1" });
    await session.send("A steer");
    expect(events.at(-1)).toEqual({ type: "steer.received", text: "A steer" });
  });

  it("does not end the turn on a turn the CLI started itself while our message waits", async () => {
    const { session, events, stream, sent } = await setup({ resumeCursor: { sessionId: "previous" } });
    await session.send("Read the results");
    const { uuid } = (await sent.next()).value;
    stream.push({ type: "result", subtype: "success", result: "", queued_turn_count: 0, num_turns: 0 } as never);
    await settle();
    expect(events.filter((e) => e.type === "turn.completed")).toHaveLength(0);
    stream.push({ type: "result", subtype: "success", user_message_uuid: uuid, queued_turn_count: 0, num_turns: 1, result: "Here are the results" } as never);
    await settle();
    expect(events.filter((e) => e.type === "turn.completed")).toHaveLength(1);
    expect(events).toContainEqual({ type: "content.final", text: "Here are the results" });
  });
});

describe("Claude probe", () => {
  const probe = (init: Record<string, unknown>) => {
    vi.mocked(query).mockReturnValue({ initializationResult: async () => init, close: vi.fn() } as unknown as ReturnType<typeof query>);
    return claudeAdapter.probe();
  };
  it("reads the plan, email and models from the CLI's own sign-in", async () => {
    const s = await probe({ account: { email: "a@b.c", subscriptionType: "max" }, models: [{ value: "claude-opus-5-5", displayName: "Opus 5.5", description: "", supportedEffortLevels: ["low", "high", "max"] }] });
    expect(s).toMatchObject({ harness: "claude", installed: true, version: "2.1.0", auth: "authenticated", plan: "Max", email: "a@b.c" });
    expect(s.models).toEqual([{ id: "claude-opus-5-5", name: "Opus 5.5", efforts: ["low", "high", "max"] }]);
  });
  it("says when nobody is signed in", async () => {
    expect((await probe({ account: {}, models: [] })).auth).toBe("unauthenticated");
  });
});
