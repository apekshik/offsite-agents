import { useState } from "react";
import { useMutation } from "convex/react";
import { isWorking } from "@offsite/contracts";
import { api } from "../../../../convex/_generated/api";
import { ui } from "../bridge.ts";
import { Button, errorText, Key } from "../ui/index.tsx";
import { activityOf, useShip } from "../overlay/ship.tsx";
import { phone, usePhone } from "../phone/state.ts";
import { newOffsite } from "../screens/newOffsite.ts";
import { WORLD_LIST, inSentence, type WorldInfo } from "../worlds.ts";
// The way aboard's world cards (.world-art, .world-badge, .world-text), and this menu's own layout.
import "../screens/screens.css";
import "./places.css";

// Places: the worlds, as the way aboard's picker shows them (screens/Gate.tsx: the same art and words), and what you
// can do in each from here. Move this offsite there, crew, threads, repos and friends included (offices.relocate; only
// the captain), or make a new, separate offsite there (the way aboard's make-a-ship step, newOffsite.ts). Opened from
// the phone's Ship tab and the helm console; Esc or a click outside closes it. Friends aboard see it too, without Move.

export function Places() {
  const open = usePhone((s) => s.places);
  return open ? <PlacesMenu /> : null;
}

/** The worlds in the order you'd look at them: where you are, where you could go, what's still being built. */
const ordered = (here: string) => [
  ...WORLD_LIST.filter((w) => w.id === here),
  ...WORLD_LIST.filter((w) => w.id !== here && w.ready),
  ...WORLD_LIST.filter((w) => w.id !== here && !w.ready),
];

function PlacesMenu() {
  const { office, officeId, world: here, crew } = useShip();
  const relocate = useMutation(api.offices.relocate);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // A ship read without a role (the film's and the demo's backends) is the captain's own.
  const owner = !!office && office.role !== "member";
  const name = office?.name ?? "This offsite";
  const now = Date.now();
  const working = crew.filter((c) => isWorking(activityOf(c, now))).length;

  const move = (w: WorldInfo) => {
    setBusy(true);
    setErr(null);
    // Moved: the world comes down and goes up again under an arrival veil (screens/Aboard.tsx).
    void relocate({ officeId, world: w.id }).then(() => phone.closePlaces(), (x) => { setErr(errorText(x)); setBusy(false); });
  };
  const fresh = (w: WorldInfo) => {
    phone.closePlaces();
    phone.putAway();
    ui.set({ helm: false });
    newOffsite.start(w.id);
  };

  return (
    <div className="places-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) phone.closePlaces(); }}>
      <section className="places" role="dialog" aria-modal="true" aria-labelledby="places-title">
        <div className="pl-head">
          <div className="pl-title">
            <span className="disp" id="places-title">Places</span>
            <span className="dim">
              {owner
                ? `Move ${name}, crew and all, or start a new offsite somewhere else.`
                : `Only ${office?.owner.name ?? "the captain"} can move ${name}. You can start an offsite of your own anywhere.`}
            </span>
          </div>
          <button className="pl-close" onClick={() => phone.closePlaces()} aria-label="Close Places"><Key>Esc</Key> Close</button>
        </div>
        <div className="pl-grid">
          {ordered(here.id).map((w) => {
            const isHere = w.id === here.id;
            return (
              <article key={w.id} className={`place ${isHere ? "here" : ""} ${w.ready ? "" : "soon"} ${asking === w.id ? "asking" : ""}`} aria-label={w.name}>
                <span className="world-art"><img src={w.art} alt="" loading="lazy" decoding="async" width={720} height={405} /></span>
                {isHere ? <span className="world-badge pick">You're here</span> : w.ready ? null : <span className="world-badge">Coming soon</span>}
                <div className="world-text">
                  <span className="world-name">{w.name}</span>
                  <span className="world-blurb">{w.blurb}</span>
                </div>
                <div className="pl-act">
                  {isHere ? (
                    <span className="dim pl-note">{name} is here{crew.length ? `, with ${crew.length} crew` : ""}.</span>
                  ) : !w.ready ? (
                    <Button size="sm" disabled>Coming soon</Button>
                  ) : asking === w.id ? (
                    <div className="pl-confirm" role="group" aria-label={`Move ${name} to ${w.name}`}>
                      <span className="pl-line">Move <b>{name}</b> to {inSentence(w)}? Your crew, threads and repos come with you.</span>
                      {working ? <span className="dim pl-note">{working === 1 ? "One crew member is" : `${working} crew are`} mid-task: their runs keep going on your machine, and they'll be at desks when you land.</span> : null}
                      <div className="pl-buttons">
                        <Button kind="primary" size="sm" disabled={busy} autoFocus onClick={() => move(w)}>{busy ? "Moving…" : `Move to ${inSentence(w)}`}</Button>
                        <Button kind="ghost" size="sm" disabled={busy} onClick={() => { setAsking(null); setErr(null); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="pl-buttons">
                      {owner ? <Button kind="primary" size="sm" onClick={() => { setAsking(w.id); setErr(null); }}>Move {name} here</Button> : null}
                      <Button kind="soft" size="sm" onClick={() => fresh(w)}>New offsite here</Button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {err ? <div className="error" role="alert">{err}</div> : null}
      </section>
    </div>
  );
}

/** The way in: "Change location" for the captain, "Places" for a friend aboard (who can look, and start their own). */
export function PlacesButton({ size = "sm", kind = "soft", className }: { size?: "sm" | "lg"; kind?: "soft" | "ghost"; className?: string }) {
  const { office } = useShip();
  const owner = !!office && office.role !== "member";
  return (
    <Button size={size} kind={kind} className={className} onClick={() => phone.openPlaces()} title="Move this offsite to another world, or start a new one">
      <PinIcon />{owner ? "Change location" : "Places"}
    </Button>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" style={{ marginRight: 6, verticalAlign: "-2px" }}>
      <path d="M8 14.5s4.5-4.2 4.5-8a4.5 4.5 0 0 0-9 0c0 3.8 4.5 8 4.5 8z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="8" cy="6.4" r="1.6" fill="currentColor" />
    </svg>
  );
}
