import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { COMPUTER_NAME } from "@offsite/contracts";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { scene } from "../bridge.ts";
import { Game } from "../game/Game.tsx";
import { Overlay } from "../overlay/Overlay.tsx";
import { takeWelcome } from "./welcome.ts";
import "./join.css";

// Aboard: the world under the overlay, with a veil while the ship builds. Loaded on its own
// (Gate.tsx imports it lazily), so the front door and the way aboard never wait for three.js.

export function Aboard({ officeId }: { officeId: string }) {
  const [ready, setReady] = useState(false);
  // Just came aboard with an invite: a welcome once the ship is up.
  const [welcome] = useState(() => takeWelcome(officeId));
  useEffect(() => {
    const t = setInterval(() => { if (scene.captain()) { setReady(true); clearInterval(t); } }, 250);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <Game officeId={officeId} />
      <Overlay officeId={officeId} />
      <div className={`boarding ${ready ? "gone" : ""}`}><span className="disp">Boarding</span><span className="dots"><i /><i /><i /></span></div>
      {welcome && ready ? <Welcome officeId={officeId} /> : null}
    </>
  );
}

/** "Welcome aboard OASIS": once, as a friend's ship appears around you. */
function Welcome({ officeId }: { officeId: string }) {
  const office = useQuery(api.offices.get, { officeId: officeId as Id<"offices"> });
  if (!office) return null;
  return (
    <div className="welcome" role="status">
      <div className="welcome-card">
        <span className="lab t-accent">{office.owner.name}'s ship</span>
        <span className="disp">Welcome aboard <span className="ship">{office.name}</span></span>
        <p>Walk the decks, or take out the phone (F) and talk to {COMPUTER_NAME} with {office.owner.name}. The crew work on {office.owner.name}'s machines.</p>
      </div>
    </div>
  );
}
