// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Harness, RunEvent } from "@offsite/contracts";
import { resolveProfile, type HarnessAdapter, type OffsiteTool, type Session } from "@offsite/harness";
import {
  allocatePort, commitAll, conflictMarkers, detachWorktree, ensureComputerDir, ensureTaskWorktree, ensureThreadBranch, ensureThreadWorktree, expandHome, landTask,
  openRepo, prepareConflict, releasePort, runSetup, serialized, taskBranchName, taskStats, taskWorktreePath, threadBranchName, threadRepoWorktreePath,
  threadViewRef, threadWorktreePath,
} from "@offsite/git";
import { readable, type Backend, type LiveRun, type Outcome, type RepoInfo, type RunContext, type Work } from "./backend.ts";
import { offsiteHome } from "./config.ts";
import { EventSink } from "./events.ts";
import { LOOK_SYSTEM_PROMPT, parseLook } from "./lookPrompt.ts";
import { computerPrompt, conflictSteer, crewPrompt, markersLeftSteer, taskMessage } from "./prompts.ts";
import { Accounts, stripAttribution } from "./report.ts";
import { computerTools, crewTools, type AwaitAnswer } from "./tools.ts";
import { Reviews } from "./reviews.ts";
import { Folders } from "./folders.ts";

export interface RunnerOptions {
  backend: Backend;
  adapters: Record<Harness, HarnessAdapter>;
  /** Every crew member runs on the sim, whatever their harness: `offsite start --sim`. */
  sim?: boolean;
  /** Runs at once on this machine. */
  concurrency?: number;
  /** The captain's name, for the computer's prompt. */
  captain?: string;
  log?: (line: string) => void;
  setupTimeoutMs?: number;
  /** A harness that says nothing this long, with nobody being asked anything, is treated as hung. */
  silenceMs?: number;
  /** How many times a task tries to land through conflicts before it gives up. */
  landAttempts?: number;
}

/** How long a shutting-down runner waits for its runs to commit and finish. */
export const SHUTDOWN_MS = 45_000;

/**
 * Watches this machine's work and hosts each run to its end: claim, a worktree, the crew member's harness with the
 * right tools, events to the ship, messages and answers back to the agent, and, for a task, a commit landed on the
 * thread's branch. A run always ends with a commit of whatever it changed, even when it fails or is stopped.
 */
export class Runner {
  private readonly hosted = new Map<string, HostedRun>();
  private readonly claiming = new Set<string>();
  private readonly skipped = new Map<string, number>();
  private readonly opts: RunnerOptions;
  private unsubscribe: (() => void) | null = null;
  private reviews: Reviews | null = null;
  private folders: Folders | null = null;
  private work: Work | null = null;
  private closing = false;

  constructor(opts: RunnerOptions) { this.opts = opts; }
  private get log() { return this.opts.log ?? ((l: string) => console.log(l)); }
  get active(): string[] { return [...this.hosted.keys()]; }
  /** Resolves when every run this process is hosting has finished. */
  idle(): Promise<void> { return Promise.allSettled([...this.hosted.values()].map((r) => r.done)).then(() => {}); }

  start(): void {
    this.unsubscribe = this.opts.backend.watchWork((w) => this.onWork(w), (e) => this.log(`work subscription: ${readable(e)}`));
    // Diffs and "Open in editor" the captain asks for, alongside the runs.
    if (this.opts.backend.reviews) {
      this.reviews = new Reviews({ backend: this.opts.backend.reviews, log: (l) => this.log(l) });
      this.reviews.start();
    }
    // Repo scans and folder listings, for adding repos from the app.
    if (this.opts.backend.folders) {
      this.folders = new Folders({ backend: this.opts.backend.folders, log: (l) => this.log(l) });
      this.folders.start();
    }
  }

  private onWork(w: Work) {
    this.work = w;
    for (const live of w.live) this.hosted.get(live.runId)?.control(live);
    this.claimNext();
  }

  private claimNext() {
    if (this.closing || !this.work) return;
    const limit = this.opts.concurrency ?? 6;
    for (const q of this.work.queued) {
      if (this.hosted.size + this.claiming.size >= limit) return;
      if (this.hosted.has(q.runId) || this.claiming.has(q.runId)) continue;
      if ((this.skipped.get(q.runId) ?? 0) > Date.now()) continue;
      this.claiming.add(q.runId);
      void this.opts.backend.claim(q.runId).then(
        (ctx) => { if (ctx) this.host(ctx); else this.skipped.set(q.runId, Date.now() + 30_000); },
        (e) => { this.skipped.set(q.runId, Date.now() + 30_000); this.log(`could not claim ${q.runId.slice(-6)}: ${readable(e)}`); },
      ).finally(() => { this.claiming.delete(q.runId); this.claimNext(); });
    }
  }

  private host(ctx: RunContext) {
    const run = new HostedRun(ctx, this.opts);
    this.hosted.set(ctx.run.id, run);
    const live = this.work?.live.find((l) => l.runId === ctx.run.id);
    if (live) run.control(live);
    run.done = run.host().catch((e) => this.log(`[${ctx.run.id.slice(-6)}] crashed: ${(e as Error).stack ?? e}`))
      .finally(() => { this.hosted.delete(ctx.run.id); this.claimNext(); });
  }

  /**
   * Stop taking work, stop every agent the way a stop from the ship does (their work is committed on their own
   * branch, and runs already landing finish landing), and wait at most `ms`. Resolves with the runs still going.
   */
  async stop(ms = SHUTDOWN_MS): Promise<string[]> {
    this.closing = true;
    this.unsubscribe?.();
    void this.reviews?.stop();
    void this.folders?.stop();
    for (const run of this.hosted.values()) run.shutdown();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([this.idle(), new Promise<void>((r) => { timer = setTimeout(r, ms); })]);
    clearTimeout(timer);
    return this.active;
  }
}

/** A repo opened on this machine: its name on the ship, its checkout's top folder, its default branch. */
export interface LocalRepo { name: string; path: string; defaultBranch: string }

/** Where a run works. */
interface Place {
  cwd: string;
  /** A task's repo (its checkout's top folder). */
  repo: string | null;
  /** The computer's: every repo on this machine, each a folder in its working directory. */
  repos: LocalRepo[];
  threadBranch?: string;
  taskBranch?: string;
  /** The computer's worktree of the task's repo, refreshed when the task lands. */
  threadWorktree?: string;
  /** A new task worktree: run its repo's setup command in it. */
  fresh: boolean;
  setupCommand: string | null;
  port: number | null;
}

/** The ship's repos from a claim; one made from the legacy fields when the ship's backend predates repos. */
export function reposOf(ctx: RunContext): RepoInfo[] {
  if (ctx.office.repos?.length) return ctx.office.repos;
  if (!ctx.office.repoPath) return [];
  const name = basename(ctx.office.repoPath.replace(/[\\/]+$/, "")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "repo";
  return [{ id: null, name, path: ctx.office.repoPath, defaultBranch: ctx.office.defaultBranch, setupCommand: ctx.office.setupCommand, here: true }];
}

const short = (id: string) => id.slice(-6);

class HostedRun {
  done: Promise<void> = Promise.resolve();
  private readonly ctx: RunContext;
  private readonly opts: RunnerOptions;
  private readonly id: string;
  private readonly sink: EventSink;
  private session: Session | null = null;
  private phase: "preparing" | "working" | "landing" | "finishing" = "preparing";
  private openTurns = 0;
  private streamEnded = false;
  private outcome: Outcome | null = null;
  private error: string | null = null;
  private readonly wakers: (() => void)[] = [];
  private readonly held: { id: string; text: string }[] = [];
  private readonly seenInbox = new Set<string>();
  private readonly seenAnswers = new Set<string>();
  private readonly waiting = new Map<string, { resolve: (a: string) => void; reject: (e: Error) => void }>();
  /** ask_captain answers that came before the tool started waiting, by question id. */
  private readonly early = new Map<string, string>();
  /** Requests the harness opened (approvals, its own questions), whose answers go back to it by request id. */
  private readonly harnessRequests = new Set<string>();
  private openRequests = 0;
  private lastEventAt = Date.now();
  private tail = "";
  private final = "";
  /** This turn's reply as streamed so far, and the part of it before the latest step (already its own message). */
  private turnText = "";
  private closed = "";
  /** What the agent said at the end of each turn: a crew member's report. */
  private readonly accounts = new Accounts();

  constructor(ctx: RunContext, opts: RunnerOptions) {
    this.ctx = ctx; this.opts = opts; this.id = ctx.run.id;
    this.sink = new EventSink((events) => opts.backend.events(this.id, events), { log: (m) => this.log(m) });
  }

  private log(line: string) {
    const c = this.ctx;
    (this.opts.log ?? ((l: string) => console.log(l)))(`[${short(this.id)}] ${c.crew.name}${c.task ? ` · ${c.task.key}` : c.run.kind === "computer" ? " · computer" : ` · ${c.run.kind}`}: ${line}`);
  }
  private emit(e: RunEvent) { this.sink.push(e); }
  private wake() { for (const w of this.wakers.splice(0)) w(); }
  private get harness(): Harness { return this.opts.sim ? "sim" : this.ctx.crew.harness; }

  // ---- control from the ship: stops, messages, answers ----

  control(live: LiveRun) {
    if (live.interruptRequested && !this.outcome) this.stop("interrupted", null, "the captain stopped this run");
    const inboxIds: string[] = [];
    for (const m of live.inbox) {
      if (this.seenInbox.has(m.id)) continue;
      this.seenInbox.add(m.id);
      inboxIds.push(m.id);
      if (this.phase === "working" && this.session && !this.outcome) void this.send(m.text);
      else this.held.push(m);
    }
    const questionIds: string[] = [];
    for (const a of live.answers) {
      if (this.seenAnswers.has(a.questionId)) continue;
      this.seenAnswers.add(a.questionId);
      questionIds.push(a.questionId);
      const waiter = this.waiting.get(a.questionId);
      if (waiter) { this.waiting.delete(a.questionId); waiter.resolve(a.answer); }
      else if (this.harnessRequests.has(a.requestId)) void this.session?.respond(a.requestId, a.answer).catch((e) => this.stop("failed", `could not hand the captain's answer to ${this.harness}: ${(e as Error).message}`));
      else this.early.set(a.questionId, a.answer);
    }
    if (inboxIds.length || questionIds.length) {
      void this.opts.backend.delivered({ inboxIds, questionIds }).catch((e) => this.log(`delivered: ${readable(e)}`));
    }
  }

  private readonly awaitAnswer: AwaitAnswer = (q) => new Promise<string>((resolve, reject) => {
    if (this.outcome) { reject(new Error("This run has stopped")); return; }
    const early = this.early.get(q.questionId);
    if (early !== undefined) { this.early.delete(q.questionId); resolve(early); return; }
    this.waiting.set(q.questionId, { resolve, reject });
    this.wake();
  });

  /** End the agent's work early: interrupted by the captain, failed, or the runner going away. */
  private stop(outcome: Outcome, error: string | null, why?: string) {
    if (this.outcome) return;
    this.outcome = outcome; this.error = error;
    this.log(why ?? error ?? outcome);
    if (error) this.emit({ type: "error", message: error, fatal: true });
    for (const [id, w] of this.waiting) { this.waiting.delete(id); w.reject(new Error("This run has stopped")); }
    // Ask nicely, then stop waiting: a hung harness never answers an interrupt.
    const deadline = setTimeout(() => { this.streamEnded = true; this.wake(); }, 10_000);
    deadline.unref();
    void (this.session?.interrupt() ?? Promise.resolve()).catch(() => {}).finally(() => { clearTimeout(deadline); this.wake(); });
    this.wake();
  }

  /** The runner is shutting down. Runs already landing finish; the rest stop with their work committed. */
  shutdown() {
    if (this.phase === "landing" || this.phase === "finishing") return;
    const where = this.ctx.task ? " The work so far is committed on its branch; sending the task back picks it up there." : "";
    this.stop("failed", `The runner on this machine shut down before this finished.${where}`);
  }

  // ---- talking to the agent ----

  private async send(text: string) {
    if (!this.session || this.outcome) return;
    this.openTurns += 1;
    try { await this.session.send(text); }
    catch (e) { this.openTurns -= 1; this.stop("failed", `could not reach ${this.harness}: ${(e as Error).message}`); }
  }
  private flushHeld() { for (const m of this.held.splice(0)) void this.send(m.text); }

  /** Resolves when the agent has nothing left to do: every turn answered, or it stopped, or the run ended. */
  private waitIdle(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.streamEnded || this.outcome || (this.openTurns <= 0 && !this.held.length)) resolve();
        else this.wakers.push(check);
      };
      check();
    });
  }

  private async pump(session: Session) {
    try {
      for await (let e of session.events) {
        this.lastEventAt = Date.now();
        switch (e.type) {
          case "turn.started": this.tail = ""; this.turnText = ""; this.closed = ""; break;
          case "item.started": this.tail = ""; this.closed = this.turnText; break;
          case "content.delta": this.tail += e.delta; this.turnText += e.delta; break;
          case "content.final": this.final = e.text; e = { type: "content.final", text: this.closingParagraph(e.text) }; break;
          case "request.opened": this.openRequests += 1; this.harnessRequests.add(e.requestId); break;
          case "request.resolved": this.openRequests = Math.max(0, this.openRequests - 1); break;
          case "turn.completed": this.openTurns = Math.max(0, this.openTurns - 1); break;
          case "error": if (e.fatal) this.stop("failed", e.message); break;
        }
        this.accounts.push(e);
        // A fatal error is emitted by stop() itself, once.
        if (!(e.type === "error" && e.fatal)) this.emit(e);
        this.wake();
      }
    } finally {
      this.streamEnded = true;
      this.wake();
    }
  }

  /**
   * A harness's final text is the whole turn. The ship already has the paragraphs before the latest step as their own
   * messages (a step closes one), so only the closing paragraph goes with content.final.
   */
  private closingParagraph(full: string): string {
    const text = full.trim(), before = this.closed.trim();
    let out = text;
    if (before && text.startsWith(before)) out = text.slice(before.length).trim();
    else if (before) out = (this.turnText.startsWith(this.closed) ? this.turnText.slice(this.closed.length) : this.turnText).trim();
    this.turnText = full;
    return out;
  }

  // ---- the run ----

  async host(): Promise<void> {
    const { ctx } = this;
    let place: Place | null = null;
    try {
      place = await this.prepare();
      await this.opts.backend.started(this.id, place.cwd, place.threadBranch, place.taskBranch);
      this.log(`working in ${place.cwd}${place.taskBranch ? ` on ${place.taskBranch}` : ""} (${this.harness})`);
      if (place.fresh && place.setupCommand && ctx.run.kind === "task") await this.setup(place.cwd, place.setupCommand, place.port);
      if (!this.outcome) await this.startSession(place);
    } catch (e) {
      this.stop("failed", readable(e));
    }

    let landed = false;
    if (this.session && !this.outcome) {
      this.phase = "working";
      const watchdog = setInterval(() => this.watch(), 30_000);
      try {
        if (ctx.run.kind === "look") await this.designLook();
        else {
          await this.send(ctx.run.kind === "task" ? taskMessage(ctx) : ctx.run.prompt);
          this.flushHeld();
          if (ctx.run.kind === "task" && place) landed = await this.workAndLand(place);
          else await this.workUntilIdle();
        }
      } catch (e) {
        this.stop("failed", readable(e));
      } finally {
        clearInterval(watchdog);
      }
    }
    await this.finish(place, landed);
  }

  /**
   * The run's worktree and branches. The computer: a folder holding a worktree of the thread's branch for each repo on
   * this machine, side by side. A task: its own worktree and branch in its repo, from the thread's branch there (made
   * the first time a task starts in that repo). A look: a scratch folder.
   */
  private async prepare(): Promise<Place> {
    const { ctx } = this;
    if (ctx.run.kind === "look") {
      const cwd = join(offsiteHome(), "looks", this.id);
      await mkdir(cwd, { recursive: true });
      return { cwd, repo: null, repos: [], fresh: false, setupCommand: null, port: null };
    }
    const repos = reposOf(ctx);
    if (!repos.length) throw new Error("This ship has no repo yet. Add one (a folder on this machine) in the app.");
    if (!ctx.thread) throw new Error("This run has no thread");
    const thread = ctx.thread;
    const threadBranch = thread.branch ?? threadBranchName(thread.title, thread.id);

    if (ctx.run.kind === "computer" || !ctx.task) {
      const cwd = await ensureComputerDir(threadWorktreePath(ctx.office.id, thread.id));
      const local: LocalRepo[] = [];
      for (const r of repos.filter((x) => x.here)) {
        try {
          const top = await openRepo(expandHome(r.path));
          // Serialized with landings in that repo, which refresh this view.
          await serialized(`${top}#${threadBranch}`, async () => {
            await ensureThreadWorktree(top, threadRepoWorktreePath(ctx.office.id, thread.id, r.name), await threadViewRef(top, threadBranch, r.defaultBranch));
          });
          local.push({ name: r.name, path: top, defaultBranch: r.defaultBranch });
        } catch (e) {
          // One missing checkout shouldn't stop the computer from planning in the others.
          this.emit({ type: "error", message: `The repo "${r.name}" isn't readable here: ${readable(e)}`, fatal: false });
          this.log(`repo ${r.name}: ${readable(e)}`);
        }
      }
      if (!local.length) throw new Error(`None of this ship's repos could be opened on this machine (${repos.map((r) => `${r.name}: ${r.path}`).join(", ")}).`);
      return { cwd, repo: null, repos: local, threadBranch, fresh: false, setupCommand: null, port: null };
    }

    const task = ctx.task;
    const info = task.repo ? repos.find((r) => r.name === task.repo) : repos[0];
    if (!info) throw new Error(`This task's repo "${task.repo}" isn't on this ship any more.`);
    const repo = await openRepo(expandHome(info.path));
    const threadWorktree = threadRepoWorktreePath(ctx.office.id, thread.id, info.name);
    // Two runs of one thread can start together; the branch and worktrees are made one at a time, per repo.
    return serialized(`${repo}#${threadBranch}`, async () => {
      await ensureThreadBranch(repo, threadBranch, info.defaultBranch);
      const taskBranch = task.branch ?? taskBranchName(threadBranch, task.key);
      const { path, created } = await ensureTaskWorktree(repo, taskWorktreePath(ctx.office.id, thread.id, task.key), taskBranch, threadBranch);
      return { cwd: path, repo, repos: [], threadBranch, taskBranch, threadWorktree, fresh: created, setupCommand: info.setupCommand, port: await allocatePort() };
    });
  }

  private async setup(cwd: string, command: string, port: number | null) {
    const itemId = "setup";
    this.emit({ type: "item.started", itemId, kind: "bash", summary: command });
    const r = await runSetup(cwd, command, { timeoutMs: this.opts.setupTimeoutMs, ...(port ? { env: { PORT: String(port) } } : {}) });
    this.emit({ type: "item.completed", itemId, summary: command, detail: r.output.slice(-600) || null, ok: r.ok, ms: r.ms });
    if (!r.ok) {
      this.emit({ type: "error", message: `The setup command ${r.timedOut ? "timed out" : "failed"}; carrying on without it.`, fatal: false });
      this.log(`setup ${r.timedOut ? "timed out" : "failed"}: ${r.output.split("\n").at(-1) ?? ""}`);
    }
  }

  private async startSession(place: Place) {
    const { ctx } = this;
    const adapter = this.opts.adapters[this.harness];
    if (!adapter) throw new Error(`This runner has no ${this.harness} adapter`);
    let tools: OffsiteTool[] = [];
    let systemPrompt = "";
    if (ctx.run.kind === "computer") {
      tools = computerTools(this.opts.backend, this.id, { repos: place.repos, threadBranch: place.threadBranch! }, this.awaitAnswer);
      systemPrompt = computerPrompt(ctx, this.opts.captain ?? "The captain", { threadBranch: place.threadBranch!, cwd: place.cwd, repos: place.repos.map((r) => r.name) });
    } else if (ctx.run.kind === "task") {
      tools = crewTools(this.opts.backend, this.id, { repo: place.repo!, worktree: place.cwd, threadBranch: place.threadBranch!, author: ctx.crew.name }, this.awaitAnswer);
      systemPrompt = crewPrompt(ctx, { cwd: place.cwd, taskBranch: place.taskBranch!, threadBranch: place.threadBranch!, port: place.port });
    } else {
      systemPrompt = LOOK_SYSTEM_PROMPT;
    }
    const h = this.harness;
    const profile = h === "claude" || h === "codex" ? await resolveProfile(h, ctx.crew.profile) : undefined;
    this.session = await adapter.start({
      kind: ctx.run.kind,
      crew: { name: ctx.crew.name, handle: ctx.crew.handle, role: ctx.crew.role, model: this.opts.sim ? null : ctx.crew.model, effort: ctx.crew.effort },
      cwd: place.cwd,
      ...(profile ? { profile } : {}),
      resumeCursor: ctx.run.kind === "look" ? null : ctx.resumeCursor,
      systemPrompt,
      tools,
      ...(place.port ? { env: { PORT: String(place.port) } } : {}),
    });
    void this.pump(this.session);
  }

  /** The silence watchdog: nothing from the harness for a long time, with nobody being asked anything, is a hang. */
  private watch() {
    const limit = this.opts.silenceMs ?? 15 * 60_000;
    if (this.phase !== "working" || this.outcome || this.openRequests > 0 || this.waiting.size > 0) return;
    if (Date.now() - this.lastEventAt > limit) this.stop("failed", `${this.harness} produced nothing for ${Math.round(limit / 60_000)} minutes; the run was ended`);
  }

  /** The computer: answer every turn, including messages that arrive while it works. */
  private async workUntilIdle() {
    for (;;) {
      await this.waitIdle();
      if (this.outcome || this.streamEnded || !this.held.length) return;
      this.flushHeld();
    }
  }

  /** A task: work, then land; a conflict goes back to the same crew member to resolve, then it lands again. */
  private async workAndLand(place: Place): Promise<boolean> {
    let announced = false;
    let landed = false;
    for (;;) {
      await this.waitIdle();
      if (this.outcome) return landed;
      if (this.streamEnded) { this.stop("failed", `${this.harness} ended the session before finishing`); return landed; }
      if (this.held.length) { this.flushHeld(); continue; }
      this.phase = "landing";
      if (!announced) { announced = true; await this.opts.backend.landing(this.id); }
      const r = await this.land(place);
      if (!r.ok) { this.stop("failed", r.error); return landed; }
      landed = true;
      this.phase = "working";
      // Messages that came in while it landed: a new turn, then land what it did.
      if (!this.held.length) return landed;
      this.flushHeld();
    }
  }

  private commitMessage(): string {
    const report = this.report();
    return stripAttribution(`${this.ctx.task!.title}\n\n${report ? report.slice(0, 1500) : ""}`.trim());
  }

  private async land(place: Place): Promise<{ ok: true } | { ok: false; error: string }> {
    const attempts = this.opts.landAttempts ?? 3;
    const author = this.ctx.crew.name;
    for (let i = 0; i < attempts; i++) {
      this.emit({ type: "status", message: `Landing on ${place.threadBranch}`, until: null });
      const r = await landTask({ repo: place.repo!, threadBranch: place.threadBranch!, taskBranch: place.taskBranch!, worktree: place.cwd, message: this.commitMessage(), author, threadWorktree: place.threadWorktree });
      if (r.ok) {
        this.log(r.empty ? "nothing to land" : `landed ${r.sha.slice(0, 8)} on ${place.threadBranch}`);
        await this.sink.flush();
        return { ok: true };
      }
      this.log(`conflict in ${r.conflict.join(", ")}`);
      const files = await prepareConflict(place.cwd, place.threadBranch!, author);
      if (!files.length) continue;
      this.phase = "working";
      await this.send(conflictSteer(files, place.threadBranch!));
      await this.waitIdle();
      if (this.outcome || this.streamEnded) return { ok: false, error: this.error ?? "stopped while resolving a conflict" };
      let left = await conflictMarkers(place.cwd, files);
      if (left.length) {
        await this.send(markersLeftSteer(left));
        await this.waitIdle();
        left = await conflictMarkers(place.cwd, files);
        if (left.length) return { ok: false, error: `Conflict markers are still in ${left.join(", ")}; the work is on ${place.taskBranch}.` };
      }
      this.phase = "landing";
    }
    return { ok: false, error: `Could not land on ${place.threadBranch} after ${attempts} tries; teammates kept landing over the same lines. The work is on ${place.taskBranch}.` };
  }

  /** A look: one designed look as JSON Lines, checked against contracts Look; one retry with the reason. */
  private async designLook() {
    await this.send(this.ctx.run.prompt);
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.waitIdle();
      if (this.outcome) return;
      const parsed = parseLook(this.final || this.tail);
      if (parsed.ok) {
        await this.opts.backend.lookResult(this.id, parsed.look);
        this.final = parsed.say ?? `Designed ${parsed.look.meta.name ?? "a look"}.`;
        this.tail = "";
        this.accounts.replace(this.final);
        return;
      }
      if (attempt === 0) await this.send(`That look didn't fit the format: ${parsed.error}. Send the whole look again as JSON Lines: the meta line, every piece, then {"t":"done"}.`);
      else this.stop("failed", `The designed look didn't fit the format: ${parsed.error}`);
    }
  }

  /**
   * A crew member's report: what they said at the end of each turn, the reply to the brief first, then their replies
   * to steers. A short answer to a late message never replaces the main account.
   */
  private report(): string { return this.accounts.report(8000); }

  private async finish(place: Place | null, landed: boolean) {
    this.phase = "finishing";
    const { ctx } = this;
    const session = this.session;
    if (session) await Promise.race([session.stop().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
    // A run always ends with a commit of whatever it changed, landed or not.
    if (ctx.run.kind === "task" && place?.taskBranch && !landed) {
      await commitAll(place.cwd, `${ctx.task!.title} (work in progress)`, ctx.crew.name)
        .then((c) => c.committed && this.log(`committed work in progress on ${place.taskBranch}`))
        .catch((e) => this.log(`could not commit: ${(e as Error).message}`));
    }
    // Done with the branch here: leave the worktree detached, so the branch isn't held checked out. The worktree stays
    // for a send-back, which checks the branch out again.
    if (ctx.run.kind === "task" && place?.taskBranch) {
      await detachWorktree(place.cwd).catch(() => false);
    }
    if (place?.port) releasePort(place.port);
    await this.sink.flush();
    const outcome: Outcome = this.outcome ?? (ctx.run.kind === "task" && !landed ? "failed" : "landed");
    const report = ctx.run.kind === "computer" ? undefined : this.report() || undefined;
    const error = this.error ?? (outcome === "failed" ? "The run ended without landing" : undefined);
    // A landed task's size, for the captain's reports and the delivered desk: what its landed commits changed.
    const diff = landed && place?.repo && place.threadBranch && place.taskBranch
      ? await taskStats({ repo: place.repo, threadBranch: place.threadBranch, taskBranch: place.taskBranch }).catch(() => null)
      : null;
    for (let i = 0; ; i++) {
      try { await this.opts.backend.finish(this.id, outcome, { ...(error && outcome !== "landed" ? { error } : {}), ...(report ? { report } : {}), ...(diff ? { diff } : {}) }); break; }
      catch (e) {
        if (i >= 3) { this.log(`could not report the finish: ${readable(e)}`); break; }
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
    this.log(`finished: ${outcome}${error && outcome !== "landed" ? ` (${error})` : ""}`);
  }
}
