# Deploying Offsite

The hosted app is `apps/web` on Vercel (team Asterisk Inc, project `offsite-agents`, at https://offsiteagents.app), talking to the Convex production deployment `adamant-shrimp-822`. Sign-in is WorkOS AuthKit. Crews run on each captain's own machine (`npx https://offsiteagents.app/offsite-agents.tgz`, the runner this site serves; `npx offsite-agents` once the package is on npm), never on Vercel.

The dev deployment `quaint-starfish-929` stays for development and Vercel previews. Never deploy to production to try a change.

## How a deploy works

`vercel.json` builds from the repo root: Vercel installs with pnpm (its own detection from `pnpm-lock.yaml`; with `ENABLE_EXPERIMENTAL_COREPACK=1` it uses the `packageManager` pin, pnpm 10.29.1), then runs `scripts/vercel-build.sh`:

- **Production** (`VERCEL_ENV=production`): refuses unless the production Convex deployment has no `DEV_AUTH_JWKS`, has `SITE_URL`, and has the same `WORKOS_CLIENT_ID` as Vercel. Then `convex deploy --cmd "pnpm build" --cmd-url-env-var-name CONVEX_URL`: builds the app against the production URL, then pushes `convex/` (typecheck, schema, functions, crons). If either step fails, the deploy fails and the site stays as it was.
- **Preview**: only `pnpm build`, against the `CONVEX_URL` set for Preview (the dev deployment). Nothing is pushed to Convex.

The output is `apps/web/dist`. `pnpm build` also packs `packages/runner` into `apps/web/dist/offsite-agents.tgz` (`scripts/pack-runner.mjs`, after the web build), so every deploy serves the runner from the same commit at `/offsite-agents.tgz`, as `application/gzip` with a five-minute cache. Hashed files under `/assets/` are cached for a year (immutable); `index.html` is revalidated every time (Vercel's default for HTML); everything else that isn't a file falls back to `index.html` (the app reads `/callback`, `/pair?code=` and `?connect=` itself), except `/assets/` and the tarball. `www.offsiteagents.app` redirects to the apex.

Why Convex deploys inside the Vercel build: backend and frontend go out together, in order, from the same commit, and a backend push that fails (a schema that doesn't match the data, a type error) stops the frontend too. The cost: a Vercel rollback doesn't roll back Convex (see Rollback), so keep backend changes additive.

## Environment

### Convex production (`npx convex env set --prod ...`)

| Variable | Value | Why |
|---|---|---|
| `WORKOS_CLIENT_ID` | the WorkOS client id (`client_...`) | `convex/auth.config.ts` trusts tokens from this client. Read when functions are pushed: set it before deploying. |
| `SITE_URL` | `https://offsiteagents.app` | Where pairing sends the captain: the runner opens `<SITE_URL>/pair?code=CODE`. |
| `DEV_AUTH_JWKS` | **never set** | Only on dev deployments: it makes Convex accept dev sign-in tokens. The build refuses to deploy while it is set. |

`WORKOS_API_KEY` is not needed by Convex or the browser. It stays in `.env.local` for admin calls only.

### Vercel (`vercel env add NAME <environment> --scope asterisk-inc`)

| Variable | Production | Preview | Notes |
|---|---|---|---|
| `CONVEX_DEPLOY_KEY` | production deploy key (`prod:...`) | not set | Secret. Lets the build push to Convex. |
| `WORKOS_CLIENT_ID` | client id | client id | Public: it ends up in the browser bundle. |
| `CONVEX_URL` | not set (the build sets it) | `https://quaint-starfish-929.convex.cloud` | Previews run against the dev deployment. |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` | `1` | Use pnpm from `packageManager`. |

The browser only ever gets `CONVEX_URL` and `WORKOS_CLIENT_ID` (`apps/web/vite.config.ts` `envPrefix`). Never give a secret one of those prefixes or `VITE_`.

## WorkOS (AuthKit)

The app signs in with authkit-js in the browser, comes back to `<origin>/callback`, and refreshes its session by calling `api.workos.com` from the page, so each origin needs a redirect URI and a CORS origin. In the WorkOS dashboard, in the environment the client id belongs to (staging for now):

1. **Redirects → Redirect URIs**: `https://offsiteagents.app/callback` (keep `http://localhost:5180/callback` for development). Not needed for `www`: it redirects to the apex before the app loads.
2. **Authentication → Sessions → CORS (allowed web origins)**: `https://offsiteagents.app` (keep `http://localhost:5180`).
3. **Redirects → Sign-out redirect**: `https://offsiteagents.app/`. The app signs out in the background and reloads itself, but WorkOS still wants a default.
4. **App homepage URL**: `https://offsiteagents.app`.

Or, for the first two, the API (with `WORKOS_API_KEY` from `.env.local`; never echo it):

```
KEY=$(grep '^WORKOS_API_KEY=' .env.local | cut -d= -f2-)
curl -sS -X POST https://api.workos.com/user_management/redirect_uris -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"uri":"https://offsiteagents.app/callback"}'
curl -sS -X POST https://api.workos.com/user_management/cors_origins -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"origin":"https://offsiteagents.app"}'
unset KEY
```

Preview deployments get random URLs, so sign-in works on them only if their origin is added too (WorkOS staging environments may accept a wildcard such as `https://offsite-agents-*-asterisk-inc.vercel.app/callback`; check in the dashboard). Otherwise test sign-in locally or in production.

Notes for later: the app keeps the WorkOS session in `localStorage` (`devMode: true` in `apps/web/src/auth.ts`) because there is no custom auth domain yet. Moving to a WorkOS production environment with a custom auth domain (say `auth.offsiteagents.app`) lets it use an httpOnly cookie instead; then set `devMode: false` and use the production client id everywhere above.

## First launch

Steps 1 to 5 run in your usual checkout (its `.env.local` names the Convex project). Step 6 deploys from a clean worktree of the commit you mean to ship: a CLI deploy uploads the working tree, uncommitted files included (`.vercelignore` keeps `.env*` and other local files out either way).

```
# 1. Convex production settings (before the first push: auth.config.ts reads them then)
npx convex env set --prod WORKOS_CLIENT_ID <client id>
npx convex env set --prod SITE_URL https://offsiteagents.app
npx convex env list --prod            # WORKOS_CLIENT_ID and SITE_URL; no DEV_AUTH_JWKS

# 2. WorkOS: the redirect URI, CORS origin and sign-out redirect above.

# 3. Convex dashboard → offsite-agents → Production → Settings → Generate Production Deploy Key. Copy it.

# 4. The Vercel project, in the Asterisk Inc team
vercel project add offsite-agents --scope asterisk-inc
vercel link --yes --project offsite-agents --scope asterisk-inc
vercel env add CONVEX_DEPLOY_KEY production --sensitive --scope asterisk-inc            # paste the key at the prompt
vercel env add WORKOS_CLIENT_ID production --value <client id> --scope asterisk-inc
vercel env add WORKOS_CLIENT_ID preview --value <client id> --scope asterisk-inc
vercel env add CONVEX_URL preview --value https://quaint-starfish-929.convex.cloud --scope asterisk-inc
vercel env add ENABLE_EXPERIMENTAL_COREPACK production --value 1 --scope asterisk-inc
vercel env add ENABLE_EXPERIMENTAL_COREPACK preview --value 1 --scope asterisk-inc

# 5. The domain (already in the team): apex serves the app, www redirects to it (vercel.json)
vercel domains add offsiteagents.app offsite-agents --scope asterisk-inc
vercel domains add www.offsiteagents.app offsite-agents --scope asterisk-inc
vercel domains inspect offsiteagents.app --scope asterisk-inc   # nameservers should read ns1/ns2.vercel-dns.com

# 6. Ship it, from a clean worktree of the commit
git worktree add ../offsite-release <sha> && cd ../offsite-release
vercel link --yes --project offsite-agents --scope asterisk-inc
vercel deploy --prod --scope asterisk-inc
```

`vercel link` may offer to connect the GitHub repository. Connected, every push to `main` deploys production (backend included). Until you want that, deploy from the CLI as above (or `vercel git disconnect`).

### Check it

```
curl -sI https://offsiteagents.app/ | grep -i -E 'HTTP|cache-control'
curl -sI https://www.offsiteagents.app/some/path | grep -i -E 'HTTP|location'      # 308 to the apex
curl -sI "https://offsiteagents.app/assets/$(curl -s https://offsiteagents.app/ | grep -o 'index-[^"]*\.js' | head -1)" | grep -i cache-control   # immutable
curl -sI https://offsiteagents.app/offsite-agents.tgz | grep -i -E 'HTTP|content-type|cache-control'   # 200, application/gzip, max-age=300
npx --yes https://offsiteagents.app/offsite-agents.tgz --version                                    # the version in packages/runner/package.json
curl -s -X POST https://adamant-shrimp-822.convex.site/device/start -H 'content-type: application/json' -d '{"name":"smoke"}'   # verifyUrl: https://offsiteagents.app/pair?code=...
```

Then in a browser: sign in, make a ship, and pair a machine with `npx https://offsiteagents.app/offsite-agents.tgz` (it pairs with production unless `OFFSITE_URL` or `--url` says otherwise, and opens `/pair` to approve it). `https://offsiteagents.app/?dev=anyone` must show the normal sign-in screen.

## Later deploys

From a clean worktree of the commit (`git -C ../offsite-release checkout --detach <sha>`, then `vercel deploy --prod --scope asterisk-inc` there). Or, once Git is connected, merge to `main`. Try backend changes on the dev deployment first (`pnpm dev:backend`).

## The runner: from the site now, from npm later

The CLI captains run is `packages/runner`, bundled by `build.mjs` into `dist/offsite.mjs` (Offsite's workspace packages inside; `@anthropic-ai/claude-agent-sdk`, `convex` and `zod` stay real dependencies). Production's Convex URL is built in, so it needs no flags; `--url` or `OFFSITE_URL` points it elsewhere. npm runs the `offsite-agents` bin (both bins are the same file, and that one matches the package name).

How captains get it is one constant, `RUNNER_SPEC` in `packages/contracts/src/install.ts`. The app's "Your machine" step and `/pair` page, the CLI's help and hints, the background service's command line (`npx --yes <spec> start`) and the backend's error messages all read it.

**Now** it is `https://offsiteagents.app/offsite-agents.tgz`: the tarball each deploy builds (above). Shipping the site ships the runner; nothing to publish. Bump `version` in `packages/runner/package.json` when the runner changes, so `--version` tells them apart.

npx keeps the copy it installed the first time for a given URL, even after the file there changes (it compares the URL, not the contents). Someone who ran it before a runner change keeps the old runner, and so does their background service, until npx's copy goes: `rm -rf ~/.npm/_npx` (only npx's own caches), then run the command again.

**Once `offsite-agents` is on npm**:

1. Ship the app first: the CLI opens `https://offsiteagents.app/pair?code=…`, so that page must be live before a published CLI sends anyone there.
2. Publish:
   ```
   cd packages/runner
   npm pack --dry-run                 # the file list: README.md, package.json, dist/offsite.mjs, dist/LICENSE, dist/NOTICE
   npm publish --access public        # runs build.mjs first (prepack)
   npx offsite-agents@latest --version
   ```
3. Set `RUNNER_SPEC = "offsite-agents"`. In the docs, swap `npx https://offsiteagents.app/offsite-agents.tgz` for `npx offsite-agents` (`git grep -n offsite-agents.tgz`: this file, CONTRIBUTING.md, README.md, packages/runner/README.md). Deploy.
4. Keep serving the tarball (leave `scripts/pack-runner.mjs` in the build): background services installed before the switch still start with `npx --yes https://offsiteagents.app/offsite-agents.tgz start`. Running `npx offsite-agents install` once moves a machine over.

Bump `version` for every publish. `npm deprecate offsite-agents@<version> "<why>"` warns anyone installing a bad one; publish a fixed version over it.

## Rollback

- **The site**: `vercel rollback --scope asterisk-inc` (to the previous production deployment) or `vercel rollback <deployment url> --scope asterisk-inc`. This swaps the frontend only, at once, without a build. After a rollback Vercel stops pointing the domain at new production deploys until you run `vercel promote <deployment url> --scope asterisk-inc`.
- **The backend**: Convex has no one-click rollback for functions. Push the older `convex/` again from that commit: `git worktree add ../offsite-rollback <good sha> && cd ../offsite-rollback && pnpm install && CONVEX_DEPLOY_KEY=<prod key> npx convex deploy`. Convex refuses a schema that existing data doesn't fit, so a rollback across a schema change may need the data fixed first. The safest rule is the one that avoids this: backend changes only add.
- **Stop everything**: pause the production deployment in the Convex dashboard (Settings → Pause deployment). The site stays up but can't read or write.
- **Sign-in trouble**: WorkOS settings take effect at once; restore the redirect URI or CORS origin in the dashboard.

## What keeps dev-only things out of production

- Dev sign-in (`?dev=name`): its token endpoint is a Vite dev-server middleware (`apply: "serve"`, absent from builds and `vite preview`); the browser half is behind `import.meta.env.DEV`; Convex accepts the dev issuer only where `DEV_AUTH_JWKS` is set (tested in `convex/pairing.test.ts`), the build refuses a production deployment that has it, and `scripts/devauth.mjs` only ever targets the dev deployment named in `.env.local`.
- `window.offsite` (the game's debug handle) is set only under `import.meta.env.DEV`.
- The dev pages (`apps/web/dev/*.html`) are not build inputs: the build has one entry, `index.html`.
