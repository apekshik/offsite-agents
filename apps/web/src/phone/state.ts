import { useSyncExternalStore } from "react";
import { ui } from "../bridge.ts";

// The phone's own state, inside the interface. The bridge only hears "open" or "closed": the phone
// is "open" (out of your pocket, the mouse free) whether it shows its cover or is unfolded.

export type Fold = "away" | "cover" | "open";
export type PhoneTab = "threads" | "crew" | "ship";

export interface PhoneState {
  fold: Fold;
  tab: PhoneTab;
  /** The crew member shown on the crew tab's right pane. */
  crewId: string | null;
  /** Hiring someone: the crew tab's right pane shows the form. */
  hiring: boolean;
  /** The customizer, over everything: whose look ("captain" for you). */
  creator: string | null;
}

let state: PhoneState = { fold: "away", tab: "threads", crewId: null, hiring: false, creator: null };
const listeners = new Set<() => void>();

function set(patch: Partial<PhoneState>) {
  state = { ...state, ...patch };
  // The game releases the mouse and ignores WASD while the phone is out, or the customizer is open.
  const out = state.fold !== "away" || (state.creator !== null && !ui.get().helm);
  ui.set({ phone: out ? "open" : "closed", phoneUnfolded: state.fold === "open" });
  for (const fn of listeners) fn();
}

export const phone = {
  get: () => state,
  set,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  /** Out of the pocket, folded: the cover screen. */
  takeOut: () => set({ fold: "cover" }),
  unfold: () => set({ fold: "open" }),
  putAway: () => { ui.set({ review: null }); set({ fold: "away", hiring: false }); },
  /** Straight to a thread, unfolded. */
  openThread(threadId: string | null) {
    ui.set({ threadId, helm: false, review: null });
    set({ fold: "open", tab: "threads", hiring: false });
  },
  openCrew(crewId: string | null) {
    ui.set({ helm: false });
    set({ fold: "open", tab: "crew", crewId, hiring: false });
  },
  openShip() {
    ui.set({ helm: false });
    set({ fold: "open", tab: "ship", hiring: false });
  },
  /** F: the half view. Out of the pocket onto its cover; from the cover, back away; unfolded, back to the cover. */
  tap() {
    if (state.fold === "away") set({ fold: "cover" });
    else if (state.fold === "cover") set({ fold: "away", hiring: false });
    else set({ fold: "cover" });
  },
  editLook: (who: string) => set({ creator: who }),
  closeCreator: () => set({ creator: null }),
};

export function usePhone<T>(select: (s: PhoneState) => T): T {
  return useSyncExternalStore(phone.subscribe, () => select(state));
}
