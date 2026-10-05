import { useSyncExternalStore } from "react";

// The one place the 3D game (src/game, imperative three.js) and the interface (React overlays:
// the phone, the helm console, the HUD) meet. Either side reads and writes this small store;
// neither imports the other.
//
// Who writes what:
// - The interface opens and closes the phone and the helm console, pings a crew member, picks
//   the thread on screen.
// - The game says what the captain is near (prompt), which view they are in, whether the pointer
//   is locked, and which crew member they clicked in the world.
// While the phone or the helm console is open the game releases the pointer and ignores WASD, so
// typing goes to the interface.

export interface UiState {
  /** The foldable phone: closed in your pocket, or open in your hands. */
  phone: "closed" | "open";
  /** While the phone is out: unfolded (true) or showing its cover (false). Written by the interface. */
  phoneUnfolded: boolean;
  /** The big console on the bridge, opened by walking up to the helm and pressing E. */
  helm: boolean;
  view: "first" | "third";
  /** A crew member to find: the world shows a marker over them and a path to walk. */
  ping: { crewId: string; at: number } | null;
  /** What the captain could use right now: "E  Open the helm console". Set by the game. */
  prompt: { id: string; label: string } | null;
  pointerLocked: boolean;
  /** The thread open on the phone or the helm. */
  threadId: string | null;
  /** A crew member the captain clicked in the world: the interface shows their card. */
  crewCard: string | null;
  /**
   * What the crosshair is on while the mouse is grabbed (written by the game, ~10 times a second): a crew member, or
   * something to use (a delivered package: crewId is "", hint says what a click does).
   */
  aim: { crewId: string; name: string; line: string; hint?: string } | null;
  /** The crew's work open for review: a task's changes, or (taskId null) the thread's. The phone or the helm shows it. */
  review: ReviewTarget | null;
}

export interface ReviewTarget { threadId: string; taskId: string | null }

const initial: UiState = {
  phone: "closed",
  phoneUnfolded: false,
  helm: false,
  view: "third",
  ping: null,
  prompt: null,
  pointerLocked: false,
  threadId: null,
  crewCard: null,
  aim: null,
  review: null,
};

let state = initial;
const listeners = new Set<() => void>();

export const ui = {
  get: (): UiState => state,
  set(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)) {
    const next = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    if (Object.keys(next).every((k) => next[k as keyof UiState] === state[k as keyof UiState])) return;
    state = next;
    for (const fn of listeners) fn();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** True while the interface owns the keyboard. */
  typing: () => state.phone === "open" || state.helm,
};

/**
 * Where something is on screen this frame: CSS pixels, whether it's in front of the camera, metres away.
 * For a point behind the camera, x and y are mirrored so that an edge arrow still points the way to turn.
 */
export interface ScreenSpot {
  x: number;
  y: number;
  onScreen: boolean;
  distance: number;
}

/**
 * Live answers from the game, for things that change every frame (the HUD's ping marker, a crew
 * card that follows its person). Call from requestAnimationFrame; never put these in React state.
 * The game replaces these functions when it starts; until then they return null.
 */
export const scene = {
  /** A crew member's head, projected. */
  locate: (_crewId: string): ScreenSpot | null => null,
  /** The captain's position on deck, in metres. */
  captain: (): { x: number; y: number; z: number } | null => null,
  /**
   * Where a crew member is headed or sitting: the world slot (kind "captain" while they walk to
   * you). Written by the game; read by the interface for "in a hammock, promenade".
   */
  where: (_crewId: string): { slotId: string; kind: string; tags: string[] } | null => null,
};

/** React: re-renders when the selected slice changes. */
export function useUi<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(ui.subscribe, () => select(state));
}
