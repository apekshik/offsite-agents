import { z } from "zod";
import { Harness } from "./model.ts";

// The tools Offsite gives agents, on top of their harness's own. The runner exposes them to the
// model (an in-process MCP server for Claude Code, dynamic tools for Codex) and implements each by
// calling Convex (and git, on this machine). Names and arguments live here so the runner, the
// backend and the sim crew agree.

export interface ToolSpec<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  args: S;
}
const tool = <S extends z.ZodRawShape>(t: ToolSpec<S>) => t;

const taskRef = z.string().min(1).describe("A task's id, or the key you gave it in plan_tasks");
const crewRef = z.string().min(1).describe("A crew member's handle, e.g. \"juniper\"");

// ---- Computah, the main orchestrator ("computer" runs) ----

export const COMPUTER_TOOLS = {
  crew_status: tool({
    name: "crew_status",
    description: "The ship's repos, everyone aboard (each crew member's handle, harness, what they are doing now and in which repo), and every task in this thread with its repo and state.",
    args: {},
  }),
  plan_tasks: tool({
    name: "plan_tasks",
    description:
      "Split the captain's request into tasks. Give each a short key, a title, a self-contained brief (the crew member sees only the brief and the repo), and the keys of tasks it must wait for. " +
      "Prefer ONE task unless the work clearly splits into parts that touch different areas of the code. When parallel tasks share an interface, add a small first task that lands the shared types or API, and make the others depend on it. " +
      "Set assignee to a crew handle, or \"any\" to give it to whoever is free (someone new is hired and flown in by helicopter when nobody is). " +
      "Put each task in the repo it changes (repo: its name, from crew_status). Work that spans repos is a task per repo, ordered with dependsOn: the API first, then the UI that calls it.",
    args: {
      tasks: z.array(z.object({
        key: z.string().regex(/^[a-z0-9-]{1,32}$/),
        title: z.string().min(1).max(120),
        brief: z.string().min(1).max(4000),
        dependsOn: z.array(z.string()).max(8).default([]),
        assignee: z.string().default("any"),
        repo: z.string().max(32).optional().describe("The repo this task changes, by name. Required when the ship has more than one repo."),
      })).min(1).max(8),
    },
  }),
  assign_task: tool({
    name: "assign_task",
    description: "Give a task to a crew member, or omit crew to give it to whoever is free (hiring someone new when nobody is). The task starts as soon as everything it depends on has landed.",
    args: { task: taskRef, crew: crewRef.optional() },
  }),
  hire_crew: tool({
    name: "hire_crew",
    description: "Bring a new crew member aboard by helicopter. Use it when the work needs more hands than are free.",
    args: {
      name: z.string().max(20).optional().describe("Leave out to get a fresh name"),
      harness: Harness.exclude(["sim"]).optional().describe("Defaults to the captain's default harness"),
      specialty: z.string().max(200).optional().describe("A line about what they are good at; it shapes how they work"),
    },
  }),
  message_crew: tool({
    name: "message_crew",
    description: "Send a crew member a message. It reaches their live run at the next turn boundary, or waits for their next task.",
    args: { crew: crewRef, text: z.string().min(1).max(4000) },
  }),
  ask_captain: tool({
    name: "ask_captain",
    description: "Ask the captain a question and wait for the answer. Only for calls that are genuinely theirs: product decisions, trade-offs they care about, missing information.",
    args: { question: z.string().min(1).max(1000), options: z.array(z.string().max(120)).max(6).optional() },
  }),
  review_task: tool({
    name: "review_task",
    description: "Read a finished task: its repo, the crew member's report, the files it changed, and its diff against the thread's branch in that repo.",
    args: { task: taskRef },
  }),
  send_back: tool({
    name: "send_back",
    description: "Reopen a task for the same crew member with notes on what to fix. They pick it up in the same worktree.",
    args: { task: taskRef, notes: z.string().min(1).max(4000) },
  }),
  finish_thread: tool({
    name: "finish_thread",
    description: "Every task has landed and the work is right: push the thread's branch in every repo with landed work, and open one pull request in each (where the repo has a GitHub remote). Title and summary go on every one.",
    args: { title: z.string().min(1).max(120), summary: z.string().min(1).max(4000) },
  }),
} as const;

// ---- crew members ----

export const CREW_TOOLS = {
  sync_with_team: tool({
    name: "sync_with_team",
    description: "Bring in what teammates have already landed on this thread's branch (a rebase of your work onto it). Use it when your task builds on theirs, or when told something you depend on has landed.",
    args: {},
  }),
  ask_captain: COMPUTER_TOOLS.ask_captain,
} as const;

export type ComputerToolName = keyof typeof COMPUTER_TOOLS;
export type CrewToolName = keyof typeof CREW_TOOLS;
export type ToolArgs<T extends ToolSpec> = z.infer<z.ZodObject<T["args"]>>;

/** Parse a tool call's arguments against its spec. */
export function parseToolArgs<T extends ToolSpec>(spec: T, args: unknown): ToolArgs<T> {
  return z.object(spec.args).parse(args ?? {}) as ToolArgs<T>;
}
