import { useEffect, useState } from "react";
import type { DemoBackend } from "./backend.ts";
import { ASK, STATES, type DemoState } from "./states.ts";
import "./demo.css";

// The Demo badge: says this is demo mode, starts it over, and (opened) jumps to any state or nudges the ship along.
// Its own React root, outside the app's, so nothing in the app needs to know about it.

const hrefFor = (s: DemoState) => {
  const url = new URL(location.href);
  url.searchParams.set("state", s.name);
  url.searchParams.delete("t");
  return url.pathname + url.search;
};

/** Starts the demo over in its current state: a fresh ship, no remembered setup or sound settings. */
export function resetDemo() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("offsite")) localStorage.removeItem(k);
  } catch { /* private mode */ }
  location.reload();
}

export function Badge({ demo, current }: { demo: DemoBackend; current: DemoState }) {
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 700);
    return () => clearInterval(t);
  }, []);
  const ship = demo.ship;
  const act = (fn: () => void) => () => { fn(); demo.refresh(); };
  // There's no runner to pair in the demo: say how to get past the machine step.
  const unpaired = ship.hasOffice() && !ship.hasMachine();
  return (
    <div className={`demo-badge ${open ? "open" : ""}`}>
      {unpaired && !open ? (
        <div className="demo-hint" role="status">
          <span>No real runner in the demo.</span>
          <button type="button" onClick={act(() => ship.pairMachine())}>Pair a pretend machine</button>
        </div>
      ) : null}
      {open ? (
        <div className="demo-panel" role="dialog" aria-label="Demo mode">
          <p className="demo-lead">
            Demo mode: the real interface on a pretend ship in your browser. No account, no backend, no runner;
            everything resets when you reload.
          </p>
          <div className="demo-acts">
            {ship.hasOffice() && !ship.hasMachine() ? <button type="button" onClick={act(() => ship.pairMachine())}>Pair a machine</button> : null}
            {ship.hasMachine() ? <button type="button" onClick={act(() => { ship.startThread(ASK); })}>Ask for dark mode</button> : null}
            {ship.hasOffice() ? <button type="button" onClick={act(() => { ship.hire(); })}>Hire someone</button> : null}
            <button type="button" onClick={act(() => ship.skip(30))} title="Everything that's running jumps 30 seconds on">Skip 30 s</button>
          </div>
          <span className="demo-sec">Jump to</span>
          <ul className="demo-states">
            {STATES.map((s) => (
              <li key={s.name}><a href={hrefFor(s)} className={s.name === current.name ? "on" : undefined} title={`?state=${s.name}`}>{s.label}</a></li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="demo-bar">
        <button type="button" className="demo-pill" aria-expanded={open} onClick={() => setOpen(!open)} title="Demo mode: what this is, and other states to try">
          <span className="demo-dot" aria-hidden="true" />Demo
        </button>
        <button type="button" className="demo-reset" onClick={resetDemo} title="Start this state over">Reset</button>
      </div>
    </div>
  );
}
