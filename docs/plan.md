# Offsite: the plan

## What it is

One person (the captain) and their crew of coding agents, on a superyacht in the browser. The crew are Claude Code and Codex agents running on the captain's own machine, on the captain's own subscriptions. The captain walks the decks in first or third person, talks to the ship's computer, and watches the crew work and play.

Single player for now. Later, friends come aboard over Ready Player One's peer connections and voice; it is still your ship and your subscriptions.

## Words

| Offsite | Meaning |
|---|---|
| Office | Your ship: a world (the yacht), one or more repos (each a git checkout on one of your machines, with a short name like `web` or `api`), your crew. (Beam's workspace.) |
| Captain | You. |
| Crew member | An agent with an identity: name, look, specialty, and what powers it (harness, model, effort, which account). |
| Ship's computer | The orchestrator. A crew member with role `computer`: a Claude or Codex agent with planning tools. |
| Thread | One conversation with the computer about one piece of work. Its work lands on one branch name, `offsite/<slug>`, in every repo it touches. |
| Task | What the computer hands one crew member, in one repo. Its own worktree and branch. |
| Run | One agent working: a computer turn, a crew member on a task, or a look being designed. |
| Machine | A computer running `offsite` (the runner), paired to your account. |

## How work flows

1. You start a thread, at the helm or on the phone: "add dark mode to the settings page".
2. A computer run starts on the machine that holds the ship's first repo. Its working directory holds a worktree of the thread's branch for each repo on that machine, side by side (`_thread/web`, `_thread/api`). It reads them and uses its tools (contracts `tools.ts`): `plan_tasks`, `assign_task`, `hire_crew`, `message_crew`, `ask_captain`, `review_task`, `send_back`, `finish_thread`, `crew_status`.
3. Each thread looks for someone free. If nobody is, a new crew member is hired and flown in by helicopter.
4. Every task is in one repo. Work that spans repos is a task per repo, ordered with `dependsOn` (the API first, then the UI that calls it). A task starts when everything it depends on has landed and its crew member is free. It runs on its repo's machine, in its own worktree, branched from the thread's branch in that repo (made from the repo's default branch when the first task there starts).
5. When the crew member finishes, the runner lands their commit onto the thread's branch in their repo, one task at a time per repo (rebase, then fast-forward). On a conflict the same crew member resolves it in their worktree.
6. Crew members call `sync_with_team` to pick up what teammates landed. The computer splits work by area, orders dependent tasks, and lands shared types or interfaces first.
7. When everything has landed, the computer reviews and calls `finish_thread`: one branch name, and one pull request in each repo with landed work.
8. Questions (permissions, decisions) go to the captain: the crew member walks over, and the phone buzzes.

Most threads get one crew member. The computer splits work only when it clearly splits.

## The world

- First person and third person (V toggles; scroll in to go first person).
- The helm on the bridge: walk up, press E, and the big console opens: the computer's interface.
- The phone: a foldable (think Galaxy Fold), F to take it out. Closed, its cover screen shows who needs you. Open, it is the computer's interface: threads, starting a new one, the crew tab (what each is doing; "Find" pings them and shows the way).
- A massive office deck: rows of desks. Crew also work from sun loungers under umbrellas with laptops on their laps, from hammocks, at the bar. Idle crew swim, fish off the stern, lean on the rail.
- New crew arrive by helicopter on the helipad and walk out.
- Finished work is carried to the bridge as a package.
- Click a crew member to see their card; the phone shows the same.

Activity → place and pose is data (contracts `activity.ts`, `world.ts` ACTIVITY_SPOTS), shared by the world and the phone.

## Characters

Every crew member can look like anyone. Three ways: ready-made defaults, the customizer (Ready Player One's avatar creator: parts, colours, proportions), or describe it ("an otter in aviators") and the runner designs it from pieces on your own subscription. Looks only: no powers or abilities.

## Streams

Contracts first, then parallel streams that build against them.

| Stream | Owns | What |
|---|---|---|
| Contracts | `packages/contracts`, `convex/schema.ts`, `packages/kit/src/world.ts`, `apps/web/src/bridge.ts` | Shapes every stream shares. |
| World | `packages/kit/src/render`, `worlds/yacht` | Renderer and post-processing, sky and day cycle, ocean, materials; the yacht (decks, office, bridge, pool, loungers, bar, helipad, helicopter), its slots and walking graph. |
| Characters | `packages/kit/src/avatar`, `packages/kit/src/nav`, `packages/kit/src/captain` | Avatars and looks, poses (typing, laptop on lap, sunbathing, hammock, fishing, carrying, slumped, holding the phone), name tags and bubbles; pathfinding; the captain's controls, collision, first and third person camera. |
| Backend | `convex/` | Offices, crew and hiring, machines and pairing, threads, messages, tasks and the scheduler, runs, events, questions, the runner's API, the computer's tools. |
| Runner | `packages/harness`, `packages/git`, `packages/runner` | Claude Code and Codex adapters (from Beam) and the sim crew; worktrees and landing; the `offsite` CLI. |
| Interface | `apps/web/src/{ui,screens,overlay,phone,helm,hud,creator}` | Sign-in, making your ship, connecting your machine, the phone, the helm console, crew cards, questions, the customizer. Design system: Ready Player One's "Bracket". |
| Game | `apps/web/src/game` | The engine loop that puts world, captain and crew together; the director (crew state → where each goes and what they do); helicopter arrivals; pings. |

## Checkpoints

1. **Yacht demo.** Walk the yacht in first or third person; a simulated crew works, lounges, gets flown in, and comes to ask you things.
2. **One real crew member.** Pair your machine; a thread with one task runs on your Claude Code or Codex; the yacht reacts.
3. **The ship's computer.** Threads split across the crew and across repos, landing on one branch name, a pull request per repo.
4. **Make it yours.** Characters, polish.

Later: friends aboard, more worlds, agent-built worlds.
