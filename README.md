# Offsite

**Take your agents on an offsite.** Your Claude Code and Codex crew work on your code from a superyacht in your browser, on your own subscriptions, while you walk the decks as captain.

You talk to the ship's computer (at the helm, or on the foldable phone in your pocket). It splits the work and hands it to your crew. They sit at their desks, or take their laptops to a sun lounger, and code in their own git worktrees on your machine. When they need you, they walk over and ask. New hires arrive by helicopter.

The yacht is the first world. Worlds are folders (`worlds/*`): an office on Mars or a station in orbit is a contribution away.

## How it fits together

| path | role |
|---|---|
| `apps/web` | The app: the 3D world, the phone, the helm console. Vite, React for the interface, three.js for the world. |
| `convex/` | The backend: your ship, crew, threads, tasks, runs, questions. |
| `packages/runner` | `offsite`, the CLI that runs your crew on your machine (published as `offsite-agents`). |
| `packages/harness` | Claude Code and Codex adapters, plus the scripted sim crew. |
| `packages/git` | Thread branches, a worktree per task, landing work one task at a time. |
| `packages/contracts` | Shared shapes: run events, crew activity, tools, looks, world slots. |
| `packages/kit` | The 3D kit: rendering, sky and water, avatars and poses, walking, the captain's camera. |
| `worlds/yacht` | The superyacht. |

The browser never talks to your machine directly. Both talk to Convex: the app sends what you ask for, the runner picks up the work, starts your own `claude` or `codex`, and streams back what it does.

## Run it

Node 22.18+, pnpm 10.

```
pnpm install
pnpm dev:backend          # once, then leave running: your Convex dev deployment
node scripts/devauth.mjs  # once: lets ?dev=name sign you in locally
pnpm dev                  # http://localhost:5180/?dev=yourname
pnpm sim                  # in another terminal: a scripted crew, no subscriptions needed
```

To run real agents, install and sign in to Claude Code (`claude`) or Codex (`codex login`), then `pnpm runner login` and `pnpm runner start`.

## License

MIT. See NOTICE for the projects this builds on.
