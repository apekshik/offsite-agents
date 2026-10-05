import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { AVATAR_BODY, AVATAR_PARTS, type AvatarSpec, type Look } from "@offsite/contracts";
import { CAPTAIN_PRESET, CREW_PRESETS, sanitizeAvatar, sanitizeLook } from "@offsite/kit";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Button, CloseIcon, errorText, Face, Key } from "../ui/index.tsx";
import { useShip } from "../overlay/ship.tsx";
import { phone } from "../phone/state.ts";
import { AvatarPreview } from "./Preview.tsx";
import "./creator.css";

// The customizer: a crew member's (or your own) look. Ready-made looks, parts, colours and
// proportions with a live 3D preview, or "describe it" and your machine designs it.

type Tab = "ready" | "parts" | "colours" | "shape" | "describe";

const PART_LABEL: Record<keyof typeof AVATAR_PARTS, string> = { outfit: "Outfit", hair: "Hair", head: "Head", hat: "Hat", face: "Face", back: "On the back", build: "Build" };
const COLOUR_LABEL = { skin: "Skin", hairColor: "Hair", top: "Top", bottom: "Bottom", accent: "Accent" } as const;
const BODY_LABEL: Record<keyof typeof AVATAR_BODY, string> = { height: "Height", legs: "Legs", arms: "Arms", torso: "Torso", bulk: "Bulk", headSize: "Head" };
const SWATCH: Record<keyof typeof COLOUR_LABEL, string[]> = {
  skin: ["#f1d2b8", "#e8b894", "#d39b72", "#b57a53", "#8d5a3b", "#5f3b26", "#c9d3dd", "#f2b37a"],
  hairColor: ["#2b1d14", "#5a3a22", "#a8692f", "#d9b45b", "#1d1d22", "#b9bcc0", "#c2432e", "#9b8cff"],
  top: ["#f3f4f1", "#1d2a4d", "#3d6fd4", "#e85d75", "#2dd4bf", "#ffb84d", "#7c5cff", "#5cc26b"],
  bottom: ["#2a2f3d", "#1d2a44", "#e9e2cf", "#3b3b3b", "#4a6fa5", "#d8c49a", "#ff8a3d", "#ffffff"],
  accent: ["#4fe3ff", "#ffd23f", "#ff5d8f", "#6dffa8", "#e2b64a", "#ff6b3d", "#b388ff", "#f4f1ea"],
};
const nice = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function Creator({ who }: { who: string }) {
  const { byId, me } = useShip();
  const captain = who === "captain";
  const crew = captain ? undefined : byId.get(who);
  const setCrew = useMutation(api.crew.update);
  const setMine = useMutation(api.users.setAvatar);
  const describe = useMutation(api.crew.describeLook);
  const start = useMemo(() => {
    const src = captain ? me : crew;
    if (captain && !me?.avatar) return { spec: CAPTAIN_PRESET.spec, look: CAPTAIN_PRESET.look };
    return { spec: sanitizeAvatar(src?.avatar) as AvatarSpec, look: (src?.look ? sanitizeLook(src.look) : null) as Look | null };
    // Only on open: later changes to the saved look arrive through the describe flow below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who]);
  const [spec, setSpec] = useState<AvatarSpec>(start.spec);
  const [look, setLook] = useState<Look | null>(start.look);
  const [tab, setTab] = useState<Tab>("ready");
  const [prompt, setPrompt] = useState("");
  const [designing, setDesigning] = useState<"no" | "queued" | "arrived">("no");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const savedLook = useRef(JSON.stringify(crew?.look ?? null));

  // A described look lands on the crew member's row: take it into the preview.
  useEffect(() => {
    if (designing !== "queued" || !crew) return;
    const now = JSON.stringify(crew.look ?? null);
    if (now !== savedLook.current && crew.look) {
      savedLook.current = now;
      setLook(sanitizeLook(crew.look) as Look | null);
      setDesigning("arrived");
    }
  }, [crew, designing]);

  const presets = captain ? [CAPTAIN_PRESET, ...CREW_PRESETS] : CREW_PRESETS;
  const name = captain ? "Your look" : `${crew?.name ?? "Their"}'s look`;
  const part = (k: keyof typeof AVATAR_PARTS, v: string) => {
    if (look) setNote("Changing a part takes off the ready-made outfit; colours and shape keep it.");
    setLook(null);
    setSpec((s) => ({ ...s, [k]: v }));
  };
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (captain) await setMine({ avatar: spec, look });
      else await setCrew({ crewId: who as Id<"crew">, avatar: spec, look });
      phone.closeCreator();
    } catch (x) { setErr(errorText(x)); setBusy(false); }
  };
  const design = async () => {
    if (!prompt.trim() || !crew) return;
    setErr(null);
    try {
      await describe({ crewId: crew._id, prompt: prompt.trim() });
      savedLook.current = JSON.stringify(crew.look ?? null);
      setDesigning("queued");
    } catch (x) { setErr(errorText(x)); }
  };

  return (
    <div className="creator-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) phone.closeCreator(); }}>
      <div className="creator fade-up">
        <div className="cr-stage">
          <AvatarPreview spec={spec} look={look} />
          <span className="cr-drag dim">Drag to turn</span>
        </div>
        <div className="cr-side">
          <div className="cr-head">
            <Face avatar={spec} look={look} size={30} />
            <span className="disp cr-title">{name}</span>
            <button className="t-x" onClick={() => phone.closeCreator()} aria-label="Close"><CloseIcon /></button>
          </div>
          <div className="tabs">
            {(["ready", "parts", "colours", "shape", ...(captain ? [] : ["describe"])] as Tab[]).map((t) => (
              <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
                {t === "ready" ? "Ready-made" : t === "describe" ? "Describe it" : nice(t)}
              </button>
            ))}
          </div>
          <div className="cr-body">
            {tab === "ready" ? (
              <div className="cr-presets">
                {presets.map((p) => (
                  <button key={p.id} className={`cr-preset ${look?.meta.name === p.name ? "on" : ""}`} onClick={() => { setSpec(p.spec); setLook(p.look); setNote(null); }}>
                    <Face avatar={p.spec} look={p.look} size={34} />
                    <span className="cr-pname">{p.name}</span>
                    <span className="cr-blurb dim">{p.blurb}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {tab === "parts" ? (
              <div className="cr-groups">
                {(Object.keys(AVATAR_PARTS) as (keyof typeof AVATAR_PARTS)[]).map((k) => (
                  <div key={k} className="cr-group">
                    <span className="lab dim">{PART_LABEL[k]}</span>
                    <div className="cr-opts">
                      {AVATAR_PARTS[k].map((v) => <button key={v} className={`tab ${spec[k] === v && !look ? "on" : ""}`} onClick={() => part(k, v)}>{nice(v)}</button>)}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {tab === "colours" ? (
              <div className="cr-groups">
                {(Object.keys(COLOUR_LABEL) as (keyof typeof COLOUR_LABEL)[]).map((k) => (
                  <div key={k} className="cr-group">
                    <span className="lab dim">{COLOUR_LABEL[k]}</span>
                    <div className="cr-swatches">
                      {SWATCH[k].map((c) => <button key={c} className={`cr-sw ${spec[k] === c ? "on" : ""}`} style={{ background: c }} onClick={() => setSpec((s) => ({ ...s, [k]: c }))} aria-label={c} />)}
                      <label className="cr-sw cr-pick" style={{ background: spec[k] }} title="Any colour">
                        <input type="color" value={spec[k]} onChange={(e) => setSpec((s) => ({ ...s, [k]: e.target.value }))} />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {tab === "shape" ? (
              <div className="cr-groups">
                {(Object.keys(AVATAR_BODY) as (keyof typeof AVATAR_BODY)[]).map((k) => (
                  <label key={k} className="cr-slider">
                    <span className="lab dim">{BODY_LABEL[k]}</span>
                    <input type="range" min={AVATAR_BODY[k][0]} max={AVATAR_BODY[k][1]} step={0.01} value={spec[k]} onChange={(e) => setSpec((s) => ({ ...s, [k]: Number(e.target.value) }))} />
                    <span className="mono cr-val">{spec[k].toFixed(2)}</span>
                  </label>
                ))}
                <Button kind="ghost" size="sm" onClick={() => setSpec((s) => ({ ...s, height: 1, legs: 1, arms: 1, torso: 1, bulk: 1, headSize: 1 }))}>Reset proportions</Button>
              </div>
            ) : null}
            {tab === "describe" && crew ? (
              <div className="cr-describe">
                <span className="dim">Say what {crew.name} should look like. Your machine designs it from pieces on your own subscription, then it walks, sits and swims like everyone else.</span>
                <textarea className="input" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="An otter in aviators and a linen shirt" />
                <div className="actions">
                  <Button kind="primary" disabled={!prompt.trim() || designing === "queued"} onClick={() => void design()}>{designing === "queued" ? "Designing…" : "Design it"}</Button>
                  {designing === "queued" ? <span className="dim">Working on your machine. It shows up here when it's ready.</span> : null}
                  {designing === "arrived" ? <span className="t-green lab">It's here. Save to keep it.</span> : null}
                </div>
              </div>
            ) : null}
          </div>
          {note ? <div className="note">{note}</div> : null}
          {err ? <div className="error">{err}</div> : null}
          <div className="cr-foot">
            <Button kind="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
            <Button kind="ghost" onClick={() => phone.closeCreator()}>Cancel</Button>
            <span className="dim cr-esc"><Key>Esc</Key> close</span>
          </div>
        </div>
      </div>
    </div>
  );
}
