# The runner's API

What `offsite` (packages/runner, published as `offsite-agents`) calls on Convex. Every function takes the machine's `token` (from device-code pairing, saved in `~/.offsite/runner.json`; `OFFSITE_HOME` moves `~/.offsite`, its config, worktrees and profiles, so two runners can share a computer) and throws a `ConvexError` with a readable message. Shapes for events and tools are in @offsite/contracts.

A ship has one or more repos (`repos.list`), each a checkout on one machine with a short name. A task is in one repo and runs on that repo's machine. Computah (the main orchestrator; its runs have kind `computer`) runs on the machine with the ship's first repo. A thread uses one branch name, `offsite/<slug>-<id6>`, in every repo it touches.

## Pairing (HTTP, on the deployment's `.convex.site` URL)

- `POST /device/start` `{ name, hostname, os? }` → `{ deviceCode, userCode, verifyUrl, interval, expiresIn }`. `os` ("macOS 26.4", "Linux") is shown on the approval page. Print the code, and open the app's approval page, `/pair?code=<userCode>` on `verifyUrl`'s origin (the CLI does this; deployments from before `/pair` answer `/?connect=<userCode>`). Answers 429 `{ error }` when too many machines are pairing at once (a global cap: Convex sees no trustworthy client IP).
- `POST /device/poll` `{ deviceCode }` → `{ status: "pending" | "approved" | "denied" | "expired", token? }`. Poll every `interval` seconds. The token is handed out once.

## The loop

- `runner.hello` (mutation) `{ token, probe, fresh? }` → `{ machineId, owner }`. On start (with `fresh: true`, which fails whatever this machine still had live: a restarted runner holds no sessions) and every 30 s. `probe` is what the harnesses reported: `[{ harness, profile, installed, version, auth, email, plan, models: [{ id, name, efforts }], message }]`; `profile` null is the CLI's default login.
- `runner.work` (query, subscribe to it) `{ token }` → `{ machineId, queued: [{ runId, kind, crewId, createdAt }], live: [{ runId, state, interruptRequested, inbox: [{ id, text }], answers: [{ questionId, requestId, answer }] }] }`. Queued runs are this machine's to claim: a `computer` run (Computah's) when the ship's first repo is here, a task when its repo is here, a look anywhere. Live are runs this machine claimed.
- `runner.claim` (mutation) `{ token, runId }` → `RunContext | null` (null when someone else got it). RunContext:
  - `run: { id, kind, prompt }`
  - `office: { id, name, repos: [{ id, name, path, defaultBranch, setupCommand, here }], repoPath, defaultBranch, setupCommand }`. `here`: the repo is on this machine. `repoPath`, `defaultBranch` and `setupCommand` are the run's repo (the task's, or the first for Computah), for runners from before repos.
  - `crew: { id, name, handle, role, harness, model, effort, profile, specialty }`
  - `thread: { id, title, branch } | null`
  - `task: { id, key, repo, title, brief, notes, branch, dependsOn: [{ key, title, state }] } | null`. `repo` is the name of its repo in `office.repos`.
  - `resumeCursor` (opaque; from the last run of this crew member in this thread/task)
  - `context`: text the agent should know: for Computah, the repos, the thread so far and the crew roster; for a crew member, the thread's title, the repos, and what teammates landed.

Where runs work (under `~/.offsite/worktrees/<officeId>/<thread6>/`): Computah in `_thread/`, a plain folder holding a detached worktree of the thread's branch for each repo on this machine (`_thread/web/`, `_thread/api/`; a repo's default branch until a task there makes the thread branch); each task in `<key>/`, a worktree of its own repo on its own branch. Landing and `sync_with_team` are serialized per (thread, repo).
- `runner.started` (mutation) `{ token, runId, worktree, threadBranch?, taskBranch? }`. The run is working; the branches are recorded (the thread's branch name is the same in every repo).
- `runner.events` (mutation) `{ token, runId, events: RunEvent[] }`. Up to 200 per call. Content deltas coalesced to 100 ms. The backend keeps the reply message, the current step, questions (request.opened) and the resume cursor (session.started) up to date from these. A tool step closes the current reply paragraph, so `content.final` carries only the closing paragraph (the text since the last step), not the whole turn.
- `runner.delivered` (mutation) `{ token, inboxIds?, questionIds? }`. Messages and answers handed to the agent.
- `runner.landing` (mutation) `{ token, runId }`. A task's agent finished; its work is landing on the thread branch (task → review).
- `runner.finish` (mutation) `{ token, runId, outcome: "landed" | "failed" | "interrupted", error?, report?, diff? }`. For a task, `landed` means committed and landed on the thread branch, and `diff` is its size (`{ added, removed, files }`, contracts `ChangeStats`) from its landed commits. `report` is the crew member's account: what they said at the end of each turn, the reply to the brief first, then their replies to steers, with any AI-attribution footer removed (it is also the landed commit's message, under the task's title). A run always ends with a commit of whatever it changed, even when it fails or is stopped; a task's worktree is then left detached, so its branch isn't held checked out, and a send-back checks it out again.

## Tools (Computah's, and ask_captain for crew)

All mutations unless noted. `task` is a task id or a key from plan_tasks; `crew` is a handle (`computah`, or the older `computer`, means Computah itself).

- `tools.crewStatus` (query) `{ token, runId }` → `{ thread: { title, state, branch, prUrl, prs: [{ repo, url, branch }] }, repos: [{ name, defaultBranch, here }], crew: [{ handle, name, harness, specialty, activity, task, repo }], tasks: [{ id, key, repo, title, state, assignee, dependsOn }] }`
- `tools.planTasks` `{ token, runId, tasks: [{ key, title, brief, dependsOn?, assignee?, repo? }] }` → `[{ key, taskId, repo, assignee, state }]`. `repo` is a repo name: optional when the ship has one repo, required otherwise (the error lists them).
- `tools.assignTask` `{ token, runId, task, crew? }` → `{ taskId, crew: { handle, name, hired } }`
- `tools.hireCrew` `{ token, runId, name?, harness?, specialty? }` → `{ handle, name, arrivesAt }`
- `tools.messageCrew` `{ token, runId, crew, text }`
- `tools.askCaptain` `{ token, runId, question, options? }` → `{ questionId, requestId }`. The answer arrives in `runner.work` live answers.
- `tools.reviewTask` (query) `{ token, runId, task }` → `{ id, key, repo, title, brief, state, branch, report, crew, threadBranch }`. The runner adds the diff from git in the task's repo (each landed task is one squashed commit with an `Offsite-Task:` trailer).
- `tools.sendBack` `{ token, runId, task, notes }`
- `tools.finishThread` `{ token, runId, title, summary, prs: [{ repo, url, branch }] }`. After the runner pushed the thread's branch and opened a pull request in each repo with landed work (url null where there is no GitHub remote, or the repo is on another machine). The thread keeps `prs` and, for older clients, `prUrl` (the first url). A bare `prUrl` (runners from before repos) is the first repo's. Refused when a task is unfinished or the thread is already done.

## Looks

- `runner.lookResult` (mutation) `{ token, runId, look }`. A designed look (contracts `Look`) for the run's crew member.

## Reviews: diffs and "Open in editor"

The captain asks to see a task's changes or a thread's (per repo); the runner on the machine holding the repo answers. Shapes in contracts `review.ts`.

- `diffs.work` (query, subscribe to it) `{ token }` → `{ diffs: [{ diffId, knownSha, officeId, threadId, threadBranch, repo: { name, path, defaultBranch }, task: { key, branch } | null }], editors: [{ requestId, ...the same place fields }] }`. Pending diffs and editor requests for this machine.
- `diffs.put` (mutation) `{ token, diffId, result? | unchanged: true | error? }`. `result` is a contracts `DiffResult`: `{ sha, base, stats, files: ChangedFile[], patch, truncated }`, the patch cut at `DIFF_LIMITS.patchChars` (300 KB). A task's diff is its landed commits (or, before landing, its branch against where it left the thread branch); a thread's is its branch against where it left the repo's default branch. `unchanged` when the branch still sits at `knownSha`.
- `diffs.editorDone` (mutation) `{ token, requestId, ok, result }`. The runner opened the task's worktree (else the thread's branch for that repo, else the checkout) with `$OFFSITE_EDITOR`, `code` or `cursor` if on PATH, else the system's opener.
