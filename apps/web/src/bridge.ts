import { useSyncExternalStore } from "react";

// The one place the 3D game (src/game, imperative three.js) and the interface (React overlays:
// the phone, the helm console, the HUD) meet. Either side reads and writes this small store;
// neither imports the other.
//
// Who writes what:
// - The interface opens and closes the phone and the helm console, pings a crew member, picks
//   the thread on screen, and sends the captain walking (walkTo).
// - The game says what the captain is near (prompt), which view they are in, whether the pointer
//   is locked, which crew member they clicked in the world, and how a walk ended (walkEnd; it
//   clears walkTo then).
// While the phone or the helm console is open the game releases the pointer and ignores WASD, so
// typing goes to the interface. Only a walk (walkTo) moves the captain meanwhile.

export interface UiState {
  /** The foldable phone: closed in your pocket, or open in your hands. */
  phone: "closed" | "open";
  /** While the phone is out: unfolded (true) or showing its cover (false). Written by the interface. */
  phoneUnfolded: boolean;
  /** The big console on the bridge, opened by walking up to the helm and pressing E. */
  helm: boolean;
  /** Written by the game; the interface switches it too (V while the phone is out and has the keyboard). */
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
  /**
   * Walk the captain there by themselves (the phone can stay open). Set by the interface; the game
   * clears it when the walk ends (there, no way there, or WASD took it back). The interface clears
   * it to stop.
   */
  walkTo: WalkTarget | null;
  /** How the last walk ended, written by the game as it clears walkTo. */
  walkEnd: { to: WalkTarget; outcome: "arrived" | "failed" | "stopped"; at: number } | null;
}

export interface ReviewTarget { threadId: string; taskId: string | null }
/** Where a walk goes: a crew member, the helm, or someone else aboard (a friend on deck, or the captain). */
export type WalkTarget = { kind: "crew"; crewId: string } | { kind: "helm" } | { kind: "person"; userId: string };

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
  walkTo: null,
  walkEnd: null,
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
  /** Someone else on deck (by user id), projected like locate. */
  locatePerson: (_userId: string): ScreenSpot | null => null,
  /**
   * Where a crew member is headed or sitting: the world slot (kind "captain" while they walk to
   * you). Written by the game; read by the interface for "in a hammock, promenade".
   */
  where: (_crewId: string): { slotId: string; kind: string; tags: string[] } | null => null,
  /** Wheel notches (positive: out) caught by the interface round the open phone: the game zooms, all the way in is first person. */
  zoom: (_notches: number): void => {},
};

/** A rectangle on screen: its centre and size, CSS pixels. */
export interface ScreenRect { x: number; y: number; w: number; h: number }
/** One of the phone's screens on screen: its corners (top left, top right, bottom right, bottom left, CSS pixels, as seen
 * from the front of the glass) and whether that front faces you. */
export interface HeldQuad { corners: [number, number][]; front: boolean }
/** The phone's screens this frame: the cover, the inside of the half that swings, and the whole inside spread. */
export interface HeldFrame { cover: HeldQuad; left: HeldQuad; spread: HeldQuad; /** 0 folded … 1 flat open, as it moves. */ open: number }

/**
 * First person, the phone in your hands shows the interface's own phone on its glass. The interface says where it
 * would draw its screens (its overlay's places: `want`) and whether to hold still (typing); the game holds the 3D
 * phone up so its screens land about there and, every frame it's up in first person, says where they are (`frame`,
 * null otherwise). The interface lies its pages over those corners, in the same frame, before it's drawn.
 */
export const held = {
  /** The game draws the phone in your hands this session (false in the film rig and the gallery). */
  live: false,
  want: null as { view: { w: number; h: number }; cover: ScreenRect; open: ScreenRect } | null,
  still: false,
  frame: null as HeldFrame | null,
  listeners: new Set<(f: HeldFrame | null) => void>(),
  /** The game, from its frame loop: where the screens are now (null: not up in first person). */
  publish(f: HeldFrame | null) {
    if (!f && !held.frame) return;
    held.frame = f;
    for (const fn of held.listeners) fn(f);
  },
  subscribe(fn: (f: HeldFrame | null) => void): () => void {
    held.listeners.add(fn);
    return () => { held.listeners.delete(fn); };
  },
};

/** React: re-renders when the selected slice changes. */
export function useUi<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(ui.subscribe, () => select(state));
}
