import { z } from "zod";

// Friends aboard: a ship has one owner (the captain) and up to MAX_MEMBERS friends they invited. Everyone aboard walks
// the decks and talks to Computah in threads; the work still runs only on the owner's machines and subscriptions.

/** Friends a ship can have aboard, besides its owner (so up to 8 people at once). */
export const MAX_MEMBERS = 7;

/** An invite link lasts this long. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;

/** "/join/<token>": where an invite link points, on the app's own origin. */
export const joinPath = (token: string) => `/join/${token}`;

/**
 * What someone aboard is doing, as everyone else sees it: walking about, at the helm console, or the phone out (folded
 * on its cover, or unfolded).
 */
export const PersonAct = z.enum(["walk", "helm", "phone", "phone-open"]);
export type PersonAct = z.infer<typeof PersonAct>;

/** Presence: how often each person says they are still here, and when the roster gives up on them. */
export const PRESENCE = {
  /** A heartbeat (with a coarse position) while peer-to-peer links carry the movement. */
  beatMs: 4_000,
  /** Positions through Convex while a peer-to-peer link to someone isn't up: ~5 a second. */
  fallbackMs: 200,
  /** Gone after this long without a heartbeat. */
  staleMs: 20_000,
  /** Movement over a peer-to-peer link, a second. */
  sendHz: 15,
} as const;

/** One movement sample, as sent peer to peer (and folded into the presence row on the fallback). */
export const MotionSample = z.object({
  t: z.literal("s"),
  /** Position, metres, rounded to centimetres. */
  p: z.tuple([z.number(), z.number(), z.number()]),
  /** Facing, radians. */
  r: z.number(),
  /** Ground speed, m/s (drives the walk cycle between samples). */
  v: z.number().min(0).max(20),
  a: PersonAct,
  /** The sender's sequence number: an older sample arriving late is dropped. */
  n: z.number().int(),
});
export type MotionSample = z.infer<typeof MotionSample>;
