import { useEffect } from "react";
import { ui } from "../bridge.ts";
import { audio } from "../audio/index.ts";
import { Hud } from "../hud/Hud.tsx";
import { Phone } from "../phone/Phone.tsx";
import { phone, usePhone } from "../phone/state.ts";
import { Helm } from "../helm/Helm.tsx";
import { Creator } from "../creator/Creator.tsx";
import { CrewCard } from "./CrewCard.tsx";
import { ShipProvider } from "./ship.tsx";
import { stopWalking, WalkKeys } from "./walk.tsx";

// Everything drawn over the world: the HUD, the foldable phone, the helm console, crew cards,
// questions, the customizer. Talks to the game only through src/bridge.ts.
//
// Keys: F takes the phone out, unfolds it, puts it away (not while typing); V, with it out, switches
// between first and third person (it moves between your hands and the screen). Esc closes the
// customizer, then stops a walk, then closes the helm, then the phone, then a crew card. With the
// phone out and not typing, H walks to the helm and 1–9 to the crew (walk.tsx).

const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

function useKeys() {
  useEffect(() => {
    let lastF = 0;
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Escape") {
        const p = phone.get();
        if (p.creator) phone.closeCreator();
        else if (ui.get().walkTo) { stopWalking(); e.preventDefault(); return; }
        else if (ui.get().helm) ui.set({ helm: false });
        else if (p.fold !== "away") phone.putAway();
        else if (ui.get().crewCard && !ui.get().pointerLocked) ui.set({ crewCard: null });
        else return;
        if (editable(e.target)) (e.target as HTMLElement).blur();
        e.preventDefault();
        return;
      }
      // V with the phone out (the game isn't listening to the keyboard then): the view switches, the phone goes with it.
      if (e.code === "KeyV" && !e.repeat && !editable(e.target) && phone.get().fold !== "away" && !phone.get().creator && !ui.get().helm) {
        e.preventDefault();
        ui.set({ view: ui.get().view === "first" ? "third" : "first" });
        return;
      }
      if (e.code === "KeyF" && !e.repeat && !editable(e.target)) {
        if (ui.get().helm || phone.get().creator) return;
        e.preventDefault();
        // F is the half view; a quick second F unfolds it. The first press acts at once, so a single F
        // never waits to find out whether a second is coming.
        const now = performance.now();
        if (now - lastF < 320) { phone.unfold(); lastF = 0; }
        else { phone.tap(); lastF = now; }
      }
    };
    addEventListener("keydown", down);
    return () => removeEventListener("keydown", down);
  }, []);
  // The phone's hinge: a click opening it, a softer one closing it. Out of the pocket onto the cover is silent.
  useEffect(() => {
    let was = phone.get().fold;
    return phone.subscribe(() => {
      const now = phone.get().fold;
      if (now === was) return;
      if (now === "open") audio.ui("fold-open");
      else if (was === "open") audio.ui("fold-close");
      was = now;
    });
  }, []);
  // The helm takes over the screen: the phone goes back in the pocket.
  useEffect(() => ui.subscribe(() => { if (ui.get().helm && phone.get().fold !== "away") phone.putAway(); }), []);
  // Changes opened away from the helm (a "View changes", a package on the counter, E at a desk): the phone unfolds onto them.
  useEffect(() => {
    let was = ui.get().review;
    return ui.subscribe(() => {
      const r = ui.get().review;
      if (r && r !== was && !ui.get().helm) phone.set({ fold: "open", tab: "threads", hiring: false });
      was = r;
    });
  }, []);
}

export function Overlay({ officeId }: { officeId: string }) {
  useKeys();
  const creator = usePhone((s) => s.creator);
  return (
    <ShipProvider officeId={officeId}>
      <div className="overlay">
        <WalkKeys />
        <Hud />
        <CrewCard />
        <Phone />
        <Helm />
        {creator ? <Creator key={creator} who={creator} /> : null}
      </div>
    </ShipProvider>
  );
}
