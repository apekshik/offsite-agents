# Contributing to Offsite

Thanks for coming aboard. Read [AGENTS.md](AGENTS.md) first: it holds the house rules (they apply to
people and agents alike), and [docs/plan.md](docs/plan.md) holds the design decisions, which are
settled.

## Setting up

Node 22.18+ and pnpm 10.

```sh
pnpm install
pnpm dev:backend          # your own Convex dev deployment; leave it running (writes .env.local)
node scripts/devauth.mjs  # once: dev sign-in for that deployment
pnpm dev                  # http://localhost:5180/?dev=yourname
```

`?dev=yourname` signs you in as a throwaway captain, only against a dev deployment.

## Running the sim

```sh
pnpm sim                  # a scripted crew: no claude, no codex, no spending
```

Make a ship, add a repo (any small git repo on your machine; the sim makes small, real changes in
its own worktrees), and ask Computah (the main orchestrator) for something. In code Computah is the
crew member with role `computer`, and its turns are `computer` runs. The sim plans, asks questions,
lands work and finishes threads like the real crew, so it's the quickest way to see a change to the
world or the interface under load. `pnpm runner start --sim --speed 4` runs it faster.

For real agents: `pnpm runner` (pairs this machine with your dev deployment if it isn't yet, then
starts). From a checkout it reads the dev deployment from `.env.local`; anywhere else, point it there
yourself: `OFFSITE_URL=https://<your-dev>.convex.cloud` (or `--url`). Without either, the CLI pairs
with offsiteagents.app. To run a second runner on the same computer, give it its own home:
`OFFSITE_HOME=~/.offsite-2 pnpm runner start`. Only one runner works from each home at a time.

## The published CLI

Captains run `npx <RUNNER_SPEC>` (`packages/contracts/src/install.ts`): for now
`npx https://offsiteagents.app/offsite-agents.tgz`, the tarball every site build packs from
`packages/runner`; once the package is on npm, `npx offsite-agents`. Everything that shows or runs the
command reads that constant, so switching is one line (see [docs/deploy.md](docs/deploy.md)).

`npm pack` (in `packages/runner`) builds `dist/offsite.mjs` with esbuild (`build.mjs`: Offsite's
workspace packages bundled in, npm dependencies left external) and packs only that, the README,
LICENSE and NOTICE. `pnpm build` runs it after the web build and puts the result at
`apps/web/dist/offsite-agents.tgz`. To try a change the way captains get it:

```sh
pnpm build && pnpm --filter @offsite/web exec vite preview --port 5291   # serves apps/web/dist; leave it running
# in another terminal:
OFFSITE_HOME=/tmp/offsite-try OFFSITE_URL=https://<your-dev>.convex.cloud \
  npx --yes http://localhost:5291/offsite-agents.tgz --sim
```

npx keeps what it installed the first time for a URL, even after the file changes: `rm -rf ~/.npm/_npx`
before trying a new build from the same address. Approve the code at
`http://localhost:5180/pair?code=...&dev=yourname` (the dev sign-in). Bump `version` in
`packages/runner/package.json` when the runner changes (and before publishing it to npm).

## Tests

```sh
pnpm test         # every package's tests, plus the backend's (convex-test)
pnpm typecheck
```

Add tests next to the code they cover (`*.test.ts`). Backend tests live in `convex/` and run on
convex-test, with no deployment involved.

## Never deploy production to try something

Backend changes go to your dev deployment (`pnpm dev:backend` pushes `convex/` there as you save).
Production deploys only from a clean commit, as [docs/deploy.md](docs/deploy.md) describes, and the
build refuses a production deployment that has dev sign-in enabled. Keep backend changes additive:
a Vercel rollback doesn't roll back Convex.

## Adding a world

A world is a workspace package in `worlds/<name>` that builds a place and marks where things can
happen. It never reads Offsite's state; the app decides who goes where.

1. Copy `worlds/yacht/package.json` and export a `WorldModule` (`packages/kit/src/world.ts`): `id`,
   `name`, `blurb`, and `build(ctx)` returning the scene root, colliders, interactables and layout.
2. Mark the layout (`packages/contracts/src/world.ts`): slots by kind (desks, loungers, the helm,
   the `computer` slot where Computah floats, the drop-off, the helipad, spawn points and places
   to hang out) and a walking graph.
   `ACTIVITY_SPOTS` there says which kinds each activity uses.
3. Give the helm an interactable with the id `helm`, fly new crew in from `setArrivals`, and show
   how busy the ship is in `setBusy` if you like.
4. Register it in `WORLDS` in `apps/web/src/game/Game.tsx` and in the picker in
   `apps/web/src/screens/Gate.tsx`.
5. Check it in the world viewer, `http://localhost:5180/dev/world.html` (`apps/web/dev/world.ts`):
   slots, the walking graph against the colliders, the time of day, crew seated for scale. It builds
   the yacht today; point it at yours.

Worlds are welcome. Mars and an orbital station are the obvious next ones.

## README pictures

They come from the film rig (`scripts/film/film.mjs`), which renders the real game on a scripted ship:

```sh
pnpm film:stills                  # .shots/film/stills/*.png (needs Chrome and ffmpeg)
node scripts/readme-media.mjs     # docs/media/*.webp, sized and compressed (needs cwebp)
```

Real-run screenshots are listed one by one in `scripts/readme-media.mjs`: never add one that shows
an email address, a token or a private path.

## Commits and credit

- Commit messages in the imperative mood ("Add the Mars base"), with no AI attribution footers.
- Code adapted from another project keeps a header saying where it came from, and the project goes
  in [NOTICE](NOTICE).
- New sounds are generated by `scripts/audio` and listed with their model and prompt in
  [assets/audio/CREDITS.md](assets/audio/CREDITS.md).

By contributing, you agree your work is released under the [MIT License](LICENSE).
