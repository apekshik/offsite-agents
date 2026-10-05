import { createClient } from "@workos-inc/authkit-js";
import { useCallback, useEffect, useMemo, useState } from "react";

// Sign-in is WorkOS AuthKit (Google, GitHub, email…) on their page, which sends you back to
// /callback signed in; Convex checks the access token on every request.
// Dev sign-in (scripts/devauth.mjs), `pnpm dev` only: /?dev=alice is signed in as alice, with a
// token from the dev server. Not in a build. Adapted from Ready Player One.

const WORKOS_CLIENT_ID = import.meta.env["WORKOS_CLIENT_ID"] as string | undefined;
export const devUser = import.meta.env.DEV ? new URLSearchParams(location.search).get("dev") : null;

type AuthKit = Awaited<ReturnType<typeof createClient>>;
let authkit: AuthKit | null = null;
let ready: Promise<void> | null = null;

function start(): Promise<void> {
  ready ??= (async () => {
    if (devUser || !WORKOS_CLIENT_ID) return;
    try {
      authkit = await createClient(WORKOS_CLIENT_ID, {
        redirectUri: `${location.origin}/callback`,
        // Remember the session in this browser across reloads (no custom WorkOS auth domain yet).
        devMode: true,
      });
    } catch (err) {
      console.warn("Sign-in is unavailable", err);
    }
    if (location.pathname === "/callback") history.replaceState({}, "", "/");
  })();
  return ready;
}

export const signInAvailable = () => !!devUser || !!WORKOS_CLIENT_ID;
export const signIn = async () => { await start(); authkit?.signIn(); };
export const signOut = async () => { await start(); await authkit?.signOut({ navigate: false }).catch(() => {}); location.reload(); };

/** Who the sign-in service says you are, before Convex has a user row: { name, email } or null. */
export function authUser(): { name: string; email: string | null } | null {
  if (devUser) return { name: devUser, email: null };
  const u = authkit?.getUser();
  return u ? { name: u.firstName || u.email.split("@")[0] || "Captain", email: u.email } : null;
}

/** For ConvexProviderWithAuth. */
export function useOffsiteAuth() {
  const [state, setState] = useState<{ isLoading: boolean; isAuthenticated: boolean }>({ isLoading: true, isAuthenticated: false });
  useEffect(() => {
    void start().then(() => setState({ isLoading: false, isAuthenticated: !!devUser || !!authkit?.getUser() }));
  }, []);
  const fetchAccessToken = useCallback(async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
    await start();
    if (devUser) {
      const res = await fetch(`/__dev/token?user=${encodeURIComponent(devUser)}`);
      if (!res.ok) { console.warn("Dev sign-in:", await res.text()); return null; }
      return res.text();
    }
    try { return (await authkit?.getAccessToken({ forceRefresh: forceRefreshToken })) ?? null; } catch { return null; }
  }, []);
  return useMemo(() => ({ ...state, fetchAccessToken }), [state, fetchAccessToken]);
}
