import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { COMPUTER_NAME } from "@offsite/contracts";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ui } from "../bridge.ts";
import { Game } from "../game/Game.tsx";
import { Overlay } from "../overlay/Overlay.tsx";
import { phone } from "../phone/state.ts";
import { inSentence, worldOf } from "../worlds.ts";
import { takeWelcome } from "./welcome.ts";
import "./join.css";

// Aboard: the world under the overlay, with a veil while the ship builds. Loaded on its own
// (Gate.tsx imports it lazily), so the front door and the way aboard never wait for three.js.
//
// When the ship moves to another world while you're aboard (the captain moved it from Places, here or in another tab,
// or, for a friend aboard, the captain did), the veil comes down again ("Arriving at Moon Base"), the old world is
// taken down under it and the new one built (game/Game.tsx), and it lifts. The phone stays as it was.

/** How long the arrival veil takes to cover the old world before it's taken down, ms (screens.css: .boarding.arriving). */
const COVER_MS = 450;
/** How long a friend aboard sees who moved the ship, once it's there, ms. */
const NOTICE_MS = 5200;

interface Move { to: string; by: string | null; ship: string }

export function Aboard({ officeId }: { officeId: string }) {
  const id = officeId as Id<"offices">;
  // Just came aboard with an invite: a welcome once the ship is up.
  const [welcome] = useState(() => takeWelcome(officeId));
  const snap = useQuery(api.world.snapshot, { officeId: id });
  const office = useQuery(api.offices.get, { officeId: id });
  const world = snap?.office.world;
  /** The world the game builds: the ship's, once the veil covers the last one. */
  const [shown, setShown] = useState<string | null>(null);
  /** The last world the game finished building. */
  const [built, setBuilt] = useState<string | null>(null);
  /** The ship moved while you were aboard: where to, and who moved it (a friend aboard is told). */
  const [move, setMove] = useState<Move | null>(null);

  useEffect(() => {
    if (!world) return;
    if (shown === null) { setShown(world); return; }
    if (world === shown) { setMove((m) => (m && m.to !== world ? null : m)); return; }
    setMove({ to: world, by: office?.role === "member" ? office.owner.name : null, ship: office?.name ?? snap?.office.name ?? "" });
    // A walk across the old world means nothing in the new one.
    ui.set({ walkTo: null });
    const t = setTimeout(() => {
      // Under the veil: the old world comes down, and with it the helm console you might have moved the ship from (the
      // new world's helm is elsewhere) and whatever the old one had you pointing at. The phone stays out.
      ui.set({ helm: false, walkTo: null, prompt: null, aim: null });
      phone.closePlaces();
      setShown(world);
    }, COVER_MS);
    return () => clearTimeout(t);
    // The office's name and role only colour the notice; the world decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, shown]);

  // There: a friend's notice stays a moment, then the move is history.
  const arrived = !!move && built === move.to && shown === move.to;
  useEffect(() => {
    if (!arrived) return;
    const t = setTimeout(() => setMove(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [arrived]);

  const boarding = built === null;
  const arriving = !!move && !arrived;
  return (
    <>
      <Game officeId={officeId} world={shown} onBuilt={setBuilt} />
      <Overlay officeId={officeId} />
      {move ? <Arriving move={move} on={arriving} /> : null}
      <div className={`boarding ${boarding ? "" : "gone"}`}><span className="disp">Boarding</span><span className="dots"><i /><i /><i /></span></div>
      {welcome && !boarding ? <Welcome officeId={officeId} /> : null}
      {move?.by && arrived ? <Moved move={move} /> : null}
    </>
  );
}

/** The veil over a move: the new world's picture behind "Arriving at Moon Base". */
function Arriving({ move, on }: { move: Move; on: boolean }) {
  const w = worldOf(move.to);
  return (
    <div className={`boarding arriving ${on ? "" : "gone"}`} role="status" aria-live="polite">
      <img className="arriving-art" src={w.art} alt="" decoding="async" />
      <div className="arriving-text">
        <span className="disp">Arriving at {inSentence(w)}</span>
        {move.by ? <span className="ink2">{move.by} moved {move.ship || "the offsite"} to {inSentence(w)}</span> : <span className="dots"><i /><i /><i /></span>}
      </div>
    </div>
  );
}

/** For a friend aboard: who moved the ship, and where, once you're there. */
function Moved({ move }: { move: Move }) {
  const w = worldOf(move.to);
  return (
    <div className="welcome moved" role="status">
      <div className="welcome-card">
        <span className="lab t-accent">{w.name}</span>
        <p><b>{move.by}</b> moved {move.ship || "the offsite"} to {inSentence(w)}. The crew came too.</p>
      </div>
    </div>
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
