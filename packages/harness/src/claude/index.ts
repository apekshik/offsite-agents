// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import type { RunEvent } from "@offsite/contracts";
import { createSdkMcpServer, query, tool, type Query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import type { HarnessAdapter, HarnessStatus, Session, StartSession } from "../adapter.ts";
import { which } from "../path.ts";
import { AsyncQueue } from "../queue.ts";
import { approvalPrompt, describeTool, OFFSITE_MCP, truncate } from "../tools.ts";
import { claudeRateLimitWindows } from "../usage.ts";
import { cliVersion, withTimeout } from "../version.ts";
import { profileEnv, type HarnessProfile } from "../profile.ts";

/**
 * Claude Code via the Agent SDK, pointed at the captain's own installed `claude` and its own config. The probe
 * opens a query whose prompt never yields, reads initializationResult() (account, models), and closes: no message
 * is sent, no tokens spent, and Offsite never logs in for anyone. The CLI finds its own credentials.
 */
const PLAN: Record<string, string> = {
  claudemaxsubscription: "Max", claudemax5xsubscription: "Max 5x", claudemax20xsubscription: "Max 20x",
  claudeprosubscription: "Pro", claudeteamsubscription: "Team", claudeenterprisesubscription: "Enterprise", claudefreesubscription: "Free",
  max: "Max", max5: "Max 5x", max20: "Max 20x", pro: "Pro", team: "Team", enterprise: "Enterprise", free: "Free",
};
const planLabel = (s: string | undefined) => (s ? PLAN[s.toLowerCase().replace(/[^a-z0-9]/g, "")] ?? s : null);

const baseEnv = (profile?: HarnessProfile, extra?: Record<string, string>) =>
  ({ ...profileEnv("claude", profile), CLAUDE_CODE_AUTO_CONNECT_IDE: "0", ...extra }) as Record<string, string>;

async function* never(): AsyncGenerator<never> { await new Promise(() => {}); }

/**
 * Settings Offsite lays over the captain's own (the flag layer: their other settings still apply). The ship commits,
 * writes pull requests and summaries, so Claude Code's "Generated with Claude Code" footer and co-author trailer stay
 * out of them. The object form of `attribution`, because older CLIs reject a boolean there; `includeCoAuthoredBy`
 * for CLIs from before `attribution`.
 */
export const OFFSITE_SETTINGS = { attribution: { commit: "", pr: "", sessionUrl: false }, includeCoAuthoredBy: false };

export async function probeClaude(profile?: HarnessProfile, cwd?: string): Promise<HarnessStatus> {
  const base = { harness: "claude" as const, plan: null, email: null, models: [] as HarnessStatus["models"] };
  const bin = await which("claude");
  if (!bin) return { ...base, installed: false, version: null, auth: "unknown", message: "Claude Code (`claude`) is not on PATH. Install it, then run `claude auth login`." };
  const version = await cliVersion(bin);
  let q: ReturnType<typeof query> | null = null;
  try {
    q = query({
      prompt: never() as AsyncIterable<never>,
      options: { cwd: cwd ?? tmpdir(), persistSession: false, allowedTools: [], mcpServers: {}, strictMcpConfig: true, settingSources: ["user", "project"], env: baseEnv(profile), pathToClaudeCodeExecutable: bin },
    });
    const init = await withTimeout(q.initializationResult(), 25_000, "claude init");
    const models = (init.models ?? []).map((m) => ({ id: m.value, name: m.displayName, efforts: [...(m.supportedEffortLevels ?? [])] }));
    const acct = init.account ?? {};
    const provider = acct.apiProvider;
    if (provider && provider !== "firstParty") return { ...base, models, installed: true, version, auth: "authenticated", plan: provider, message: `Signed in through ${provider}` };
    const src = (acct.tokenSource ?? "").toLowerCase();
    if (src.includes("apikey") || src.includes("authtoken")) return { ...base, models, installed: true, version, auth: "authenticated", plan: "API key", email: acct.email ?? null, message: null };
    if (acct.email || acct.subscriptionType) return { ...base, models, installed: true, version, auth: "authenticated", plan: planLabel(acct.subscriptionType), email: acct.email ?? null, message: null };
    return { ...base, models, installed: true, version, auth: "unauthenticated", message: "Not signed in. Run `claude auth login`." };
  } catch (e) {
    return { ...base, installed: true, version, auth: "unknown", message: `Could not verify sign-in: ${(e as Error).message}` };
  } finally {
    try { q?.close(); } catch {}
  }
}

/**
 * A live Claude Code session in a worktree. Streaming input: every send() is a user turn, and sends that arrive
 * while a turn runs queue as the next turn (that is a steer). Permission prompts the crew's policy does not settle
 * become request.opened events and block until the captain answers.
 */
class ClaudeSession implements Session {
  readonly events = new AsyncQueue<RunEvent>();
  private readonly inbox = new AsyncQueue<SDKUserMessage>();
  private readonly q: Query;
  private readonly pending = new Map<string, (decision: string) => void>();
  private readonly allow = new Set<string>();
  private readonly toolStart = new Map<string, number>();
  private sessionId: string | null;
  private turn = 0;
  private text = "";
  private stopped = false;
  private turnOpen = false;   // the model is inside a turn (between its first frame and the result)
  private readonly unanswered = new Set<string>();   // uuids of our sends that no result has answered yet
  private echoes = false;     // this CLI echoes a send's uuid on the result that answers it
  private readonly input: StartSession;

  /** `bin` is the captain's installed `claude`; Offsite never ships its own copy. */
  constructor(input: StartSession, bin: string) {
    this.input = input;
    const { crew, cwd, resumeCursor } = input;
    this.sessionId = (resumeCursor as { sessionId?: string } | null)?.sessionId ?? null;
    const offsite = createSdkMcpServer({
      name: OFFSITE_MCP,
      tools: input.tools.map((t) => tool(t.name, t.description, t.args, async (args) => {
        try { return { content: [{ type: "text" as const, text: await t.run(args as Record<string, unknown>) }] }; }
        catch (e) { return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true }; }
      }, { alwaysLoad: true })),
    });
    // The computer plans and reviews; it never edits. A look designer only reads and answers. Everyone asks the
    // captain through ask_captain, so the question reaches the phone, not a prompt in a terminal nobody watches.
    const disallowed = [
      "AskUserQuestion",
      ...(crew.role === "computer" || input.kind === "look" ? ["Edit", "Write", "NotebookEdit", "MultiEdit"] : []),
      ...(input.kind === "look" ? ["Bash", "WebFetch", "WebSearch", "Agent", "Task"] : []),
    ];
    this.q = query({
      prompt: this.inbox,
      options: {
        cwd,
        ...(crew.model ? { model: crew.model } : {}),
        effort: crew.effort,
        permissionMode: "default",
        canUseTool: (name, toolInput, { requestId }) => this.askPermission(name, toolInput as Record<string, unknown>, requestId),
        disallowedTools: disallowed,
        includePartialMessages: true,
        persistSession: true,
        settingSources: ["user", "project"],
        settings: OFFSITE_SETTINGS,
        mcpServers: input.tools.length ? { [OFFSITE_MCP]: offsite } : {},
        env: baseEnv(input.profile, input.env),
        pathToClaudeCodeExecutable: bin,
        ...(this.sessionId ? { resume: this.sessionId } : {}),
        ...(input.systemPrompt ? { systemPrompt: { type: "preset" as const, preset: "claude_code" as const, append: input.systemPrompt } } : {}),
      },
    });
    void this.pump();
  }

  private emit(e: RunEvent) { this.events.push(e); }

  private async askPermission(name: string, toolInput: Record<string, unknown>, requestId: string) {
    const prompt = approvalPrompt(name, toolInput, this.input.cwd);
    if (!prompt || this.allow.has(prompt)) return { behavior: "allow" as const, updatedInput: toolInput };
    this.emit({ type: "request.opened", requestId, kind: "approval", prompt, options: ["allow", "always", "deny"] });
    const decision = await new Promise<string>((res) => this.pending.set(requestId, res));
    if (decision === "always") this.allow.add(prompt);
    if (decision === "allow" || decision === "always") return { behavior: "allow" as const, updatedInput: toolInput };
    return { behavior: "deny" as const, message: "The captain said no. Do not retry this call; find another way, or say what you would have done." };
  }

  private async pump() {
    try {
      for await (const m of this.q) this.handle(m as SDKMessage);
    } catch (e) {
      if (!this.stopped) this.emit({ type: "error", message: (e as Error).message, fatal: true });
    } finally {
      this.events.close();
    }
  }

  private handle(m: SDKMessage) {
    switch (m.type) {
      case "system": {
        if (m.subtype === "init") { this.sessionId = m.session_id; this.emit({ type: "session.started", resumeCursor: { sessionId: m.session_id } }); return; }
        const sys = m as unknown as { subtype: string; attempt?: number; max_retries?: number; retry_delay_ms?: number; error_status?: number | null; status?: string };
        if (sys.subtype === "api_retry") {
          const secs = Math.round((sys.retry_delay_ms ?? 0) / 1000);
          this.emit({ type: "status", message: `API ${sys.error_status ?? "error"} · retry ${sys.attempt}/${sys.max_retries}${secs ? ` in ${secs}s` : ""}`, until: sys.retry_delay_ms ? Date.now() + sys.retry_delay_ms : null });
        } else if (sys.subtype === "status" && sys.status && sys.status !== "idle") {
          this.emit({ type: "status", message: String(sys.status).replace(/_/g, " "), until: null });
        }
        return;
      }
      case "rate_limit_event": {
        const info = (m as unknown as { rate_limit_info: { status: string; resetsAt?: number; rateLimitType?: string; utilization?: number } }).rate_limit_info;
        const windows = claudeRateLimitWindows(info);
        if (windows.length) this.emit({ type: "usage.updated", windows });
        if (info.status === "rejected") this.emit({ type: "status", message: `rate limited${info.resetsAt ? ` · resets ${new Date(info.resetsAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`, until: info.resetsAt ? info.resetsAt * 1000 : null });
        else if (info.status === "allowed_warning") this.emit({ type: "status", message: "close to the rate limit", until: null });
        return;
      }
      case "stream_event": {
        if (m.parent_tool_use_id) return;
        this.beginTurn();
        const ev = m.event as { type: string; delta?: { type: string; text?: string }; content_block?: { type: string } };
        // Text blocks are separated by tool calls; keep them as paragraphs rather than gluing them together.
        if (ev.type === "content_block_start" && ev.content_block?.type === "text" && this.text && !this.text.endsWith("\n\n")) {
          this.text += "\n\n";
          this.emit({ type: "content.delta", delta: "\n\n" });
        }
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
          this.text += ev.delta.text;
          this.emit({ type: "content.delta", delta: ev.delta.text });
        }
        return;
      }
      case "assistant": {
        if (m.parent_tool_use_id) return;
        this.beginTurn();
        for (const block of m.message.content as { type: string; id?: string; name?: string; input?: Record<string, unknown> }[]) {
          if (block.type === "tool_use" && block.id && block.name) {
            const { kind, summary } = describeTool(block.name, block.input ?? {}, this.input.cwd);
            this.toolStart.set(block.id, Date.now());
            this.emit({ type: "item.started", itemId: block.id, kind, summary });
          }
        }
        return;
      }
      case "user": {
        if (m.parent_tool_use_id) return;
        const content = m.message.content;
        if (!Array.isArray(content)) return;
        for (const block of content as { type: string; tool_use_id?: string; content?: unknown; is_error?: boolean }[]) {
          if (block.type !== "tool_result" || !block.tool_use_id) continue;
          const started = this.toolStart.get(block.tool_use_id);
          this.toolStart.delete(block.tool_use_id);
          const detail = typeof block.content === "string" ? block.content : Array.isArray(block.content) ? (block.content as { text?: string }[]).map((c) => c.text ?? "").join("\n") : "";
          this.emit({ type: "item.completed", itemId: block.tool_use_id, summary: "", detail: detail ? truncate(detail) : null, ok: !block.is_error, ms: started ? Date.now() - started : null });
        }
        return;
      }
      case "result": {
        this.beginTurn();
        const r = m as { user_message_uuid?: string; queued_turn_count?: number; num_turns?: number };
        if (r.user_message_uuid && this.unanswered.delete(r.user_message_uuid)) this.echoes = true;
        // A turn the CLI started itself answers none of our sends while one waits behind it: on resume, the notice
        // that an earlier run's background commands stopped comes back as a result without a model call (num_turns 0).
        // Ending the turn there would close the session before the model reads the message. Only on evidence, so a
        // CLI that echoes nothing still ends its turns.
        const selfStarted = !r.user_message_uuid && this.unanswered.size > 0
          && (this.echoes || (r.queued_turn_count ?? 0) > 0 || (m.subtype === "success" && r.num_turns === 0));
        if (selfStarted) { this.text = ""; return; }
        if (r.queued_turn_count === 0) this.unanswered.clear();
        const text = this.text.trim() || (m.subtype === "success" ? m.result : "");
        if (text) this.emit({ type: "content.final", text });
        if (m.subtype !== "success") this.emit({ type: "error", message: `${m.subtype}${"errors" in m && Array.isArray(m.errors) ? ": " + m.errors.join("; ") : ""}`, fatal: false });
        this.emit({ type: "turn.completed", turnId: `turn${this.turn}` });
        this.text = "";
        this.turnOpen = false;
        return;
      }
      default:
        return;
    }
  }

  /** Called on the first frame of a turn. Turn numbers follow the model, so a queued steer is not a turn until it runs. */
  private beginTurn() {
    if (this.turnOpen) return;
    this.turnOpen = true;
    this.turn += 1;
    this.text = "";
    this.emit({ type: "turn.started", turnId: `turn${this.turn}` });
  }

  async send(text: string) {
    if (this.stopped) return;
    if (this.turn === 0 && !this.turnOpen) this.beginTurn();
    else this.emit({ type: "steer.received", text });
    const uuid = randomUUID();
    this.unanswered.add(uuid);
    this.inbox.push({ type: "user", uuid, message: { role: "user", content: text }, parent_tool_use_id: null, session_id: this.sessionId ?? "" } as unknown as SDKUserMessage);
  }
  async interrupt() { try { await this.q.interrupt(); } catch {} }
  async respond(requestId: string, decision: string) {
    const r = this.pending.get(requestId);
    if (!r) return;
    this.pending.delete(requestId);
    this.emit({ type: "request.resolved", requestId, decision });
    r(decision);
  }
  async stop() {
    this.stopped = true;
    for (const [id, r] of this.pending) { r("deny"); this.pending.delete(id); }
    this.inbox.close();
    try { this.q.close(); } catch {}
  }
  resumeCursor() { return this.sessionId ? { sessionId: this.sessionId } : null; }
}

export const claudeAdapter: HarnessAdapter = {
  kind: "claude",
  probe: probeClaude,
  async start(input: StartSession): Promise<Session> {
    const bin = await which("claude");
    if (!bin) throw new Error("Claude Code (`claude`) is not on PATH on this machine. Install it and run `claude auth login`.");
    return new ClaudeSession(input, bin);
  },
};
