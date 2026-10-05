import type { SlotKind } from "@offsite/contracts";
import type { Act, Prop } from "../game/director.ts";
import type { GroupMood } from "../game/banter.ts";
import type { Ease, Orbit, Pose, Vec3 } from "./camera.ts";

// The shot language: each shot is data. The runner (runner.ts) plays one: it starts the ship at a
// story time, holds the sky at an hour, moves the camera, stages the off-duty crew, and does what
// the captain does in the interface at set times.

/** A point in the world: coordinates, a world slot, a crew member (by key, e.g. "otis"), a nav node. */
export type Target =
  | Vec3
  | { slot: string; up?: number }
  | { crew: string; up?: number }
  | { kind: SlotKind; nth?: number; up?: number }
  | { node: string; up?: number }
  /** A named object in the scene (the first visible one), e.g. "helicopter". */
  | { object: string; up?: number };

export type CameraMove =
  /** Locked off; `track` turns to keep something in frame (its `at` is then ignored). */
  | { hold: Pose; track?: Target; trackLag?: number }
  /** Through these poses on smooth curves (two is a straight move). */
  | { dolly: Pose[]; ease?: Ease; track?: Target; trackLag?: number }
  /** Round a point. */
  | ({ orbit: Target } & Orbit)
  /** Behind or beside a crew member as they move: offset in their own frame (x right, y up, z forward), or the world's. */
  | { follow: string; offset: Vec3; frame?: "body" | "world"; lookUp?: number; lookAhead?: number; fov?: number; lag?: number }
  /** The captain's own camera: third person over the shoulder, or first person. See Shot.captain. */
  | { captain: true };

/** What the captain does in the interface, at a time in the shot. */
export type Action =
  | { phone: "away" | "cover" | "open" }
  /** Types into the visible composer (the phone's or the helm's), `cps` characters a second. */
  | { type: string; cps?: number }
  /** Submits the composer. */
  | { send: true }
  | { thread: string | null }
  | { review: { thread: string; task: string | null } }
  | { closeReview: true }
  | { helm: boolean }
  | { tab: "threads" | "crew" | "ship"; crew?: string }
  | { crewCard: string | null }
  /** A speech bubble over a crew member. */
  | { say: string; text: string; ms?: number }
  | { hud: boolean }
  /** Restage off-duty crew from now on (merged over the shot's stage). */
  | { stage: Record<string, Blocking> }
  /** Scroll an element (CSS selector) to a position, at once. */
  | { scroll: string; top: number };

export interface CaptainSetup {
  at: Target;
  /** Degrees: 0 faces +z (aft), 180 faces the bow. */
  facing: number;
  view?: "first" | "third";
  /** Radians; positive looks down. */
  pitch?: number;
  /** Third person: camera distance (m). */
  dist?: number;
  /** Walk these points from `walkAt` seconds into the shot (WASD, with the real controller and collision). */
  walk?: Target[];
  walkAt?: number;
  jog?: boolean;
  /** Turn the view by this many degrees over the shot (a slow pan in first person). */
  pan?: number;
  hidden?: boolean;
}

/**
 * An off-duty crew member's place for a scene: overrides the director while they are idle. Any of
 * the director's acts (director.ts Act): "nap-hammock" sleeps with a Zzz, "bartend" behind the bar
 * (slot "bartender"), "dance", "cards", "selfie", "lift"… Left out, the act is what the director
 * does at that kind of spot. Moving someone onto a pool slot mid-shot ({ stage }) is a cannonball.
 */
export interface Blocking {
  slot: string;
  act?: Act;
  props?: Prop[];
  /** A conversation they are part of (Shot.groups): the director's own banter, toasts and laughs. */
  group?: string;
}

/**
 * A staged hangout: the game plays its banter (banter.ts) as it would for the director's groups.
 * `id` picks the exchange (banter.ts is seeded by it: try ids until the lines are the ones you
 * want); round `round` (0 first, a toast for "cheers") opens at `lineAt` seconds into the shot.
 */
export interface FilmGroup {
  mood: GroupMood;
  id?: string;
  round?: number;
  lineAt: number;
}

export interface Shot {
  name: string;
  /** What the cut uses it for. */
  note: string;
  /** Story second at the shot's first frame (story.ts T). */
  story: number;
  /** Seconds. */
  duration: number;
  /** Seconds simulated (drawn, not captured) before the first frame, so motion is already under way. Default 2. */
  warmup?: number;
  /** The sky: an hour, or from → to over the shot. Sunset ~19, night ~21.5. */
  hour: number | [number, number];
  camera: CameraMove;
  /** The HUD (and toasts) on screen. Default off. */
  hud?: boolean;
  /** The phone on screen when it's out. Off: only the one in the captain's hands shows. Default on. */
  phoneUi?: boolean;
  ui?: { at: number; do: Action }[];
  /** Off-duty crew by key. */
  stage?: Record<string, Blocking>;
  /** Conversations among the staged crew, by the name their Blocking.group uses. */
  groups?: Record<string, FilmGroup>;
  /** Everyone (or these) standing in a row, for the cast picture. */
  lineup?: { at: Vec3; facing: number; spacing: number; crew?: string[] };
  /**
   * Override the office lights (the world's setBusy, 0..1). Normally leave it: the game sets it from
   * how many of the crew are at work, so the office lights up as they sit down.
   */
  busy?: number | [number, number];
  /** Crew (by key) whose bubbles and name tags show whatever the distance (the game's focus). */
  focus?: string[];
  /** Where the captain is; needed for { captain: true }, and to keep him out of (or in) other shots. */
  captain?: CaptainSetup;
  /** Pixels; default 1920×1080. */
  size?: [number, number];
}

/** A README picture: one frame of a shot. */
export type Still = Shot & { file: string };
