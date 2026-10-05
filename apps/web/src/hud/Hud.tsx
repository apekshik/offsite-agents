import { useUi } from "../bridge.ts";
import { Button, Dot, Key } from "../ui/index.tsx";
import { useShip } from "../overlay/ship.tsx";
import { phone, usePhone } from "../phone/state.ts";
import { PingMarker } from "./Ping.tsx";
import { Toasts } from "./Toasts.tsx";
import "./hud.css";

// The HUD: as little as possible. Where you are and whether a machine is working for you, what
// you could use right now (E), a small view and phone hint, toasts, and the ping marker.

function Status() {
  const { office, machine, machines } = useShip();
  const noMachine = machines !== undefined && machines.length === 0;
  const noProject = office !== undefined && !office.repos.length;
  return (
    <div className="hud-status">
      <span className="hud-chip">
        <span className="disp hud-ship">{office?.name ?? ""}</span>
        {!(noMachine || noProject) && machine ? <span className="hud-machine"><Dot tone={machine.online ? "on" : "off"} />{machine.name}{machine.online ? "" : " · offline: the crew waits for it"}</span> : null}
      </span>
      {noMachine || noProject ? (
        <div className="hud-warn">
          <Dot tone="amber" />
          <span>{noMachine ? "No machine connected: the crew lounges until you connect one." : "No repo yet: the crew lounges until you add one."}</span>
          <Button kind="soft-amber" size="sm" onClick={() => phone.openShip()}>{noMachine ? "Connect" : "Add a repo"}</Button>
        </div>
      ) : null}
    </div>
  );
}

/** The crosshair while the mouse is grabbed. On a crew member (or a delivered package) it opens into a ring with a name. */
function Reticle() {
  const aim = useUi((s) => s.aim);
  return (
    <div className={`hud-reticle ${aim ? "on" : ""}`} aria-hidden="true">
      <span className="hud-reticle-dot" />
      {aim ? (
        <div className="hud-reticle-tag">
          <b>{aim.name}</b>
          {aim.line ? <span>{aim.line}</span> : null}
          <em>{aim.hint ?? "Click for their card"}</em>
        </div>
      ) : null}
    </div>
  );
}

export function Hud() {
  const prompt = useUi((s) => s.prompt);
  const view = useUi((s) => s.view);
  const locked = useUi((s) => s.pointerLocked);
  const helm = useUi((s) => s.helm);
  const fold = usePhone((s) => s.fold);
  const creator = usePhone((s) => s.creator);
  const { questions } = useShip();
  const busy = helm || fold === "open" || creator !== null;
  return (
    <>
      {!busy ? <Status /> : null}
      {!busy ? <PingMarker /> : null}
      <Toasts />
      {!busy && prompt ? (
        <div className="hud-prompt fade-up" key={prompt.id}><Key>E</Key><span>{prompt.label}</span></div>
      ) : null}
      {!busy && !locked && !prompt && fold === "away" ? <div className="hud-look">Click the world to look around · Esc lets go</div> : null}
      {!busy && locked ? <Reticle /> : null}
      {!busy ? (
        <div className="hud-hints">
          <span className={`hud-hint ${questions.length ? "asking" : ""}`}>
            <Key>F</Key>{fold === "cover" ? "Put away · FF unfold" : "Phone · FF unfold"}
            {questions.length ? <span className="pill amber pulse">{questions.length}</span> : null}
          </span>
          <span className="hud-hint"><Key>V</Key>{view === "first" ? "Third person" : "First person"}</span>
          {view === "third" ? <span className="hud-hint dim">Scroll to zoom</span> : null}
        </div>
      ) : null}
      {locked && view === "first" && !busy ? <div className="hud-cross" /> : null}
    </>
  );
}
