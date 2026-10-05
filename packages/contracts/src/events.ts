import { z } from "zod";

// Normalized harness events. Every adapter (Claude Code, Codex, the sim crew) emits only these,
// and everything downstream (Convex, the world, the phone) reads only these.
// Adapted from Beam's RunEvent (MIT, github.com/SupraluminalIntelligence/beam).

export const UsageWindow = z.object({
  kind: z.string(),
  usedPercent: z.number().nullable(),
  resetsAt: z.number().nullable(),
});
export type UsageWindow = z.infer<typeof UsageWindow>;

export const RunEvent = z.discriminatedUnion("type", [
  /** The harness session began; the cursor lets a later run resume it (opaque, stays on the machine side). */
  z.object({ type: z.literal("session.started"), resumeCursor: z.unknown().nullable() }),
  z.object({ type: z.literal("turn.started"), turnId: z.string() }),
  /** Reply text, streamed. Deltas are coalesced (100ms) by the runner before they are sent. */
  z.object({ type: z.literal("content.delta"), delta: z.string() }),
  z.object({ type: z.literal("content.final"), text: z.string() }),
  /**
   * A tool step began. kind: bash, read, edit, write, search, web, agent, plan, ask, offsite, tool.
   * summary: "Edit src/x.ts", the shell command, "Read README.md"…
   */
  z.object({ type: z.literal("item.started"), itemId: z.string(), kind: z.string(), summary: z.string() }),
  z.object({ type: z.literal("item.completed"), itemId: z.string(), summary: z.string(), detail: z.string().nullable(), ok: z.boolean(), ms: z.number().nullable() }),
  /** The agent needs the captain: a permission (approval) or an answer (input). */
  z.object({ type: z.literal("request.opened"), requestId: z.string(), kind: z.enum(["approval", "input"]), prompt: z.string(), options: z.array(z.string()).nullable() }),
  z.object({ type: z.literal("request.resolved"), requestId: z.string(), decision: z.string() }),
  /** A message reached a live run mid-turn. */
  z.object({ type: z.literal("steer.received"), text: z.string() }),
  z.object({ type: z.literal("turn.completed"), turnId: z.string() }),
  z.object({ type: z.literal("usage.updated"), windows: z.array(UsageWindow) }),
  /** What the harness waits on when nothing else moves: a retry, a rate limit. Cleared by the next progress event. */
  z.object({ type: z.literal("status"), message: z.string(), until: z.number().nullable() }),
  z.object({ type: z.literal("error"), message: z.string(), fatal: z.boolean() }),
]);
export type RunEvent = z.infer<typeof RunEvent>;
export type RunEventType = RunEvent["type"];

/** A stored event: the run it belongs to, its order within the run, and when the runner saw it. */
export interface StoredRunEvent {
  runId: string;
  seq: number;
  at: number;
  event: RunEvent;
}
