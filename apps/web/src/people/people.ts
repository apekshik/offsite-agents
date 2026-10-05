import { useMemo } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { personLook, type PersonLook } from "./look.ts";

// The people aboard a ship, as the interface sees them: the captain and the friends they invited (members.list), and
// who is on deck right now (presence.here). One person per user, with the look the world draws them in.

export type MembersRow = FunctionReturnType<typeof api.members.list>;

export interface Person extends PersonLook {
  userId: string;
  name: string;
  /** The ship's captain (its owner). */
  owner: boolean;
  /** You. */
  me: boolean;
  /** Walking the decks right now. */
  onDeck: boolean;
  /** What they're doing on deck ("walk", "helm", "phone", "phone-open"), when they are. */
  act: string | null;
}

export interface Aboard {
  /** Still loading. */
  loading: boolean;
  me: string | null;
  /** Yours here. A ship from before friends (or the film) is the captain's. */
  role: "owner" | "member";
  isOwner: boolean;
  owner: Person | null;
  /** Everyone aboard: the captain, then friends by when they joined. */
  people: Person[];
  /** Everyone on deck now but you. */
  others: Person[];
  byId: Map<string, Person>;
  /** Friends may talk to Computah (you, if you're one). */
  canAsk: boolean;
  membersCanAsk: boolean;
}

export function useAboard(officeId: string): Aboard {
  const list = useQuery(api.members.list, { officeId: officeId as Id<"offices"> });
  const here = useQuery(api.presence.here, { officeId: officeId as Id<"offices"> });
  return useMemo<Aboard>(() => {
    const on = new Map((here ?? []).map((p) => [p.userId as string, p]));
    const me = list?.me ?? null;
    const make = (p: { userId: string; name: string; avatar: unknown; look: unknown }, owner: boolean): Person => ({
      ...personLook({ ...p, owner }), userId: p.userId, name: p.name, owner, me: p.userId === me,
      onDeck: on.has(p.userId), act: on.get(p.userId)?.act ?? null,
    });
    const owner = list ? make(list.owner, true) : null;
    const people = list ? [owner!, ...list.members.map((m) => make(m, false))] : [];
    const role = list?.role ?? "owner";
    const membersCanAsk = list?.membersCanAsk ?? true;
    return {
      loading: list === undefined, me, role, isOwner: role === "owner", owner, people,
      others: people.filter((p) => p.onDeck && !p.me),
      byId: new Map(people.map((p) => [p.userId, p])),
      canAsk: role === "owner" || membersCanAsk,
      membersCanAsk,
    };
  }, [list, here]);
}

/**
 * A question is for you: you're whom it asks, or it asks anyone, or it's a permission (about the captain's machine)
 * and the ship is yours. Before friends, every question was the captain's.
 */
export function forMe(q: { kind: string; askedOf?: string | null }, me: string | null, owner: boolean): boolean {
  if (q.kind === "approval") return owner;
  return q.askedOf === null || q.askedOf === undefined || q.askedOf === me;
}
