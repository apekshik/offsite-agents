import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// One person's offsite: you (the captain), your ship (an office in a world), your crew (agents
// running on your own machine and subscriptions), threads (conversations with the ship's
// computer), the tasks it hands out, and the runs that do them.

export const harness = v.union(v.literal("claude"), v.literal("codex"), v.literal("sim"));
export const runState = v.union(
  v.literal("queued"), v.literal("starting"), v.literal("working"), v.literal("landing"),
  v.literal("landed"), v.literal("failed"), v.literal("interrupted"),
);
export const runKind = v.union(v.literal("computer"), v.literal("task"), v.literal("look"));
export const taskState = v.union(
  v.literal("todo"), v.literal("doing"), v.literal("review"), v.literal("landed"), v.literal("failed"), v.literal("cancelled"),
);
export const threadState = v.union(v.literal("open"), v.literal("working"), v.literal("done"), v.literal("archived"));
export const author = v.union(
  v.object({ kind: v.literal("captain") }),
  v.object({ kind: v.literal("crew"), crewId: v.id("crew") }),
  v.object({ kind: v.literal("system") }),
);

export default defineSchema({
  /** A signed-in person (WorkOS, or dev sign-in on a dev deployment). */
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.union(v.string(), v.null()),
    /** The captain's own avatar: an AvatarSpec, and optionally a designed Look. */
    avatar: v.any(),
    look: v.union(v.any(), v.null()),
    createdAt: v.number(),
  }).index("by_token", ["tokenIdentifier"]),

  /** An office: your ship. Its world is how it looks (the yacht first). */
  offices: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    world: v.string(),
    /** Legacy (before repos): the one project. Migrated into `repos` (repos.migrate); no longer read once it has been. */
    repo: v.optional(v.union(v.object({ machineId: v.id("machines"), path: v.string(), defaultBranch: v.string() }), v.null())),
    /** Legacy (before repos): now each repo's own setupCommand. */
    setupCommand: v.optional(v.union(v.string(), v.null())),
    /** Which harness new hires use unless told otherwise. */
    defaultHarness: harness,
    createdAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  /**
   * A project the crew works on: a git checkout on one of your machines. An office has one or more; each task is in
   * one. The computer works on the machine that holds the office's first repo.
   */
  repos: defineTable({
    officeId: v.id("offices"),
    /** Short, lowercase, unique in the office: "web", "api". The computer and its plans use it. */
    name: v.string(),
    machineId: v.id("machines"),
    path: v.string(),
    defaultBranch: v.string(),
    /** Run once in every new task worktree of this repo, e.g. "pnpm install". */
    setupCommand: v.union(v.string(), v.null()),
    createdAt: v.number(),
    removedAt: v.union(v.number(), v.null()),
  }).index("by_office", ["officeId"]),

  /** A crew member: an identity (name, look, specialty) powered by a harness on your machine. The ship's computer is crew too (role "computer"). */
  crew: defineTable({
    officeId: v.id("offices"),
    role: v.union(v.literal("computer"), v.literal("crew")),
    name: v.string(),
    handle: v.string(),
    avatar: v.any(),
    look: v.union(v.any(), v.null()),
    specialty: v.union(v.string(), v.null()),
    harness,
    model: v.union(v.string(), v.null()),
    effort: v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("max")),
    /** Which account (harness profile) on the machine; null is the harness's default login. */
    profile: v.union(v.string(), v.null()),
    hiredAt: v.number(),
    /** When the helicopter sets them down. The world flies them in until then. */
    arrivesAt: v.number(),
    dismissedAt: v.union(v.number(), v.null()),
  }).index("by_office", ["officeId"]).index("by_office_handle", ["officeId", "handle"]),

  /** A machine that runs your crew: beam-runner's idea, paired by device code. Only the token's hash is stored. */
  machines: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    hostname: v.string(),
    tokenHash: v.string(),
    lastSeenAt: v.number(),
    /** What the runner found: each harness, installed or not, signed in or not, its models. Never a credential. */
    probe: v.any(),
    createdAt: v.number(),
    revokedAt: v.union(v.number(), v.null()),
  }).index("by_owner", ["ownerId"]).index("by_hash", ["tokenHash"]),

  /** Device-code pairing in flight. Deleted once polled after approval. */
  deviceCodes: defineTable({
    deviceCode: v.string(),
    userCode: v.string(),
    name: v.string(),
    hostname: v.string(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("denied")),
    ownerId: v.union(v.id("users"), v.null()),
    token: v.union(v.string(), v.null()),
    expiresAt: v.number(),
  }).index("by_device", ["deviceCode"]).index("by_user_code", ["userCode"]),

  /** A conversation with the ship's computer about one piece of work. Its work lands on one branch. */
  threads: defineTable({
    officeId: v.id("offices"),
    title: v.string(),
    state: threadState,
    /** offsite/<slug>-<id>: the same name in every repo the thread touches, made in each when its first task there starts. */
    branch: v.union(v.string(), v.null()),
    /** The first pull request, for clients from before `prs`. */
    prUrl: v.union(v.string(), v.null()),
    /** One per repo with work in this thread, set when the thread finishes. */
    prs: v.optional(v.array(v.object({ repoId: v.id("repos"), url: v.union(v.string(), v.null()), branch: v.string() }))),
    createdAt: v.number(),
    lastMessageAt: v.number(),
  }).index("by_office", ["officeId", "lastMessageAt"]),

  messages: defineTable({
    threadId: v.id("threads"),
    author,
    kind: v.union(v.literal("text"), v.literal("report"), v.literal("plan"), v.literal("system")),
    text: v.string(),
    /** The run whose reply this is, while it streams and after. */
    runId: v.union(v.id("runs"), v.null()),
    taskId: v.union(v.id("tasks"), v.null()),
    streaming: v.boolean(),
    createdAt: v.number(),
  }).index("by_thread", ["threadId", "createdAt"]).index("by_run", ["runId"]),

  /** A unit of work the computer handed out. Starts when its dependencies have landed and its crew member is free. */
  tasks: defineTable({
    threadId: v.id("threads"),
    officeId: v.id("offices"),
    key: v.string(),
    /** The repo it changes. Missing on tasks from before repos: those are the office's first repo. */
    repoId: v.optional(v.id("repos")),
    title: v.string(),
    brief: v.string(),
    dependsOn: v.array(v.id("tasks")),
    /** null: give it to whoever is free (hire when nobody is). */
    assignee: v.union(v.id("crew"), v.null()),
    state: taskState,
    /** The task's own branch: offsite/<thread-slug>/<key>. Its worktree lives on the machine. */
    branch: v.union(v.string(), v.null()),
    /** The crew member's report when they finished. */
    report: v.union(v.string(), v.null()),
    /** Notes from send_back, for the next attempt. */
    notes: v.union(v.string(), v.null()),
    createdAt: v.number(),
    landedAt: v.union(v.number(), v.null()),
  }).index("by_thread", ["threadId"]).index("by_office_state", ["officeId", "state"]).index("by_assignee", ["assignee", "state"]),

  /** One agent working: a computer turn in a thread, a crew member on a task, or a look being designed. */
  runs: defineTable({
    officeId: v.id("offices"),
    threadId: v.union(v.id("threads"), v.null()),
    taskId: v.union(v.id("tasks"), v.null()),
    crewId: v.id("crew"),
    kind: runKind,
    state: runState,
    /** The machine that claimed it. */
    machineId: v.union(v.id("machines"), v.null()),
    /** What the agent is asked to do this run: the captain's words, a task brief, a wake-up note. */
    prompt: v.string(),
    worktree: v.union(v.string(), v.null()),
    /** The tool step in flight, kept here so the world reads one row per crew member, not every event. */
    step: v.union(v.object({ itemId: v.string(), kind: v.string(), summary: v.string(), since: v.number() }), v.null()),
    /** The last finished step's summary, for "what were they just doing". */
    lastStep: v.union(v.string(), v.null()),
    error: v.union(v.string(), v.null()),
    interruptRequestedAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
    startedAt: v.union(v.number(), v.null()),
    endedAt: v.union(v.number(), v.null()),
  })
    .index("by_office_state", ["officeId", "state"])
    .index("by_thread", ["threadId"])
    .index("by_task", ["taskId"])
    .index("by_crew", ["crewId", "createdAt"])
    .index("by_machine", ["machineId", "state"]),

  /** Normalized events (RunEvent in @offsite/contracts), in order. */
  runEvents: defineTable({
    runId: v.id("runs"),
    seq: v.number(),
    at: v.number(),
    event: v.any(),
  }).index("by_run", ["runId", "seq"]),

  /** Messages waiting for a crew member's live or next run (message_crew, the captain steering the computer). */
  inbox: defineTable({
    crewId: v.id("crew"),
    runId: v.union(v.id("runs"), v.null()),
    text: v.string(),
    deliveredAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
  }).index("by_crew", ["crewId", "deliveredAt"]),

  /** Where a harness keeps its session per crew member and thread, so a later run resumes it. Stays on this side: never shown. */
  sessions: defineTable({
    crewId: v.id("crew"),
    threadId: v.union(v.id("threads"), v.null()),
    taskId: v.union(v.id("tasks"), v.null()),
    machineId: v.id("machines"),
    cursor: v.any(),
    updatedAt: v.number(),
  }).index("by_crew_scope", ["crewId", "threadId", "taskId"]),

  /** An agent waiting on the captain: a permission (approval) or an answer (input). */
  questions: defineTable({
    officeId: v.id("offices"),
    threadId: v.union(v.id("threads"), v.null()),
    runId: v.id("runs"),
    crewId: v.id("crew"),
    requestId: v.string(),
    kind: v.union(v.literal("approval"), v.literal("input")),
    prompt: v.string(),
    options: v.union(v.array(v.string()), v.null()),
    answer: v.union(v.string(), v.null()),
    answeredAt: v.union(v.number(), v.null()),
    /** When the runner handed the answer to the agent. */
    deliveredAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
  }).index("by_office_open", ["officeId", "answeredAt"]).index("by_run", ["runId"]),
});
