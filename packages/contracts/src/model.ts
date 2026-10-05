import { z } from "zod";

/** Which coding agent CLI powers a crew member. `sim` is the scripted crew: no CLI, no spending. */
export const Harness = z.enum(["claude", "codex", "sim"]);
export type Harness = z.infer<typeof Harness>;

export const Effort = z.enum(["low", "medium", "high", "max"]);
export type Effort = z.infer<typeof Effort>;

/** "computer" is Computah, the main orchestrator: it plans and delegates; crew members do the work. */
export const CrewRole = z.enum(["computer", "crew"]);
export type CrewRole = z.infer<typeof CrewRole>;

/**
 * What a run is for.
 * - computer: one turn of Computah (the main orchestrator) in a thread (planning, delegating, reviewing).
 * - task: one crew member working one task in its own worktree.
 * - look: designing a crew member's look from a description, on the captain's own subscription.
 */
export const RunKind = z.enum(["computer", "task", "look"]);
export type RunKind = z.infer<typeof RunKind>;

export const RunState = z.enum(["queued", "starting", "working", "landing", "landed", "failed", "interrupted"]);
export type RunState = z.infer<typeof RunState>;
export const LIVE_RUN_STATES: readonly RunState[] = ["queued", "starting", "working", "landing"];
export const isLive = (s: RunState) => LIVE_RUN_STATES.includes(s);

/**
 * A task moves todo → doing → landed. `review` means the crew member finished and the work is
 * landing onto the thread's branch; `failed` and `cancelled` are terminal. Dependencies are
 * satisfied only by `landed`.
 */
export const TaskState = z.enum(["todo", "doing", "review", "landed", "failed", "cancelled"]);
export type TaskState = z.infer<typeof TaskState>;

/** open: talking it through · working: crew are on it · done: landed, PR opened (or branch left) · archived. */
export const ThreadState = z.enum(["open", "working", "done", "archived"]);
export type ThreadState = z.infer<typeof ThreadState>;

export const MessageKind = z.enum(["text", "report", "plan", "system"]);
export type MessageKind = z.infer<typeof MessageKind>;

/** Who said it: you (the captain), Computah or a crew member, or the ship itself. */
export type Author = { kind: "captain" } | { kind: "crew"; crewId: string } | { kind: "system" };

/** Limits that keep one office's state small. */
export const LIMITS = {
  maxCrew: 12,
  messageChars: 8000,
  briefChars: 4000,
  titleChars: 120,
  nameChars: 20,
  lookBytes: 16_000,
  eventsPerBatch: 200,
} as const;

/** Lowercase handle from a display name: "Juniper Vale" → "juniper-vale". */
export function handleFor(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "crew";
}

/**
 * How a new crew member arrives: the helicopter approaches, sets down at arrivesAt, waits while
 * they step out, and leaves. arrivesAt = hiredAt + approachMs, so every client draws the same
 * flight from the same timestamps, and a reload mid-flight picks up where it was.
 */
export const ARRIVAL = { approachMs: 14_000, groundMs: 7_000, departMs: 9_000, stepOutMs: 1_800 } as const;
