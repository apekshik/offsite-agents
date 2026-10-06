import { useUi } from "../bridge.ts";
import { Button, Dot, Key } from "../ui/index.tsx";
import { useShip } from "../overlay/ship.tsx";
import { phone, usePhone } from "../phone/state.ts";
import { audio, useAudio } from "../audio/index.ts";
import { PingMarker } from "./Ping.tsx";
import { Toasts } from "./Toasts.tsx";
import { WalkChip } from "../overlay/walk.tsx";
import { PeopleOnDeck } from "./People.tsx";
import { forMe, useAboard } from "../people/people.ts";
import "./hud.css";

// The HUD: as little as possible. Where you are and whether a machine is working for you, what
// you could use right now (E), a small view and phone hint, toasts, the ping marker, and a walk
// under way (shown over the phone too: you walk with it open).

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
      <PeopleOnDeck />
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

/** A speaker that mutes (M does too) and a thin volume slider beside it. */
function Sound() {
  const { volume, muted } = useAudio();
  const level = muted ? 0 : volume;
  return (
    <span className="hud-hint hud-sound">
      <button className="hud-sound-btn" onClick={() => audio.toggleMute()} aria-label={muted ? "Unmute (M)" : "Mute (M)"} title={muted ? "Unmute (M)" : "Mute (M)"}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
          {level > 0 ? <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /> : null}
          {level > 0.5 ? <path d="M12.2 3.8a6 6 0 0 1 0 8.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /> : null}
          {level === 0 ? <path d="M10.5 6l3.5 4m0-4l-3.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /> : null}
        </svg>
      </button>
      <input className="hud-sound-vol" type="range" min={0} max={1} step={0.05} value={level} aria-label="Volume"
        style={{ ["--v" as string]: `${level * 100}%` }}
        onChange={(e) => { const v = Number(e.target.value); audio.volume = v; if (audio.muted && v > 0) audio.muted = false; }}
        onPointerUp={(e) => e.currentTarget.blur()} />
    </span>
  );
}

export function Hud() {
  const prompt = useUi((s) => s.prompt);
  const view = useUi((s) => s.view);
  const locked = useUi((s) => s.pointerLocked);
  const helm = useUi((s) => s.helm);
  const fold = usePhone((s) => s.fold);
  const creator = usePhone((s) => s.creator);
  const { questions: all, officeId } = useShip();
  const aboard = useAboard(officeId);
  const questions = all.filter((q) => aboard.loading || forMe(q, aboard.me, aboard.isOwner));
  // In first person the phone, even folded, is up in your hands in the middle of the view: nothing else goes over it.
  const busy = helm || fold === "open" || (fold !== "away" && view === "first") || creator !== null;
  return (
    <>
      {!busy ? <Status /> : null}
      {!busy ? <PingMarker /> : null}
      <Toasts />
      <WalkChip />
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
          <Sound />
        </div>
      ) : null}
      {locked && view === "first" && !busy ? <div className="hud-cross" /> : null}
    </>
  );
}
