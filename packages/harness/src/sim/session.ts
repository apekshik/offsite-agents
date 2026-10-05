import type { RunEvent } from "@offsite/contracts";
import { z } from "zod";
import { basename } from "node:path";
import type { Session, SessionCrew, StartSession } from "../adapter.ts";
import { AsyncQueue } from "../queue.ts";
import { describeTool, mcpName, truncate } from "../tools.ts";
import { between, hash, rng } from "./random.ts";

/** Thrown inside a script when the turn is interrupted or the session stops. */
export class Stopped extends Error { constructor() { super("stopped"); } }

/** What a sim script can do: talk, take steps, call Offsite's tools, ask the captain. Everything shows as real events. */
export interface SimContext {
  /** This turn's random: seeded from the session and the turn's text, so a run replays exactly. */
  r: () => number;
  cwd: string;
  crew: SessionCrew;
  /** This session's turn number, from 1 (it carries on across a resumed session). */
  turn: number;
  /** The first turn this session object runs: the run's own prompt, not a steer. */
  first: boolean;
  /** The text this turn was sent. */
  text: string;
  /** What this session remembers between its turns. */
  memory: Record<string, unknown>;
  say(text: string): Promise<void>;
  /** Pause between steps, in seconds of sim time. */
  think(lo: number, hi: number): Promise<void>;
  /** A tool step: item.started, the work, at least `seconds` of sim time, item.completed. */
  step<T extends { detail?: string | null; ok?: boolean }>(kind: string, summary: string, seconds: [number, number], work?: () => Promise<T>): Promise<T | undefined>;
  hasTool(name: string): boolean;
  /** Call one of Offsite's tools as a step. Returns its text; throws its error. */
  tool(name: string, args: Record<string, unknown>): Promise<string>;
  /** request.opened, then wait for the captain. */
  ask(kind: "approval" | "input", prompt: string, options: string[] | null): Promise<string>;
}

export type SimScript = (ctx: SimContext) => Promise<void>;

/**
 * A harness with no CLI behind it. Turns run a script that streams words, takes steps with believable timing, edits
 * real files in the worktree, calls the real Offsite tools, and waits on the captain like any agent. timeScale
 * shrinks every pause (tests use ~0).
 */
export class SimSession implements Session {
  readonly events = new AsyncQueue<RunEvent>();
  private readonly queue: string[] = [];
  private readonly pending = new Map<string, (decision: string) => void>();
  private readonly wakers = new Set<() => void>();
  private readonly memory: Record<string, unknown> = {};
  private readonly input: StartSession;
  private readonly script: SimScript;
  private readonly seed: number;
  private readonly scale: number;
  private readonly sessionId: string;
  private running = false;
  private aborted = false;
  private stopped = false;
  private turn: number;
  private readonly firstTurn: number;
  private text = "";
  private items = 0;
  private asks = 0;

  constructor(input: StartSession, script: SimScript, opts: { seed: number; timeScale: number }) {
    this.input = input;
    this.script = script;
    this.scale = Math.max(0, opts.timeScale);
    const prior = z.object({ sim: z.string(), turns: z.number() }).safeParse(input.resumeCursor);
    this.seed = hash(`${opts.seed}:${input.crew.handle}:${basename(input.cwd)}:${input.kind}`);
    this.sessionId = prior.success ? prior.data.sim : `sim-${this.seed.toString(36)}`;
    this.turn = prior.success ? prior.data.turns : 0;
    this.firstTurn = this.turn + 1;
    queueMicrotask(() => this.emit({ type: "session.started", resumeCursor: this.resumeCursor() }));
  }

  private emit(e: RunEvent) { if (!this.stopped) this.events.push(e); }
  private check() { if (this.aborted || this.stopped) throw new Stopped(); }

  private sleep(seconds: number): Promise<void> {
    this.check();
    const ms = seconds * 1000 * this.scale;
    return new Promise((resolve, reject) => {
      const wake = () => { clearTimeout(timer); this.wakers.delete(wake); reject(new Stopped()); };
      const timer = setTimeout(() => { this.wakers.delete(wake); resolve(); }, ms);
      this.wakers.add(wake);
    });
  }

  async send(text: string) {
    if (this.stopped) return;
    if (this.running || this.queue.length) this.emit({ type: "steer.received", text });
    this.queue.push(text);
    void this.drain();
  }

  private async drain() {
    if (this.running || this.stopped) return;
    const text = this.queue.shift();
    if (text === undefined) return;
    this.running = true;
    this.aborted = false;
    try { await this.runTurn(text); }
    finally { this.running = false; void this.drain(); }
  }

  private async runTurn(text: string) {
    this.turn += 1;
    this.text = "";
    const turnId = `sim-turn${this.turn}`;
    this.emit({ type: "turn.started", turnId });
    const r = rng(hash(`${this.seed}:${this.turn}:${text}`));
    const ctx: SimContext = {
      r, cwd: this.input.cwd, crew: this.input.crew, turn: this.turn, first: this.turn === this.firstTurn, text, memory: this.memory,
      say: (t) => this.say(t, r),
      think: (lo, hi) => this.sleep(between(r, lo, hi)),
      step: (kind, summary, seconds, work) => this.step(kind, summary, seconds, r, work),
      hasTool: (name) => this.input.tools.some((t) => t.name === name),
      tool: (name, args) => this.tool(name, args, r),
      ask: (kind, prompt, options) => this.ask(kind, prompt, options),
    };
    try {
      await this.script(ctx);
    } catch (e) {
      if (!(e instanceof Stopped)) this.emit({ type: "error", message: `sim: ${(e as Error).message}`, fatal: true });
    }
    if (this.text.trim()) this.emit({ type: "content.final", text: this.text.trim() });
    this.emit({ type: "turn.completed", turnId });
  }

  /** Stream words in small bursts, as a model does. A new say after a step starts a new paragraph. */
  private async say(text: string, r: () => number) {
    this.check();
    if (this.text && !this.text.endsWith("\n\n")) { this.text += "\n\n"; this.emit({ type: "content.delta", delta: "\n\n" }); }
    const words = text.split(/(?<=\s)/);
    for (let i = 0; i < words.length;) {
      const n = 1 + Math.floor(r() * 4);
      const chunk = words.slice(i, i + n).join("");
      i += n;
      this.text += chunk;
      this.emit({ type: "content.delta", delta: chunk });
      await this.sleep(between(r, 0.04, 0.14));
    }
  }

  private async step<T extends { detail?: string | null; ok?: boolean }>(kind: string, summary: string, seconds: [number, number], r: () => number, work?: () => Promise<T>): Promise<T | undefined> {
    this.check();
    const itemId = `sim-item${++this.items}`;
    const started = Date.now();
    this.emit({ type: "item.started", itemId, kind, summary });
    let result: T | undefined;
    let ok = true;
    let detail: string | null = null;
    try {
      [result] = await Promise.all([work?.(), this.sleep(between(r, seconds[0], seconds[1]))]);
      ok = result?.ok ?? true;
      detail = result?.detail ?? null;
    } catch (e) {
      if (e instanceof Stopped) { this.emit({ type: "item.completed", itemId, summary, detail: "interrupted", ok: false, ms: Date.now() - started }); throw e; }
      ok = false; detail = (e as Error).message;
      this.emit({ type: "item.completed", itemId, summary, detail: truncate(detail), ok, ms: Date.now() - started });
      throw e;
    }
    this.emit({ type: "item.completed", itemId, summary, detail: detail ? truncate(detail) : null, ok, ms: Date.now() - started });
    return result;
  }

  private async tool(name: string, args: Record<string, unknown>, r: () => number): Promise<string> {
    const t = this.input.tools.find((x) => x.name === name);
    if (!t) throw new Error(`no tool ${name}`);
    const { kind, summary } = describeTool(mcpName(name), args, this.input.cwd);
    const out = await this.step(kind, summary, [0.6, 1.8], r, async () => {
      const text = await t.run(z.object(t.args).parse(args) as Record<string, unknown>);
      return { detail: text, text };
    });
    return out?.text ?? "";
  }

  private async ask(kind: "approval" | "input", prompt: string, options: string[] | null): Promise<string> {
    this.check();
    const requestId = `sim-${this.sessionId}-${this.turn}-${++this.asks}`;
    this.emit({ type: "request.opened", requestId, kind, prompt, options });
    const decision = await new Promise<string>((resolve) => this.pending.set(requestId, resolve));
    this.check();
    return decision;
  }

  async respond(requestId: string, decision: string) {
    const r = this.pending.get(requestId);
    if (!r) return;
    this.pending.delete(requestId);
    this.emit({ type: "request.resolved", requestId, decision });
    r(decision);
  }

  async interrupt() {
    this.aborted = true;
    this.queue.length = 0;
    for (const [id, r] of this.pending) { this.pending.delete(id); this.emit({ type: "request.resolved", requestId: id, decision: "cancel" }); r("deny"); }
    for (const wake of [...this.wakers]) wake();
  }

  async stop() {
    await this.interrupt();
    this.stopped = true;
    this.events.close();
  }

  resumeCursor() { return { sim: this.sessionId, turns: this.turn }; }
}
