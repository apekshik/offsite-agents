# Working in this repo

Read README.md, then docs/plan.md. The decisions there are settled; build them, do not re-argue them in code.

## Rules

- TypeScript everywhere. zod at the boundaries (@offsite/contracts), plain functions inside. Code ported from Ready Player One may stay JavaScript only behind a typed TypeScript entry point, and should be ported when touched.
- `apps/web` never imports Node. It talks to Convex, and to the 3D world only through `src/bridge.ts`.
- Only `packages/runner`, `packages/harness` and `packages/git` touch the filesystem, child processes or git.
- Offsite never stores a provider credential. The runner starts the captain's own `claude` and `codex` with their own logins and probes for state.
- Your ship, your subscriptions: a crew only ever runs on its owner's machines.
- Every harness event is normalized to `RunEvent` (@offsite/contracts) before it leaves the adapter. Content deltas are coalesced (100ms) before they reach Convex.
- Each task works in its own git worktree. Finished work lands on the thread's branch one task at a time; the crew member who just finished resolves any conflict.
- Functions the runner calls take its token and throw readable errors (`ConvexError`), so agents can act on the reason.
- Worlds (`worlds/*`) build their own place and mark slots (contracts `world.ts`); they never read Offsite's state. The app decides who goes where.
- Commit messages: imperative mood, no AI attribution footers.

## Running

```
pnpm install
pnpm dev:backend          # convex dev against your dev deployment (writes .env.local)
node scripts/devauth.mjs  # once: dev sign-in for the dev deployment
pnpm dev                  # http://localhost:5180/?dev=yourname
pnpm runner start         # the crew's machine (this one)
pnpm sim                  # a scripted crew: no CLI, no spending
```

Never deploy to production to try a change. Backend changes go to your dev deployment.

## Credits

Code adapted from other projects keeps a header saying where it came from. See NOTICE.
- Ready Player One (github.com/apekshik/ready-player-one): the 3D kit, avatars, poses, the design system, dev sign-in.
- Beam (github.com/SupraluminalIntelligence/beam, MIT): the harness adapters, run events, the runner's shape.
- AgentCraft (github.com/blendi-remade/agentcraft, MIT): ideas for the crew's workflow (lead and workers, the simulated team).
