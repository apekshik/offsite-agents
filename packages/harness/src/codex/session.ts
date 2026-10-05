// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { z } from "zod";
import { RunEvent } from "@offsite/contracts";
import type { Session, StartSession } from "../adapter.ts";
import { AsyncQueue } from "../queue.ts";
import { describeTool, isDangerous, mcpName, outside, truncate } from "../tools.ts";
import { codexRateLimitWindows, type CodexRateLimits } from "../usage.ts";
import type { JsonRpcChild } from "./rpc.ts";
import { createHash } from "node:crypto";

// The subset of the app-server v2 protocol Offsite consumes. Validate at the wire, allow additional fields so
// newer CLIs can extend notifications independently.
const Id = z.union([z.string(), z.number()]);
const Thread = z.object({ thread: z.object({ id: z.string() }) });
const Turn = z.object({ id: z.string(), status: z.string().optional(), error: z.object({ message: z.string() }).nullable().optional() });
const Envelope = z.object({ threadId: z.string().optional() }).passthrough();
const Item = z.object({
  id: z.string(), type: z.string(), text: z.string().optional(), command: z.string().optional(),
  tool: z.string().optional(), arguments: z.unknown().optional(), query: z.string().optional(), status: z.string().optional(),
  aggregatedOutput: z.string().nullable().optional(), exitCode: z.number().nullable().optional(),
  durationMs: z.number().nullable().optional(), success: z.boolean().nullable().optional(),
  changes: z.array(z.object({ path: z.string(), diff: z.string() })).optional(),
  contentItems: z.array(z.object({ text: z.string().optional() }).passthrough()).nullable().optional(),
}).passthrough();
const Question = z.object({ id: z.string(), question: z.string(), isSecret: z.boolean().optional(), options: z.array(z.object({ label: z.string(), description: z.string() })).nullable().optional() });
const Approval = z.object({ command: z.string().nullable().optional(), reason: z.string().nullable().optional(), grantRoot: z.string().nullable().optional(), availableDecisions: z.array(z.unknown()).nullable().optional() }).passthrough();
const Models = z.object({ data: z.array(z.object({ id: z.string(), model: z.string(), displayName: z.string(), isDefault: z.boolean().optional(), supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })) })), nextCursor: z.string().nullable() });

export type Rpc = Pick<JsonRpcChild, "request" | "notify" | "respond" | "reject" | "kill" | "notifications" | "requests" | "exited">;
type Pending = { rpcId: string | number | null; answer: (decision: string) => void | Promise<void> };

/** A tool's arguments as JSON Schema for Codex. Input mode, so arguments with defaults stay optional. */
export const toolSchema = (args: z.ZodRawShape) => z.toJSONSchema(z.object(args), { io: "input", unrepresentable: "any" });

export class CodexSession implements Session {
  readonly events = new AsyncQueue<RunEvent>();
  private threadId = "";
  private toolsHash = "";
  private turnId: string | null = null;
  private logicalTurn: string | null = null;
  private stopped = false;
  private stopping: Promise<void> | null = null;
  private interrupted = false;
  private starting = false;
  private model: string | null;
  private effort: string;
  private readonly queue: string[] = [];
  private readonly pending = new Map<string, Pending>();
  private readonly texts = new Map<string, string>();
  private readonly completedTurns = new Set<string>();
  private readonly items = new Map<string, z.infer<typeof Item>>();
  private readonly started = new Set<string>();
  private readonly input: StartSession;
  private readonly rpc: Rpc;

  private constructor(input: StartSession, rpc: Rpc) {
    this.input = input; this.rpc = rpc;
    this.model = input.crew.model;
    this.effort = input.crew.effort;
    rpc.notifications.push((method, params) => { try { this.notification(method, params); } catch (e) { this.fail(e); } });
    rpc.requests.push((id, method, params) => {
      void this.serverRequest(id, method, params).catch((e) => {
        try { rpc.reject(id, (e as Error).message, -32602); } catch {}
        this.fail(e);
      });
    });
    void rpc.exited.then((code) => { if (!this.stopped) this.fail(new Error(`Codex app-server exited (${code})`)); });
  }

  static async start(input: StartSession, rpc: Rpc): Promise<CodexSession> {
    const session = new CodexSession(input, rpc);
    try { await session.initialize(); return session; }
    catch (e) { await session.stop(); throw e; }
  }

  private emit(event: Record<string, unknown>) { this.events.push(RunEvent.parse(event)); }
  private fail(error: unknown) {
    if (this.stopped) return;
    this.emit({ type: "error", message: error instanceof Error ? error.message : String(error), fatal: true });
    void this.stop();
  }
  /** The computer reads and plans, a look designer only answers; crew write freely inside their worktree and ask the captain to go further. */
  private get computer() { return this.input.crew.role === "computer" || this.input.kind === "look"; }
  private get approvalPolicy() { return this.computer ? "never" : "on-request"; }
  private get sandboxPolicy() {
    return this.computer ? { type: "readOnly", networkAccess: false } : {
      type: "workspaceWrite", writableRoots: [this.input.cwd], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false,
    };
  }

  private async initialize() {
    await this.rpc.request("initialize", { clientInfo: { name: "offsite", title: "Offsite", version: "0.0.1" }, capabilities: { experimentalApi: true } });
    this.rpc.notify("initialized");
    // Resolve the crew member's model (or the CLI's default) and the generic "max" effort against this CLI's catalog.
    let cursor: string | null = null;
    do {
      const page = Models.parse(await this.rpc.request("model/list", { cursor, limit: 100 }));
      const want = this.model?.toLowerCase();
      const model = page.data.find((m) => want ? m.model === this.model || m.id === this.model || m.displayName.toLowerCase() === want : m.isDefault);
      if (model) {
        this.model = model.model;
        const supported = model.supportedReasoningEfforts.map((e) => e.reasoningEffort);
        if (!supported.includes(this.effort)) this.effort = (this.effort === "max" ? ["xhigh", "high", "medium"] : ["medium", "high", "low"]).find((e) => supported.includes(e)) ?? this.effort;
        break;
      }
      cursor = page.nextCursor;
    } while (cursor);
    const params = {
      ...(this.model ? { model: this.model } : {}), cwd: this.input.cwd, approvalPolicy: this.approvalPolicy, approvalsReviewer: "user",
      sandbox: this.computer ? "read-only" : "workspace-write", developerInstructions: this.input.systemPrompt,
    };
    const dynamicTools = this.input.tools.map((t) => ({ type: "function", name: t.name, description: t.description, inputSchema: toolSchema(t.args) }));
    this.toolsHash = createHash("sha256").update(JSON.stringify(dynamicTools)).digest("hex");
    const resume = z.object({ threadId: z.string(), toolsHash: z.string().optional() }).safeParse(this.input.resumeCursor);
    // A resumed Codex thread keeps its original tool schemas. Start fresh when Offsite's tools changed, rather than
    // leaving the crew member on stale capabilities.
    const compatible = resume.success && (resume.data.toolsHash === this.toolsHash || (!resume.data.toolsHash && !dynamicTools.length));
    const result = compatible
      ? await this.rpc.request("thread/resume", { ...params, threadId: resume.data.threadId })
      : await this.rpc.request("thread/start", { ...params, dynamicTools });
    this.threadId = Thread.parse(result).thread.id;
    this.emit({ type: "session.started", resumeCursor: this.resumeCursor() });
  }

  async send(text: string) {
    if (this.stopped || this.interrupted) return;
    if (this.logicalTurn || this.starting || this.queue.length) this.emit({ type: "steer.received", text });
    this.queue.push(text);
    void this.drain();
  }

  // One completion per send. Queue at turn boundaries rather than using turn/steer, which appends to one turn and
  // would leave the runner waiting for a completion that never comes.
  private async drain() {
    if (this.stopped || this.interrupted || this.starting || this.logicalTurn) return;
    const next = this.queue.shift();
    if (next !== undefined) await this.startTurn(next);
  }
  private async startTurn(text: string) {
    this.starting = true;
    try {
      const result = z.object({ turn: Turn }).parse(await this.rpc.request("turn/start", {
        threadId: this.threadId, input: [{ type: "text", text, text_elements: [] }],
        ...(this.model ? { model: this.model } : {}), effort: this.effort, approvalPolicy: this.approvalPolicy, approvalsReviewer: "user", sandboxPolicy: this.sandboxPolicy,
      }));
      // turn/started normally arrives first. Do not resurrect a turn which already completed.
      if (!this.turnId && !this.logicalTurn && !this.completedTurns.has(result.turn.id) && result.turn.status === "inProgress") this.beginTurn(result.turn.id);
    } catch (e) { this.fail(e); }
    finally { this.starting = false; void this.drain(); }
  }
  private beginTurn(id: string) {
    this.turnId = id;
    if (this.logicalTurn) return;
    this.logicalTurn = id;
    this.texts.clear(); this.items.clear();
    this.emit({ type: "turn.started", turnId: id });
  }
  private finishTurn() {
    if (!this.logicalTurn) return;
    this.clearRequests();
    this.emit({ type: "turn.completed", turnId: this.logicalTurn });
    this.logicalTurn = null; this.turnId = null;
    void this.drain();
  }

  private text(itemId: string, text: string, final: boolean) {
    if (!this.logicalTurn) return;
    const before = [...this.texts.values()].join("\n\n");
    this.texts.set(itemId, text);
    const after = [...this.texts.values()].join("\n\n");
    // One reply per turn, not per Codex message item.
    if (!final && after.startsWith(before)) this.emit({ type: "content.delta", delta: after.slice(before.length) });
    else this.emit({ type: "content.final", text: after });
  }

  private describe(item: z.infer<typeof Item>): { kind: string; summary: string } {
    if (item.type === "dynamicToolCall" && item.tool) {
      const args = item.arguments && typeof item.arguments === "object" ? item.arguments as Record<string, unknown> : {};
      return describeTool(mcpName(item.tool), args, this.input.cwd);
    }
    if (item.type === "commandExecution") return { kind: "bash", summary: truncate((item.command ?? "").replace(/\s+/g, " ").trim(), 90) };
    if (item.type === "fileChange") {
      const paths = (item.changes ?? []).map((c) => c.path.startsWith(this.input.cwd + "/") ? c.path.slice(this.input.cwd.length + 1) : c.path);
      return { kind: "edit", summary: `Edit ${paths.join(", ") || "files"}` };
    }
    if (item.type === "webSearch") return { kind: "web", summary: `Search ${item.query ?? ""}`.trim() };
    if (item.type === "mcpToolCall") return { kind: "tool", summary: item.tool ?? "tool" };
    if (item.type === "collabAgentToolCall") return { kind: "agent", summary: "Subagent" };
    if (item.type === "contextCompaction") return { kind: "plan", summary: "Compact the conversation" };
    return { kind: "tool", summary: item.type };
  }

  private notification(method: string, raw: unknown) {
    if (this.stopped) return;
    const p = Envelope.parse(raw);
    if (p.threadId && p.threadId !== this.threadId) return;
    if (method === "account/rateLimits/updated") {
      const windows = codexRateLimitWindows((raw as { rateLimits?: CodexRateLimits | null }).rateLimits);
      if (windows.length) this.emit({ type: "usage.updated", windows });
      return;
    }
    if (method === "turn/started") { this.beginTurn(Turn.parse(p["turn"]).id); return; }
    if (method === "turn/completed") {
      const turn = Turn.parse(p["turn"]);
      if (turn.id !== this.turnId) return;
      this.completedTurns.add(turn.id);
      this.turnId = null;
      if (turn.status === "failed") { this.fail(new Error(turn.error?.message ?? "Codex turn failed")); return; }
      this.finishTurn();
      return;
    }
    if (method === "item/agentMessage/delta" || method === "item/plan/delta") {
      const { itemId, delta } = z.object({ itemId: z.string(), delta: z.string() }).parse(p);
      this.text(itemId, (this.texts.get(itemId) ?? "") + delta, false); return;
    }
    if (method === "item/started" || method === "item/completed") {
      const item = Item.parse(p["item"]);
      this.items.set(item.id, item);
      if (item.type === "agentMessage" || item.type === "plan") {
        if (method === "item/completed") this.text(item.id, item.text ?? this.texts.get(item.id) ?? "", true);
        return;
      }
      if (["userMessage", "reasoning", "hookPrompt", "functionCallOutput", "subAgentActivity"].includes(item.type)) return;
      const { kind, summary } = this.describe(item);
      if (method === "item/started") { this.started.add(item.id); this.emit({ type: "item.started", itemId: item.id, kind, summary }); return; }
      // A step that completes without a start still shows as one step.
      if (!this.started.has(item.id)) this.emit({ type: "item.started", itemId: item.id, kind, summary });
      this.started.delete(item.id);
      const output = item.aggregatedOutput ?? item.changes?.map((c) => c.diff).join("\n") ?? item.contentItems?.map((c) => c.text ?? "").join("\n") ?? "";
      this.emit({ type: "item.completed", itemId: item.id, summary, detail: truncate(output) || null, ok: !["failed", "declined", "cancelled"].includes(item.status ?? "") && item.success !== false && (item.exitCode == null || item.exitCode === 0), ms: item.durationMs ?? null });
      return;
    }
    if (method === "error") {
      const { error, willRetry } = z.object({ error: z.object({ message: z.string() }), willRetry: z.boolean() }).parse(p);
      if (willRetry) this.emit({ type: "status", message: error.message, until: null });
      else this.fail(new Error(error.message));
    }
    if (method === "serverRequest/resolved") {
      const id = Id.parse(p["requestId"]);
      for (const [key, value] of this.pending) if (value.rpcId === id) this.resolve(key, "cleared");
    }
  }

  private open(key: string, rpcId: string | number | null, kind: "approval" | "input", prompt: string, options: string[] | null, answer: Pending["answer"]) {
    this.pending.set(key, { rpcId, answer });
    this.emit({ type: "request.opened", requestId: key, kind, prompt, options });
  }
  private resolve(key: string, decision: string) {
    this.pending.delete(key);
    this.emit({ type: "request.resolved", requestId: key, decision });
  }
  private clearRequests() { for (const key of this.pending.keys()) this.resolve(key, "cancel"); }

  private async serverRequest(id: string | number, method: string, raw: unknown) {
    if (this.stopped) return;
    const p = Envelope.parse(raw);
    if (p.threadId !== this.threadId) { this.rpc.reject(id, "Request belongs to another thread"); return; }
    const key = `rpc:${typeof id}:${id}`;
    if (method === "item/tool/call") {
      let text: string, success = false;
      try {
        const call = z.object({ tool: z.string(), arguments: z.unknown().optional() }).parse(p);
        const tool = this.input.tools.find((t) => t.name === call.tool);
        if (!tool) throw new Error(`Unknown Offsite tool: ${call.tool}`);
        text = await tool.run(z.object(tool.args).parse(call.arguments ?? {})); success = true;
      } catch (e) { text = `Error: ${(e as Error).message}`; }
      if (!this.stopped) this.rpc.respond(id, { contentItems: [{ type: "inputText", text }], success });
      return;
    }
    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
      const a = Approval.parse(p), command = a.command ?? "";
      const bash = method.includes("commandExecution");
      const itemId = p["itemId"];
      const changes = typeof itemId === "string" ? this.items.get(itemId)?.changes : undefined;
      const offered = (value: string) => !a.availableDecisions || a.availableDecisions.includes(value);
      if (this.computer) { this.rpc.respond(id, { decision: "decline" }); return; }
      // Edits inside the worktree are the crew's to make. Anything broader, and every command the sandbox stopped,
      // is the captain's call.
      const beyond = !!p["additionalPermissions"] || !!p["networkApprovalContext"] || !!a.grantRoot || !!changes?.some((c) => outside(c.path, this.input.cwd));
      if (!bash && !beyond && offered("accept")) { this.rpc.respond(id, { decision: "accept" }); return; }
      const options = [...(offered("accept") ? ["allow"] : []), ...(offered("acceptForSession") ? ["always"] : []), "deny"];
      const prompt = [
        bash ? `Run: ${command || "command"}` : `Allow file changes?${changes?.length ? "\n" + changes.map((c) => `${c.path}\n${truncate(c.diff)}`).join("\n") : ""}`,
        a.reason, a.grantRoot ? `Root: ${a.grantRoot}` : "", bash && isDangerous("Bash", { command }) ? "(destructive or shared-state command)" : "",
      ].filter(Boolean).join("\n");
      this.open(key, id, "approval", prompt, options, (decision) => {
        const mapped = decision === "allow" ? "accept" : decision === "always" ? "acceptForSession" : "decline";
        this.rpc.respond(id, { decision: offered(mapped) ? mapped : "cancel" });
      }); return;
    }
    if (method === "item/tool/requestUserInput") {
      const { questions } = z.object({ questions: z.array(Question) }).parse(p);
      // Questions go to the captain's phone; never solicit a secret there.
      if (questions.some((q) => q.isSecret)) { this.rpc.respond(id, { answers: {} }); this.emit({ type: "error", message: "Codex asked for a secret; enter credentials in its CLI instead.", fatal: false }); return; }
      if (!questions.length) { this.rpc.respond(id, { answers: {} }); return; }
      const answers: Record<string, { answers: string[] }> = {};
      for (const q of questions) this.open(`${key}:${q.id}`, id, "input", q.question + (q.options?.length ? "\n" + q.options.map((o) => `${o.label}: ${o.description}`).join("\n") : ""), q.options?.map((o) => o.label) ?? null, (decision) => {
        answers[q.id] = { answers: [decision] };
        if (Object.keys(answers).length === questions.length) this.rpc.respond(id, { answers });
      }); return;
    }
    if (method === "item/permissions/requestApproval") {
      const permissions = z.record(z.string(), z.unknown()).parse(p["permissions"]);
      if (this.computer) { this.rpc.respond(id, { permissions: {}, scope: "turn" }); return; }
      this.open(key, id, "approval", `${typeof p["reason"] === "string" ? p["reason"] : "Allow additional permissions?"}\n${JSON.stringify(permissions)}`, ["allow", "deny"], (decision) => {
        this.rpc.respond(id, { permissions: decision === "allow" ? Object.fromEntries(Object.entries(permissions).filter(([, v]) => v != null)) : {}, scope: "turn" });
      }); return;
    }
    if (method === "mcpServer/elicitation/request") {
      this.rpc.respond(id, { action: "decline", content: null });
      this.emit({ type: "error", message: "An MCP server asked for a form or a browser sign-in Offsite cannot show. It was declined; finish that setup in the Codex CLI.", fatal: false });
      return;
    }
    // An unsupported server request must get an error, never hang the harness.
    this.rpc.reject(id, `Offsite does not support ${method}`);
  }

  async respond(requestId: string, decision: string) {
    const pending = this.pending.get(requestId);
    if (!pending || this.stopped) return;
    this.resolve(requestId, decision);
    try { await pending.answer(decision); } catch (e) { this.fail(e); }
  }
  async interrupt() {
    this.interrupted = true; this.queue.length = 0;
    if (this.turnId) await this.rpc.request("turn/interrupt", { threadId: this.threadId, turnId: this.turnId });
    else this.finishTurn();
  }
  async stop() {
    if (this.stopping) return this.stopping;
    this.stopped = true; this.queue.length = 0;
    this.clearRequests(); this.rpc.kill(); this.events.close();
    // Give the process time to exit before the runner commits its worktree.
    this.stopping = new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 3000);
      void this.rpc.exited.then(() => { clearTimeout(timeout); resolve(); });
    });
    return this.stopping;
  }
  resumeCursor() { return this.threadId ? { threadId: this.threadId, toolsHash: this.toolsHash } : null; }
}
