import { Face } from "../ui/index.tsx";
import { useShip } from "../overlay/ship.tsx";
import { useAboard } from "../people/people.ts";
import { useLinks } from "../net/index.ts";
import { useVoice, voice } from "../voice/index.ts";
import { phone } from "../phone/state.ts";
import "../phone/friends.css";

// Who's on deck with you, top left under the ship's name: a small face each, ringed while they talk (and a dot when
// you muted them), and the mic (T). Only once someone else is aboard; alone, the HUD stays as it was.

const MIC_NOTE: Record<string, string> = {
  blocked: "The browser blocked the mic. Allow it for this site (the icon in the address bar), then press T again.",
  none: "No microphone found.",
  failed: "The mic didn't start. Try again with T.",
};

export function MicButton() {
  const v = useVoice();
  const label = v.asking ? "Asking…" : !v.enabled ? "Voice" : v.muted ? "Muted" : "Live";
  return (
    <>
      <button className={`hud-mic ${v.live ? "live" : ""} ${v.enabled && v.muted ? "muted" : ""} ${v.talking ? "talking" : ""}`}
        onClick={(e) => { void voice.toggle(); e.currentTarget.blur(); }}
        title={!v.enabled ? "Talk to people near you (T). Your browser asks for the mic the first time." : v.muted ? "Unmute (T)" : "Mute (T)"}
        aria-pressed={v.live}>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" fill="currentColor" />
          <path d="M3.2 7.6a4.8 4.8 0 0 0 9.6 0M8 12.4v2.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          {v.enabled && v.muted ? <path d="M2.5 2.5l11 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /> : null}
        </svg>
        {label}<kbd>T</kbd>
      </button>
      {v.error ? <span className="hud-mic-note" role="alert">{MIC_NOTE[v.error] ?? MIC_NOTE["failed"]}</span> : null}
    </>
  );
}

export function PeopleOnDeck() {
  const { officeId } = useShip();
  const aboard = useAboard(officeId);
  const links = useLinks();
  const v = useVoice();
  if (!aboard.others.length) return null;
  return (
    <div className="hud-people" aria-label="People on deck">
      {aboard.others.map((p) => {
        const talking = v.speaking.includes(p.userId), muted = v.mutedPeople.includes(p.userId);
        return (
          <span key={p.userId} className={`hp-face ${talking ? "talking" : ""} ${muted ? "muted" : ""} ${links[p.userId] === "relayed" ? "relayed" : ""}`}
            title={`${p.name}${p.owner ? " (captain)" : ""}${talking ? " · talking" : ""}${muted ? " · muted" : ""}${links[p.userId] === "relayed" ? " · no direct link: no voice" : ""}`}
            onClick={() => phone.openCrew(null)}>
            <Face avatar={p.avatar} look={p.look} size={26} />
          </span>
        );
      })}
      <MicButton />
    </div>
  );
}
