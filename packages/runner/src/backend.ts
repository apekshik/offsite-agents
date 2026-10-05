import { ConvexClient } from "convex/browser";
import type { ChangeStats, CrewRole, Effort, Harness, Look, RunEvent, RunKind } from "@offsite/contracts";
import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";
import type { ReviewBackend, ReviewWork } from "./reviews.ts";

// What the runner needs from the ship's backend (docs/runner-api.md), as plain shapes. The Convex implementation is
// below; tests use an in-memory one. Ids are plain strings here.

/** One of the ship's repos. `here`: it is on this machine (the run can use it). */
export interface RepoInfo { id: string | null; name: string; path: string; defaultBranch: string; setupCommand: string | null; here: boolean }

export interface RunContext {
  run: { id: string; kind: RunKind; prompt: string };
  office: {
    id: string; name: string;
    repos: RepoInfo[];
    /** The run's repo (the task's, or the first for the computer), as runners before repos read it. */
    repoPath: string | null; defaultBranch: string; setupCommand: string | null;
  };
  crew: { id: string; name: string; handle: string; role: CrewRole; harness: Harness; model: string | null; effort: Effort; profile: string | null; specialty: string | null };
  thread: { id: string; title: string; branch: string | null } | null;
  task: {
    id: string; key: string; title: string; brief: string; notes: string | null; branch: string | null; dependsOn: { key: string; title: string; state: string }[];
    /** The name of the repo it is in (office.repos). */
    repo: string | null;
  } | null;
  resumeCursor: unknown;
  context: string;
}

export interface LiveRun {
  runId: string;
  state: string;
  interruptRequested: boolean;
  inbox: { id: string; text: string }[];
  answers: { questionId: string; requestId: string; answer: string }[];
}
export interface Work { machineId: string; queued: { runId: string; kind: RunKind; crewId: string }[]; live: LiveRun[] }

export interface ReviewInfo {
  id: string; key: string; title: string; brief: string; state: string; branch: string | null; report: string | null;
  crew: { handle: string; name: string } | null; threadBranch: string | null;
  repo: string | null;
}

/** What crew_status says, as far as the runner reads it. */
export interface ShipStatus { tasks: { key: string; title: string; state: string; repo: string | null }[] }

/** One pull request (or branch) per repo with work in a finished thread. */
export interface ThreadPr { repo: string; url: string | null; branch: string }

export type Outcome = "landed" | "failed" | "interrupted";

export interface Backend {
  hello(probe: unknown, fresh?: boolean): Promise<{ machineId: string; owner: { name: string } }>;
  /** Subscribe to this machine's work. Returns an unsubscribe. */
  watchWork(onWork: (w: Work) => void, onError?: (e: Error) => void): () => void;
  claim(runId: string): Promise<RunContext | null>;
  started(runId: string, worktree: string, threadBranch?: string, taskBranch?: string): Promise<void>;
  events(runId: string, events: RunEvent[]): Promise<void>;
  delivered(ids: { inboxIds?: string[]; questionIds?: string[] }): Promise<void>;
  landing(runId: string): Promise<void>;
  finish(runId: string, outcome: Outcome, opts?: { error?: string; report?: string; diff?: ChangeStats }): Promise<void>;
  lookResult(runId: string, look: Look): Promise<void>;
  tools: {
    crewStatus(runId: string): Promise<ShipStatus>;
    planTasks(runId: string, tasks: { key: string; title: string; brief: string; dependsOn?: string[]; assignee?: string; repo?: string }[]): Promise<unknown>;
    assignTask(runId: string, task: string, crew?: string): Promise<unknown>;
    hireCrew(runId: string, args: { name?: string; harness?: "claude" | "codex"; specialty?: string }): Promise<unknown>;
    messageCrew(runId: string, crew: string, text: string): Promise<unknown>;
    askCaptain(runId: string, question: string, options?: string[]): Promise<{ questionId: string; requestId: string }>;
    reviewTask(runId: string, task: string): Promise<ReviewInfo>;
    sendBack(runId: string, task: string, notes: string): Promise<unknown>;
    finishThread(runId: string, title: string, summary: string, prs: ThreadPr[]): Promise<void>;
  };
  /** Diffs and "Open in editor" the captain asked for on this machine (convex/diffs.ts). Absent in tests that don't need it. */
  reviews?: ReviewBackend;
  close(): Promise<void>;
}

/**
 * What an agent reads when a ship tool fails: the reason, not "[CONVEX M(tools:planTasks)] [Request ID: …] Server
 * Error". ConvexErrors carry it in `data`; anything else, the first useful line of the message.
 */
export function readable(e: unknown): string {
  const data = (e as { data?: unknown } | null)?.data;
  if (typeof data === "string") return data;
  const message = e instanceof Error ? e.message : String(e);
  return message.replace(/^\[CONVEX [^\]]*\]\s*(\[Request ID: [^\]]*\]\s*)?/, "").replace(/^.*?Uncaught (Convex)?Error: /s, "").split("\n")[0]!.trim() || message;
}

const runId = (id: string) => id as Id<"runs">;

export function convexBackend(convexUrl: string, token: string): Backend {
  // Every failure reaches the caller, which says it readably; the client's own logging would print server stacks.
  const client = new ConvexClient(convexUrl, { logger: false });
  const t = { token };
  return {
    hello: (probe, fresh) => client.mutation(api.runner.hello, { ...t, probe, ...(fresh ? { fresh } : {}) }),
    watchWork(onWork, onError) {
      return client.onUpdate(api.runner.work, t, (w) => onWork(w as Work), onError);
    },
    claim: async (id) => (await client.mutation(api.runner.claim, { ...t, runId: runId(id) })) as RunContext | null,
    started: async (id, worktree, threadBranch, taskBranch) => {
      await client.mutation(api.runner.started, { ...t, runId: runId(id), worktree, ...(threadBranch ? { threadBranch } : {}), ...(taskBranch ? { taskBranch } : {}) });
    },
    events: async (id, events) => { await client.mutation(api.runner.events, { ...t, runId: runId(id), events }); },
    delivered: async ({ inboxIds, questionIds }) => {
      await client.mutation(api.runner.delivered, { ...t, ...(inboxIds?.length ? { inboxIds: inboxIds as Id<"inbox">[] } : {}), ...(questionIds?.length ? { questionIds: questionIds as Id<"questions">[] } : {}) });
    },
    landing: async (id) => { await client.mutation(api.runner.landing, { ...t, runId: runId(id) }); },
    finish: async (id, outcome, opts = {}) => {
      await client.mutation(api.runner.finish, { ...t, runId: runId(id), outcome, ...(opts.error ? { error: opts.error } : {}), ...(opts.report ? { report: opts.report } : {}), ...(opts.diff ? { diff: opts.diff } : {}) });
    },
    lookResult: async (id, look) => { await client.mutation(api.runner.lookResult, { ...t, runId: runId(id), look }); },
    tools: {
      crewStatus: async (id) => (await client.query(api.tools.crewStatus, { ...t, runId: runId(id) })) as ShipStatus,
      planTasks: (id, tasks) => client.mutation(api.tools.planTasks, { ...t, runId: runId(id), tasks }),
      assignTask: (id, task, crew) => client.mutation(api.tools.assignTask, { ...t, runId: runId(id), task, ...(crew ? { crew } : {}) }),
      hireCrew: (id, args) => client.mutation(api.tools.hireCrew, { ...t, runId: runId(id), ...args }),
      messageCrew: (id, crew, text) => client.mutation(api.tools.messageCrew, { ...t, runId: runId(id), crew, text }),
      askCaptain: (id, question, options) => client.mutation(api.tools.askCaptain, { ...t, runId: runId(id), question, ...(options ? { options } : {}) }),
      reviewTask: async (id, task) => (await client.query(api.tools.reviewTask, { ...t, runId: runId(id), task })) as ReviewInfo,
      sendBack: (id, task, notes) => client.mutation(api.tools.sendBack, { ...t, runId: runId(id), task, notes }),
      finishThread: async (id, title, summary, prs) => { await client.mutation(api.tools.finishThread, { ...t, runId: runId(id), title, summary, prs }); },
    },
    reviews: {
      watch: (onWork, onError) => client.onUpdate(api.diffs.work, t, (w) => onWork(w as ReviewWork), onError),
      put: async (diffId, answer) => { await client.mutation(api.diffs.put, { ...t, diffId: diffId as Id<"diffs">, ...answer }); },
      editorDone: async (requestId, ok, result) => { await client.mutation(api.diffs.editorDone, { ...t, requestId: requestId as Id<"editorRequests">, ok, result }); },
    },
    close: () => client.close(),
  };
}
