// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import type { CrewRole, Effort, Harness, RunEvent, RunKind } from "@offsite/contracts";
import type { z } from "zod";
import type { HarnessProfile } from "./profile.ts";

/**
 * A tool Offsite offers the model on top of its harness's own (plan_tasks, sync_with_team…). Names and
 * arguments come from @offsite/contracts tools.ts; the runner supplies run(). Adapters expose them however
 * their harness allows: an in-process MCP server for Claude Code, dynamic tools for Codex, direct calls in the sim.
 */
export interface OffsiteTool {
  name: string;
  description: string;
  args: z.ZodRawShape;
  /** Arguments arrive already parsed against `args`. The result is text the model reads; throw to report a failure. */
  run(args: Record<string, unknown>): Promise<string>;
}

/** Who is working: enough of the crew member for the harness to pick a model and a policy. */
export interface SessionCrew {
  name: string;
  handle: string;
  role: CrewRole;
  /** A model id, or null for the harness's default. */
  model: string | null;
  effort: Effort;
}

export interface StartSession {
  kind: RunKind;
  crew: SessionCrew;
  /** The task's worktree, the thread's worktree for the computer, or a scratch directory. */
  cwd: string;
  /** Which account on this machine; undefined is the CLI's default login. */
  profile?: HarnessProfile;
  /** Adapter-specific, opaque to everyone else. */
  resumeCursor: unknown;
  /** Offsite's instructions and context, appended to the harness's own system prompt. */
  systemPrompt: string;
  tools: OffsiteTool[];
  /** Extra environment for the agent's processes, e.g. PORT. */
  env?: Record<string, string>;
}

/** What a probe found. Never a credential: installed, signed in, which plan, which models. */
export interface HarnessStatus {
  harness: Harness;
  installed: boolean;
  version: string | null;
  auth: "authenticated" | "unauthenticated" | "unknown";
  email: string | null;
  plan: string | null;
  models: { id: string; name: string; efforts: string[] }[];
  message: string | null;
}

/** One shape per harness. Everything else in Offsite talks to this. */
export interface HarnessAdapter {
  readonly kind: Harness;
  probe(profile?: HarnessProfile, cwd?: string): Promise<HarnessStatus>;
  start(input: StartSession): Promise<Session>;
}

export interface Session {
  /** Send a user turn. While a turn is running this is a steer, delivered at the next turn boundary. */
  send(text: string): Promise<void>;
  /** Cancel the turn in flight and drop queued sends. */
  interrupt(): Promise<void>;
  /** Answer a request.opened (an approval or a question). */
  respond(requestId: string, decision: string): Promise<void>;
  stop(): Promise<void>;
  events: AsyncIterable<RunEvent>;
  resumeCursor(): unknown;
}
