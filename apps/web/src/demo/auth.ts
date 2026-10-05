import { useMemo, useSyncExternalStore } from "react";
import { state } from "./session.ts";

// Stands in for src/auth.ts in demo mode (vite.demo.config.ts swaps it in). No WorkOS, no tokens: "Sign in" just
// signs you in, as Captain. Anything src/auth.ts exports that isn't overridden here comes from it unchanged, so a new
// export there doesn't break the demo build (local exports win over `export *`).
export * from "../auth.ts";

let signedIn = !state.signedOut;
const listeners = new Set<() => void>();
const set = (v: boolean) => { signedIn = v; for (const fn of listeners) fn(); };
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export const devUser: string | null = null;
export const signInAvailable = () => true;
export const signIn = async (_back?: string) => { set(true); };
/** Signing out of the demo starts it again from the landing page. */
export const signOut = async () => {
  const url = new URL(location.href);
  url.searchParams.set("state", "landing");
  location.assign(url.toString());
};
export function authUser(): { name: string; email: string | null } | null {
  return signedIn ? { name: "Captain", email: null } : null;
}

const fetchAccessToken = async () => "demo";

/** For ConvexProviderWithAuth: signed in once you press Sign in (or from the start, in most demo states). */
export function useOffsiteAuth() {
  const on = useSyncExternalStore(subscribe, () => signedIn);
  return useMemo(() => ({ isLoading: false, isAuthenticated: on, fetchAccessToken }), [on]);
}
