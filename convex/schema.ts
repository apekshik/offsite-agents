import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// One person's offsite: you (the captain), your ship (an office in a world), your crew (agents
// running on your own machine and subscriptions), threads (conversations with Computah, the main
// orchestrator: the crew row with role "computer"), the tasks it hands out, and the runs that do them.

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
  /**
   * A person aboard: the captain (the ship's owner), or a friend they invited (a member). `userId` says who; rows from
   * before friends came aboard have none, and are the owner's.
   */
  v.object({ kind: v.literal("captain"), userId: v.optional(v.id("users")) }),
  v.object({ kind: v.literal("crew"), crewId: v.id("crew") }),
  v.object({ kind: v.literal("system") }),
);

/** "+38 −2 · 2 files" (contracts ChangeStats). */
export const changeStats = v.object({ added: v.number(), removed: v.number(), files: v.number() });

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
    /** The ship they last went aboard (their own, or one they joined). Unset: their newest own ship. */
    aboardId: v.optional(v.union(v.id("offices"), v.null())),
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
    /** Friends aboard (members) can start threads and talk to Computah. Unset: they can. */
    membersCanAsk: v.optional(v.boolean()),
    createdAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  /**
   * A friend aboard someone else's ship: they read everything and talk to Computah in threads, while the work runs on
   * the owner's machines and subscriptions. The owner is never a row here. Deleted when they leave or are removed.
   */
  members: defineTable({
    officeId: v.id("offices"),
    userId: v.id("users"),
    invitedBy: v.id("users"),
    inviteId: v.union(v.id("invites"), v.null()),
    joinedAt: v.number(),
  }).index("by_office", ["officeId"]).index("by_user", ["userId"]).index("by_office_user", ["officeId", "userId"]),

  /** A link that brings a friend aboard (/join/<token>). One live link per ship; making a new one revokes the last. */
  invites: defineTable({
    officeId: v.id("offices"),
    /** Random and unguessable; only the owner reads it back. */
    token: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.union(v.number(), v.null()),
    /** How many people came aboard with it. */
    used: v.number(),
  }).index("by_token", ["token"]).index("by_office", ["officeId", "createdAt"]),

  /**
   * Who is walking the decks right now, one row per person (a second tab takes over from the first). Movement goes
   * peer to peer (WebRTC); this row is the roster, a heartbeat, and the fallback position when a link can't be made.
   * Swept when it stops beating (presence.sweep).
   */
  presence: defineTable({
    officeId: v.id("offices"),
    userId: v.id("users"),
    /** This tab's id for WebRTC signaling. */
    peerId: v.string(),
    pos: v.array(v.number()),
    facing: v.number(),
    /** What they are doing: walking about, at the helm, the phone out (contracts PersonAct). */
    act: v.string(),
    joinedAt: v.number(),
    at: v.number(),
  }).index("by_office", ["officeId"]).index("by_user", ["userId"]).index("by_peer", ["peerId"]).index("by_at", ["at"]),

  /** WebRTC signaling between two people aboard the same ship: offers, answers, ICE candidates. Deleted once read. */
  signals: defineTable({
    officeId: v.id("offices"),
    from: v.string(),
    to: v.string(),
    kind: v.string(),
    data: v.string(),
    at: v.number(),
  }).index("by_to", ["to"]).index("by_at", ["at"]),

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

  /** A crew member: an identity (name, look, specialty) powered by a harness on your machine. Computah, the main orchestrator, is crew too (role "computer"). */
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
    /** What the runner said it runs on ("macOS 26.4", "Linux"), for the approval screen. Absent from older runners. */
    os: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("denied")),
    ownerId: v.union(v.id("users"), v.null()),
    token: v.union(v.string(), v.null()),
    expiresAt: v.number(),
  }).index("by_device", ["deviceCode"]).index("by_user_code", ["userCode"]).index("by_expires", ["expiresAt"]),

  /** Fixed-window counters for what anyone can call (pairing): lib.ts `limit`. Swept hourly (crons.ts). */
  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]).index("by_window", ["windowStart"]),

  /** A conversation with Computah about one piece of work. Its work lands on one branch. */
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
    /** Who started it (the owner, or a friend aboard). Missing on threads from before friends: the owner. */
    startedBy: v.optional(v.id("users")),
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
    /** What it changed, recorded by the runner when it lands. Missing on tasks from before. */
    diff: v.optional(v.union(changeStats, v.null())),
    /** When the captain first opened its changes (its package leaves the drop-off). */
    seenAt: v.optional(v.union(v.number(), v.null())),
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
    /**
     * Whom it is for: the person who last spoke in the thread (Computah asks whoever asked), the owner for a permission
     * on their machine, or null for anyone aboard. Missing on questions from before friends: the owner.
     */
    askedOf: v.optional(v.union(v.id("users"), v.null())),
    /** Who answered it (anyone aboard may answer a question; only the owner a permission). */
    answeredBy: v.optional(v.id("users")),
    /** When the runner handed the answer to the agent. */
    deliveredAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
  }).index("by_office_open", ["officeId", "answeredAt"]).index("by_run", ["runId"]),

  /**
   * A diff the captain asked to see: one task's changes, or a thread's in one repo (taskId null). Computed by the
   * runner on the machine holding the repo (diffs.work), cached by the sha it was computed at. Only the owner reads it.
   */
  diffs: defineTable({
    officeId: v.id("offices"),
    threadId: v.id("threads"),
    taskId: v.union(v.id("tasks"), v.null()),
    repoId: v.id("repos"),
    machineId: v.id("machines"),
    state: v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
    requestedAt: v.number(),
    computedAt: v.union(v.number(), v.null()),
    sha: v.union(v.string(), v.null()),
    base: v.union(v.string(), v.null()),
    stats: v.union(changeStats, v.null()),
    /** contracts ChangedFile[], checked by the runner's mutation. */
    files: v.array(v.any()),
    /** The unified diff, cut at contracts DIFF_LIMITS.patchChars. */
    patch: v.string(),
    truncated: v.boolean(),
    error: v.union(v.string(), v.null()),
  }).index("by_thread", ["threadId", "taskId"]).index("by_machine", ["machineId", "state"]),

  /**
   * Finding repos to add: a scan of the usual places for git repos, or one level of folders under a path (Browse). The
   * captain asks, the runner on that machine answers (folders.work → put). Only the owner reads it, and every row is
   * deleted at `expiresAt` (contracts FOLDER_LIMITS.ttlMs after it was asked for).
   */
  folderRequests: defineTable({
    ownerId: v.id("users"),
    machineId: v.id("machines"),
    kind: v.union(v.literal("scan"), v.literal("browse")),
    /** Browse: the folder to list, as the app gave it ("~", "~/Developer", or a typed absolute path). */
    path: v.union(v.string(), v.null()),
    /** Browse: the captain typed the path, so it may be outside the home folder. */
    typed: v.boolean(),
    state: v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
    requestedAt: v.number(),
    answeredAt: v.union(v.number(), v.null()),
    expiresAt: v.number(),
    /** contracts FolderResult, checked by the runner's mutation. */
    result: v.union(v.any(), v.null()),
    error: v.union(v.string(), v.null()),
  }).index("by_machine", ["machineId", "state"]).index("by_owner", ["ownerId", "machineId", "kind"]).index("by_expires", ["expiresAt"]),

  /** "Open in editor": the captain asked, the runner on the repo's machine opens the folder. */
  editorRequests: defineTable({
    officeId: v.id("offices"),
    threadId: v.id("threads"),
    taskId: v.union(v.id("tasks"), v.null()),
    repoId: v.id("repos"),
    machineId: v.id("machines"),
    createdAt: v.number(),
    doneAt: v.union(v.number(), v.null()),
    /** What the runner opened, or why it couldn't. */
    result: v.union(v.string(), v.null()),
    ok: v.union(v.boolean(), v.null()),
  }).index("by_machine", ["machineId", "doneAt"]).index("by_thread", ["threadId", "createdAt"]),
});
