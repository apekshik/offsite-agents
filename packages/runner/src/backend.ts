import { ConvexClient } from "convex/browser";
import type { CrewRole, Effort, Harness, Look, RunEvent, RunKind } from "@offsite/contracts";
import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";

// What the runner needs from the ship's backend (docs/runner-api.md), as plain shapes. The Convex implementation is
// below; tests use an in-memory one. Ids are plain strings here.

export interface RunContext {
  run: { id: string; kind: RunKind; prompt: string };
  office: { id: string; name: string; repoPath: string | null; defaultBranch: string; setupCommand: string | null };
  crew: { id: string; name: string; handle: string; role: CrewRole; harness: Harness; model: string | null; effort: Effort; profile: string | null; specialty: string | null };
  thread: { id: string; title: string; branch: string | null } | null;
  task: { id: string; key: string; title: string; brief: string; notes: string | null; branch: string | null; dependsOn: { key: string; title: string; state: string }[] } | null;
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
}

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
  finish(runId: string, outcome: Outcome, opts?: { error?: string; report?: string }): Promise<void>;
  lookResult(runId: string, look: Look): Promise<void>;
  tools: {
    crewStatus(runId: string): Promise<unknown>;
    planTasks(runId: string, tasks: { key: string; title: string; brief: string; dependsOn?: string[]; assignee?: string }[]): Promise<unknown>;
    assignTask(runId: string, task: string, crew?: string): Promise<unknown>;
    hireCrew(runId: string, args: { name?: string; harness?: "claude" | "codex"; specialty?: string }): Promise<unknown>;
    messageCrew(runId: string, crew: string, text: string): Promise<unknown>;
    askCaptain(runId: string, question: string, options?: string[]): Promise<{ questionId: string; requestId: string }>;
    reviewTask(runId: string, task: string): Promise<ReviewInfo>;
    sendBack(runId: string, task: string, notes: string): Promise<unknown>;
    finishThread(runId: string, title: string, summary: string, prUrl: string | null): Promise<void>;
  };
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
  const client = new ConvexClient(convexUrl);
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
      await client.mutation(api.runner.finish, { ...t, runId: runId(id), outcome, ...(opts.error ? { error: opts.error } : {}), ...(opts.report ? { report: opts.report } : {}) });
    },
    lookResult: async (id, look) => { await client.mutation(api.runner.lookResult, { ...t, runId: runId(id), look }); },
    tools: {
      crewStatus: (id) => client.query(api.tools.crewStatus, { ...t, runId: runId(id) }),
      planTasks: (id, tasks) => client.mutation(api.tools.planTasks, { ...t, runId: runId(id), tasks }),
      assignTask: (id, task, crew) => client.mutation(api.tools.assignTask, { ...t, runId: runId(id), task, ...(crew ? { crew } : {}) }),
      hireCrew: (id, args) => client.mutation(api.tools.hireCrew, { ...t, runId: runId(id), ...args }),
      messageCrew: (id, crew, text) => client.mutation(api.tools.messageCrew, { ...t, runId: runId(id), crew, text }),
      askCaptain: (id, question, options) => client.mutation(api.tools.askCaptain, { ...t, runId: runId(id), question, ...(options ? { options } : {}) }),
      reviewTask: async (id, task) => (await client.query(api.tools.reviewTask, { ...t, runId: runId(id), task })) as ReviewInfo,
      sendBack: (id, task, notes) => client.mutation(api.tools.sendBack, { ...t, runId: runId(id), task, notes }),
      finishThread: async (id, title, summary, prUrl) => { await client.mutation(api.tools.finishThread, { ...t, runId: runId(id), title, summary, prUrl }); },
    },
    close: () => client.close(),
  };
}
