import { DemoBackend } from "./backend.ts";
import { stateNamed } from "./states.ts";

// This page's demo: which state it started in (?state=), and the one fake backend the whole app talks to. Imported
// by demo/convex.ts and demo/auth.ts (which stand in for src/convex.ts and src/auth.ts in the demo build), so it is
// set up before any of the app's modules run.

const params = new URLSearchParams(location.search);
export const state = stateNamed(params.get("state"));

// The demo's ship lives in memory; so does the way aboard's "skip setup" (Gate.tsx keeps it in localStorage).
try {
  for (const k of Object.keys(localStorage)) if (k.startsWith("offsite:setup-skipped:")) localStorage.removeItem(k);
} catch { /* private mode */ }

// The sky's hour for this state (the world reads ?t= when it builds), unless the address already says.
if (state.hour !== undefined && !params.has("t") && !params.has("hour")) {
  const url = new URL(location.href);
  url.searchParams.set("t", String(state.hour));
  history.replaceState(history.state, "", url);
}

// ?hold=<seconds>: the ship's clock stops that long after the page loads (the screenshots use it, so a state looks
// the same however long the world takes to build).
const hold = Number(params.get("hold"));
const t0 = Date.now();
export const demo = new DemoBackend(state.setup, hold > 0 ? () => Math.min(Date.now(), t0 + hold * 1000) : undefined).start();
state.seed?.(demo);

// For poking at it from the console.
Object.assign(window, { demo });
