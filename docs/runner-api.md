# The runner's API

What `offsite` (packages/runner) calls on Convex. Every function takes the machine's `token` (from device-code pairing, saved in `~/.offsite/runner.json`) and throws a `ConvexError` with a readable message. Shapes for events and tools are in @offsite/contracts.

## Pairing (HTTP, on the deployment's `.convex.site` URL)

- `POST /device/start` `{ name, hostname }` → `{ deviceCode, userCode, verifyUrl, interval, expiresIn }`. Print the code and the link; the captain approves in the app.
- `POST /device/poll` `{ deviceCode }` → `{ status: "pending" | "approved" | "denied" | "expired", token? }`. Poll every `interval` seconds. The token is handed out once.

## The loop

- `runner.hello` (mutation) `{ token, probe }` → `{ machineId, owner }`. On start and every 30 s. `probe` is what the harnesses reported: `[{ harness, installed, version, auth, email, plan, models, message }]`.
- `runner.work` (query, subscribe to it) `{ token }` → `{ machineId, queued: [{ runId, kind, crewId }], live: [{ runId, interruptRequested, inbox: [{ id, text }], answers: [{ questionId, requestId, answer }] }] }`. Queued runs are this machine's to claim (offices whose repo is on this machine). Live are runs this machine claimed.
- `runner.claim` (mutation) `{ token, runId }` → `RunContext | null` (null when someone else got it). RunContext:
  - `run: { id, kind, prompt }`
  - `office: { id, name, repoPath, defaultBranch, setupCommand }`
  - `crew: { id, name, handle, role, harness, model, effort, profile, specialty }`
  - `thread: { id, title, branch } | null`
  - `task: { id, key, title, brief, notes, branch, dependsOn: [{ key, title, state }] } | null`
  - `resumeCursor` (opaque; from the last run of this crew member in this thread/task)
  - `context`: text the agent should know: for the computer, the thread so far and the crew roster; for a crew member, the thread's title and what teammates landed.
- `runner.started` (mutation) `{ token, runId, worktree, threadBranch?, taskBranch? }`. The run is working; the branches are recorded.
- `runner.events` (mutation) `{ token, runId, events: RunEvent[] }`. Up to 200 per call. Content deltas coalesced to 100 ms. The backend keeps the reply message, the current step, questions (request.opened) and the resume cursor (session.started) up to date from these.
- `runner.delivered` (mutation) `{ token, inboxIds?, questionIds? }`. Messages and answers handed to the agent.
- `runner.landing` (mutation) `{ token, runId }`. A task's agent finished; its work is landing on the thread branch (task → review).
- `runner.finish` (mutation) `{ token, runId, outcome: "landed" | "failed" | "interrupted", error?, report? }`. For a task, `landed` means committed and landed on the thread branch. A run always ends with a commit of whatever it changed, even when it fails or is stopped.

## Tools (the computer's, and ask_captain for crew)

All mutations unless noted. `task` is a task id or a key from plan_tasks; `crew` is a handle.

- `tools.crewStatus` (query) `{ token, runId }` → `{ crew: [{ handle, name, harness, activity, task }], tasks: [{ id, key, title, state, assignee }] }`
- `tools.planTasks` `{ token, runId, tasks }` → `[{ key, taskId, assignee }]`
- `tools.assignTask` `{ token, runId, task, crew? }` → `{ taskId, crew: { handle, name, hired } }`
- `tools.hireCrew` `{ token, runId, name?, harness?, specialty? }` → `{ handle, name, arrivesAt }`
- `tools.messageCrew` `{ token, runId, crew, text }`
- `tools.askCaptain` `{ token, runId, question, options? }` → `{ questionId, requestId }`. The answer arrives in `runner.work` live answers.
- `tools.reviewTask` (query) `{ token, runId, task }` → `{ id, key, title, state, branch, report, crew }`. The runner adds the diff from git.
- `tools.sendBack` `{ token, runId, task, notes }`
- `tools.finishThread` `{ token, runId, title, summary, prUrl }`. After the runner pushed the thread branch and opened the PR (prUrl null when there is no GitHub remote).

## Looks

- `runner.lookResult` (mutation) `{ token, runId, look }`. A designed look (contracts `Look`) for the run's crew member.
