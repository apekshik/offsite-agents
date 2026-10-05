<div align="center">

# Offsite Agents

**Take your coding agents on an offsite: a superyacht in your browser, crewed by your own Claude Code and Codex.**

[![License: MIT](https://img.shields.io/badge/license-MIT-e8a33d)](LICENSE)
[![Claude Code](https://img.shields.io/badge/crew-Claude%20Code-d97757)](https://claude.com/claude-code)
[![Codex](https://img.shields.io/badge/crew-Codex-10a37f)](https://github.com/openai/codex)
[![Convex](https://img.shields.io/badge/backend-Convex-c2410c)](https://www.convex.dev)
[![three.js](https://img.shields.io/badge/world-three.js-1f6f8b)](https://threejs.org)

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="docs/media/hero-poster.webp">
  <img src="docs/media/hero-loop.webp" alt="The crew on board: banter at the bar, a cannonball into the pool, phones buzzing as work comes in, and the office lit up at night" width="100%">
</picture>

### Life on board

<table>
<tr>
<td width="50%"><img src="docs/media/life-bar.webp" alt="Wren at the bar at sunset, her speech bubble: something with no merge conflicts" width="100%"></td>
<td width="50%"><img src="docs/media/life-hottub.webp" alt="Kofi, Marlo and Ines in the hot tub: this is nice, warmer than prod" width="100%"></td>
</tr>
<tr>
<td align="center">Pike: "What'll it be?" Wren: "Something with no merge conflicts."</td>
<td align="center">The hot tub. "This is nice." "Warmer than prod."</td>
</tr>
<tr>
<td><img src="docs/media/life-cannonball.webp" alt="Bodhi mid-air over the pool, Coral shouting BODHI!" width="100%"></td>
<td><img src="docs/media/life-gym.webp" alt="Bodhi on the weight bench and Lumi on the treadmill: is it DNS? it's always DNS" width="100%"></td>
</tr>
<tr>
<td align="center">Bodhi's cannonball. Coral and Teo get soaked.</td>
<td align="center">The gym. "Is it DNS?" "It's always DNS."</td>
</tr>
<tr>
<td><img src="docs/media/life-scramble.webp" alt="Phones buzzing at the bar and the hot tub as work comes in, someone calling coming!" width="100%"></td>
<td><img src="docs/media/life-night.webp" alt="The office at night, crew at their desks under the wall board, Otis saying green across the board" width="100%"></td>
</tr>
<tr>
<td align="center">You ask for something. Their phones buzz, and drinks go down.</td>
<td align="center">Night in the office. Otis: "Green across the board."</td>
</tr>
</table>

</div>

<br>

Agents are better company than a wall of terminal text. Offsite puts yours on a yacht.

You're the captain. Take the foldable phone out of your pocket, or walk up to the helm, and ask
Computah (the main orchestrator) for something. Computah helps you manage your crew: it reads your
repos, plans the work and hands it to whoever is free; if everyone is busy it hires someone, and they
arrive by helicopter. It checks what the crew land before it goes in. The crew are real Claude Code
and Codex agents, running on your own subscriptions through a small runner on your machine, each in
its own git worktree. Finished work turns up as a package on the bridge counter. Off duty, they hang
out at the bar, swim, fish off the stern and trade bad jokes in the hammocks.

No API keys, and Offsite never stores a provider credential: the runner starts the `claude` and
`codex` you're already signed in to.

**[Come aboard at offsiteagents.app](https://offsiteagents.app)** · [Watch the launch video](#TODO-launch-video)

<br>

## How a thread plays out

<table>
<tr>
<td width="50%" valign="top">

**1. You ask.** Press <kbd>F</kbd> twice to unfold the phone, or press <kbd>E</kbd> at the helm,
and tell Computah what you want: "add dark mode and a billing page".

<img src="docs/media/thread-1-ask.webp" alt="The unfolded phone at sunset, asking Computah for dark mode and a billing page" width="100%">

</td>
<td width="50%" valign="top">

**2. Computah plans.** It reads the repos, splits the work into tasks (one repo each, in the
right order) and hands each to someone free. Everyone busy? It hires.

<img src="docs/media/thread-2-plan.webp" alt="Computah's plan: eight tasks across the web and api repos, each with a crew member" width="100%">

</td>
</tr>
<tr>
<td width="50%" valign="top">

**3. New crew fly in.** A new hire steps off the helicopter on the bow, already reading their brief,
and heads for a desk.

<img src="docs/media/thread-3-crew.webp" alt="Ezra, a new hire, stepping off the helicopter onto the helipad" width="100%">

</td>
<td width="50%" valign="top">

**4. The crew work.** Each crew member codes in their own worktree on your machine. Name tags and
desk screens say what they're doing right now, and the office lights up with them.

<img src="docs/media/thread-4-work.webp" alt="The office deck at night, crew at their desks with live status tags" width="100%">

</td>
</tr>
<tr>
<td width="50%" valign="top">

**5. Work lands, one task at a time.** Each finished task is rebased onto the thread's branch and
delivered as a package. Open it for the real diff, file by file.

<img src="docs/media/thread-5-review.webp" alt="The phone's diff viewer showing a landed task's changes" width="100%">

</td>
<td width="50%" valign="top">

**6. A pull request in every repo.** When everything has landed, Computah reviews and finishes
the thread: one branch name, one PR per repo it touched.

<img src="docs/media/thread-6-pr.webp" alt="A finished thread: every task landed, with pull requests in the web and api repos" width="100%">

</td>
</tr>
</table>

<br>

## Meet the crew

<img src="docs/media/cast.webp" alt="The crew lined up on the helipad at golden hour" width="100%">

Anyone can join. Each crew member has a name, a look, a specialty and what powers them: Claude Code
or Codex, a model, an effort level, which of your accounts. Most threads get one crew member;
Computah splits work only when it clearly splits. When someone needs a decision or a permission,
they walk over to you and your phone buzzes.

<table>
<tr>
<td width="33%"><img src="docs/media/crew-card.webp" alt="Wren's crew card over her desk: editing, fixing a flaky checkout test" width="100%"></td>
<td width="33%"><img src="docs/media/phone.webp" alt="The phone's crew tab, watching Otis's tool calls live" width="100%"></td>
<td width="33%"><img src="docs/media/helm.webp" alt="The helm console: threads, the conversation and who is aboard" width="100%"></td>
</tr>
<tr>
<td><b>Crew cards.</b> Click anyone to see what they're on.</td>
<td><b>The phone.</b> Threads, the crew tab, your ship. Watch any crew member's every step.</td>
<td><b>The helm.</b> The same, on the bridge's big screen, with who's waiting on you.</td>
</tr>
</table>

<br>

## The yacht

<a href="docs/media/hero@2x.webp"><img src="docs/media/hero.webp" alt="The Offsite superyacht cruising through open water at golden hour, helipad on the bow" width="100%"></a>

<table>
<tr>
<td width="50%"><img src="docs/media/yacht-sunset-aerial.webp" alt="The yacht from above at sunset, its wake trailing behind" width="100%"></td>
<td width="50%"><img src="docs/media/yacht-sunset-sundeck.webp" alt="The sun deck at sunset: the pool, the hot tub and the round bar" width="100%"></td>
</tr>
<tr>
<td><b>Under way.</b> About 140 metres of yacht on an open sea, on a 30-minute day.</td>
<td><b>The sun deck.</b> The pool, the hot tub, the bar. Where the crew go when the work runs out.</td>
</tr>
<tr>
<td><img src="docs/media/yacht-sunset-office.webp" alt="The glass-walled office deck with rows of desks, the sun setting through it" width="100%"></td>
<td><img src="docs/media/yacht-sunset-stern.webp" alt="The stern and swim platform at sunset" width="100%"></td>
</tr>
<tr>
<td><b>The office.</b> Thirty-six desks behind glass, with loungers and hammocks on the promenade below.</td>
<td><b>The stern.</b> The swim platform, the beach club and a rod for whoever is fishing.</td>
</tr>
</table>

<table>
<tr>
<td width="50%"><img src="docs/media/yacht-night-aerial.webp" alt="The yacht from above at night, deck lights on" width="100%"></td>
<td width="50%"><img src="docs/media/yacht-night-sundeck.webp" alt="The sun deck at night under string lights, the pool glowing" width="100%"></td>
</tr>
<tr>
<td><img src="docs/media/yacht-night-office.webp" alt="The office deck at night" width="100%"></td>
<td><img src="docs/media/yacht-night-stern.webp" alt="The stern at night, lit from inside" width="100%"></td>
</tr>
</table>

The ship tells you how busy it is before you read a word: the office and bridge lights, the radar
and the wake all pick up when work is out. Below the waterline there's more: a beach club, a gym, a
cinema, a sauna, the crew mess, and behind a glass wall the server room, where Computah lives as a
column of light that brightens when it thinks.

<br>

## Proven with real agents

Not a mockup. In this run, a Claude Code crew member and a Codex crew member worked side by side on
a small sample site, on the captain's own subscriptions:

> Add a counter page with a big + button, and a dark mode toggle for the whole site. They're separate
> pieces, so put two crew on them side by side.

Computah (on Claude Code) planned two tasks and gave them a shared contract: which CSS variables
the theme defines, and who touches which part of `index.html`. **Indy** (Claude Code) built the
counter page with its own script, styles and 8 tests (+208 −0, 6 files). **Arlo** (Codex) built
site-wide dark mode (+133 −5, 7 files), pausing once for a permission the captain allowed. When
Indy's work landed, Computah reviewed it and steered Arlo mid-task to cover the new page too.
The thread finished about six minutes after it was asked: **+341 −5 across 10 files, 12 of 12 tests
passing** on the merged branch. The sample repo had no GitHub remote, so it ended on a local branch
instead of a pull request.

<table>
<tr>
<td width="33%"><img src="docs/media/real-ask.webp" alt="The real thread on the phone: the captain's ask and Computah's two-task plan" width="100%"></td>
<td width="33%"><img src="docs/media/real-working.webp" alt="Arlo, a Codex crew member, working on dark mode, with his live tool calls" width="100%"></td>
<td width="33%"><img src="docs/media/real-off-duty.webp" alt="Indy's card after delivering: off duty in the hot tub, changes +208 −0" width="100%"></td>
</tr>
<tr>
<td>The ask, and Computah's plan.</td>
<td>Arlo on Codex, mid-task.</td>
<td>Indy, delivered and off duty in the hot tub.</td>
</tr>
<tr>
<td><img src="docs/media/real-diff.webp" alt="The whole thread's diff: +341 −5 in 10 files" width="100%"></td>
<td><img src="docs/media/real-app-light.webp" alt="The finished counter page in light mode, showing 7" width="100%"></td>
<td><img src="docs/media/real-app-dark.webp" alt="The same page in dark mode" width="100%"></td>
</tr>
<tr>
<td>The thread's diff, from the bridge.</td>
<td>What they built.</td>
<td>And the toggle working.</td>
</tr>
</table>

What the runner printed (paths shortened, account emails removed):

```
Offsite Agents v0.1.0 · MacBook Pro
  ✓ Claude Code   Claude Max
  ✓ Codex         ChatGPT Pro

[8fqv3f] Indy · counter-page: working in ~/.offsite/worktrees/…/counter-page on offsite/add-a-counter-page-with-a-big-8fp0st-counter-page (claude)
[8fp5q7] Arlo · dark-mode: working in ~/.offsite/worktrees/…/dark-mode on offsite/add-a-counter-page-with-a-big-8fp0st-dark-mode (codex)
[8fqv3f] Indy · counter-page: landed e5a4059d on offsite/add-a-counter-page-with-a-big-8fp0st
[8fp5q7] Arlo · dark-mode: landed 78153da2 on offsite/add-a-counter-page-with-a-big-8fp0st
diff for thread in counter-app: +341 -5 in 10 files
```

<br>

## Safe on your repos

Offsite is built to point at code you care about.

- **A worktree per task.** Every task runs in its own git worktree under `~/.offsite/worktrees`, on
  its own branch. Your checkout is never where an agent works.
- **Landing one task at a time.** Finished work is rebased onto the thread's branch and
  fast-forwarded, one task at a time per repo. On a conflict, the crew member who just finished
  resolves it in their own worktree.
- **Nothing pushed until the thread finishes.** Offsite pushes the thread's branch and opens the pull
  requests only when Computah finishes the thread. Until then it's all local.
- **You answer the permission prompts.** Anything the crew's policy doesn't settle becomes a question
  for you: the crew member walks over, the phone buzzes, and you choose allow, always allow or deny.
- **No stored credentials.** The runner starts your own `claude` and `codex` with their own logins and
  only asks them what they're signed in to. All Offsite keeps on your machine is the pairing token in
  `~/.offsite/runner.json`.
- **Your ship, your machines.** A crew only ever runs on its owner's paired machines, never on
  Offsite's servers.
- **Finding your repos only when you ask.** When you add a repo, the runner looks for git repos in
  the usual places (`~/Developer`, `~/code`, `~/Projects`…) or lists one folder you browse to. It
  sends back folder names, branches and remotes as `owner/repo` (never a URL with a token in it,
  never file names), only you can read them, and they are deleted after 10 minutes.
- **Pairing you approve.** A machine joins with a short device code you approve in the app. Codes
  expire after 15 minutes, wrong guesses are rate limited per captain, and new pairings are rate
  limited overall.
- **Stopping keeps the work.** A run always ends with a commit of whatever it changed, even when it
  fails or you press Ctrl-C.

<br>

## Quick start

### Hosted

**You need** Node 22.18+, git, and [Claude Code](https://claude.com/claude-code) or
[Codex](https://github.com/openai/codex) (or both) installed and signed in on the computer that has
your code. For pull requests, a signed-in [GitHub CLI](https://cli.github.com) (`gh`).

1. Sign in at [offsiteagents.app](https://offsiteagents.app) and name your ship.
2. On the computer your crew will run on:

   ```sh
   npx https://offsiteagents.app/offsite-agents.tgz
   ```

   It opens your browser to approve this machine (one click), then starts taking work right away.
   Keep it running: this is your crew. Next time, the same command just starts.

3. Add a repo (a folder on that machine) from the phone's Ship tab, then ask Computah for
   something.

`status` shows whether it's paired and running and what's signed in; `install` keeps it running in
the background from login (a LaunchAgent on macOS, a systemd user unit on Linux; `uninstall` undoes
it); `profile add <claude|codex> <name>` adds another account, and `--help` lists the rest. Add any
of these after the command above.

npx keeps its first download, so to update, `rm -rf ~/.npm/_npx` and run it again.

### Local

Run the whole thing yourself against your own [Convex](https://www.convex.dev) dev deployment:

```sh
pnpm install
pnpm dev:backend          # once, then leave it running: your Convex dev deployment (writes .env.local)
node scripts/devauth.mjs  # once: lets ?dev=name sign you in locally
pnpm dev                  # http://localhost:5180/?dev=yourname
pnpm sim                  # in another terminal: a scripted crew, no CLI, no spending
```

The sim crew plays the whole loop with small, real git changes in a repo you add (plans, questions,
landings, deliveries, finished threads) without touching a subscription. For real agents,
`pnpm runner` (the CLI from source: pair if needed, then start) picks up your dev deployment from
`.env.local`. The published CLI never reads `.env.local`; point it at a dev or self-hosted deployment
with `OFFSITE_URL=https://<deployment>.convex.cloud npx https://offsiteagents.app/offsite-agents.tgz` (or `--url`). Deploying your
own copy: [docs/deploy.md](docs/deploy.md).

<br>

## Controls

| Key | What it does |
|---|---|
| <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or arrows | Walk |
| <kbd>Shift</kbd> | Jog |
| <kbd>Space</kbd> | Jump |
| Mouse | Look around. Click the world to grab the mouse; <kbd>Esc</kbd> lets go |
| Click a crew member | Their card: what they're doing and their latest changes |
| Click a package | Open its changes |
| <kbd>V</kbd> | Switch between first and third person |
| Scroll | Zoom (all the way in is first person) |
| <kbd>F</kbd> | Take the phone out (half view) or put it away |
| <kbd>F</kbd> <kbd>F</kbd> | Unfold the phone |
| <kbd>Esc</kbd> | Close the helm, the phone or a card |
| <kbd>E</kbd> | Use what's in front of you: the helm, a package on the counter, a desk's last delivery |
| <kbd>M</kbd> | Mute or unmute |

<br>

## How it works

```mermaid
flowchart LR
    subgraph browser ["Your browser (apps/web)"]
        World["The yacht, captain, crew<br/>(three.js)"]
        UI["Phone, helm, crew cards<br/>(React)"]
    end
    Convex[("Convex<br/>ships, threads, tasks,<br/>runs, events, questions")]
    subgraph machine ["Your machine"]
        Runner["offsite runner<br/>(packages/runner)"]
        Claude["claude CLI<br/>(your login)"]
        Codex["codex CLI<br/>(your login)"]
        Trees["git worktrees<br/>one per task"]
        Repo[("Your repos")]
    end
    GitHub["GitHub<br/>pull requests"]
    browser <-->|"queries and mutations"| Convex
    Runner <-->|"claims work, streams events"| Convex
    Runner --> Claude
    Runner --> Codex
    Claude --> Trees
    Codex --> Trees
    Trees -->|"land one task at a time"| Repo
    Repo -->|"push and gh, when a thread finishes"| GitHub
```

- **The browser never talks to your machine.** Both talk to Convex: the app writes what you ask for;
  the runner picks up the work, starts your own `claude` or `codex`, and streams back what they do.
- **The runner** (`offsite`, in `packages/runner`) pairs with a device code, claims runs for the
  repos it holds, makes the worktrees, runs the harness adapters, lands finished work and opens pull
  requests. Every harness event is normalized to one `RunEvent` shape, and text deltas are coalesced
  to 100 ms before they reach Convex.
- **Computah** is a crew member too (role `computer` in the code; its turns are `computer` runs,
  and the crew mention it as `@computah`): a Claude Code or Codex agent with planning tools
  (`plan_tasks`, `assign_task`, `hire_crew`, `message_crew`, `ask_captain`, `review_task`,
  `send_back`, `finish_thread`). Crew members get `sync_with_team` to pick up what teammates landed.
- **The world** is data-driven. A world marks where things can happen (desks, loungers, the bar, the
  helipad); the app's director decides who goes where from what each crew member is doing.

More: [docs/plan.md](docs/plan.md) (the design) and [docs/runner-api.md](docs/runner-api.md) (what
the runner calls).

<br>

## Costs

Nothing beyond the subscriptions you already have. The crew run on your Claude and ChatGPT plans
through your own CLIs, so their work counts toward your plan's usage like any session you'd start
yourself. Offsite's hosting is free to use, and the sim crew is free everywhere.

<br>

## Make your own world

The yacht is the first world, not the only one. A world is a folder in `worlds/` that builds a
place and marks where things can happen; it never reads Offsite's state. An office on Mars or a
station in orbit is a contribution away.

1. Make `worlds/<name>` a workspace package (copy `worlds/yacht/package.json`) that exports a
   `WorldModule` ([packages/kit/src/world.ts](packages/kit/src/world.ts)): an `id`, a `name`, a
   one-line `blurb`, and `build(ctx)`, which returns the scene, colliders, interactables and layout.
2. Mark the layout ([packages/contracts/src/world.ts](packages/contracts/src/world.ts)): slots by
   kind (`desk`, `lounger`, `bar-stool`, `pool`, `rail`, `helm`, `computer`, `dropoff`, `helipad`,
   `crew-spawn`, `captain-spawn` and the rest) and a walking graph between them.
3. Add an interactable with the id `helm` for Computah's console, fly arrivals in from
   `setArrivals`, and, if you like, show how busy the ship is in `setBusy`.
4. Register it in `WORLDS` in [apps/web/src/game/Game.tsx](apps/web/src/game/Game.tsx) and offer it
   in the picker in [apps/web/src/screens/Gate.tsx](apps/web/src/screens/Gate.tsx).

The world viewer at `http://localhost:5180/dev/world.html` (source in
[apps/web/dev/world.ts](apps/web/dev/world.ts)) shows a world's slots and walking graph, scrubs the
time of day and seats crew for checking scale. See [CONTRIBUTING.md](CONTRIBUTING.md).

<br>

## Project layout

| Path | What lives there |
|---|---|
| [`apps/web`](apps/web) | The app: the 3D world, the phone, the helm console, crew cards. Vite, React for the interface, three.js for the world. |
| [`convex`](convex) | The backend: ships, crew and hiring, machines and pairing, threads, tasks, runs, events, questions, Computah's tools. |
| [`packages/runner`](packages/runner) | `offsite`, the CLI that runs your crew on your machine. |
| [`packages/harness`](packages/harness) | The Claude Code and Codex adapters, plus the scripted sim crew. |
| [`packages/git`](packages/git) | Thread branches, a worktree per task, landing one task at a time, pull requests. |
| [`packages/contracts`](packages/contracts) | Shared shapes: run events, crew activity, tools, looks, world slots. |
| [`packages/kit`](packages/kit) | The 3D kit: rendering, sky and water, avatars and poses, walking, the captain's camera. |
| [`worlds/yacht`](worlds/yacht) | The superyacht. |
| [`scripts`](scripts) | Dev sign-in, the film rig, sound generation, README pictures. |
| [`docs`](docs) | The plan, the runner's API, deploying, art. |

<br>

## Development

```sh
pnpm test         # every package's tests, plus the backend's (convex-test)
pnpm typecheck
pnpm build        # the web app, into apps/web/dist
```

The pictures in this README come from the film rig, which renders the real game and interface on a
scripted ship with a virtual clock:

```sh
pnpm film:stills                  # .shots/film/stills/*.png (needs Chrome and ffmpeg)
node scripts/readme-media.mjs     # docs/media/*.webp, sized for the README (needs cwebp)
```

Backend changes go to your own dev deployment (`pnpm dev:backend`), never to production. Start
with [AGENTS.md](AGENTS.md) for the house rules and [CONTRIBUTING.md](CONTRIBUTING.md) for the rest.

<br>

## Status

Offsite is young. Today it is:

- **Single player.** Your ship, your crew. Friends coming aboard is planned.
- **One world,** the yacht. Mars and space are next, and open to anyone who wants to build them.
- **Runner from the site.** Until the npm package (`offsite-agents`) is published, `npx` installs it from offsiteagents.app.
- **Run on macOS so far.** Linux and Windows haven't been tried.

Issues and ideas are welcome.

<br>

## Credits and license

[MIT](LICENSE). Offsite builds on these projects; [NOTICE](NOTICE) has the details.

- **[Ready Player One](https://github.com/apekshik/ready-player-one)**: the 3D kit (rendering, sky,
  materials, avatars, poses, collision), the "Bracket" design system and dev sign-in.
- **[Beam](https://github.com/SupraluminalIntelligence/beam)** (MIT): the Claude Code and Codex
  adapters, normalized run events and the runner's shape. Beam's runner vendors part of
  **[T3 Code](https://github.com/pingdotgg/t3code)** (MIT); any piece carried over keeps its license
  file alongside it.
- **[AgentCraft](https://github.com/blendi-remade/agentcraft)** (MIT): ideas only: a lead that plans
  and workers in their own worktrees, a scripted team for demos without API usage, and the shape of
  this README.
- **Sound and music** were generated for Offsite on [fal.ai](https://fal.ai) with ElevenLabs Sound
  Effects v2 and Eleven Music. Every file's model, prompt and terms are in
  [assets/audio/CREDITS.md](assets/audio/CREDITS.md).

Offsite isn't affiliated with Anthropic or OpenAI. Claude Code and Codex are their makers'
trademarks, and you use them under your own accounts and their terms.
