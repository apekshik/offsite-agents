#!/usr/bin/env bash
# Vercel's build (vercel.json buildCommand). See docs/deploy.md.
#
# Production: push convex/ to the production deployment with the key in CONVEX_DEPLOY_KEY, building the app against
# it (convex deploy runs the build first, then pushes; either failing fails the deploy, so the site never goes out
# against an old backend). Before that, refuse a production deployment that would accept dev sign-in tokens, that
# signs people in with a different WorkOS client than the app, or that doesn't know the app's address (SITE_URL).
#
# Preview: just the app, against the CONVEX_URL set for Preview in Vercel (the dev deployment). No backend push.
set -euo pipefail

if [ "${VERCEL_ENV:-}" != "production" ]; then
  : "${CONVEX_URL:?Set CONVEX_URL for Preview in Vercel (the dev deployment), or turn previews off}"
  exec pnpm build
fi

: "${CONVEX_DEPLOY_KEY:?Set CONVEX_DEPLOY_KEY (a production deploy key) for Production in Vercel}"
: "${WORKOS_CLIENT_ID:?Set WORKOS_CLIENT_ID for Production in Vercel}"
case "$CONVEX_DEPLOY_KEY" in prod:*) ;; *) echo "CONVEX_DEPLOY_KEY is not a production deploy key" >&2; exit 1 ;; esac

if [ -n "$(pnpm exec convex env get DEV_AUTH_JWKS 2>/dev/null)" ]; then
  echo "Refusing: the production Convex deployment has DEV_AUTH_JWKS set, so it would accept dev sign-in tokens." >&2
  echo "Remove it: npx convex env remove --prod DEV_AUTH_JWKS" >&2
  exit 1
fi
backend_client="$(pnpm exec convex env get WORKOS_CLIENT_ID 2>/dev/null || true)"
if [ "$backend_client" != "$WORKOS_CLIENT_ID" ]; then
  echo "Refusing: WORKOS_CLIENT_ID differs between Vercel and the production Convex deployment (or is missing there)." >&2
  exit 1
fi
if [ -z "$(pnpm exec convex env get SITE_URL 2>/dev/null)" ]; then
  echo "Refusing: set SITE_URL on the production Convex deployment (the app's address; \`offsite login\` links to it)." >&2
  exit 1
fi

exec pnpm exec convex deploy --cmd "pnpm build" --cmd-url-env-var-name CONVEX_URL
