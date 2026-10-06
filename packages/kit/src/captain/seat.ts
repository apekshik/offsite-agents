// The captain in a seat: lying in a hammock, stretched out on a lounger, sitting in a deck chair. Which of a world's
// slots the captain can use with E, what the body does there (the same act the crew use), and where to stand up
// again afterwards. Pure: the Captain eases in and out, the app says which seats are free.

import * as THREE from "three";
import type { Slot, SlotKind } from "@offsite/contracts";
import type { ActId } from "../avatar/acts.ts";

export interface SeatKind {
  /** The pose there (acts.ts). */
  act: ActId;
  /** What E says: "Lie in the hammock". */
  label: string;
  /** Lying along the way the slot faces (get up to the side), rather than sitting facing it (get up in front). */
  lie: boolean;
}

/** The kinds of slot the captain can use, and how. */
export const CAPTAIN_SEATS: Partial<Record<SlotKind, SeatKind>> = {
  hammock: { act: "hammock-rest", label: "Lie in the hammock", lie: true },
  lounger: { act: "sunbathe", label: "Lie on the lounger", lie: true },
  "deck-chair": { act: "sofa", label: "Sit down", lie: false },
};

/** A seat the captain can use: its slot, and what they do there. */
export interface CaptainSeat extends SeatKind {
  slot: Slot;
}

/** The slot as a seat for the captain, or null when it isn't one. */
export function captainSeat(slot: Slot): CaptainSeat | null {
  const k = CAPTAIN_SEATS[slot.kind];
  return k ? { ...k, slot } : null;
}

/** How far from the slot's point to try standing up, metres: clear of the furniture first, then a little further. */
const REACH = [0.85, 1.1, 1.4];

/**
 * Places to stand up from a seat, best first. Lying: beside it, on the side `from` is (where they were before getting
 * in) first. Sitting: in front first, then the sides. Behind comes last; `from` itself after everything.
 */
export function standSpots(seat: CaptainSeat, from?: THREE.Vector3 | null): THREE.Vector3[] {
  const [x, y, z] = seat.slot.pos;
  const f = seat.slot.facing;
  const ahead = new THREE.Vector3(Math.sin(f), 0, Math.cos(f));
  // To the body's left (+x when facing +z).
  const left = new THREE.Vector3(Math.cos(f), 0, -Math.sin(f));
  const side = from && (from.x - x) * left.x + (from.z - z) * left.z < 0 ? left.clone().negate() : left;
  const other = side.clone().negate();
  const dirs = seat.lie ? [side, other] : [ahead, side, other];
  const out: THREE.Vector3[] = [];
  for (const r of REACH) for (const d of dirs) out.push(new THREE.Vector3(x + d.x * r, y, z + d.z * r));
  if (!seat.lie) for (const r of REACH) out.push(new THREE.Vector3(x - ahead.x * r, y, z - ahead.z * r));
  if (from) out.push(from.clone());
  return out;
}

/**
 * Where to stand up from a seat: the first of standSpots that `clear` accepts (deck underfoot, nothing in the way),
 * or null when none does.
 */
export function standSpot(seat: CaptainSeat, from: THREE.Vector3 | null, clear: (p: THREE.Vector3) => boolean): THREE.Vector3 | null {
  return standSpots(seat, from).find(clear) ?? null;
}
