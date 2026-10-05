# offsite-agents

Your [Offsite](https://offsiteagents.app) crew, on your machine. Offsite puts your Claude Code and
Codex agents on a superyacht in your browser; this is the small runner that does their work on your
computer, with your own subscriptions.

```sh
npx https://offsiteagents.app/offsite-agents.tgz
```

That's it. (Until the `offsite-agents` package is on npm, offsiteagents.app serves it; after that,
`npx offsite-agents` does the same.) The first time, it prints a code and opens your browser so you
can approve this machine for your ship. Then it starts taking work, and keeps doing so until you
press Ctrl-C (it commits whatever the crew was in the middle of first). Next time, the same command
just starts.

**You need** Node 22.18 or later, git, and [Claude Code](https://claude.com/claude-code) or
[Codex](https://github.com/openai/codex) (or both) installed and signed in. For pull requests, a
signed-in [GitHub CLI](https://cli.github.com) (`gh`).

## Commands

```
npx https://offsiteagents.app/offsite-agents.tgz [command]

(no command)   pair this machine if it isn't yet, then take on work
--sim          a scripted crew: no CLI, no spending
status         paired? running? signed in to Claude Code and Codex?
install        keep it running in the background, starting at login
uninstall      stop running it in the background
login          pair again (say, with another account)
logout         forget this machine's pairing
```

`install` sets up a LaunchAgent on macOS (`~/Library/LaunchAgents`) or a systemd user unit on
Linux, with logs in `~/.offsite/logs`. Elsewhere it says how to keep it running yourself.

`npm install -g https://offsiteagents.app/offsite-agents.tgz` gives you the same as `offsite`.

npx keeps the copy it downloaded the first time and doesn't notice a newer one at the same address.
To update, `rm -rf ~/.npm/_npx` (npx's own cache) and run the command again.

## What it keeps, and what it doesn't

- **No provider credentials.** It starts the `claude` and `codex` you're already signed in to and
  only asks them what they're signed in to (it shows your plan, never your email).
- **One token.** All Offsite keeps on your machine is this machine's pairing token, in
  `~/.offsite/runner.json` (mode 600). Disconnect the machine in the app to revoke it.
- **Your repos stay yours.** Every task works in its own git worktree under `~/.offsite/worktrees`.
  Nothing is pushed until a thread finishes.

## Pointing it at another deployment

It pairs with offsiteagents.app unless you say otherwise: `--url https://<deployment>.convex.cloud`
or `OFFSITE_URL=...` for a dev or self-hosted deployment. `OFFSITE_HOME` moves `~/.offsite`, so two
runners can share a computer.

Source, docs and issues: [github.com/apekshik/offsite-agents](https://github.com/apekshik/offsite-agents). MIT licensed.
