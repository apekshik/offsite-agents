import { useSyncExternalStore } from "react";
import { deckLinks, type Link } from "./deck.ts";

// People on deck together: the roster and heartbeat (convex/presence.ts), peer-to-peer links (peers.ts) and the
// fallback through Convex (deck.ts). The game runs the deck; the interface reads how each person is linked.

export { Deck, deckLinks, type DeckOptions, type Link, type OnDeck, type Sample, type SelfState } from "./deck.ts";
export { DEFAULT_ICE, Peers } from "./peers.ts";

/** React: how each person on deck is linked to you (by user id): directly, connecting, or relayed through Convex. */
export function useLinks(): Record<string, Link> {
  return useSyncExternalStore(deckLinks.subscribe, deckLinks.get);
}
