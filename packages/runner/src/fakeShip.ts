import type { Look, RunEvent, RunKind } from "@offsite/contracts";
import type { Backend, LiveRun, Outcome, RepoInfo, ReviewInfo, RunContext, ShipStatus, ThreadPr, Work } from "./backend.ts";

// An in-memory ship that follows the backend's rules (convex/runner.ts, tools.ts, flow.ts) closely enough to drive
// the runner end to end in tests: threads wake the computer, plans become tasks, tasks start when their dependencies
// land and someone is free, and every landing wakes the computer again.

interface Crew { id: string; name: string; handle: string; role: "computer" | "crew"; harness: "sim" | "claude" | "codex" }
interface Thread { id: string; title: string; branch: string | null; state: string; prUrl: string | null; prs: ThreadPr[]; finished: { title: string; summary: string } | null }
interface Task { id: string; threadId: string; key: string; repo: string; title: string; brief: string; dependsOn: string[]; assignee: string | null; state: string; branch: string | null; report: string | null; notes: string | null }
interface Run { id: string; kind: RunKind; threadId: string | null; taskId: string | null; crewId: string; state: string; prompt: string; interrupt: boolean; error: string | null; report: string | null; worktree: string | null }
interface Question { id: string; runId: string; requestId: string; prompt: string; answer: string | null; delivered: boolean }

export class FakeShip implements Backend {
  readonly crew: Crew[] = [{ id: "crew-computer", name: "Computer", handle: "computer", role: "computer", harness: "sim" }];
  readonly threads: Thread[] = [];
  readonly tasks: Task[] = [];
  readonly runs: Run[] = [];
  readonly eventLog = new Map<string, RunEvent[]>();
  readonly batches: RunEvent[][] = [];
  readonly inbox: { id: string; crewId: string; runId: string | null; text: string; delivered: boolean }[] = [];
  readonly questions: Question[] = [];
  readonly looks = new Map<string, Look>();
  readonly calls: string[] = [];
  /** Answers every question the moment it is asked, if set. */
  autoAnswer: ((q: Question) => string | null) | null = null;
  private n = 0;
  private listeners: ((w: Work) => void)[] = [];
  private readonly office: RunContext["office"];

  /** One repo (its path), or several: { name, path, setupCommand?, here? }. */
  constructor(repos: string | { name: string; path: string; setupCommand?: string | null; here?: boolean }[], opts: { crew?: string[]; setupCommand?: string | null } = {}) {
    const list: RepoInfo[] = typeof repos === "string"
      ? [{ id: "repo1", name: "app", path: repos, defaultBranch: "main", setupCommand: opts.setupCommand ?? null, here: true }]
      : repos.map((r, i) => ({ id: `repo${i + 1}`, name: r.name, path: r.path, defaultBranch: "main", setupCommand: r.setupCommand ?? null, here: r.here ?? true }));
    this.office = { id: "office1", name: "Sea Legs", repos: list, repoPath: list[0]!.path, defaultBranch: "main", setupCommand: list[0]!.setupCommand };
    for (const name of opts.crew ?? ["Juniper", "Otis"]) this.hire(name);
  }

  private id(prefix: string) { return `${prefix}${String(++this.n).padStart(6, "0")}`; }
  hire(name: string): Crew {
    const c: Crew = { id: this.id("crew"), name, handle: name.toLowerCase(), role: "crew", harness: "sim" };
    this.crew.push(c);
    return c;
  }
  private notify() {
    const w = this.work();
    queueMicrotask(() => { for (const l of this.listeners) l(w); });
  }

  // ---- the captain's side ----

  createThread(text: string): Thread {
    const t: Thread = { id: this.id("thread"), title: text.split(/\s+/).slice(0, 6).join(" "), branch: null, state: "open", prUrl: null, prs: [], finished: null };
    this.threads.push(t);
    this.queueComputer(t, text);
    return t;
  }
  answer(questionId: string, answer: string) {
    const q = this.questions.find((x) => x.id === questionId)!;
    q.answer = answer;
    this.notify();
  }
  requestInterrupt(runId: string) { this.runs.find((r) => r.id === runId)!.interrupt = true; this.notify(); }
  queueLook(crewId: string, description: string): Run {
    const r: Run = { id: this.id("run"), kind: "look", threadId: null, taskId: null, crewId, state: "queued", prompt: description, interrupt: false, error: null, report: null, worktree: null };
    this.runs.push(r);
    this.notify();
    return r;
  }

  private queueComputer(thread: Thread, prompt: string) {
    const live = this.runs.find((r) => r.threadId === thread.id && r.crewId === "crew-computer" && ["queued", "starting", "working"].includes(r.state));
    if (live?.state === "queued") live.prompt += `\n\n${prompt}`;
    else if (live) this.inbox.push({ id: this.id("inbox"), crewId: "crew-computer", runId: live.id, text: prompt, delivered: false });
    else this.runs.push({ id: this.id("run"), kind: "computer", threadId: thread.id, taskId: null, crewId: "crew-computer", state: "queued", prompt, interrupt: false, error: null, report: null, worktree: null });
    this.notify();
  }

  private liveRunOf(crewId: string) { return this.runs.find((r) => r.crewId === crewId && ["queued", "starting", "working", "landing"].includes(r.state)); }

  private tick() {
    const busy = new Set<string>();
    for (const task of this.tasks.filter((t) => t.state === "todo")) {
      if (task.dependsOn.some((d) => this.tasks.find((t) => t.id === d)?.state !== "landed")) continue;
      let who = task.assignee ? this.crew.find((c) => c.id === task.assignee)! : null;
      if (!who) {
        who = this.crew.find((c) => c.role === "crew" && !busy.has(c.id) && !this.liveRunOf(c.id)) ?? this.hire(`Hire${this.n}`);
        task.assignee = who.id;
      }
      if (busy.has(who.id) || this.liveRunOf(who.id)) continue;
      busy.add(who.id);
      task.state = "doing";
      this.runs.push({ id: this.id("run"), kind: "task", threadId: task.threadId, taskId: task.id, crewId: who.id, state: "queued", prompt: task.notes ? `${task.brief}\n\nNotes from the computer on your last attempt:\n${task.notes}` : task.brief, interrupt: false, error: null, report: null, worktree: null });
    }
    this.notify();
  }

  // ---- Backend ----

  async hello() { return { machineId: "machine1", owner: { name: "Ada" } }; }

  work(): Work {
    const live: LiveRun[] = this.runs.filter((r) => ["starting", "working", "landing"].includes(r.state)).map((r) => ({
      runId: r.id, state: r.state, interruptRequested: r.interrupt,
      inbox: this.inbox.filter((m) => m.runId === r.id && !m.delivered).map((m) => ({ id: m.id, text: m.text })),
      answers: this.questions.filter((q) => q.runId === r.id && q.answer !== null && !q.delivered).map((q) => ({ questionId: q.id, requestId: q.requestId, answer: q.answer! })),
    }));
    return { machineId: "machine1", queued: this.runs.filter((r) => r.state === "queued").map((r) => ({ runId: r.id, kind: r.kind, crewId: r.crewId })), live };
  }

  watchWork(onWork: (w: Work) => void) {
    this.listeners.push(onWork);
    queueMicrotask(() => onWork(this.work()));
    return () => { this.listeners = this.listeners.filter((l) => l !== onWork); };
  }

  async claim(runId: string): Promise<RunContext | null> {
    this.calls.push("claim");
    const run = this.runs.find((r) => r.id === runId);
    if (!run || run.state !== "queued") return null;
    run.state = "starting";
    const crew = this.crew.find((c) => c.id === run.crewId)!;
    const thread = this.threads.find((t) => t.id === run.threadId) ?? null;
    const task = this.tasks.find((t) => t.id === run.taskId) ?? null;
    let prompt = run.prompt;
    const waiting = this.inbox.filter((m) => m.crewId === run.crewId && m.runId === null && !m.delivered);
    if (waiting.length) { prompt += `\n\nMessages for you:\n${waiting.map((m) => `- ${m.text}`).join("\n")}`; for (const m of waiting) m.delivered = true; }
    this.notify();
    const repo = task ? this.office.repos.find((r) => r.name === task.repo)! : this.office.repos[0]!;
    return {
      run: { id: run.id, kind: run.kind, prompt },
      office: { ...this.office, repoPath: repo.path, defaultBranch: repo.defaultBranch, setupCommand: repo.setupCommand },
      crew: { id: crew.id, name: crew.name, handle: crew.handle, role: crew.role, harness: crew.harness, model: null, effort: "high", profile: null, specialty: null },
      thread: thread && { id: thread.id, title: thread.title, branch: thread.branch },
      task: task && { id: task.id, key: task.key, repo: task.repo, title: task.title, brief: task.brief, notes: task.notes, branch: task.branch, dependsOn: task.dependsOn.map((d) => { const t = this.tasks.find((x) => x.id === d)!; return { key: t.key, title: t.title, state: t.state }; }) },
      resumeCursor: null,
      context: thread ? `Thread: "${thread.title}".` : "",
    };
  }

  async started(runId: string, worktree: string, threadBranch?: string, taskBranch?: string) {
    const run = this.runs.find((r) => r.id === runId)!;
    run.state = "working"; run.worktree = worktree;
    const thread = this.threads.find((t) => t.id === run.threadId);
    if (thread && threadBranch && !thread.branch) thread.branch = threadBranch;
    const task = this.tasks.find((t) => t.id === run.taskId);
    if (task && taskBranch) task.branch = taskBranch;
    this.notify();
  }

  async events(runId: string, events: RunEvent[]) {
    if (events.length > 200) throw new Error("At most 200 events per call");
    this.batches.push(events);
    const list = this.eventLog.get(runId) ?? [];
    list.push(...events);
    this.eventLog.set(runId, list);
    let changed = false;
    for (const e of events) {
      if (e.type === "request.opened") {
        const q: Question = { id: this.id("question"), runId, requestId: e.requestId, prompt: e.prompt, answer: null, delivered: false };
        this.questions.push(q);
        const auto = this.autoAnswer?.(q);
        if (auto) q.answer = auto;
        changed = true;
      }
      if (e.type === "request.resolved") { const q = this.questions.find((x) => x.runId === runId && x.requestId === e.requestId); if (q) { q.delivered = true; q.answer ??= e.decision; } }
    }
    if (changed) this.notify();
  }

  async delivered({ inboxIds, questionIds }: { inboxIds?: string[]; questionIds?: string[] }) {
    for (const id of inboxIds ?? []) { const m = this.inbox.find((x) => x.id === id); if (m) m.delivered = true; }
    for (const id of questionIds ?? []) { const q = this.questions.find((x) => x.id === id); if (q) q.delivered = true; }
    this.notify();
  }

  async landing(runId: string) {
    const run = this.runs.find((r) => r.id === runId)!;
    run.state = "landing";
    const task = this.tasks.find((t) => t.id === run.taskId);
    if (task) task.state = "review";
    this.notify();
  }

  async finish(runId: string, outcome: Outcome, opts: { error?: string; report?: string } = {}) {
    const run = this.runs.find((r) => r.id === runId)!;
    if (!["queued", "starting", "working", "landing"].includes(run.state)) return;
    run.state = outcome; run.error = opts.error ?? null; run.report = opts.report ?? null;
    for (const q of this.questions.filter((x) => x.runId === runId && x.answer === null)) { q.answer = ""; q.delivered = true; }
    const thread = this.threads.find((t) => t.id === run.threadId);
    const task = this.tasks.find((t) => t.id === run.taskId);
    const crew = this.crew.find((c) => c.id === run.crewId)!;
    if (run.kind === "task" && task && thread) {
      const all = this.tasks.filter((t) => t.threadId === thread.id);
      if (outcome === "landed") {
        task.state = "landed"; task.report = opts.report ?? null;
        const done = all.filter((t) => t.state === "landed").length;
        this.queueComputer(thread, `@${crew.handle} landed "${task.title}" (${task.key}) on the thread's branch. ${done} of ${all.length} tasks have landed.\nTheir report: ${opts.report ?? "(none)"}`);
      } else if (outcome === "failed") {
        task.state = "failed";
        this.queueComputer(thread, `@${crew.handle} could not finish "${task.title}" (${task.key}): ${opts.error ?? "no reason given"}.`);
      } else {
        task.state = "cancelled";
        this.queueComputer(thread, `The captain stopped @${crew.handle}'s work on "${task.title}" (${task.key}).`);
      }
    }
    if (run.kind === "computer" && thread) {
      const missed = this.inbox.filter((m) => m.runId === run.id && !m.delivered);
      for (const m of missed) m.delivered = true;
      if (missed.length && outcome !== "interrupted") this.queueComputer(thread, missed.map((m) => m.text).join("\n\n"));
    }
    this.tick();
  }

  async lookResult(runId: string, look: Look) { this.looks.set(runId, look); }

  private computerThread(runId: string): Thread {
    const run = this.runs.find((r) => r.id === runId)!;
    if (run.kind !== "computer") throw new Error("Only the ship's computer has this tool");
    return this.threads.find((t) => t.id === run.threadId)!;
  }
  private resolveTask(thread: Thread, ref: string): Task {
    const t = this.tasks.find((x) => x.threadId === thread.id && (x.id === ref || x.key === ref));
    if (!t) throw new Error(`No task "${ref}" in this thread`);
    return t;
  }

  readonly tools: Backend["tools"] = {
    crewStatus: async (runId): Promise<ShipStatus> => {
      const thread = this.computerThread(runId);
      return {
        repos: this.office.repos.map((r) => ({ name: r.name, defaultBranch: r.defaultBranch, here: r.here })),
        crew: this.crew.filter((c) => c.role === "crew").map((c) => ({ handle: c.handle, name: c.name, harness: c.harness, activity: this.liveRunOf(c.id) ? "Working" : "Off duty", task: null })),
        tasks: this.tasks.filter((t) => t.threadId === thread.id).map((t) => ({ id: t.id, key: t.key, repo: t.repo, title: t.title, state: t.state, assignee: this.crew.find((c) => c.id === t.assignee)?.handle ?? null })),
      } as ShipStatus;
    },
    planTasks: async (runId, tasks) => {
      this.calls.push("planTasks");
      const thread = this.computerThread(runId);
      const repos = this.office.repos;
      const repoFor = (t: { key: string; repo?: string }) => {
        if (t.repo) return repos.find((r) => r.name === t.repo)?.name ?? (() => { throw new Error(`No repo called "${t.repo}". Repos: ${repos.map((r) => r.name).join(", ")}`); })();
        if (repos.length > 1) throw new Error(`Task "${t.key}" needs a repo: this ship has ${repos.length} (${repos.map((r) => r.name).join(", ")}).`);
        return repos[0]!.name;
      };
      const named = tasks.map((t) => repoFor(t));
      const made: Task[] = tasks.map((t, i) => ({ id: this.id("task"), threadId: thread.id, key: t.key, repo: named[i]!, title: t.title, brief: t.brief, dependsOn: [], assignee: null, state: "todo", branch: null, report: null, notes: null }));
      this.tasks.push(...made);
      for (const [i, t] of tasks.entries()) made[i]!.dependsOn = (t.dependsOn ?? []).map((k) => this.resolveTask(thread, k).id);
      thread.state = "working";
      this.tick();
      return made.map((t) => ({ key: t.key, taskId: t.id, repo: t.repo, assignee: t.assignee ? `@${this.crew.find((c) => c.id === t.assignee)!.handle}` : null, state: t.state }));
    },
    assignTask: async () => ({}),
    hireCrew: async (_runId, args) => { const c = this.hire(args.name ?? `Hire${this.n}`); return { handle: c.handle, name: c.name, arrivesAt: Date.now() }; },
    messageCrew: async (_runId, handle, text) => {
      const c = this.crew.find((x) => x.handle === handle)!;
      const live = this.liveRunOf(c.id);
      this.inbox.push({ id: this.id("inbox"), crewId: c.id, runId: live && live.state !== "queued" ? live.id : null, text: `From the computer: ${text}`, delivered: false });
      this.notify();
      return { delivered: live ? "to their live run" : "with their next task" };
    },
    askCaptain: async (runId, question) => {
      const q: Question = { id: this.id("question"), runId, requestId: `ask-${this.n}`, prompt: question, answer: null, delivered: false };
      this.questions.push(q);
      const auto = this.autoAnswer?.(q);
      if (auto) q.answer = auto;
      this.notify();
      return { questionId: q.id, requestId: q.requestId };
    },
    reviewTask: async (runId, ref): Promise<ReviewInfo> => {
      this.calls.push("reviewTask");
      const thread = this.computerThread(runId);
      const t = this.resolveTask(thread, ref);
      const c = this.crew.find((x) => x.id === t.assignee);
      return { id: t.id, key: t.key, title: t.title, brief: t.brief, state: t.state, branch: t.branch, report: t.report, crew: c ? { handle: c.handle, name: c.name } : null, threadBranch: thread.branch, repo: t.repo };
    },
    sendBack: async (runId, ref, notes) => {
      const t = this.resolveTask(this.computerThread(runId), ref);
      t.state = "todo"; t.notes = notes; this.tick();
      return { taskId: t.id };
    },
    finishThread: async (runId, title, summary, prs) => {
      this.calls.push("finishThread");
      const thread = this.computerThread(runId);
      const open = this.tasks.filter((t) => t.threadId === thread.id && ["todo", "doing", "review"].includes(t.state));
      if (open.length) throw new Error(`Not every task has landed: ${open.map((t) => t.key).join(", ")}`);
      thread.state = "done"; thread.prs = prs; thread.prUrl = prs.find((p) => p.url)?.url ?? null; thread.finished = { title, summary };
      this.notify();
    },
  };

  async close() {}
}
