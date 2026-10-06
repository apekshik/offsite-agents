import { useSyncExternalStore } from "react";

// Making another offsite, from aboard one (the Places menu's "New offsite here", the switcher's "+ New offsite") or
// from /?new=ship: while this is set, the way aboard (Gate.tsx) shows the make-a-ship step, with the world picked if
// one was, and a way back to the offsite you came from.

export interface NewOffsite {
  /** The world to start in (offices.world), or null for the picker's default. */
  world: string | null;
}

const fromAddress = (): NewOffsite | null => {
  if (typeof location === "undefined") return null;
  const q = new URLSearchParams(location.search);
  return q.get("new") === "ship" ? { world: q.get("in") } : null;
};

let state: NewOffsite | null = fromAddress();
const listeners = new Set<() => void>();

function set(next: NewOffsite | null) {
  state = next;
  // /?new=ship is a way in, not somewhere to stay: once you're back, or made it, the address forgets it.
  if (!next && typeof location !== "undefined") {
    const q = new URLSearchParams(location.search);
    if (q.has("new") || q.has("in")) {
      q.delete("new");
      q.delete("in");
      history.replaceState(history.state, "", `${location.pathname}${q.size ? `?${q}` : ""}`);
    }
  }
  for (const fn of listeners) fn();
}

export const newOffsite = {
  get: () => state,
  /** Leave the offsite on screen for the make-a-ship step, in `world` if given. */
  start: (world: string | null = null) => set({ world }),
  /** Made it, or went back. */
  end: () => set(null),
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};

export function useNewOffsite(): NewOffsite | null {
  return useSyncExternalStore(newOffsite.subscribe, () => state);
}
