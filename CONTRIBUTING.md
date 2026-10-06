# Contributing to Offsite

Thanks for coming aboard. You don't need an account, a backend or any agents to work on Offsite's interface: demo
mode runs the real app in your browser against a pretend ship. Start there; go deeper only when your change needs it.

The house rules are in [AGENTS.md](AGENTS.md) (they apply to people and agents alike), and the design decisions are
in [docs/plan.md](docs/plan.md). Those are settled; build on them rather than re-arguing them in code. Everyone here
follows the [Code of Conduct](CODE_OF_CONDUCT.md).

- [Five minutes to a pull request](#five-minutes-to-a-pull-request)
- [Demo mode and the UI gallery](#demo-mode-and-the-ui-gallery)
- [The design system](#the-design-system)
- [Adding a world](#adding-a-world)
- [Running the real backend](#running-the-real-backend)
- [The runner and the sim crew](#the-runner-and-the-sim-crew)
- [Checks, CI and screenshots](#checks-ci-and-screenshots)
- [For maintainers: testing a pull request locally](#for-maintainers-testing-a-pull-request-locally)
- [Commits and credit](#commits-and-credit)

Looking for something to do? [docs/good-first-issues.md](docs/good-first-issues.md) lists small, real tasks.

## Five minutes to a pull request

You need Node 22.18+ and pnpm 10 (`corepack enable` gives you the pinned pnpm).

```sh
git clone https://github.com/apekshik/offsite-agents.git   # or your fork
cd offsite-agents
pnpm i
pnpm dev:demo                 # http://localhost:5190
```

That's the whole app, aboard the yacht, with a crew that responds to you. Press <kbd>F</kbd> twice to unfold the
phone and ask Computah for something ("add a billing page and a usage chart"). Computah replies and plans, the crew
leave the bar for their desks, someone asks you for permission, work lands as packages with real-looking diffs, and
the thread finishes with pull requests. Nothing is real: it all happens in your browser.

1. **Edit a component.** Open, say, [apps/web/src/phone/Conversation.tsx](apps/web/src/phone/Conversation.tsx) or
   [apps/web/src/ui/ui.css](apps/web/src/ui/ui.css). Vite reloads the page as you save.
2. **See it in every state.** The **Demo** badge (bottom right) jumps to any state: the landing page, each step of
   the way aboard, the phone's tabs, the helm, a diff, night. Or open the UI gallery,
   [localhost:5190/gallery.html](http://localhost:5190/gallery.html), for the main screens side by side.
3. **Run the checks.**

   ```sh
   pnpm typecheck
   pnpm test
   ```

4. **Open a pull request.** Attach before and after screenshots of what you changed (the template asks). CI also
   takes screenshots of the gallery and the demo on every pull request and links them in a comment. A maintainer
   then pulls your branch, tries it, and merges.

Keep pull requests small and about one thing. If you're planning something big (a new world, a new screen), open an
issue first so we can agree on the shape.

## Demo mode and the UI gallery

Demo mode is a second entry to the same app: [apps/web/demo.html](apps/web/demo.html) and
[apps/web/src/demo](apps/web/src/demo). The production app ([apps/web/index.html](apps/web/index.html)) is untouched.

- **How it works.** [vite.demo.config.ts](apps/web/vite.demo.config.ts) swaps two modules: `src/convex.ts` (the
  Convex client) for an in-browser fake ([src/demo/backend.ts](apps/web/src/demo/backend.ts), built on
  [src/fake/client.ts](apps/web/src/fake/client.ts), the same fake the film rig uses), and `src/auth.ts` for a sign-in
  that just signs you in. Every component keeps its own `useQuery` and `useMutation`; they talk to the fake instead.
- **The ship** is [src/demo/ship.ts](apps/web/src/demo/ship.ts): the film's scripted cast and evening
  ([src/film/story.ts](apps/web/src/film/story.ts)) as a base, in real time, plus whatever you do. Every thread you
  start gets a scripted Computah, a plan, crew who scramble to it (or a new hire on the helicopter), questions,
  landings, diffs and pull requests.
- **States.** `/?state=<name>` starts somewhere other than the deck: `landing`, `onboarding-ship`,
  `onboarding-machine`, `onboarding-repos`, `working`, `question`, `phone-open`, `phone-crew`, `phone-ship`, `review`,
  `finished`, `helm`, `crew-card`, `hire`, `creator`, `night` and more ([src/demo/states.ts](apps/web/src/demo/states.ts)).
  **Reset** starts the state over. `&t=21.5` sets the hour, `&quality=low` draws the world cheaply, `&hold=3` stops
  the ship's clock three seconds in (for steady screenshots). `&world=moon-base` puts the demo's ship in another ready
  world (`/?world=moon-base&state=night`); the states keep it as you click through them.
- **The gallery** ([apps/web/gallery.html](apps/web/gallery.html), cells in
  [src/gallery/cells.tsx](apps/web/src/gallery/cells.tsx)) renders the real components on fixture data, one state
  per cell, without the 3D world: the phone's tabs, the cover, crew cards, toasts, the helm, the diff viewer, each step
  of the way aboard, and empty and error states. `?cell=<name>` shows one cell full size. Adding a screen or a state?
  Add a cell.
- **Keeping it honest.** The fake has to answer every Convex function the interface uses.
  [src/demo/coverage.test.ts](apps/web/src/demo/coverage.test.ts) fails when a component uses one the demo doesn't
  answer, or the demo answers one the backend no longer has. If you add a query or mutation, add its answer to
  `QUERIES` or `MUTATIONS` in `ship.ts`; anything unknown just warns in the console.
- **A static copy.** `pnpm build:demo` writes it to `apps/web/dist-demo` (the demo as `index.html`, plus
  `gallery.html`). Serve that folder with anything; nothing in it talks to a server.

## The design system

Offsite's interface is calm: dark glass over the world, one accent colour, few words. The reference screens are in
[docs/design/interface](docs/design/interface) (see its [README](docs/design/interface/README.md)); the pieces are in
[apps/web/src/ui](apps/web/src/ui) (`index.tsx` for the components, `ui.css` for the tokens).

- **Tokens** (`:root` in `ui.css`): `--accent` cyan `#4fe3ff`, `--amber` `#ffc861`, `--green` `#6dffa8`, `--red`
  `#ff5d6c`, `--ink`, `--ink-2`, `--dim`, `--faint` for text, `--glass`, `--line`, `--fill` for surfaces, `--radius`
  8px. Use the variables, not new colours.
- **Colour means state, everywhere**: cyan working, amber needs you, green landed, grey off duty, red failed or stop.
  `activityTone` in `ui/index.tsx` maps a crew member's activity to its tone. Don't use a state colour for decoration.
- **Type**: Saira for everything, JetBrains Mono for code, commands, branches and paths. Sentence case. Labels
  (`.lab`) are small caps-style uppercase; titles use `.disp`.
- **Surfaces**: hairline cards (`Card`, 1px `--line` border, 8px radius) on dark glass. Compact spacing.
- **Words**: short, plain, specific. "Wren needs you", not "Action required". Say what happened and what to do next.
  No exclamation marks.
- **Motion**: small and quick (`.fade-up` is 0.22s). Respect `prefers-reduced-motion`.
- **Components** before CSS: `Button` (kinds `primary`, `soft`, `ghost`, `amber`, `danger`…), `ConfirmButton` for
  anything that stops or removes, `Field` and `Input`, `Chip`, `Pill`, `Dot`, `Face`, `RichText`.

The interface never imports the 3D game and the game never imports the interface: they meet in
[apps/web/src/bridge.ts](apps/web/src/bridge.ts).

## Adding a world

A world is a workspace package in `worlds/<name>` that builds a place and marks where things can happen. It never
reads Offsite's state; the app decides who goes where. There are two to learn from: the yacht
([worlds/yacht](worlds/yacht)) and the moon base ([worlds/moon-base](worlds/moon-base), whose layout builds and is
tested without a browser).

1. Copy `worlds/yacht/package.json` and export a `WorldModule` ([packages/kit/src/world.ts](packages/kit/src/world.ts)):
   `id`, `name`, `blurb`, and `build(ctx)` returning the scene root, colliders, interactables and layout.
2. Mark the layout ([packages/contracts/src/world.ts](packages/contracts/src/world.ts)): slots by kind (desks,
   loungers, the helm, the `computer` slot where Computah floats, the drop-off, the helipad, spawn points and places to
   hang out) and a walking graph. `ACTIVITY_SPOTS` there says which kinds each activity uses.
3. Give the helm an interactable with the id `helm`, fly new crew in from `setArrivals` (the kit's `planFlights`
   groups the touchdowns into flights), and show how busy the ship is in `setBusy` if you like. A world can also say
   how the captain moves there (`captain`: the moon's low gravity) and what it sounds like (`soundscape`).
   Slot tags the app reads: `leisure` (time off only), `low-g`, `place:<where>` and `pastime:<what>`.
4. Register it in `WORLDS` in [apps/web/src/game/Game.tsx](apps/web/src/game/Game.tsx), in the picker
   ([apps/web/src/worlds.ts](apps/web/src/worlds.ts), shown by `screens/Gate.tsx`, with the words the interface uses
   for it) and in `ARRIVES_BY` in [convex/crewlib.ts](convex/crewlib.ts), so a ship can be made in it.
5. Check it in the **world viewer**, `http://localhost:5190/dev/world.html` (with `pnpm dev:demo` running; source in
   [apps/web/dev/world.ts](apps/web/dev/world.ts)): slots (`&slots=1`), the walking graph (`&nav=1`), the time of day,
   crew seated for scale (`&crew=all`). Its **nav check** reports unreachable nodes and edges that walk through a
   collider, on the page and in the console; it should say nothing is wrong. It builds the yacht, or the moon base
   with `&world=moon-base` (its own camera presets: `&view=aerial`, `hub`, `hall`, `night`…); add yours the same way.
6. Try it with the crew aboard in demo mode once it's registered: `http://localhost:5190/?world=<id>`.

Worlds are welcome. An orbital station and the airship are the obvious next ones (use the
[new world issue template](.github/ISSUE_TEMPLATE/new_world.yml) to say you're on it).

## Running the real backend

For changes to `convex/`, sign-in, pairing, or anything the demo can't fake, run your own free
[Convex](https://www.convex.dev) dev deployment:

```sh
pnpm dev:backend          # once, then leave it running: makes your dev deployment, writes .env.local, pushes convex/ as you save
node scripts/devauth.mjs  # once: dev sign-in for that deployment
pnpm dev                  # http://localhost:5180/?dev=yourname
```

`?dev=yourname` signs you in as a throwaway captain, only against a dev deployment. Backend tests run on
convex-test with no deployment at all (`pnpm test:backend`); add them next to the code (`convex/*.test.ts`).

Never deploy production to try something. Production deploys only from a clean commit, as
[docs/deploy.md](docs/deploy.md) describes, and the build refuses a production deployment with dev sign-in enabled.
Keep backend changes additive: a rollback of the site doesn't roll back Convex. If you add a query or mutation the
interface uses, give demo mode an answer for it (see above).

## The runner and the sim crew

With the real backend running:

```sh
pnpm sim                  # a scripted crew: no claude, no codex, no spending
```

Make a ship, add a repo (any small git repo on your machine; the sim makes small, real changes in its own
worktrees), and ask Computah for something. In code Computah is the crew member with role `computer`, and its turns
are `computer` runs. The sim plans, asks questions, lands work and finishes threads like the real crew.
`pnpm runner start --sim --speed 4` runs it faster.

For real agents: `pnpm runner` (pairs this machine with your dev deployment if it isn't yet, then starts). From a
checkout it reads the dev deployment from `.env.local`; anywhere else, point it there yourself:
`OFFSITE_URL=https://<your-dev>.convex.cloud` (or `--url`). To run a second runner on the same computer, give it its
own home: `OFFSITE_HOME=~/.offsite-2 pnpm runner start`.

### The published CLI

Captains run `npx <RUNNER_SPEC>` (`packages/contracts/src/install.ts`): for now
`npx https://offsiteagents.app/offsite-agents.tgz`, the tarball every site build packs from `packages/runner`; once
the package is on npm, `npx offsite-agents`. `pnpm build` packs it into `apps/web/dist/offsite-agents.tgz` (no keys
needed). To try a change the way captains get it:

```sh
pnpm build && pnpm --filter @offsite/web exec vite preview --port 5291   # serves apps/web/dist; leave it running
# in another terminal:
OFFSITE_HOME=/tmp/offsite-try OFFSITE_URL=https://<your-dev>.convex.cloud \
  npx --yes http://localhost:5291/offsite-agents.tgz --sim
```

npx keeps what it installed the first time for a URL: `rm -rf ~/.npm/_npx` before trying a new build from the same
address. Bump `version` in `packages/runner/package.json` when the runner changes.

## Checks, CI and screenshots

```sh
pnpm typecheck            # every package, and convex/
pnpm test                 # every package's tests, plus the backend's (convex-test)
pnpm build                # the production app and the runner tarball
pnpm build:demo           # the static demo and gallery, in apps/web/dist-demo
pnpm screenshots          # the gallery and key demo states at desktop and phone widths, in .shots/ci
```

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs all of these on every pull request, forks included,
with no secrets. The screenshot job uploads the pictures as an artifact named `screenshots`, and
[visual-comment.yml](.github/workflows/visual-comment.yml) posts or updates one comment on the pull request with a
summary and a link to them. `pnpm screenshots` fails when a shot is blank, a page throws, or demo mode meets a
Convex function it has no answer for. On a machine without a GPU the 3D world is drawn in software (SwiftShader),
which is slow but works; `pnpm screenshots --software-gl` does the same locally, `--only <text>` takes a subset.

The README's pictures come from the film rig (`scripts/film/film.mjs`), which renders the real game on a scripted
ship with a virtual clock: `pnpm film:stills`, then `node scripts/readme-media.mjs`. Never add a real-run screenshot
that shows an email address, a token or a private path.

## For maintainers: testing a pull request locally

There are no preview deployments: try each pull request on your own machine before merging.

```sh
gh pr checkout <number>
pnpm i
pnpm dev:demo                 # http://localhost:5190: the demo, its states, and /gallery.html
```

Check the screenshots CI linked in its comment, then click through what the pull request touches. For anything that
touches `convex/`, sign-in, pairing or the runner, also run the real app against your dev backend:

```sh
pnpm dev:backend              # your dev deployment (pushes this branch's convex/ to it)
pnpm dev                      # http://localhost:5180/?dev=yourname
pnpm sim                      # a crew to exercise it
```

`pnpm typecheck && pnpm test` should pass locally as they did in CI. Merge with a squash and an imperative title.

## Commits and credit

- Commit messages in the imperative mood ("Add the Mars base"), with no AI attribution footers.
- Code adapted from another project keeps a header saying where it came from, and the project goes in
  [NOTICE](NOTICE).
- New sounds are generated by `scripts/audio` and listed with their model and prompt in
  [assets/audio/CREDITS.md](assets/audio/CREDITS.md).

By contributing, you agree your work is released under the [MIT License](LICENSE).
