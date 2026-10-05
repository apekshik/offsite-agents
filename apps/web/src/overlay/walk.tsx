import { useEffect, useRef, useState, type ReactNode } from "react";
import { ui, useUi, type WalkTarget } from "../bridge.ts";
import { Key } from "../ui/index.tsx";
import { phone } from "../phone/state.ts";
import { useShip } from "./ship.tsx";
import { useAboard } from "../people/people.ts";

// Walking over by yourself: "Walk over" on a crew member, "Walk to the helm", or H and 1–9 while
// the phone is out. The interface sets ui.walkTo; the game walks the captain there (the phone stays
// open, the keyboard stays with it) and clears it when the walk ends, saying how in ui.walkEnd.
// WASD, grabbing the mouse or Esc stops it.

/** Walk the captain there. The helm console closes: you're leaving it. */
export function walkTo(to: WalkTarget) {
  ui.set({ walkTo: to, walkEnd: null, helm: false });
}

export function stopWalking() {
  if (ui.get().walkTo) ui.set({ walkTo: null });
}

export const walkToCrew = (crewId: string) => walkTo({ kind: "crew", crewId });
export const walkToHelm = () => walkTo({ kind: "helm" });
/** Walk over to someone else aboard: a friend on deck, or the captain. */
export const walkToPerson = (userId: string) => walkTo({ kind: "person", userId });

/** A crew member's face in a conversation that walks you over to them when clicked. */
export function WalkFace({ crewId, name, children }: { crewId: string; name: string; children: ReactNode }) {
  return (
    <button type="button" className="face-btn" title={`Walk over to ${name}`} aria-label={`Walk over to ${name}`} onClick={() => walkToCrew(crewId)}>
      {children}
    </button>
  );
}

const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/**
 * The phone's walking keys, while it (or the helm console) is out and you aren't typing: H walks to
 * the helm, 1–9 to the crew in the Crew tab's order. WASD stops a walk (with the phone away, the
 * game hears WASD itself).
 */
export function WalkKeys() {
  const { crew } = useShip();
  const list = useRef(crew);
  list.current = crew;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || editable(e.target)) return;
      const p = phone.get();
      const out = (p.fold !== "away" && !p.creator) || ui.get().helm;
      if (!out) return;
      if (MOVE_KEYS.has(e.code) && ui.get().walkTo) { stopWalking(); return; }
      if (e.code === "KeyH" && !ui.get().helm) { e.preventDefault(); walkToHelm(); return; }
      const n = /^Digit([1-9])$/.exec(e.code)?.[1];
      const c = n ? list.current[Number(n) - 1] : undefined;
      if (c) { e.preventDefault(); walkToCrew(c._id); }
    };
    addEventListener("keydown", down);
    return () => removeEventListener("keydown", down);
  }, []);
  return null;
}

/** A ship's wheel, small. */
export function HelmIcon() {
  return (
    <svg className="helm-icon" width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="4.2" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <path d="M8 1v2.6M8 12.4V15M1 8h2.6M12.4 8H15M3.05 3.05l1.85 1.85M11.1 11.1l1.85 1.85M3.05 12.95l1.85-1.85M11.1 4.9l1.85-1.85" />
    </svg>
  );
}

function Steps() {
  return (
    <svg className="walk-icon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <ellipse cx="4.3" cy="4.6" rx="1.7" ry="2.6" fill="currentColor" />
      <ellipse cx="9.7" cy="7.6" rx="1.7" ry="2.6" fill="currentColor" opacity="0.6" />
      <circle cx="4.3" cy="9.3" r="1" fill="currentColor" />
      <circle cx="9.7" cy="12.2" r="1" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

/**
 * The walk, at the top of the screen over everything: "Walking to Wren · Esc to stop", then for a
 * moment how it went ("With Wren", "You're at the helm", "Can't find a way there").
 */
export function WalkChip() {
  const to = useUi((s) => s.walkTo);
  const end = useUi((s) => s.walkEnd);
  const { byId, officeId } = useShip();
  const aboard = useAboard(officeId);
  const [note, setNote] = useState<NonNullable<typeof end> | null>(null);
  useEffect(() => {
    if (!end || end.outcome === "stopped") { setNote(null); return; }
    setNote(end);
    const t = setTimeout(() => setNote((n) => (n === end ? null : n)), end.outcome === "failed" ? 3200 : 2400);
    return () => clearTimeout(t);
  }, [end]);
  const name = (t: WalkTarget) => (t.kind === "helm" ? "the helm" : t.kind === "person" ? aboard.byId.get(t.userId)?.name ?? "them" : byId.get(t.crewId)?.name ?? "them");
  if (to) {
    return (
      <div className="walk-chip" role="status" key="walking">
        <Steps />
        <span>Walking to <b>{name(to)}</b></span>
        <span className="walk-sep">·</span>
        <button className="walk-stop" onClick={stopWalking} aria-label="Stop walking"><Key>Esc</Key> to stop</button>
      </div>
    );
  }
  if (!note) return null;
  const failed = note.outcome === "failed";
  return (
    <div className={`walk-chip ${failed ? "failed" : "there"}`} role="status" key={`end${note.at}`}>
      {failed ? <span>Can't find a way there</span>
        : note.to.kind === "helm" ? <span>You're at the helm</span>
        : <span>With <b>{name(note.to)}</b></span>}
    </div>
  );
}
