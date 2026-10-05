# Handoff: Offsite's interface

You are designing and building Offsite's interface: every 2D screen and overlay. Another thread (the "core" thread) is building the backend, the runner, the 3D world and the characters at the same time. Read README.md, AGENTS.md and docs/plan.md first.

## The product, in one breath

You are the captain of a superyacht in your browser. Your crew are Claude Code and Codex agents running on your own machine and subscriptions. You walk the decks in first or third person. You talk to Computah (the main orchestrator), at the helm console on the bridge or on a foldable phone you pull out anywhere, even from a sun lounger. It splits your request into tasks, hands them to free crew (or hires new ones, who arrive by helicopter), and reports back. Crew work at desks or on loungers with laptops; when they need you, they walk over.

## What you own

| Path | What |
|---|---|
| `apps/web/src/ui/` | The design system: tokens, type, the bracket frame, buttons, inputs, lists, cards, keycaps, icons. |
| `apps/web/src/screens/` | Sign-in, "make your ship", connecting your machine (device-code pairing), choosing the project folder, settings. `Gate.tsx` is the router between them. |
| `apps/web/src/overlay/` | `Overlay.tsx`, mounted over the game. Composes the HUD, phone, helm console, crew card, question prompts and toasts. |
| `apps/web/src/phone/` | The foldable phone. |
| `apps/web/src/helm/` | The helm console: the same interface for talking to Computah, as a large screen on the bridge. |
| `apps/web/src/hud/` | Interaction prompts ("E  Open the helm console"), the view hint, ping markers and the compass or edge arrow pointing to a pinged crew member, toasts. |
| `apps/web/src/creator/` | The character customizer UI (the 3D preview comes from @offsite/kit's `buildAvatar`). |

Leave alone: `apps/web/src/game/`, `apps/web/src/bridge.ts` (propose changes; see below), `packages/*`, `worlds/*`, `convex/`. If you need a backend function that is missing, write down the name, args and return in `docs/interface-needs.md` and keep going with a stub.

## How the interface meets the 3D world

Only through `apps/web/src/bridge.ts`, a tiny store both sides read and write (`ui.get()`, `ui.set()`, `useUi(selector)`):

- You set `phone` ("open" / "closed"), `helm`, `threadId`, and `ping` ({ crewId, at }) when the captain hits "Find" on a crew member.
- The game sets `prompt` (what the captain could use right now), `view` ("first" / "third"), `pointerLocked`, and `crewCard` (a crew member clicked in the world).
- While the phone or helm is open the game releases the pointer and ignores movement keys, so typing goes to you. `ui.typing()` says whether you own the keyboard.
- For things that move every frame, `scene.locate(crewId)` returns where a crew member's head is on screen (`{ x, y, onScreen, distance }`), and `scene.captain()` the captain's position. Call them from `requestAnimationFrame` (the ping marker, a card that follows someone); never put them in React state.

Keys: **F** takes the phone out and puts it away (handle it in the overlay; ignore it while typing in an input). **E** uses the thing in `prompt`; the game handles E and sets `helm: true` at the helm. **V** switches the view (game). **Esc** closes the phone or helm first.

To add a field to the bridge, add it in your branch with a comment saying who writes it, and say so in your PR.

## Screens and surfaces

1. **Sign in.** WorkOS AuthKit (`signIn()` in `src/auth.ts`). Locally, `?dev=name` signs you in without WorkOS.
2. **Make your ship.** Name it, pick a world (only "The Yacht" for now; design for more: a card per world with a blurb), meet your starting crew.
3. **Connect your machine.** Run `pnpm runner login --url <this app's CONVEX_URL>` from a checkout of the repo on your computer (the runner isn't on npm yet), then enter the code shown there (or open its link). Then choose the project folder the crew works on (a path on that machine plus its default branch), and the setup command run in each new worktree (e.g. `pnpm install`). Show the machine's probe: which of Claude Code and Codex is installed and signed in.
4. **The phone** (the heart). A Galaxy Fold–style device in the captain's hands.
   - **Closed (cover screen):** the time on the ship, who needs you (question count, the crew member's face and name), the latest report. Tap or press F again to unfold.
   - **Unfolding:** an animated open, hinge in the middle.
   - **Open:** two panes. Left: threads (newest first, each with its state, the crew working on it, a badge when a question waits) and a "New thread" composer at the top; a tab to switch to **Crew**. Right: the open thread. That's your conversation with Computah: your messages, Computah's replies (they stream), its plan as task cards (title, assignee's face, state: todo, doing, review, landed, failed), crew reports, and questions with answer buttons inline.
   - **Crew tab:** everyone aboard with their face, name, harness (Claude Code / Codex), what they are doing (`ACTIVITY_LABEL` in contracts: "Editing", "Off duty", "Needs you"…), the current step ("Edit src/app.tsx"), and which thread/task. Per crew member: **Find** (sets `ping`; the world marks them and shows the way), **Watch** (their live activity log, `runs.events`), **Message**, **Stop**. Plus "Hire" and editing their look and specialty.
5. **Helm console.** The same Computah interface, big, framed as the bridge's main screen. It opens when the game sets `helm: true`.
6. **Crew card.** When `crewCard` is set (clicked in the world): face, name, activity, current step, task, buttons as in the crew tab.
7. **Questions.** A crew member asking is the most important moment. Show it on the phone's cover screen, as a toast with the asker's face, and inline in the thread. Approvals: Allow / Deny. Inputs: the options as buttons, plus free text.
8. **Customizer.** Defaults, parts and colours and proportions (Ready Player One's creator), and "describe it" (a prompt; the look is designed on the captain's own subscription and streams in).
9. **HUD.** Minimal. Interaction prompt, a small view and phone hint, the ping marker (a DOM marker projected over the crew member's head, clamped to the screen edge with an arrow when off screen), toasts.

## Design direction

Concept art for the whole ship is in `docs/art/yacht/`. For you, `ship-deck-details-captain-pov.jpg` is the phone: unfolded in the captain's hands, two panes (threads on the left, the conversation on the right), dark glass, cyan bubbles for the captain's messages. The bridge's helm screen is the same interface, big.

Reuse Ready Player One's design system, "Bracket": dark glass, corner brackets instead of boxes, one cyan accent, Saira (expanded caps for places and titles, condensed tracked caps for labels, normal case for sentences), tabular numbers. The interface never borrows its look from the world behind it.

Ready Player One is cloned at `~/Developer/ready-player-one` (read-only reference):
- `src/style.css`: the whole shell, tokens and the bracket frame (top of file).
- `src/ui/theme.js`: tokens for canvas and three.js too.
- `src/social/screen.js`, `src/social/social.css`: the Social screen, laid out like Discord (rail, list, conversation, members). The closest thing to the phone's open layout.
- `src/social/overlay.js`, `src/social/compass.js`: markers over people and the compass. Pings.
- `src/creator.js`: the avatar creator.
- `src/dialogue.js`: letterboxed dialogue with choices, a possible mood for questions.
- `index.html`: the loading screen.

The phone can be warmer than the shell (it's a device you hold on vacation), but it should clearly be the same family. Make it feel great at 1440×900 and still work on a laptop at 1280×720. Phone-width browsers are out of scope for now.

## Data (Convex)

The backend is live on the dev deployment: every function below exists in `convex/` (`api.<file>.<name>`), with generated types in `convex/_generated/api.d.ts`. Use `useQuery` and `useMutation` from `convex/react`. Read the function itself for the exact return shape. For screens you want to design before there is data (questions, a busy crew), fixtures in `apps/web/src/mock/` are fine. `convex/flow.test.ts` walks a whole thread end to end if you want to see the order things happen in.

| Function | Args | Returns |
|---|---|---|
| `users.me` (query) | | `{ _id, name, avatar, look } \| null`: null until `users.ensure` has run |
| `users.ensure` | | user id; call once after sign-in |
| `users.setAvatar` | `{ avatar, look? }` | |
| `offices.mine` (query) | | your offices |
| `offices.get` (query) | `{ officeId }` | office: `{ name, world, repo: { machineId, path, defaultBranch } \| null, setupCommand, defaultHarness }` |
| `offices.create` | `{ name, world }` | officeId (comes with Computah and three crew aboard) |
| `offices.setRepo` | `{ officeId, machineId, path, defaultBranch }` | |
| `offices.update` | `{ officeId, name?, setupCommand?, defaultHarness? }` | |
| `machines.mine` (query) | | `[{ _id, name, hostname, online, lastSeenAt, probe }]`; probe lists each harness: installed, signed in, version, models |
| `machines.lookup` (mutation: misses are counted) | `{ userCode }` | `{ ok: true, name, hostname } \| { ok: false, error }` |
| `machines.approve` / `machines.deny` | `{ userCode }` | |
| `machines.revoke` | `{ machineId }` | |
| `crew.list` (query) | `{ officeId }` | crew, including Computah (`role: "computer"`, handle `computah`): `{ _id, name, handle, role, avatar, look, specialty, harness, model, effort, arrivesAt }` |
| `crew.hire` | `{ officeId, name?, harness?, avatar?, specialty? }` | crewId; they arrive by helicopter |
| `crew.update` | `{ crewId, name?, avatar?, look?, specialty?, harness?, model?, effort? }` | |
| `crew.dismiss` | `{ crewId }` | |
| `crew.describeLook` | `{ crewId, prompt }` | queues a look design on your machine |
| `world.snapshot` (query) | `{ officeId }` | `{ crew: CrewView[], questions: Question[] }`. CrewView = crew + `live: { runId, kind, state, threadId, threadTitle, taskId, taskTitle, step: { kind, summary, since } \| null } \| null`, `lastEnded: { state, endedAt } \| null`, `asking: boolean`, `lastStep: string \| null`. Feed it to `crewActivity` (contracts) for the label. |
| `threads.list` (query) | `{ officeId }` | `[{ _id, title, state, branch, prUrl, lastMessageAt, crewIds, tasks: { total, landed }, openQuestions }]` |
| `threads.rename` | `{ threadId, title }` | |
| `runs.forThread` (query) | `{ threadId }` | the thread's runs, newest first |
| `questions.open` (query) | `{ officeId }` | open questions with `crewName`, `crewHandle` |
| `users.setName` | `{ name }` | |
| `threads.create` | `{ officeId, text }` | threadId; Computah starts on it |
| `threads.send` | `{ threadId, text }` | |
| `threads.archive` | `{ threadId }` | |
| `messages.list` (query) | `{ threadId }` | `[{ _id, author: { kind: "captain" } \| { kind: "crew", crewId } \| { kind: "system" }, kind: "text" \| "report" \| "plan" \| "system", text, streaming, taskId, createdAt }]` |
| `tasks.list` (query) | `{ threadId }` | `[{ _id, key, title, brief, assignee, state, dependsOn, report }]` |
| `runs.events` (query) | `{ runId }` | `[{ seq, at, event: RunEvent }]` for the Watch view |
| `runs.interrupt` | `{ runId }` | |
| `questions.answer` | `{ questionId, answer }` | |

Shared types and helpers are in `@offsite/contracts`: `crewActivity`, `ACTIVITY_LABEL`, `RunEvent`, `AvatarSpec`, `DEFAULT_AVATAR`, `TaskState`, `ThreadState`.

## Running and looking

```
pnpm install
pnpm dev                 # http://localhost:5180/?dev=yourname (dev sign-in is set up on the dev deployment)
```

`.claude/launch.json` has a `web` configuration for the in-app browser preview. Until the game lands, the overlay sits over a dark canvas. A scripted crew (`pnpm sim`) will make the data move once the runner lands.

## Working alongside the core thread

- Work on a branch (`interface/...`) in your own worktree, and open PRs to `main`. The core thread commits to `main` in `~/Developer/offsite-agents`.
- Stay inside the paths you own. `apps/web/package.json` is shared: add dependencies sparingly and mention them in the PR.
- TypeScript, React 19, no CSS framework needed (Bracket is plain CSS with custom properties). Keep the bundle lean; the 3D world is heavy already.
- Run `pnpm --filter @offsite/web typecheck` before each PR.
- Commit messages: imperative mood, no AI attribution footers.
